import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { build, createServer } from 'vite';

test('white payroll add action and closed create form fill phone and desktop viewports', {timeout:120_000}, async t => {
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
    for(const [width,height,pwaStyles,gallery='FOLHAPGTO'] of [[320,740,false],[390,844,false],[1365,900,false],[320,740,true],[390,844,true],[320,740,false,'IDFOLHA'],[390,844,true,'IDFOLHA'],[1365,900,true,'IDFOLHA']]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
      const query=`?width=${width}&gallery=${gallery}`;
      await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payroll-payment.html${query}`},sessionId);
      let ready=false;
      for(let n=0;n<100&&!ready;n++){ready=await evaluate(`location.search===${JSON.stringify(query)} && document.documentElement?.dataset.ready==='true'`);if(!ready)await delay(100);}
      assert.ok(ready);
      if(pwaStyles) await evaluate(`(()=>{document.querySelectorAll('style,link[rel="stylesheet"]').forEach(n=>n.remove());const s=document.createElement('style');s.textContent=${JSON.stringify(pwaCss)};document.head.append(s);})()`);
      const toolbar=await evaluate(`(()=>{const t=document.querySelector('.hr-gallery-toolbar'),s=t.querySelector('input'),f=t.querySelector('[data-action=toggle-payroll-filters]');const a=s.getBoundingClientRect(),b=f.getBoundingClientRect();return {sameRow:Math.abs(a.top-b.top)<1,ordered:a.right<=b.left,usable:a.width>=100&&a.height>=44&&b.height>=44,fits:t.scrollWidth<=t.clientWidth+1};})()`);
      assert.deepEqual(toolbar,{sameRow:true,ordered:true,usable:true,fits:true},JSON.stringify({width,pwaStyles,gallery,toolbar}));
      await evaluate(`document.querySelector('[data-action=toggle-payroll-filters]').click()`);
      assert.equal(await evaluate(`(()=>{const e=document.querySelector('.hr-gallery-filter-panel');return !e.hidden&&e.scrollWidth<=e.clientWidth+1&&[...e.querySelectorAll('input,.sfs-trigger')].every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;});})()`),true);
      await evaluate(`document.querySelector('[data-action=toggle-payroll-filters]').click()`);
      if(gallery==='IDFOLHA') continue;
      const add=await evaluate(`(()=>{const e=document.querySelector('[data-action="add-payroll-payment"]'),r=e.getBoundingClientRect(),filter=document.querySelector('[data-action="toggle-payroll-filters"]').getBoundingClientRect();return {fill:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,inToolbar:Boolean(e.closest('.hr-gallery-toolbar')),rightOfFilters:r.left>=filter.right,sameRow:Math.abs(r.top-filter.top)<1,fits:r.left>=0&&r.right<=innerWidth&&r.width===46&&r.height===46};})()`);
      assert.deepEqual(add,{fill:'rgb(255, 255, 255)',color:'rgb(33, 132, 67)',inToolbar:true,rightOfFilters:true,sameRow:true,fits:true});
      await evaluate(`document.querySelector('[data-action="add-payroll-payment"]').click()`);
      for(let n=0;n<100;n++){if(await evaluate(`Boolean(document.querySelector('[data-payroll-payment-screen] [name=IDLANCAMENTO]'))`))break;await delay(50);}
      const layout=await evaluate(`(()=>{const e=document.querySelector('[data-payroll-payment-screen]'),r=e.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,overflow:e.scrollWidth>e.clientWidth,modal:e.hasAttribute('aria-modal'),columns:getComputedStyle(e.querySelector('.dynamic-form-grid')).gridTemplateColumns.split(' ').length};})()`);
      assert.deepEqual(layout,{left:0,top:0,width,height,overflow:false,modal:false,columns:width<=600?1:2},JSON.stringify({width,pwaStyles,layout}));
      assert.equal(await evaluate(`[...document.querySelectorAll('.sfs-field')].every(field=>{const r=field.getBoundingClientRect(),a=field.querySelector('.sfs-arrow').getBoundingClientRect();return a.left>=r.left&&a.right<=r.right+1&&a.top>=r.top&&a.bottom<=r.bottom+1;})`),true);
      await evaluate(`document.querySelector('[data-payroll-payment-screen] select[name=IDLANCAMENTO]').nextElementSibling.querySelector('.sfs-arrow').click()`);
      const optionLayout=await evaluate(`(()=>{const select=document.querySelector('[data-payroll-payment-screen] select[name=IDLANCAMENTO]'),option=[...select.nextElementSibling.querySelectorAll('[role=option]')].find(n=>n.textContent.startsWith('3457 —')),r=option.getBoundingClientRect();return {label:option.textContent.split(String.fromCharCode(160)).join(' '),fits:r.left>=0&&r.right<=innerWidth&&option.scrollWidth<=option.clientWidth+1,wraps:r.height>44};})()`);
      assert.equal(optionLayout.label,'3457 — FORNECEDOR DE TESTE COM NOME LONGO — SERVENTE DE PEDREIRO (R$ 518,90 — 06/10/2026)');
      assert.equal(optionLayout.fits,true,JSON.stringify({width,pwaStyles,optionLayout}));
      if(width<=390)assert.equal(optionLayout.wraps,true);
      if(width===390&&!pwaStyles&&process.env.PAYROLL_PAYMENT_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);writeFileSync(process.env.PAYROLL_PAYMENT_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await evaluate(`document.querySelector('[data-payroll-payment-screen] select[name=IDLANCAMENTO]').nextElementSibling.querySelector('.sfs-arrow').click()`);
      await evaluate(`(()=>{const launch=document.querySelector('[data-payroll-payment-screen] [name=IDLANCAMENTO]');launch.value='3457';launch.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.deepEqual(await evaluate(`[...document.querySelector('[data-payroll-payment-screen] [name=IDFOLHA]').options].filter(o=>o.value).map(o=>o.value)`),['9','19','29']);
      assert.deepEqual(await evaluate(`(()=>{const screen=document.querySelector('[data-payroll-payment-screen]'),table=screen.querySelector('table'),a=screen.querySelector('[data-payment-cancel]'),b=screen.querySelector('button[type=submit]'),ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect(),rt=table.getBoundingClientRect();return {fits:table.scrollWidth<=table.clientWidth+1,below:Math.min(ra.top,rb.top)>=rt.bottom,leftRight:ra.right<=rb.left,sameRow:Math.abs(ra.top-rb.top)<1,cancel:getComputedStyle(a).backgroundColor,submit:getComputedStyle(b).backgroundColor};})()`),{fits:true,below:true,leftRight:true,sameRow:true,cancel:'rgb(196, 43, 43)',submit:'rgb(33, 132, 67)'});
      await evaluate(`(()=>{document.querySelector('[data-payroll-payment-screen] [name=IDFOLHA]').value='19';document.querySelector('[data-payroll-payment-screen] [name=TIPOPGTO]').value='SALÁRIO';document.querySelector('[data-payroll-payment-screen] form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`);
      for(let n=0;n<100;n++){if(await evaluate(`!document.querySelector('[data-payroll-payment-screen]')`))break;await delay(50);}
      assert.equal(await evaluate(`document.querySelector('[data-payroll-payment-screen]')`),null);
      assert.deepEqual(await evaluate(`window.saved`),[{launchId:'3457',sheetId:'19',paymentType:'SALÁRIO'}]);

    }
  } finally {
    for(const p of pending.values()) clearTimeout(p.timer);
    socket?.close();
    if(child&&child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([exited,delay(3000)]);}
    await server.close();
    try {rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});} catch(error) {if(!['EPERM','EBUSY'].includes(error.code))throw error;}
  }
});
