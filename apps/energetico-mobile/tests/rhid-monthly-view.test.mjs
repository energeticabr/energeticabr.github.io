import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChatView} from '../src/ui/chat-view.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const suppliers=[{id:'4',name:'MAURICIO HONORATO DE SOUZA'},{id:'7',name:'HELISON ROSA LUIS'}];
const snapshot={month:'2026-09',rows:[{Id:'1',ID_PESSOA_RHID:'101',NOME_COLABORADOR:suppliers[1].name,DATA_REFERENCIA:'2026-09-01',BATIDAS_RHID:'07:00;12:00;13:00;17:00'}],presentDates:['2026-09-01']};
test('RHID calendar offers monthly generation without changing the selected daily date',()=>{
 const dom=new JSDOM('<main id="app"></main>'),root=dom.window.document.querySelector('main'),view=createChatView(root),commands=[];
 view.on('open-rhid-monthly-report',command=>commands.push(command));
 view.render({sessionStatus:'authenticated',account:{name:'Tester'},draft:'',pendingFiles:[],messages:[{id:'rhid',role:'assistant',type:'poll',question:'RHID',options:[],detail_table:{kind:'rhid_attendance',reportDate:'2026-09-28',headers:['Nome'],rows:[]}}]});
 root.querySelector('.chat-rhid-date-navigation [data-action="open-rhid-attendance-report"]').click();
 const button=root.querySelector('[data-action="open-rhid-monthly-report"]');assert.ok(button);assert.equal(button.textContent,'GERAR RELATÓRIO MENSAL');assert.ok(!root.textContent.includes('Escolha a data das presenças que deseja consultar.'));
 button.click();assert.equal(commands[0].value,'2026-09');assert.ok(root.querySelector('[aria-pressed="true"][data-value="2026-09-28"]'));
 view.destroy();dom.window.close();
});
async function setup(t,data={}){
 const {createRhidMonthlyReportView}=await import('../src/ui/rhid-monthly-report-view.js');
 const dom=new JSDOM('<main id="app"><button id="origin">Mensal</button></main>'),doc=dom.window.document;
 doc.querySelector('button').focus();
 const view=createRhidMonthlyReportView({document:doc,data:{loadSuppliers:async()=>suppliers,loadMonth:async()=>snapshot,...data},now:()=>new Date('2026-10-09T15:00:00Z')});
 t.after(()=>{view.destroy();dom.window.close();});await view.open({month:'2026-09'});
 return {view,doc,dom};
}
test('monthly form requires supplier, month and year and shows that supplier daily totals',async t=>{
 const requests=[];const {doc}=await setup(t,{loadMonth:async month=>{requests.push(month);return snapshot;}});
 const supplier=doc.querySelector('select[name="supplier"]');assert.equal(supplier.value,'');assert.deepEqual([...supplier.options].map(o=>o.textContent),['Selecione o fornecedor',...suppliers.map(s=>s.name)]);
 assert.equal(doc.querySelector('[name="month"]').value,'09');assert.equal(doc.querySelector('[name="year"]').value,'2026');
 supplier.value='7';doc.querySelector('form').dispatchEvent(new doc.defaultView.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
 assert.deepEqual(requests,['2026-09']);assert.match(doc.querySelector('[data-monthly-result]').textContent,/HELISON ROSA LUIS/);assert.match(doc.querySelector('[data-monthly-result]').textContent,/09:00/);assert.equal(doc.querySelectorAll('tbody tr').length,30);
});
test('monthly generation revalidates supplier eligibility before displaying attendance',async t=>{
 let loads=0,requests=0;
 const {doc}=await setup(t,{loadSuppliers:async()=>++loads===1?suppliers:[],loadMonth:async()=>{requests++;return snapshot;}});
 doc.querySelector('[name="supplier"]').value='7';doc.querySelector('form').dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();
 assert.match(doc.querySelector('[role="alert"]').textContent,/ativo|empreiteiro/i);assert.equal(requests,0);assert.equal(doc.querySelectorAll('tbody tr').length,0);
});
test('closing monthly panel cancels a late report and restores app interaction',async t=>{
 let resolve;const pending=new Promise(r=>resolve=r);
 const {doc,view}=await setup(t,{loadMonth:()=>pending});
 doc.querySelector('[name="supplier"]').value='7';doc.querySelector('form').dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();view.close();resolve(snapshot);await tick();
 assert.equal(view.element.hidden,true);assert.equal(doc.querySelector('#app').inert,false);assert.equal(doc.querySelectorAll('tbody tr').length,0);assert.equal(doc.body.style.overflow,'');
});
