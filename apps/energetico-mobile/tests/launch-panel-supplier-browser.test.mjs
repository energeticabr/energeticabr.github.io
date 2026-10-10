import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {build,createServer} from 'vite';

test('launch supplier column keeps product inside details and fits phone/desktop layouts', {timeout:120000}, async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p=>p&&existsSync(p));
  if(!browser)return t.skip('Chrome unavailable');
  const app=resolve(fileURLToPath(new URL('..',import.meta.url)));
  const built=await build({configFile:false,root:join(app,'pwa'),base:'/energetico/',logLevel:'silent',build:{write:false,sourcemap:false}});
  const css=built.output.filter(a=>a.type==='asset'&&a.fileName.endsWith('.css')).map(a=>a.source).join('\n');
  const profile=mkdtempSync(join(tmpdir(),'launch-supplier-'));
  const server=await createServer({root:app,cacheDir:join(profile,'vite-cache'),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  const pending=new Map();let child,socket;
  try{
    await server.listen();
    child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
    const portFile=join(profile,'DevToolsActivePort');
    let endpoint;
    for(let n=0;n<200;n++){
      if(existsSync(portFile)){
        const [port,path]=readFileSync(portFile,'utf8').trim().split(/\r?\n/);
        if(/^\d+$/.test(port||'')&&Number(port)>=1&&Number(port)<=65535&&/^\/devtools\/browser\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(path||'')){
          endpoint=`ws://127.0.0.1:${port}${path}`;
          break;
        }
      }
      await delay(100);
    }
    assert.ok(endpoint,'Chrome must finish writing its browser endpoint before connecting');
    socket=new WebSocket(endpoint);
    await new Promise((done,fail)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',fail,{once:true});});
    let seq=0;
    socket.addEventListener('message',e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.fail(new Error(r.error.message)):p.done(r.result);});
    const send=(method,params={},sessionId)=>new Promise((done,fail)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);fail(new Error(method+' timed out'));},15000);pending.set(id,{done,fail,timer});socket.send(JSON.stringify({id,method,params,sessionId}));});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true},sessionId);assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
    for(const [width,pwa] of [[320,false],[390,false],[1365,false],[390,true]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false},sessionId);
      await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/launch-panel-supplier.html?width=${width}&pwa=${pwa}`},sessionId);
      // Share the bounded 30s readiness allowance used by the layout runner.
      let ready=false;for(let n=0;n<300&&!ready;n++){ready=await evaluate(`location.search==='?width=${width}&pwa=${pwa}'&&document.documentElement?.dataset.ready==='true'`);if(!ready)await delay(100);}
      assert.ok(ready,`Supplier fixture did not finish loading at ${width}px, PWA=${pwa}`);
      if(pwa)await evaluate(`(()=>{document.querySelectorAll('style,link[rel=stylesheet]').forEach(n=>n.remove());const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);})()`);
      const compact=await evaluate(`(()=>{const panel=document.querySelector('.chat-launches'),rows=[...panel.querySelectorAll('.chat-launch-entry')];return {
        header:panel.querySelector('.chat-launch-row--header').firstElementChild.textContent,
        suppliers:rows.map(n=>n.querySelector('.chat-launch-row > strong').textContent),
        productsVisible:rows.some(n=>n.querySelector('.chat-launch-row').textContent.includes('PROFISSÃO')),
        detailsClosed:rows.every(n=>n.querySelector('.chat-launch-details').hidden),
        headersClear:[...panel.querySelectorAll('.chat-launch-row--header span')].every(n=>n.scrollWidth<=n.clientWidth+1),
        overflow:document.documentElement.scrollWidth>innerWidth+1||panel.scrollWidth>panel.clientWidth+1};})()`);
      assert.equal(compact.header,'Fornecedor');
      assert.deepEqual(compact.suppliers,['1. RAFAEL GONTIJO','2. ISRAEL ESCORAMENTO E ARMAÇÕES']);
      assert.ok(!compact.productsVisible&&compact.detailsClosed&&compact.headersClear&&!compact.overflow,JSON.stringify(compact));
      await evaluate(`document.querySelector('[data-action="toggle-launch-details"]').click()`);
      const expanded=await evaluate(`(()=>{const details=document.querySelector('.chat-launch-details');return {open:!details.hidden,first:details.firstElementChild.textContent,overflow:details.scrollWidth>details.clientWidth+1};})()`);
      assert.ok(expanded.open&&!expanded.overflow);
      assert.equal(expanded.first,'1. ⭐ ENGENHEIRO (PROFISSÃO DO FORNECEDOR)');
      if(width===390&&!pwa&&process.env.LAUNCH_SUPPLIER_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.env.LAUNCH_SUPPLIER_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await evaluate(`document.querySelector('[data-action="toggle-launch-details"]').click()`);
      assert.ok(await evaluate(`document.querySelector('.chat-launch-details').hidden`));
    }
  }finally{
    for(const p of pending.values())clearTimeout(p.timer);socket?.close();
    if(child&&child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([exited,delay(3000)]);}
    await server.close();
    try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
  }
});
