import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { build, createServer } from 'vite';

test('payroll editor fills phone and desktop viewports with locked financial values', {timeout:120_000}, async t => {
  const browser = [process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(path=>path && existsSync(path));
  if(!browser) return t.skip('Chrome unavailable');
  const appRoot = resolve(fileURLToPath(new URL('..',import.meta.url)));
  const pwa = await build({configFile:false,root:join(appRoot,'pwa'),base:'/energetico/',logLevel:'silent',build:{write:false,sourcemap:false}});
  const pwaCss = pwa.output.filter(asset=>asset.type==='asset' && asset.fileName.endsWith('.css')).map(asset=>asset.source).join('\n');
  const server = await createServer({root:appRoot,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(appRoot,'../..')]}},logLevel:'silent'});
  const profile = mkdtempSync(join(tmpdir(),'payroll-expandable-layout-'));
  const pending = new Map();
  let child,socket;
  try {
    await server.listen();
    child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
    const portFile=join(profile,'DevToolsActivePort');
    for(let n=0;n<200&&!existsSync(portFile);n++) await delay(100);
    assert.ok(existsSync(portFile));
    const [port,path]=readFileSync(portFile,'utf8').trim().split(/\r?\n/);
    socket=new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise((done,fail)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',fail,{once:true});});
    let sequence=0;
    socket.addEventListener('message',event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.fail(new Error(r.error.message)):p.done(r.result);});
    const send=(method,params={},sessionId)=>new Promise((done,fail)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);fail(new Error(method+' timed out'));},15000);pending.set(id,{done,fail,timer});socket.send(JSON.stringify({id,method,params,sessionId}));});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true},sessionId);assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
    const press = async (key,code,windowsVirtualKeyCode) => {
      await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})},sessionId);
      await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode},sessionId);
    };
    for(const [width,height,pwaStyles] of [[320,740,false],[390,844,false],[1365,900,false],[320,740,true],[390,844,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
      await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payroll-editor.html?width=${width}`},sessionId);
      let ready=false;
      for(let n=0;n<100&&!ready;n++){ready=await evaluate(`location.search==='?width=${width}' && document.documentElement?.dataset.ready==='true'`);if(!ready)await delay(100);}
      assert.ok(ready);
      if(pwaStyles) await evaluate(`(()=>{document.querySelectorAll('style,link[rel="stylesheet"]').forEach(n=>n.remove());const s=document.createElement('style');s.textContent=${JSON.stringify(pwaCss)};document.head.append(s);})()`);
      const layout=await evaluate(`(()=>{const e=document.querySelector('[data-gallery-record-screen]'),r=e.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,scroll:document.documentElement.scrollWidth,modal:e.hasAttribute('aria-modal'),title:!!e.querySelector('[name=Title]'),readonly:[...e.querySelectorAll('[name=VALORUNITARIO],[name=QTD]')].every(n=>n.readOnly),supplierDisabled:e.querySelector('[name=FORNECEDOR]').disabled,selects:['IDFOLHA','TIPOPGTO'].every(name=>e.querySelector('[name='+name+']')?.tagName==='SELECT')};})()`);
      assert.deepEqual(layout,{left:0,top:0,width,height,scroll:width,modal:false,title:false,readonly:true,supplierDisabled:true,selects:true});
      assert.deepEqual(await evaluate(`[...document.querySelector('.dynamic-form-grid').children].map(n=>n.querySelector('[name]')?.name).slice(0,6)`),['DATA','IDFOLHA','FORNECEDOR','IDLANCAMENTO','VALORUNITARIO','QTD']);
      assert.deepEqual(await evaluate(`[...document.querySelector('[data-gallery-record-screen] [name=IDFOLHA]').options].filter(o=>o.value).map(o=>({value:o.value,label:o.textContent}))`),[{value:'5',label:'5-09/2026 (FORNECEDOR DE TESTE)'},{value:'15',label:'15-10/2026 (FORNECEDOR DE TESTE)'}]);
      assert.equal(await evaluate(`document.querySelector('[data-combobox-root=IDFOLHA] input, [data-searchable-root=IDFOLHA] input').value`),'5-09/2026 (FORNECEDOR DE TESTE)');
      const fieldColors=await evaluate(`(()=>{const e=document.querySelector('[data-gallery-record-screen]'),color=n=>getComputedStyle(n).backgroundColor;return {editable:['IDFOLHA','TIPOPGTO'].map(name=>color(e.querySelector('[data-searchable-root='+name+'] input'))),locked:['FORNECEDOR','VALORUNITARIO','QTD'].map(name=>color(e.querySelector('[name='+name+']')))};})()`);
      assert.deepEqual(fieldColors,{editable:['rgb(255, 255, 255)','rgb(255, 255, 255)'],locked:['rgb(238, 243, 245)','rgb(238, 243, 245)','rgb(238, 243, 245)']});
      assert.deepEqual(await evaluate(`[...document.querySelector('[data-gallery-record-screen] [name=IDLANCAMENTO]').options].filter(o=>o.value).map(o=>({value:o.value,label:o.textContent}))`),[{value:'3460',label:'3460 - OUTRO EMPREITEIRO'},{value:'3457',label:'3457 - FORNECEDOR DE TESTE'}]);
      assert.equal(await evaluate(`document.querySelector('[data-searchable-root=IDLANCAMENTO] input').value`),'3457 - FORNECEDOR DE TESTE');
      const actions=await evaluate(`(()=>{const f=document.querySelector('[data-edit-form]'),cancel=f.querySelector('[data-form-cancel]'),submit=f.querySelector('[data-form-save]');return {labels:[...f.querySelectorAll('.dynamic-form-actions button')].map(b=>b.textContent),clear:!!f.querySelector('[data-form-clear]'),cancelColor:getComputedStyle(cancel).backgroundColor,submitColor:getComputedStyle(submit).backgroundColor,ordered:cancel.getBoundingClientRect().right<submit.getBoundingClientRect().left};})()`);
      assert.deepEqual(actions,{labels:['CANCELAR','SUBMETER'],clear:false,cancelColor:'rgb(185, 28, 36)',submitColor:'rgb(22, 112, 68)',ordered:true});
      await evaluate(`document.querySelector('[data-searchable-root=IDFOLHA] input').focus()`);
      await send('Input.insertText',{text:'Inventado'},sessionId);
      await press('Backspace','Backspace',8); await press('Delete','Delete',46);
      assert.equal(await evaluate(`document.querySelector('[data-searchable-root=IDFOLHA] input').value`),'5-09/2026 (FORNECEDOR DE TESTE)');
      await press('Escape','Escape',27);
      await evaluate(`window.unitValue=250;window.dispatchEvent(new Event('focus'))`);
      for(let n=0;n<50 && !(await evaluate(`document.querySelector('[name=VALORUNITARIO]').value==='250'`));n++) await delay(100);
      assert.equal(await evaluate(`document.querySelector('[name=VALORUNITARIO]').value`),'250');
      if(width===390&&!pwaStyles&&process.env.PAYROLL_EDITOR_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);writeFileSync(process.env.PAYROLL_EDITOR_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await evaluate(`document.querySelector('[data-searchable-root=IDLANCAMENTO] input').click()`);
      await evaluate(`[...document.querySelectorAll('[data-searchable-root=IDLANCAMENTO] [role=option]')].find(n=>n.textContent==='3460 - OUTRO EMPREITEIRO').click()`);
      assert.equal(await evaluate(`document.querySelector('[data-gallery-record-screen] [name=IDLANCAMENTO]').value`),'3460');
      assert.equal(await evaluate(`document.querySelector('[data-searchable-root=IDLANCAMENTO] input').value`),'3460 - OUTRO EMPREITEIRO');
      await evaluate(`document.querySelector('[data-form-save]').click()`);
      for(let n=0;n<100&&!(await evaluate(`window.savedFields.length===1`));n++)await delay(100);
      assert.deepEqual(await evaluate(`window.savedFields`),[{IDLANCAMENTO:3460}],await evaluate(`document.querySelector('[data-edit-form]')?.textContent`));
    }
  } finally {
    for(const p of pending.values()) clearTimeout(p.timer);
    socket?.close();
    if(child&&child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([exited,delay(3000)]);}
    await server.close();
    try {rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});} catch(error) {if(!['EPERM','EBUSY'].includes(error.code))throw error;}
  }
});
