import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createGalleryRecordActions } from '../src/ui/gallery-record-actions.js';
import { createGalleryRecordData } from '../src/chat/gallery-record-data.js';
import { SharePointConflictError } from '../../../portal/data/sharepoint-repository.js';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function until(predicate, diagnostic) {
  for (let n = 0; n < 80; n++) { if (predicate()) return; await turn(); }
  assert.fail(diagnostic);
}

// Only the repository I/O boundary is fake. Context ownership, ETag validation,
// field filtering, attachment persistence, form review and actions are real.
async function setup(t, { listName = 'SYNC_FIXTURE', attachments = false, onChanged } = {}) {
  const dom = new JSDOM('<main id="gallery"></main>', { url: 'https://fixture.invalid/' });
  const oldFormData = globalThis.FormData;
  globalThis.FormData = dom.window.FormData;
  const document = dom.window.document, host = document.querySelector('main');
  const reads = [], writes = [], loads = [], saves = [], errors = [], changed = [];
  const state = { server: { id: '42', eTag: '"v1"', fields: { Title: 'ORIGINAL', OBS: 'OBS ORIGINAL', VALOR: 10 } },
    readHook: null, writeError: null, columns: [{ name: 'Title', text: {} }, { name: 'OBS', text: {} }, { name: 'VALOR', currency: {} }],
    files: [{ name: 'ORIGINAL.pdf', size: 1, type: 'application/pdf' }] };
  const repository = {
    async getColumns() { return structuredClone(state.columns); },
    async getItem(site, list, id, query, options = {}) {
      reads.push({ method: 'GET', site, list, id, query, signal: options.signal });
      if (state.readHook) return state.readHook(options);
      return structuredClone(state.server);
    },
    async updateItem(site, list, id, fields, options = {}) {
      writes.push({ method: 'PATCH', site, list, id, fields, eTag: options.eTag });
      if (state.writeError) throw state.writeError;
      if (options.eTag !== state.server.eTag) throw new SharePointConflictError();
      state.server = { id, eTag: '"saved"', fields: { ...state.server.fields, ...fields } };
      return structuredClone(state.server);
    },
    async deleteItem(site, list, id) { writes.push({ method: 'DELETE', site, list, id }); throw new SharePointConflictError(); },
    ...(attachments ? {
      async listAttachments() { return state.attachmentListHook ? state.attachmentListHook() : structuredClone(state.files); },
      async downloadAttachment() { return new ArrayBuffer(1); },
      async uploadAttachment(_site, _list, _id, file) { writes.push({ method: 'UPLOAD', name: file.name }); state.files.push({ name: file.name, size: file.size }); },
      async deleteAttachment(_site, _list, _id, name) { writes.push({ method: 'DELETE_ATTACHMENT', name }); state.files = state.files.filter(file => file.name !== name); },
    } : {}),
  };
  const data = createGalleryRecordData({ repository, listName, metadataOnly: true, resolveList: async () => ({ id: 'synthetic-list' }) });
  const actions = createGalleryRecordActions({ document, host,
    loadEditor: async (id, options) => { loads.push({ id, ...options }); return data.loadEditor(id, options); },
    saveEditor: (context, fields, options) => { saves.push({ context, fields, options }); return data.saveEditor(context, fields, options); },
    deleteItem: data.deleteItem,
    onChanged: async change => { changed.push(change); return onChanged?.(change); }, onError: error => errors.push(error),
  });
  const controls = actions.render(structuredClone(state.server)); host.append(controls);
  const ctx = { dom, document, host, state, data, actions, controls, reads, writes, loads, saves, errors, changed,
    get: selector => document.querySelector(selector) };
  t.after(() => { actions.destroy(); dom.window.close(); globalThis.FormData = oldFormData; });
  return ctx;
}
async function open(ctx) {
  ctx.controls.querySelector('[data-gallery-action="edit"]').click();
  await until(() => ctx.get('form'), 'real data layer must load an editable synthetic record');
}
function edit(ctx, name, value) {
  const input = ctx.get(`[name="${name}"]`); assert.ok(input, `missing editable ${name}`);
  input.value = value; input.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
}
async function review(ctx) {
  ctx.get('form').requestSubmit();
  await until(() => ctx.get('[data-edit-review]'), 'actual edit requires Before/After confirmation');
  return ctx.get('[data-edit-review]');
}
async function confirm(ctx) {
  ctx.get('[data-edit-review-submit]').click();
  await until(() => !ctx.get('[data-edit-review]'), 'confirmation must resolve');
  await turn(); await turn();
}
async function conflict(ctx) {
  await open(ctx); edit(ctx, 'Title', 'LOCAL STALE');
  ctx.state.server = { id: '42', eTag: '"v2"', fields: { Title: 'SERVER FRESH', OBS: 'OBS THIRD PARTY', VALOR: 25 } };
  const before = ctx.writes.length;
  await review(ctx);
  assert.equal(ctx.writes.length, before, 'opening review cannot write');
  await confirm(ctx);
  await until(() => ctx.errors.length, 'confirmed edit must reach real SharePointConflictError');
  assert.ok(ctx.errors.at(-1) instanceof SharePointConflictError);
  assert.equal(ctx.errors.at(-1).status, 412);
  assert.equal(ctx.writes.length, before + 1);
  assert.equal(ctx.writes.at(-1).eTag, '"v1"');
}
function syncButton(ctx) {
  const button = ctx.get('[role="alert"] button[data-gallery-conflict-sync]');
  assert.ok(button, 'a confirmed 412 must expose button[data-gallery-conflict-sync] INSIDE its alert');
  assert.match(button.textContent, /sincronizar/i); assert.equal(button.type, 'button');
  assert.equal(button.disabled, false, 'conflict sync must be enabled after the failed save restores controls');
  return button;
}
async function sync(ctx) {
  syncButton(ctx).click();
  await until(() => ctx.get('[name="Title"]')?.value === 'SERVER FRESH', 'sync must replace stale fields with fresh server baseline');
  await turn();
}

test('confirmed 412 sync reads same record only, then uses fresh baseline, orange review and ETag', async t => {
  const ctx = await setup(t); await conflict(ctx);
  const oldForm = ctx.get('form'), beforeWrites = ctx.writes.length, beforeReads = ctx.reads.length;
  await sync(ctx);
  assert.equal(ctx.writes.length, beforeWrites, 'SINCRONIZAR performs ZERO writes');
  assert.equal(ctx.reads.length, beforeReads + 1);
  assert.equal(ctx.reads.at(-1).method, 'GET');
  assert.deepEqual(['site', 'list', 'id'].map(key => ctx.reads.at(-1)[key]), ['personal', 'synthetic-list', '42']);
  assert.equal(ctx.loads.at(-1).refresh, true);
  assert.notEqual(ctx.get('form'), oldForm);
  assert.equal(ctx.get('[name="OBS"]').value, 'OBS THIRD PARTY');
  assert.equal(Number(ctx.get('[name="VALOR"]').value), 25);
  assert.equal(ctx.get('[data-edit-changed]'), null, 'fresh server values are the clean baseline');
  edit(ctx, 'Title', 'NEW LOCAL');
  await until(() => ctx.get('[name="Title"]').closest('[data-edit-changed]'), 'a new edit must have existing orange highlighting');
  assert.equal(ctx.dom.window.getComputedStyle(ctx.get('[name="Title"]')).backgroundColor, 'rgb(255, 204, 128)');
  const confirmation = await review(ctx);
  const row = [...confirmation.querySelectorAll('tbody tr')].find(row => row.textContent.includes('NEW LOCAL'));
  assert.ok(row, 'Before/After review must contain new edit');
  assert.match(row.textContent, /SERVER FRESH/); assert.doesNotMatch(row.textContent, /LOCAL STALE|ORIGINAL/);
  assert.equal(ctx.writes.length, beforeWrites);
  await confirm(ctx);
  await until(() => ctx.get('[data-gallery-edit-success]'), 'confirmed edit with fresh ETag must succeed');
  assert.equal(ctx.writes.length, beforeWrites + 1);
  assert.equal(ctx.writes.at(-1).eTag, '"v2"');
  assert.deepEqual(ctx.writes.at(-1).fields, { Title: 'NEW LOCAL' });
  assert.equal(ctx.saves.at(-1).context.entity.id, ctx.saves[0].context.entity.id);
  assert.notEqual(ctx.saves.at(-1).context, ctx.saves[0].context, 'save needs a newly owned data context');
});

test('failed sync preserves the same DOM and draft, then retry replaces fields without writes', async t => {
  const ctx = await setup(t); await conflict(ctx);
  const form = ctx.get('form'), input = ctx.get('[name="Title"]'), before = ctx.writes.length;
  ctx.state.readHook = async () => { throw new Error('SYNTHETIC READ OFFLINE'); };
  syncButton(ctx).click();
  await until(() => ctx.get('[role="alert"]')?.textContent.includes('SYNTHETIC READ OFFLINE'), 'read failure must be visible');
  assert.equal(ctx.get('form'), form); assert.equal(ctx.get('[name="Title"]'), input);
  assert.equal(input.value, 'LOCAL STALE'); assert.equal(ctx.writes.length, before);
  assert.equal(syncButton(ctx).disabled, false, 'sync is retryable after failed GET');
  ctx.state.readHook = null; await sync(ctx);
  assert.equal(ctx.writes.length, before);
});

test('post-sync application validation shows Informe Title for whitespace required text, then clears on correction', async t => {
  const ctx = await setup(t); ctx.state.columns[0].required = true;
  await conflict(ctx); await sync(ctx);
  edit(ctx, 'Title', '   ');
  assert.equal(ctx.get('form').checkValidity(), true, 'whitespace must pass native validation so the real application validator runs');
  ctx.get('form').requestSubmit(); await turn(); await turn();
  const feedback = ctx.get('[data-form-errors]'); assert.ok(feedback);
  assert.equal(feedback.hidden, false, 'application validation feedback must remain connected and visible after staged sync mount');
  assert.match(feedback.textContent, /Informe Title\./);
  assert.equal(ctx.get('[data-edit-review]'), null); assert.equal(ctx.writes.length, 1);
  edit(ctx, 'Title', 'VALID NEW TITLE'); const confirmation = await review(ctx);
  assert.equal(feedback.hidden, true, 'correcting the invalid field clears the same live feedback');
  assert.match(confirmation.textContent, /SERVER FRESH/); assert.match(confirmation.textContent, /VALID NEW TITLE/);
  await confirm(ctx); await until(() => ctx.get('[data-gallery-edit-success]'), 'valid corrected input must save normally');
  assert.equal(ctx.writes.length, 2); assert.equal(ctx.writes.at(-1).eTag, '"v2"');
});

test('pending sync blocks double clicks and submit, but back aborts and late GET cannot reopen editor', async t => {
  const ctx = await setup(t); await conflict(ctx);
  const pending = deferred(), beforeWrites = ctx.writes.length, beforeReads = ctx.reads.length;
  ctx.state.readHook = () => pending.promise;
  const button = syncButton(ctx); button.click();
  await until(() => ctx.reads.length === beforeReads + 1, 'sync must start GET');
  button.click();
  ctx.get('form').dispatchEvent(new ctx.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await turn();
  assert.equal(ctx.reads.length, beforeReads + 1, 'double sync must not start another GET');
  assert.equal(ctx.writes.length, beforeWrites); assert.equal(ctx.get('[data-edit-review]'), null);
  assert.equal(ctx.get('[data-form-save]').disabled, true);
  const back = ctx.get('[data-gallery-editor-back]'); assert.equal(back.disabled, false);
  back.click(); assert.equal(ctx.reads.at(-1).signal.aborted, true);
  pending.resolve(structuredClone(ctx.state.server)); await turn(); await turn();
  assert.equal(ctx.get('[data-gallery-record-screen]'), null);
  assert.equal(ctx.writes.length, beforeWrites); assert.equal(ctx.changed.length, 0);
});

for (const outcome of ['resolve', 'reject']) test(`old-session sync ${outcome} cannot replace or error a newer editor`, async t => {
  const ctx = await setup(t); await conflict(ctx);
  const pending = deferred(); ctx.state.readHook = () => pending.promise;
  syncButton(ctx).click(); await until(() => ctx.reads.length === 2, 'pending GET must start');
  ctx.get('[data-gallery-editor-back]').click();
  assert.equal(ctx.reads.at(-1).signal.aborted, true, 'back aborts the pending transport signal');
  ctx.state.readHook = null; await open(ctx);
  edit(ctx, 'Title', 'NEW SESSION DRAFT'); const form = ctx.get('form');
  if (outcome === 'resolve') pending.resolve({ id: '42', eTag: '"late"', fields: { Title: 'LATE WRONG DRAFT' } });
  else pending.reject(new Error('LATE OLD SESSION ERROR'));
  await turn(); await turn();
  assert.equal(ctx.get('form'), form); assert.equal(ctx.get('[name="Title"]').value, 'NEW SESSION DRAFT');
  assert.equal(ctx.get('[role="alert"]').hidden, true); assert.equal(ctx.changed.length, 0);
  assert.equal(ctx.writes.length, 1);
});

test('a second 412 after sync still needs confirmation and another fresh GET', async t => {
  const ctx = await setup(t); await conflict(ctx); await sync(ctx);
  edit(ctx, 'Title', 'SECOND LOCAL');
  ctx.state.server = { id: '42', eTag: '"v3"', fields: { Title: 'THIRD VERSION', OBS: 'ANOTHER PERSON', VALOR: 30 } };
  await review(ctx); assert.equal(ctx.writes.length, 1); await confirm(ctx);
  await until(() => ctx.errors.length === 2, 'second stale save must fail');
  assert.ok(ctx.errors.at(-1) instanceof SharePointConflictError);
  assert.equal(ctx.writes.length, 2); assert.equal(ctx.writes.at(-1).eTag, '"v2"');
  assert.equal(ctx.get('[name="Title"]').value, 'SECOND LOCAL');
  syncButton(ctx).click();
  await until(() => ctx.get('[name="Title"]')?.value === 'THIRD VERSION', 'second recovery uses v3');
  assert.equal(ctx.writes.length, 2); assert.equal(ctx.changed.length, 0);
});

test('ordinary save errors do not offer conflict sync', async t => {
  const ctx = await setup(t); await open(ctx); edit(ctx, 'Title', 'LOCAL EDIT');
  ctx.state.writeError = Object.assign(new Error('SYNTHETIC VALIDATION FAILURE'), { status: 500 });
  await review(ctx); await confirm(ctx);
  await until(() => ctx.errors.length, 'ordinary error must reach alert');
  assert.equal(ctx.get('[data-gallery-conflict-sync]'), null);
  assert.equal(ctx.get('[name="Title"]').value, 'LOCAL EDIT'); assert.equal(ctx.reads.length, 1);
});

test('a 412 from opening the editor does not offer sync before any edit confirmation', async t => {
  const ctx = await setup(t); ctx.state.readHook = async () => { throw new SharePointConflictError(); };
  ctx.controls.querySelector('[data-gallery-action="edit"]').click();
  await until(() => ctx.errors.length, 'initial read error must be reported');
  assert.equal(ctx.get('[data-gallery-conflict-sync]'), null, 'sync recovery belongs to rejected confirmed edits, not initial GET errors');
  assert.equal(ctx.writes.length, 0); assert.equal(ctx.saves.length, 0);
});

test('412 during confirmed-save gallery refresh offers only gallery refresh retry and never rewrites', async t => {
  let refreshes = 0;
  const ctx = await setup(t, { onChanged: async () => { if (++refreshes === 1) throw new SharePointConflictError(); } });
  await open(ctx); edit(ctx, 'Title', 'CONFIRMED EDIT'); await review(ctx); await confirm(ctx);
  await until(() => ctx.get('[data-gallery-refresh-retry]'), 'confirmed save should offer gallery refresh retry');
  assert.ok(ctx.get('[data-gallery-edit-success]'));
  assert.equal(ctx.get('[data-gallery-conflict-sync]'), null); assert.equal(ctx.writes.length, 1);
  ctx.get('[data-gallery-refresh-retry]').click();
  await until(() => refreshes === 2, 'gallery refresh retry must run');
  assert.equal(ctx.writes.length, 1); assert.equal(ctx.reads.length, 1);
});

test('delete 412 does not offer edit-context sync', async t => {
  const ctx = await setup(t); ctx.controls.querySelector('[data-gallery-action="delete"]').click();
  ctx.get('[data-gallery-confirm="yes"]').click();
  await until(() => ctx.errors.length, 'delete must reach error alert');
  assert.equal(ctx.get('[data-gallery-conflict-sync]'), null);
});

function prepareUpload(ctx, name = 'LOCAL.pdf') {
  const file = new ctx.dom.window.File(['synthetic bytes'], name, { type: 'application/pdf' });
  const input = ctx.get('[data-form-attachment-input]'); assert.ok(input, 'real attachment input required');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  assert.match(ctx.get('[data-form-attachment-list]').textContent, new RegExp(name.replace('.', '\\.')));
  return file;
}

test('sync preserves pending upload and deletion; eventual confirmed save performs each exactly once', async t => {
  const ctx = await setup(t, { attachments: true }); await open(ctx);
  prepareUpload(ctx); ctx.get('[data-form-attachment-remove-existing]').click();
  edit(ctx, 'Title', 'STALE ATTACHMENT EDIT');
  ctx.state.server = { id: '42', eTag: '"v2"', fields: { Title: 'SERVER FRESH', OBS: 'OBS THIRD PARTY', VALOR: 25 } };
  await review(ctx); await confirm(ctx); await until(() => ctx.errors.length, 'stale field update must fail before attachment mutations');
  assert.deepEqual(ctx.writes.map(call => call.method), ['PATCH']);
  await sync(ctx);
  assert.match(ctx.get('[data-form-attachment-list]').textContent, /LOCAL\.pdf/);
  assert.ok(ctx.get('[data-form-attachment-restore-existing]'), 'pending deletion stays prepared');
  assert.deepEqual(ctx.writes.map(call => call.method), ['PATCH']);
  edit(ctx, 'Title', 'NEW ATTACHMENT EDIT'); const confirmation = await review(ctx);
  assert.match(confirmation.textContent, /LOCAL\.pdf/); assert.match(confirmation.textContent, /ORIGINAL\.pdf/);
  await confirm(ctx); await until(() => ctx.get('[data-gallery-edit-success]'), 'attachment save must complete');
  assert.equal(ctx.writes.filter(call => call.method === 'UPLOAD').length, 1);
  assert.equal(ctx.writes.filter(call => call.method === 'DELETE_ATTACHMENT').length, 1);
  assert.equal(ctx.writes.at(1).eTag, '"v2"');
});

test('fresh attachment name collision alerts without destroying previous draft or uploading', async t => {
  const ctx = await setup(t, { attachments: true }); await open(ctx); prepareUpload(ctx);
  edit(ctx, 'Title', 'LOCAL STALE');
  ctx.state.server = { id: '42', eTag: '"v2"', fields: { Title: 'SERVER FRESH', OBS: 'OBS THIRD PARTY', VALOR: 25 } };
  await review(ctx); await confirm(ctx); await until(() => ctx.errors.length, 'initial stale save must fail');
  const form = ctx.get('form'); ctx.state.files.push({ name: 'LOCAL.pdf', size: 99, type: 'application/pdf' });
  const previousErrors = ctx.errors.length;
  syncButton(ctx).click();
  await until(() => ctx.errors.length > previousErrors, 'name collision must report a new sync error');
  assert.match(ctx.get('[role="alert"]').textContent, /anexo|arquivo|nome|conflito|existe/i);
  assert.equal(syncButton(ctx).disabled, false);
  assert.equal(ctx.get('form'), form); assert.equal(ctx.get('[name="Title"]').value, 'LOCAL STALE');
  assert.match(ctx.get('[data-form-attachment-list]').textContent, /LOCAL\.pdf/);
  assert.deepEqual(ctx.writes.map(call => call.method), ['PATCH']);
});

for (const invalid of ['wrong ID', 'missing ETag', 'no editable metadata']) test(`sync rejects ${invalid} without clearing draft`, async t => {
  const ctx = await setup(t); await conflict(ctx); const form = ctx.get('form'), errors = ctx.errors.length;
  if (invalid === 'wrong ID') ctx.state.server.id = '99';
  if (invalid === 'missing ETag') ctx.state.server.eTag = '';
  if (invalid === 'no editable metadata') ctx.state.columns = [];
  syncButton(ctx).click();
  await until(() => ctx.errors.length > errors, 'unsafe refreshed context must fail visibly');
  assert.equal(ctx.get('form'), form); assert.equal(ctx.get('[name="Title"]').value, 'LOCAL STALE');
  assert.equal(ctx.loads.at(-1).signal.aborted, true, 'invalid refresh must abort its unused context');
  assert.equal(ctx.writes.length, 1); assert.equal(syncButton(ctx).disabled, false);
});

test('detached form mount failure keeps old DOM, live draft listeners and attachments; retry succeeds', async t => {
  const ctx = await setup(t, { attachments: true }); await conflict(ctx); prepareUpload(ctx);
  const form = ctx.get('form'), input = ctx.get('[name="Title"]'), previousErrors = ctx.errors.length;
  const prototype = ctx.dom.window.Element.prototype;
  const innerHTML = Object.getOwnPropertyDescriptor(prototype, 'innerHTML');
  let injected = false;
  Object.defineProperty(prototype, 'innerHTML', { ...innerHTML, set(html) {
    if (!injected && this.tagName === 'DIV' && !this.isConnected && String(html).includes('data-edit-form')) {
      injected = true; throw new Error('SYNTHETIC MOUNT FAILURE');
    }
    return innerHTML.set.call(this, html);
  } });
  try {
    syncButton(ctx).click();
    await until(() => ctx.errors.length > previousErrors, 'mount failure must report a sync error');
    assert.equal(injected, true, 'failure must occur at actual detached dynamic-form mount');
    assert.match(ctx.errors.at(-1).message, /SYNTHETIC MOUNT FAILURE/);
    assert.equal(ctx.loads.at(-1).signal.aborted, true, 'failed mount cancels its acquired read context');
    assert.equal(ctx.get('form'), form); assert.equal(ctx.get('[name="Title"]'), input);
    assert.equal(input.value, 'LOCAL STALE'); assert.match(ctx.get('[data-form-attachment-list]').textContent, /LOCAL\.pdf/);
    ctx.get('[data-form-attachment-remove-upload]').click();
    assert.doesNotMatch(ctx.get('[data-form-attachment-list]').textContent, /LOCAL\.pdf/, 'old form attachment listeners remain bound');
    prepareUpload(ctx, 'RETRY.pdf');
  } finally { Object.defineProperty(prototype, 'innerHTML', innerHTML); }
  await sync(ctx); assert.match(ctx.get('[data-form-attachment-list]').textContent, /RETRY\.pdf/);
  assert.equal(ctx.writes.length, 1);
});

test('explicit close aborts pending sync and ignores its late result', async t => {
  const ctx = await setup(t); await conflict(ctx); const pending = deferred();
  ctx.state.readHook = () => pending.promise; syncButton(ctx).click();
  await until(() => ctx.reads.length === 2, 'pending read must start');
  ctx.actions.close(); assert.equal(ctx.reads.at(-1).signal.aborted, true);
  pending.resolve(structuredClone(ctx.state.server)); await turn(); await turn();
  assert.equal(ctx.get('[data-gallery-record-screen]'), null); assert.equal(ctx.writes.length, 1);
});

test('confirmed concurrent_change code offers recovery even when transport status is not 412', async t => {
  const ctx = await setup(t); await open(ctx); edit(ctx, 'Title', 'LOCAL');
  ctx.state.writeError = new SharePointConflictError({ status: 409, code: 'concurrent_change' });
  await review(ctx); await confirm(ctx); await until(() => ctx.errors.length, 'coded conflict must be reported');
  assert.equal(ctx.errors.at(-1).code, 'concurrent_change');
  ctx.state.server = { id: '42', eTag: '"v2"', fields: { Title: 'SERVER FRESH', OBS: 'OBS THIRD PARTY', VALOR: 25 } };
  ctx.state.writeError = null; await sync(ctx);
  assert.equal(ctx.writes.length, 1); assert.equal(ctx.changed.length, 0);
});

test('IDFOLHA sync preserves the real sheet binding upload/deletion draft and fresh review baseline', async t => {
  const ctx = await setup(t, { listName: 'IDFOLHA', attachments: true }); await conflict(ctx);
  await until(() => ctx.get('[data-sheet-attachment-remove-existing]'), 'real sheet binding must load existing attachment');
  const file = new ctx.dom.window.File(['synthetic sheet bytes'], 'SHEET-LOCAL.pdf', { type: 'application/pdf' });
  const input = ctx.get('[data-sheet-attachment-input]'); assert.ok(input);
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  ctx.get('[data-sheet-attachment-remove-existing]').click();
  assert.match(ctx.get('[data-sheet-attachment-list]').textContent, /SHEET-LOCAL\.pdf/);
  await sync(ctx);
  await until(() => ctx.get('[data-sheet-attachment-restore-existing]'), 'refreshed sheet retains pending existing-file deletion');
  assert.match(ctx.get('[data-sheet-attachment-list]').textContent, /SHEET-LOCAL\.pdf/);
  assert.equal(ctx.get('[data-sheet-attachment-input]').disabled, false);
  assert.deepEqual(ctx.writes.map(call => call.method), ['PATCH']);
  edit(ctx, 'Title', 'NEW SHEET EDIT'); const confirmation = await review(ctx);
  assert.match(confirmation.textContent, /SERVER FRESH/); assert.match(confirmation.textContent, /NEW SHEET EDIT/);
  assert.match(confirmation.textContent, /SHEET-LOCAL\.pdf/); assert.match(confirmation.textContent, /ORIGINAL\.pdf/);
  assert.deepEqual(ctx.writes.map(call => call.method), ['PATCH'], 'review and recovery never upload or delete sheet files');
  ctx.get('[data-edit-review-cancel]').click();
});

test('IDFOLHA restored deletion reaches immediate review and save without a second replacement inventory read', async t => {
  const ctx = await setup(t, { listName: 'IDFOLHA', attachments: true }); await conflict(ctx);
  await until(() => ctx.get('[data-sheet-attachment-remove-existing]'), 'original sheet inventory must be loaded before staging deletion');
  ctx.get('[data-sheet-attachment-remove-existing]').click();
  const blockedReplacement = deferred();
  let syncInventoryReads = 0;
  ctx.state.attachmentListHook = () => ++syncInventoryReads === 1
    ? structuredClone(ctx.state.files) : blockedReplacement.promise;
  try {
    await sync(ctx);
    // Deliberately do NOT wait for the replacement binding's restore-existing
    // row. Review as soon as synchronization reports the fresh editable form.
    edit(ctx, 'Title', 'NEW SHEET DELETION EDIT'); const confirmation = await review(ctx);
    assert.match(confirmation.textContent, /ORIGINAL\.pdf/, 'immediate post-sync review must retain the staged deletion while any extra inventory read is pending');
    assert.match(confirmation.textContent, /Removido/);
    assert.equal(syncInventoryReads, 1, 'replacement binding must reuse the already verified sync inventory instead of reading it again');
    assert.deepEqual(ctx.writes.map(call => call.method), ['PATCH'], 'sync and review must not delete anything');
    // Save-time verification is a separate, legitimate fresh read. Release that
    // boundary without ever resolving the artificial replacement-list promise.
    ctx.state.attachmentListHook = null;
    await confirm(ctx); await until(() => ctx.get('[data-gallery-edit-success]'), 'immediate confirmed deletion must complete');
    assert.deepEqual(ctx.saves.at(-1).options.attachments.deletions, ['ORIGINAL.pdf']);
    assert.deepEqual(ctx.writes.map(call => call.method), ['PATCH', 'PATCH', 'DELETE_ATTACHMENT']);
    assert.equal(ctx.writes[1].eTag, '"v2"');
    assert.deepEqual(ctx.state.files, [], 'confirmed restored deletion must actually remove the original file exactly once');
  } finally { blockedReplacement.resolve(structuredClone(ctx.state.files)); }
});

test('sync forwards the verified Power Apps form variant and keeps entity and ID', async t => {
  const ctx = await setup(t, { listName: 'LANCAMENTOS' });
  ctx.state.columns = [{ name: 'AGRUPAR', text: {} }];
  ctx.state.server.fields = { AGRUPAR: 'ORIGINAL' }; await open(ctx); edit(ctx, 'AGRUPAR', 'LOCAL');
  ctx.state.server = { id: '42', eTag: '"v2"', fields: { AGRUPAR: 'FRESH GROUP' } };
  await review(ctx); await confirm(ctx); await until(() => ctx.errors.length, 'variant save must reach 412');
  assert.ok(ctx.errors.at(-1) instanceof SharePointConflictError);
  const variant = ctx.saves[0].context.contract.formVariant.id;
  assert.equal(variant, 'E1- EDITAR LANÇAMENTO COMPRA.pa.yaml#EDITARLANCAMENTO');
  syncButton(ctx).click(); await until(() => ctx.get('[name="AGRUPAR"]')?.value === 'FRESH GROUP', 'same variant must receive refreshed fields');
  assert.equal(ctx.loads.at(-1).formVariantId, variant); assert.equal(ctx.loads.at(-1).id, '42');
  edit(ctx, 'AGRUPAR', 'CONFIRMED GROUP'); await review(ctx); await confirm(ctx);
  await until(() => ctx.get('[data-gallery-edit-success]'), 'save must use owned refreshed variant context');
  assert.equal(ctx.saves.at(-1).context.entity.id, 'lancamentos');
  assert.equal(ctx.saves.at(-1).context.contract.formVariant.id, variant);
  assert.deepEqual(ctx.writes.at(-1).fields, { AGRUPAR: 'CONFIRMED GROUP' });
  assert.equal(ctx.writes.at(-1).eTag, '"v2"');
});

test('real-style fixture fits 320/390, keeps a 44px right-hand sync action and zero sync writes', { timeout: 120_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
  assert.ok(browser, 'Chrome/Chromium is required for the sync fixture QA; set CHROME_BIN (no silent skip)');
  const appRoot = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ configFile: false, root: appRoot, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(appRoot, '../..')] } } });
  await server.listen();
  try {
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    for (const [width, height] of [[320, 740], [390, 844]]) {
      await withAttachmentBrowser(browser, { width, height }, async ({ navigate, evaluate, wait, command, events }) => {
        await command('Network.enable');
        for (const stage of ['conflict', 'synced', 'edited', 'review', 'failure', 'pending']) {
          await navigate(`${origin}/tests/fixtures/gallery-conflict-sync.html?stage=${stage}`);
          await wait("document.documentElement.dataset.ready === 'true' || !!document.documentElement.dataset.error");
          assert.equal(await evaluate('document.documentElement.dataset.error || null'), null, `${width} ${stage} fixture error`);
          const metrics = await evaluate(`(() => {
            const screen = document.querySelector('[data-gallery-record-screen]');
            const alert = document.querySelector('[role="alert"]');
            const button = alert?.querySelector('[data-gallery-conflict-sync]');
            const b = button?.getBoundingClientRect(), a = alert?.getBoundingClientRect();
            const label = document.createRange();
            if (button) label.selectNodeContents(button);
            const textLines = button ? new Set([...label.getClientRects()].map(rect => Math.round(rect.top))).size : 0;
            return { ...window.conflictSyncFixture.metrics(),
              pageOverflow: document.documentElement.scrollWidth > innerWidth,
              editorOverflow: screen.scrollWidth > screen.clientWidth,
              alertVisible: alert && !alert.hidden,
              sync: b ? { width: b.width, height: b.height, left: b.left, right: b.right,
                alertLeft: a.left, alertRight: a.right, alertWidth: a.width, disabled: button.disabled,
                whiteSpace: getComputedStyle(button).whiteSpace, textLines,
                textOverflow: button.scrollWidth > button.clientWidth,
                alertPaddingRight: parseFloat(getComputedStyle(alert).paddingRight) } : null,
              backDisabled: document.querySelector('[data-gallery-editor-back]').disabled,
              title: document.querySelector('[name="Title"]').value,
              orange: getComputedStyle(document.querySelector('[name="Title"]')).backgroundColor,
              review: document.querySelector('[data-edit-review]')?.textContent || '',
              counter: document.querySelector('[data-fixture-counts]').textContent };
          })()`);
          t.diagnostic(JSON.stringify({ width, stage, reads: metrics.reads, writes: metrics.writes, syncWrites: metrics.syncWrites,
            overflow: metrics.pageOverflow || metrics.editorOverflow, sync: metrics.sync, orange: metrics.orange }));
          assert.equal(metrics.pageOverflow, false, `${width} ${stage}: page overflow`);
          assert.equal(metrics.editorOverflow, false, `${width} ${stage}: editor overflow`);
          assert.equal(metrics.syncWrites, 0); assert.equal(metrics.writes, 1);
          assert.equal(metrics.uploads, 0); assert.equal(metrics.deletions, 0);
          assert.match(metrics.counter, /0 gravações na sincronização/);
          if (['conflict', 'failure', 'pending'].includes(stage)) {
            assert.equal(metrics.alertVisible, true); assert.ok(metrics.sync);
            assert.equal(metrics.sync.whiteSpace, 'nowrap', `${width} ${stage}: sync label must not wrap with a standard scrollbar`);
            assert.equal(metrics.sync.textLines, 1, `${width} ${stage}: rendered sync label must occupy one line`);
            assert.equal(metrics.sync.textOverflow, false, `${width} ${stage}: sync text cannot be clipped or overflow`);
            assert.ok(metrics.sync.height >= 44, `${width}: touch target must be at least 44px`);
            assert.ok(metrics.sync.right <= metrics.sync.alertRight + 1, `${width}: button exceeds alert`);
            assert.ok(Math.abs(metrics.sync.right - (metrics.sync.alertRight - metrics.sync.alertPaddingRight)) <= 1,
              `${width}: sync action must align with the alert's right padding`);
            assert.equal(metrics.sync.disabled, stage === 'pending');
            assert.equal(metrics.backDisabled, false);
            assert.equal(metrics.title, 'AJUSTE LOCAL ANTIGO FICTÍCIO');
          }
          if (stage === 'edited' || stage === 'review') assert.equal(metrics.orange, 'rgb(255, 204, 128)');
          if (stage === 'review') {
            assert.match(metrics.review, /PRODUTO FICTÍCIO ATUAL NO SERVIDOR/);
            assert.match(metrics.review, /NOVO AJUSTE LOCAL FICTÍCIO/);
            assert.doesNotMatch(metrics.review, /AJUSTE LOCAL ANTIGO FICTÍCIO/);
          }
          if (process.env.GALLERY_CONFLICT_SCREENSHOT_DIR && ['conflict', 'review'].includes(stage)) {
            const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            writeFileSync(resolve(process.env.GALLERY_CONFLICT_SCREENSHOT_DIR, `conflict-sync-${width}-${stage}.png`), Buffer.from(shot.data, 'base64'));
          }
        }
        const external = events.filter(event => event.method === 'Network.requestWillBeSent')
          .map(event => event.params.request.url).filter(url => !url.startsWith(origin + '/') && !/^(data|blob):/.test(url));
        assert.deepEqual(external, [], 'fixture must not request any external network endpoint');
      });
    }
  } finally { await server.close(); }
});
