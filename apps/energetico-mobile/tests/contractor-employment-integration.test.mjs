import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { renderChatMarkup } from '../src/ui/chat-view.js';
import { createContractorEmploymentData, filterContractorEmploymentRows } from '../src/chat/contractor-employment-data.js';
import { createContractorEmploymentView } from '../src/ui/contractor-employment-view.js';
import { syntheticTransport, memoryStorage, schemaFields } from './helpers/contractor-employment-transport.mjs';
const inactive = { CARGO: 'PEDREIRO III', DATAADMISSAO: '2026-01-20', STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-02-20' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const partial = error => error.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL';

test('RH menu places employees immediately after Presenças without independent creation', () => {
  const html = renderChatMarkup({ sessionStatus: 'authenticated', account: { name: 'Synthetic' }, messages: [{ type: 'poll', question: '👥 RECURSOS HUMANOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?', options: [{ id: 'action_create_supplier_attendance', label: 'PRESENÇA' }] }] });
  const dom = new JSDOM(html);
  const ids = [...dom.window.document.querySelectorAll('[data-reply-id]')].map(n => n.dataset.replyId);
  assert.equal(ids[ids.indexOf('action_hr_gallery_presencas') + 1], 'action_hr_gallery_funcionarios');
  dom.window.close();
});
test('actual default controller/token/repository/gallery loads paginated 27-field RH records and audit', async t => {
  const dom = new JSDOM('<main></main>', { url: 'https://synthetic.invalid' }), f = syntheticTransport(), handlers = new Map(), vmCalls = [];
  const old = { document: globalThis.document, fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  globalThis.document = dom.window.document; globalThis.fetch = f.fetchImpl; globalThis.localStorage = dom.window.localStorage;
  const view = { render() {}, focusComposer() {}, on(type, fn) { handlers.set(type, fn); return () => handlers.delete(type); } };
  const controller = createAppController({ store: createConversationStore({ randomUUID: () => 'synthetic' }), view,
    auth: { initialize: async () => ({ homeAccountId: 'synthetic-account', name: 'Synthetic' }), getToken: async scopes => { f.tokens.push(scopes); return 'synthetic-token'; } },
    native: { importSharedItems: async () => [] }, client: { sendText: async value => { vmCalls.push(value); return { status: 'processed', messages: [] }; } },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }) });
  t.after(() => { controller.stop(); Object.assign(globalThis, old); dom.window.close(); });
  await controller.start();
  vmCalls.length = 0;
  await handlers.get('select-reply')({ type: 'select-reply', replyId: 'action_hr_gallery_funcionarios' });
  const root = dom.window.document.querySelector('[data-gallery-kind="contractorEmployment"]');
  assert.ok(root, 'default gallery dispatch must open employee UI');
  assert.equal(root.querySelectorAll('[data-employment-row]').length, 2);
  for (const name of schemaFields) assert.match(root.textContent, new RegExp(name));
  assert.match(root.textContent, /Synthetic creator/); assert.match(root.textContent, /Synthetic editor/);
  assert.equal(root.querySelector('[data-action="create"]'), null);
  assert.equal(vmCalls.length, 0); assert.ok(f.tokens.length > 0);
});
test('journal survives recreation and reconciles a lost source response before resuming the same target', async () => {
  const f = syntheticTransport(), selected = structuredClone(f.target); f.failSource('lost');
  await assert.rejects(createContractorEmploymentData({ repository: f.repository, ...f.context }).save(selected, inactive), partial);
  assert.equal(f.source.fields.STATUS, 'INATIVO'); assert.ok(f.storage.entries.size > 0);
  f.failSource('');
  const fresh = createContractorEmploymentData({ repository: f.repository, ...f.context });
  const pending = await fresh.getPending(selected);
  assert.equal(pending.draft.DATADESLIGAMENTO, '2026-02-20');
  await fresh.save(selected, pending.draft);
  assert.deepEqual(f.writes.map(w => w.list), ['source', 'target']);
  assert.equal(f.target.fields.DATADESLIGAMENTO, '2026-02-20'); assert.equal(f.storage.entries.size, 0);
});
test('complete destination search includes audit metadata returned outside fields', async () => {
  const f = syntheticTransport(), snapshot = await createContractorEmploymentData({ repository: f.repository, ...f.context }).loadSnapshot();
  assert.deepEqual(filterContractorEmploymentRows(snapshot.rows, { search: 'Synthetic creator' }).map(row => row.id), ['4']);
});
test('a reviewed changed STATUS keeps a valid durable intent if the next write is uncertain', async () => {
  const f = syntheticTransport(), data = createContractorEmploymentData({ repository: f.repository, ...f.context });
  f.failTarget('412'); await assert.rejects(data.save(structuredClone(f.target), inactive), partial);
  const baseline = await data.renewBaseline(await data.loadConflict(f.target));
  f.failSource('unknown');
  await assert.rejects(data.save(baseline, { ...inactive, STATUS: 'ATIVO', DATADESLIGAMENTO: null }), partial);
  const fresh = createContractorEmploymentData({ repository: f.repository, ...f.context });
  assert.equal(fresh.getPending(f.target).draft.STATUS, 'ATIVO');
});
test('gallery exposes reviewed recovery after source success/target 412 and keeps concurrent target fields', async () => {
  const f = syntheticTransport(), dom = new JSDOM('<main></main>'), doc = dom.window.document;
  let view = createContractorEmploymentView({ document: doc, data: createContractorEmploymentData({ repository: f.repository, ...f.context }) });
  await view.open(); f.failTarget('412');
  doc.querySelector('[data-employment-row="4"] [data-action="inactivate"]').click();
  doc.querySelector('[name="DATADESLIGAMENTO"]').value = '2026-02-20';
  doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true })); await tick(); await tick();
  assert.equal(f.source.fields.STATUS, 'INATIVO'); assert.equal(f.target.fields.STATUS, 'ATIVO');
  view.destroy();
  view = createContractorEmploymentView({ document: doc, data: createContractorEmploymentData({ repository: f.repository, ...f.context }) });
  try {
    await view.open();
    assert.match(doc.querySelector('[role="alert"]').textContent, /pendente|confirmada/);
    doc.querySelector('[data-employment-row="4"] [data-action="review-conflict"]').click(); await tick();
    assert.match(doc.querySelector('[data-conflict-source]').textContent, /INATIVO/);
    doc.querySelector('[data-action="renew-baseline"]').click(); await tick();
    assert.equal(doc.querySelector('[name="DATADESLIGAMENTO"]').value, '2026-02-20');
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true })); await tick(); await tick();
    assert.equal(f.target.fields.STATUS, 'INATIVO'); assert.equal(f.target.fields.FILIAL, 'Concurrent branch');
    assert.deepEqual(f.writes.map(w => w.list), ['source', 'target', 'target']);
    const reads = f.calls.filter(c => c.path.includes('/source/items/') && c.options.method === 'GET');
    assert.ok(reads.every(c => c.query.get('$expand') === 'fields($select=STATUS,EMPREITEIRO)'));
  } finally { view.destroy(); dom.window.close(); }
});
test('unavailable journal or unstable account/site prevents any new two-list mutation', async () => {
  for (const context of [
    { accountKey: '', siteIdentity: 'synthetic' },
    { accountKey: 'synthetic', siteIdentity: '' },
    { accountKey: 'synthetic', siteIdentity: 'synthetic', storage: null },
    { accountKey: 'synthetic', siteIdentity: 'synthetic', storage: { getItem() { throw new Error('blocked'); } } },
    { accountKey: 'synthetic', siteIdentity: 'synthetic', storage: { getItem() { return null; }, setItem() { throw new Error('quota'); } } },
  ]) {
    const f = syntheticTransport();
    await assert.rejects(createContractorEmploymentData({ repository: f.repository, ...f.context, ...context }).save(structuredClone(f.target), inactive), /diário|conta|site|armazenamento/i);
    assert.equal(f.writes.length, 0);
  }
});
test('pending intents never cross account or site and ended sessions cannot resume writes', async () => {
  const storage = memoryStorage(), f = syntheticTransport({ storage }); f.failSource('unknown');
  await assert.rejects(createContractorEmploymentData({ repository: f.repository, ...f.context }).save(f.target, inactive), partial);
  for (const isolation of [{ accountKey: 'another-account' }, { siteIdentity: 'another-site' }]) {
    const data = createContractorEmploymentData({ repository: f.repository, ...f.context, ...isolation });
    assert.equal(await data.getPending(f.target), null);
  }
  const data = createContractorEmploymentData({ repository: f.repository, ...f.context }); f.close();
  await assert.rejects(data.save(f.target, inactive), /session ended/); assert.equal(f.writes.length, 1);
});
test('live account identity changes invalidate an existing editor before any mutation', async () => {
  const f = syntheticTransport(), data = createContractorEmploymentData({ repository: f.repository, ...f.context });
  f.context.accountKey = 'changed-account';
  await assert.rejects(data.save(f.target, inactive), /sessão|conta/i);
  assert.equal(f.writes.length, 0);
});
test('a confirmed supplier update is not replayed over unrelated concurrent source fields after reviewed recovery', async () => {
  const f = syntheticTransport(), selected = structuredClone(f.target), data = createContractorEmploymentData({ repository: f.repository, ...f.context });
  f.failTarget('412');
  await assert.rejects(data.save(selected, inactive, { sourceEdit: { list: { id: 'source' }, selected: structuredClone(f.source), fields: { STATUS: 'INATIVO', Title: 'FIRST EDIT' } } }), partial);
  f.source.eTag = '"9"'; f.source.fields.STATUS = 'ATIVO'; f.source.fields.Title = 'CONCURRENT EDIT';
  const review = await data.loadConflict(f.target), baseline = await data.renewBaseline(review);
  await data.save(baseline, baseline.pendingDraft);
  assert.equal(f.source.fields.STATUS, 'INATIVO'); assert.equal(f.source.fields.Title, 'CONCURRENT EDIT');
  assert.deepEqual(f.writes.at(-2).fields, { STATUS: 'INATIVO' });
});
test('malformed durable intent is kept and prevents any replay', async () => {
  const f = syntheticTransport(); f.failTarget('unknown');
  await assert.rejects(createContractorEmploymentData({ repository: f.repository, ...f.context }).save(f.target, inactive), partial);
  const [name, raw] = [...f.storage.entries][0], broken = JSON.parse(raw);
  broken.sourceFields.DATAADMISSAO = '2026-01-20';
  f.storage.setItem(name, JSON.stringify(broken));
  const before = f.writes.length, data = createContractorEmploymentData({ repository: f.repository, ...f.context });
  await assert.rejects(data.save(f.target, inactive), /diário|armazenamento/i);
  assert.equal(f.writes.length, before); assert.ok(f.storage.entries.has(name));
});
