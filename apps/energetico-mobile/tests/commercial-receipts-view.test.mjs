import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChatView,renderChatMarkup} from '../src/ui/chat-view.js';
const {createCommercialReceiptsReportView}=await import('../src/ui/commercial-receipts-view.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
export const snapshot={complete:true,
 properties:[{id:'1',branch:'001 - OURO PRETO',property:'740',visualStatus:'ATIVO',saleStatus:'VENDIDO',brokerage:'PAGO CLIENTE',invoice:'PENDENTE',fiscal:'DECLARADO'}],
 contracts:[{id:'10',branch:'001 - OURO PRETO',property:'740',buyer:'Yuri',status:'ATIVO',total:1000,saleDate:'2026-01-01',broker:'Corretor'}],
 clients:[{id:'1',branch:'001 - OURO PRETO',property:'740',name:'Yuri',definitive:'DEFINITIVO'}],
 receipts:[
 {id:'1',branch:'001 - OURO PRETO',property:'740',contractId:'10',buyer:'Yuri',amount:500,paidDate:'2026-10-01',dueDate:'2026-10-01',directBroker:'NÃO',description:'Entrada',paymentMethod:'PIX',account:'CAIXA',status:'PAGAMENTO EFETUADO'},
 {id:'2',branch:'001 - OURO PRETO',property:'740',contractId:'10',buyer:'Yuri',amount:100,paidDate:'2026-10-01',dueDate:'2026-10-01',directBroker:'SIM',description:'Comissão',paymentMethod:'PIX',account:'CAIXA',status:'PAGAMENTO EFETUADO'},
 {id:'3',branch:'001 - OURO PRETO',property:'740',contractId:'10',buyer:'Yuri',amount:400,paidDate:'',dueDate:'2026-10-04',directBroker:'NÃO',description:'Parcela',paymentMethod:'PIX',account:'CAIXA',status:'PAGAMENTO PREVISTO'}]};
function setup(t,loader=async()=>snapshot,vertical=false){
 assert.equal(typeof createCommercialReceiptsReportView,'function');
 const dom=new JSDOM('<main id="app"><button>Mascote</button></main>');let portrait=vertical;dom.window.matchMedia=()=>({get matches(){return portrait;}});
 const view=createCommercialReceiptsReportView({document:dom.window.document,data:{loadSnapshot:loader},now:()=>new Date('2026-10-05T12:00:00Z')});
 t.after(()=>{view.destroy();dom.window.close();});return {view,root:view.element,dom,rotate(v){portrait=v;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('first orange HOME mascot follows pink pending diaries and dispatches commercial receipts without stealing menu space',t=>{
 const dom=new JSDOM('<main id="app"></main>');dom.window.HTMLCanvasElement.prototype.getContext=()=>null;const view=createChatView(dom.window.document.querySelector('#app'));t.after(()=>{view.destroy();dom.window.close();});
 const state={sessionStatus:'authenticated',account:{name:'Bernardo'},draft:'',pendingFiles:[],messages:[{id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[{id:'group_pending',label:'PENDÊNCIAS'},{id:'group_supplies',label:'SUPRIMENTOS'}]}]};
 let calls=0;view.on('open-commercial-receipts',()=>calls++);view.render(state);const b=dom.window.document.querySelector('[data-action=open-commercial-receipts]');assert.ok(b);assert.equal(b.previousElementSibling.dataset.action,'open-pending-work-diaries-report');assert.equal(b.closest('.chat-bubble'),null);b.querySelector('img').click();assert.equal(calls,1);
 view.render({...state,activeText:{id:'busy'}});assert.equal(dom.window.document.querySelector('[data-action=open-commercial-receipts]').disabled,true);assert.equal(new JSDOM(renderChatMarkup({...state,activeFlow:'busy'})).window.document.querySelector('[data-action=open-commercial-receipts]'),null);
});
test('commercial report has five filters, branded colored indicators, ten property columns and pending payments',async t=>{
 const {view,root}=setup(t);await view.open();assert.deepEqual([...root.querySelectorAll('.cr-filters select')].map(n=>n.name),['branch','contractId','buyer','property','contractStatus']);assert.ok(root.querySelector('img[alt="Logo Energética"]'));assert.equal(root.querySelectorAll('.cr-indicators>.cr-card').length,4);assert.match(root.querySelector('.cr-indicators').textContent,/1\.000,00.*600,00.*400,00.*ATIVOS: 1.*INATIVOS: 0/s);assert.equal(root.querySelectorAll('.cr-properties thead th').length,10);assert.match(root.querySelector('.cr-properties').textContent,/740.*Yuri.*60% PAGO.*500,00.*100,00.*400,00.*1\.000,00/s);assert.match(root.querySelector('.cr-pending').textContent,/04\/10\/2026.*Parcela.*400,00.*ATRASADO/s);assert.equal(root.querySelectorAll('.cr-contract').length,0);assert.equal(root.querySelector('.pl-close'),null);
});
test('contract selection opens source contract summary, eight payment columns and broker-separated totals',async t=>{
 const {view,root,dom}=setup(t);await view.open();const s=root.querySelector('[name=contractId]');s.value='10';s.dispatchEvent(new dom.window.Event('change'));assert.equal(root.querySelectorAll('.cr-contract').length,1);assert.match(root.querySelector('.cr-contract').textContent,/CONTRATO: 10.*Yuri.*01\/01\/2026.*Corretor/s);assert.equal(root.querySelectorAll('.cr-payments thead th').length,8);assert.equal(root.querySelectorAll('.cr-payments tbody tr').length,3);assert.match(root.querySelector('.cr-payments').textContent,/PAGO DIRETO AO CORRETOR/);assert.match(root.querySelector('.cr-payments tfoot').textContent,/VALOR PAGO.*500,00.*DIRETO AO CORRETOR.*100,00.*PENDENTE.*400,00.*TOTAL GERAL.*1\.000,00/s);
 root.querySelector('[aria-label="Abrir opções de COMPRADOR"]').click();assert.equal(root.querySelector('.sfs-popup:not([hidden])').dataset.placement,'expanded');
});
test('portrait defers query, rotation opens and outside or Escape closes restoring focus',async t=>{
 let calls=0;const {view,root,dom,rotate}=setup(t,async()=>{calls++;return snapshot;},true);const trigger=dom.window.document.querySelector('button');trigger.focus();await view.open();assert.equal(calls,0);assert.equal(root.querySelector('.pl-orientation').hidden,false);rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);root.querySelector('.cr-properties').click();assert.equal(root.hidden,false);root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);await view.open();root.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(root.hidden,true);assert.equal(dom.window.document.body.style.overflow,'');
});
test('refresh failure and late query after close never expose stale totals',async t=>{
 let calls=0;const {view,root}=setup(t,async()=>{if(calls++)throw Error('network');return snapshot;});await view.open();root.querySelector('[aria-label="Atualizar contratos e pagamentos"]').click();await new Promise(r=>setImmediate(r));assert.equal(root.querySelectorAll('.cr-properties').length,0);assert.match(root.querySelector('.pl-notice').textContent,/Não foi possível/);let finish,signal;const pending=setup(t,o=>{signal=o.signal;return new Promise(r=>finish=r);});const p=pending.view.open();pending.view.close();assert.equal(signal.aborted,true);finish(snapshot);await p;assert.equal(pending.root.querySelectorAll('.cr-card').length,0);
});
test('untrusted property and buyer labels render only as text',async t=>{
 const malicious='<img onerror=alert(1)>';const altered=structuredClone(snapshot);for(const group of ['properties','contracts','clients','receipts'])for(const row of altered[group])row.property=malicious;altered.clients[0].name=malicious;altered.contracts[0].buyer=malicious;for(const row of altered.receipts)row.buyer=malicious;const {view,root}=setup(t,async()=>altered);await view.open();assert.match(root.querySelector('.cr-properties').textContent,/<img onerror=alert\(1\)>/);assert.equal(root.querySelectorAll('.cr-properties img').length,0);
});
test('specific property indicator preserves actual visual status independently of contract status',async t=>{
 const input=structuredClone(snapshot);input.properties[0].visualStatus='INATIVO';const {view,root,dom}=setup(t,async()=>input);await view.open();const s=root.querySelector('[name=property]');s.value='740';s.dispatchEvent(new dom.window.Event('change'));assert.equal(root.querySelector('.cr-indicators>.cr-card:last-child>strong').textContent,'INATIVO');
});
test('buyer filter includes registered clients and unlinked receipt buyers, not only contracts',async t=>{
 const input=structuredClone(snapshot);input.clients.push({...input.clients[0],id:'2',name:'Cliente sem contrato'});input.receipts.push({...input.receipts[0],id:'4',contractId:'',buyer:'Receita sem contrato'});const {view,root}=setup(t,async()=>input);await view.open();const options=[...root.querySelector('[name=buyer]').options].map(o=>o.value);assert.ok(options.includes('Cliente sem contrato'));assert.ok(options.includes('Receita sem contrato'));
});
