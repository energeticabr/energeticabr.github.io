import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChatView} from '../src/ui/chat-view.js';
import {createAttachmentPreview} from '../src/web/attachment-preview.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const suppliers=[{id:'4',name:'MAURICIO HONORATO DE SOUZA'},{id:'7',name:'HELISON ROSA LUIS'}];
const snapshot={month:'2026-09',rows:[{Id:'1',ID_PESSOA_RHID:'101',NOME_COLABORADOR:suppliers[1].name,DATA_REFERENCIA:'2026-09-01',BATIDAS_RHID:'07:00;12:00;13:00;17:00'}],presentDates:['2026-09-01']};

test('daily report header opens monthly generation for the displayed month without changing the daily report or draft',t=>{
 const dom=new JSDOM('<main id="app"></main>'),root=dom.window.document.querySelector('main'),view=createChatView(root),commands=[];
 t.after(()=>{view.destroy();dom.window.close();});
 view.on('open-rhid-monthly-report',command=>commands.push(command));
 const state={sessionStatus:'authenticated',account:{name:'Tester'},draft:'Observação preservada',pendingFiles:[],messages:[{id:'rhid',role:'assistant',type:'poll',question:'📊 RELATÓRIO DE PRESENÇAS RHID',options:[],detail_table:{kind:'rhid_attendance',reportDate:'2026-09-28',headers:['Nome'],rows:[]}}]};
 view.render(state);
 const header=root.querySelector('.chat-flow-status');
 const button=header.querySelector('button[data-action="open-rhid-monthly-report"]');
 assert.ok(button,'the report header must offer monthly generation directly');
 assert.equal(button.textContent,'GERAR RELATÓRIO MENSAL RHID');
 assert.equal(header.querySelector('strong.chat-flow-title'),null);
 assert.ok(header.querySelector('[data-action="rhid-refresh"]'));
 assert.ok(header.querySelector('[data-action="open-rhid-attendance-report"]'));
 assert.equal(header.querySelectorAll('.chat-flow-nav-button').length,2);
 button.click();
 assert.equal(commands.length,1);assert.equal(commands[0].value,'2026-09');
 assert.equal(root.querySelector('.chat-rhid-date-navigation time').dateTime,'2026-09-28');
 assert.equal(root.querySelector('[data-role="draft"]').value,'Observação preservada');
 assert.equal(root.querySelector('[data-rhid-attendance-report-dialog]'),null,'monthly entry must not open the daily calendar');
 view.render({...state,messages:[{...state.messages[0],detail_table:{...state.messages[0].detail_table,reportDate:'2026-10-01'}}]});
 root.querySelector('.chat-flow-status [data-action="open-rhid-monthly-report"]').click();
 assert.equal(commands[1].value,'2026-10','the shortcut follows navigation into another month');
});

test('monthly header shortcut is disabled while the report or RHID refresh is busy',t=>{
 const dom=new JSDOM('<main id="app"></main>'),root=dom.window.document.querySelector('main'),view=createChatView(root),commands=[];
 t.after(()=>{view.destroy();dom.window.close();});view.on('open-rhid-monthly-report',command=>commands.push(command));
 const state={sessionStatus:'authenticated',account:{name:'Tester'},draft:'',pendingFiles:[],messages:[{id:'rhid',role:'assistant',type:'poll',question:'RHID',options:[],detail_table:{kind:'rhid_attendance',reportDate:'2026-09-28',headers:['Nome'],rows:[]}}]};
 view.render({...state,activeText:true});
 let button=root.querySelector('.chat-flow-status [data-action="open-rhid-monthly-report"]');assert.ok(button);assert.equal(button.disabled,true);button.click();
 view.render(state);view.setRhidRefreshStatus({busy:true});
 button=root.querySelector('.chat-flow-status [data-action="open-rhid-monthly-report"]');assert.equal(button.disabled,true);button.click();
 assert.equal(commands.length,0);
 view.setRhidRefreshStatus({busy:false});assert.equal(root.querySelector('.chat-flow-status [data-action="open-rhid-monthly-report"]').disabled,false);
 view.render({...state,messages:[{...state.messages[0],detail_table:{...state.messages[0].detail_table,navigationBusy:true}}]});
 assert.equal(root.querySelector('.chat-flow-status [data-action="open-rhid-monthly-report"]').disabled,true);
});

test('monthly header entry is absent outside daily RHID reports',t=>{
 const dom=new JSDOM('<main id="app"></main>'),root=dom.window.document.querySelector('main'),view=createChatView(root);
 t.after(()=>{view.destroy();dom.window.close();});
 view.render({sessionStatus:'authenticated',account:{name:'Tester'},draft:'',pendingFiles:[],activeFlow:{id:'new_document',title:'EFETUAR LANÇAMENTO'},messages:[{id:'launch',role:'assistant',type:'poll',question:'Qual produto?',options:[]}]});
 assert.equal(root.querySelector('.chat-flow-status [data-action="open-rhid-monthly-report"]'),null);
 assert.ok(root.querySelector('.chat-flow-status [data-action="show-summary"]'));
});
test('RHID calendar offers monthly generation without changing the selected daily date',()=>{
 const dom=new JSDOM('<main id="app"></main>'),root=dom.window.document.querySelector('main'),view=createChatView(root),commands=[];
 view.on('open-rhid-monthly-report',command=>commands.push(command));
 view.render({sessionStatus:'authenticated',account:{name:'Tester'},draft:'',pendingFiles:[],messages:[{id:'rhid',role:'assistant',type:'poll',question:'RHID',options:[],detail_table:{kind:'rhid_attendance',reportDate:'2026-09-28',headers:['Nome'],rows:[]}}]});
 root.querySelector('.chat-rhid-date-navigation [data-action="open-rhid-attendance-report"]').click();
 const button=root.querySelector('[data-rhid-attendance-report-dialog] [data-action="open-rhid-monthly-report"]');assert.ok(button);assert.equal(button.textContent,'GERAR RELATÓRIO MENSAL');assert.ok(!root.textContent.includes('Escolha a data das presenças que deseja consultar.'));
 button.click();assert.equal(commands[0].value,'2026-09');assert.ok(root.querySelector('[aria-pressed="true"][data-value="2026-09-28"]'));
 view.destroy();dom.window.close();
});
async function setup(t,data={},options={}){
 const {createRhidMonthlyReportView}=await import('../src/ui/rhid-monthly-report-view.js');
 const dom=new JSDOM('<main id="app"><button id="origin">Mensal</button></main>'),doc=dom.window.document;
 doc.querySelector('button').focus();
 const view=createRhidMonthlyReportView({document:doc,data:{loadSuppliers:async()=>suppliers,loadMonth:async()=>snapshot,...data},now:()=>new Date('2026-10-09T15:00:00Z'),...options});
 t.after(()=>{view.destroy();dom.window.close();});await view.open({month:'2026-09'});
 return {view,doc,dom};
}
test('monthly panel suspension releases the app for its existing signature pad without cancelling the report',async t=>{
 let closed=0;const {view,doc}=await setup(t,{}, {onClose:()=>closed++});
 assert.equal(doc.querySelector('#app').inert,true);
 assert.equal(typeof view.suspend,'function');
 view.suspend();
 assert.equal(doc.querySelector('#app').inert,false);
 assert.equal(view.element.inert,true);
 assert.equal(closed,0);
 view.resume();
 assert.equal(doc.querySelector('#app').inert,true);assert.equal(view.element.inert,false);
 assert.equal(view.element.hidden,false);
});
test('monthly form requires supplier, month and year and shows that supplier daily totals',async t=>{
 const requests=[];const {doc}=await setup(t,{loadMonth:async month=>{requests.push(month);return snapshot;}});
 const supplier=doc.querySelector('select[name="supplier"]');assert.equal(supplier.value,'');assert.deepEqual([...supplier.options].map(o=>o.textContent),['Selecione o fornecedor',...suppliers.map(s=>s.name)]);
 assert.equal(doc.querySelector('[name="month"]').value,'09');assert.equal(doc.querySelector('[name="year"]').value,'2026');
 supplier.value='7';doc.querySelector('form').dispatchEvent(new doc.defaultView.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
 assert.deepEqual(requests,['2026-09']);assert.match(doc.querySelector('[data-monthly-result]').textContent,/HELISON ROSA LUIS/);assert.match(doc.querySelector('[data-monthly-result]').textContent,/09:00/);assert.equal(doc.querySelectorAll('tbody tr').length,30);
});
test('supplier options keep multiple choices when searching again without opening a keyboard',async t=>{
 const {doc,dom}=await setup(t,{loadSuppliers:async()=>Array.from({length:12},(_,i)=>({id:String(i+1),name:`FORNECEDOR ${i+1}`}))});
 const trigger=doc.querySelector('.sfs-field input');trigger.click();
 assert.equal(trigger.readOnly,true,'opening the supplier list must not open the phone keyboard');
 const popup=doc.querySelector('.sfs-popup');assert.equal(popup.dataset.placement,'expanded');
 assert.ok(parseFloat(doc.querySelector('.sfs-list').style.maxHeight)>=7*40);
 [...doc.querySelectorAll('[role="option"]')].find(option=>option.textContent==='FORNECEDOR 2').click();assert.equal(doc.querySelector('[name="supplier"]').value,'2');
 trigger.click();const search=doc.querySelector('.sfs-report-search');search.value='12';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.equal(doc.querySelectorAll('[role="option"]').length,1);
 doc.querySelector('[role="option"]').click();assert.deepEqual([...doc.querySelector('[name="supplier"]').selectedOptions].map(o=>o.value),['2','12']);
 assert.equal(popup.hidden,false,'marking another employee keeps the list open');
 doc.querySelector('[role="option"]').click();assert.deepEqual([...doc.querySelector('[name="supplier"]').selectedOptions].map(o=>o.value),['2']);
});

test('monthly selection generates all selected employees from one monthly snapshot',async t=>{
 const reports=[];let reads=0;
 const {doc}=await setup(t,{loadMonth:async()=>{reads++;return snapshot;}},{onReport:async report=>reports.push(report)});
 const field=doc.querySelector('[name="supplier"]');assert.equal(field.multiple,true);
 doc.querySelector('.sfs-field input').click();
 for(const option of [...doc.querySelectorAll('[role="option"]')].filter(o=>suppliers.some(s=>s.name===o.textContent)))option.click();
 assert.equal(doc.querySelector('[role="listbox"]').getAttribute('aria-multiselectable'),'true');
 doc.querySelector('.sfs-dismiss').click();
 doc.querySelector('form').dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();await tick();
 assert.equal(reads,1);assert.equal(reports.length,1);
 assert.deepEqual(reports[0].map(r=>[r.supplier.id,r.total]),[['4','00:00'],['7','09:00']]);
 assert.equal(doc.querySelectorAll('[data-monthly-result] table').length,2);
});

test('RHID confirms the marked suppliers without generating a PDF and restores period entry',async t=>{
 let reads=0,opened=0;
 const {doc,dom}=await setup(t,{loadMonth:async()=>{reads++;return snapshot;}},{onReport:async()=>opened++});
 const trigger=doc.querySelector('.sfs-field input');trigger.click();
 const confirm=[...doc.querySelectorAll('.sfs-popup button')].find(node=>node.textContent==='Confirmar fornecedores');
 assert.ok(confirm,'a separate confirmation action must be available inside the supplier picker');
 assert.equal(confirm.type,'button');assert.equal(confirm.disabled,true);
 [...doc.querySelectorAll('[role="option"]')].find(node=>node.textContent===suppliers[1].name).click();
 assert.equal(confirm.disabled,false);confirm.click();
 assert.equal(doc.querySelector('.sfs-popup').hidden,true);assert.equal(doc.activeElement,trigger);
 assert.deepEqual([...doc.querySelector('[name="supplier"]').selectedOptions].map(o=>o.value),['7']);
 assert.equal(reads,0);assert.equal(opened,0,'confirming suppliers must not submit the monthly report');
 doc.querySelector('[name="month"]').value='09';
 doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await tick();await tick();
 assert.equal(reads,1);assert.equal(opened,1);
});

test('RHID selects every eligible supplier despite a search and generates one report per chosen supplier',async t=>{
 const reports=[];let reads=0;
 const {doc,dom}=await setup(t,{loadMonth:async()=>{reads++;return snapshot;}},{onReport:async report=>reports.push(report)});
 doc.querySelector('.sfs-field input').click();
 const search=doc.querySelector('.sfs-report-search');search.value='HELISON';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.equal(doc.querySelectorAll('[role="option"]').length,1);
 const all=[...doc.querySelectorAll('.sfs-popup button')].find(node=>node.textContent==='Selecionar todos os fornecedores');
 assert.ok(all,'bulk selection must be available inside the supplier picker');
 let changes=0;doc.querySelector('[name="supplier"]').addEventListener('change',()=>changes++);
 all.click();all.click();
 assert.deepEqual([...doc.querySelector('[name="supplier"]').selectedOptions].map(o=>o.value),['4','7']);
 assert.equal(changes,1,'selecting all twice is idempotent');assert.equal(doc.querySelector('.sfs-popup').hidden,false);
 [...doc.querySelectorAll('.sfs-popup button')].find(node=>node.textContent==='Confirmar fornecedores').click();
 doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await tick();await tick();
 assert.equal(reads,1);assert.deepEqual(reports[0].map(r=>r.supplier.id),['4','7']);
});

test('RHID select-all touch survives keyboard blur and ancestor movement before committing on release',async t=>{
 const {doc,dom}=await setup(t);doc.querySelector('.sfs-field input').click();
 const search=doc.querySelector('.sfs-report-search');search.focus();
 const all=doc.querySelector('.sfs-select-all'),popup=doc.querySelector('.sfs-popup'),native=doc.querySelector('[name="supplier"]');
 let changes=0;native.addEventListener('change',()=>changes++);
 const pointer=(type,node,x=30)=>{
  const event=new dom.window.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:30});
  Object.defineProperties(event,{pointerType:{value:'touch'},pointerId:{value:12}});node.dispatchEvent(event);
 };
 pointer('pointerdown',all);
 search.dispatchEvent(new dom.window.FocusEvent('focusout',{bubbles:true,relatedTarget:null}));
 doc.querySelector('.rhid-monthly-dialog').dispatchEvent(new dom.window.Event('scroll'));
 assert.equal(popup.hidden,false,'keyboard dismissal during the footer tap must not close the list');
 pointer('pointerup',all);
 assert.deepEqual([...native.selectedOptions].map(o=>o.value),['4','7'],'all suppliers commit before a delayed mobile click');
 assert.equal(changes,1);assert.equal(popup.hidden,false);
 all.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,detail:1}));assert.equal(changes,1);
 const confirm=doc.querySelector('.sfs-confirm-selection');pointer('pointerdown',confirm);
 search.dispatchEvent(new dom.window.FocusEvent('focusout',{bubbles:true,relatedTarget:null}));
 assert.equal(popup.hidden,false);pointer('pointerup',confirm);
 assert.equal(popup.hidden,true);assert.deepEqual([...native.selectedOptions].map(o=>o.value),['4','7']);
});

test('RHID cancelled or dragged select-all touch does not select suppliers or trap subsequent outside focus',async t=>{
 const {doc,dom}=await setup(t);const trigger=doc.querySelector('.sfs-field input'),popup=doc.querySelector('.sfs-popup');
 const all=doc.querySelector('.sfs-select-all'),native=doc.querySelector('[name="supplier"]');
 const pointer=(type,x)=>{const event=new dom.window.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:30});Object.defineProperty(event,'pointerType',{value:'touch'});all.dispatchEvent(event);};
 for(const release of ['pointercancel','pointerup']){
  trigger.click();pointer('pointerdown',30);pointer(release,300);await tick();
  all.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,detail:1}));
  assert.deepEqual([...native.selectedOptions].map(o=>o.value),[]);
  trigger.dispatchEvent(new dom.window.FocusEvent('focusout',{bubbles:true,relatedTarget:doc.querySelector('[name="year"]')}));
  assert.equal(popup.hidden,true);
 }
});

test('RHID bulk selection excludes placeholder, hidden and disabled options and supports unmarking afterward',async t=>{
 const {doc}=await setup(t);const native=doc.querySelector('[name="supplier"]');
 native.options[1].disabled=true;native.append(Object.assign(doc.createElement('option'),{value:'99',textContent:'Oculto',hidden:true}));
 doc.querySelector('.sfs-field input').click();
 const all=[...doc.querySelectorAll('.sfs-popup button')].find(node=>node.textContent==='Selecionar todos os fornecedores');assert.ok(all);
 all.click();assert.deepEqual([...native.selectedOptions].map(o=>o.value),['7']);
 const option=[...doc.querySelectorAll('[role="option"]')].find(node=>node.textContent===suppliers[1].name);option.click();
 assert.deepEqual([...native.selectedOptions].map(o=>o.value),[]);
 assert.equal([...doc.querySelectorAll('.sfs-popup button')].find(node=>node.textContent==='Confirmar fornecedores').disabled,true);
 assert.ok(![...doc.querySelectorAll('[role="option"]')].some(node=>node.textContent==='Selecione o fornecedor'),'the placeholder is not a supplier checkbox');
});

test('monthly batch rejects every report if one selected employee is no longer eligible',async t=>{
 let loads=0,reads=0,opened=0;
 const {doc}=await setup(t,{loadSuppliers:async()=>++loads===1?suppliers:[suppliers[1]],loadMonth:async()=>{reads++;return snapshot;}},{onReport:async()=>opened++});
 for(const option of doc.querySelector('[name="supplier"]').options)option.selected=Boolean(option.value);
 doc.querySelector('form').dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();await tick();
 assert.equal(reads,0);assert.equal(opened,0);assert.match(doc.querySelector('[role="alert"]').textContent,/ativo|empreiteiro/i);
});
test('successful monthly generation opens the confirmed supplier report with a cancellable lifetime',async t=>{
 const reports=[];const {doc}=await setup(t,{}, {onReport:async(report,options)=>reports.push({report,options})});
 doc.querySelector('[name="supplier"]').value='7';doc.querySelector('form').dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();await tick();
 assert.equal(reports.length,1);assert.equal(reports[0].report.supplier.name,'HELISON ROSA LUIS');assert.equal(reports[0].report.total,'09:00');
 assert.equal(reports[0].options.signal.aborted,false);
});
test('PDF opening failures leave the report available with a visible retry error',async t=>{
 const {doc}=await setup(t,{}, {onReport:async()=>{throw new Error('Não foi possível abrir o PDF.');}});
 doc.querySelector('[name="supplier"]').value='7';doc.querySelector('form').dispatchEvent(new doc.defaultView.Event('submit',{cancelable:true}));await tick();await tick();
 assert.match(doc.querySelector('[role="alert"]').textContent,/PDF/);assert.equal(doc.querySelector('.rhid-monthly-generate').disabled,false);
 assert.equal(doc.querySelector('[data-monthly-result]').hidden,false);
});

test('closing monthly PDF restores focus inside the still-open report instead of inert app',async t=>{
 let preview;
 const {doc,dom}=await setup(t,{}, {onReport:async(report,options)=>{
  assert.equal(typeof options.resolveReturnFocus,'function');
  await preview.open(new Blob(['%PDF-1.7'],{type:'application/pdf'}),'rhid.pdf',{layout:'report-pdf',resolveReturnFocus:options.resolveReturnFocus});
 }});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 preview=createAttachmentPreview({documentRef:doc,urlApi:{createObjectURL:()=> 'blob:rhid',revokeObjectURL(){}},loadPdfPreview:async()=>({createPdfPreview:()=>({ready:Promise.resolve(),destroy(){}})})});
 t.after(()=>preview.destroy());
 doc.querySelector('[name="supplier"]').value='7';doc.querySelector('.rhid-monthly-generate').focus();
 doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await tick();await tick();await tick();
 assert.equal(doc.querySelector('dialog').open,true);preview.close();
 assert.equal(doc.getElementById('app').inert,true);
 assert.equal(doc.activeElement,doc.querySelector('.rhid-monthly-close'));
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
