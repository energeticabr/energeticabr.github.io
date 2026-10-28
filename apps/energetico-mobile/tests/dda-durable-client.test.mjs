import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatClient} from '../src/chat/chat-client.js';
test('durable DDA requests use authenticated fixed actions and validate pending and ACK envelopes',async()=>{
 const id='a'.repeat(32),bodies=[];let corrupt=false;
 const client=createChatClient({apiBaseUrl:'https://app.example.test',tokenProvider:async()=> 'fake',fetchImpl:async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer fake');const body=JSON.parse(options.body);bodies.push(body);
  const receipt=body.mode==='pending'?{status:'pending',requests:[]}:{status:body.acknowledge?'acknowledged':'queued',requestId:corrupt?'b'.repeat(32):id};
  return new Response(JSON.stringify({status:'processed',messages:[],ddaRefresh:receipt}),{status:200});
 }});
 await client.refreshDda({requestId:id});await client.getDdaRefreshPending();await client.acknowledgeDdaRefresh(id);
 assert.deepEqual(bodies,[{action:'dda_refresh',requestId:id},{action:'dda_refresh_status',mode:'pending'},{action:'dda_refresh_status',requestId:id,acknowledge:true}]);
 corrupt=true;await assert.rejects(client.acknowledgeDdaRefresh(id));await assert.rejects(client.refreshDda({requestId:'invalid'}));
});
