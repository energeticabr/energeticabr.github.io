import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createChatView,renderChatMarkup} from '../src/ui/chat-view.js';
const {createCommercialMilestonesReportView}=await import('../src/ui/commercial-milestones-view.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const row=(id,changes={})=>({id,branch:'001 - OURO PRETO',property:'730',contractId:'21',buyer:'Julberto',type:'PAGAMENTO IMPOSTOS',description:'Conferir imposto',startDate:'2026-05-04',dueDate:'',status:'ATIVIDADE INICIADA',...changes});
const snapshot={complete:true,properties:[{id:'1',branch:'001 - OURO PRETO',property:'730',visualStatus:'ATIVO'},{id:'2',branch:'001 - OURO PRETO',property:'740',visualStatus:'INATIVO'}],milestones:[row('1',{type:'Marco anterior',dueDate:'2026-01-01',startDate:'2026-01-01'}),row('2',{dueDate:'2026-10-04'}),row('3',{property:'740',buyer:'Outro',status:'ATIVIDADE FINALIZADA'})]};
function setup(t,loader=async()=>snapshot,vertical=false){
 assert.equal(typeof createCommercialMilestonesReportView,'function');
 const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let portrait=vertical;dom.window.matchMedia=()=>({get matches(){return portrait;}});
 const view=createCommercialMilestonesReportView({document:dom.window.document,data:{loadSnapshot:loader},now:()=>new Date('2026-10-05T12:00:00Z')});
 t.after(()=>{view.destroy();dom.window.close();});return {view,root:view.element,dom,rotate(v){portrait=v;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('fifth right HOME mascot follows commercial receipts outside the menu and dispatches its own report',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 const state={sessionStatus:'authenticated',account:{name:'Bernardo'},draft:'',pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
 let calls=0;view.on('open-commercial-milestones',()=>calls++);view.render(state);const button=dom.window.document.querySelector('[data-action=open-commercial-milestones]');assert.ok(button);assert.equal(button.previousElementSibling.dataset.action,'open-commercial-receipts');assert.equal(button.closest('.chat-bubble'),null);button.querySelector('img').click();assert.equal(calls,1);
 view.render({...state,activeText:{id:'busy'}});assert.equal(dom.window.document.querySelector('[data-action=open-commercial-milestones]').disabled,true);assert.equal(new JSDOM(renderChatMarkup({...state,activeFlow:'busy'})).window.document.querySelector('[data-action=open-commercial-milestones]'),null);
});
test('active default shows the latest property milestone with nine columns and source styling',async t=>{
 const {view,root}=setup(t);await view.open();assert.deepEqual([...root.querySelectorAll('.cm-filters select')].map(n=>n.name),['branch','contractId','buyer','property','visualStatus']);assert.equal(root.querySelector('[name=visualStatus]').value,'ATIVO');assert.ok(root.querySelector('img[alt="Logo Energética"]'));assert.match(root.textContent,/ÚLTIMO ANDAMENTO POR IMÓVEL/);assert.equal(root.querySelectorAll('thead th').length,9);assert.equal(root.querySelectorAll('tbody tr').length,1);assert.match(root.querySelector('tbody').textContent,/730.*Julberto.*21.*PAGAMENTO IMPOSTOS.*04\/05\/2026.*154 DIA\(S\) DE ANDAMENTO.*04\/10\/2026.*VENCIDA HÁ 1 DIA\(S\)/s);assert.equal(root.querySelector('tbody tr').dataset.tone,'danger');assert.equal(root.querySelector('.cm-status').dataset.tone,'warning');assert.match(root.querySelector('tfoot').textContent,/TOTAL DE IMÓVEIS NA FILIAL: 1/);assert.equal(root.querySelector('.pl-close'),null);
});
test('selecting a contract exposes all milestone history and highlights only newest dates',async t=>{
 const {view,root,dom}=setup(t);await view.open();const s=root.querySelector('[name=contractId]');s.value='21';s.dispatchEvent(new dom.window.Event('change'));assert.match(root.textContent,/DETALHAMENTO DOS CONTRATOS.*HISTÓRICO COMPLETO DE TIPOMARCO/s);const rows=[...root.querySelectorAll('tbody tr')];assert.equal(rows.length,2);assert.equal(rows[0].dataset.tone,'danger');assert.equal(rows[1].dataset.tone,'neutral');assert.equal(rows[0].querySelector('.cm-branch').rowSpan,2);assert.equal(rows[0].querySelector('.cm-property').rowSpan,2);assert.equal(rows[0].querySelector('.cm-buyer').rowSpan,2);assert.equal(rows[0].querySelector('.cm-contract').rowSpan,2);assert.match(root.querySelector('tfoot').textContent,/TOTAL DE ANDAMENTOS NA FILIAL: 2/);root.querySelector('[aria-label="Abrir opções de COMPRADOR"]').click();assert.equal(root.querySelector('.sfs-popup:not([hidden])').dataset.placement,'below');
});
test('clearing active status exposes inactive properties without inventing blank dates or labels',async t=>{
 const input=structuredClone(snapshot);input.milestones[2]={...input.milestones[2],startDate:'',dueDate:'',buyer:'',contractId:''};const {view,root,dom}=setup(t,async()=>input);await view.open();const s=root.querySelector('[name=visualStatus]');s.value='';s.dispatchEvent(new dom.window.Event('change'));assert.equal(root.querySelectorAll('tbody tr').length,2);assert.match(root.querySelector('tbody').textContent,/N\/A.*CONTRATO NÃO APONTADO.*NÃO INDICADO/s);assert.equal(root.querySelectorAll('.cm-status[data-tone=success]').length,1);
});
test('portrait defers loading, rotation opens and outside or Escape restores focus',async t=>{
 let calls=0;const {view,root,dom,rotate}=setup(t,async()=>{calls++;return snapshot;},true);const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();assert.equal(calls,0);assert.equal(root.querySelector('.pl-orientation').hidden,false);rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);root.querySelector('table').click();assert.equal(root.hidden,false);root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);await view.open();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.hidden,true);assert.equal(dom.window.document.body.style.overflow,'');
});
test('failed refresh and late loads after closing never show stale milestones',async t=>{
 let calls=0;const {view,root}=setup(t,async()=>{if(calls++)throw Error('network');return snapshot;});await view.open();root.querySelector('[aria-label="Atualizar andamentos comerciais"]').click();await new Promise(r=>setImmediate(r));assert.equal(root.querySelectorAll('table').length,0);assert.match(root.querySelector('.pl-notice').textContent,/Não foi possível/);let finish,signal;const pending=setup(t,o=>{signal=o.signal;return new Promise(r=>finish=r);});const p=pending.view.open();pending.view.close();assert.equal(signal.aborted,true);finish(snapshot);await p;assert.equal(pending.root.querySelectorAll('table').length,0);
});
test('milestone descriptions and buyer labels remain text rather than executable markup',async t=>{
 const input=structuredClone(snapshot);input.milestones[1].buyer='<img onerror=alert(1)>';input.milestones[1].description='<script>alert(1)</script>';const {view,root}=setup(t,async()=>input);await view.open();assert.match(root.querySelector('tbody').textContent,/<img onerror=alert\(1\)>/);assert.equal(root.querySelectorAll('tbody img,tbody script').length,0);
});

test('overdue row keeps normal buyer and description color while emphasizing its deadline',async t=>{
 const {view,root,dom}=setup(t);const style=dom.window.document.createElement('style');style.textContent=readFileSync(new URL('../src/ui/commercial-milestones.css',import.meta.url),'utf8');dom.window.document.head.append(style);await view.open();
 const row=root.querySelector('tbody tr[data-tone=danger]');for(const cls of ['cm-buyer','cm-description'])assert.equal(dom.window.getComputedStyle(row.querySelector('.'+cls)).color,'rgb(38, 55, 70)');assert.equal(dom.window.getComputedStyle(row.querySelector('.cm-days[data-tone=danger]')).color,'rgb(180, 35, 24)');
});
