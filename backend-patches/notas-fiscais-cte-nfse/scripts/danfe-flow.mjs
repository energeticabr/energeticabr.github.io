// Attach each fiscal PDF to the same invoice item and existing SharePoint connection.
export const fullDocumentKinds=['nfeProc','cteProc','cteOSProc','cteSimpProc','NFSe'];
export const fiscalDocumentKinds=['nfeProc','resNFe','procEventoNFe','resEvento','cteProc','cteOSProc','cteSimpProc','procEventoCTe','NFSe','evento'];
const lit=value=>`'${String(value).replaceAll("'","''")}'`;
const array=values=>`createArray(${values.map(lit).join(',')})`;
export const isFullDocument=expression=>`contains(${array(fullDocumentKinds)},${expression})`;
const only=(value,characters)=>`equals(${[...characters].reduce((expression,ch)=>`replace(${expression},${lit(ch)},'')`,value)},'')`;
const requiredTrue={type:'object',required:['valido'],properties:{valido:{type:'boolean',enum:[true]}}};
export const danfeSchema={type:'object',required:['fileName','pdfBase64','sha256'],properties:{
  fileName:{type:'string',minLength:1,maxLength:120},
  pdfBase64:{type:'string',minLength:28,maxLength:2700000},
  sha256:{type:'string',minLength:64,maxLength:64},
}};

export function addDanfeActions(process,cfg){
  const listApi=`_api/web/lists/getbytitle('${cfg.listTitle}')`;
  const lit=value=>`'${value.replaceAll("'","''")}'`;
  const after=name=>name?{[name]:['Succeeded']}:{};
  function sp(method,uri,body,previous,extra={}){
    return {type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_sharepointonline',connectionName:'shared_sharepointonline',operationId:'HttpRequest'},parameters:{
      dataset:cfg.siteUrl,'parameters/method':method,'parameters/uri':uri,
      'parameters/headers':{Accept:'application/json;odata=nometadata','Content-Type':'application/json;odata=nometadata',...extra},
      ...(body===undefined?{}:{'parameters/body':typeof body==='string'?body:JSON.stringify(body)}),
    },authentication:"@parameters('$authentication')"},runAfter:after(previous)};
  }
  function native(operationId,parameters,previous){
    return {type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_sharepointonline',connectionName:'shared_sharepointonline',operationId},
      parameters:{dataset:cfg.siteUrl,...parameters},authentication:"@parameters('$authentication')"},runAfter:after(previous)};
  }
  const doc=name=>`items('Documentos')?['${name}']`;
  const key=doc('key'),kind=doc('kind'),nsu=doc('nsu'),sha=doc('sha256');
  const digits='0123456789',hex=digits+'abcdef';
  const key44=`and(equals(length(${key}),44),${only(`substring(${key},0,6)`,digits)},${only(`substring(${key},6,12)`,digits+'ABCDEFGHIJKLMNOPQRSTUVWXYZ')},${only(`substring(${key},18,26)`,digits)})`;
  const key50=`and(equals(length(${key}),50),${only(key,digits)})`;
  const clauses=[
    `contains(${array(fiscalDocumentKinds)},${kind})`,
    `if(contains(createArray('NFSe','evento'),${kind}),${key50},${key44})`,
    `and(greaterOrEquals(length(${nsu}),15),lessOrEquals(length(${nsu}),19),${only(nsu,digits)},isInt(${nsu}))`,
    `and(equals(length(${sha}),64),${only(sha,hex)})`,
    `equals(${doc('id')},concat(${nsu},'-',substring(${sha},0,16)))`,
    `equals(${doc('fileName')},concat(${key},'-',${doc('id')},'.xml'))`,
    `equals(items('Documentos')?['fields']?['CHAVE_ACESSO'],${key})`,
    `equals(items('Documentos')?['fields']?['ULTIMO_NSU'],${nsu})`,
    `if(${isFullDocument(kind)},equals(items('Documentos')?['fields']?['STATUS_IMPORTACAO'],'XML_COMPLETO'),not(equals(items('Documentos')?['fields']?['STATUS_IMPORTACAO'],'XML_COMPLETO')))`,
  ];
  process.Conferir_identidade={type:'ParseJson',inputs:{content:`@if(and(${clauses.join(',')}),json('{"valido":true}'),json('{}'))`,schema:requiredTrue},runAfter:{}};
  const pdf=name=>`items('Documentos')?['danfe']?['${name}']`;
  const pdfPrefix=`if(equals(${kind},'NFSe'),'DANFSe',if(contains(createArray('cteProc','cteOSProc','cteSimpProc'),${kind}),'DACTE','DANFE'))`;
  process.Conferir_DANFE={type:'If',expression:{equals:[`@${isFullDocument(kind)}`,true]},
    actions:{
      Validar_pdf:{type:'ParseJson',inputs:{content:"@items('Documentos')?['danfe']",schema:danfeSchema},runAfter:{}},
      Conferir_identidade_pdf:{type:'ParseJson',inputs:{
        content:`@if(and(equals(${pdf('fileName')},concat(${pdfPrefix},'-',${key},'-',substring(${sha},0,16),'.pdf')),equals(length(${pdf('sha256')}),64),${only(pdf('sha256'),hex)}),json('{"valido":true}'),json('{}'))`,schema:requiredTrue,
      },runAfter:after('Validar_pdf')},
    },else:{actions:{}},runAfter:after('Conferir_identidade')};
  process.Gravar_XML.runAfter=after('Conferir_DANFE');
  process.Nota_apos_gravacao=sp('GET',process.Localizar_nota.inputs.parameters['parameters/uri'],undefined,'Criar_ou_atualizar',{Accept:'application/json;odata=verbose'});
  process.Nota_gravada={type:'Compose',inputs:"@first(body('Nota_apos_gravacao')?['d']?['results'])",runAfter:after('Nota_apos_gravacao')};
  const item=`concat(${lit(listApi+'/items(')},string(int(outputs('Nota_gravada')?['Id'])),')')`;
  const filename="items('Documentos')?['danfe']?['fileName']";
  const endpoint=suffix=>`@concat(${item},${suffix})`;
  const binary="@base64ToBinary(items('Documentos')?['danfe']?['pdfBase64'])";
  const relativePath=source=>`@substring(${source},${new URL(cfg.siteUrl).pathname.length})`;
  const actions={};
  actions.Localizar_anexo=sp('GET',endpoint(`${lit('/AttachmentFiles?$select=FileName,ServerRelativeUrl&$filter=FileName eq ' + "'")},${filename},${lit("'")}`));
  actions.Criar_ou_substituir_anexo={type:'If',expression:{equals:["@length(body('Localizar_anexo')?['value'])",0]},actions:{
    Criar_anexo:native('CreateAttachment',{table:cfg.listTitle,itemId:"@int(outputs('Nota_gravada')?['Id'])",displayName:`@${filename}`,body:binary}),
  },else:{actions:{
    Metadados_anexo:native('GetFileMetadataByPath',{path:relativePath("first(body('Localizar_anexo')?['value'])?['ServerRelativeUrl']")}),
    Substituir_anexo:native('UpdateFile',{id:"@body('Metadados_anexo')?['Id']",body:binary},'Metadados_anexo'),
  }},runAfter:after('Localizar_anexo')};
  actions.Conferir_anexo=sp('GET',endpoint(`${lit("/AttachmentFiles('")},${filename},${lit("')?$select=FileName,ServerRelativeUrl")}`),undefined,'Criar_ou_substituir_anexo');
  actions.Baixar_pdf=native('GetFileContentByPath',{path:relativePath("body('Conferir_anexo')?['ServerRelativeUrl']"),inferContentType:true},'Conferir_anexo');
  actions.Conferir_integridade_pdf={type:'ParseJson',inputs:{
    content:"@if(equals(body('Baixar_pdf')?['$content'],items('Documentos')?['danfe']?['pdfBase64']),json('{\"valido\":true}'),json('{}'))",
    schema:{type:'object',required:['valido'],properties:{valido:{type:'boolean',enum:[true]}}},
  },runAfter:after('Baixar_pdf')};
  actions.Nota_apos_anexo=sp('GET',endpoint(lit('?$select=Id')),undefined,'Conferir_integridade_pdf',{Accept:'application/json;odata=verbose'});
  actions.Campos_DANFE={type:'Compose',inputs:{
    STATUS_DANFE:'DISPONIVEL',DANFE_URL:{
      Url:`@concat('${new URL(cfg.siteUrl).origin}',body('Conferir_anexo')?['ServerRelativeUrl'])`,Description:'PDF - espelho do documento fiscal',
    },
  },runAfter:after('Nota_apos_anexo')};
  actions.Marcar_DANFE=sp('POST',`@${item}`,"@string(outputs('Campos_DANFE'))",'Campos_DANFE',{'X-HTTP-Method':'MERGE','IF-MATCH':"@body('Nota_apos_anexo')?['d']?['__metadata']?['etag']"});
  const finalSituation="outputs('Nota_gravada')?['SITUACAO']";
  const incomingSituation="items('Documentos')?['fields']?['SITUACAO']";
  // Replayed authorized XML must not overwrite the terminal PDF kept by merge.
  // A genuinely terminal NFSe with a marked PDF remains eligible to attach.
  const mayAttach=`and(${isFullDocument(kind)},or(not(contains(createArray('CANCELADA','SUBSTITUIDA'),${finalSituation})),equals(${finalSituation},${incomingSituation})))`;
  process.Anexar_DANFE={type:'If',expression:{equals:[`@${mayAttach}`,true]},actions,else:{actions:{}},runAfter:after('Nota_gravada')};
}
