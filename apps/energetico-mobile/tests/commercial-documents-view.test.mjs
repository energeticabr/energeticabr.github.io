import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {createChatView,renderChatMarkup} from '../src/ui/chat-view.js';
const {createCommercialDocumentsReportView}=await import('../src/ui/commercial-documents-view.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const property=(id,changes={})=>({id,branch:'001 - OURO PRETO',property:'730',saleStatus:'VENDIDO',visualStatus:'ATIVO',fiscal:'DECLARADO',insurance:'DISPENSADO',proposal:'5, 31',bankContract:'',deed:'7',brokerDocument:'',fiscalDocument:'198',fiscalPayment:'',brokerPayment:'',fiscalObservation:'Conferir documento fiscal',brokerage:'PAGO CLIENTE',broker:'Corretor',brokerDescription:'Contrato',fiscalValue:'0',brokerValue:'500',...changes});
const snapshot={complete:true,properties:[property('1'),property('2',{property:'740',saleStatus:'NÃO VENDIDO'})],contracts:[{id:'21',branch:'001 - OURO PRETO',property:'730',buyer:'Comprador A',status:'ATIVO',total:'1000',saleDate:'2026-01-01',broker:'Corretor'}],documents:[{id:'198',createdDate:'2026-07-24'},{id:'7',createdDate:'2026-01-01'}],expenses:[],receipts:[{id:'1',contractId:'21',createdDate:'2026-01-01',dueDate:'2026-10-04',paidDate:'',description:'Parcela',amount:'500',status:'PAGAMENTO PREVISTO'}]};
function setup(t,loader=async()=>snapshot,vertical=false){
 assert.equal(typeof createCommercialDocumentsReportView,'function');
 const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let portrait=vertical;dom.window.matchMedia=()=>({get matches(){return portrait;}});
 const style=dom.window.document.createElement('style');style.textContent=readFileSync(new URL('../src/ui/commercial-documents.css',import.meta.url),'utf8');dom.window.document.head.append(style);
 const view=createCommercialDocumentsReportView({document:dom.window.document,data:{loadSnapshot:loader},now:()=>new Date('2026-10-05T12:00:00Z')});
 t.after(()=>{view.destroy();dom.window.close();});return {view,root:view.element,dom,rotate(v){portrait=v;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('sixth right HOME mascot follows commercial milestones outside menu and invokes own event',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 const state={sessionStatus:'authenticated',account:{name:'Bernardo'},draft:'',pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
 let calls=0;view.on('open-commercial-documents',()=>calls++);view.render(state);const button=dom.window.document.querySelector('[data-action=open-commercial-documents]');assert.ok(button);assert.equal(button.previousElementSibling.dataset.action,'open-commercial-milestones');assert.equal(button.closest('.chat-bubble'),null);button.querySelector('img').click();assert.equal(calls,1);
 view.render({...state,activeText:{id:'busy'}});assert.equal(dom.window.document.querySelector('[data-action=open-commercial-documents]').disabled,true);assert.equal(new JSDOM(renderChatMarkup({...state,activeFlow:'busy'})).window.document.querySelector('[data-action=open-commercial-documents]'),null);
});
test('summary shows eight cards, thirteen columns, proper colors and all-status default',async t=>{
 const {view,root,dom}=setup(t);await view.open();assert.deepEqual([...root.querySelectorAll('.cd-filters select')].map(n=>n.name),['branch','contractId','buyer','property','saleStatus']);assert.equal(root.querySelector('[name=saleStatus]').value,'');assert.ok(root.querySelector('img[alt="Logo Energética"]'));assert.equal(root.querySelectorAll('.cd-card').length,8);assert.equal(root.querySelectorAll('.cd-properties thead th').length,13);assert.equal(root.querySelectorAll('.cd-properties tbody tr').length,2);
 assert.equal(root.querySelector('[data-metric=total] strong').textContent,'9');assert.equal(root.querySelector('[data-metric=proposal] strong').textContent,'0');assert.equal(dom.window.getComputedStyle(root.querySelector('[data-metric=bankContract]')).color,'rgb(198, 40, 40)');assert.equal(dom.window.getComputedStyle(root.querySelector('[data-metric=proposal]')).color,'rgb(46, 125, 50)');
 assert.match(root.querySelector('.cd-properties tbody').textContent,/DISPENSADO.*5, 31.*SEM DATA/s);assert.match(root.querySelector('.cd-properties tbody').textContent,/198.*24\/07\/2026/s);assert.equal(root.querySelector('.pl-close'),null);
});
test('contract selection replaces summary with property, fiscal, brokerage, contract and payment detail',async t=>{
 const {view,root,dom}=setup(t);await view.open();const s=root.querySelector('[name=contractId]');s.value='21';s.dispatchEvent(new dom.window.Event('change'));assert.equal(root.querySelectorAll('.cd-properties').length,0);assert.equal(root.querySelectorAll('.cd-property-detail').length,1);assert.equal(root.querySelectorAll('.cd-contract').length,1);assert.equal(root.querySelectorAll('.cd-payments thead th').length,6);
 assert.match(root.textContent,/INFORMAÇÕES FISCAIS.*Valor Fiscal.*R\$\s*0,00.*INFORMAÇÕES DE CORRETAGEM.*DOCUMENTOS DO IMÓVEL.*INFORMAÇÕES DO CONTRATO.*Comprador A.*DETALHAMENTO PGTOS.*04\/10\/2026.*Parcela.*500,00/s);
 assert.equal(root.querySelector('.cd-payments tbody tr').dataset.tone,'danger');root.querySelector('[aria-label="Abrir opções de COMPRADOR"]').click();assert.equal(root.querySelector('.sfs-popup:not([hidden])').dataset.placement,'expanded');
});
test('document cells retain pending green and dispensed colors independently of metric cards',async t=>{
 const {view,root,dom}=setup(t);await view.open();const cells=root.querySelector('.cd-properties tbody tr').cells;
 assert.equal(dom.window.getComputedStyle(cells[3]).color,'rgb(46, 125, 50)');
 assert.equal(dom.window.getComputedStyle(cells[4]).color,'rgb(198, 40, 40)');
 assert.equal(dom.window.getComputedStyle(cells[8]).backgroundColor,'rgb(255, 243, 205)');
 assert.equal(dom.window.getComputedStyle(cells[9]).color,'rgb(46, 125, 50)');
 assert.match(cells[3].textContent,/✅ 198/);assert.match(cells[4].textContent,/❌ PENDENTE/);assert.match(cells[8].textContent,/⚠️ DISPENSADO/);
});
test('detail preserves nonnumeric fiscal and brokerage text values as in PowerFx',async t=>{
 const input=structuredClone(snapshot);input.properties[0].fiscalValue='ISENTO';input.properties[0].brokerValue='DISPENSADO';
 const {view,root,dom}=setup(t,async()=>input);await view.open();const select=root.querySelector('[name=contractId]');select.value='21';select.dispatchEvent(new dom.window.Event('change'));
 assert.match(root.querySelector('.cd-detail-fields').textContent,/Valor FiscalISENTO.*Valor CorretagemDISPENSADO/s);
});
test('portrait loads nothing, rotation loads once, outside and Escape restore focus',async t=>{
 let calls=0;const {view,root,dom,rotate}=setup(t,async()=>{calls++;return snapshot;},true);const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();assert.equal(calls,0);assert.equal(root.querySelector('.pl-orientation').hidden,false);rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);root.querySelector('table').click();assert.equal(root.hidden,false);root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);await view.open();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.hidden,true);assert.equal(dom.window.document.body.style.overflow,'');
});
test('failed refresh and closed late response cannot retain previous financial rows',async t=>{
 let calls=0;const {view,root}=setup(t,async()=>{if(calls++)throw Error('network');return snapshot;});await view.open();root.querySelector('[aria-label="Atualizar pendências comerciais"]').click();await new Promise(r=>setImmediate(r));assert.equal(root.querySelectorAll('table').length,0);assert.match(root.querySelector('.pl-notice').textContent,/Não foi possível/);let finish,signal;const pending=setup(t,o=>{signal=o.signal;return new Promise(r=>finish=r);});const p=pending.view.open();pending.view.close();assert.equal(signal.aborted,true);finish(snapshot);await p;assert.equal(pending.root.querySelectorAll('table').length,0);
});
test('property, document and contract strings never become executable markup',async t=>{
 const input=structuredClone(snapshot);input.properties[0].property='<img onerror=alert(1)>';input.properties[0].proposal='<script>alert(1)</script>';input.contracts[0].property=input.properties[0].property;input.contracts[0].buyer='<img onerror=alert(1)>';const {view,root}=setup(t,async()=>input);await view.open();assert.match(root.querySelector('tbody').textContent,/<img onerror=alert\(1\)>/);assert.equal(root.querySelectorAll('tbody img,tbody script').length,0);
});
