import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function setup(t, options = () => ({})) {
  const module = await import('../src/ui/gallery-refresh.js').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('gallery-refresh.js')) return {};
    throw error;
  });
  assert.equal(typeof module.attachGalleryRefreshButton, 'function', 'refresh helper must exist');
  const dom = new JSDOM('<section id="root"><div id="toolbar"></div></section>');
  const document = dom.window.document, root = document.querySelector('#root'), container = document.querySelector('#toolbar');
  const state = { calls: 0, available: true, fail: false };
  const refresh = module.attachGalleryRefreshButton({ document, root, container,
    onRefresh: async () => { state.calls++; if (state.fail) throw new Error('QA failure'); },
    isAvailable: () => state.available, ...options(document) });
  t.after(() => { refresh.destroy(); dom.window.close(); });
  const click = () => refresh.button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return { dom, document, root, container, refresh, state, click };
}

test('a callback rejected after close and reopen cannot attach stale error feedback to the new session', async t => {
  let reject;
  const ctx = await setup(t, () => ({ onRefresh: () => new Promise((_, fail) => { reject = fail; }) }));
  ctx.click(); ctx.root.hidden = true; await settle(); ctx.root.hidden = false; await settle();
  reject(new Error('old session')); await settle();
  assert.equal(ctx.root.querySelector('[data-gallery-refresh-error]'), null);
  assert.equal(ctx.refresh.button.disabled, false);
});

test('helper reuses supplied button in visible toolbar and sync honors loader availability', async t => {
  const ctx = await setup(t, document => ({ button: document.createElement('button') }));
  assert.equal(ctx.container.querySelectorAll('[data-gallery-refresh]').length, 1);
  assert.equal(ctx.refresh.button.type, 'button');
  assert.equal(ctx.refresh.button.textContent, 'Atualizar base de dados');
  ctx.refresh.sync(); ctx.click(); await settle(); assert.equal(ctx.state.calls, 1);
  ctx.state.available = false; ctx.refresh.sync(); assert.equal(ctx.refresh.button.disabled, true);
  ctx.click(); await settle(); assert.equal(ctx.state.calls, 1);
});

test('helper coalesces pending clicks and can refresh again after settlement', async t => {
  let finish, calls = 0;
  const ctx = await setup(t, () => ({ onRefresh: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }));
  ctx.click(); ctx.click(); ctx.click(); assert.equal(calls, 1); assert.equal(ctx.refresh.button.disabled, true);
  finish(); await settle(); assert.equal(ctx.refresh.button.disabled, false);
  ctx.click(); assert.equal(calls, 2); finish(); await settle();
});

test('helper blocks dialogs, editors, busy loading, inert and closed roots at activation time', async t => {
  const ctx = await setup(t, () => ({}));
  for (const selector of ['gallery-record-dialog', 'lg-editor']) {
    const dialog = ctx.document.createElement('section'); dialog.className = selector;
    if (selector === 'lg-editor') dialog.dataset.dynamicForm = '';
    ctx.root.append(dialog); await settle(); assert.equal(ctx.refresh.button.disabled, true);
    ctx.click(); assert.equal(ctx.state.calls, 0);
    dialog.hidden = true; await settle(); assert.equal(ctx.refresh.button.disabled, false); dialog.remove();
  }
  for (const [attribute, value] of [['aria-busy', 'true'], ['inert', ''], ['hidden', '']]) {
    ctx.root.setAttribute(attribute, value); ctx.click(); await settle(); assert.equal(ctx.state.calls, 0);
    ctx.root.removeAttribute(attribute); await settle(); assert.equal(ctx.refresh.button.disabled, false);
  }
});

test('rejected refresh has visible feedback, no unhandled promise, and succeeds on retry', async t => {
  const ctx = await setup(t, () => ({})); ctx.state.fail = true;
  ctx.click(); await settle();
  const alert = ctx.root.querySelector('[data-gallery-refresh-error]');
  assert.equal(alert?.getAttribute('role'), 'alert'); assert.equal(alert.closest('[hidden]'), null);
  assert.equal(ctx.refresh.button.disabled, false);
  ctx.state.fail = false; ctx.click(); await settle();
  assert.equal(ctx.state.calls, 2); assert.equal(ctx.root.querySelector('[data-gallery-refresh-error]'), null);
});

for (const action of ['destroy', 'detach', 'close']) {
  test(`helper ignores late rejection after ${action} and removes listeners on destroy`, async t => {
    let reject, calls = 0;
    const ctx = await setup(t, () => ({ onRefresh: () => { calls++; return new Promise((_, fail) => { reject = fail; }); } }));
    ctx.click();
    if (action === 'destroy') ctx.refresh.destroy();
    else if (action === 'detach') ctx.root.remove();
    else ctx.root.hidden = true;
    reject(new Error('late QA')); await settle();
    assert.equal(ctx.root.querySelector('[data-gallery-refresh-error]'), null);
    assert.equal(ctx.refresh.button.disabled, true); ctx.click(); assert.equal(calls, 1);
  });
}
