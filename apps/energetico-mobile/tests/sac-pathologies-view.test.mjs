import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createChatView,renderChatMarkup} from '../src/ui/chat-view.js';
const {createSacPathologiesReportView}=await import('../src/ui/sac-pathologies-view.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const row=(id,changes={})=>({id,branch:'002 - OURO PRETO',property:'720A',client:'RAYNER CORREIA DE CASTRO',type:'AUSÊNCIA DE ÁGUA BANHEIRO',status:'ATIVO',description:'Verificar o registro da caixa de água.',startDate:'2026-09-12',endDate:'',cost:0,...changes});
const snapshot={complete:true,rows:[row('5'),row('3',{branch:'001 - OURO PRETO',property:'740',client:'YURI DE ABREU SILVA',type:'TESTE',startDate:'2026-08-15',cost:125.5}),row('6',{status:'INATIVO',endDate:'2026-09-20',cost:50})]};
function setup(t,loader=async()=>snapshot,vertical=false){
 assert.equal(typeof createSacPathologiesReportView,'function');
 const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let portrait=vertical;dom.window.matchMedia=()=>({get matches(){return portrait;}});
 const style=dom.window.document.createElement('style');style.textContent=readFileSync(new URL('../src/ui/sac-pathologies.css',import.meta.url),'utf8');dom.window.document.head.append(style);
 const view=createSacPathologiesReportView({document:dom.window.document,data:{loadSnapshot:loader},now:()=>new Date('2026-10-05T12:00:00Z')});
 t.after(()=>{view.destroy();dom.window.close();});return {view,root:view.element,dom,rotate(v){portrait=v;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('seventh right HOME mascot follows documents and opens own report without choosing a menu flow',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 const state={sessionStatus:'authenticated',account:{name:'Bernardo'},draft:'',pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
 let calls=0;view.on('open-sac-pathologies',()=>calls++);view.render(state);const button=dom.window.document.querySelector('[data-action=open-sac-pathologies]');assert.ok(button);assert.equal(button.previousElementSibling.dataset.action,'open-commercial-documents');assert.equal(button.closest('.chat-bubble'),null);button.querySelector('img').click();assert.equal(calls,1);
 view.render({...state,activeText:{id:'busy'}});assert.equal(dom.window.document.querySelector('[data-action=open-sac-pathologies]').disabled,true);assert.equal(new JSDOM(renderChatMarkup({...state,activeFlow:'busy'})).window.document.querySelector('[data-action=open-sac-pathologies]'),null);
});
test('source layout has six filters active default four live metrics and eight readable columns',async t=>{
 const {view,root,dom}=setup(t);await view.open();assert.deepEqual([...root.querySelectorAll('.sap-filters select')].map(n=>n.name),['id','branch','property','client','type','status']);assert.equal(root.querySelector('[name=status]').value,'ATIVO');assert.ok(root.querySelector('img[alt="Logo Energética"]'));assert.equal(root.querySelectorAll('.sap-card').length,4);assert.equal(root.querySelectorAll('.sap-table thead th').length,8);assert.equal(root.querySelectorAll('.sap-table tbody tr').length,2);
 assert.equal(root.querySelector('[data-metric=total] strong').textContent,'2');assert.equal(root.querySelector('[data-metric=active] strong').textContent,'2');assert.equal(root.querySelector('[data-metric=inactive] strong').textContent,'0');assert.match(root.querySelector('[data-metric=costTotal] strong').textContent,/R\$\s*125,50/);
 assert.match(root.querySelector('tbody').textContent,/12\/09\/2026.*EM ANDAMENTO.*23 dias.*15\/08\/2026.*51 dias/s);assert.equal(dom.window.getComputedStyle(root.querySelector('.sap-active')).color,'rgb(27, 110, 45)');assert.equal(root.querySelector('.pl-close'),null);
});
test('all statuses and explicit ID update metrics and rows through real filter changes',async t=>{
 const {view,root,dom}=setup(t);await view.open();const status=root.querySelector('[name=status]');status.value='';status.dispatchEvent(new dom.window.Event('change'));assert.equal(root.querySelector('[data-metric=total] strong').textContent,'3');assert.match(root.querySelector('[data-metric=costTotal] strong').textContent,/175,50/);assert.match(root.querySelector('tbody').textContent,/20\/09\/2026/);
 const id=root.querySelector('[name=id]');id.value='6';id.dispatchEvent(new dom.window.Event('change'));assert.equal(root.querySelectorAll('tbody tr').length,1);assert.equal(root.querySelector('[data-metric=inactive] strong').textContent,'1');assert.match(root.querySelector('tbody').textContent,/8 dias/);root.querySelector('[aria-label="Abrir opções de CLIENTE"]').click();assert.equal(root.querySelector('.sfs-popup:not([hidden])').dataset.placement,'below');
});
test('portrait makes no read rotation loads and backdrop or Escape restores app and focus',async t=>{
 let calls=0;const {view,root,dom,rotate}=setup(t,async()=>{calls++;return snapshot;},true);const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();assert.equal(calls,0);assert.equal(root.querySelector('.pl-orientation').hidden,false);rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);root.querySelector('table').click();assert.equal(root.hidden,false);root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);assert.equal(dom.window.document.getElementById('app').inert,false);await view.open();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.hidden,true);assert.equal(dom.window.document.body.style.overflow,'');
});
test('refresh failure erases stale rows and a closed late read cannot paint data',async t=>{
 let calls=0;const {view,root}=setup(t,async()=>{if(calls++)throw Error('network');return snapshot;});await view.open();root.querySelector('[aria-label="Atualizar patologias"]').click();await new Promise(r=>setImmediate(r));assert.equal(root.querySelectorAll('table').length,0);assert.equal(root.querySelectorAll('.sap-card').length,0);assert.match(root.querySelector('.pl-notice').textContent,/Não foi possível/);
 let finish,signal;const pending=setup(t,o=>{signal=o.signal;return new Promise(r=>finish=r);});const p=pending.view.open();pending.view.close();assert.equal(signal.aborted,true);finish(snapshot);await p;assert.equal(pending.root.querySelectorAll('table').length,0);
});
test('empty result keeps zero metrics and source data is safe text not executable HTML',async t=>{
 const {view,root}=setup(t,async()=>({complete:true,rows:[]}));await view.open();assert.equal(root.querySelector('[data-metric=total] strong').textContent,'0');assert.match(root.querySelector('tbody').textContent,/Nenhum registro encontrado/);
 const input={complete:true,rows:[row('5',{description:'<img src=x onerror=alert(1)>',client:'<script>alert(1)</script>',type:'<svg onload=alert(1)>'})]};const other=setup(t,async()=>input);await other.view.open();assert.match(other.root.querySelector('tbody').textContent,/<img src=x onerror=alert\(1\)>/);assert.equal(other.root.querySelectorAll('tbody img,tbody script,tbody svg').length,0);
});
