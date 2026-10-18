import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

function harness(t) {
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Unexpected network request');});
  const handlers=new Map(),sources=[],calls=[];
  let owner={homeAccountId:'first-user'},sequence=0;
  const view={render(){},focusComposer(){},destroy(){},on(type,fn){handlers.set(type,fn);return()=>handlers.delete(type);},emit(type,value={}){return handlers.get(type)?.({type,...value});}};
  const auth={initialize:async()=>owner,signIn:async()=>owner,getAccount:()=>owner,getToken:async()=> 'token',signOut:async()=>{}};
  const controller=createAppController({view,auth,store:createConversationStore({randomUUID:()=>`irregular-${++sequence}`}),
    client:{sendText:async()=>({status:'processed',messages:[]})},native:{importSharedItems:async()=>[]},
    pendingProvisionAttachmentsDataFactory:async()=>({loadUpcomingPayments:async()=>[]}),
    attendanceIrregularityDataFactory:options=>{
      sources.push(options);
      return{read:async command=>{options.assertSession();calls.push(['read',command.id]);return '';},
        save:async command=>{options.assertSession();calls.push(['save',command.id]);return{id:command.id,date:command.date};}};
    },
  });
  t.after(()=>controller.stop());
  return{controller,view,auth,sources,calls,setOwner(value){owner=value;}};
}

test('read and submit reuse one guarded attendance data source per authenticated session',async t=>{
  const h=harness(t);await h.controller.start();
  const command={id:'2249',date:'2026-10-16'};
  assert.equal(await h.view.emit('attendance-irregularity-read',command),'');
  await h.view.emit('attendance-irregularity-save',{...command,explanation:'Saída autorizada.'});
  await h.view.emit('attendance-irregularity-read',command);
  assert.equal(h.sources.length,1);
  assert.deepEqual(h.calls,[['read','2249'],['save','2249'],['read','2249']]);
  const first=h.sources[0];
  await h.view.emit('sign-out');
  assert.throws(()=>first.assertSession(),/sessão mudou/i);
  h.setOwner({homeAccountId:'second-user'});await h.view.emit('sign-in');
  await h.view.emit('attendance-irregularity-read',command);
  assert.equal(h.sources.length,2);
  assert.throws(()=>first.assertSession(),/sessão mudou/i);
  h.controller.stop();assert.throws(()=>h.sources[1].assertSession(),/sessão mudou/i);
});

test('cached attendance access rejects an auth-account change even before controller session notification',async t=>{
  const h=harness(t);await h.controller.start();
  await h.view.emit('attendance-irregularity-read',{id:'2249',date:'2026-10-16'});
  h.setOwner({homeAccountId:'other-user'});
  await assert.rejects(h.view.emit('attendance-irregularity-save',{id:'2249',date:'2026-10-16',explanation:'Motivo'}),/sessão mudou/i);
  assert.deepEqual(h.calls,[['read','2249']]);
});

test('a delayed token failure after sign-out never launches authorization for the old session',async t=>{
  const h=harness(t);await h.controller.start();
  await h.view.emit('attendance-irregularity-read',{id:'2249',date:'2026-10-16'});
  let rejectToken,authorizations=0;
  const token=new Promise((resolve,reject)=>{rejectToken=reject;});
  h.auth.getToken=()=>token;
  h.auth.authorize=async()=>{authorizations++;};
  const pending=h.sources[0].tokenProvider(['Sites.ReadWrite.All']);
  await h.view.emit('sign-out');
  rejectToken(Object.assign(new Error('Expired'),{code:'AUTH_REQUIRED'}));
  await assert.rejects(pending,/sessão mudou/i);
  assert.equal(authorizations,0);
});

test('parallel reads share one interactive authorization and discard settled token requests',async t=>{
  const h=harness(t);await h.controller.start();
  await h.view.emit('attendance-irregularity-read',{id:'2249',date:'2026-10-16'});
  let release,authorized=false,authorizations=0,tokenReads=0;
  const authorization=new Promise(resolve=>{release=resolve;});
  h.auth.getToken=async()=>{tokenReads++;if(!authorized)throw Object.assign(new Error('Login'),{code:'AUTH_REQUIRED'});return 'fresh-token';};
  h.auth.authorize=async()=>{authorizations++;await authorization;authorized=true;};
  const provider=h.sources[0].tokenProvider;
  const first=provider(['Sites.Read.All']),second=provider(['Sites.Read.All']);
  await new Promise(resolve=>setImmediate(resolve));
  try{assert.equal(authorizations,1);}
  finally{release();await Promise.all([first,second]);}
  assert.equal(await provider(['Sites.Read.All']),'fresh-token');
  assert.equal(tokenReads,3,'one initial token, one post-authorization token, then a new request after settlement');
});

test('a failed shared authorization is evicted and can be retried',async t=>{
  const h=harness(t);await h.controller.start();
  await h.view.emit('attendance-irregularity-read',{id:'2249',date:'2026-10-16'});
  let attempt=0,authorized=false;
  h.auth.getToken=async()=>{if(!authorized)throw Object.assign(new Error('Login'),{code:'AUTH_REQUIRED'});return 'fresh-token';};
  h.auth.authorize=async()=>{if(++attempt===1)throw new Error('Cancelado');authorized=true;};
  const provider=h.sources[0].tokenProvider;
  const results=await Promise.allSettled([provider(['Sites.Read.All']),provider(['Sites.Read.All'])]);
  assert.ok(results.every(result=>result.status==='rejected'));
  assert.equal(await provider(['Sites.Read.All']),'fresh-token');
  assert.equal(attempt,2);
});
