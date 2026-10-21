import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createNativeBootstrap } from '../src/demo/native-bootstrap.js';
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};

test('scan choice in demo uploads confirmed page only to sandbox, never normal camera',async t=>{
  const dom=new JSDOM('<main id="app"></main>',{url:'https://localhost/'}),root=dom.window.document.querySelector('#app');
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  const requests=[];
  const runtime=createNativeBootstrap({root,config:{apiBaseUrl:'https://163-176-171-217.sslip.io',demoAccessEnabled:true},
    auth:{initialize:async()=>null,signIn:async()=>null,getToken:async()=>{throw new Error('No corporate auth');}},
    native:{onResume:async()=>()=>{},importSharedItems:async()=>[],discardSharedItem:async()=>{},capturePhoto:async()=>{throw new Error('Normal camera must not run');},scanDocument:async()=>[new File(['scan'],'scan.jpg',{type:'image/jpeg'})]},
    fetchImpl:async(url,options)=>{
      requests.push({url,options});
      const body=String(url).endsWith('/session')?{accessToken:'sandbox',account:{homeAccountId:'demo:scanner',username:'scanner@demo.invalid',name:'Scanner test'},expiresAt:new Date(Date.now()+600000).toISOString()}:{status:'processed',messages:[{type:'text',text:'Somente teste'}],attachments:[]};
      return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
    }});
  t.after(()=>{runtime.stop();dom.window.close();});await runtime.start();
  root.querySelector('[data-action="demo-access"]').click();
  root.querySelector('[name="username"]').value='synthetic';root.querySelector('[name="password"]').value='synthetic-test-only';
  root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();
  root.querySelector('[data-action="capture-photo"]').click();
  dom.window.document.querySelector('[data-camera-mode="scan"]').click();await settle();
  const uploads=requests.filter(r=>String(r.url).endsWith('portal-upload'));
  assert.equal(uploads.length,1,root.textContent);assert.equal(uploads[0].options.body.name,'scan.jpg');
  assert.ok(requests.every(r=>new URL(r.url).pathname.startsWith('/api/demo/')));
});
