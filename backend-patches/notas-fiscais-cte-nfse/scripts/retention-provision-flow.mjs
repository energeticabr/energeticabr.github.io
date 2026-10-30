const headers={Accept:'application/json;odata=nometadata','Content-Type':'application/json;odata=nometadata'};
const lit=value=>`'${String(value).replaceAll("'","''")}'`;
const after=name=>name?{[name]:['Succeeded']}:{};

function sp(site,method,uri,body,previous,extra={}){
  return {type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_sharepointonline',connectionName:'shared_sharepointonline',operationId:'HttpRequest'},parameters:{
    dataset:site,'parameters/method':method,'parameters/uri':uri,'parameters/headers':{...headers,...extra},...(body===undefined?{}:{'parameters/body':body}),
  },authentication:"@parameters('$authentication')"},runAfter:after(previous)};
}

function objectBody(entries){
  let expression="json('{}')";
  for(const [name,value] of Object.entries(entries))expression=`setProperty(${expression},${lit(name)},${value})`;
  return `@string(${expression})`;
}

const amount=name=>`float(coalesce(outputs('Campos_finais')?['${name}'],0))`;
const sum=names=>names.reduce((left,name)=>left?`add(${left},${amount(name)})`:amount(name),'');

export function retentionTotalExpression(){
  const nfe=sum(['PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO']);
  const nfse=sum(['CONTRIB_SOCIAIS_RETIDAS','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO']);
  return `@if(equals(outputs('Campos_finais')?['TIPO_FISCAL'],'NFS-e'),${nfse},if(equals(outputs('Campos_finais')?['TIPO_FISCAL'],'NF-e'),${nfe},0))`;
}

export function retentionProvisionVariable(previous){
  return {type:'InitializeVariable',inputs:{variables:[{name:'RetentionParentTotal',type:'Float',value:0}]},runAfter:after(previous)};
}

export function addRetentionProvisionActions(actions,config){
  const site=config.queueSiteUrl;
  if(typeof site!=='string'||!site.startsWith('https://'))throw new Error('queueSiteUrl obrigatorio para provisoes de retencao');
  actions.Total_retido_comprador={type:'Compose',inputs:retentionTotalExpression(),runAfter:{Anexar_DANFE:['Succeeded']}};
  const inside={};
  inside.Vencimento_retencao={type:'Compose',inputs:"@concat(formatDateTime(addToTime(outputs('Campos_finais')?['DATA_EMISSAO'],1,'Month'),'yyyy-MM'),'-20T00:00:00-03:00')",runAfter:{}};
  inside.Chave_rubrica_retencao={type:'Compose',inputs:"@concat('RETENCAO-',formatDateTime(outputs('Vencimento_retencao'),'yyyy-MM'))",runAfter:after('Vencimento_retencao')};
  inside.Prefixo_filhos_retencao={type:'Compose',inputs:"@concat(outputs('Chave_rubrica_retencao'),'-NOTA-')",runAfter:after('Chave_rubrica_retencao')};
  inside.Chave_provisao_retencao={type:'Compose',inputs:"@concat('RETENCAO-NOTA-',outputs('Campos_finais')?['CHAVE_ACESSO'])",runAfter:after('Prefixo_filhos_retencao')};
  inside.Localizar_rubrica_retencao=sp(site,'GET',"@concat('_api/web/lists/getbytitle(''DESCRITIVOPROVISAO'')/items?$select=Id,FOLHAOPERACAO&$filter=FOLHAOPERACAO eq ''',outputs('Chave_rubrica_retencao'),'''&$top=2')",undefined,'Chave_provisao_retencao');
  inside.Conferir_rubrica_unica={type:'ParseJson',inputs:{content:"@length(body('Localizar_rubrica_retencao')?['value'])",schema:{type:'integer',enum:[0,1]}},runAfter:after('Localizar_rubrica_retencao')};
  inside.Garantir_rubrica_retencao={type:'If',expression:{equals:["@length(body('Localizar_rubrica_retencao')?['value'])",0]},actions:{
    Criar_rubrica_retencao:sp(site,'POST',"_api/web/lists/getbytitle('DESCRITIVOPROVISAO')/items",objectBody({
      Title:"outputs('Chave_rubrica_retencao')",FOLHAOPERACAO:"outputs('Chave_rubrica_retencao')",
      DATAPREVISTOPGTO:"outputs('Vencimento_retencao')",VALORTOTAL:"'0.00'",
    })),
  },else:{actions:{}},runAfter:after('Conferir_rubrica_unica')};
  inside.Rubrica_retencao={type:'Compose',inputs:"@if(empty(body('Localizar_rubrica_retencao')?['value']),body('Criar_rubrica_retencao')?['Id'],first(body('Localizar_rubrica_retencao')?['value'])?['Id'])",runAfter:after('Garantir_rubrica_retencao')};
  inside.Localizar_provisao_retencao=sp(site,'GET',"@concat('_api/web/lists/getbytitle(''PROVISÃO PGTOS'')/items?$select=Id,FOLHAOPERACAO&$filter=FOLHAOPERACAO eq ''',outputs('Chave_provisao_retencao'),'''&$top=2')",undefined,'Rubrica_retencao');
  inside.Conferir_provisao_unica={type:'ParseJson',inputs:{content:"@length(body('Localizar_provisao_retencao')?['value'])",schema:{type:'integer',enum:[0,1]}},runAfter:after('Localizar_provisao_retencao')};
  inside.Criar_se_ausente_provisao_retencao={type:'If',expression:{equals:["@length(body('Localizar_provisao_retencao')?['value'])",0]},actions:{
    Criar_provisao_retencao:sp(site,'POST',"_api/web/lists/getbytitle('PROVISÃO PGTOS')/items",objectBody({
      Title:"concat(outputs('Prefixo_filhos_retencao'),outputs('Campos_finais')?['CHAVE_ACESSO'])",
      FOLHAOPERACAO:"outputs('Chave_provisao_retencao')",DESCRITIVOPROVISAO:"string(outputs('Rubrica_retencao'))",
      DATAPREVISTOPGTO:"outputs('Vencimento_retencao')",QTD:"'1'",VALORTOTAL:"formatNumber(outputs('Total_retido_comprador'),'0.00','en-US')",
      OBS:"coalesce(outputs('Campos_finais')?['Title'],'')",
    })),
  },else:{actions:{}},runAfter:after('Conferir_provisao_unica')};
  inside.Zerar_total_rubrica={type:'SetVariable',inputs:{name:'RetentionParentTotal',value:0},runAfter:after('Criar_se_ausente_provisao_retencao')};
  inside.Listar_provisoes_rubrica=sp(site,'GET',"@concat('_api/web/lists/getbytitle(''PROVISÃO PGTOS'')/items?$select=Id,VALORTOTAL&$filter=startswith(Title,''',outputs('Prefixo_filhos_retencao'),''')&$top=5000')",undefined,'Zerar_total_rubrica');
  inside.Somar_provisoes_rubrica={type:'Foreach',foreach:"@body('Listar_provisoes_rubrica')?['value']",actions:{
    Acumular_total_rubrica:{type:'IncrementVariable',inputs:{name:'RetentionParentTotal',value:"@float(coalesce(items('Somar_provisoes_rubrica')?['VALORTOTAL'],0))"},runAfter:{}},
  },runtimeConfiguration:{concurrency:{repetitions:1}},runAfter:after('Listar_provisoes_rubrica')};
  inside.Atualizar_total_rubrica=sp(site,'POST',"@concat('_api/web/lists/getbytitle(''DESCRITIVOPROVISAO'')/items(',string(outputs('Rubrica_retencao')),')')",objectBody({
    VALORTOTAL:"formatNumber(variables('RetentionParentTotal'),'0.00','en-US')",
  }),'Somar_provisoes_rubrica',{'X-HTTP-Method':'MERGE','IF-MATCH':'*'});
  actions.Garantir_provisao_retencao={type:'If',expression:"@and(equals(outputs('Campos_finais')?['STATUS_RETENCOES'],'RETENCAO_INFORMADA_XML'),equals(outputs('Campos_finais')?['STATUS_IMPORTACAO'],'XML_COMPLETO'),equals(outputs('Campos_finais')?['DIRECAO'],'ENTRADA'),equals(outputs('Campos_finais')?['SITUACAO'],'AUTORIZADA'),or(equals(outputs('Campos_finais')?['TIPO_FISCAL'],'NF-e'),equals(outputs('Campos_finais')?['TIPO_FISCAL'],'NFS-e')),greater(outputs('Total_retido_comprador'),0))",actions:inside,else:{actions:{}},runAfter:after('Total_retido_comprador')};
}
