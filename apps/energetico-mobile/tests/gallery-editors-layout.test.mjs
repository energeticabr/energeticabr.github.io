import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { build, createServer } from 'vite';

test('all seven gallery editors fill the available phone and desktop space', {timeout:120_000}, async t => {
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
    for(const galleryKind of ['orders','tasks','registration','programming','recurring','idfolha','folhapgto']) for(const [width,height,pwaStyles] of [[320,740,false],[390,844,false],[1365,900,false],[320,740,true],[390,844,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
      await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/gallery-editors.html?gallery=${galleryKind}&width=${width}`},sessionId);
      let ready=false;
      for(let n=0;n<100&&!ready;n++){ready=await evaluate(`location.search==='?gallery=${galleryKind}&width=${width}' && document.documentElement?.dataset.ready==='true'`);if(!ready)await delay(100);}
      assert.ok(ready);
      if(pwaStyles) await evaluate(`(()=>{document.querySelectorAll('style,link[rel="stylesheet"]').forEach(n=>n.remove());const s=document.createElement('style');s.textContent=${JSON.stringify(pwaCss)};document.head.append(s);})()`);
      const layout=await evaluate(`(()=>{const e=document.querySelector('[data-gallery-record-screen]'),r=e.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,overflow:e.scrollWidth>e.clientWidth,scrolls:e.scrollHeight>e.clientHeight,modal:e.hasAttribute('aria-modal'),columns:getComputedStyle(e.querySelector('.dynamic-form-grid')).gridTemplateColumns.split(' ').length};})()`);
      assert.deepEqual(layout,{left:0,top:0,width,height,overflow:false,scrolls:true,modal:false,columns:width<=600?1:2},JSON.stringify({galleryKind,width,pwaStyles,layout}));
      if(galleryKind==='orders'&&width===390&&!pwaStyles&&process.env.GALLERY_EDITOR_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);writeFileSync(process.env.GALLERY_EDITOR_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await evaluate(`document.querySelector('[data-form-cancel]').click()`);
      assert.equal(await evaluate(`document.querySelector('[data-gallery-record-screen]')`),null);

    }
  } finally {
    for(const p of pending.values()) clearTimeout(p.timer);
    socket?.close();
    if(child&&child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([exited,delay(3000)]);}
    await server.close();
    try {rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});} catch(error) {if(!['EPERM','EBUSY'].includes(error.code))throw error;}
  }
});
