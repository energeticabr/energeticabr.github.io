import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDdaReportView} from '../src/ui/dda-report-view.js';
const tick=()=>new Promise(r=>setImmediate(r));
async function setup(t,openMediaCollection){
 const dom=new JSDOM('<body><main id="app"></main></body>'),doc=dom.window.document,listeners=new Set();
 let running=false,starts=0,loads=0,destroys=0,fail=false;
 const emit=value=>{running=value;for(const fn of listeners)fn({running,notice:running?'Consultando o Sicoob…':''});};
 const monitor={get running(){return running;},subscribe(fn){listeners.add(fn);fn({running,notice:''});return()=>listeners.delete(fn);},async start(){starts++;if(fail)throw Error('private credential');emit(true);},destroy(){destroys++;}};
 const row={id:'1',fields:{Title:'EXEMPLO',SITUACAO:'Em aberto',DESCRITIVOPROVIS_x00c3_O:'56',CHAVE_DDA:'a'.repeat(64),VALOR:10,VENCIMENTO:'2026-11-01'}};
 const view=createDdaReportView({document:doc,syncMonitor:monitor,openMediaCollection,onStartSettlement:async()=>true,data:{loadItem:async()=>row,provisionLink:{loadSettledDdaIds:async()=>new Set()},loadSnapshot:async()=>{loads++;return {rows:[row]};},listAttachments:async()=>[{fileName:'espelho.pdf'}],downloadAttachment:async()=>new Blob()}});
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
test('bank completion waits for settlement confirmation dismissal before refreshing',async t=>{
 const h=await setup(t);h.doc.querySelector('[data-dda-provision-check]').click();h.emit(true);h.emit(false);await tick();assert.equal(h.counts().loads,1);assert.ok(h.doc.querySelector('[data-dda-settlement-dialog]'));h.doc.querySelector('[data-dda-settlement-no]').click();await tick();assert.equal(h.counts().loads,2);assert.equal(h.view.element.hidden,false);
});
test('bank completion keeps the DDA under the PDF until close, then restores its scroll position',async t=>{
 let preview;
 const h=await setup(t,async(_items,options)=>{preview=options;});
 const content=h.doc.querySelector('.ddr-content');content.scrollTop=90;
 h.doc.querySelector('[data-dda-pdf]').click();await tick();assert.equal(preview.layout,'dda-report-pdf');
 h.emit(true);h.emit(false);await tick();assert.equal(h.counts().loads,1);assert.equal(preview.signal.aborted,false);
 preview.resolveReturnFocus().focus();preview.onClose();await tick();assert.equal(h.counts().loads,2);assert.equal(content.scrollTop,90);assert.equal(h.view.element.hidden,false);
 assert.equal(h.doc.activeElement,h.doc.querySelector('[data-dda-pdf]'));
 h.doc.querySelector('[data-dda-pdf]').click();await tick();h.view.close();assert.equal(preview.signal.aborted,true);
});
test('start failure is visible without exposing internal errors and allows retry',async t=>{
 const h=await setup(t);h.fail();h.refresh.click();await tick();assert.match(h.doc.querySelector('.ddr-notice').textContent,/Não foi possível iniciar/);assert.doesNotMatch(h.doc.body.textContent,/private credential/);assert.equal(h.refresh.disabled,false);
});
