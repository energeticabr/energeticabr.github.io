import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {addDanfeActions,isFullDocument} from './danfe-flow.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'config/energetica.json'),'utf8'));
const site=cfg.siteUrl;
const list=cfg.listTitle;
const library=cfg.libraryTitle;
const listApi=`_api/web/lists/getbytitle('${list}')`;
const wdlString=value=>`'${String(value).replaceAll("'","''")}'`;
const headers={Accept:'application/json;odata=nometadata','Content-Type':'application/json;odata=nometadata'};
const textNames=['CHAVE_ACESSO','CNPJ_FORNECEDOR','CNPJ_DESTINATARIO','CNPJ_CONSULTADO','NUMERO_NOTA','SERIE','MODELO','DESTINATARIO','UF_FORNECEDOR','NATUREZA_OPERACAO','ORIGEM_LIQUIDO','SITUACAO','DIRECAO','STATUS_IMPORTACAO','STATUS_DANFE','ULTIMO_NSU','TIPO_DOCUMENTO','TIPO_EVENTO','PROTOCOLO','DATA_EMISSAO_ORIGINAL'];
const moneyNames=['VALOR_PRODUTOS','VALOR_TOTAL_NOTA','DESCONTOS','VALOR_LIQUIDO','VALOR_ORIGINAL_FATURA','DESCONTO_FATURA','FRETE','SEGURO','OUTRAS_DESPESAS','IPI','ICMS','PIS','COFINS','ICMS_ST','ICMS_DESONERADO','FCP_ST','IMPOSTO_IMPORTACAO'];
const retentionNames=['PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO','CONTRIB_SOCIAIS_RETIDAS','TOTAL_RETIDO'];
moneyNames.push(...retentionNames);
textNames.push('STATUS_RETENCOES');
textNames.push('TIPO_FISCAL','ORIGEM_FISCAL','TOMADOR','CNPJ_TOMADOR','PAPEL_EMPRESA','MUNICIPIO_PRESTACAO','CODIGO_SERVICO','DATA_EMISSAO_DPS','SERIE_DPS',
  'FONTE_FISCAL','NUMERO_DPS','ORIGEM_DATA_EMISSAO','REMETENTE','CNPJ_REMETENTE','EXPEDIDOR','CNPJ_EXPEDIDOR','RECEBEDOR','CNPJ_RECEBEDOR','PROTOCOLO_EVENTO','SEQUENCIA_EVENTO','STATUS_EVENTO');
moneyNames.push('ISS','VALOR_SERVICOS','DESCONTO_CONDICIONADO','DESCONTO_INCONDICIONADO','VALOR_LIQUIDO_FATURA');
const dateNames=['DATA_EMISSAO','DATA_EVENTO'];
const noteNames=['OBSERVACOES_NOTA','INFORMACOES_FISCO','DESCRICAO_SERVICO'];
const linkNames=['XML_URL','ULTIMO_DOCUMENTO_URL','DANFE_URL'];
const allFields=['Title',...textNames,...moneyNames,...dateNames,...noteNames,...linkNames];
const after=(name,status=['Succeeded'])=>name?{[name]:status}:{};
function sp(method,uri,body,previous,extra={}) {
  return {type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_sharepointonline',connectionName:'shared_sharepointonline',operationId:'HttpRequest'},parameters:{dataset:site,'parameters/method':method,'parameters/uri':uri,'parameters/headers':{...headers,...extra},...(body===undefined?{}:{'parameters/body':typeof body==='string'?body:JSON.stringify(body)})},authentication:"@parameters('$authentication')"},runAfter:after(previous)};
}
function pad(command,payload,previous) {
  return {type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_uiflow',connectionName:'shared_uiflow',operationId:'RunUIFlow_V2'},parameters:{uiFlowId:cfg.desktopFlowId,runMode:cfg.desktopRunMode,'item/Command':command,'item/PayloadBase64':payload},authentication:"@parameters('$authentication')"},runAfter:after(previous)};
}
function definition(trigger,actions) {
  return {$schema:'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',contentVersion:'1.0.0.0',parameters:{$authentication:{defaultValue:{},type:'SecureObject'},$connections:{defaultValue:{},type:'Object'}},triggers:trigger,actions,outputs:{}};
}
const manual={manual:{type:'Request',kind:'Button',inputs:{schema:{type:'object',properties:{},required:[]}},runtimeConfiguration:{concurrency:{runs:1}}}};
const prov={};
let previous;
for(const [title,template] of [[list,100],[library,101]]){
  const suffix=template===100?'Lista':'Biblioteca';
  const find=`Localizar_${suffix}`,ensure=`Garantir_${suffix}`;
  prov[find]=sp('GET',`_api/web/lists?$select=Id,Title&$filter=Title eq '${title}'`,undefined,previous);
  prov[ensure]={type:'If',expression:{equals:[`@length(body('${find}')?['value'])`,0]},actions:{[`Criar_${suffix}`]:sp('POST','_api/web/lists',{Title:title,BaseTemplate:template,Description:'Documentos fiscais SEFAZ da Energetica. Controle por chave, valores e XML original.',EnableVersioning:true})},else:{actions:{}},runAfter:after(find)};
  previous=ensure;
}
prov.Renomear_fornecedor=sp('POST',`${listApi}/fields/getbyinternalnameortitle('Title')`,{Title:'FORNECEDOR',Required:false},previous,{'X-HTTP-Method':'MERGE','IF-MATCH':'*'});
previous='Renomear_fornecedor';
const fields=[...textNames.map(name=>({name,type:'Text'})),...moneyNames.map(name=>({name,type:'Currency'})),...dateNames.map(name=>({name,type:'DateTime'})),...noteNames.map(name=>({name,type:'Note'})),...linkNames.map(name=>({name,type:'URL'}))];
for(const field of fields){
  const find=`Localizar_${field.name}`,ensure=`Garantir_${field.name}`;
  prov[find]=sp('GET',`${listApi}/fields?$select=InternalName,TypeAsString&$filter=InternalName eq '${field.name}'`,undefined,previous);
  const attrs=[`Type="${field.type}"`,`Name="${field.name}"`,`StaticName="${field.name}"`,`DisplayName="${field.name}"`];
  if(field.name==='CHAVE_ACESSO')attrs.push('Indexed="TRUE"','EnforceUniqueValues="TRUE"','Required="TRUE"','MaxLength="64"');
  if(['CNPJ_FORNECEDOR','CNPJ_DESTINATARIO','STATUS_IMPORTACAO','DATA_EMISSAO'].includes(field.name))attrs.push('Indexed="TRUE"');
  if(field.type==='Currency')attrs.push('Decimals="2"','LCID="1046"');
  if(field.type==='DateTime')attrs.push('Format="DateTime"');
  if(field.type==='Note')attrs.push('RichText="FALSE"','NumLines="6"');
  prov[ensure]={type:'If',expression:{equals:[`@length(body('${find}')?['value'])`,0]},actions:{[`Criar_${field.name}`]:sp('POST',`${listApi}/fields/createfieldasxml`,{parameters:{SchemaXml:`<Field ${attrs.join(' ')} />`,Options:8}})},else:{actions:{}},runAfter:after(find)};
  previous=ensure;
}
prov.Atualizar_chave_unica=sp('POST',`${listApi}/fields/getbyinternalnameortitle('CHAVE_ACESSO')`,{MaxLength:64,Indexed:true,EnforceUniqueValues:true,Required:true},previous,{'X-HTTP-Method':'MERGE','IF-MATCH':'*'});
prov.Verificar_chave_unica=sp('GET',`${listApi}/fields/getbyinternalnameortitle('CHAVE_ACESSO')?$select=InternalName,TypeAsString,MaxLength,Indexed,EnforceUniqueValues,Required`,undefined,'Atualizar_chave_unica');
prov.Conferir_chave_unica={type:'ParseJson',inputs:{content:"@body('Verificar_chave_unica')",schema:{type:'object',required:['InternalName','TypeAsString','MaxLength','Indexed','EnforceUniqueValues','Required'],properties:{
  InternalName:{type:'string',enum:['CHAVE_ACESSO']},TypeAsString:{type:'string',enum:['Text']},MaxLength:{type:'integer',enum:[64]},
  Indexed:{type:'boolean',enum:[true]},EnforceUniqueValues:{type:'boolean',enum:[true]},Required:{type:'boolean',enum:[true]},
}}},runAfter:after('Verificar_chave_unica')};
prov.Habilitar_anexos=sp('POST',listApi,{EnableAttachments:true},'Conferir_chave_unica',{'X-HTTP-Method':'MERGE','IF-MATCH':'*'});
prov.Verificar_anexos=sp('GET',`${listApi}?$select=Id,Title,EnableAttachments`,undefined,'Habilitar_anexos');
prov.Verificar_campos=sp('GET',`${listApi}/fields?$select=InternalName,TypeAsString,Indexed,EnforceUniqueValues,Required`,undefined,'Verificar_anexos');
prov.Verificar_biblioteca=sp('GET',`_api/web/lists/getbytitle('${library}')?$select=Title,RootFolder/ServerRelativeUrl&$expand=RootFolder`,undefined,'Verificar_campos');
let verifyAfter='Verificar_biblioteca';
for(const name of noteNames){
  const action=`Verificar_${name}`;
  prov[action]=sp('GET',`${listApi}/fields/getbyinternalnameortitle('${name}')?$select=InternalName,TypeAsString,RichText`,undefined,verifyAfter);
  verifyAfter=action;
}

// Resposta dinamica PAD: as propriedades de entrada/saida devem ser selecionadas no designer
// uma vez para vincular o schema da maquina. Nao e um pacote Solution exportado do tenant.
const sync={};
sync.Coletar_desktop=pad('Collect','e30=');
sync.Lote={type:'Compose',inputs:"@json(body('Coletar_desktop')?['ResultJson'])",runAfter:after('Coletar_desktop')};
const process={};
process.Gravar_XML=sp('POST',`@concat('_api/web/GetFolderByServerRelativeUrl(''${cfg.libraryPath}'')/Files/add(url=''', items('Documentos')?['fileName'], ''',overwrite=true)')`,"@base64ToBinary(items('Documentos')?['xmlBase64'])",undefined,{'Content-Type':'application/xml'});
process.Localizar_nota=sp('GET',`@concat(${wdlString(listApi+"/items?$select=*&$filter=CHAVE_ACESSO eq '")}, items('Documentos')?['key'], ${wdlString("'&$top=1")})`,undefined,'Gravar_XML',{Accept:'application/json;odata=verbose'});
process.Existente={type:'Compose',inputs:"@if(empty(body('Localizar_nota')?['d']?['results']), json('{}'), first(body('Localizar_nota')?['d']?['results']))",runAfter:after('Localizar_nota')};
process.Novos_campos={type:'Compose',inputs:"@items('Documentos')?['fields']",runAfter:after('Existente')};
const old=n=>`outputs('Existente')?['${n}']`;
const inc=n=>`outputs('Novos_campos')?['${n}']`;
const protect=`and(equals(${old('STATUS_IMPORTACAO')},'XML_COMPLETO'),not(equals(${inc('STATUS_IMPORTACAO')},'XML_COMPLETO')))`;
// Uniao com o registro antigo preserva campos ausentes sem transmitir metadados readonly do GET.
const merge={};
for(const name of allFields){
  if(linkNames.includes(name))continue;
  let expr=`coalesce(${inc(name)}, ${old(name)})`;
  if(!['SITUACAO','ULTIMO_NSU','TIPO_EVENTO','DATA_EVENTO','PROTOCOLO_EVENTO','SEQUENCIA_EVENTO','STATUS_EVENTO'].includes(name))expr=`if(${protect}, ${old(name)}, ${expr})`;
  if(name==='SITUACAO')expr=`if(or(equals(${old(name)},'CANCELADA'),equals(${old(name)},'SUBSTITUIDA')),${old(name)},${expr})`;
  if(name==='ULTIMO_NSU')expr=`if(greater(int(coalesce(${old(name)},'0')),int(coalesce(${inc(name)},'0'))),${old(name)},${expr})`;
  if(name==='STATUS_DANFE')expr=`if(equals(${old(name)},'DISPONIVEL'),'DISPONIVEL',${expr})`;
  if(retentionNames.includes(name))expr=`if(equals(${inc('STATUS_IMPORTACAO')},'XML_COMPLETO'),${inc(name)},${old(name)})`;
  merge[name]=`@${expr}`;
}
const fileUrl=`concat('${new URL(site).origin}${cfg.libraryPath}/',items('Documentos')?['fileName'])`;
const oldLink=name=>`if(empty(${old(name)}),null,setProperty(setProperty(json('{}'),'Url',${old(name)}?['Url']),'Description',coalesce(${old(name)}?['Description'],'')))`;
merge.ULTIMO_DOCUMENTO_URL={Url:`@${fileUrl}`,Description:'Ultimo documento XML recebido'};
merge.XML_URL=`@if(${isFullDocument("items('Documentos')?['kind']")},setProperty(setProperty(json('{}'),'Url',${fileUrl}),'Description','XML completo do documento fiscal'),${oldLink('XML_URL')})`;
merge.DANFE_URL=`@${oldLink('DANFE_URL')}`;
process.Campos_finais={type:'Compose',inputs:merge,runAfter:after('Novos_campos')};
process.Criar_ou_atualizar={type:'If',expression:{equals:["@empty(body('Localizar_nota')?['d']?['results'])",true]},actions:{Criar_nota:sp('POST',`${listApi}/items`,"@string(outputs('Campos_finais'))")},else:{actions:{Atualizar_nota:sp('POST',`@concat(${wdlString(listApi+'/items(')},string(outputs('Existente')?['Id']),')')`,"@string(outputs('Campos_finais'))",undefined,{'X-HTTP-Method':'MERGE','IF-MATCH':"@outputs('Existente')?['__metadata']?['etag']"})}},runAfter:after('Campos_finais')};
addDanfeActions(process,cfg);
// Se uma escrita externa conflitar com ETag, falha sem ack; o replay rele o registro atualizado.
sync.Documentos={type:'Foreach',foreach:"@outputs('Lote')?['documents']",actions:process,runtimeConfiguration:{concurrency:{repetitions:1}},runAfter:after('Lote')};
sync.Confirmar_lote={type:'If',expression:{greater:["@length(outputs('Lote')?['documents'])",0]},actions:{
  Ids_processados:{type:'Select',inputs:{from:"@outputs('Lote')?['documents']",select:"@item()?['id']"},runAfter:{}},
  Confirmar_desktop:pad('Acknowledge',"@base64(string(setProperty(json('{}'),'ids',body('Ids_processados'))))",'Ids_processados'),
},else:{actions:{}},runAfter:after('Documentos')};
sync.Continuar_coleta={type:'SetVariable',inputs:{name:'ContinuarColeta',value:"@greater(length(outputs('Lote')?['documents']),0)"},runAfter:after('Confirmar_lote')};
const scheduledActions={
  Inicializar_coleta:{type:'InitializeVariable',inputs:{variables:[{name:'ContinuarColeta',type:'boolean',value:true}]},runAfter:{}},
  Janela_de_coleta:{type:'Until',expression:"@equals(variables('ContinuarColeta'),false)",limit:{count:200,timeout:'PT2H'},actions:sync,runAfter:after('Inicializar_coleta')},
  Conferir_limite:{type:'If',expression:{equals:["@variables('ContinuarColeta')",true]},actions:{Limite_atingido:{type:'Terminate',inputs:{runStatus:'Failed',runError:{code:'LIMITE_COLETA',message:'Limite de lotes/tempo atingido; documentos restantes preservados para o proximo horario.'}},runAfter:{}}},else:{actions:{}},runAfter:after('Janela_de_coleta')},
};
const schedule={Recorrencia:{type:'Recurrence',recurrence:{frequency:'Day',interval:1,timeZone:cfg.scheduleTimeZone,schedule:{hours:cfg.scheduleHours,minutes:cfg.scheduleMinutes}},runtimeConfiguration:{concurrency:{runs:1}}}};
const out=path.join(root,'powerautomate');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'01-Provisionar-SharePoint.definition.json'),JSON.stringify(definition(manual,prov),null,2)+'\n');
fs.writeFileSync(path.join(out,'02-Sincronizar-NFe.definition.json'),JSON.stringify(definition(schedule,scheduledActions),null,2)+'\n');
fs.writeFileSync(path.join(out,'schema-sharepoint.json'),JSON.stringify({siteUrl:site,listTitle:list,libraryTitle:library,fields:[{name:'Title',displayName:'FORNECEDOR',type:'Text'},...fields]},null,2)+'\n');
console.log(`Gerados dois fluxos fonte e schema com ${fields.length+1} campos. Definicoes nao publicadas.`);
