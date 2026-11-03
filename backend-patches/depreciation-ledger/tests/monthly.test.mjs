import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const live=JSON.parse(fs.readFileSync(new URL('./fixtures/monthly-before.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const moduleUrl=new URL('../monthly.mjs',import.meta.url);
async function build(){const {buildMonthly}=await import(moduleUrl);return buildMonthly(live,{startTime:'2026-12-01T07:00:00'});}
test('recurs monthly on the first at Sao Paulo 07:00, serial and guarded',async()=>{
 const d=await build(),t=d.triggers.Recurrence;
 assert.equal(t.recurrence.frequency,'Month');assert.equal(t.recurrence.startTime,'2026-12-01T07:00:00');
 assert.equal(t.recurrence.timeZone,'E. South America Standard Time');assert.equal(t.runtimeConfiguration.concurrency.runs,1);
 assert.match(t.conditions[0].expression,/01/);
});
test('all financial entries share the monthly order independent of supplier and branch',async()=>{
 const d=await build(),a=d.actions.Apply_to_each.actions;
 assert.equal(a.Ensure_financial.actions.Create_new_financial.inputs.parameters['item/AGRUPAR'],"@string(variables('MonthlyOrderId'))");
 assert.equal(d.actions.Condition_2.actions.Ensure_order.actions.Create_monthly_order.inputs.parameters['item/DEPRECIACAOCHAVE'],"@outputs('Month_key')");
 assert.ok(!JSON.stringify(d).includes('AgruparPorFilial'));
});
test('no order without positive eligible assets, initial and final totals serialized in pt-BR',async()=>{
 const d=await build();assert.match(JSON.stringify(d.actions.Eligible_assets),/greater/);
 assert.match(d.actions.Condition_2.actions.Ensure_order.actions.Create_monthly_order.inputs.parameters['item/VALORTOTAL'],/pt-BR/);
 assert.match(d.actions.Finalize_order.actions.Update_monthly_order.inputs.parameters['item/VALORTOTAL'],/pt-BR/);
 assert.match(d.actions.Finalize_order.actions.Update_monthly_order.inputs.parameters['item/FILIAL'],/DIVERSAS/);
});
test('overdue assets advance to the next current month and use current competence',async()=>{
 const a=(await build()).actions.Apply_to_each.actions;
 assert.equal(a.Compose_2.inputs,"@outputs('Next_month')");
 assert.equal(a.Ensure_financial.actions.Create_new_financial.inputs.parameters['item/field_3'],"@outputs('Month_date')");
});
test('financial and history creations are deduplicated and do not retry blind POSTs',async()=>{
 const a=(await build()).actions.Apply_to_each.actions;
 assert.match(a.Get_items_1.inputs.parameters.$filter,/DEPRECIACAOCHAVE/);
 assert.equal(a.Ensure_financial.actions.Create_new_financial.inputs.retryPolicy.type,'none');
 assert.match(a.Get_existing_history.inputs.parameters.$filter,/IDLANCAMENTO/);
 assert.equal(a.Create_depreciation_record.type,'If');
 assert.deepEqual(a.Update_item.runAfter,{Create_depreciation_record:['Succeeded']});
});
test('final total includes all linked records even after a partial failure',async()=>{
 const d=await build();assert.ok(d.actions.Get_linked_financial.runAfter.Apply_to_each.includes('Failed'));
 assert.match(d.actions.Get_linked_financial.inputs.parameters.$filter,/AGRUPAR/);
 assert.match(d.actions.Sum_linked.actions.Add_linked.inputs.value,/field_9/);
});
test('PDF rows and total use the same complete linked snapshot after retries',async()=>{
 const d=await build();
 assert.equal(d.actions.Reset_report.inputs.value,"@createArray(outputs('Compose_7'))");
 assert.equal(d.actions.Sum_linked.actions.Linked_report_data.inputs.PRODUTO,"@item()?['field_7']");
 assert.match(d.actions.Sum_linked.actions.Linked_report_row.inputs,/Linked_report_data/);
 assert.equal(d.actions.Sum_linked.actions.Append_linked_report.inputs.value,"@outputs('Linked_report_row')");
});
test('repair planner deletes only empty depreciation orders and preserves linked zero orders',async()=>{
 const {planRepair}=await import(moduleUrl);
 const orders=[{Id:1,FORMAPGTO:'DEPRECIAÇÃO E AMORTIZAÇÃO'},{Id:2,FORMAPGTO:'DEPRECIAÇÃO E AMORTIZAÇÃO'},{Id:3,FORMAPGTO:'PIX'},{Id:4,FORMAPGTO:'DEPRECIAÇÃO E AMORTIZAÇÃO'}];
 const p=planRepair(orders,[{Id:10,AGRUPAR:'2',field_8:1,field_9:10.005,Title:'A'},{Id:11,AGRUPAR:'2',field_8:1,field_9:20,Title:'B'}],[{IDPEDIDO:4}]);
 assert.deepEqual(p.recycle,[1]);assert.equal(p.updates[0].body.VALORTOTAL,'30,01');assert.equal(p.updates[0].body.FILIAL,'DIVERSAS');
 assert.deepEqual(p.preservedHistoryOnly,[4]);
});
test('repair planning is idempotent and rejects non-finite totals',async()=>{
 const {planRepair}=await import(moduleUrl);
 const o={Id:1,FORMAPGTO:'DEPRECIAÇÃO E AMORTIZAÇÃO',VALORTOTAL:'10,00',FILIAL:'A',Title:'A'};
 assert.equal(planRepair([o],[{AGRUPAR:'1',field_8:1,field_9:10,Title:'A'}],[]).updates.length,0);
 assert.throws(()=>planRepair([o],[{AGRUPAR:'1',field_8:1,field_9:'broken',Title:'A'}],[]),/amount/i);
});
