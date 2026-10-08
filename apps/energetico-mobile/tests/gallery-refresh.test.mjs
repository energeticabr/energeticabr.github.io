import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { galleryOptions } from './helpers/gallery-create-cases.mjs';
import { refreshCases, refreshRow, snapshot, filterControl } from './helpers/gallery-refresh-cases.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function setup(t, entry, overrides = {}) {
  const dom = new JSDOM('<main id="original">Original screen</main>', { url: 'https://example.test' });
  const document = dom.window.document;
  const state = { rows: [refreshRow(entry)], cached: [refreshRow(entry)], calls: [], pending: null, error: null, savePending: null };
  const read = async options => {
    state.calls.push(options);
    if (state.pending) return state.pending.promise;
    if (state.error) throw state.error;
    if (options?.refresh) state.cached = state.rows;
    return snapshot(entry, state.cached);
  };
  const editor = async id => ({ entity: { id: 'cadastro-de-grupos', title: 'Registro QA' },
    item: { id, eTag: '"v1"', fields: { Title: 'RASCUNHO QA' } },
    columns: [{ name: 'Title', label: 'Descrição QA', control: 'text', editable: true, required: true }],
    contract: { hasForm: true } });
  const data = { loadSnapshot: read, loadEditor: editor,
    loadFilterOptions: async () => [{ value: 'FORNECEDOR QA', label: 'FORNECEDOR QA' }],
    saveEditor: async () => state.savePending?.promise, deleteItem: async () => {}, listAttachments: async () => [], ...overrides.data };
  const gallery = entry.factory(galleryOptions(entry, document, { data,
    request: (_gallery, _page, _size, _cursor, options) => read(options),
    loadEditor: editor, saveEditor: data.saveEditor, deleteItem: data.deleteItem,
    now: () => new Date('2026-10-08T12:00:00-03:00') }));
  t.after(() => { state.pending?.resolve(snapshot(entry, [])); state.savePending?.resolve(); gallery.destroy(); dom.window.close(); });
  await gallery.open();
  return { dom, document, gallery, state, root: document.querySelector(entry.root) };
}
function refresh(ctx) {
  const buttons = [...ctx.root.querySelectorAll('button')].filter(button => /Atualizar/.test(button.textContent));
  assert.equal(buttons.length, 1, 'one refresh control, reusing existing buttons');
  const button = buttons[0];
  assert.equal(button.textContent, 'Atualizar base de dados');
  assert.equal(button.closest('details'), null, 'refresh stays outside collapsed filters');
  assert.equal(button.closest('[hidden]'), null);
  return button;
}
function forceClick(ctx, button) {
  button.dispatchEvent(new ctx.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

for (const entry of refreshCases) {
  test(`${entry.name}: refresh reads fresh data without onCreate and preserves search and selection`, async t => {
    const ctx = await setup(t, entry);
    const button = refresh(ctx);
    const search = ctx.root.querySelector('input[type="search"]');
    search.value = 'SINTETICO';
    const control = filterControl(ctx.root, entry);
    assert.ok(control, 'real filter exists');
    control.value = entry.name === 'group' ? 'ATIVO' : 'FORNECEDOR QA';
    assert.ok(control.value, 'fixture provides a selectable filter');
    search.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
    control.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 350)); await settle();
    const selected = control.value, calls = ctx.state.calls.length;
    ctx.state.rows = [refreshRow(entry, '902', 'SINTETICO NOVO')];
    assert.equal(button.disabled, false, 'read-only action does not depend on create callback');
    button.click(); await settle(); await settle();
    assert.equal(ctx.state.calls.length, calls + 1, 'only current gallery reads once');
    assert.equal(ctx.state.calls.at(-1).refresh, true, 'loader must bypass its cache');
    assert.match(ctx.root.textContent, /SINTETICO NOVO/);
    assert.doesNotMatch(ctx.root.textContent, /SINTETICO ANTERIOR/);
    assert.equal(search.value, 'SINTETICO'); assert.equal(control.value, selected);
    assert.equal(ctx.document.querySelector('#original').textContent, 'Original screen');
  });

  test(`${entry.name}: refresh retains a filter whose option disappeared`, async t => {
    const ctx = await setup(t, entry), button = refresh(ctx), control = filterControl(ctx.root, entry);
    control.value = entry.name === 'group' ? 'ATIVO' : 'FORNECEDOR QA';
    const selected = control.value;
    ctx.state.rows = entry.name === 'group' ? [] : [refreshRow(entry, '903', 'OUTRO REGISTRO', 'OUTRO FORNECEDOR')];
    button.click(); await settle(); await settle();
    assert.equal(control.value, selected, 'missing option must not broaden the active filter');
  });

  test(`${entry.name}: repeated clicks coalesce and destroyed galleries ignore late results`, async t => {
    const ctx = await setup(t, entry), button = refresh(ctx), calls = ctx.state.calls.length;
    ctx.state.pending = deferred();
    button.click(); forceClick(ctx, button); forceClick(ctx, button);
    assert.equal(ctx.state.calls.length, calls + 1); assert.equal(button.disabled, true);
    ctx.gallery.destroy(); const content = ctx.root.innerHTML;
    forceClick(ctx, button);
    ctx.state.pending.resolve(snapshot(entry, [refreshRow(entry, '999', 'LATE QA')]));
    await settle(); await settle();
    assert.equal(ctx.root.isConnected, false); assert.equal(ctx.root.innerHTML, content);
    assert.equal(button.disabled, true); assert.equal(ctx.state.calls.length, calls + 1);
  });

  test(`${entry.name}: refresh errors use visible feedback and allow another refresh`, async t => {
    const ctx = await setup(t, entry), button = refresh(ctx);
    ctx.state.error = new Error('Serviço QA indisponível');
    button.click(); await settle(); await settle();
    assert.match(ctx.root.textContent, /Não foi possível|Falha/);
    assert.equal(button.disabled, false);
    ctx.state.error = null; ctx.state.rows = [refreshRow(entry, '904', 'SINTETICO RECUPERADO')];
    button.click(); await settle(); await settle();
    assert.match(ctx.root.textContent, /SINTETICO RECUPERADO/);
  });

  test(`${entry.name}: open editor blocks refresh even synthetic activation and preserves draft`, async t => {
    const ctx = await setup(t, entry), button = refresh(ctx);
    ctx.root.querySelector('[data-gallery-action="edit"]').click(); await settle(); await settle();
    const form = ctx.root.querySelector('[data-dynamic-form]');
    assert.ok(form, 'real record editor is open');
    const input = form.querySelector('input:not([disabled])'); input.value = 'RASCUNHO NÃO SALVO';
    await settle();
    const calls = ctx.state.calls.length;
    assert.equal(button.disabled, true); forceClick(ctx, button); await settle();
    assert.equal(ctx.state.calls.length, calls); assert.equal(input.value, 'RASCUNHO NÃO SALVO');
    const dialog = form.closest('.gallery-record-dialog');
    [...dialog.querySelectorAll('button')].find(node => /Cancelar/i.test(node.textContent)).click(); await settle();
    assert.equal(button.disabled, false);
  });

  test(`${entry.name}: detaching during refresh prevents late rendering or control updates`, async t => {
    const ctx = await setup(t, entry), button = refresh(ctx);
    ctx.state.pending = deferred(); button.click(); await settle();
    ctx.root.remove(); const html = ctx.root.innerHTML;
    ctx.state.pending.resolve(snapshot(entry, [refreshRow(entry, '998', 'LATE DETACHED QA')]));
    await settle(); await settle();
    assert.equal(ctx.root.innerHTML, html, 'removed UI must not render a completed request');
    assert.equal(button.disabled, true);
  });

  test(`${entry.name}: a response from the closed session cannot replace a reopened gallery`, async t => {
    const ctx = await setup(t, entry), button = refresh(ctx);
    const old = deferred(); ctx.state.pending = old; button.click();
    ctx.gallery.close(); ctx.state.pending = null;
    ctx.state.rows = ctx.state.cached = [refreshRow(entry, '997', 'SINTETICO REABERTO')];
    await ctx.gallery.open(); await settle();
    assert.match(ctx.root.textContent, /SINTETICO REABERTO/);
    old.resolve(snapshot(entry, [refreshRow(entry, '996', 'SESSAO ANTIGA QA')])); await settle(); await settle();
    assert.match(ctx.root.textContent, /SINTETICO REABERTO/); assert.doesNotMatch(ctx.root.textContent, /SESSAO ANTIGA QA/);
    assert.equal(button.disabled, false);
  });

  test(`${entry.name}: an unfinished save blocks manual refresh across close and reopen`, async t => {
    const ctx = await setup(t, entry), button = refresh(ctx);
    ctx.root.querySelector('[data-gallery-action="edit"]').click(); await settle(); await settle();
    const form = ctx.root.querySelector('[data-dynamic-form]'); assert.ok(form);
    ctx.state.savePending = deferred();
    form.dispatchEvent(new ctx.dom.window.Event('submit', { bubbles: true, cancelable: true })); await settle();
    assert.equal(form.closest('.gallery-record-dialog').getAttribute('aria-busy'), 'true', 'save actually started');
    ctx.gallery.close(); await ctx.gallery.open(); await settle();
    const calls = ctx.state.calls.length;
    assert.equal(button.disabled, true); forceClick(ctx, button); await settle(); assert.equal(ctx.state.calls.length, calls);
    ctx.state.savePending.resolve(); await settle(); await settle();
    assert.equal(button.disabled, false);
  });
}

for (const galleryName of ['IDFOLHA', 'FOLHAPGTO']) {
  test(`${galleryName}: manual refresh consumes a pending search debounce without a second cached query`, async t => {
    const entry = refreshCases.find(entry => entry.name === galleryName);
    const ctx = await setup(t, entry), button = refresh(ctx), search = ctx.root.querySelector('input[type="search"]');
    search.value = 'SINTETICO'; search.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
    const calls = ctx.state.calls.length; ctx.state.pending = deferred();
    button.click(); await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(ctx.state.calls.length, calls + 1, 'scheduled filter query must not supersede the manual forced refresh');
    assert.equal(ctx.state.calls.at(-1).refresh, true);
    ctx.state.pending.resolve(snapshot(entry, [refreshRow(entry, '995', 'SINTETICO NOVO')])); await settle(); await settle();
    assert.match(ctx.root.textContent, /SINTETICO NOVO/); assert.equal(search.value, 'SINTETICO');
  });
  test(`${galleryName}: refresh retains a valid current page and cursor instead of resetting pagination`, async t => {
    const entry = refreshCases.find(entry => entry.name === galleryName);
    const dom = new JSDOM('<main></main>', { url: 'https://example.test' });
    const document = dom.window.document, calls = [];
    const gallery = entry.factory(galleryOptions(entry, document, { request: async (name, page, size, cursor, options) => {
      calls.push({ page, cursor, options });
      return { gallery: name, page, rows: [refreshRow(entry, String(900 + page), options.refresh ? 'SINTETICO ATUAL' : 'SINTETICO ANTERIOR')],
        hasMore: page === 1, nextCursor: page === 1 ? 'qa-valid-cursor' : null };
    } }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    await gallery.open(); const root = document.querySelector(entry.root);
    root.querySelector('[data-action="next-page"]').click(); await settle();
    const before = calls.length; refresh({ root }).click(); await settle(); await settle();
    assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).page, 2);
    assert.equal(calls.at(-1).cursor, 'qa-valid-cursor'); assert.equal(calls.at(-1).options.refresh, true);
    assert.match(root.querySelector('.hr-gallery-page').textContent, /2/); assert.match(root.textContent, /SINTETICO ATUAL/);
  });
  for (const failure of ['empty', 'expired']) {
    test(`${galleryName}: refreshing a ${failure} page cursor safely restarts at page one with filters`, async t => {
      const entry = refreshCases.find(entry => entry.name === galleryName);
      const dom = new JSDOM('<main></main>', { url: 'https://example.test' });
      const document = dom.window.document, calls = [];
      const gallery = entry.factory(galleryOptions(entry, document, { request: async (name, page, size, cursor, options) => {
        calls.push({ name, page, size, cursor, options });
        if (page === 2 && options.refresh && failure === 'expired') throw Object.assign(new Error('Invalid skip token'), { status: 410 });
        return { gallery: name, page, rows: page === 2 && options.refresh ? [] : [refreshRow(entry, String(900 + page))],
          hasMore: page === 1, nextCursor: page === 1 ? 'qa-cursor' : null };
      } }));
      t.after(() => { gallery.destroy(); dom.window.close(); });
      await gallery.open();
      const root = document.querySelector(entry.root), search = root.querySelector('input[type="search"]');
      search.value = 'SINTETICO';
      root.querySelector('[data-action="next-page"]').click(); await settle();
      assert.match(root.querySelector('.hr-gallery-page').textContent, /2/);
      refresh({ root }).click(); await settle(); await settle();
      assert.equal(calls.at(-2).page, 2); assert.equal(calls.at(-2).cursor, 'qa-cursor'); assert.equal(calls.at(-2).options.refresh, true);
      assert.equal(calls.at(-1).page, 1); assert.equal(calls.at(-1).cursor, null); assert.equal(calls.at(-1).options.refresh, true);
      assert.equal(calls.at(-1).options.filters.search, 'SINTETICO');
      assert.match(root.querySelector('.hr-gallery-page').textContent, /1/);
    });
  }
}

for (const outcome of ['removed', 'error', 'detached']) {
  test(`registration: a ${outcome} catalog during refresh preserves selection and ignores detached UI`, async t => {
    const entry = refreshCases.find(entry => entry.name === 'documents');
    let mode = 'initial', finish;
    const calls = [];
    const ctx = await setup(t, entry, { data: {
      getFilterSource: field => ['FORNECEDOR', 'PESSOARELACIONADA'].includes(field) ? { dependsOn: [] } : null,
      loadFilterOptions: async (field, options) => {
        calls.push(options);
        if (mode === 'error') throw new Error('Catálogo QA indisponível');
        if (mode === 'detached') return new Promise(resolve => { finish = resolve; });
        return mode === 'removed' ? [] : [{ value: 'FORNECEDOR QA', label: 'FORNECEDOR QA' }];
      },
    } });
    const control = filterControl(ctx.root, entry); control.value = 'FORNECEDOR QA';
    mode = outcome; refresh(ctx).click(); await settle();
    if (outcome === 'detached') {
      assert.equal(typeof finish, 'function'); ctx.root.remove(); const html = ctx.root.innerHTML;
      finish([{ value: 'LATE CATALOG', label: 'LATE CATALOG' }]); await settle(); await settle();
      assert.ok(ctx.root.innerHTML === html, 'late catalog must not update detached controls');
    } else {
      await settle(); assert.equal(control.value, 'FORNECEDOR QA');
      assert.equal(calls.at(-1)?.refresh, true, 'catalog cache is bypassed');
      if (outcome === 'error') assert.match(ctx.root.textContent, /indisponível/);
    }
  });
}
