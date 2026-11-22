import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createChatView,renderChatMarkup} from '../src/ui/chat-view.js';
import {captureFilteredReport} from '../src/ui/report-print.js';
const {createTaskAssociationReportView}=await import('../src/ui/task-association-report-view.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const row=(id,extra={})=>({id,createdDate:'2026-10-04',dueDate:'2026-10-05',description:'Conferir documentação',association:'DEMANDAS PESSOAIS',status:'ATIVIDADE CRIADA',priority:'ATIVIDADE EMERGENCIAL',difficulty:'ALTA DIFICULDADE',supplier:'Bernardo',...extra});
const snapshot={tasks:[row(1),row(2,{priority:'ATIVIDADE PRIORITÁRIA',dueDate:'2026-10-06',status:'EM ATENDIMENTO'}),row(3,{association:'ENGENHARIA',status:'CONCLUÍDO'}),row(4,{association:'ENGENHARIA',priority:'NÃO PRIORITÁRIA',dueDate:'',supplier:'Edgar'})]};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const home={sessionStatus:'authenticated',account:{name:'Bernardo'},draft:'',pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
function setup(t,load=async()=>snapshot,vertical=false,finalizeTask,{listPdfAttachments,openMediaCollection}={}){
 assert.equal(typeof createTaskAssociationReportView,'function','new report factory must exist');const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let portrait=vertical;
 dom.window.matchMedia=()=>({get matches(){return portrait;}});const style=dom.window.document.createElement('style');style.textContent=readFileSync(new URL('../src/ui/task-association-report.css',import.meta.url),'utf8');dom.window.document.head.append(style);
 const view=createTaskAssociationReportView({document:dom.window.document,data:{loadSnapshot:load,finalizeTask,listPdfAttachments},openMediaCollection,now:()=>new Date('2026-10-06T12:00:00Z')});t.after(()=>{view.destroy();dom.window.close();});
 return {view,root:view.element,dom,rotate(value){portrait=value;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('opens a single PDF control below the task ID with that task’s files and cancels the preview on close',async t=>{
 const listed=[];
 const files=['Contrato.PDF','Segundo.pdf'].map(fileName=>({fileName,source:async()=>new Blob([],{type:'application/pdf'})}));
 let preview;
 const {view,root,dom}=setup(t,async()=>({attachmentListId:'tasks',tasks:[
  row(1,{hasAttachments:true}),row(2,{hasAttachments:false}),row(4),
 ]}),false,undefined,{
  async listPdfAttachments(list,id){assert.equal(list,'tasks');listed.push(id);return id===1?files:[];},
  async openMediaCollection(items,options){preview={items,options};},
 });
 await view.open();await tick();
 const idCell=id=>root.querySelector(`[data-task-id="${id}"] .tar-id`);
 const control=idCell(1).querySelector('button');
 assert.deepEqual(listed,[1,4]);
 assert.equal(control.previousElementSibling.textContent,'1');
 assert.equal(control.getAttribute('aria-label'),'Abrir PDFs da atividade 1');
 const icon=control.querySelector('svg');
 assert.ok(icon);
 assert.equal(dom.window.getComputedStyle(icon).color,'rgb(28, 60, 123)');
 assert.equal(idCell(2).querySelector('button'),null);
 assert.equal(idCell(4).querySelector('button'),null);
 control.click();await tick();assert.deepEqual(preview.items,files);
 assert.equal(preview.options.resolveReturnFocus(),control);
 const filter=root.querySelector('input[name=description]');filter.value='conferir';filter.dispatchEvent(new dom.window.Event('input'));
 await tick();assert.deepEqual(listed,[1,4]);
 view.close();assert.equal(preview.options.signal.aborted,true);
});
test('rechecks other task PDFs silently after the user recovers SharePoint permission',async t=>{
 const attempts=[];
 let authorized=false;
 const {view,root}=setup(t,async()=>({attachmentListId:'tasks',tasks:[
  row(1,{hasAttachments:true}),row(2,{hasAttachments:true}),
 ]}),false,undefined,{
  async listPdfAttachments(_list,id,{interactive}){
   attempts.push([id,interactive]);
   if(interactive)authorized=true;
   if(!authorized)throw Object.assign(Error('Permission required'),{code:'AUTH_REQUIRED'});
   return [{fileName:'Atividade.pdf',source:async()=>new Blob([],{type:'application/pdf'})}];
  },
  async openMediaCollection(){},
 });
 await view.open();await tick();
 root.querySelector('[aria-label="Consultar novamente os anexos da atividade 1"]').click();
 await tick();
 assert.deepEqual(attempts,[[1,false],[2,false],[1,true],[2,false]]);
 assert.equal(root.querySelectorAll('button[aria-label^="Abrir PDFs da atividade"]').length,2);
});
test('ninth left HOME mascot is after document control and clicking its provided image opens its own action',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 let calls=0;view.on('open-task-association-report',()=>calls++);view.render(home);const button=dom.window.document.querySelector('[data-action=open-task-association-report]');assert.ok(button);assert.equal(button.previousElementSibling.dataset.action,'open-document-control-report');assert.ok(button.nextElementSibling.classList.contains('chat-bubble'));assert.match(button.querySelector('img').src,/task-association\.png$/);button.querySelector('img').click();assert.equal(calls,1);
 view.render({...home,activeText:{id:'busy'}});assert.equal(dom.window.document.querySelector('[data-action=open-task-association-report]').disabled,true);assert.doesNotMatch(renderChatMarkup({...home,activeFlow:'busy'}),/data-action="open-task-association-report"/);
});
test('source grouping and priority colors render with three unfiltered metrics and six table columns',async t=>{
 const {view,root,dom}=setup(t);await view.open();assert.match(root.querySelector('img').src,/logo-energetica-oficial/);assert.equal(root.querySelectorAll('.tar-filter').length,7);assert.equal(root.querySelectorAll('.tar-card').length,3);
 for(const [key,value] of Object.entries({pending:3,completed:1,total:4}))assert.equal(root.querySelector(`[data-metric=${key}] strong`).textContent,String(value));
 assert.equal(root.querySelectorAll('.tar-group').length,2);assert.equal(root.querySelectorAll('tbody tr[data-task-id]').length,3);assert.equal(root.querySelectorAll('thead')[0].querySelectorAll('th').length,6);assert.equal(root.querySelector('thead th:last-child').textContent,'STATUS');assert.equal(root.querySelector('tfoot td').colSpan,6);assert.match(root.querySelector('.tar-association').textContent,/DEMANDAS PESSOAIS.*TOTAL: 2.*PENDENTES: 2/s);
 assert.equal(dom.window.getComputedStyle(root.querySelector('[data-task-id="1"]')).backgroundColor,'rgb(255, 205, 210)');assert.equal(dom.window.getComputedStyle(root.querySelector('[data-task-id="2"]')).backgroundColor,'rgb(255, 224, 178)');assert.match(root.querySelector('[data-task-id="1"]').textContent,/HÁ 2 DIAS.*1 DIA VENCIDA/s);assert.match(root.querySelector('[data-task-id="2"]').textContent,/VENCE HOJE/);assert.match(root.querySelector('[data-task-id="4"]').textContent,/SEM DATA/);assert.equal(root.querySelector('[aria-label*="Fechar"]:not(.sfs-dismiss)').textContent,'❌');
});
test('status offers finalization for open rows and updates only after confirmed SharePoint readback',async t=>{
 const tasks=[...snapshot.tasks,row(5,{status:'CONCLUÍDA'}),row(6,{status:'CANCELADO'})];
 let attempts=0,finish;
 const {view,root,dom}=setup(t,async()=>({tasks}),false,async(id,completionDate,{expectedTask,signal})=>{
  assert.equal(id,1);assert.equal(completionDate,'2026-10-05');assert.equal(expectedTask.status,'ATIVIDADE CRIADA');assert.equal(signal.aborted,false);
  if(++attempts===1)throw Error('network');
  return new Promise(resolve=>{finish=()=>resolve(row(1,{status:'CONCLUÍDO'}));});
 });
 await view.open();
 const select=root.querySelector('select[name=status]');for(const option of select.options)option.selected=option.value==='';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 const state=id=>root.querySelector(`[data-task-id="${id}"] .tar-status`);
 assert.match(state(1).textContent,/ATIVIDADE CRIADA.*FINALIZAR/);
 assert.match(state(5).textContent,/CONCLUÍDA/);assert.equal(state(5).querySelector('button'),null);assert.equal(state(3).querySelector('button'),null);
 assert.ok(state(6).querySelector('button'));assert.equal(root.querySelector('[data-metric=completed] strong').textContent,'2');
 const trigger=state(1).querySelector('button');trigger.click();
 const dialog=root.querySelector('[aria-label="Finalizar atividade"]');const form=dialog.querySelector('form');const input=form.querySelector('input[type=date]');
 const submit=form.querySelector('button[type=submit]');
 assert.equal(dialog.hidden,false);assert.match(dialog.textContent,/Conferir documentação/);assert.equal(input.value,'2026-10-06');
 form.querySelector('button[type=button]').click();assert.equal(dialog.hidden,true);assert.equal(dom.window.document.activeElement,trigger);assert.equal(attempts,0);
 trigger.click();input.value='2026-10-05';submit.click();await tick();assert.equal(dialog.hidden,false);assert.match(dialog.textContent,/Não foi possível/);
 submit.click();submit.click();assert.equal(submit.disabled,true);assert.equal(attempts,2);assert.match(state(1).textContent,/ATIVIDADE CRIADA/);
 finish();await tick();assert.equal(dialog.hidden,true);assert.match(state(1).textContent,/CONCLUÍDO/);assert.equal(state(1).querySelector('button'),null);
 assert.equal(root.querySelector('[data-metric=completed] strong').textContent,'3');assert.equal(root.querySelector('[data-metric=pending] strong').textContent,'2');
});
test('description ID supplier difficulty priority and multi-status filters compose without changing full-base counters',async t=>{
 const {view,root,dom}=setup(t);await view.open();const description=root.querySelector('[name=description]');description.value='INEXISTENTE';description.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(root.querySelectorAll('.tar-table').length,0);assert.equal(root.querySelector('[data-metric=total] strong').textContent,'4');
 description.value='conferir';description.dispatchEvent(new dom.window.Event('input',{bubbles:true}));const supplier=root.querySelector('select[name=supplier]');supplier.value='Edgar';supplier.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(root.querySelector('[data-task-id]').dataset.taskId,'4');assert.equal(root.querySelectorAll('[data-task-id]').length,1);supplier.value='';supplier.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 const status=root.querySelector('select[name=status]');for(const option of status.options)option.selected=option.value==='CONCLUÍDO';status.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(root.querySelector('[data-task-id]').dataset.taskId,'3');assert.equal(dom.window.getComputedStyle(root.querySelector('[data-task-id="3"]')).backgroundColor,'rgb(200, 230, 201)');assert.match(root.querySelector('[data-task-id="3"]').textContent,/✅ CONCLUÍDO/);assert.equal(root.querySelector('[data-metric=pending] strong').textContent,'3');
 root.querySelector('[aria-label="Abrir opções de STATUS"]').click();assert.equal(root.querySelector('[role=listbox][aria-label=STATUS]').getAttribute('aria-multiselectable'),'true');assert.equal(root.querySelector('.sfs-popup:not([hidden])').dataset.placement,'expanded');
});
test('resuming after consent restores the date and opens confirmation with the latest record even off the default filter',async t=>{
 let saves=0;const {view,root}=setup(t,async()=>({tasks:[row(7,{status:'CANCELADO',description:'Descrição atual'})]}),false,async()=>{saves++;});
 await view.open({finishDraft:{id:7,date:'2026-10-05'}});
 const dialog=root.querySelector('.tar-finish-overlay');assert.equal(dialog.hidden,false);
 assert.match(dialog.textContent,/#7 · Descrição atual/);assert.equal(dialog.querySelector('input').value,'2026-10-05');assert.equal(saves,0);
});
test('exports the status column before the finalization popup has ever opened',async t=>{
 const {view,root}=setup(t,async()=>snapshot,false,async()=>{});await view.open();
 const printed=captureFilteredReport(root,{title:'Atividades por associação'});
 const table=printed.pages[0].blocks.find(block=>block.type==='table');
 assert.equal(table.rows[0].cells.at(-1).runs[0].text,'STATUS');
 assert.equal(table.rows[1].cells.at(-1).runs[0].text,'ATIVIDADE CRIADA');
 assert.doesNotMatch(JSON.stringify(table),/FINALIZAR/);
});
test('date filter uses source ISO day with dd/mm/yyyy display and clears without changing totals',async t=>{
 const {view,root,dom}=setup(t);await view.open();const input=root.querySelector('input[name=dueDate]');input.value='2026-10-06';input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(root.querySelector('.tar-date-display').value,'06/10/2026');assert.equal(root.querySelector('[data-task-id]').dataset.taskId,'2');root.querySelector('[aria-label="Limpar data fatal"]').click();assert.equal(root.querySelectorAll('[data-task-id]').length,3);assert.equal(root.querySelector('.tar-date-display').value,'');assert.equal(root.querySelector('[data-metric=total] strong').textContent,'4');
});

test('blank priority is not fabricated and the visible date control opens its native calendar',async t=>{
 const {view,root,dom}=setup(t,async()=>({tasks:[row(1,{priority:''})]}));await view.open();assert.equal(root.querySelector('.tar-priority').textContent,'—');
 const native=root.querySelector('input[name=dueDate]');let opened=0;native.showPicker=()=>opened++;
 root.querySelector('.tar-date-display').click();root.querySelector('.tar-calendar').click();root.querySelector('.tar-date-display').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(opened,3);
});

test('arriving data restores focus to a rebuilt selector so Escape still closes the modal',async t=>{
 let finish;const {view,root,dom}=setup(t,()=>new Promise(resolve=>finish=resolve));const opening=view.open();const trigger=root.querySelector('select[name=supplier]').nextElementSibling.querySelector('.sfs-trigger');trigger.focus();assert.equal(dom.window.document.activeElement,trigger);finish(snapshot);await opening;
 const replacement=root.querySelector('select[name=supplier]').nextElementSibling.querySelector('.sfs-trigger');assert.equal(dom.window.document.activeElement,replacement);assert.equal(root.contains(dom.window.document.activeElement),true);dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.hidden,true);assert.equal(dom.window.document.getElementById('app').inert,false);
});
test('portrait avoids reads rotating loads and outside or Escape restore the original app and focus',async t=>{
 let reads=0;const {view,root,dom,rotate}=setup(t,async()=>{reads++;return snapshot;},true);const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();assert.equal(reads,1);assert.equal(root.querySelector('.tar-orientation').hidden,true);rotate(false);await tick();assert.equal(reads,1);root.querySelector('table').click();assert.equal(root.hidden,false);root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);assert.equal(dom.window.document.getElementById('app').inert,false);await view.open();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.hidden,true);
});
test('refresh removes stale totals failure offers retry and closed or rotated reads never paint stale tasks',async t=>{
 let reads=0;const {view,root}=setup(t,async()=>{if(reads++===1)throw Error('network');return snapshot;});await view.open();root.querySelector('.tar-refresh').click();assert.equal(root.querySelectorAll('.tar-card').length,0);await tick();assert.match(root.textContent,/Não foi possível/);root.querySelector('.tar-retry').click();await tick();assert.equal(root.querySelectorAll('.tar-card').length,3);
 let finish,signal;const late=setup(t,options=>{signal=options.signal;return new Promise(resolve=>finish=resolve);});const opening=late.view.open();late.rotate(true);assert.equal(signal.aborted,false);finish(snapshot);await opening;assert.equal(late.root.querySelectorAll('.tar-card').length,3);late.rotate(false);await tick();late.view.close();const second=late.view.open();late.view.close();assert.equal(signal.aborted,true);finish(snapshot);await second;assert.equal(late.root.hidden,true);assert.equal(late.root.querySelector('table'),null);
});
test('empty base renders zero counters while task text never becomes executable HTML',async t=>{
 const empty=setup(t,async()=>({tasks:[]}));await empty.view.open();assert.equal(empty.root.querySelectorAll('.tar-card').length,3);assert.equal(empty.root.querySelector('table'),null);assert.match(empty.root.textContent,/Nenhuma atividade/);
 const safe=setup(t,async()=>({tasks:[row(1,{description:'<script>alert(1)</script>',association:'<img src=x onerror=alert(1)>'})]}));await safe.view.open();assert.match(safe.root.textContent,/<script>/);assert.equal(safe.root.querySelectorAll('img,script').length,1);
});
test('closing after a HOME rerender focuses the current ninth mascot instead of the disconnected original',async t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;dom.window.matchMedia=()=>({matches:false});assert.equal(typeof createTaskAssociationReportView,'function');const chat=createChatView(dom.window.document.querySelector('#app'));const report=createTaskAssociationReportView({document:dom.window.document,data:{async loadSnapshot(){return snapshot;}},now:()=>new Date('2026-10-06T12:00:00Z')});t.after(()=>{report.destroy();chat.destroy();dom.window.close();});chat.render(home);const old=dom.window.document.querySelector('[data-action=open-task-association-report]');old.focus();await report.open();chat.render({...home,messages:[{...home.messages[0],options:[{id:'group_pending',label:'PENDÊNCIAS (1)'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]});const current=dom.window.document.querySelector('[data-action=open-task-association-report]');assert.notEqual(current,old);assert.equal(old.isConnected,false);report.close();assert.equal(dom.window.document.activeElement,current);
});
