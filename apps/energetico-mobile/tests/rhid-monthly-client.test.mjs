import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatClient} from '../src/chat/chat-client.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('monthly query cancels delayed token acquisition without sending a POST',async()=>{
 let resolve,calls=0;const token=new Promise(r=>resolve=r),controller=new AbortController();
 const client=createChatClient({apiBaseUrl:'https://example.test',tokenProvider:()=>token,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({status:'processed',messages:[],attendanceMonth:{month:'2026-10',presentDates:[],rows:[]}}));}});
 const pending=client.getRhidAttendanceMonth('2026-10',{signal:controller.signal}),rejected=assert.rejects(pending,{name:'AbortError'});await tick();controller.abort();resolve('late-token');await rejected;await tick();assert.equal(calls,0);
});
test('monthly network fetch receives cancellation and is never retried after abort',async()=>{
 let calls=0;const controller=new AbortController();
 const client=createChatClient({apiBaseUrl:'https://example.test',tokenProvider:async()=> 'token',retryDelay:async()=>{},fetchImpl:async(_url,options)=>{calls++;assert.equal(options.signal,controller.signal);controller.abort();throw new DOMException('Cancelado','AbortError');}});
 await assert.rejects(client.getRhidAttendanceMonth('2026-10',{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);
});
