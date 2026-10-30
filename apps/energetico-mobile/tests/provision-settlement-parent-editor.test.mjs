import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createProvisionSettlementParentEditor } from '../src/ui/provision-settlement-parent-editor.js';
import { parentEditorFixture } from './helpers/provision-parent-editor-fixture.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle(check) { for (let i = 0; i < 60 && !check(); i++) await tick(); assert.ok(check(), 'async UI settled'); }
async function harness(t, overrides = {}) {
  const dom = new JSDOM('<button id="origin">Editar</button><main></main>');
  const document = dom.window.document, f = parentEditorFixture(); let current = true, refreshes = 0;
  const data = { ...f.data, async saveEditor(...args) { const saved = await f.data.saveEditor(...args); overrides.afterSave?.(); return saved; } };
  const editor = createProvisionSettlementParentEditor({ document, host: document.body, data, parentId: '7', token: 'a'.repeat(32),
    assertSession() { if (!current) throw new Error('Sessão encerrada'); },
    onRefresh: async () => { refreshes++; return true; }, ...overrides });
  t.after(() => { editor.destroy(); dom.window.close(); }); await editor.open();
  return { ...f, document, editor, dom, get refreshes() { return refreshes; }, switchSession() { current = false; editor.destroy(); },
    choose(name) { document.querySelector(`[data-provision-parent-column="${name}"]`).click(); },
    async save(name, value) { const input = document.querySelector(`[name="${name}"]`); assert.ok(input);
      const combo = document.querySelector('[role="combobox"]');
      if (combo) {
        combo.focus(); combo.value = value; combo.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        const option = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent === value);
        assert.ok(option, 'select actual catalog option'); option.click();
      } else input.value = value;
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick(); },
  };
}
test('chooser lists actual editable columns; one-field form keeps real predefined catalogs', async t => {
  const h = await harness(t), buttons = [...h.document.querySelectorAll('[data-provision-parent-column]')];
  assert.deepEqual(buttons.map(b => b.dataset.provisionParentColumn), ['FILIAL', 'FORNECEDOR', 'FORMAPGTO', 'STATUS', 'OBS', 'VALORTOTAL', 'DATAPREVISTOPGTO']);
  assert.equal(h.document.querySelector('form'), null);
  for (const name of ['FILIAL']) {
    h.choose(name); const select = h.document.querySelector(`select[name="${name}"]`);
    assert.ok(select); assert.deepEqual([...select.options].map(o => o.value).filter(Boolean), ['001 — OBRA FICTÍCIA', '002 — UNIDADE DE TESTE']);
    assert.equal(h.document.querySelectorAll('form [name]').length, 1);
    assert.equal(h.document.activeElement, h.document.querySelector('[role="combobox"]'), 'focus the visible catalog control');
  }
});
test('single-column save reuses original context and confirms immediate child fanout before refresh', async t => {
  const h = await harness(t); h.choose('FILIAL'); await h.save('FILIAL', '002 — UNIDADE DE TESTE');
  await settle(() => !h.document.querySelector('[data-provision-parent-dialog]'));
  assert.deepEqual(h.writes.map(w => [w.list, w.id, w.fields]), [
    ['parents', '7', { FILIAL: '002 — UNIDADE DE TESTE' }], ['children', '11', { FILIAL: '002 — UNIDADE DE TESTE' }], ['children', '12', { FILIAL: '002 — UNIDADE DE TESTE' }],
  ]);
  assert.equal(h.records.parents[0].fields.OBS, '  observação original  '); assert.equal(h.refreshes, 1);
});
test('refresh failure after saved fanout holds modal and offers refresh-only retry without resaving', async t => {
  let refreshes = 0;
  const h = await harness(t, { onRefresh: async () => ++refreshes > 1 }); h.choose('OBS'); await h.save('OBS', 'nova observação');
  await settle(() => h.document.querySelector('[data-provision-parent-refresh-retry]'));
  assert.equal(h.writes.length, 3); assert.equal(h.document.querySelector('form'), null);
  h.document.querySelector('[data-provision-parent-refresh-retry]').click();
  await settle(() => !h.document.querySelector('[data-provision-parent-dialog]'));
  assert.equal(h.writes.length, 3); assert.equal(refreshes, 2);
});
test('a new busy operation immediately after confirmed persistence can only retry refresh', async t => {
  let busy = false;
  const h = await harness(t, { afterSave: () => { busy = true; }, assertSession: () => { if (busy) throw new Error('Aguarde a operação atual'); } });
  h.choose('OBS'); await h.save('OBS', 'nova');
  await settle(() => h.document.querySelector('[data-provision-parent-refresh-retry]'));
  assert.equal(h.document.querySelector('[data-provision-parent-save-retry]'), null);
  assert.equal(h.writes.length, 3);
});
for (const cancel of ['back', 'escape', 'cancel']) test(`${cancel} refreshes readonly before leaving, holds on failure`, async t => {
  let calls = 0; const h = await harness(t, { onRefresh: async () => { calls++; return false; } });
  if (cancel === 'cancel') { h.choose('OBS'); h.document.querySelector('[data-form-cancel]').click(); }
  else if (cancel === 'back') h.document.querySelector('[data-provision-parent-back]').click();
  else h.document.querySelector('[data-provision-parent-dialog]').dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(() => h.document.querySelector('[data-provision-parent-refresh-retry]'));
  assert.equal(calls, 1); assert.deepEqual(h.writes, []);
});
test('incomplete fanout freezes intent; retry synchronizes children with no duplicate parent write', async t => {
  const h = await harness(t); h.failNextChild(); h.choose('OBS'); await h.save('OBS', 'nova');
  await settle(() => h.document.querySelector('[data-provision-parent-save-retry]'));
  assert.equal(h.refreshes, 0); assert.equal(h.document.querySelector('form'), null);
  h.document.querySelector('[data-provision-parent-save-retry]').click();
  await settle(() => !h.document.querySelector('[data-provision-parent-dialog]'));
  assert.equal(h.writes.filter(w => w.list === 'parents').length, 1); assert.equal(h.records.children[1].fields.OBS, 'NOVA');
});
test('rejected Cancel refresh after partial fanout retains the exact save intent and synchronization retry', async t => {
  const h = await harness(t, { onRefresh: async () => false }); h.failNextChild(); h.choose('OBS'); await h.save('OBS', 'nova');
  await settle(() => h.document.querySelector('[data-provision-parent-save-retry]'));
  h.document.querySelector('[data-provision-parent-cancel]').click();
  await settle(() => h.document.querySelector('[data-provision-parent-refresh-retry]'));
  assert.ok(h.document.querySelector('[data-provision-parent-save-retry]'), 'partial fanout can still be completed');
  h.document.querySelector('[data-provision-parent-save-retry]').click();
  await settle(() => h.records.children[1].fields.OBS === 'NOVA');
  assert.equal(h.writes.filter(write => write.list === 'parents').length, 1);
});
test('session disposal removes editor and delayed loads cannot reopen or refresh another flow', async t => {
  let resolve; const wait = new Promise(r => { resolve = r; });
  const h = await harness(t); h.switchSession();
  assert.equal(h.document.querySelector('[data-provision-parent-dialog]'), null); assert.equal(h.refreshes, 0);
  const document = h.document;
  const editor = createProvisionSettlementParentEditor({ document, data: { loadEditor: () => wait }, parentId: '7', token: 'a'.repeat(32), onRefresh: () => assert.fail('stale refresh') });
  const open = editor.open(); editor.destroy(); resolve({}); await open;
  assert.equal(document.querySelector('[data-provision-parent-dialog]'), null);
});
