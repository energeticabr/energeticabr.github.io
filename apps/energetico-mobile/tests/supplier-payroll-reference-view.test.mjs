import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createSupplierPayrollReportView} from '../src/ui/supplier-payroll-report-view.js';

const snapshot={complete:true,sheets:[
 {id:'9',supplier:'Cleiton Cesar Nonato',month:'2026-10',profession:'Servente de Pedreiro'},
 {id:'10',supplier:'Cleiton Cesar Nonato',month:'2026-10',profession:'Servente de Pedreiro'},
 {id:'3',supplier:'Edgar Nelson da Silva',month:'2026-10',profession:'Mestre de Obras'},
]};
const rows=[{id:'12873',payrollId:'9',supplier:'Cleiton Cesar Nonato',type:'Salário',date:'2026-10-05',launchId:'45512',unitValue:527,quantity:1,totalCents:52700},
 {id:'12874',payrollId:'10',supplier:'Cleiton Cesar Nonato',type:'Ajuda de Custo',date:'2026-11-12',launchId:'45513',unitValue:300,quantity:2,totalCents:60000}];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t,reader){
 const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');dom.window.matchMedia=()=>({matches:false});
 const calls=[];
 const view=createSupplierPayrollReportView({document:dom.window.document,now:()=>new Date('2026-10-08T12:00:00Z'),data:{loadSnapshot:async()=>snapshot,loadPaymentsForPayrollIds:async(ids,opts)=>{calls.push(ids);return reader?reader(ids,opts):rows.filter(row=>ids.includes(row.payrollId));}}});
 t.after(()=>{view.destroy();dom.window.close();});return {view,root:view.element,dom,calls};
}

test('compact toolbar and collapsed supplier summaries show profession IDs total and payment count',async t=>{
 const {view,root}=setup(t);await view.open();await tick();
 assert.ok(root.querySelector('.spr-filters img[alt="Logo Energética"]'));
 assert.equal(root.querySelector('[name=month]').value,'2026-10');assert.ok(root.querySelector('[name=profession]'));
 const cards=[...root.querySelectorAll('.spr-supplier')];assert.equal(cards.length,2);assert.ok(cards.every(card=>!card.open));
 assert.equal(cards[0].querySelector('.spr-avatar').textContent,'CN');
 assert.equal(cards[0].querySelector('.spr-profession').textContent,'Servente de Pedreiro');
 assert.match(cards[0].querySelector('.spr-ids').textContent,/9, 10/);
 assert.equal(cards[0].querySelector('.spr-total-paid .spr-metric-value').textContent.replaceAll('\u00a0',' '),'R$ 1.127,00');
 assert.equal(cards[0].querySelector('.spr-payment-count .spr-metric-value').textContent,'2');
 assert.equal(cards[1].querySelector('.spr-total-paid .spr-metric-value').textContent.replaceAll('\u00a0',' '),'R$ 0,00');
 assert.equal(root.querySelectorAll('.spr-content .spr-brand,.spr-overview,.spr-instruction').length,0);
});

test('profession filter restricts supplier groups and totals use cached rows without changing reference month',async t=>{
 const {view,root,dom,calls}=setup(t);await view.open();await tick();
 const profession=root.querySelector('[name=profession]');assert.ok(profession);
 profession.value='Mestre de Obras';profession.dispatchEvent(new dom.window.Event('change'));await tick();
 assert.equal(root.querySelectorAll('.spr-supplier').length,1);assert.match(root.querySelector('.spr-name').textContent,/Edgar/);
 assert.equal(root.querySelector('[name=month]').value,'2026-10');assert.equal(calls.length,2);
});

test('pending unknown and failed supplier totals are never reported as a definitive zero',async t=>{
 const tasks=new Map();const {view,root}=setup(t,(ids,{signal})=>new Promise(resolve=>tasks.set(ids.join(','),{resolve,signal})));
 await view.open();await tick();
 const card=root.querySelector('.spr-supplier');const value=card.querySelector('.spr-total-paid .spr-metric-value');assert.ok(value);
 assert.match(value.textContent,/Carregando/);
 tasks.get('9,10').resolve([{...rows[0],totalCents:null}]);await tick();assert.match(value.textContent,/Não calculado/);
 assert.equal(card.querySelector('.spr-payment-count .spr-metric-value').textContent,'1');
 view.close();assert.equal(tasks.get('3').signal.aborted,true);tasks.get('3').resolve([]);await tick();assert.equal(root.hidden,true);
});

test('background financial loading is bounded and closing cancels active and queued supplier groups',async t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.matchMedia=()=>({matches:false});const signals=[];
 const source={complete:true,sheets:Array.from({length:12},(_,i)=>({id:String(i+1),supplier:'Fornecedor '+String(i).padStart(2,'0'),month:'2026-10'}))};
 const view=createSupplierPayrollReportView({document:dom.window.document,now:()=>new Date('2026-10-08T12:00:00Z'),data:{loadSnapshot:async()=>source,loadPaymentsForPayrollIds:(_ids,{signal})=>{signals.push(signal);return new Promise(()=>{});}}});
 t.after(()=>{view.destroy();dom.window.close();});await view.open();await tick();
 assert.equal(signals.length,4,'only four group readers may run concurrently');view.close();await tick();assert.ok(signals.every(signal=>signal.aborted));assert.equal(signals.length,4);
});

test('opening a supplier reuses header rows and retains payments made after the reference month',async t=>{
 const {view,root,dom,calls}=setup(t);await view.open();await tick();const card=root.querySelector('details');card.open=true;card.dispatchEvent(new dom.window.Event('toggle'));await tick();
 assert.equal(calls.length,2);assert.match(card.querySelector('tbody').textContent,/12874.*12\/11\/2026.*45513.*600,00/s);
 assert.equal(card.querySelectorAll('tbody tr').length,2);
});
