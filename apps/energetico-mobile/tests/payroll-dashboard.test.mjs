import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import * as model from '../src/chat/supplier-payroll-report-model.js';
import {createSupplierPayrollReportView} from '../src/ui/supplier-payroll-report-view.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const rows=[
 {id:'45',payrollId:'13',type:'SALÁRIO',date:'2026-10-08',launchId:'3534',unitValue:480.89,quantity:1,totalCents:48089,description:'Saldo; "semanal"',paymentMethod:'Transferência',observations:'Semana 01/10 a 08/10'},
 {id:'46',payrollId:'13',type:'VALE REFEIÇÃO',date:'2026-10-08',launchId:'3535',unitValue:72.72,quantity:1,totalCents:7272},
 {id:'49',payrollId:'13',type:'VALE REFEIÇÃO',date:'2026-10-08',launchId:'3544',unitValue:225,quantity:1,totalCents:22500},
 {id:'54',payrollId:'13',type:'SALÁRIO',date:'2026-10-09',launchId:'3554',unitValue:1468,quantity:1,totalCents:146800},
 {id:'55',payrollId:'13',type:'FÉRIAS E/OU ENCARGOS',date:'2026-11-01',launchId:'3555',unitValue:10,quantity:2,totalCents:2000},
];
const snapshot={complete:true,sheets:[{id:'13',supplier:'Edgar Nelson',profession:'Mestre de Obras',month:'2026-10'}]};
async function setup(t,options={}) {
 const dom=new JSDOM('<main id="app"></main>');dom.window.matchMedia=()=>({matches:false});
 const exports=[];
 const view=createSupplierPayrollReportView({document:dom.window.document,now:()=>new Date('2026-10-10T12:00:00Z'),
  data:{loadSnapshot:async()=>snapshot,loadPaymentsForPayrollIds:async()=>rows},exportMedia:async(...args)=>exports.push(args),...options});
 t.after(()=>{view.destroy();dom.window.close();});await view.open();await tick();
 const card=view.element.querySelector('details');card.open=true;card.dispatchEvent(new dom.window.Event('toggle'));await tick();
 return {view,root:view.element,dom,card,exports};
}

test('period covers full reference month including leap February, independent of payment dates',()=>{
 assert.equal(typeof model.payrollReferencePeriod,'function');
 assert.deepEqual(model.payrollReferencePeriod('2026-10'),{start:'01/10/2026',end:'31/10/2026'});
 assert.deepEqual(model.payrollReferencePeriod('2024-02'),{start:'01/02/2024',end:'29/02/2024'});
 assert.deepEqual(model.payrollReferencePeriod('2026-02'),{start:'01/02/2026',end:'28/02/2026'});
 assert.throws(()=>model.payrollReferencePeriod('2026-13'));
});
test('known and additional types have stable distinct appearances',()=>{
 assert.equal(typeof model.payrollTypeAppearance,'function');
 const types=['SALÁRIO','VALE REFEIÇÃO','VALE TRANSPORTE','PREMIAÇÃO','AJUDA DE CUSTO','13 SALÁRIO','FÉRIAS E/OU ENCARGOS'];
 assert.equal(new Set(types.map(type=>model.payrollTypeAppearance(type).color)).size,7);
 assert.deepEqual(model.payrollTypeAppearance(' salário '),model.payrollTypeAppearance('SALÁRIO'));
 assert.deepEqual(model.payrollTypeAppearance('NOVO TIPO'),model.payrollTypeAppearance('NOVO TIPO'));
});
test('CSV includes complete periods, every row and per-type totals, escaping and formula protection',()=>{
 assert.equal(typeof model.buildPayrollReportCsv,'function');
 const csv=model.buildPayrollReportCsv([{supplier:'=CMD()',sheets:snapshot.sheets,rows:[...rows,{...rows[0],id:'60',type:'OUTRO',description:'@danger\nextra',totalCents:null}]}]);
 assert.ok(csv.startsWith('\ufeff'));assert.match(csv,/'=CMD\(\)/);assert.match(csv,/01\/10\/2026.*31\/10\/2026/);
 assert.match(csv,/'@danger\nextra/);assert.match(csv,/Saldo; ""semanal""/);
 assert.match(csv,/TOTAL POR TIPO.*SALÁRIO.*1948,89/);assert.match(csv,/TOTAL POR TIPO.*VALE REFEIÇÃO.*297,72/);
 assert.match(csv,/TOTAL POR TIPO.*FÉRIAS E\/OU ENCARGOS.*20,00/);assert.match(csv,/Não calculado/);
});
test('CSV keeps validated negative amounts numeric while neutralizing textual formulas',()=>{
 const csv=model.buildPayrollReportCsv([{supplier:'-formula',sheets:snapshot.sheets,rows:[{...rows[0],unitValue:-10,quantity:1,totalCents:-1000,description:'=CMD()'}]}]);
 assert.match(csv,/"-10";"1";"-10,00"/);assert.doesNotMatch(csv,/"'-10/);assert.match(csv,/'-formula/);assert.match(csv,/'=CMD/);
});
test('dashboard renders full period and separate colored clusters for every type plus rich payment table',async t=>{
 const {root,card}=await setup(t);
 assert.match(root.querySelector('.spr-period').textContent,/01\/10\/2026.*31\/10\/2026/);
 const totals=[...card.querySelectorAll('.spr-type-total')];assert.equal(totals.length,3);
 assert.match(totals.find(n=>n.dataset.type==='SALÁRIO').textContent,/1\.948,89/);
 assert.match(totals.find(n=>n.dataset.type==='VALE REFEIÇÃO').textContent,/297,72/);
 assert.match(card.querySelector('table').textContent,/Saldo; "semanal".*480,89.*Transferência.*Semana/);
 assert.equal(card.querySelectorAll('tbody tr').length,5);
 assert.notEqual(card.querySelector('tbody tr').style.getPropertyValue('--spr-type-bg'),card.querySelectorAll('tbody tr')[1].style.getPropertyValue('--spr-type-bg'));
});
test('export supplier uses all its linked rows including next-month payments and report export respects filters',async t=>{
 const {root,exports}=await setup(t);root.querySelector('.spr-export-supplier').click();await tick();
 assert.equal(exports.length,1);assert.equal(exports[0][0].type,'text/csv;charset=utf-8');
 const text=await exports[0][0].text();assert.match(text,/3555/);assert.match(text,/01\/10\/2026.*31\/10\/2026/);
 assert.match(text,/TOTAL GERAL.*2266,61/);assert.match(exports[0][1],/\.csv$/);
});
test('edit payment and linked launch use distinct forms',async t=>{
 let paymentIds=[],launchIds=[];
 const {root,card}=await setup(t,{loadEditor:async id=>{paymentIds.push(id);throw Error('payment editor proof');},loadLaunchEditor:async id=>{launchIds.push(id);throw Error('launch editor proof');},saveEditor:async()=>{},saveLaunchEditor:async()=>{}});
 card.querySelector('[data-spr-edit=payment]').click();await tick();assert.deepEqual(paymentIds,['45']);
 root.querySelector('[data-gallery-editor-cancel]').click();
 card.querySelector('[data-spr-edit=launch]').click();await tick();assert.deepEqual(launchIds,['3534']);
});
test('submitting the real editor reloads source values and totals retaining month and open supplier',async t=>{
 let amount=48089,saves=0,reads=0;
 const context=id=>({entity:{id:'test',title:'Pagamento'},columns:[{name:'memo',label:'Descrição',control:'text',editable:true}],item:{id,fields:{memo:'Original'}},contract:{hasForm:true,readOnly:false}});
 const {root,dom}=await setup(t,{data:{loadSnapshot:async()=>{reads++;return snapshot;},loadPaymentsForPayrollIds:async()=>[{...rows[0],totalCents:amount,unitValue:amount/100}]},
  loadEditor:async id=>context(id),saveEditor:async(ctx,fields)=>{assert.equal(ctx.item.id,'45');assert.equal(fields.memo,'NOVO');saves++;amount=50000;return {id:'45',fields};}});
 const previous=globalThis.FormData;globalThis.FormData=dom.window.FormData;t.after(()=>{globalThis.FormData=previous;});
 root.querySelector('[data-spr-edit=payment]').click();await tick();await tick();
 root.querySelector('[name=memo]').value='Novo';root.querySelector('[name=memo]').dispatchEvent(new dom.window.Event('input',{bubbles:true}));root.querySelector('[data-dynamic-form]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 await tick();await tick();await tick();
 assert.equal(saves,1,root.querySelector('.gallery-record-dialog-error')?.textContent);assert.equal(reads,2);assert.equal(root.querySelector('[name=month]').value,'2026-10');assert.equal(root.querySelector('details').open,true);
 assert.match(root.querySelector('.spr-type-total').textContent,/500,00/);assert.equal(root.querySelector('[data-gallery-record-screen]'),null);
});

test('saving while portrait invalidates cached money and reloads preserving the expanded supplier on return',async t=>{
 let vertical=false,reads=0,amount=10000;
 const {view,root,dom}=await setup(t,{data:{loadSnapshot:async()=>{reads++;return snapshot;},loadPaymentsForPayrollIds:async()=>[{...rows[0],totalCents:amount}]},loadEditor:async id=>({entity:{id:'test'},columns:[{name:'memo',control:'text',editable:true}],item:{id,fields:{memo:'Original'}},contract:{hasForm:true,readOnly:false}}),saveEditor:async()=>{amount=20000;return {id:'45'};}});
 dom.window.matchMedia=()=>({matches:vertical});const previous=globalThis.FormData;globalThis.FormData=dom.window.FormData;t.after(()=>{globalThis.FormData=previous;});
 root.querySelector('[data-spr-edit=payment]').click();await tick();await tick();vertical=true;dom.window.dispatchEvent(new dom.window.Event('resize'));
 root.querySelector('[data-dynamic-form]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
 vertical=false;dom.window.dispatchEvent(new dom.window.Event('resize'));await tick();await tick();await tick();
 assert.equal(reads,2);assert.equal(root.querySelector('details').open,true);assert.match(root.querySelector('.spr-type-total').textContent,/200,00/);
});
test('failed supplier read prevents whole-report export instead of emitting a partial CSV',async t=>{
 const {root,exports}=await setup(t,{data:{loadSnapshot:async()=>({complete:true,sheets:[...snapshot.sheets,{id:'20',supplier:'Outra',month:'2026-10'}]}),loadPaymentsForPayrollIds:async ids=>{if(ids[0]==='20')throw Error('offline');return rows;}}});
 root.querySelector('.spr-export-all').click();await tick();await tick();assert.equal(exports.length,0);assert.match(root.querySelector('.pl-notice').textContent,/exportar/i);
});

test('whole-report CSV respects supplier and employee search filters',async t=>{
 const {root,dom,exports}=await setup(t,{data:{loadSnapshot:async()=>({complete:true,sheets:[...snapshot.sheets,{id:'20',supplier:'Outra pessoa',month:'2026-10'}]}),loadPaymentsForPayrollIds:async ids=>ids[0]==='20'?[{...rows[0],id:'80',payrollId:'20'}]:rows}});
 const supplier=root.querySelector('[name=supplier]');supplier.value='Outra pessoa';supplier.dispatchEvent(new dom.window.Event('change'));
 root.querySelector('.spr-export-all').click();await tick();await tick();assert.equal(exports.length,1);const csv=await exports[0][0].text();assert.match(csv,/Outra pessoa/);assert.doesNotMatch(csv,/Edgar Nelson/);
 supplier.value='';supplier.dispatchEvent(new dom.window.Event('change'));
 const search=root.querySelector('.spr-search');search.value='Edgar';search.dispatchEvent(new dom.window.Event('input'));
 root.querySelector('.spr-export-all').click();await tick();await tick();assert.equal(exports.length,2);assert.doesNotMatch(await exports[1][0].text(),/Outra pessoa/);
});

for(const action of ['close','filter'])test(`pending CSV is cancelled on ${action} without exporting partial data`,async t=>{
 let finish;
 const {view,root,dom,exports}=await setup(t,{data:{loadSnapshot:async()=>({complete:true,sheets:[...snapshot.sheets,{id:'20',supplier:'Outra',month:'2026-10'}]}),loadPaymentsForPayrollIds:async ids=>ids[0]==='20'?new Promise(resolve=>{finish=resolve;}):rows}});
 root.querySelector('.spr-export-all').click();await tick();
 if(action==='close')view.close();else {root.querySelector('.spr-search').value='Edgar';root.querySelector('.spr-search').dispatchEvent(new dom.window.Event('input'));}
 finish([{...rows[0],payrollId:'20'}]);await tick();await tick();assert.equal(exports.length,0);
});

test('all references show distinct complete periods and each CSV row uses its own sheet month',async t=>{
 const allSnapshot={complete:true,sheets:[...snapshot.sheets,{...snapshot.sheets[0],id:'14',month:'2024-02'}]};
 const {root,dom,exports}=await setup(t,{data:{loadSnapshot:async()=>allSnapshot,loadPaymentsForPayrollIds:async ids=>ids.map(id=>({...rows[0],id:id==='13'?'45':'50',payrollId:id}))}});
 const month=root.querySelector('[name=month]');month.value='';month.dispatchEvent(new dom.window.Event('change'));await tick();
 assert.match(root.querySelector('.spr-period').textContent,/01\/02\/2024 a 29\/02\/2024/);assert.match(root.querySelector('.spr-period').textContent,/01\/10\/2026 a 31\/10\/2026/);
 root.querySelector('.spr-export-all').click();await tick();await tick();const csv=await exports[0][0].text();assert.match(csv,/01\/02\/2024.*29\/02\/2024.*"50";"14"/);assert.match(csv,/01\/10\/2026.*31\/10\/2026.*"45";"13"/);
});
