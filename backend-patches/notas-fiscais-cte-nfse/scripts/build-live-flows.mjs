import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {addDanfeActions,danfeSchema,fiscalDocumentKinds} from './danfe-flow.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'config/energetica.json')));
const source=JSON.parse(fs.readFileSync(path.join(root,'powerautomate/02-Sincronizar-NFe.definition.json')));
const receiving=structuredClone(source);
receiving.triggers={manual:{type:'Request',kind:'Button',inputs:{
  schema:{type:'object',required:['source','companyCnpj','documents'],properties:{
    source:{type:'string',enum:['SEFAZ']},
    companyCnpj:{type:'string',enum:[cfg.companyCnpj]},
    documents:{type:'array',maxItems:10,items:{type:'object',required:['id','nsu','key','kind','fields','xmlBase64','fileName','sha256'],properties:{
      id:{type:'string',minLength:32,maxLength:36,pattern:'^[0-9]{15,19}-[0-9a-f]{16}$'},
      nsu:{type:'string',minLength:15,maxLength:19,pattern:'^[0-9]{15,19}$'},
      key:{type:'string',minLength:44,maxLength:50,pattern:'^(?:[0-9]{6}[A-Z0-9]{12}[0-9]{26}|[0-9]{50})$'},
      kind:{type:'string',enum:fiscalDocumentKinds},
      fields:{type:'object'},xmlBase64:{type:'string',maxLength:1500000},
      fileName:{type:'string',minLength:81,maxLength:91,pattern:'^(?:[0-9]{6}[A-Z0-9]{12}[0-9]{26}|[0-9]{50})-[0-9]{15,19}-[0-9a-f]{16}\\.xml$'},
      sha256:{type:'string',minLength:64,maxLength:64,pattern:'^[0-9a-f]{64}$'},
      danfe:danfeSchema,
    }}},
  }},
},runtimeConfiguration:{concurrency:{runs:1},secureData:{properties:['outputs']}}}};
// A ponte chama a API de gerenciamento autenticada pela sessao Microsoft existente.
// Nao e usado webhook anonimo/SAS nem endpoint HTTP publico de ingestao.
const documents=structuredClone(source.actions.Janela_de_coleta.actions.Documentos);
addDanfeActions(documents.actions,cfg);
// Creation evidence comes from the successful POST response, never the later
// lookup shared by both create and update paths. The sequential loop and final
// receipt ensure attachments/delivery also completed before IDs are published.
documents.actions.Confirmar_id_criado={type:'If',expression:{equals:["@empty(body('Localizar_nota')?['d']?['results'])",true]},actions:{
  Registrar_id_criado:{type:'AppendToArrayVariable',inputs:{name:'CreatedItemIds',value:"@int(body('Criar_nota')?['Id'])"},runAfter:{}},
},else:{actions:{}},runAfter:{Anexar_DANFE:['Succeeded']}};
documents.runAfter={Inicializar_ids_criados:['Succeeded']};
const batchSchema=structuredClone(receiving.triggers.manual.inputs.schema);
function removeTriggerPatterns(value){
  if(!value||typeof value!=='object')return;
  delete value.pattern;delete value.patternProperties;
  for(const child of Object.values(value))removeTriggerPatterns(child);
}
removeTriggerPatterns(receiving.triggers.manual.inputs.schema);
removeTriggerPatterns(batchSchema);
// O conector Flow nao aceita regex em schema. Conferir_identidade aplica a
// validacao lexical e os vinculos por WDL antes de qualquer escrita. A ponte
// verifica XML/hash/PDF antes do POST autenticado pelo proprietario do fluxo.
receiving.actions={
  Validar_lote:{type:'ParseJson',inputs:{content:'@triggerBody()',schema:batchSchema},runAfter:{}},
  Lote:{type:'Compose',inputs:"@body('Validar_lote')",runAfter:{Validar_lote:['Succeeded']}},
  Inicializar_ids_criados:{type:'InitializeVariable',inputs:{variables:[{name:'CreatedItemIds',type:'array',value:[]}]},runAfter:{Lote:['Succeeded']}},
  Documentos:documents,
  Ids_confirmados:{type:'Select',inputs:{from:"@triggerBody()?['documents']",select:"@item()?['id']"},runAfter:{Documentos:['Succeeded']}},
  Recibo:{type:'Compose',inputs:{source:'SEFAZ',acknowledgedIds:"@body('Ids_confirmados')",createdItemIds:"@variables('CreatedItemIds')"},runAfter:{Ids_confirmados:['Succeeded']}},
};
fs.writeFileSync(path.join(root,'powerautomate/03-Receber-NFe.definition.json'),JSON.stringify(receiving,null,2)+'\n');
const sp=(method,uri,body,previous)=>({type:'OpenApiConnection',inputs:{host:{apiId:'/providers/Microsoft.PowerApps/apis/shared_sharepointonline',connectionName:'shared_sharepointonline',operationId:'HttpRequest'},parameters:{dataset:cfg.queueSiteUrl,'parameters/method':method,'parameters/uri':uri,'parameters/headers':{Accept:'application/json;odata=nometadata','Content-Type':'application/json;odata=nometadata'},...(body===undefined?{}:{'parameters/body':typeof body==='string'?body:JSON.stringify(body)})},authentication:"@parameters('$authentication')"},runAfter:previous?{[previous]:['Succeeded']}: {}});
const qapi=`web/lists/getbytitle('${cfg.queueListTitle}')`;
const queue=structuredClone(source);
queue.triggers={manual:{type:'Request',kind:'Button',inputs:{schema:{type:'object',properties:{}}}}};
queue.actions={
  Localizar_fila:sp('GET',`_api/web/lists?$select=Id,Title&$filter=Title eq '${cfg.queueListTitle}'`),
  Garantir_fila:{type:'If',expression:{equals:["@length(body('Localizar_fila')?['value'])",0]},actions:{Criar_fila:sp('POST','_api/web/lists',{Title:cfg.queueListTitle,BaseTemplate:100,EnableAttachments:false,EnableVersioning:true,Description:'Solicitacoes de coleta direta SEFAZ. Apenas metadados de execucao.'})},else:{actions:{}},runAfter:{Localizar_fila:['Succeeded']}},
};
let previous='Garantir_fila';
for(const [name,type] of [['JOB_KEY','Text'],['STATUS','Text'],['REQUESTED_AT','DateTime'],['START_DATE','DateTime'],['NEXT_ATTEMPT_AT','DateTime'],['COMPLETED_AT','DateTime'],['LEASE_UNTIL','DateTime'],['ERROR_SUMMARY','Note'],['ATTEMPTS','Number']]){
  const find=`Localizar_${name}`,ensure=`Garantir_${name}`;
  queue.actions[find]=sp('GET',`_api/${qapi}/fields?$select=InternalName&$filter=InternalName eq '${name}'`,undefined,previous);
  let attrs=`Type="${type}" Name="${name}" StaticName="${name}" DisplayName="${name}"`;
  if(name==='JOB_KEY')attrs+=' Required="TRUE" Indexed="TRUE" EnforceUniqueValues="TRUE"';
  if(name==='STATUS')attrs+=' Indexed="TRUE"';
  if(type==='DateTime')attrs+=' Format="DateTime"';
  if(type==='Number')attrs+=' Decimals="0"';
  if(type==='Note')attrs+=' RichText="FALSE"';
  queue.actions[ensure]={type:'If',expression:{equals:[`@length(body('${find}')?['value'])`,0]},actions:{[`Criar_${name}`]:sp('POST',`_api/${qapi}/fields/createfieldasxml`,{parameters:{SchemaXml:`<Field ${attrs} />`,Options:8}})},else:{actions:{}},runAfter:{[find]:['Succeeded']}};
  previous=ensure;
}
queue.actions.Verificar_fila=sp('GET',`_api/${qapi}?$select=Id,Title,EnableVersioning,EnableAttachments`,undefined,previous);
fs.writeFileSync(path.join(root,'powerautomate/04-Provisionar-Fila.definition.json'),JSON.stringify(queue,null,2)+'\n');
const scheduler=structuredClone(source);
if(!/^\d{4}-\d{2}-\d{2}$/.test(cfg.minimumIssueDate??'')) throw new Error('minimumIssueDate deve usar yyyy-MM-dd');
scheduler.actions={
  Chave_job:{type:'Compose',inputs:"@concat('SEFAZ-',formatDateTime(convertTimeZone(utcNow(),'UTC','E. South America Standard Time'),'yyyy-MM-dd-HH'))",runAfter:{}},
  Localizar_job:sp('GET',`@concat('_api/${qapi.replaceAll("'","''")}/items?$select=Id&$filter=JOB_KEY eq ''',outputs('Chave_job'),'''&$top=1')`,undefined,'Chave_job'),
  Garantir_job:{type:'If',expression:{equals:["@length(body('Localizar_job')?['value'])",0]},actions:{
    Criar_job:sp('POST',`_api/${qapi}/items`,`@string(setProperty(setProperty(setProperty(setProperty(setProperty(json('{}'),'Title','Coleta direta SEFAZ - emissao desde ${cfg.minimumIssueDate}'),'JOB_KEY',outputs('Chave_job')),'STATUS','PENDING'),'REQUESTED_AT',utcNow()),'START_DATE','${cfg.minimumIssueDate}T00:00:00-03:00'))`),
  },else:{actions:{}},runAfter:{Localizar_job:['Succeeded']}},
};
fs.writeFileSync(path.join(root,'powerautomate/05-Agendar-Coleta.definition.json'),JSON.stringify(scheduler,null,2)+'\n');
console.log('Definicao de ingestao pela API autenticada e confirmacao apos persistencia gerada.');
