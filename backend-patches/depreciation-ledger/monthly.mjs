import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const ORDERS='dfffa843-823f-4da3-939b-aaafb5297893';
export const FINANCIAL='40d7ef08-594a-4835-85d7-036eb1a098e0';
export const HISTORY='f0f13292-f28c-4c09-8060-4d4af4664730';
export const KEY='DEPRECIACAOCHAVE';
const after=(name,status=['Succeeded'])=>({[name]:status});
const compose=(inputs,name)=>({type:'Compose',inputs,runAfter:name?after(name):{}});
const condition=(expression,actions,name,otherwise={})=>({type:'If',expression,actions,else:{actions:otherwise},runAfter:name?after(name):{}});
const init=(name,type,value,previous)=>({type:'InitializeVariable',inputs:{variables:[{name,type,value}]},runAfter:after(previous)});
const amount="float(formatNumber(div(mul(float(replace(string(coalesce(item()?['OData__x0025_DEPRECIACAO'], '0')), ',', '.')), float(replace(replace(string(coalesce(item()?['VALORRESIDUAL'], '0')), '.', ''), ',', '.'))), 100), '0.00', 'en-US'))";
const loopAmount=amount.replaceAll('item()',"items('Apply_to_each')");

export function buildMonthly(definition,{startTime}={}){
 const source=definition?.actions?.Apply_to_each?.actions;
 if(source?.Create_item?.inputs?.parameters?.table!==FINANCIAL||source?.Create_depreciation_record?.inputs?.parameters?.table!==HISTORY)throw Error('Unexpected financial/history source');
 if(!/^\d{4}-\d{2}-01T07:00:00$/.test(startTime||''))throw Error('Monthly start must be first day 07:00');
 const d=structuredClone(definition),a=d.actions,l=a.Apply_to_each.actions;
 const template=structuredClone(l.Create_item.inputs);
 const sp=(operationId,parameters,previous)=>({type:'OpenApiConnection',inputs:{host:{...template.host,operationId},authentication:template.authentication,parameters:{dataset:template.parameters.dataset,...parameters},...(operationId==='PostItem'?{retryPolicy:{type:'none'}}:{})},runAfter:previous?after(previous):{}});
 const get=(table,filter,previous)=>({...sp('GetItems',{table,$filter:filter,$top:5000},previous),runtimeConfiguration:{paginationPolicy:{minimumItemCount:5000}}});
 d.triggers={Recurrence:{type:'Recurrence',recurrence:{frequency:'Month',interval:1,timeZone:'E. South America Standard Time',startTime},conditions:[{expression:"@equals(formatDateTime(convertTimeZone(utcNow(), 'UTC', 'E. South America Standard Time'), 'dd'), '01')"}],runtimeConfiguration:{concurrency:{runs:1}}}};
 a.Month_key=compose("@formatDateTime(convertTimeZone(utcNow(), 'UTC', 'E. South America Standard Time'), 'yyyy-MM')");
 a.Month_date=compose("@concat(outputs('Month_key'), '-01T03:00:00Z')",'Month_key');
 a.Next_month=compose("@addToTime(outputs('Month_date'), 1, 'Month')",'Month_date');
 a.Get_items.runAfter=after('Next_month');
 a.Get_items.inputs.parameters.$filter="DEPRECIAR eq 'SIM' and DATADEPRECIA_x00c7__x00c3_O le '@{outputs('Month_date')}'";
 a.Get_items.inputs.parameters.$top=5000;
 a.Get_items.runtimeConfiguration={paginationPolicy:{minimumItemCount:5000}};
 a.Verify_assets_complete=condition("@less(length(body('Get_items')?['value']), 5000)",{},'Get_items',{
  Reject_truncated_assets:{type:'Terminate',inputs:{runStatus:'Failed',runError:{code:'IncompleteAssetCollection',message:'Asset collection reached tenant page limit; no depreciation was created.'}}}
 });
 a.Eligible_assets={type:'Query',inputs:{from:"@body('Get_items')?['value']",where:`@greater(${amount}, 0)`},runAfter:after('Verify_assets_complete')};
 a.Init_planned=init('PlannedTotal','float',0,'Eligible_assets');
 a.Sum_planned={type:'Foreach',foreach:"@body('Eligible_assets')",runAfter:after('Init_planned'),runtimeConfiguration:{concurrency:{repetitions:1}},actions:{Add_planned:{type:'IncrementVariable',inputs:{name:'PlannedTotal',value:`@${amount}`}}}};
 a.Select_branches={type:'Select',inputs:{from:"@body('Eligible_assets')",select:{branch:"@coalesce(item()?['FILIAL'], '')"}},runAfter:after('Sum_planned')};
 a.Planned_branch=compose("@if(greater(length(union(body('Select_branches'), body('Select_branches'))), 1), 'DIVERSAS', coalesce(first(union(body('Select_branches'), body('Select_branches')))?['branch'], ''))",'Select_branches');
 // first([]) is null in WDL; prevent evaluating branch selection for an empty month.
 a.Planned_branch.inputs="@if(empty(body('Select_branches')), '', if(greater(length(union(body('Select_branches'), body('Select_branches'))), 1), 'DIVERSAS', first(body('Select_branches'))?['branch']))";
 a.Get_monthly_order=get(ORDERS,"DEPRECIACAOCHAVE eq '@{outputs('Month_key')}'",'Planned_branch');
 a.Init_monthly_order=init('MonthlyOrderId','integer',"@int(coalesce(first(body('Get_monthly_order')?['value'])?['ID'], 0))",'Get_monthly_order');
 a.Condition_2=condition("@greater(length(body('Eligible_assets')), 0)",{
  Ensure_order:condition("@equals(variables('MonthlyOrderId'), 0)",{
   Create_monthly_order:sp('PostItem',{table:ORDERS,'item/Title':"@outputs('Planned_branch')",'item/FILIAL':"@outputs('Planned_branch')",'item/FORNECEDOR':'ENERGÉTICA','item/FORMAPGTO':'DEPRECIAÇÃO E AMORTIZAÇÃO','item/STATUS':'PENDENTE AUDITORIA','item/NOTAFISCAL':'PENDENTE','item/OBSFISCAL':'DEPRECIAÇÃO E AMORTIZAÇÃO','item/DATAPEDIDO':"@outputs('Month_date')",'item/VALORTOTAL':"@formatNumber(variables('PlannedTotal'), '0.00', 'pt-BR')",'item/DEPRECIACAOCHAVE':"@outputs('Month_key')"}),
   Set_monthly_order:{type:'SetVariable',inputs:{name:'MonthlyOrderId',value:"@int(outputs('Create_monthly_order')?['body/ID'])"},runAfter:after('Create_monthly_order')}
  })
 },'Init_monthly_order');
 delete a.Initialize_variable_4;delete a.Initialize_variable_5;
 a.Apply_to_each.foreach="@body('Eligible_assets')";
 a.Apply_to_each.runtimeConfiguration={concurrency:{repetitions:1}};
 l.Get_items_1=get(FINANCIAL,"DEPRECIACAOCHAVE eq '@{outputs('Month_key')}|@{items('Apply_to_each')?['ID']}'");
 l.Compose.inputs=`@${loopAmount}`;
 l.Compose_2.inputs="@outputs('Next_month')";
 const create=structuredClone(l.Create_item);delete create.metadata;create.runAfter={};create.inputs.retryPolicy={type:'none'};
 Object.assign(create.inputs.parameters,{'item/AGRUPAR':"@string(variables('MonthlyOrderId'))",'item/field_2':"@outputs('Month_date')",'item/field_3':"@outputs('Month_date')",'item/field_4':"@outputs('Month_date')",'item/DEPRECIACAOCHAVE':"@concat(outputs('Month_key'), '|', string(items('Apply_to_each')?['ID']))"});
 l.Ensure_financial=condition("@empty(body('Get_items_1')?['value'])",{Create_new_financial:create},'Compose_2');
 l.Lookup_financial=get(FINANCIAL,l.Get_items_1.inputs.parameters.$filter,'Ensure_financial');
 l.Create_item=sp('GetItem',{table:FINANCIAL,id:"@int(first(body('Lookup_financial')?['value'])?['ID'])"},'Lookup_financial');
 l.Ensure_financial_link=condition("@not(equals(string(outputs('Create_item')?['body/AGRUPAR']), string(variables('MonthlyOrderId'))))",{
  Link_existing_financial:sp('PatchItem',{table:FINANCIAL,id:"@int(outputs('Create_item')?['body/ID'])",'item/AGRUPAR':"@string(variables('MonthlyOrderId'))"})
 },'Create_item');
 l.Residual_after_financial=compose("@float(formatNumber(sub(float(replace(replace(string(items('Apply_to_each')?['VALORRESIDUAL']), '.', ''), ',', '.')), float(outputs('Create_item')?['body/field_9'])), '0.00', 'en-US'))",'Ensure_financial_link');
 l.Compose_4.runAfter=after('Residual_after_financial');
 l.Compose_4.inputs.DATA="@outputs('Month_date')";
 l.Compose_4.inputs['VALOR UNITÁRIO']="@outputs('Create_item')?['body/field_9']";
 const history=structuredClone(l.Create_depreciation_record);delete history.metadata;history.runAfter={};
 Object.assign(history.inputs.parameters,{'item/DATA_x0020_DE_x0020_DEPRECIA_x00':"@outputs('Month_date')",'item/VALOR_x0020_DEPRECIA_x00c7__x00c':"@float(outputs('Create_item')?['body/field_9'])",'item/VALOR_x0020_RESIDUAL':"@outputs('Residual_after_financial')",'item/IDPEDIDO':"@variables('MonthlyOrderId')"});
 l.Get_existing_history=get(HISTORY,"IDLANCAMENTO eq @{outputs('Create_item')?['body/ID']}",'Compose_5');
 l.Create_depreciation_record=condition("@empty(body('Get_existing_history')?['value'])",{Create_history:history},'Get_existing_history');
 l.Update_item.inputs.parameters['item/VALORRESIDUAL']="@formatNumber(outputs('Residual_after_financial'), '0.00', 'pt-BR')";
 a.Get_linked_financial=get(FINANCIAL,"AGRUPAR eq '@{variables('MonthlyOrderId')}'",'Apply_to_each');
 a.Get_linked_financial.runAfter=after('Apply_to_each',['Succeeded','Failed','TimedOut']);
 a.Verify_linked_complete=condition("@less(length(body('Get_linked_financial')?['value']), 5000)",{},'Get_linked_financial',{
  Reject_truncated_financial:{type:'Terminate',inputs:{runStatus:'Failed',runError:{code:'IncompleteFinancialCollection',message:'Monthly financial collection reached tenant page limit; total was not overwritten.'}}}
 });
 a.Reset_total={type:'SetVariable',inputs:{name:'total',value:0},runAfter:after('Verify_linked_complete')};
 a.Reset_report={type:'SetVariable',inputs:{name:'NOVOHTML',value:"@createArray(outputs('Compose_7'))"},runAfter:after('Reset_total')};
 a.Sum_linked={type:'Foreach',foreach:"@body('Get_linked_financial')?['value']",runAfter:after('Reset_report'),runtimeConfiguration:{concurrency:{repetitions:1}},actions:{
  Add_linked:{type:'IncrementVariable',inputs:{name:'total',value:"@mul(float(item()?['field_8']), float(item()?['field_9']))"}},
  Linked_report_data:compose({FILIAL:"@item()?['Title']",DATA:"@outputs('Month_date')",ETAPA:"@item()?['field_6']",PRODUTO:"@item()?['field_7']",QUANTIDADE:"@string(item()?['field_8'])",'VALOR UNITÁRIO':"@item()?['field_9']",'TIPO DESPESA':"@item()?['TIPODESPESA']"}),
  Linked_report_row:compose(l.Compose_5.inputs.replaceAll("outputs('Compose_4')","outputs('Linked_report_data')"),'Linked_report_data'),
  Append_linked_report:{type:'AppendToArrayVariable',inputs:{name:'NOVOHTML',value:"@outputs('Linked_report_row')"},runAfter:after('Linked_report_row')}
 }};
 a.Select_actual_branches={type:'Select',inputs:{from:"@body('Get_linked_financial')?['value']",select:{branch:"@coalesce(item()?['Title'], '')"}},runAfter:after('Sum_linked')};
 const branch="@if(greater(length(union(body('Select_actual_branches'), body('Select_actual_branches'))), 1), 'DIVERSAS', first(body('Select_actual_branches'))?['branch'])";
 a.Finalize_order=condition("@greater(length(body('Get_linked_financial')?['value']), 0)",{
  Update_monthly_order:sp('PatchItem',{table:ORDERS,id:"@variables('MonthlyOrderId')",'item/Title':branch,'item/FILIAL':branch,'item/VALORTOTAL':"@formatNumber(variables('total'), '0.00', 'pt-BR')"})
 },'Select_actual_branches',{
  Has_empty_order:condition("@greater(variables('MonthlyOrderId'), 0)",{
   Check_empty_order_history:get(HISTORY,"IDPEDIDO eq @{variables('MonthlyOrderId')}"),
   Inspect_empty_order:sp('GetItem',{table:ORDERS,id:"@variables('MonthlyOrderId')"},'Check_empty_order_history'),
   Recycle_if_unreferenced:condition("@and(empty(body('Check_empty_order_history')?['value']), equals(outputs('Inspect_empty_order')?['body/Attachments'], false), equals(outputs('Inspect_empty_order')?['body/DEPRECIACAOCHAVE'], outputs('Month_key')))",{
    Delete_empty_monthly:sp('DeleteItem',{table:ORDERS,id:"@variables('MonthlyOrderId')"})
   },'Inspect_empty_order')
  })
 });
 a.Condition_1.runAfter=after('Finalize_order');
 return d;
}

export function planRepair(orders,launches,history){
 const result={recycle:[],updates:[],preservedHistoryOnly:[]};
 for(const order of orders.filter(o=>o.FORMAPGTO==='DEPRECIAÇÃO E AMORTIZAÇÃO')){
  const linked=launches.filter(l=>String(l.AGRUPAR??'').trim()===String(order.Id));
  if(!linked.length){if(history.some(h=>Number(h.IDPEDIDO)===Number(order.Id)))result.preservedHistoryOnly.push(order.Id);else result.recycle.push(order.Id);continue;}
  const branches=[...new Set(linked.map(l=>String(l.Title??'').trim()))];
  const total=linked.reduce((sum,l)=>{const n=Number(l.field_8)*Number(l.field_9);if(!Number.isFinite(n)||l.field_9==null||l.field_8==null)throw Error('Invalid financial amount');return sum+n;},0);
  const branch=branches.length>1?'DIVERSAS':branches[0];
  const body={VALORTOTAL:(Math.round((total+Number.EPSILON)*100)/100).toFixed(2).replace('.',','),FILIAL:branch,Title:branch};
  if(Object.entries(body).some(([k,v])=>order[k]!==v))result.updates.push({id:order.Id,body,linked:linked.map(l=>l.Id)});
 }
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='repair'){
  const [orders,launches,history,out]=process.argv.slice(3);
  const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
  writeFileSync(out,JSON.stringify(planRepair(read(orders),read(launches),read(history)),null,2)+'\n');
 }else{
 const [source,out,startTime]=process.argv.slice(2);
 const d=JSON.parse(readFileSync(source,'utf8').replace(/^\uFEFF/,''));
 writeFileSync(out,JSON.stringify(buildMonthly(d.properties?.definition??d,{startTime}),null,2)+'\n');
 }
}
