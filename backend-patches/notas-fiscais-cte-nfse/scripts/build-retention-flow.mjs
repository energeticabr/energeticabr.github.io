import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'config/energetica.json')));
const fields=['PIS_RETIDO','COFINS_RETIDA','CSLL_RETIDA','IRRF_RETIDO','INSS_RETIDO','ISS_RETIDO','CONTRIB_SOCIAIS_RETIDAS','TOTAL_RETIDO'];
const names=['STATUS_RETENCOES',...fields];
const base=`_api/web/lists/getbytitle('${cfg.listTitle}')`;
const after=name=>name?{[name]:['Succeeded']}:{};
const sp=(method,uri,body,previous,headers={})=>({type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_sharepointonline',connectionName:'shared_sharepointonline',operationId:'HttpRequest'},parameters:{dataset:cfg.siteUrl,'parameters/method':method,'parameters/uri':uri,'parameters/headers':{Accept:'application/json;odata=verbose','Content-Type':'application/json;odata=nometadata',...headers},...(body===undefined?{}:{'parameters/body':typeof body==='string'?body:JSON.stringify(body)})},authentication:"@parameters('$authentication')"},runAfter:after(previous)});
const schema={type:'object',required:['source','updates'],properties:{source:{type:'string',enum:['SEFAZ_XML_ARCHIVE']},updates:{type:'array',maxItems:100,items:{type:'object',required:['key','fields'],properties:{key:{type:'string',minLength:44,maxLength:50},fields:{type:'object',required:names,properties:{STATUS_RETENCOES:{type:'string',enum:['RETENCAO_INFORMADA_XML','NAO_INFORMADA_XML']},...Object.fromEntries(fields.map(name=>[name,{type:['number','null']}]))}}}}}}};
const lookup="@concat('_api/web/lists/getbytitle(''"+cfg.listTitle+"'')/items?$select=Id,CHAVE_ACESSO,TIPO_FISCAL,MODELO&$filter=CHAVE_ACESSO eq ''',items('Atualizacoes')?['key'],'''&$top=2')";
const selected="first(body('Localizar_nota')?['d']?['results'])";
const key="items('Atualizacoes')?['key']";
const only=(value,characters)=>`equals(${[...characters].reduce((s,c)=>`replace(${s},'${c}','')`,value)},'')`;
const isNfse=`equals(length(${key}),50)`;
const validKey=`or(and(${isNfse},${only(key,'0123456789')}),and(equals(length(${key}),44),equals(substring(${key},20,2),'55'),${only(`substring(${key},0,6)`,'0123456789')},${only(`substring(${key},6,12)`,'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ')},${only(`substring(${key},18,26)`,'0123456789')}))`;
const gate=(predicate,previous)=>({type:'ParseJson',inputs:{content:`@if(${predicate},json('{"valid":true}'),json('{}'))`,schema:{type:'object',required:['valid'],properties:{valid:{type:'boolean',enum:[true]}}}},runAfter:after(previous)});
const updateFields=Object.fromEntries(names.map(name=>[name,`@items('Atualizacoes')?['fields']?['${name}']`]));
const doc={
  Conferir_identidade:gate(validKey),
  Localizar_nota:sp('GET',lookup,undefined,'Conferir_identidade'),
  Conferir_unica:{type:'ParseJson',inputs:{content:"@length(body('Localizar_nota')?['d']?['results'])",schema:{type:'integer',enum:[1]}},runAfter:after('Localizar_nota')},
  Conferir_tipo:gate(`and(equals(${selected}?['CHAVE_ACESSO'],${key}),or(and(${isNfse},equals(${selected}?['TIPO_FISCAL'],'NFS-e')),and(equals(length(${key}),44),equals(string(${selected}?['MODELO']),'55'),or(empty(${selected}?['TIPO_FISCAL']),equals(${selected}?['TIPO_FISCAL'],'NF-e')))))`,'Conferir_unica'),
  Campos:{type:'Compose',inputs:updateFields,runAfter:after('Conferir_tipo')},
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
