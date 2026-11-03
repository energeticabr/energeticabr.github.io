import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const fixtures=[
 {ID:990001,ITEM:'TESTE A',FILIAL:'FILIAL A',FORNECEDOR:'FORNECEDOR A',OData__x0025_DEPRECIACAO:'3',VALORRESIDUAL:'1000,00'},
 {ID:990002,ITEM:'TESTE ATRASADO',FILIAL:'FILIAL B',FORNECEDOR:'FORNECEDOR B',OData__x0025_DEPRECIACAO:'2',VALORRESIDUAL:'4.338,02'},
 {ID:990003,ITEM:'TESTE ZERO',FILIAL:'FILIAL C',OData__x0025_DEPRECIACAO:'3',VALORRESIDUAL:'0,00'},
 {ID:990004,ITEM:'TESTE RETOMADA',FILIAL:'FILIAL A',FORNECEDOR:'FORNECEDOR C',OData__x0025_DEPRECIACAO:'3',VALORRESIDUAL:'100,00',EXISTING:true},
];
for(const f of fixtures)f.DATADEPRECIA_x00c7__x00c3_O=f.ID===990002?'2026-03-01T03:00:00Z':'2026-11-01T03:00:00Z';
const after=n=>({[n]:['Succeeded']});
function packet(parameters,id=900001){return {body:{...Object.fromEntries(Object.entries(parameters).filter(([k])=>k.startsWith('item/')).map(([k,v])=>[k.slice(5),v])),ID:id}};}
export function buildMonthlyProbe(definition,{empty=false,completed=false}={}){
 const p=structuredClone(definition),connectors=new Set();
 const scan=actions=>{for(const [name,a]of Object.entries(actions||{})){if(a.type==='OpenApiConnection')connectors.add(name);scan(a.actions);scan(a.else?.actions);}};scan(p.actions);
 const walk=actions=>{for(const [name,a]of Object.entries(actions||{})){
  if(a.type==='OpenApiConnection'){
   const parameters=a.inputs.parameters;
   let inputs;
   if(name==='Get_items')inputs={body:{value:empty||completed?[]:fixtures}};
   else if(name==='Get_monthly_order')inputs={body:{value:completed?[{ID:900001}]:[]}};
   else if(name==='Get_items_1')inputs={body:{value:"@if(equals(items('Apply_to_each')?['EXISTING'], true), createArray(json('{\"ID\":1990004}')), json('[]'))"}};
   else if(name==='Lookup_financial')inputs={body:{value:[{ID:"@add(int(items('Apply_to_each')?['ID']), 1000000)"}]}};
   else if(name==='Create_item')inputs={body:{ID:"@add(int(items('Apply_to_each')?['ID']), 1000000)",Title:"@items('Apply_to_each')?['FILIAL']",AGRUPAR:"@string(variables('MonthlyOrderId'))",field_6:'DEPRECIAÇÃO E AMORTIZAÇÃO',field_7:"@items('Apply_to_each')?['ITEM']",TIPODESPESA:'EQUIPAMENTOS / MÁQUINAS',field_8:1,field_9:"@if(equals(items('Apply_to_each')?['EXISTING'], true), 2.5, outputs('Compose'))"}};
   else if(name==='Get_existing_history')inputs={body:{value:"@if(equals(items('Apply_to_each')?['EXISTING'], true), createArray(json('{\"ID\":2990004}')), json('[]'))"}};
   else if(name==='Get_linked_financial')inputs={body:{value:"@variables('ProbeFinancial')"}};
   else if(name==='Check_empty_order_history')inputs={body:{value:[]}};
   else inputs=packet(parameters);
   actions[name]={type:'Compose',inputs,runAfter:a.runAfter||{}};
   if(!['GetItems','GetItem'].includes(a.inputs.host.operationId))actions['Capture_'+name]={type:'AppendToArrayVariable',inputs:{name:'ProbeWrites',value:{action:name,parameters}},runAfter:after(name)};
   if(name==='Create_item'){
    actions.Capture_financial={type:'AppendToArrayVariable',inputs:{name:'ProbeFinancial',value:"@outputs('Create_item')?['body']"},runAfter:after(name)};
    actions.Ensure_financial_link.runAfter=after('Capture_financial');
   }
  }else{walk(a.actions);walk(a.else?.actions);}
 }};walk(p.actions);
 // Compose mocks expose the same output envelope. body() must select that envelope.
 let raw=JSON.stringify(p);
 for(const n of connectors)raw=raw.replaceAll(`body('${n}')`,`outputs('${n}')?['body']`);
 const probe=JSON.parse(raw);
 probe.parameters={};probe.triggers={manual:{type:'Request',kind:'Button',inputs:{schema:{type:'object',properties:{}}}}};
 const seed=empty?[]:[{ID:1990005,Title:'FILIAL B',AGRUPAR:'900001',field_6:'DEPRECIAÇÃO E AMORTIZAÇÃO',field_7:'TESTE JÁ CONCLUÍDO',field_8:1,field_9:10,TIPODESPESA:'EQUIPAMENTOS / MÁQUINAS'}];
 if(completed)for(const [i,amount]of [[0,30],[1,86.76],[3,2.5]])seed.push({ID:1000000+fixtures[i].ID,Title:fixtures[i].FILIAL,AGRUPAR:'900001',field_6:'DEPRECIAÇÃO E AMORTIZAÇÃO',field_7:fixtures[i].ITEM,field_8:1,field_9:amount,TIPODESPESA:'EQUIPAMENTOS / MÁQUINAS'});
 probe.actions.Init_probe={type:'InitializeVariable',inputs:{variables:[{name:'ProbeWrites',type:'array',value:[]},{name:'ProbeFinancial',type:'array',value:seed}]},runAfter:{}};
 probe.actions.Month_key.runAfter=after('Init_probe');
 probe.actions.Month_key.inputs='2026-11';
 probe.actions.Receipt={type:'Compose',inputs:{writes:"@variables('ProbeWrites')",financial:"@variables('ProbeFinancial')",total:"@variables('total')",order:"@variables('MonthlyOrderId')",eligible:"@length(body('Eligible_assets'))"},runAfter:after('Condition_1')};
 assertReadOnly(probe);return probe;
}
export function assertReadOnly(d){
 const allowed=new Set(['Compose','Foreach','If','InitializeVariable','SetVariable','IncrementVariable','AppendToArrayVariable','Query','Select','Terminate']);
 const scan=as=>{for(const a of Object.values(as||{})){if(!allowed.has(a.type))throw Error('External action in probe: '+a.type);scan(a.actions);scan(a.else?.actions);}};
 scan(d.actions);return true;
}
export function verifyReceipt(r,{empty=false,completed=false}={}){
 if(empty){if(r.writes.length||r.financial.length||r.order!==0||r.total!==0)throw Error('Empty month created data');return;}
 if(r.eligible!==(completed?0:3)||r.financial.length!==4||Math.abs(r.total-129.26)>0.00001)throw Error('Totals/eligibility incorrect');
 const writes=name=>r.writes.filter(w=>w.action===name);
 if(writes('Create_monthly_order').length!==(completed?0:1)||writes('Create_new_financial').length!==(completed?0:2)||writes('Create_history').length!==(completed?0:2))throw Error('Duplicate creation/resumption failed');
 const order=writes('Update_monthly_order')[0]?.parameters;
 if(order?.['item/VALORTOTAL']!=='129,26'||order['item/FILIAL']!=='DIVERSAS')throw Error('Monthly aggregation failed');
 const pdf=writes('Create_file')[0]?.parameters.body;
 for(const expected of ['TESTE A','TESTE ATRASADO','TESTE RETOMADA','TESTE JÁ CONCLUÍDO','129,26'])if(!pdf?.includes(expected))throw Error('PDF snapshot incomplete: '+expected);
 if(!completed){const initial=writes('Create_monthly_order')[0].parameters;
 if(initial['item/VALORTOTAL']!=='119,76'||initial['item/FILIAL']!=='DIVERSAS')throw Error('Initial positive total failed');}
 for(const w of writes('Create_new_financial'))if(w.parameters['item/AGRUPAR']!==String(r.order)||w.parameters['item/field_3']!=='2026-11-01T03:00:00Z')throw Error('Financial grouping/competence incorrect');
 for(const w of writes('Update_item'))if(w.parameters['item/DATADEPRECIA_x00c7__x00c3_O']!=='2026-12-01T03:00:00.0000000Z')throw Error('Next month incorrect');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,source,dest]=process.argv.slice(2);
 const value=JSON.parse(readFileSync(source,'utf8').replace(/^\uFEFF/,''));
 if(['build','empty','completed'].includes(mode))writeFileSync(dest,JSON.stringify(buildMonthlyProbe(value,{empty:mode==='empty',completed:mode==='completed'}),null,2));
 else if(['verify','verify-empty','verify-completed'].includes(mode)){verifyReceipt(value,{empty:mode==='verify-empty',completed:mode==='verify-completed'});console.log('ACTUAL_WDL_VERIFIED '+mode);}
 else throw Error('Unknown probe mode');
}
