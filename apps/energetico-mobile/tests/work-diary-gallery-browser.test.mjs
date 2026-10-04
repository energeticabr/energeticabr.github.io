import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { build, createServer } from 'vite';

test('work diary keeps aligned readable rows, intact left attachments and weather colors on phone and desktop', {timeout:120_000}, async t => {
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p=>p&&existsSync(p));
  if(!browser)return t.skip('Chrome unavailable');
  const appRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
  const built=await build({configFile:false,root:join(appRoot,'pwa'),base:'/energetico/',logLevel:'silent',build:{write:false,sourcemap:false}});
  const css=built.output.filter(a=>a.type==='asset'&&a.fileName.endsWith('.css')).map(a=>a.source).join('\n');
  const server=await createServer({root:appRoot,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(appRoot,'../..')]}},logLevel:'silent'});
  const profile=mkdtempSync(join(tmpdir(),'work-diary-gallery-'));
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
    for(const [width,height,pwa] of [[320,740,false],[390,844,false],[768,1024,false],[1365,900,false],[390,844,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
      await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/work-diary-gallery-responsive.html?width=${width}`},sessionId);
      let ready=false;for(let n=0;n<120&&!ready;n++){ready=await evaluate(`location.search==='?width=${width}'&&document.documentElement?.dataset.ready==='true'`);if(!ready)await delay(100);}
      assert.ok(ready);
      if(pwa)await evaluate(`(()=>{document.querySelectorAll('style,link[rel=stylesheet]').forEach(n=>n.remove());const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);})()`);
      const collapsed=await evaluate(`([...document.querySelectorAll('.rg-row--work-diary')].map(card=>{
        const toggle=card.querySelector('.rg-diary-expand'),extra=toggle&&document.getElementById(toggle.getAttribute('aria-controls'));
        return {closed:toggle?.getAttribute('aria-expanded')==='false'&&extra?.hidden,
          base:[...card.querySelector('.rg-row-main > .rg-diary-table').children].map(n=>n.dataset.field),
          hidden:extra&&[...extra.querySelectorAll('[data-field]')].every(n=>n.getBoundingClientRect().height===0)};
      }))`);
      for(const card of collapsed){assert.ok(card.closed&&card.hidden,`${width}px details should start closed`);assert.deepEqual(card.base,['FILIAL','STATUS','INFORMAÇÕES CLIMÁTICAS','TIPO','ETAPA']);}
      if(width===390&&!pwa&&process.env.WORK_DIARY_COLLAPSED_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);writeFileSync(process.env.WORK_DIARY_COLLAPSED_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await evaluate(`document.querySelectorAll('.rg-diary-expand').forEach(n=>n.click())`);
      const layout=await evaluate(`([...document.querySelectorAll('.rg-row--work-diary')].map(card=>{
        const r=n=>n.getBoundingClientRect(),rail=card.querySelector('.rg-row-file'),main=card.querySelector('.rg-row-main'),actions=card.querySelector('.gallery-record-actions'),heading=card.querySelector('.rg-diary-heading'),weather=card.querySelector('.rg-diary-weather');
        return {railLeft:r(rail).right<=r(main).left,headingClear:r(heading).right<=r(actions).left+1,
          overflow:[card,...card.querySelectorAll('*')].filter(n=>n.clientWidth&&n.scrollWidth>n.clientWidth+1).map(n=>n.className),
          aligned:[...card.querySelectorAll('.rg-diary-table .rg-diary-detail')].every(n=>{
            const dt=n.querySelector('dt'),dd=n.querySelector('dd');
            return ['ETAPA','ATIVIDADES EXECUTADAS','OBSERVAÇÕES'].includes(n.dataset.field)
              ? r(dd).top>=r(dt).bottom&&Math.abs(r(dd).width-r(n).width)<1
              : r(dt).right<=r(dd).left+1;
          }),
          expanded:card.querySelector('.rg-diary-expand').getAttribute('aria-expanded')==='true'&&!card.querySelector('.rg-diary-more').hidden,
          background:getComputedStyle(weather).backgroundColor,climate:weather.textContent,
          auditColumns:getComputedStyle(card.querySelector('.rg-diary-audit')).gridTemplateColumns.split(' ').length,
          actions:[...actions.children].map(n=>n.dataset.galleryAction),tableClear:r(card.querySelector('.rg-diary-table')).top>=r(actions).bottom,
          clearance:r(card.querySelector('.rg-diary-table')).top-r(actions).bottom,actionHeight:r(actions).height,headingHeight:r(heading).height,
          footerBelow:r(card.querySelector('.rg-diary-audit')).top>=r(card.querySelector('.rg-diary-table')).bottom,
          cardRight:r(card).right};}))`);
      assert.equal(layout.length,3);
      for(const card of layout){assert.ok(card.railLeft&&card.headingClear&&card.aligned&&card.tableClear&&card.footerBelow&&card.expanded,`${width}px ${JSON.stringify(card)}`);assert.deepEqual(card.overflow,[],`${width}px overflowing nodes`);assert.ok(card.cardRight<=width+1);assert.deepEqual(card.actions,['edit','delete']);assert.equal(card.auditColumns,width<=350?1:2);}
      assert.equal(layout[0].background,'rgb(255, 244, 199)');
      assert.equal(layout[1].background,'rgb(225, 240, 255)');assert.equal(layout[2].background,'rgb(225, 240, 255)');
      assert.match(layout[0].climate,/☀️/);assert.match(layout[1].climate,/🌧️/);
      if(width===390&&!pwa&&process.env.WORK_DIARY_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);writeFileSync(process.env.WORK_DIARY_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await evaluate(`document.querySelectorAll('.rg-diary-expand').forEach(n=>n.click())`);
      assert.ok(await evaluate(`([...document.querySelectorAll('.rg-diary-more')].every(n=>n.hidden&&n.getBoundingClientRect().height===0))`));
    }
  } finally {
    for(const p of pending.values())clearTimeout(p.timer);socket?.close();
    if(child&&child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([exited,delay(3000)]);}
    await server.close();
    try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
  }
});
