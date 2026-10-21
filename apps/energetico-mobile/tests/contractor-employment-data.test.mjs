import test from 'node:test';
import assert from 'node:assert/strict';
import * as subject from '../src/chat/contractor-employment-data.js';
import { createSharePointRepository } from '../../../portal/data/sharepoint-repository.js';
import { createContractorEmploymentFixture as setup } from './helpers/contractor-employment-fixture.mjs';

// Removing pagination, date checks, source-first writes or ETags must break these tests.
test('loads all pages and preserves business types, origin and audit; search and filters find later rows', async () => {
  const { data, pages } = setup();
  const snapshot = await data.loadSnapshot();
  assert.deepEqual(pages, ['first', 'page-two']);
  assert.equal(snapshot.rows.length, 2);
  const found = subject.filterContractorEmploymentRows(snapshot.rows, { search: 'exemplo', STATUS: 'ATIVO', FILIAL: 'Obra A', CARGO: 'PEDREIRO III' });
  assert.equal(found.length, 1);
  assert.equal(found[0].fields.field_6, 31);
  assert.equal(found[0].fields.IDFORNECEDORORIGEM, '17');
  assert.equal(subject.filterContractorEmploymentRows(snapshot.rows, { search: '2026-01-01' }).length, 1);
  assert.equal(subject.filterContractorEmploymentRows(snapshot.rows, { STATUS: 'INATIVO' }).length, 1);
});
test('refuses broken pagination rather than presenting incomplete search results', async () => {
  const { data, repository } = setup();
  repository.getItemsPage = async () => ({ items: [], hasMore: true, nextLink: 'loop' });
  await assert.rejects(data.loadSnapshot(), /pagina/i);
});
for (const date of ['', '2026-02-30', '2026-01-19']) test(`rejects invalid/early termination "${date}" before writes`, async () => {
  const { data, target, writes } = setup();
  await assert.rejects(data.save(target, { CARGO: 'PEDREIRO III', DATAADMISSAO: '2026-01-20', STATUS: 'INATIVO', DATADESLIGAMENTO: date }), /desligamento|admissão/i);
  assert.equal(writes.length, 0);
});
test('valid inactivation writes source then same mirror with each ETag, preserving history', async () => {
  const { data, target, writes } = setup();
  const result = await data.save(target, { CARGO: 'SUPERVISOR DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-01-20' });
  assert.deepEqual(writes.map(w => [w.list, w.id, w.eTag]), [['FORNECEDORES', '17', '"1"'], ['FUNCIONARIOSRH', '4', '"1"']]);
  assert.equal(writes[0].fields.DATADESLIGAMENTO, '2026-01-20');
  assert.equal(result.fields.STATUS, 'INATIVO');
  assert.equal(result.fields.IDFORNECEDORORIGEM, '17');
});
test('partial failure explicitly reports saved source and retry reconciles the same origin without resubmitting it', async () => {
  const { data, target, writes, failTarget } = setup();
  const draft = { CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' };
  failTarget(true);
  await assert.rejects(data.save(target, draft), error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL' && /fonte|fornecedor/i.test(error.message));
  failTarget(false);
  const result = await data.save(target, draft);
  assert.equal(result.fields.CARGO, 'MESTRE DE OBRAS');
  assert.deepEqual(writes.map(w => w.list), ['FORNECEDORES', 'FUNCIONARIOSRH', 'FUNCIONARIOSRH']);
});
test('rejects stale target ETag and missing source ETag before any write', async () => {
  for (const mutation of ['target', 'source']) {
    const { data, source, target, writes } = setup();
    const selected = structuredClone(target);
    if (mutation === 'target') target.eTag = '"9"'; else source.eTag = '';
    await assert.rejects(data.save(selected, { CARGO: 'PEDREIRO III', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' }), /ETag|alterado/i);
    assert.equal(writes.length, 0);
  }
});
test('legacy missing admission and invalid cargo require regularization without inventing data', async () => {
  const { data, target, writes } = setup();
  for (const draft of [{ CARGO: 'PERDEIRO III', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' }, { CARGO: 'PEDREIRO III', DATAADMISSAO: '', STATUS: 'ATIVO' }]) {
    await assert.rejects(data.save(target, draft), /cargo|admissão/i);
  }
  assert.equal(writes.length, 0);
});

for (const changed of [
  { STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-02-20' },
  { DATAADMISSAO: '2026-01-21' },
  { DATADESLIGAMENTO: '2026-02-20' },
  { CARGO: 'SUPERVISOR DE OBRAS' },
]) test('rejects source divergence from the displayed mirror before writing: ' + JSON.stringify(changed), async () => {
  const { data, source, target, writes } = setup();
  const selected = structuredClone(target);
  Object.assign(source.fields, changed); source.eTag = '"9"';
  await assert.rejects(data.save(selected, {
    CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO',
  }), error => error.code === 'CONTRACTOR_EMPLOYMENT_DIVERGED' && /fonte|fornecedor/i.test(error.message));
  assert.equal(writes.length, 0);
  for (const [name, expected] of Object.entries(changed)) assert.equal(source.fields[name], expected);
});

test('lost source response is reconciled by the original key before writing the mirror', async () => {
  const { data, target, writes, repository } = setup();
  const originalUpdate = repository.updateItem;
  repository.updateItem = async (...args) => {
    const result = await originalUpdate(...args);
    if (args[1] === 'FORNECEDORES') throw new Error('synthetic lost response');
    return result;
  };
  const draft = { CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' };
  await assert.rejects(data.save(target, draft), error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL');
  assert.equal(writes.length, 1);
  await data.save(target, draft);
  assert.deepEqual(writes.map(w => [w.list, w.id]), [['FORNECEDORES', '17'], ['FUNCIONARIOSRH', '4']]);
});
test('uncertain source request with unchanged ETag can retry the same supplier after a precommit transport failure', async () => {
  const { data, target, writes, repository } = setup();
  const originalUpdate = repository.updateItem;
  repository.updateItem = async () => { throw new Error('synthetic connection lost before commit'); };
  const draft = { CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' };
  await assert.rejects(data.save(target, draft), error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL');
  repository.updateItem = originalUpdate;
  const result = await data.save(target, draft);
  assert.equal(result.fields.CARGO, 'MESTRE DE OBRAS');
  assert.deepEqual(writes.map(w => [w.list, w.id]), [['FORNECEDORES', '17'], ['FUNCIONARIOSRH', '4']]);
});
test('lost target response is verified without writing either row again', async () => {
  const { data, target, writes, repository } = setup();
  const originalUpdate = repository.updateItem, selected = structuredClone(target);
  repository.updateItem = async (...args) => {
    const result = await originalUpdate(...args);
    if (args[1] === 'FUNCIONARIOSRH') throw new Error('synthetic target response lost');
    return result;
  };
  const draft = { CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' };
  await assert.rejects(data.save(selected, draft), error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL');
  const result = await data.save(selected, draft);
  assert.equal(result.fields.CARGO, 'MESTRE DE OBRAS'); assert.equal(writes.length, 2);
});
test('target concurrency after a partial save never overwrites the concurrent edit', async () => {
  const { data, target, failTarget, writes } = setup();
  const selected = structuredClone(target);
  const draft = { CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' };
  failTarget(true);
  await assert.rejects(data.save(selected, draft));
  target.eTag = '"9"'; target.fields.CARGO = 'SUPERVISOR DE OBRAS';
  failTarget(false);
  await assert.rejects(data.save(selected, draft));
  assert.equal(writes.length, 2);
  assert.equal(target.fields.CARGO, 'SUPERVISOR DE OBRAS');
});
test('source 412 is reported as a conflict and permits a corrected explicit retry', async () => {
  const { data, target, repository } = setup();
  const originalUpdate = repository.updateItem;
  repository.updateItem = async () => { throw Object.assign(new Error('Registro alterado'), { status: 412, code: 'concurrent_change' }); };
  await assert.rejects(data.save(target, { CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' }), error => error.status === 412);
  repository.updateItem = originalUpdate;
  const result = await data.save(target, { CARGO: 'SUPERVISOR DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' });
  assert.equal(result.fields.CARGO, 'SUPERVISOR DE OBRAS');
});
test('pre-aborted or closed sessions cannot read or write data', async () => {
  const { repository, target, writes, pages } = setup();
  const controller = new AbortController(); controller.abort();
  const data = subject.createContractorEmploymentData({ repository });
  await assert.rejects(data.loadSnapshot({ signal: controller.signal }), error => error.name === 'AbortError');
  await assert.rejects(data.save(target, {}, { signal: controller.signal }), error => error.name === 'AbortError');
  const closed = subject.createContractorEmploymentData({ repository, assertSession() { throw new Error('Sessão encerrada'); } });
  await assert.rejects(closed.loadSnapshot(), /Sessão encerrada/);
  assert.equal(writes.length, 0); assert.equal(pages.length, 0);
});
test('production Graph repository paginates and patches original internal names with If-Match', async () => {
  const original = { id: '17', eTag: '"s1"', fields: { Title: 'Funcionário Exemplo', EMPREITEIRO: 'SIM', STATUS: 'ATIVO', CARGO: 'PEDREIRO III', DATAADMISSAO: '2026-01-20T00:00:00Z' } };
  const mirror = { id: '4', eTag: '"t1"', fields: { ...original.fields, IDFORNECEDORORIGEM: '17' } };
  const patches = [];
  const repository = createSharePointRepository({ async request(path, options = {}) {
    if (path.includes('/columns')) return { value: [{ name: 'Title', displayName: 'CADASTRO', text: {} }] };
    if (options.method === 'PATCH') {
      const item = path.includes('/source/') ? original : mirror;
      assert.equal(options.headers['If-Match'], item.eTag);
      patches.push([path, options.body]); Object.assign(item.fields, options.body); item.eTag = '"2"'; return {};
    }
    if (path.includes('/items/')) return structuredClone(path.includes('/source/') ? original : mirror);
    if (path.includes('/items')) return path.includes('skiptoken') ? { value: [structuredClone(mirror)] } : { value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/sites/site/lists/target/items?$expand=fields&$skiptoken=two' };
    if (path.includes('/lists')) return { value: [{ id: 'source', displayName: 'FORNECEDORES', list: { template: 'genericList' } }, { id: 'target', displayName: 'FUNCIONARIOSRH', list: { template: 'genericList' } }] };
    return { id: 'site' };
  } }, { personal: { host: 'example.sharepoint.com', path: '/sites/synthetic' } });
  const data = subject.createContractorEmploymentData({ repository });
  const snapshot = await data.loadSnapshot();
  assert.equal(snapshot.rows.length, 1);
  await data.save(snapshot.rows[0], { CARGO: 'PEDREIRO III', DATAADMISSAO: '2026-01-20', STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-02-20' });
  assert.deepEqual(patches.map(([path]) => path), ['/sites/site/lists/source/items/17/fields', '/sites/site/lists/target/items/4/fields']);
  assert.deepEqual(patches[0][1], { CARGO: 'PEDREIRO III', DATAADMISSAO: '2026-01-20', STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-02-20' });
});

test('reviewed fresh source and target baseline can renew a partial conflict after refresh without restoring stale status', async () => {
  const { data, source, target, writes, failTarget } = setup(), selected = structuredClone(target);
  const first = { CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' };
  failTarget(true); await assert.rejects(data.save(selected, first));
  Object.assign(source.fields, { CARGO: 'SUPERVISOR DE OBRAS', STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-02-20' }); source.eTag = '"9"';
  failTarget(false);
  const fresh = (await data.loadSnapshot()).rows.find(item => item.id === '4');
  const corrected = { CARGO: 'SERVENTE DE PEDREIRO III', DATAADMISSAO: '2026-01-20', STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-02-20' };
  await assert.rejects(data.save(fresh, corrected), error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL');
  assert.equal(writes.length, 2, 'refresh alone cannot discard the unknown operation');
  assert.equal(typeof data.loadConflict, 'function', 'partial conflicts need a read-only review path');
  const review = await data.loadConflict(fresh);
  assert.equal(review.source.fields.STATUS, 'INATIVO'); assert.equal(review.target.fields.STATUS, 'ATIVO');
  assert.equal(review.canRenew, true); assert.equal(writes.length, 2);
  const baseline = await data.renewBaseline(review);
  assert.equal(baseline.fields.STATUS, 'INATIVO'); assert.equal(baseline.fields.DATADESLIGAMENTO, '2026-02-20');
  assert.equal(writes.length, 2, 'accepting the reviewed baseline does not save either record');
  const saved = await data.save(baseline, corrected);
  assert.equal(saved.fields.STATUS, 'INATIVO'); assert.equal(saved.fields.CARGO, 'SERVENTE DE PEDREIRO III');
  assert.deepEqual(writes.slice(2).map(write => [write.list, write.id, write.eTag]), [['FORNECEDORES', '17', '"9"'], ['FUNCIONARIOSRH', '4', '"1"']]);
});
test('unknown source write with unchanged ETag cannot be cleared by reviewing or renewing a baseline', async () => {
  const { data, target, repository, writes } = setup(), selected = structuredClone(target);
  const originalUpdate = repository.updateItem, first = { CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' };
  repository.updateItem = async () => { throw new Error('synthetic uncertain source response'); };
  await assert.rejects(data.save(selected, first));
  assert.equal(typeof data.loadConflict, 'function');
  const review = await data.loadConflict(selected);
  assert.equal(review.canRenew, false);
  await assert.rejects(data.renewBaseline(review), /incerta|pendente|não.*confirmad/i);
  await assert.rejects(data.save(selected, { ...first, CARGO: 'SUPERVISOR DE OBRAS' }), error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL');
  assert.equal(writes.length, 0);
  repository.updateItem = originalUpdate;
  await data.save(selected, first);
  assert.equal(writes.length, 2, 'the original operation remains recoverable on the same records');
});
for (const changed of ['source', 'target']) test('renewal rejects ' + changed + ' changes after review and retains the pending operation', async () => {
  const { data, target, source, writes, failTarget } = setup(), selected = structuredClone(target);
  const first = { CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' };
  failTarget(true); await assert.rejects(data.save(selected, first));
  assert.equal(typeof data.loadConflict, 'function');
  const review = await data.loadConflict(selected);
  (changed === 'source' ? source : target).eTag = '"9"';
  await assert.rejects(data.renewBaseline(review), error => error.code === 'CONTRACTOR_EMPLOYMENT_DIVERGED');
  await assert.rejects(data.save(selected, { ...first, CARGO: 'SUPERVISOR DE OBRAS' }), error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL');
  assert.equal(writes.length, 2);
});
test('first-write divergence can be explicitly reviewed and edited using the visible current source baseline', async () => {
  const { data, source, target, writes } = setup(), selected = structuredClone(target);
  Object.assign(source.fields, { STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-02-20' }); source.eTag = '"9"';
  assert.equal(typeof data.loadConflict, 'function');
  const review = await data.loadConflict(selected), baseline = await data.renewBaseline(review);
  assert.equal(writes.length, 0);
  const saved = await data.save(baseline, { CARGO: 'SUPERVISOR DE OBRAS', STATUS: 'INATIVO', DATAADMISSAO: '2026-01-20', DATADESLIGAMENTO: '2026-02-20' });
  assert.equal(saved.fields.STATUS, 'INATIVO'); assert.equal(source.fields.DATADESLIGAMENTO, '2026-02-20');
});
test('save remains partial if source changes concurrently during the mirror update', async () => {
  const { data, source, target, repository } = setup(), originalUpdate = repository.updateItem;
  repository.updateItem = async (...args) => {
    const saved = await originalUpdate(...args);
    if (args[1] === 'FUNCIONARIOSRH') { source.fields.STATUS = 'INATIVO'; source.fields.DATADESLIGAMENTO = '2026-02-20'; source.eTag = '"9"'; }
    return saved;
  };
  await assert.rejects(data.save(structuredClone(target), { CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO' }), error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL');
});
