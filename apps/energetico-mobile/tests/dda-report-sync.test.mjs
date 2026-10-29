import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDdaReportView} from '../src/ui/dda-report-view.js';
const tick=()=>new Promise(r=>setImmediate(r));
async function setup(t){
 const dom=new JSDOM('<body><main id="app"></main></body>'),doc=dom.window.document,listeners=new Set();
 let running=false,starts=0,loads=0,destroys=0,fail=false;
 const emit=value=>{running=value;for(const fn of listeners)fn({running,notice:running?'Consultando o Sicoob…':''});};
 const monitor={get running(){return running;},subscribe(fn){listeners.add(fn);fn({running,notice:''});return()=>listeners.delete(fn);},async start(){starts++;if(fail)throw Error('private credential');emit(true);},destroy(){destroys++;}};
 const row={id:'1',fields:{Title:'EXEMPLO',SITUACAO:'Em aberto',CHAVE_DDA:'a'.repeat(64),VALOR:10,VENCIMENTO:'2026-11-01'}};
 const view=createDdaReportView({document:doc,syncMonitor:monitor,data:{loadSnapshot:async()=>{loads++;return {rows:[row]};}},confirmPayment:async()=>({status:'confirmed',itemId:1,key:'a'.repeat(64),confirmedAt:'2026-10-28T18:00:00Z',confirmedBy:'test@example.test'})});
 t.after(()=>{view.destroy();dom.window.close();});await view.open();
 return {doc,dom,view,emit,fail:()=>fail=true,counts:()=>({starts,loads,destroys,listeners:listeners.size}),refresh:doc.querySelector('.pl-refresh')};
}
test('report refresh starts bank once, displays progress and reloads SharePoint preserving filters',async t=>{
 const h=await setup(t);const search=h.doc.querySelector('[name=search]');search.value='EXEMPLO';search.dispatchEvent(new h.dom.window.Event('input'));
 h.refresh.click();h.refresh.click();await tick();assert.equal(h.counts().starts,1);assert.equal(h.counts().loads,1);assert.equal(h.refresh.disabled,true);assert.match(h.doc.querySelector('.ddr-notice').textContent,/Sicoob/);
 h.emit(false);await tick();assert.equal(h.counts().loads,2);assert.equal(h.view.element.hidden,false);assert.equal(search.value,'EXEMPLO');assert.equal(h.refresh.disabled,false);
});
test('closing report never cancels the monitor; reopening catches up and destroy only unsubscribes',async t=>{
 const h=await setup(t);h.refresh.click();await tick();h.view.close();h.emit(false);await tick();assert.equal(h.counts().loads,1);await h.view.open();assert.equal(h.counts().loads,2);h.view.destroy();assert.equal(h.counts().destroys,0);assert.equal(h.counts().listeners,0);
});
test('bank completion waits for payment dialog acknowledgement before refreshing',async t=>{
 const h=await setup(t);h.doc.querySelector('[data-dda-confirm-payment]').click();h.emit(true);h.emit(false);await tick();assert.equal(h.counts().loads,1);assert.ok(h.doc.querySelector('[data-dda-payment-dialog]'));h.doc.querySelector('[data-dda-payment-cancel]').click();await tick();assert.equal(h.counts().loads,2);assert.equal(h.view.element.hidden,false);
});
test('start failure is visible without exposing internal errors and allows retry',async t=>{
 const h=await setup(t);h.fail();h.refresh.click();await tick();assert.match(h.doc.querySelector('.ddr-notice').textContent,/Não foi possível iniciar/);assert.doesNotMatch(h.doc.body.textContent,/private credential/);assert.equal(h.refresh.disabled,false);
});
