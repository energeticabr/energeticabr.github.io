import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { build, createServer } from 'vite';

test('teclado real: Enter envia observação e Shift+Enter quebra linha no app e PWA', {timeout:120000}, async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));
  if(!browser)return t.skip('Chrome unavailable');
  const app=resolve(fileURLToPath(new URL('..',import.meta.url)));
  const built=await build({configFile:false,root:join(app,'pwa'),base:'/energetico/',logLevel:'silent',build:{write:false}});
  const css=built.output.filter(a=>a.type==='asset'&&a.fileName.endsWith('.css')).map(a=>a.source).join('\n');
  const server=await createServer({root:app,server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  const profile=mkdtempSync(join(tmpdir(),'observation-enter-'));
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
    const send=(method,params={},sessionId)=>new Promise((done,fail)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);fail(new Error(method+' timed out'));},15000);pending.set(id,{done,fail,timer});socket.send(JSON.stringify({id,method,params,sessionId}));});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true},sessionId);assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
    const enter=async(shift=false)=>{
      const params={key:'Enter',code:'Enter',windowsVirtualKeyCode:13,modifiers:shift?8:0};
      await send('Input.dispatchKeyEvent',{type:'keyDown',...params,text:'\r',unmodifiedText:'\r'},sessionId);
      await send('Input.dispatchKeyEvent',{type:'keyUp',...params},sessionId);
    };
    for(const [width,pwa] of [[320,false],[390,false],[768,false],[1365,false],[390,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false},sessionId);
      await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/launch-observation-enter.html?width=${width}&pwa=${pwa}`},sessionId);
      let ready=false;for(let n=0;n<120&&!ready;n++){ready=await evaluate(`location.search==='?width=${width}&pwa=${pwa}'&&document.documentElement?.dataset.ready==='true'`);if(!ready)await delay(100);}
      assert.ok(ready);
      if(pwa)await evaluate(`(()=>{document.querySelectorAll('style,link[rel=stylesheet]').forEach(n=>n.remove());const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);})()`);
      await evaluate(`document.querySelector('[data-role=draft]').focus()`);
      await enter();
      assert.equal(await evaluate(`document.querySelector('[data-role=draft]').value`),'');
      assert.deepEqual(await evaluate('window.sent'),[]);
      await send('Input.insertText',{text:'Pago via pessoa física.'},sessionId);
      await enter(true);
      await send('Input.insertText',{text:'Fornecedor sem conta pessoal.'},sessionId);
      const expected='Pago via pessoa física.\nFornecedor sem conta pessoal.';
      assert.equal(await evaluate(`document.querySelector('[data-role=draft]').value`),expected);
      assert.deepEqual(await evaluate('window.sent'),[]);
      if(width===768&&process.env.OBSERVATION_ENTER_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.env.OBSERVATION_ENTER_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await enter();
      assert.deepEqual(await evaluate('window.sent'),[expected]);
      assert.equal(await evaluate(`document.querySelector('[data-role=draft]').value`),'');
      await evaluate('window.changeQuestion()');
      await send('Input.insertText',{text:'Produto'},sessionId);
      await enter();
      assert.equal(await evaluate(`document.querySelector('[data-role=draft]').value`),'Produto\n');
      assert.deepEqual(await evaluate('window.sent'),[expected]);
    }
  } finally {
    for(const p of pending.values())clearTimeout(p.timer);socket?.close();
    if(child&&child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([exited,delay(3000)]);}
    await server.close();
    try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
  }
});
