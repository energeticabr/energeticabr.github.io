import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { build, createServer } from 'vite';

test('payroll mascot fits below delete and collapsed reports work on phone and desktop', {timeout:120_000}, async t => {
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
      await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payroll-expandable.html?width=${width}`},sessionId);
      let ready=false;
      for(let n=0;n<100&&!ready;n++){ready=await evaluate(`location.search==='?width=${width}' && document.documentElement?.dataset.ready==='true'`);if(!ready)await delay(100);}
      assert.ok(ready);
      if(pwaStyles) await evaluate(`(()=>{document.querySelectorAll('style,link[rel="stylesheet"]').forEach(n=>n.remove());const s=document.createElement('style');s.textContent=${JSON.stringify(pwaCss)};document.head.append(s);})()`);
      const layout=await evaluate(`(()=>{const b=document.querySelector('[data-action="open-payroll-report"]'),i=b.querySelector('img'),x=document.querySelector('[data-gallery-action="delete"]'),r=b.getBoundingClientRect(),p=i.getBoundingClientRect(),d=x.getBoundingClientRect();return {width:document.documentElement.scrollWidth,below:r.top>=d.bottom,aligned:Math.abs(r.left-d.left)<1,inside:p.left>=r.left&&p.right<=r.right&&p.top>=r.top&&p.bottom<=r.bottom,overflow:b.scrollHeight>b.clientHeight+1,loaded:i.complete&&i.naturalHeight>0};})()`);
      assert.ok(layout.width<=width && layout.below && layout.aligned && layout.inside && !layout.overflow && layout.loaded,JSON.stringify({width,layout}));
      if(width===390&&process.env.PAYROLL_SCREENSHOT_PREFIX){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);writeFileSync(process.env.PAYROLL_SCREENSHOT_PREFIX+'-gallery.png',Buffer.from(shot.data,'base64'));}
      await evaluate(`document.querySelector('[data-action="open-payroll-report"]').click()`);
      let reportReady=false;
      for(let n=0;n<100&&!reportReady;n++){reportReady=await evaluate(`document.querySelector('[data-report-total-type="SALARIO"]')!==null`);if(!reportReady)await delay(100);}
      assert.ok(reportReady);
      const closed=await evaluate(`[...document.querySelectorAll('.hr-payroll-report-overlay details')].every(d=>!d.open)`);
      assert.ok(closed, 'detalhes iniciam recolhidos');
      await evaluate(`document.querySelector('.hr-payroll-report-overlay').focus()`);
      for(let n=0;n<3;n++) await press('Tab','Tab',9);
      assert.ok(await evaluate(`document.activeElement===document.querySelector('[data-report-total-type="SALARIO"]').closest('summary') && getComputedStyle(document.activeElement).outlineStyle==='solid'`), 'subtotal alcançável por Tab com foco visível');
      await press('Enter','Enter',13);
      assert.ok(await evaluate(`document.querySelector('[data-report-total-type="SALARIO"]').closest('details').open`));
      await press(' ','Space',32);
      assert.equal(await evaluate(`document.querySelector('[data-report-total-type="SALARIO"]').closest('details').open`), false);
      const detail=await evaluate(`(()=>{const salary=document.querySelector('[data-report-total-type="SALARIO"]').closest('details');salary.querySelector('summary').click();const linked=document.querySelector('.hr-payroll-report-payments').closest('details');linked.querySelector('summary').click();return {salaryOpen:salary.open,linkedOpen:linked.open,lines:[...salary.querySelectorAll('li')].map(n=>n.textContent.replace(/\\u00a0/g,' ')),cards:linked.querySelectorAll('.hr-payroll-payment-card').length,width:document.documentElement.scrollWidth};})()`);
      assert.deepEqual(detail.lines,['2 - R$ 500,00 (28/09/2026)','3 - R$ 506,40 (29/09/2026)']);
      assert.ok(detail.salaryOpen && detail.linkedOpen && detail.cards===3 && detail.width<=width);
      assert.ok(await evaluate(`[...document.querySelectorAll('.hr-gallery-content')].every(n=>n.scrollWidth<=n.clientWidth+1)`), 'conteúdo das galerias sem overflow horizontal');
      if(width===390&&process.env.PAYROLL_SCREENSHOT_PREFIX){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);writeFileSync(process.env.PAYROLL_SCREENSHOT_PREFIX+'-report.png',Buffer.from(shot.data,'base64'));}

    }
  } finally {
    for(const p of pending.values()) clearTimeout(p.timer);
    socket?.close();
    if(child&&child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([exited,delay(3000)]);}
    await server.close();
    try {rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});} catch(error) {if(!['EPERM','EBUSY'].includes(error.code))throw error;}
  }
});
