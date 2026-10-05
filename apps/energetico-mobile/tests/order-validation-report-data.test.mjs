import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpendingReportsData } from '../src/chat/spending-reports-data.js';
import { createSharePointRepository } from '../../../portal/data/sharepoint-repository.js';

function fixture(overrides = {}) {
  const calls = [];
  const repository = {
    async resolveList(site, aliases, options) { calls.push(['resolve', site, aliases, options]); return { status: 'resolved', id: aliases[0] }; },
    async getColumns(site, list, options) { calls.push(['columns', site, list, options]); return [
      ...['FILIAL','FORNECEDOR'].map(name=>({name,displayName:name})),
      ...(list === 'NOTASPENDENTES'
      ? [{ name: 'price', displayName: 'VALORTOTAL' }, { name: 'nf', displayName: 'NOTA FISCAL' },{name:'STATUS',displayName:'STATUS'}]
      : [{ name: 'unit', displayName: 'VALOR UNITÁRIO' },...['AGRUPAR','PRODUTO','QUANTIDADE','FRETE'].map(name=>({name,displayName:name}))])
    ]; },
    async getItemsPage(site, list, query, options) {
      calls.push(['page', site, list, query, options]);
      const fields = list === 'NOTASPENDENTES' ? { price: '0,5', nf: '77', STATUS: 'PENDENTE AUDITORIA' }
        : { unit: '0,1', QUANTIDADE: 3, FRETE: '0,2', AGRUPAR: '1' };
      return { items: [{ id: String(options.pageNumber), fields }], hasMore: options.pageNumber === 1,
        nextLink: options.pageNumber === 1 ? `${list}-next` : '' };
    }, ...overrides,
  };
  const data = createSpendingReportsData({ repository });
  return { calls, load(options) {
    assert.equal(typeof data.loadOrderValidationSnapshot, 'function', 'snapshot API is available');
    return data.loadOrderValidationSnapshot(options);
  } };
}

test('loads both complete lists with columns metadata and follows independent pagination cursors', async () => {
  const { calls, load } = fixture();
  const signal = new AbortController().signal;
  const snapshot = await load({ signal });
  assert.deepEqual(snapshot.orders.map(r => r.id), ['1', '2']);
  assert.deepEqual(snapshot.launches.map(r => r.id), ['1', '2']);
  assert.equal(snapshot.orders[0].total, 0.5); assert.equal(snapshot.orders[0].invoice, '77');
  assert.equal(snapshot.launches[0].total, 0.5); assert.equal(snapshot.launches[0].orderId, '1');
  assert.deepEqual(calls.filter(c => c[0] === 'resolve').map(c => c[2][0]).sort(), ['LANCAMENTOS', 'NOTASPENDENTES']);
  for (const call of calls.filter(c => c[0] === 'page')) {
    const query = new URLSearchParams(call[3]); assert.equal(query.get('$expand'), 'fields');
    assert.equal(query.get('$top'),'100','respect the real Graph repository batch-size contract');
    assert.equal(query.has('$filter'), false); assert.equal(call[4].signal, signal);
    if (call[4].pageNumber === 2) assert.equal(call[4].cursor, `${call[2]}-next`);
  }
  assert.equal(Object.isFrozen(snapshot), true); assert.equal(Object.isFrozen(snapshot.orders), true);
});

test('load never truncates at 2000 records', async () => {
  const { load } = fixture({ async getItemsPage(_site, list, _query, { pageNumber }) {
    return { items: Array.from({ length: 100 }, (_, i) => ({ id: String((pageNumber - 1) * 100 + i + 1), fields: {} })),
      hasMore: pageNumber < 21, nextLink: `${list}-${pageNumber + 1}` };
  } });
  const snapshot = await load(); assert.equal(snapshot.orders.length, 2100); assert.equal(snapshot.launches.length, 2100);
});

test('validation follows more than 100 cursor pages within the existing repository page window',async()=>{
  const counts=new Map();const {load}=fixture({async getItemsPage(_s,list,query,options){
    const page=(counts.get(list)||0)+1;counts.set(list,page);
    assert.equal(new URLSearchParams(query).get('$top'),'100');
    if(page===101){assert.equal(options.pageNumber,1);assert.equal(options.cursor,`${list}-100`);}
    return {items:[{id:String(page),fields:{}}],hasMore:page<101,nextLink:`${list}-${page}`};
  }});
  const snapshot=await load();assert.equal(snapshot.orders.length,101);assert.equal(snapshot.launches.length,101);
});

test('rejects missing lists, invalid metadata, malformed pages and incomplete pagination', async () => {
  const cases = [
    [{ async resolveList() { return { status: 'missing' }; } }, /não está disponível/],
    [{ async getColumns() { return null; } }, /colunas inválidas/],
    [{ async getColumns() { return []; } }, /coluna.*ausente/i],
    [{ async getItemsPage() { return {items:[null],hasMore:false}; } }, /item.*inválido/i],
    [{ async getItemsPage() { return {items:[{id:'1'}],hasMore:false}; } }, /item.*inválido/i],
    [{ async getItemsPage() { return {items:[{id:'x',fields:{}}],hasMore:false}; } }, /item.*inválido/i],
    [{ async getItemsPage() { return { items: null, hasMore: false }; } }, /página.*inválida/],
    [{ async getItemsPage() { return { items: [], nextLink: '' }; } }, /mais páginas/],
    [{ async getItemsPage() { return { items: [], hasMore: true, nextLink: '' }; } }, /próxima página/],
    [{ async getItemsPage() { return { items: [], hasMore: true, nextLink: 'again' }; } }, /parcial|paginação/],
    [{ async getItemsPage(_s, _l, _q, options) { if (options.pageNumber === 2) throw new Error('second page unavailable');
      return { items: [{ id: '1', fields: {} }], hasMore: true, nextLink: 'next' }; } }, /second page unavailable/],
  ];
  for (const [overrides, error] of cases) await assert.rejects(async () => fixture(overrides).load(), error);
});

test('abort before loading does not access repository', async () => {
  const { load, calls } = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(async () => load({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 0);
});

test('abort during pagination refuses a partial snapshot', async () => {
  const controller = new AbortController();
  const { load } = fixture({ async getItemsPage() {
    controller.abort(); return { items: [{ id: '1', fields: {} }], hasMore: false };
  } });
  await assert.rejects(async () => load({ signal: controller.signal }), { name: 'AbortError' });
});

test('snapshot crosses the real Graph repository batch contract and validated next-link boundary',async()=>{
  const requests=[];
  const real=createSharePointRepository({async request(path){
    requests.push(path);
    if(!path.includes('/items'))return {id:'site-id'};
    if(path.includes('NOTASPENDENTES')&&!path.includes('$skiptoken'))return {
      value:[{id:'362',fields:{price:99.8,nf:'PENDENTE',STATUS:'PENDENTE AUDITORIA'}}],
      '@odata.nextLink':'https://graph.microsoft.com/v1.0/sites/site-id/lists/NOTASPENDENTES/items?$skiptoken=more'
    };
    if(path.includes('NOTASPENDENTES'))return {value:[{id:'361',fields:{price:1,STATUS:'PENDENTE AUDITORIA'}}]};
    return {value:[{id:'3505',fields:{AGRUPAR:'362',unit:99.8,QUANTIDADE:1,FRETE:0}}]};
  }},{personal:{host:'example.sharepoint.com',path:'/sites/test',readTransport:'graph'}});
  const {load}=fixture({getItemsPage:real.getItemsPage});const snapshot=await load();
  assert.deepEqual(snapshot.orders.map(row=>row.id),['362','361']);
  assert.equal(snapshot.launches[0].total,99.8);
  assert.ok(requests.some(path=>path.includes('$skiptoken=more')));
  await assert.rejects(real.getItemsPage('personal','NOTASPENDENTES','$expand=fields&$top=500'),/lote Graph/);
});
