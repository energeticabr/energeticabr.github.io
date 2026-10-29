import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'config/energetica.json')));
const fields=['PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO'];
const names=['STATUS_RETENCOES',...fields];
const base=`_api/web/lists/getbytitle('${cfg.listTitle}')`;
const after=name=>name?{[name]:['Succeeded']}:{};
const sp=(method,uri,body,previous,headers={})=>({type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_sharepointonline',connectionName:'shared_sharepointonline',operationId:'HttpRequest'},parameters:{dataset:cfg.siteUrl,'parameters/method':method,'parameters/uri':uri,'parameters/headers':{Accept:'application/json;odata=verbose','Content-Type':'application/json;odata=nometadata',...headers},...(body===undefined?{}:{'parameters/body':typeof body==='string'?body:JSON.stringify(body)})},authentication:"@parameters('$authentication')"},runAfter:after(previous)});
const schema={type:'object',required:['source','updates'],properties:{source:{type:'string',enum:['SEFAZ_XML_ARCHIVE']},updates:{type:'array',maxItems:100,items:{type:'object',required:['key','fields'],properties:{key:{type:'string',minLength:44,maxLength:44},fields:{type:'object',required:names,properties:{STATUS_RETENCOES:{type:'string',enum:['RETENCAO_INFORMADA_XML','NAO_INFORMADA_XML']},...Object.fromEntries(fields.map(name=>[name,{type:['number','null']}]))}}}}}}};
const lookup="@concat('_api/web/lists/getbytitle(''"+cfg.listTitle+"'')/items?$select=Id,CHAVE_ACESSO&$filter=CHAVE_ACESSO eq ''',items('Atualizacoes')?['key'],'''&$top=2')";
const selected="first(body('Localizar_nota')?['d']?['results'])";
const updateFields=Object.fromEntries(names.map(name=>[name,`@items('Atualizacoes')?['fields']?['${name}']`]));
const doc={
  Localizar_nota:sp('GET',lookup),
  Conferir_unica:{type:'ParseJson',inputs:{content:"@length(body('Localizar_nota')?['d']?['results'])",schema:{type:'integer',enum:[1]}},runAfter:after('Localizar_nota')},
  Campos:{type:'Compose',inputs:updateFields,runAfter:after('Conferir_unica')},
  Atualizar:sp('POST',`@concat('${base.replaceAll("'","''")}/items(',string(${selected}?['Id']),')')`,"@string(outputs('Campos'))",'Campos',{'X-HTTP-Method':'MERGE','IF-MATCH':`@${selected}?['__metadata']?['etag']`}),
};
const flow={$schema:'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',contentVersion:'1.0.0.0',parameters:{$authentication:{defaultValue:{},type:'SecureObject'},$connections:{defaultValue:{},type:'Object'}},triggers:{manual:{type:'Request',kind:'Button',inputs:{schema},runtimeConfiguration:{concurrency:{runs:1},secureData:{properties:['outputs']}}}},actions:{
  Validar:{type:'ParseJson',inputs:{content:'@triggerBody()',schema},runAfter:{}},
  Atualizacoes:{type:'Foreach',foreach:"@body('Validar')?['updates']",actions:doc,runtimeConfiguration:{concurrency:{repetitions:1}},runAfter:after('Validar')},
  Revisao:sp('GET',`${base}/items?$select=Id,CHAVE_ACESSO,${names.join(',')}&$top=5000`,undefined,'Atualizacoes'),
  Confirmados:{type:'Select',inputs:{from:"@body('Validar')?['updates']",select:"@item()?['key']"},runAfter:after('Revisao')},
}};
fs.writeFileSync(path.join(root,'powerautomate/06-Atualizar-Retencoes.definition.json'),JSON.stringify(flow,null,2)+'\n');
console.log('Fonte de atualizacao restrita de retencoes gerada. Nenhuma nota criada ou enviada.');
