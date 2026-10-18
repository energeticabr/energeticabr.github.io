import test from 'node:test';
import assert from 'node:assert/strict';
import {createProvisionDescriptionDeletion as createService} from '../../../portal/forms/provision-description-delete.js';

const clone = value => structuredClone(value);
const row = (id, fields, eTag = `"v${id}"`) => ({id, eTag, fields});
const httpError = status => Object.assign(new Error(`HTTP ${status}`), {status});
function fixture() {
  const records = {
    parents: new Map([['42', row('42', {FORNECEDOR: 'Fornecedor pai', STATUS: 'PENDENTE'})]]),
    children: new Map([
      ['2', row('2', {DESCRITIVOPROVISAO: '42', FORNECEDOR: 'Fornecedor A', PRODUTO: 'Produto A', STATUS: 'PENDENTE'})],
      ['3', row('3', {DESCRITIVOPROVISAO: '42', FORNECEDOR: 'Fornecedor B', PRODUTO: 'Produto B', STATUS: 'PAGO'})],
      ['9', row('9', {DESCRITIVOPROVISAO: '99', FORNECEDOR: 'Outro', PRODUTO: 'Outro', STATUS: 'PENDENTE'})],
    ]),
  };
  const columns = {
    parents: [{name: 'FORNECEDOR', text: {}}],
    children: ['DESCRITIVOPROVISAO', 'FORNECEDOR', 'PRODUTO', 'STATUS'].map(name => ({name, text: {}})),
  };
  const reads = [], writes = [], recycled = new WeakMap();
  let session = true;
  const hooks = {};
  const repository = {
    async resolveList(site, aliases) {
      reads.push(['resolveList', site, aliases]);
      return {status: 'resolved', id: aliases[0] === 'DESCRITIVOPROVISAO' ? 'parents' : 'children'};
    },
    async getColumns(site, list) { reads.push(['getColumns', site, list]); return clone(columns[list]); },
    async getItemsPage(site, list, query, options) {
      assert.equal(list, 'children');
      assert.doesNotMatch(query, /\$filter|PENDENTE/);
      reads.push(['page', site, list, query, clone(options)]);
      if (hooks.page) return hooks.page({site, list, query, options});
      const rows = [...records.children.values()];
      return options.cursor
        ? {items: clone(rows.slice(1)), hasMore: false, nextLink: ''}
        : {items: clone(rows.slice(0, 1)), hasMore: rows.length > 1, nextLink: rows.length > 1 ? 'second-page' : ''};
    },
    async getItem(site, list, id) {
      reads.push(['item', site, list, id]);
      if (hooks.read) await hooks.read({site, list, id});
      const item = records[list]?.get(id);
      if (!item) throw httpError(404);
      return clone(item);
    },
    async deleteItem(site, list, id, options) {
      assert.ok(session, 'never mutate an invalidated session');
      assert.ok(['children', 'parents'].includes(list));
      writes.push({site, list, id, eTag: options.eTag});
      if (hooks.beforeDelete) await hooks.beforeDelete({site, list, id, options});
      const item = records[list].get(id);
      if (!item) throw httpError(404);
      if (item.eTag !== options.eTag) throw httpError(412);
      if (list === 'parents') assert.equal([...records.children.values()].filter(child => child.fields.DESCRITIVOPROVISAO === id).length, 0);
      records[list].delete(id);
      if (hooks.afterDelete) await hooks.afterDelete({site, list, id, options});
    },
    async recycleItem(site, list, id, options) {
      const original = clone(records[list].get(id));
      await repository.deleteItem(site, list, id, options);
      const receipt = Object.freeze({ id }); recycled.set(receipt, { list, id, original });
      return receipt;
    },
    async restoreRecycledItem(_site, list, id, receipt) {
      const original = recycled.get(receipt);
      assert.ok(original && original.list === list && original.id === id);
      records[list].set(id, { ...clone(original.original), eTag: '"restored"' });
      if (hooks.restore) await hooks.restore();
    },
  };
  return {records, columns, repository, reads, writes, hooks,
    invalidate() { session = false; },
    service(options = {}) { return createService({repository, assertSession() { if (!session) throw new Error('session changed'); }, ...options}); },
  };
}
const incomplete = error => {
  assert.equal(error.code, 'PROVISION_DESCRIPTION_DELETE_INCOMPLETE');
  assert.match(error.message, /parcial|incompleta|não.*conclu/i);
  assert.match(error.message, /tente|retent|novamente/i);
  return true;
};
const stale = error => {
  assert.ok(error.requiresPreview || /pr[eé]via|confirm/i.test(error.message));
  return true;
};

test('preview freezes the parent and ALL children across pages/statuses without writes', async () => {
  const f = fixture(), context = await f.service().preview('42');
  assert.deepEqual(context, {id: '42', supplier: 'Fornecedor pai', children: [
    {id: '2', supplier: 'Fornecedor A', product: 'Produto A', status: 'PENDENTE'},
    {id: '3', supplier: 'Fornecedor B', product: 'Produto B', status: 'PAGO'},
  ]});
  assert.ok(Object.isFrozen(context) && Object.isFrozen(context.children) && context.children.every(Object.isFrozen));
  assert.deepEqual(f.writes, []);
  assert.equal(f.reads.filter(read => read[0] === 'page').length, 2);
});

test('preview avoids the full-field scan that times out on large provision lists', async () => {
  const f = fixture(), getPage = f.repository.getItemsPage;
  f.repository.getItemsPage = async (...args) => {
    const query = new URLSearchParams(args[2]);
    if (query.get('$expand') === 'fields') throw Object.assign(new Error('Graph timeout'), {code:'request_timeout'});
    assert.equal(query.get('$expand'), 'fields($select=DESCRITIVOPROVISAO,FORNECEDOR,PRODUTO,STATUS)');
    assert.equal(query.has('$select'), false, 'keep the item ETag and identity in the response');
    return getPage(...args);
  };
  const context = await f.service().preview('42');
  assert.deepEqual(context.children.map(child => child.id), ['2','3']);
  assert.equal(f.writes.length, 0);
});

for (const code of ['request_timeout', 'network_error']) test(`preview retries a transient ${code} on the same page without losing earlier children`, async () => {
  const f = fixture(), getPage = f.repository.getItemsPage;
  let failed = false;
  f.repository.getItemsPage = async (...args) => {
    if (args[3].cursor && !failed) { failed = true; throw Object.assign(new Error('Graph unavailable'), {code}); }
    return getPage(...args);
  };
  const context = await f.service().preview('42');
  assert.equal(failed, true);
  assert.deepEqual(context.children.map(child => child.id), ['2','3']);
  assert.equal(f.writes.length, 0);
});

test('persistent timeout is bounded and never permits deletion from an incomplete preview', async () => {
  const f = fixture(); let attempts = 0;
  f.repository.getItemsPage = async () => { attempts++; throw Object.assign(new Error('Graph timeout'), {code:'request_timeout'}); };
  await assert.rejects(f.service().preview('42'), error => error.code === 'request_timeout');
  assert.equal(attempts, 2);
  assert.equal(f.writes.length, 0);
});

test('an expired request cannot retry under an invalidated session', async () => {
  const f = fixture(); let attempts = 0;
  f.repository.getItemsPage = async () => { attempts++; f.invalidate(); throw Object.assign(new Error('Graph timeout'), {code:'request_timeout'}); };
  await assert.rejects(f.service().preview('42'), error => error.code === 'PROVISION_DESCRIPTION_DELETE_SESSION');
  assert.equal(attempts, 1);
  assert.equal(f.writes.length, 0);
});

for (const status of [401,403]) test(`preview does not retry authorization failure ${status}`, async () => {
  const f = fixture(); let attempts = 0;
  f.repository.getItemsPage = async () => { attempts++; throw httpError(status); };
  await assert.rejects(f.service().preview('42'), error => error.status === status);
  assert.equal(attempts, 1);
  assert.equal(f.writes.length, 0);
});

test('a timed-out delete is reconciled without automatically repeating the mutation', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  f.hooks.afterDelete = () => { throw Object.assign(new Error('Graph timeout'), {code:'request_timeout'}); };
  assert.equal((await service.remove(context, {confirm:true})).deleted, true);
  assert.deepEqual(f.writes.map(write => write.id), ['2','3','42']);
});

test('persistent timeout during confirmation verification makes no financial changes', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42'); let attempts = 0;
  f.repository.getItemsPage = async () => { attempts++; throw Object.assign(new Error('Graph timeout'), {code:'request_timeout'}); };
  await assert.rejects(service.remove(context, {confirm:true}), error => error.code === 'request_timeout');
  assert.equal(attempts, 2);
  assert.equal(f.writes.length, 0);
});

test('No, omitted confirmation and forged or cross-service contexts write nothing', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  for (const options of [undefined, {}, {confirm: false}, {confirm: 'true'}]) await assert.rejects(service.remove(context, options));
  await assert.rejects(service.remove({...context}, {confirm: true}));
  await assert.rejects(f.service().remove(context, {confirm: true}));
  assert.deepEqual(f.writes, []);
});

test('confirmed cascade deletes only shown children with exact ETags and the parent LAST', async () => {
  const f = fixture(), service = f.service({siteKey: 'company'}), context = await service.preview('42');
  const result = await service.remove(context, {confirm: true});
  assert.deepEqual(result, {id: '42', deletedChildIds: ['2', '3'], deleted: true});
  assert.deepEqual(f.writes, [
    {site: 'company', list: 'children', id: '2', eTag: '"v2"'},
    {site: 'company', list: 'children', id: '3', eTag: '"v3"'},
    {site: 'company', list: 'parents', id: '42', eTag: '"v42"'},
  ]);
  assert.equal(f.records.children.size, 1);
  assert.ok(f.records.children.has('9'));
  assert.deepEqual(await service.remove(context, {confirm: true}), result);
  assert.equal(f.writes.length, 3);
});

test('empty linked set permits conditional parent deletion', async () => {
  const f = fixture(); f.records.children.delete('2'); f.records.children.delete('3');
  const service = f.service(); await service.remove(await service.preview('42'), {confirm: true});
  assert.deepEqual(f.writes.map(write => [write.list, write.id]), [['parents', '42']]);
});

for (const mutation of ['parent version', 'child version', 'child relink', 'new child', 'missing child', 'child identity']) {
  test(`confirmation rejects ${mutation} before ANY deletion`, async () => {
    const f = fixture(), service = f.service(), context = await service.preview('42');
    if (mutation === 'parent version') f.records.parents.get('42').eTag = '"v43"';
    if (mutation === 'child version') f.records.children.get('3').eTag = '"v4"';
    if (mutation === 'child relink') f.records.children.get('3').fields.DESCRITIVOPROVISAO = '99';
    if (mutation === 'new child') f.records.children.set('4', row('4', {...f.records.children.get('3').fields}));
    if (mutation === 'missing child') f.records.children.delete('3');
    if (mutation === 'child identity') f.hooks.read = ({list, id}) => { if (list === 'children' && id === '3') f.records.children.get('3').id = '6'; };
    await assert.rejects(service.remove(context, {confirm: true}), stale);
    assert.equal(f.writes.length, 0);
  });
}

for (const malformed of ['partial', 'truncated items', 'duplicate', 'bad id', 'bad fields', 'bad link', 'missing hasMore', 'cursor loop', 'conflicting cursor', 'page limit', 'batch mismatch']) {
  test(`preview rejects ${malformed} enumeration`, async () => {
    const f = fixture();
    f.hooks.page = () => {
      const item = clone(f.records.children.get('2'));
      const page = {items: [item], hasMore: false};
      if (malformed === 'partial') page.complete = false;
      if (malformed === 'truncated items') page.items.truncated = true;
      if (malformed === 'duplicate') page.items.push(clone(item));
      if (malformed === 'bad id') item.id = '2e0';
      if (malformed === 'bad fields') item.fields = [];
      if (malformed === 'bad link') item.fields.DESCRITIVOPROVISAO = {id: '42'};
      if (malformed === 'missing hasMore') delete page.hasMore;
      if (malformed === 'cursor loop') { page.hasMore = true; page.nextLink = 'repeat'; }
      if (malformed === 'conflicting cursor') page.nextLink = 'unused';
      if (malformed === 'page limit') { page.items = []; page.hasMore = true; page.nextLink = `next-${f.reads.length}`; }
      if (malformed === 'batch mismatch') page.batchCount = 10;
      return page;
    };
    await assert.rejects(f.service().preview('42'));
    assert.equal(f.writes.length, 0);
  });
}

for (const eTag of [undefined, '*', ' * ', 'W/"*"', '"a"\r\nIf-Match: *', '"a", "b"', 2, 'unquoted']) {
  for (const list of ['parents', 'children']) test(`rejects unsafe ${list} ETag ${JSON.stringify(eTag)}`, async () => {
    const f = fixture(); f.records[list].get(list === 'parents' ? '42' : '2').eTag = eTag;
    await assert.rejects(f.service().preview('42'));
    assert.equal(f.writes.length, 0);
  });
}

test('discovers encoded internal names from metadata and rejects ambiguous/nontext links', async () => {
  const f = fixture();
  f.columns.children[0] = {name: 'Descricao_x0050_ai', displayName: 'DESCRITIVOPROVISAO', text: {}};
  for (const child of f.records.children.values()) { child.fields.Descricao_x0050_ai = child.fields.DESCRITIVOPROVISAO; delete child.fields.DESCRITIVOPROVISAO; }
  assert.equal((await f.service().preview('42')).children.length, 2);
  f.columns.children.push({name: 'Another', displayName: 'DESCRITIVOPROVISAO', text: {}});
  await assert.rejects(f.service().preview('42'));
  f.columns.children = [{name: 'DESCRITIVOPROVISAO', lookup: {}}, ...f.columns.children.slice(1, 4)];
  await assert.rejects(f.service().preview('42'));
});

test('partial failure preserves parent and resumes only remaining confirmed children', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  f.hooks.beforeDelete = ({id}) => { if (id === '3') throw new Error('offline'); };
  await assert.rejects(service.remove(context, {confirm: true}), incomplete);
  assert.ok(f.records.parents.has('42'));
  assert.ok(!f.records.children.has('2'));
  f.hooks.beforeDelete = undefined;
  assert.deepEqual(await service.remove(context, {confirm: true}), {id: '42', deletedChildIds: ['2', '3'], deleted: true});
  assert.equal(f.writes.filter(write => write.id === '2').length, 1);
});

for (const list of ['children', 'parents']) test(`lost ${list} delete response is verified by intended item 404`, async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  f.hooks.afterDelete = target => { if (target.list === list) throw new Error('lost response'); };
  assert.equal((await service.remove(context, {confirm: true})).deleted, true);
  assert.equal(f.writes.length, 3);
});

test('lost response with unreadable outcome resumes safely on the SAME context', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  f.hooks.afterDelete = ({id}) => {
    if (id === '2') { f.hooks.read = ({id: readId}) => { if (readId === '2') throw httpError(503); }; throw new Error('lost'); }
  };
  await assert.rejects(service.remove(context, {confirm: true}), incomplete);
  f.hooks.read = undefined; f.hooks.afterDelete = undefined;
  assert.equal((await service.remove(context, {confirm: true})).deleted, true);
  assert.equal(f.writes.filter(write => write.id === '2').length, 1);
});

for (const mutation of ['new child', 'remaining version', 'recreated child', 'parent version', 'relinked child']) {
  test(`partial retry rejects ${mutation} and requires another preview/confirmation`, async () => {
    const f = fixture(), service = f.service(), context = await service.preview('42');
    f.hooks.beforeDelete = ({id}) => { if (id === '3') throw new Error('offline'); };
    await assert.rejects(service.remove(context, {confirm: true}), incomplete);
    f.hooks.beforeDelete = undefined;
    if (mutation === 'new child') f.records.children.set('4', row('4', {...f.records.children.get('3').fields}));
    if (mutation === 'remaining version') f.records.children.get('3').eTag = '"changed"';
    if (mutation === 'recreated child') f.records.children.set('2', row('2', {...f.records.children.get('3').fields}, '"new"'));
    if (mutation === 'parent version') f.records.parents.get('42').eTag = '"changed"';
    if (mutation === 'relinked child') f.records.children.get('3').fields.DESCRITIVOPROVISAO = '99';
    const count = f.writes.length;
    await assert.rejects(service.remove(context, {confirm: true}), stale);
    await assert.rejects(service.remove(context, {confirm: true}), stale);
    assert.equal(f.writes.length, count);
    assert.ok(f.records.parents.has('42'));
  });
}

test('a new link after children were deleted prevents parent deletion', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  f.hooks.afterDelete = ({id}) => { if (id === '3') f.records.children.set('4', row('4', {DESCRITIVOPROVISAO: '42'})); };
  await assert.rejects(service.remove(context, {confirm: true}), stale);
  assert.ok(f.records.parents.has('42'));
  assert.deepEqual(f.writes.map(write => write.id), ['2', '3']);
});

for (const status of [401, 403]) test(`HTTP ${status} is never treated as successful deletion even if item is absent`, async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  f.hooks.afterDelete = ({id}) => { if (id === '2') throw httpError(status); };
  await assert.rejects(service.remove(context, {confirm: true}), error => { incomplete(error); assert.equal(error.cause.status, status); return true; });
  assert.ok(f.records.parents.has('42'));
  assert.deepEqual(f.writes.map(write => write.id), ['2']);
});

test('a missing unattempted parent is never accepted as completed', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42'); f.records.parents.delete('42');
  await assert.rejects(service.remove(context, {confirm: true}), stale);
  assert.equal(f.writes.length, 0);
});

test('session change before confirm and after mutation stops all later writes', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42'); f.invalidate();
  await assert.rejects(service.remove(context, {confirm: true})); assert.equal(f.writes.length, 0);
  const g = fixture(), next = g.service(), nextContext = await next.preview('42');
  g.hooks.afterDelete = () => g.invalidate();
  await assert.rejects(next.remove(nextContext, {confirm: true}), incomplete);
  assert.deepEqual(g.writes.map(write => write.id), ['2']);
  assert.ok(g.records.parents.has('42'));
});

test('asserts session after a rejected remote read and invalidates during preview', async () => {
  const f = fixture();
  f.hooks.page = () => { f.invalidate(); throw httpError(503); };
  await assert.rejects(f.service().preview('42'), /session/i);
  assert.equal(f.writes.length, 0);
});

test('parallel confirmations cannot duplicate deletes', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  const results = await Promise.allSettled([service.remove(context, {confirm: true}), service.remove(context, {confirm: true})]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.writes.length, 3);
});

test('changed schema and a missing list require a new preview without any deletion', async () => {
  for (const change of ['schema', 'list']) {
    const f = fixture(), service = f.service(), context = await service.preview('42');
    if (change === 'schema') f.columns.children[0] = {name: 'NewLink', displayName: 'DESCRITIVOPROVISAO', text: {}};
    else f.repository.resolveList = async () => ({status: 'missing'});
    await assert.rejects(service.remove(context, {confirm: true}), stale);
    assert.equal(f.writes.length, 0);
  }
});

test('conditional conflict preserves children remaining and requires a new confirmation', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  f.hooks.beforeDelete = ({id}) => { if (id === '3') f.records.children.get('3').eTag = '"concurrent"'; };
  await assert.rejects(service.remove(context, {confirm: true}), error => { incomplete(error); assert.equal(error.requiresPreview, true); return true; });
  const count = f.writes.length;
  await assert.rejects(service.remove(context, {confirm: true}), stale);
  assert.equal(f.writes.length, count);
  assert.ok(f.records.children.has('3') && f.records.parents.has('42'));
});

test('a lost parent response with an uncertain read resumes without a second parent DELETE', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  f.hooks.afterDelete = ({list}) => {
    if (list === 'parents') {
      f.hooks.read = ({list: readList}) => { if (readList === 'parents') throw httpError(503); };
      throw new Error('lost parent response');
    }
  };
  await assert.rejects(service.remove(context, {confirm: true}), incomplete);
  f.hooks.read = undefined; f.hooks.afterDelete = undefined;
  assert.equal((await service.remove(context, {confirm: true})).deleted, true);
  assert.equal(f.writes.filter(write => write.list === 'parents').length, 1);
});

test('a metadata 404 during retry is never accepted as evidence of an intended item deletion', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  f.hooks.beforeDelete = ({id}) => { if (id === '3') throw new Error('offline'); };
  await assert.rejects(service.remove(context, {confirm: true}), incomplete);
  const count = f.writes.length;
  f.repository.getColumns = async () => { throw httpError(404); };
  await assert.rejects(service.remove(context, {confirm: true}), incomplete);
  assert.equal(f.writes.length, count);
  assert.ok(f.records.parents.has('42'));
});

test('a session change after a preflight read prevents the first mutation', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  f.hooks.read = ({list, id}) => { if (list === 'children' && id === '3') f.invalidate(); };
  await assert.rejects(service.remove(context, {confirm: true}));
  assert.equal(f.writes.length, 0);
});

test('preview rejects partial column metadata', async () => {
  const f = fixture();
  f.repository.getColumns = async (_site, list) => Object.assign(clone(f.columns[list]), {complete: false});
  await assert.rejects(f.service().preview('42'), stale);
});

test('preview rejects malformed terminal cursors', async () => {
  const f = fixture();
  f.hooks.page = () => ({items: [], hasMore: false, nextLink: false});
  await assert.rejects(f.service().preview('42'), stale);
});

test('a concurrent child at the parent removal boundary restores the parent, never deletes the unseen child or reports success', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  f.hooks.afterDelete = ({list}) => {
    if (list === 'parents') f.records.children.set('4', row('4', {DESCRITIVOPROVISAO:'42',FORNECEDOR:'NOVO',PRODUTO:'NOVO',STATUS:'PENDENTE'}));
  };
  await assert.rejects(service.remove(context,{confirm:true}), error => error.code === 'PROVISION_DESCRIPTION_DELETE_INCOMPLETE' && error.requiresPreview);
  assert.equal(f.records.parents.has('42'),true,'the original parent is restored for the concurrent child');
  assert.equal(f.records.children.has('4'),true,'unseen child requires another explicit confirmation');
  assert.deepEqual(f.writes.filter(write=>write.list==='children').map(write=>write.id),['2','3']);
});

test('a failed final child scan restores the parent instead of declaring unproved complete deletion', async () => {
  const f = fixture(), service = f.service(), context = await service.preview('42');
  f.hooks.afterDelete = ({list}) => { if(list==='parents') f.hooks.page=()=>{throw new Error('read unavailable');}; };
  await assert.rejects(service.remove(context,{confirm:true}),error=>error.requiresPreview);
  assert.equal(f.records.parents.has('42'),true);
});

test('no recoverable parent primitive means no child can be deleted', async () => {
  const f=fixture(), service=f.service(), context=await service.preview('42');
  delete f.repository.restoreRecycledItem;
  await assert.rejects(service.remove(context,{confirm:true}),stale);
  assert.equal(f.writes.length,0);
});

test('a lost restore response is verified by the original parent ID and requires a new preview', async () => {
  const f=fixture(), service=f.service(), context=await service.preview('42');
  f.hooks.afterDelete=({list})=>{if(list==='parents')f.records.children.set('4',row('4',{DESCRITIVOPROVISAO:'42',FORNECEDOR:'NOVO',PRODUTO:'NOVO',STATUS:'PENDENTE'}));};
  f.hooks.restore=()=>{throw new Error('lost restore response');};
  await assert.rejects(service.remove(context,{confirm:true}),error=>error.requiresPreview);
  assert.equal(f.records.parents.get('42').fields.FORNECEDOR,'Fornecedor pai');
  assert.equal(f.records.children.has('4'),true);
  assert.equal(f.writes.length,3);
});

test('failed restoration retries only undo, never repeats deletes or touches the unseen child', async () => {
  const f=fixture(), service=f.service(), context=await service.preview('42');
  f.hooks.afterDelete=({list})=>{if(list==='parents')f.records.children.set('4',row('4',{DESCRITIVOPROVISAO:'42',FORNECEDOR:'NOVO',PRODUTO:'NOVO',STATUS:'PENDENTE'}));};
  const restore=f.repository.restoreRecycledItem;
  f.repository.restoreRecycledItem=async()=>{throw new Error('restore unavailable');};
  await assert.rejects(service.remove(context,{confirm:true}),error=>error.code==='PROVISION_DESCRIPTION_DELETE_INCOMPLETE' && error.retryable);
  f.repository.restoreRecycledItem=restore;
  await assert.rejects(service.remove(context,{confirm:true}),error=>error.requiresPreview);
  assert.equal(f.records.parents.has('42'),true);
  assert.equal(f.records.children.has('4'),true);
  assert.equal(f.writes.length,3);
});
