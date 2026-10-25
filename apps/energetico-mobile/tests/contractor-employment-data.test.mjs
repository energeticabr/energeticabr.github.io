import test from 'node:test';
import assert from 'node:assert/strict';
import { createContractorEmploymentData, filterContractorEmploymentRows } from '../src/chat/contractor-employment-data.js';
import { createSharePointRepository } from '../../../portal/data/sharepoint-repository.js';
import { createContractorEmploymentFixture as setup } from './helpers/contractor-employment-fixture.mjs';
const active = { CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-20', STATUS: 'ATIVO', DATADESLIGAMENTO: null };
const inactive = { ...active, STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-02-20' };
const partial = error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL';

test('empty future-only gallery reads only RH metadata and rows, never scans or imports suppliers', async () => {
  const f = setup(); f.repository.getItemsPage = async (_site, list) => { assert.equal(list, 'FUNCIONARIOSRH'); return { items: [], hasMore: false }; };
  assert.deepEqual((await f.data.loadSnapshot()).rows, []);
  assert.deepEqual(f.resolved, ['FUNCIONARIOSRH']); assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
});
test('full target pagination preserves every field and target audit; filters search later rows', async () => {
  const f = setup(), snapshot = await f.data.loadSnapshot();
  assert.deepEqual(f.pages, ['first', 'page-two']);
  const found = filterContractorEmploymentRows(snapshot.rows, { search: 'exemplo', STATUS: 'ATIVO', FILIAL: 'Obra A', CARGO: 'PEDREIRO III' });
  assert.equal(found.length, 1); assert.equal(found[0].fields.field_6, 31); assert.equal(found[0].fields.IDFORNECEDORORIGEM, '17');
  assert.equal(filterContractorEmploymentRows(snapshot.rows, { search: '2026-01-01' }).length, 1);
  assert.equal(filterContractorEmploymentRows(snapshot.rows, { STATUS: 'INATIVO' }).length, 1);
  assert.deepEqual(f.resolved, ['FUNCIONARIOSRH']); assert.deepEqual(f.reads, []);
});
test('incomplete or repeated pagination is an explicit error', async () => {
  const f = setup(); f.repository.getItemsPage = async () => ({ items: [], hasMore: true, nextLink: 'loop' });
  await assert.rejects(f.data.loadSnapshot(), /pagina/i);
});
test('duplicate destination IDs and the 100-page cap never produce a completed gallery', async () => {
  for (const scenario of ['duplicate', 'cap']) {
    const f = setup(); let pages = 0;
    f.repository.getItemsPage = async () => ({ items: scenario === 'duplicate' ? [structuredClone(f.target)] : [],
      hasMore: true, nextLink: 'cursor-' + (++pages) });
    await assert.rejects(f.data.loadSnapshot(), scenario === 'duplicate' ? /duplicado/ : /limite|completa/);
    assert.equal(pages, scenario === 'duplicate' ? 2 : 100);
  }
});
test('all eight documented roles save only in RH and date-only offsets never shift civil dates', async () => {
  for (const role of ['SERVENTE DE PEDREIRO I', 'SERVENTE DE PEDREIRO II', 'SERVENTE DE PEDREIRO III', 'PEDREIRO I', 'PEDREIRO II', 'PEDREIRO III', 'MESTRE DE OBRAS', 'SUPERVISOR DE OBRAS']) {
    const f = setup(); f.target.fields.DATAADMISSAO = '2026-01-20T00:00:00-03:00';
    const saved = await f.data.save(structuredClone(f.target), { ...active, CARGO: role });
    assert.equal(saved.fields.CARGO, role);
    assert.ok(f.writes.every(w => w.list === 'FUNCIONARIOSRH'));
    assert.ok(f.writes.every(w => !Object.hasOwn(w.fields, 'DATAADMISSAO')));
  }
});
test('cargo/admission edits patch only changed RH fields and never reactivate a stale supplier', async () => {
  const f = setup(); f.source.fields.STATUS = 'INATIVO';
  const saved = await f.data.save(structuredClone(f.target), { ...active, DATAADMISSAO: '2026-01-21' });
  assert.deepEqual(f.writes, [{ list: 'FUNCIONARIOSRH', id: '4', fields: { CARGO: 'MESTRE DE OBRAS', DATAADMISSAO: '2026-01-21' }, eTag: '"1"' }]);
  assert.equal(saved.fields.Title, 'Funcionário Exemplo'); assert.equal(saved.fields.FILIAL, 'Obra A'); assert.equal(f.source.fields.STATUS, 'INATIVO');
  assert.ok(f.reads.every(([list]) => list === 'FUNCIONARIOSRH')); assert.ok(f.resolved.every(list => list === 'FUNCIONARIOSRH'));
});
for (const date of ['', '2026-02-30', '2026-01-19']) test('invalid or early termination prevents every write: ' + date, async () => {
  const f = setup(); await assert.rejects(f.data.save(f.target, { ...inactive, DATADESLIGAMENTO: date }), /desligamento|admissão/i); assert.equal(f.writes.length, 0);
});
test('explicit inactivation writes only source STATUS then RH fields with ETags and readback', async () => {
  const f = setup(), saved = await f.data.save(structuredClone(f.target), inactive);
  assert.deepEqual(f.writes.map(w => [w.list, w.id, w.eTag]), [['FORNECEDORES', '17', '"1"'], ['FUNCIONARIOSRH', '4', '"1"']]);
  assert.deepEqual(f.writes[0].fields, { STATUS: 'INATIVO' }); assert.equal(saved.fields.DATADESLIGAMENTO, '2026-02-20');
  assert.equal(saved.fields.IDFORNECEDORORIGEM, '17'); assert.equal(f.source.fields.DATAADMISSAO, undefined);
  assert.ok(f.reads.filter(([list]) => list === 'FORNECEDORES').every(([, , query]) => query === '$select=id,eTag&$expand=fields($select=STATUS,EMPREITEIRO)'), 'source reads must request only identity, ETag and contractor/status flags');
});
test('explicit reactivation updates both statuses, clears only the RH date and keeps the origin', async () => {
  const f = setup(); f.source.fields.STATUS = f.target.fields.STATUS = 'INATIVO'; f.target.fields.DATADESLIGAMENTO = '2026-02-20';
  await f.data.save(structuredClone(f.target), active);
  assert.deepEqual(f.writes[0].fields, { STATUS: 'ATIVO' }); assert.equal(f.target.fields.DATADESLIGAMENTO, null); assert.equal(f.target.fields.IDFORNECEDORORIGEM, '17');
});
test('status divergence from the displayed baseline is rejected without writes', async () => {
  const f = setup(); f.source.fields.STATUS = 'INATIVO'; f.source.eTag = '"9"';
  await assert.rejects(f.data.save(structuredClone(f.target), inactive), e => e.code === 'CONTRACTOR_EMPLOYMENT_DIVERGED');
  assert.equal(f.writes.length, 0);
});
for (const mutation of ['target', 'source']) test('stale target or missing source ETag prevents status writes: ' + mutation, async () => {
  const f = setup(), selected = structuredClone(f.target); if (mutation === 'target') f.target.eTag = '"9"'; else f.source.eTag = '';
  await assert.rejects(f.data.save(selected, inactive), /ETag|alterado/i); assert.equal(f.writes.length, 0);
});
test('invalid cargo and missing admission cannot be invented', async () => {
  const f = setup(); for (const draft of [{ ...active, CARGO: 'PERDEIRO III' }, { ...active, DATAADMISSAO: '' }]) await assert.rejects(f.data.save(f.target, draft), /cargo|admissão/i);
  assert.equal(f.writes.length, 0);
});
test('partial status update retries the same origin without resubmitting confirmed source STATUS', async () => {
  const f = setup(), selected = structuredClone(f.target); f.failTarget(true);
  await assert.rejects(f.data.save(selected, inactive), partial); f.failTarget(false); await f.data.save(selected, inactive);
  assert.deepEqual(f.writes.map(w => [w.list, w.id]), [['FORNECEDORES', '17'], ['FUNCIONARIOSRH', '4'], ['FUNCIONARIOSRH', '4']]);
});
for (const kind of ['FORNECEDORES', 'FUNCIONARIOSRH']) test('lost response remains partial until readback verifies the same records: ' + kind, async () => {
  const f = setup(), selected = structuredClone(f.target), update = f.repository.updateItem;
  f.repository.updateItem = async (...args) => { const result = await update(...args); if (args[1] === kind) throw new Error('synthetic lost response'); return result; };
  await assert.rejects(f.data.save(selected, inactive), partial); const count = f.writes.length;
  await f.data.save(selected, inactive); assert.equal(f.writes.length, kind === 'FORNECEDORES' ? count + 1 : count);
  assert.equal(f.target.fields.STATUS, 'INATIVO'); assert.equal(f.source.fields.STATUS, 'INATIVO');
});
test('unknown target write cannot be cleared by refresh or changed intent while its ETag is unchanged', async () => {
  const f = setup(), selected = structuredClone(f.target), update = f.repository.updateItem;
  f.repository.updateItem = async () => { throw new Error('synthetic uncertain target write'); };
  await assert.rejects(f.data.save(selected, active), partial);
  const fresh = (await f.data.loadSnapshot()).rows.find(row => row.id === '4'), review = await f.data.loadConflict(fresh);
  assert.equal(review.canRenew, false); await assert.rejects(f.data.renewBaseline(review), /incerta|pendente/i);
  assert.equal(review.source, null); assert.ok(f.reads.every(([list]) => list === 'FUNCIONARIOSRH'), 'cargo-only reconciliation cannot read source either');
  await assert.rejects(f.data.save(fresh, { ...active, CARGO: 'SUPERVISOR DE OBRAS' }), partial);
  f.repository.updateItem = update; await f.data.save(selected, active); assert.deepEqual(f.writes.map(w => w.list), ['FUNCIONARIOSRH']);
});
test('a confirmed source write does not permit discarding an unknown target checkpoint', async () => {
  const f = setup(); f.failTarget(true); await assert.rejects(f.data.save(structuredClone(f.target), inactive), partial);
  const review = await f.data.loadConflict(f.target); assert.equal(review.canRenew, false); await assert.rejects(f.data.renewBaseline(review), /incerta|pendente/i);
});
test('superseding target version can be explicitly reviewed and edited after refresh without a stuck fingerprint', async () => {
  const f = setup(), selected = structuredClone(f.target); f.failTarget(true); await assert.rejects(f.data.save(selected, active), partial);
  f.target.eTag = '"9"'; f.target.fields.CARGO = 'SUPERVISOR DE OBRAS'; f.failTarget(false);
  const fresh = (await f.data.loadSnapshot()).rows.find(row => row.id === '4');
  await assert.rejects(f.data.save(fresh, { ...active, CARGO: 'SERVENTE DE PEDREIRO III' }), partial);
  const review = await f.data.loadConflict(fresh); assert.equal(review.canRenew, true);
  const count = f.writes.length, baseline = await f.data.renewBaseline(review); assert.equal(f.writes.length, count);
  assert.equal(baseline.fields.CARGO, 'SUPERVISOR DE OBRAS'); assert.equal(baseline.fields.DATAADMISSAO, '2026-01-20');
  await f.data.save(baseline, { ...active, CARGO: 'SERVENTE DE PEDREIRO III' }); assert.equal(f.target.fields.CARGO, 'SERVENTE DE PEDREIRO III'); assert.equal(f.writes.at(-1).eTag, '"9"');
});
test('source-status review retains RH cargo/admission and asks the user for termination, never reads source dates', async () => {
  const f = setup(); f.source.fields.STATUS = 'INATIVO'; f.source.eTag = '"9"';
  await assert.rejects(f.data.save(f.target, inactive), e => e.code === 'CONTRACTOR_EMPLOYMENT_DIVERGED');
  const baseline = await f.data.renewBaseline(await f.data.loadConflict(f.target));
  assert.equal(baseline.fields.STATUS, 'INATIVO'); assert.equal(baseline.fields.CARGO, 'PEDREIRO III'); assert.equal(baseline.fields.DATAADMISSAO, '2026-01-20');
  assert.equal(baseline.fields.DATADESLIGAMENTO, null);
  await assert.rejects(f.data.save(baseline, { ...inactive, DATADESLIGAMENTO: '' }), /desligamento/i); await f.data.save(baseline, inactive);
  assert.deepEqual(f.writes.map(w => w.list), ['FUNCIONARIOSRH']);
});
for (const changed of ['source', 'target']) test('renewal revalidates both reviewed versions and retains pending intent: ' + changed, async () => {
  const f = setup(); f.failTarget(true); await assert.rejects(f.data.save(structuredClone(f.target), inactive), partial);
  f.target.eTag = '"8"'; const review = await f.data.loadConflict(f.target); (changed === 'source' ? f.source : f.target).eTag = '"9"';
  await assert.rejects(f.data.renewBaseline(review), e => e.code === 'CONTRACTOR_EMPLOYMENT_DIVERGED'); await assert.rejects(f.data.save(f.target, active), partial);
});
test('source status changed during target confirmation keeps the operation partial', async () => {
  const f = setup(), update = f.repository.updateItem;
  f.repository.updateItem = async (...args) => { const result = await update(...args); if (args[1] === 'FUNCIONARIOSRH') { f.source.fields.STATUS = 'ATIVO'; f.source.eTag = '"9"'; } return result; };
  await assert.rejects(f.data.save(structuredClone(f.target), inactive), partial);
});
test('412 proves no target write happened and permits a corrected intent', async () => {
  const f = setup(), update = f.repository.updateItem; f.repository.updateItem = async () => { throw Object.assign(new Error('Registro alterado'), { status: 412 }); };
  await assert.rejects(f.data.save(f.target, active), e => e.status === 412); f.repository.updateItem = update;
  await f.data.save(f.target, { ...active, CARGO: 'SUPERVISOR DE OBRAS' }); assert.equal(f.target.fields.CARGO, 'SUPERVISOR DE OBRAS');
});
test('pre-aborted or closed sessions cannot read or write', async () => {
  const f = setup(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.data.loadSnapshot({ signal: controller.signal }), e => e.name === 'AbortError');
  await assert.rejects(f.data.save(f.target, {}, { signal: controller.signal }), e => e.name === 'AbortError');
  await assert.rejects(createContractorEmploymentData({ repository: f.repository, assertSession() { throw new Error('Sessão encerrada'); } }).loadSnapshot(), /Sessão encerrada/);
  assert.equal(f.pages.length, 0); assert.equal(f.writes.length, 0);
});
test('real Graph adapter pins If-Match and writes no RH-only field into source', async () => {
  const f = setup(), patches = [];
  const repository = createSharePointRepository({ async request(path, options = {}) {
    if (path.includes('/columns')) { assert.ok(path.includes('/target/')); return { value: [{ name: 'Title', displayName: 'CADASTRO', text: {} }] }; }
    if (options.method === 'PATCH') {
      const row = path.includes('/source/') ? f.source : f.target; assert.equal(options.headers['If-Match'], row.eTag);
      patches.push([path, options.body]); Object.assign(row.fields, options.body); row.eTag = '"2"'; return {};
    }
    if (path.includes('/items/')) return structuredClone(path.includes('/source/') ? f.source : f.target);
    if (path.includes('/items')) { assert.ok(path.includes('/target/')); return { value: [structuredClone(f.target)] }; }
    if (path.includes('/lists')) return { value: [{ id: 'source', displayName: 'FORNECEDORES', list: { template: 'genericList' } }, { id: 'target', displayName: 'FUNCIONARIOSRH', list: { template: 'genericList' } }] };
    return { id: 'site' };
  } }, { personal: { host: 'example.sharepoint.com', path: '/sites/synthetic' } });
  const data = createContractorEmploymentData({ repository, ...f.context }); await data.save((await data.loadSnapshot()).rows[0], inactive);
  assert.deepEqual(patches.map(([path]) => path), ['/sites/site/lists/source/items/17/fields', '/sites/site/lists/target/items/4/fields']); assert.deepEqual(patches[0][1], { STATUS: 'INATIVO' });
});

test('unknown source STATUS write cannot be discarded even if the target version changes', async () => {
  const f = setup(), update = f.repository.updateItem, selected = structuredClone(f.target);
  f.repository.updateItem = async () => { throw new Error('synthetic source request still uncertain'); };
  await assert.rejects(f.data.save(selected, inactive), partial); f.target.eTag = '"8"';
  const review = await f.data.loadConflict(f.target); assert.equal(review.canRenew, false);
  await assert.rejects(f.data.renewBaseline(review), /incerta|pendente/i);
  // Once the original source write is visibly committed, a reviewed new baseline can proceed.
  f.source.fields.STATUS = 'INATIVO'; f.source.eTag = '"2"'; f.repository.updateItem = update;
  const resolved = await f.data.renewBaseline(await f.data.loadConflict(f.target)); await f.data.save(resolved, inactive);
  assert.deepEqual(f.writes.map(w => w.list), ['FUNCIONARIOSRH']);
});
test('verified lost source response remains a partial operation if the subsequent target write returns 412', async () => {
  const f = setup(), update = f.repository.updateItem, selected = structuredClone(f.target);
  f.repository.updateItem = async (...args) => { await update(...args); throw new Error('synthetic lost source response'); };
  await assert.rejects(f.data.save(selected, inactive), partial);
  f.repository.updateItem = async () => { throw Object.assign(new Error('synthetic target conflict'), { status: 412 }); };
  await assert.rejects(f.data.save(selected, inactive), partial);
  assert.equal(f.source.fields.STATUS, 'INATIVO'); assert.equal(f.target.fields.STATUS, 'ATIVO');
});
test('origin lookup rechecks the link after reading the selected RH row', async () => {
  const f = setup(), read = f.repository.getItem;
  f.repository.getItem = async (...args) => { const item = await read(...args); item.fields.IDFORNECEDORORIGEM = '99'; return item; };
  await assert.rejects(f.data.findByOrigin('17'), /vínculo|origem/i); assert.equal(f.writes.length, 0);
});
test('a supplier form baseline must belong to the exact linked source ID', async () => {
  const f = setup();
  await assert.rejects(f.data.save(f.target, inactive, { sourceEdit: { selected: { ...f.source, id: '99' }, list: { id: 'FORNECEDORES' }, fields: { STATUS: 'INATIVO' } } }), /vínculo|origem|fornecedor/i);
  assert.equal(f.writes.length, 0);
});
test('source classification changing during target save cannot erase the existing RH lifecycle link', async () => {
  const f = setup(), update = f.repository.updateItem;
  f.repository.updateItem = async (...args) => { const item = await update(...args); if (args[1] === 'FUNCIONARIOSRH') f.source.fields.EMPREITEIRO = 'NÃO'; return item; };
  await f.data.save(structuredClone(f.target), inactive);
  assert.equal(f.source.fields.EMPREITEIRO, 'NÃO'); assert.equal(f.source.fields.STATUS, 'INATIVO');
  assert.equal(f.target.fields.STATUS, 'INATIVO'); assert.equal(f.target.fields.DATADESLIGAMENTO, '2026-02-20');
});
test('tracked NO classification permits reviewed lifecycle synchronization without importing or changing its flag', async () => {
  const f = setup(), selected = structuredClone(f.target);
  f.source.fields.EMPREITEIRO = 'NÃO'; f.source.fields.STATUS = 'INATIVO'; f.source.eTag = '"9"';
  await assert.rejects(f.data.save(selected, inactive), e => e.code === 'CONTRACTOR_EMPLOYMENT_DIVERGED');
  assert.equal(f.writes.length, 0);
  const baseline = await f.data.renewBaseline(await f.data.loadConflict(selected));
  await f.data.save(baseline, inactive);
  assert.deepEqual(f.writes.map(w => w.list), ['FUNCIONARIOSRH']);
  assert.equal(f.source.fields.EMPREITEIRO, 'NÃO'); assert.equal(f.target.fields.EMPREITEIRO, 'SIM');
  await f.data.save(structuredClone(f.target), active);
  assert.equal(f.source.fields.EMPREITEIRO, 'NÃO'); assert.equal(f.source.fields.STATUS, 'ATIVO');
  assert.equal(f.target.fields.STATUS, 'ATIVO'); assert.equal(f.target.fields.DATADESLIGAMENTO, null);
});
