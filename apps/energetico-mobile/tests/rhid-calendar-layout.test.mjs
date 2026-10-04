import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

test('RHID calendar warnings stay red, under dates and inside cells on phone and desktop', {timeout:120_000}, async t => {
  const browser = [process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(path=>path && existsSync(path));
  if(!browser) return t.skip('Chrome unavailable');
  const appRoot = resolve(fileURLToPath(new URL('..',import.meta.url)));
  const server = await createServer({root:appRoot,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(appRoot,'../..')]}},logLevel:'silent'});
  const profile = mkdtempSync(join(tmpdir(),'rhid-calendar-layout-'));
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
    for(const [width,height] of [[320,740],[390,844],[1365,900]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
      await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/rhid-calendar-responsive.html?width=${width}`},sessionId);
      let ready=false;
      for(let n=0;n<100&&!ready;n++){ready=await evaluate(`location.search==='?width=${width}' && document.documentElement?.dataset.ready==='true'`);if(!ready)await delay(100);}
      assert.ok(ready);
      const layout=await evaluate(`(()=>{const warnings=[...document.querySelectorAll('.chat-rhid-calendar__irregular')];return {width:document.documentElement.scrollWidth,warnings:warnings.map(n=>{const r=n.getBoundingClientRect(),d=n.parentElement.getBoundingClientRect(),number=n.previousElementSibling.getBoundingClientRect();return {text:n.textContent,color:getComputedStyle(n).color,font:parseFloat(getComputedStyle(n).fontSize),below:r.top>=number.bottom,inside:r.left>=d.left&&r.right<=d.right&&r.bottom<=d.bottom,overflow:n.scrollWidth>n.clientWidth+1};})};})()`);
      assert.ok(layout.width<=width,JSON.stringify(layout));
      assert.equal(layout.warnings.length,2);
      for(const item of layout.warnings) assert.ok(item.color==='rgb(180, 35, 45)' && item.font<=10 && item.below && item.inside && !item.overflow,JSON.stringify({width,item}));
      if(width===390&&process.env.RHID_CALENDAR_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);writeFileSync(process.env.RHID_CALENDAR_SCREENSHOT,Buffer.from(shot.data,'base64'));}
    }
  } finally {
    for(const p of pending.values()) clearTimeout(p.timer);
    socket?.close();
    if(child&&child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([exited,delay(3000)]);}
    await server.close();
    try {rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});} catch(error) {if(!['EPERM','EBUSY'].includes(error.code))throw error;}
  }
});
