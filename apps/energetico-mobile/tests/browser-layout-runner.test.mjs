import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));

// The outer budget must include the helper's bounded 30-second Chrome startup
// plus connection and cleanup. The actual frame-readiness deadline stays 1s.
test('layout measurement still receives animation frames when Chrome creates the target in background',{timeout:60000},async t=>{
 if(!browser)return t.skip('Chrome unavailable');
 const nativeSend=WebSocket.prototype.send;
 // Fault injection changes only the real browser target's initial visibility.
 // Frames, focus and layout are still produced by Chrome itself.
 let backgroundTargets=0;
 t.mock.method(WebSocket.prototype,'send',function(raw){
  const command=JSON.parse(raw);if(command.method==='Target.createTarget'){command.params.background=true;backgroundTargets++;}
  return nativeSend.call(this,JSON.stringify(command));
 });
 const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><body><script type="module">await document.fonts.ready;await new Promise(requestAnimationFrame);document.documentElement.dataset.layout=JSON.stringify({visible:document.visibilityState,focused:document.hasFocus(),width:innerWidth});</script></body></html>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const result=await runBrowserLayout(browser,{width:390,height:844,url:'http://127.0.0.1:'+server.address().port,readyTimeoutMs:1000});
 const encoded=/data-layout="([^"]+)"/.exec(result.stdout);assert.ok(encoded);
 assert.equal(backgroundTargets,1,'the real target must have been created in background');
 assert.deepEqual(JSON.parse(encoded[1].replaceAll('&quot;','"')),{visible:'visible',focused:true,width:390});
});
test('layout capture waits for the actual asynchronous measurement rather than dumping an unfinished DOM',{timeout:40000},async t=>{
 if(!browser)return t.skip('Chrome unavailable');
 const server=createServer((request,response)=>{response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><body><p>Awaiting measurement</p><script>setTimeout(()=>{document.documentElement.dataset.layout=JSON.stringify({viewport:innerWidth,ready:true});document.querySelector("p").textContent="Measured";},4000);</script></body></html>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const result=await runBrowserLayout(browser,{width:740,height:360,url:'http://127.0.0.1:'+server.address().port,startupTimeoutMs:20000});const encoded=/data-layout="([^"]+)"/.exec(result.stdout);
 assert.ok(encoded,'readiness marker must precede capture');assert.deepEqual(JSON.parse(encoded[1].replaceAll('&quot;','"')),{viewport:740,ready:true});assert.match(result.stdout,/>Measured</);
});
