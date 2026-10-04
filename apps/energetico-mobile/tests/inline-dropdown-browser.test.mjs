import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { build, createServer } from 'vite';

test('dropdown search stays in the original field on phone, desktop and shipped PWA styles', {timeout:120_000}, async t => {
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p=>p&&existsSync(p));
  if(!browser)return t.skip('Chrome unavailable');
  const appRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
  const built=await build({configFile:false,root:join(appRoot,'pwa'),base:'/energetico/',logLevel:'silent',build:{write:false,sourcemap:false}});
  const css=built.output.filter(a=>a.type==='asset'&&a.fileName.endsWith('.css')).map(a=>a.source).join('\n');
  const server=await createServer({root:appRoot,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(appRoot,'../..')]}},logLevel:'silent'});
  const profile=mkdtempSync(join(tmpdir(),'inline-dropdown-'));
  const pending=new Map();let child,socket;
  try {
    await server.listen();
    child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
    const portFile=join(profile,'DevToolsActivePort');
    for(let n=0;n<200&&!existsSync(portFile);n++)await delay(100);
    assert.ok(existsSync(portFile));
    const [port,path]=readFileSync(portFile,'utf8').trim().split(/\r?\n/);
    socket=new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise((done,fail)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',fail,{once:true});});
    let seq=0;
    socket.addEventListener('message',e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.fail(new Error(r.error.message)):p.done(r.result);});
    const send=(method,params={},sessionId)=>new Promise((done,fail)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);fail(new Error(method+' timed out'));},15_000);pending.set(id,{done,fail,timer});socket.send(JSON.stringify({id,method,params,sessionId}));});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true},sessionId);assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
    const key=async(key,code,windowsVirtualKeyCode)=>{
      await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})},sessionId);
      await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode},sessionId);
    };
    for(const [width,height,pwa] of [[320,740,false],[390,844,false],[1365,900,false],[320,740,true],[390,844,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
      await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/inline-dropdown-search.html?width=${width}`},sessionId);
      let ready=false;for(let n=0;n<100&&!ready;n++){ready=await evaluate(`location.search==='?width=${width}'&&document.documentElement?.dataset.ready==='true'`);if(!ready)await delay(100);}
      assert.ok(ready);
      if(pwa)await evaluate(`(()=>{document.querySelectorAll('style,link[rel=stylesheet]').forEach(n=>n.remove());const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);})()`);
      const original=await evaluate(`(()=>{const i=document.querySelector('[name=branch]').nextElementSibling.querySelector('input'),r=i.getBoundingClientRect();window.original=i;return {x:r.x,y:r.y,width:r.width,height:r.height,value:i.value};})()`);
      assert.equal(original.value,'Todos');
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:original.x+20,y:original.y+20,button:'left',clickCount:1},sessionId);
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:original.x+20,y:original.y+20,button:'left',clickCount:1},sessionId);
      await send('Input.insertText',{text:'xavante'},sessionId);
      const opened=await evaluate(`(()=>{const i=window.original,r=i.getBoundingClientRect(),p=i.closest('.sfs').querySelector('.sfs-popup');return {same:document.activeElement===i,x:r.x,y:r.y,width:r.width,height:r.height,inputs:p.querySelectorAll('input').length,labels:[...p.querySelectorAll('[role=option]')].map(n=>n.textContent),selected:document.querySelector('[name=branch]').value,changes:window.changes};})()`);
      assert.ok(opened.same);assert.equal(opened.inputs,0);assert.equal(opened.x,original.x);assert.equal(opened.y,original.y);assert.equal(opened.width,original.width);assert.equal(opened.height,original.height);
      assert.deepEqual(opened.labels,['004 - EDIFÍCIO XAVANTE']);assert.equal(opened.selected,'');assert.equal(opened.changes,0);
      if(width===390&&process.env.INLINE_DROPDOWN_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);writeFileSync(process.env.INLINE_DROPDOWN_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await key('Enter','Enter',13);
      assert.ok(await evaluate(`document.querySelector('[name=branch]').value==='004'&&window.original.value==='004 - EDIFÍCIO XAVANTE'&&window.changes===1&&window.original.getAttribute('aria-expanded')==='false'`));
      await evaluate(`document.querySelector('#outside').focus()`);
      let reached=false;for(let n=0;n<8&&!reached;n++){await key('Tab','Tab',9);reached=await evaluate(`document.activeElement===document.querySelector('#dynamic [role=combobox]')`);}
      assert.ok(reached, await evaluate(`document.activeElement.outerHTML`));
      await evaluate(`document.querySelector('#outside').focus();window.original.focus()`);
      await send('Input.insertText',{text:'ouro'},sessionId);await key('Escape','Escape',27);
      assert.ok(await evaluate(`window.original.value==='004 - EDIFÍCIO XAVANTE'&&document.querySelector('[name=branch]').value==='004'`));
      const multi=await evaluate(`(()=>{const s=document.querySelector('[name=status]'),i=s.nextElementSibling.querySelector('input');i.focus();i.value='inativo';i.dispatchEvent(new Event('input',{bubbles:true}));i.closest('.sfs').querySelector('[role=option]').click();document.querySelector('#outside').focus();return [...s.selectedOptions].map(n=>n.value);})()`);
      assert.deepEqual(multi,['active','inactive']);
      // Actual typing must replace the empty prompt, including after native form reset.
      for(let attempt=0;attempt<2;attempt++) {
        if(attempt) {
          await evaluate(`document.querySelector('#stage [data-form-clear]').click()`);
          assert.ok(await evaluate(`document.querySelector('#stage [data-provisao-payment-stage]').value===''&&document.querySelector('#stage [role=combobox]').value==='Selecione'&&document.querySelector('#stage [name=DATAPREVISTOPGTO]').value===''`));
        }
        const stageRect=await evaluate(`(()=>{const i=document.querySelector('#stage [role=combobox]');i.scrollIntoView({block:'center'});const r=i.getBoundingClientRect();return {x:r.x,y:r.y};})()`);
        await send('Input.dispatchMouseEvent',{type:'mousePressed',x:stageRect.x+20,y:stageRect.y+20,button:'left',clickCount:1},sessionId);
        await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:stageRect.x+20,y:stageRect.y+20,button:'left',clickCount:1},sessionId);
        await send('Input.insertText',{text:'liquidado hoje'},sessionId);
        assert.ok(await evaluate(`document.querySelector('#stage [role=combobox]').value==='liquidado hoje'&&document.querySelector('#stage [data-provisao-payment-stage]').value===''&&document.querySelector('#stage [role=listbox]').querySelectorAll('input').length===0`));
        await key('ArrowDown','ArrowDown',40);
        await key('Enter','Enter',13);
        assert.ok(await evaluate(`document.querySelector('#stage [data-provisao-payment-stage]').value==='EMPENHADO E LIQUIDADO HOJE'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(document.querySelector('#stage [name=DATAPREVISTOPGTO]').value)`));
      }
      assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('.supplier-payroll-body,.sfs')].every(n=>n.scrollWidth<=n.clientWidth+1)`));
    }
  } finally {
    for(const p of pending.values())clearTimeout(p.timer);socket?.close();
    if(child&&child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([exited,delay(3000)]);}
    await server.close();
    try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
  }
});
