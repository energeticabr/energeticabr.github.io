import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { galleryCases, galleryOptions } from './helpers/gallery-create-cases.mjs';
import { loadingRow } from './helpers/gallery-loading-cases.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function result(entry, id = '901') {
  return { rows: [loadingRow(entry, id)], count: 1, page: 1, pages: 1,
    gallery: entry.options?.gallery, hasMore: false, nextCursor: null,
    totals: { paid: 90 }, filterOptions: {} };
}
function setup(t, entry, options = {}) {
  const dom = new JSDOM('<main>Chat preservado</main>', { url: 'https://example.test' });
  const state = { pending: deferred(), calls: 0 };
  const read = () => { state.calls++; return state.pending.promise; };
  const gallery = entry.factory(galleryOptions(entry, dom.window.document, {
    data: { loadSnapshot: read }, request: read, ...options,
  }));
  t.after(() => { state.pending.resolve(result(entry)); gallery.destroy(); dom.window.close(); });
  return { dom, state, gallery, root: () => dom.window.document.querySelector(entry.root) };
}
function loading(root) {
  const screen = root.querySelector('.gallery-loading-screen');
  assert.ok(screen, 'loading has its own screen, outside count and sorting rows');
  assert.equal(screen.parentElement, root);
  assert.equal(screen.hidden, false);
  assert.ok(screen.querySelector('[role="status"] .app-loading__mascot'));
  assert.ok(screen.querySelector('.app-loading__spinner'));
  const header = root.querySelector(':scope > header');
  assert.notEqual(header.inert, true);
  for (const content of [...root.children].filter(node => node !== header && node !== screen)) {
    assert.equal(content.inert, true, 'partially loaded content cannot receive input');
    assert.equal(content.getAttribute('aria-hidden'), 'true');
  }
  assert.equal(root.querySelectorAll('.og-list-status .app-loading, .lg-list-status .app-loading, .rg-feedback .app-loading').length, 0);
  return screen;
}

for (const entry of galleryCases) {
  test(`${entry.name}: initial load and refresh isolate content until data is ready`, async t => {
    const ctx = setup(t, entry), opening = ctx.gallery.open();
    const screen = loading(ctx.root());
    ctx.state.pending.resolve(result(entry)); await opening; await settle();
    assert.equal(screen.hidden, true);
    assert.match(ctx.root().textContent, /901/);
    const search = ctx.root().querySelector('input[type="search"]');
    if (search) search.value = 'SINTETICO';
    ctx.state.pending = deferred();
    ctx.root().querySelector('[data-gallery-refresh]').click();
    loading(ctx.root());
    ctx.state.pending.resolve(result(entry, '902')); await settle(); await settle();
    assert.equal(screen.hidden, true);
    assert.match(ctx.root().textContent, /902/);
    if (search) assert.equal(search.value, 'SINTETICO');
    for (const content of [...ctx.root().children].filter(node => node !== screen)) {
      assert.notEqual(content.getAttribute('aria-hidden'), 'true');
      assert.notEqual(content.inert, true);
    }
  });

  test(`${entry.name}: failure removes the loading screen and close/reopen ignores stale data`, async t => {
    const ctx = setup(t, entry), opening = ctx.gallery.open();
    const old = ctx.state.pending, screen = loading(ctx.root());
    ctx.gallery.close();
    assert.equal(screen.hidden, true);
    ctx.state.pending = deferred();
    const reopening = ctx.gallery.open();
    old.resolve(result(entry, '998')); await opening; await settle();
    loading(ctx.root());
    assert.doesNotMatch(ctx.root().textContent, /998/);
    ctx.state.pending.reject(new Error('Sem conexão QA')); await reopening; await settle();
    assert.equal(screen.hidden, true);
    assert.equal(ctx.root().getAttribute('aria-busy'), 'false');
    assert.match(ctx.root().textContent, /Não foi possível|Erro ao carregar/);
    assert.equal(ctx.root().querySelector('[data-gallery-refresh]').disabled, false);
  });
}

for (const entry of galleryCases.filter(entry => ['orders', 'tasks', 'payments'].includes(entry.name))) {
  for (const respectsAbort of [true, false]) {
    test(`${entry.name}: superseded request cannot release or overwrite the current loader (abort=${respectsAbort})`, async t => {
      const dom = new JSDOM('<main></main>'), pending = [];
      const gallery = entry.factory(galleryOptions(entry, dom.window.document, { data: {
        loadSnapshot: ({ signal }) => {
          const request = deferred(); pending.push(request);
          if (respectsAbort) signal.addEventListener('abort', () => request.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
          return request.promise;
        },
      } }));
      t.after(() => { for (const request of pending) request.resolve(result(entry)); gallery.destroy(); dom.window.close(); });
      const opening = gallery.open(), root = dom.window.document.querySelector(entry.root);
      const refreshing = gallery.reload();
      assert.equal(pending.length, 2);
      if (!respectsAbort) pending[0].resolve(result(entry, '998'));
      await opening; await settle();
      loading(root);
      assert.doesNotMatch(root.querySelector('.og-cards').textContent, /998/);
      pending[1].resolve(result(entry, '902')); await refreshing; await settle();
      assert.equal(root.querySelector('.gallery-loading-screen').hidden, true);
      assert.match(root.textContent, /902/);
    });
  }
}

for (const entry of galleryCases.filter(entry => ['launch', 'group'].includes(entry.name))) {
  test(`${entry.name}: busy keyboard navigation excludes hidden content`, async t => {
    const ctx = setup(t, entry, { onHome: () => {} }), opening = ctx.gallery.open(), root = ctx.root();
    const buttons = [...root.querySelector(':scope > header').querySelectorAll('button')];
    assert.equal(buttons.length, 2);
    buttons[0].focus();
    root.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(ctx.dom.window.document.activeElement, buttons[1]);
    buttons[1].focus();
    root.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(ctx.dom.window.document.activeElement, buttons[0]);
    ctx.state.pending.resolve(result(entry)); await opening;
  });
}
