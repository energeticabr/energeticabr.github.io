// Render the actual workflow response in the existing app at phone and PC widths.
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const app=resolve(fileURLToPath(new URL('../../apps/energetico-mobile/',import.meta.url)));
const require=createRequire(join(app,'package.json'));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const fixture=JSON.parse(readFileSync(process.argv[2],'utf8'));
const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="app"></main><script type="module">
import '/src/styles.css';
import {createChatView} from '/src/ui/chat-view.js';
import {createConversationStore} from '/src/chat/conversation-store.js';
const store=createConversationStore({historyMode:'current-step'});
store.ingestRemoteMessages([${JSON.stringify(fixture)}],{activeFlow:{id:'payment_provision',title:'CRIAR UMA PROVISÃO DE PAGAMENTO'}});
const view=createChatView(document.querySelector('#app'));
window.selected=[];view.on('select-reply',e=>window.selected.push(e.replyId));
view.render({sessionStatus:'authenticated',account:{name:'Teste',username:'test@example.test'},draft:'',pendingFiles:[],activeText:null,error:null,...store.getState()});
document.documentElement.dataset.ready='true';
</script></body></html>`;
const server=await createServer({root:app,logLevel:'silent',server:{host:'127.0.0.1',port:0},plugins:[{name:'supplier-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{if(!req.url.startsWith('/supplier-fixture?')){next();return;}res.setHeader('Content-Type','text/html');res.end(html);});}}]});
const profile=mkdtempSync(join(tmpdir(),'provision-supplier-'));
const browser=process.env.CHROME_BIN||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const pending=new Map();let child,socket;
try {
  await server.listen();
  child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
  const portFile=join(profile,'DevToolsActivePort');
  for(let n=0;n<150&&!existsSync(portFile);n++)await delay(100);
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
  for(const width of [320,390,1365]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false},sessionId);
    await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/supplier-fixture?width=${width}`},sessionId);
    let ready=false;for(let n=0;n<120&&!ready;n++){ready=await evaluate(`location.search==='?width=${width}'&&document.documentElement?.dataset.ready==='true'`);if(!ready)await delay(100);}
    assert.ok(ready);
    const result=await evaluate(`(()=>{const button=document.querySelector('[data-reply-id="choice:fornecedor_pagamento:273"]');if(!button)return null;button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return {labels:[...document.querySelectorAll('[data-reply-id]')].map(n=>n.textContent.trim()),enabled:!button.disabled,visible:r.width>0&&r.height>0,overflow:document.documentElement.scrollWidth>innerWidth+1};})()`);
    assert.ok(result,`${width}px missing supplier button`);
    assert.ok(result.labels.some(label=>label.includes('ZURICH SEGUROS')));
    assert.ok(result.labels.some(label=>label.includes('ELÉTRICA CATEDRAL')));
    assert.ok(result.labels.some(label=>label.includes('CADASTRAR NOVO FORNECEDOR')));
    assert.ok(result.labels.every(label=>!label.includes('EM BRANCO')));
    assert.ok(result.enabled&&result.visible&&!result.overflow,JSON.stringify(result));
    await evaluate(`document.querySelector('[data-reply-id="choice:fornecedor_pagamento:273"]').click()`);
    assert.deepEqual(await evaluate('window.selected'),['choice:fornecedor_pagamento:273']);
    console.log(JSON.stringify({width,...result}));
    if(width===390&&process.argv[3]){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.argv[3],Buffer.from(shot.data,'base64'));}
  }
} finally {
  for(const p of pending.values())clearTimeout(p.timer);socket?.close();
  if(child&&child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([exited,delay(3000)]);}
  await server.close();
  try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
}
