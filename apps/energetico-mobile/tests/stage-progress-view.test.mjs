import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChatView,renderChatMarkup} from '../src/ui/chat-view.js';
const {createStageProgressReportView}=await import('../src/ui/stage-progress-view.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const snapshot={complete:true,activities:[
 {id:'1',branch:'004 - XAVANTE',stage:'ALVENARIA',activity:'PAREDES',property:'TODOS',supplier:'Edgar',executionDate:'2026-08-10',plannedDate:'',status:'ATIVIDADE INICIADA'},
 {id:'2',branch:'004 - XAVANTE',stage:'ALVENARIA',activity:'PILARES',property:'TODOS',supplier:'Edgar',executionDate:'2026-09-09',plannedDate:'2026-09-10',status:'ATIVIDADE FINALIZADA'},
],launches:[{id:'1',branch:'004 - XAVANTE',stage:'ALVENARIA',startDate:'2026-08-10',endDate:'',status:'INICIADO',percent:25}]};
function setup(t,loader=async()=>snapshot,vertical=false){
 assert.equal(typeof createStageProgressReportView,'function','stage report must be implemented');
 const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let portrait=vertical;
 dom.window.matchMedia=()=>({get matches(){return portrait;}});
 const view=createStageProgressReportView({document:dom.window.document,data:{loadSnapshot:loader},now:()=>new Date('2026-10-05T12:00:00Z')});
 t.after(()=>{view.destroy();dom.window.close();});
 return {view,root:view.element,dom,rotate(v){portrait=v;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('third right HOME mascot follows attendance and dispatches its own local report',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
 const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 const state={sessionStatus:'authenticated',account:{name:'Bernardo'},draft:'',pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
 let calls=0;view.on('open-stage-progress',()=>calls++);view.render(state);
 const root=dom.window.document.querySelector('#app'),shortcut=root.querySelector('[data-action=open-stage-progress]');
 assert.ok(shortcut);assert.equal(shortcut.previousElementSibling.dataset.action,'open-attendance-summary');
 assert.equal(shortcut.closest('.chat-bubble'),null);shortcut.querySelector('img').click();assert.equal(calls,1);
 assert.deepEqual([...root.querySelectorAll('.chat-main-payment-ledger-shortcut')].map(node=>node.dataset.action),['open-provision-report','open-payment-ledger','open-management-report','open-order-validation-report','open-quotation-report','open-depreciation-report']);
 view.render({...state,activeText:{id:'busy'}});assert.equal(root.querySelector('[data-action=open-stage-progress]').disabled,true);
 assert.equal(new JSDOM(renderChatMarkup({...state,activeFlow:'flow'})).window.document.querySelector('[data-action=open-stage-progress]'),null);
});
test('stage report shows supplied six-filter order, initial statuses, logo, percentage and eight activity columns',async t=>{
 const {view,root,dom}=setup(t);await view.open();
 assert.deepEqual([...root.querySelectorAll('.sp-filters select')].map(e=>e.name),['branch','supplier','stage','launchStatus','activity','status']);
 assert.equal(root.querySelector('[name=launchStatus]').value,'INICIADO');assert.equal(root.querySelector('[name=status]').value,'ATIVIDADE INICIADA');
 assert.ok(root.querySelector('img[alt="Logo Energética"]'));
 assert.match(root.querySelector('.sp-stage-summary').textContent,/25%.*10\/08\/2026.*HOJE.*56 dias/s);
 assert.equal(root.querySelectorAll('.sp-activities thead th').length,8);
 assert.equal(root.querySelectorAll('.sp-activities tbody tr').length,1);
 assert.match(root.querySelector('.sp-results').textContent,/PAREDES.*Edgar.*10\/08\/2026.*56 dias/s);
 assert.equal(root.querySelector('.pl-close'),null);
 const status=root.querySelector('[name=status]');status.value='';status.dispatchEvent(new dom.window.Event('change'));
 assert.equal(root.querySelectorAll('.sp-activities tbody tr').length,2);
 root.querySelector('[aria-label="Abrir opções de COLABORADOR"]').click();assert.equal(root.querySelector('.sfs-popup:not([hidden])').dataset.placement,'below');
});
test('portrait defers SharePoint, rotation loads, outside and Escape restore focus',async t=>{
 let calls=0;const {view,root,dom,rotate}=setup(t,async()=>{calls++;return snapshot;},true);
 const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();assert.equal(calls,0);
 assert.equal(root.querySelector('.pl-orientation').hidden,false);rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 root.querySelector('.sp-stage-summary').click();assert.equal(root.hidden,false);
 root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);
 await view.open();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.hidden,true);
 assert.equal(dom.window.document.body.style.overflow,'');
});

test('branch and stage filters include launches with zero activities',async t=>{
 const {view,root,dom}=setup(t,async()=>({...snapshot,launches:[...snapshot.launches,
  {...snapshot.launches[0],id:'2',stage:'LIMPEZA'},
  {...snapshot.launches[0],id:'3',branch:'000 - ESCRITÓRIO',stage:'PLANEJAMENTO'},
 ]}));
 await view.open();
 assert.ok([...root.querySelector('[name=stage]').options].some(o=>o.value==='LIMPEZA'));
 assert.ok([...root.querySelector('[name=branch]').options].some(o=>o.value==='000 - ESCRITÓRIO'));
 const status=root.querySelector('[name=status]');status.value='';status.dispatchEvent(new dom.window.Event('change'));
 const branch=root.querySelector('[name=branch]');branch.value='000 - ESCRITÓRIO';branch.dispatchEvent(new dom.window.Event('change'));
 assert.match(root.querySelector('.sp-stage-summary').textContent,/PLANEJAMENTO/);
 assert.equal(root.querySelectorAll('.sp-activities tbody tr').length,0);
 assert.match(root.querySelector('.sp-total').textContent,/0$/);
});
test('missing dates do not invent day counts and labels remain text rather than markup',async t=>{
 const {view,root}=setup(t,async()=>({...snapshot,activities:[{...snapshot.activities[0],activity:'<img onerror=alert(1)>',executionDate:''}],launches:[{...snapshot.launches[0],startDate:'',percent:null}]}));
 await view.open();assert.match(root.querySelector('.sp-activities').textContent,/<img onerror=alert\(1\)>/);
 assert.equal(root.querySelectorAll('.sp-activities img').length,0);assert.equal(root.querySelector('.sp-duration').textContent,'—');
 assert.match(root.querySelector('.sp-stage-summary').textContent,/PERCENTUAL INDISPONÍVEL/);
});
test('failed refresh and a closed outstanding query cannot display stale activities',async t=>{
 let calls=0;const {view,root}=setup(t,async()=>{if(calls++)throw Error('network');return snapshot;});await view.open();
 root.querySelector('.pl-refresh').click();await new Promise(r=>setImmediate(r));assert.equal(root.querySelectorAll('.sp-stage').length,0);assert.match(root.querySelector('.pl-notice').textContent,/Não foi possível/);
 let finish,signal;const pending=setup(t,o=>{signal=o.signal;return new Promise(r=>finish=r);});const p=pending.view.open();pending.view.close();assert.equal(signal.aborted,true);finish(snapshot);await p;
 assert.equal(pending.root.querySelectorAll('.sp-stage').length,0);
});
