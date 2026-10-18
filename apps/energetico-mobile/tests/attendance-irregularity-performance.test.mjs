import test from 'node:test';
import assert from 'node:assert/strict';
import * as data from '../src/chat/attendance-irregularity-data.js';

test('save starts the fresh item read while column metadata is still pending, but writes only after both validate', async () => {
  let releaseColumns;
  const columns = new Promise(resolve => { releaseColumns = resolve; });
  const calls = [];
  const repository = {
    resolveList: async () => ({ status:'resolved', id:'presence-list' }),
    getColumns: () => { calls.push('columns'); return columns; },
    getItem: async () => { calls.push('item'); return { id:'2249', '@odata.etag':'"4"', fields:{DATA:'2026-10-16'} }; },
    updateItem: async (...args) => { calls.push(['write',...args]); },
  };
  const pending = data.saveAttendanceIrregularity({ repository,id:'2249',date:'2026-10-16',explanation:'Saída autorizada.' });
  await new Promise(resolve => setImmediate(resolve));
  try { assert.deepEqual(calls,['columns','item']); }
  finally { releaseColumns([{name:'IRREGULARIDADES',text:{allowMultipleLines:true}}]); await pending; }
  assert.deepEqual(calls[2],['write','personal','presence-list','2249',{IRREGULARIDADES:'Saída autorizada.'},{eTag:'"4"'}]);
});

test('one session reuses real repository metadata but rereads the current item and ETag on every save', async t => {
  const calls=[];
  let version=1,note='';
  t.mock.method(globalThis,'fetch',async (input,options={}) => {
    const url=new URL(input), method=options.method||'GET';
    calls.push({path:url.pathname,method,headers:options.headers,body:options.body});
    let body;
    if(url.pathname.includes('/personal/')) body={id:'personal-site'};
    else if(url.pathname.includes(':/sites/')) body={id:'company-site'};
    else if(url.pathname==='/v1.0/sites/personal-site/lists') body={value:[{id:'presence-list',displayName:'DESCRITIVOPRESENCA',list:{template:'genericList'}}]};
    else if(url.pathname.endsWith('/columns')) body={value:[{name:'IRREGULARIDADES',text:{allowMultipleLines:true}}]};
    else if(url.pathname.endsWith('/items/2249/fields')) {
      assert.equal(method,'PATCH');
      assert.equal(options.headers['If-Match'],`"${version}"`);
      note=JSON.parse(options.body).IRREGULARIDADES;version++;
      body={IRREGULARIDADES:note};
    } else if(url.pathname.endsWith('/items/2249')) body={id:'2249','@odata.etag':`"${version}"`,fields:{DATA:'2026-10-16',IRREGULARIDADES:note}};
    else throw new Error(`Unexpected request ${method} ${url.pathname}`);
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
  });
  const source=data.createAttendanceIrregularityData({tokenProvider:async()=> 'test-token'});
  assert.equal(await source.read({id:'2249',date:'2026-10-16'}),'');
  await source.save({id:'2249',date:'2026-10-16',explanation:'Primeira justificativa.'});
  assert.equal(await source.read({id:'2249',date:'2026-10-16'}),'Primeira justificativa.');
  await source.save({id:'2249',date:'2026-10-16',explanation:'Justificativa corrigida.'});
  assert.equal(calls.filter(call=>call.path.endsWith('/lists')).length,1);
  assert.equal(calls.filter(call=>call.path.endsWith('/columns')).length,1);
  assert.equal(calls.filter(call=>call.path.endsWith('/items/2249')).length,6);
  assert.equal(calls.filter(call=>call.method==='PATCH').length,2);
});

test('a stale session cannot reuse cached metadata to read or write attendance', async () => {
  let active=true,reads=0,writes=0;
  const source=data.createAttendanceIrregularityData({assertSession:()=>{if(!active)throw new Error('Sessão mudou');},repository:{
    resolveList:async()=>({status:'resolved',id:'list'}),
    getItem:async()=>{reads++;return{id:'1',fields:{DATA:'2026-10-16'}};},
    updateItem:async()=>{writes++;},
  }});
  await source.read({id:'1',date:'2026-10-16'});active=false;
  await assert.rejects(async()=>source.read({id:'1',date:'2026-10-16'}),/Sessão mudou/);
  await assert.rejects(async()=>source.save({id:'1',date:'2026-10-16',explanation:'Motivo'}),/Sessão mudou/);
  assert.equal(reads,1);assert.equal(writes,0);
});

test('metadata failures are evicted so a temporary site outage does not poison retries for the whole session', async t => {
  let offline=true;
  t.mock.method(globalThis,'fetch',async input=>{
    const path=new URL(input).pathname;
    if(path.includes('/personal/')) {
      if(offline)throw new Error('Temporariamente indisponível');
      return Response.json({id:'personal-site'});
    }
    if(path.includes(':/sites/'))return Response.json({id:'company-site'});
    if(path.endsWith('/lists'))return Response.json({value:[{id:'presence-list',displayName:'DESCRITIVOPRESENCA',list:{template:'genericList'}}]});
    if(path.endsWith('/items/1'))return Response.json({id:'1',fields:{DATA:'2026-10-16',IRREGULARIDADES:'Motivo já salvo'}});
    throw new Error(`Unexpected request ${path}`);
  });
  const source=data.createAttendanceIrregularityData({tokenProvider:async()=> 'test-token'});
  await assert.rejects(source.read({id:'1',date:'2026-10-16'}),/Temporariamente indisponível/);
  offline=false;
  assert.equal(await source.read({id:'1',date:'2026-10-16'}),'Motivo já salvo');
});

for(const [name,extra,error] of [
  ['wrong date',{fields:{DATA:'2026-10-15'}},/data do registro/i],
  ['missing ETag',{'@odata.etag':undefined},/versão/i],
  ['wildcard ETag',{'@odata.etag':'*'},/versão/i],
])test(`parallel validation never writes with ${name}`,async()=>{
  let writes=0;
  const repository={resolveList:async()=>({status:'resolved',id:'list'}),
    getColumns:async()=>[{name:'IRREGULARIDADES',text:{allowMultipleLines:true}}],
    getItem:async()=>({id:'1','@odata.etag':'"1"',fields:{DATA:'2026-10-16'},...extra}),
    updateItem:async()=>{writes++;}};
  await assert.rejects(data.saveAttendanceIrregularity({repository,id:'1',date:'2026-10-16',explanation:'Motivo'}),error);
  assert.equal(writes,0);
});
