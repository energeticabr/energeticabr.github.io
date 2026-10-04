import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { build, createServer } from 'vite';

test('payroll tray picker selects internally and fits mobile, tablet, desktop and PWA', {timeout:120000}, async t => {
  const browser = [process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));
  if (!browser) return t.skip('Chrome unavailable');
  const app = resolve(fileURLToPath(new URL('..',import.meta.url)));
  const built = await build({configFile:false,root:join(app,'pwa'),base:'/energetico/',logLevel:'silent',build:{write:false}});
  const css = built.output.filter(a=>a.type==='asset'&&a.fileName.endsWith('.css')).map(a=>a.source).join('\n');
  const server = await createServer({root:app,server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  const profile = mkdtempSync(join(tmpdir(),'payroll-tray-'));
  const pending = new Map(); let child,socket;
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
    const send=(method,params={},sessionId)=>new Promise((done,fail)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);fail(new Error(method+' timed out'));},15000);pending.set(id,{done,fail,timer});socket.send(JSON.stringify({id,method,params,sessionId}));});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true},sessionId);assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
    for(const [width,pwa] of [[320,false],[390,false],[768,false],[1365,false],[390,true]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false},sessionId);
      await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payroll-tray-receipts.html?width=${width}&pwa=${pwa}`},sessionId);
      let ready=false;
      for(let n=0;n<120&&!ready;n++){ready=await evaluate(`location.search==='?width=${width}&pwa=${pwa}'&&document.documentElement?.dataset.ready==='true'`);if(!ready)await delay(100);}
      assert.ok(ready);
      if(pwa)await evaluate(`(()=>{document.querySelectorAll('style,link[rel=stylesheet]').forEach(n=>n.remove());const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);})()`);
      const state=await evaluate(`(()=>{const d=document.querySelector('.payroll-receipt-dialog'),r=d.getBoundingClientRect(),c=d.querySelector('[data-receipt-cancel]').getBoundingClientRect(),s=d.querySelector('[data-receipt-confirm]').getBoundingClientRect();return {inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:d.scrollWidth>d.clientWidth+1,space:s.left-c.right,inputs:document.querySelectorAll('input[type=file]').length,options:d.querySelectorAll('input[type=checkbox]').length,inert:document.querySelector('.supplier-payroll-body').inert};})()`);
      assert.ok(state.inside&&!state.overflow&&state.space>=23&&state.inert,JSON.stringify(state));
      assert.equal(state.inputs,0);assert.equal(state.options,2);
      if(width===390&&!pwa&&process.env.PAYROLL_RECEIPTS_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.env.PAYROLL_RECEIPTS_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await evaluate(`document.querySelector('[data-receipt-id="2"]').click();document.querySelector('[data-receipt-confirm]').click()`);
      for(let n=0;n<40&&await evaluate(`!!document.querySelector('[data-receipt-picker]')`);n++)await delay(50);
      assert.equal(await evaluate(`document.querySelector('[data-payroll-rubric=salary] .supplier-payroll-file-list').textContent`),'recibo-transporte.jpeg×');
      assert.equal(await evaluate(`document.querySelector('[data-payroll-rubric=transport] .supplier-payroll-file-list').textContent`),'');
      assert.equal(await evaluate(`document.activeElement.dataset.payrollReceipts`),'salary');
    }
  } finally {
    for(const p of pending.values())clearTimeout(p.timer);socket?.close();
    if(child&&child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([exited,delay(3000)]);}
    await server.close();
    try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
  }
});
