import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraphClient } from '../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../portal/data/sharepoint-repository.js';
import { createContractorEmploymentData } from '../src/chat/contractor-employment-data.js';
import { memoryStorage } from './helpers/contractor-employment-transport.mjs';

const SOURCE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const inactive = { CARGO: 'PEDREIRO III', DATAADMISSAO: '2026-01-20', STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-02-20' };
const partial = error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL';
function fixture(transport) {
  const source = { id: '17', eTag: '"1"', fields: { STATUS: 'ATIVO', EMPREITEIRO: 'SIM', Title: 'ORIGINAL NAME', EMAIL: 'unedited@synthetic.invalid', CARGO: 'SOURCE RH MUST NOT BE READ' } };
  const target = { id: '4', eTag: '"1"', fields: { ...inactive, STATUS: 'ATIVO', DATADESLIGAMENTO: null, IDFORNECEDORORIGEM: '17', FILIAL: 'ORIGINAL BRANCH' } };
  const reads = [], writes = [], storage = memoryStorage();
  let sourceFailure = '', targetFailure = '', afterTarget;
  const rawRest = item => ({ ID: Number(item.id), '@odata.etag': item.eTag, ...item.fields });
  const boundary = async (path, options = {}) => {
    const url = new URL(path, 'https://synthetic.invalid'), query = url.searchParams;
    const isSource = path.includes(SOURCE), isTarget = path.includes(TARGET);
    if (options.method === 'PATCH' || options.headers?.['X-HTTP-Method'] === 'MERGE') {
      const record = isSource ? source : target;
      const fields = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      writes.push({ source: isSource, fields, eTag: options.headers?.['If-Match'] ?? options.headers?.['IF-MATCH'] });
      assert.equal(writes.at(-1).eTag, record.eTag);
      if (isSource && sourceFailure === 'before') throw new Error('Synthetic failure before mutation');
      if (isTarget && targetFailure === '412') {
        targetFailure = ''; target.eTag = '"8"'; target.fields.FILIAL = 'CONCURRENT BRANCH';
        throw Object.assign(new Error('Synthetic target conflict'), { status: 412 });
      }
      Object.assign(record.fields, isSource && sourceFailure === 'status-only' ? { STATUS: fields.STATUS } : fields);
      record.eTag = '"' + (Number(record.eTag.replaceAll('"', '')) + 1) + '"';
      if (isSource && sourceFailure === 'lost') throw new Error('Synthetic lost source response');
      if (isTarget) afterTarget?.();
      return transport === 'rest' ? undefined : {};
    }
    if ((isSource || isTarget) && (/\/items(?:\/\d+|\(\d+\))/.test(url.pathname))) {
      const record = structuredClone(isSource ? source : target);
      const names = transport === 'rest' ? (query.get('$select')?.includes('*') ? undefined : query.get('$select')?.split(',').filter(name => name !== 'ID'))
        : query.get('$expand')?.match(/fields\(\$select=([^)]*)\)/)?.[1].split(',');
      if (isSource) reads.push(names || ['*']);
      if (names) record.fields = Object.fromEntries(names.filter(name => Object.hasOwn(record.fields, name)).map(name => [name, record.fields[name]]));
      return transport === 'rest' ? rawRest(record) : record;
    }
    if (url.pathname.endsWith('/lists')) return { value: transport === 'rest'
      ? [{ Id: SOURCE, Title: 'FORNECEDORES', Hidden: false, BaseTemplate: 100 }, { Id: TARGET, Title: 'FUNCIONARIOSRH', Hidden: false, BaseTemplate: 100 }]
      : [{ id: SOURCE, displayName: 'FORNECEDORES', list: { template: 'genericList' } }, { id: TARGET, displayName: 'FUNCIONARIOSRH', list: { template: 'genericList' } }] };
    return { id: 'site' };
  };
  const repository = createSharePointRepository(createGraphClient(async () => 'synthetic-token', { fetch: async (path, options) => {
    try { return new Response(JSON.stringify(await boundary(path, options)), { status: 200, headers: { 'content-type': 'application/json' } }); }
    catch (error) { if (error.status) return new Response(JSON.stringify({ error: { message: error.message } }), { status: error.status }); throw error; }
  } }), { personal: { host: 'synthetic.invalid', path: '/sites/rh', readTransport: transport, writeTransport: transport } },
  { restTransport: { request: (_config, path, options) => boundary(path, options) } });
  const context = { storage, accountKey: 'synthetic-account', siteIdentity: 'synthetic.invalid/sites/rh' };
  const selected = structuredClone(target), originalSource = structuredClone(source);
  return { source, target, reads, writes, storage, selected, data: () => createContractorEmploymentData({ repository, ...context }),
    edit: Title => ({ sourceEdit: { list: { id: SOURCE }, selected: originalSource, fields: { STATUS: 'INATIVO', Title } } }),
    failSource: value => { sourceFailure = value; }, failTarget: value => { targetFailure = value; }, afterTarget: fn => { afterTarget = fn; } };
}
for (const transport of ['graph', 'rest']) {
  test(transport + ': reconciled lost mixed response survives target 412/recreation and never replays confirmed Title over a concurrent edit', async () => {
    const f = fixture(transport); f.failSource('lost');
    await assert.rejects(f.data().save(f.selected, inactive, f.edit('FIRST EDIT')), partial);
    f.failSource(''); f.failTarget('412');
    await assert.rejects(f.data().save(f.selected, inactive, f.edit('FIRST EDIT')), partial);
    f.source.eTag = '"9"'; f.source.fields.Title = 'CONCURRENT EDIT'; f.source.fields.STATUS = 'ATIVO';
    const readsBeforeGallery = f.reads.length, data = f.data();
    const baseline = await data.renewBaseline(await data.loadConflict(f.target));
    await data.save(baseline, baseline.pendingDraft);
    assert.equal(f.source.fields.Title, 'CONCURRENT EDIT');
    assert.equal(f.source.fields.STATUS, 'INATIVO'); assert.equal(f.target.fields.STATUS, 'INATIVO');
    assert.deepEqual(f.writes.filter(w => w.source).map(w => w.fields), [{ STATUS: 'INATIVO', Title: 'FIRST EDIT' }, { STATUS: 'INATIVO' }]);
    assert.ok(f.reads.slice(readsBeforeGallery).every(names => names.join(',') === 'STATUS,EMPREITEIRO'), 'pure gallery recovery remains minimally scoped');
    assert.ok(f.reads.some(names => names.includes('Title')), 'mixed recovery must prove the edited field');
    assert.ok(f.reads.every(names => names.every(name => ['STATUS', 'EMPREITEIRO', 'Title'].includes(name))));
  });
  test(transport + ': another writer matching STATUS cannot confirm an unpersisted Title or delete its journal', async () => {
    const f = fixture(transport); f.failSource('before');
    await assert.rejects(f.data().save(f.selected, inactive, f.edit('REQUESTED TITLE')), partial);
    f.source.eTag = '"9"'; f.source.fields.STATUS = 'INATIVO'; f.failSource('');
    const data = f.data(), before = f.writes.length;
    const readsBeforeGallery = f.reads.length;
    await assert.rejects(data.save(f.selected, inactive), partial);
    assert.equal((await data.loadConflict(f.selected)).canRenew, false);
    assert.ok(f.reads.slice(readsBeforeGallery).every(names => names.join(',') === 'STATUS,EMPREITEIRO'), 'unconfirmed mixed fields must return to the supplier form without broadening gallery reads');
    await assert.rejects(data.save(f.selected, inactive, f.edit('REQUESTED TITLE')), partial);
    assert.equal(f.writes.length, before); assert.equal(f.source.fields.Title, 'ORIGINAL NAME');
    assert.equal(data.getPending(f.selected).sourceFields.Title, 'REQUESTED TITLE');
    assert.ok(f.storage.entries.size > 0);
    const review = await data.loadConflict(f.selected, { sourceEdit: true });
    assert.equal(review.source.fields.Title, 'ORIGINAL NAME');
    assert.equal(review.pendingSourceFields.Title, 'REQUESTED TITLE');
    const baseline = await data.renewBaseline(review);
    const saved = await data.save(baseline, baseline.pendingDraft, f.edit('REQUESTED TITLE'));
    assert.equal(saved.fields.Title, f.source.fields.Title);
    assert.equal(saved.fields.Title, 'REQUESTED TITLE'); assert.equal(f.storage.entries.size, 0);
    assert.ok(f.reads.every(names => names.every(name => ['STATUS', 'EMPREITEIRO', 'Title'].includes(name))));
  });
  test(transport + ': a STATUS-only server readback cannot create a successful mixed-edit receipt', async () => {
    const f = fixture(transport); f.failSource('status-only');
    await assert.rejects(f.data().save(f.selected, inactive, f.edit('REQUESTED TITLE')), partial);
    assert.equal(f.source.fields.Title, 'ORIGINAL NAME'); assert.equal(f.target.fields.STATUS, 'ATIVO');
    assert.ok(f.storage.entries.size > 0);
  });
  test(transport + ': a later concurrent Title is returned from exact readback, never fabricated from the original intent', async () => {
    const f = fixture(transport);
    f.afterTarget(() => { f.source.eTag = '"9"'; f.source.fields.Title = 'CONCURRENT EDIT'; });
    const saved = await f.data().save(f.selected, inactive, f.edit('FIRST EDIT'));
    assert.equal(saved.fields.Title, 'CONCURRENT EDIT');
    assert.deepEqual(f.writes.filter(w => w.source).map(w => w.fields), [{ STATUS: 'INATIVO', Title: 'FIRST EDIT' }]);
  });
}
