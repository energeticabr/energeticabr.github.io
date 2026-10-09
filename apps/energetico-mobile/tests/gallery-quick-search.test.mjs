import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { galleryCases, galleryOptions } from './helpers/gallery-create-cases.mjs';

const settle = () => new Promise(resolve => setTimeout(resolve, 230));
for (const entry of galleryCases) {
  test(`${entry.name}: multi-field search is visible without opening Filters`, async t => {
    const dom = new JSDOM('<body></body>', { url: 'https://example.test' });
    const gallery = entry.factory(galleryOptions(entry, dom.window.document));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    await gallery.open();
    const root = dom.window.document.querySelector(entry.root);
    const search = root.querySelector('[data-gallery-quick-search]');
    assert.ok(search, 'all galleries expose the quick search tray');
    assert.equal(search.type, 'search');
    assert.ok(search.getAttribute('aria-label'));
    assert.equal(search.closest('details'), null);
    assert.equal(search.closest('[hidden]'), null);
    const toolbar = search.closest('.gallery-create-toolbar');
    assert.ok(toolbar);
    const filters = toolbar.querySelector('.gallery-filter-button');
    assert.match(filters.textContent, /Filtros/);
    assert.equal(filters.getAttribute('aria-expanded'), 'false');
    filters.click();
    assert.equal(filters.getAttribute('aria-expanded'), 'true');
    assert.equal(root.querySelectorAll('[data-gallery-quick-search]').length, 1);
  });
}

for (const kind of ['group', 'quotes', 'recurringTasks', 'delegatedTasks']) {
  test(`${kind}: words can match different fields, including ID, and quick search preserves specific filters`, async t => {
    const entry = galleryCases.find(value => value.name === kind);
    const dom = new JSDOM('<body></body>', { url: 'https://example.test' });
    const rows = [
      { id: '81', fields: { GRUPO: 'São José', DESCRICAO: 'São José', TAREFA: 'São José', STATUS: 'ATIVO', FILIAL: 'CENTRAL', FORNECEDOR: 'Mauro', 'CONCLUÍDO': 'ATIVIDADE CRIADA', 'ID 2': '981' } },
      { id: '82', fields: { GRUPO: 'Mauro', DESCRICAO: 'Mauro', TAREFA: 'Mauro', STATUS: 'INATIVO', FILIAL: 'NORTE', FORNECEDOR: 'Outro', 'CONCLUÍDO': 'SIM', 'ID 2': '982' } },
    ];
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, { snapshot: { rows } }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    await gallery.open();
    const root = dom.window.document.querySelector(entry.root);
    const search = root.querySelector('input[type="search"]');
    search.value = '81 jose';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await settle();
    assert.deepEqual([...root.querySelectorAll('[data-registration-row]')].map(card => card.dataset.registrationRow), ['81']);
    search.value = 'central';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await settle();
    if (kind !== 'group') assert.deepEqual([...root.querySelectorAll('[data-registration-row]')].map(card => card.dataset.registrationRow), ['81']);
    if (kind === 'group') {
      const status = root.querySelector('.rg-toolbar select');
      status.value = 'ATIVO';
      status.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      search.value = '';
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      assert.equal(status.value, 'ATIVO');
      assert.deepEqual([...root.querySelectorAll('[data-registration-row]')].map(card => card.dataset.registrationRow), ['81']);
    }
  });
}

test('launch quick search resets pagination and sends text alongside selected filters', async t => {
  const entry = galleryCases.find(value => value.name === 'launch');
  const dom = new JSDOM('<body></body>', { url: 'https://example.test' });
  const calls = [];
  const gallery = entry.factory(galleryOptions(entry, dom.window.document, { request: async (operation, payload) => {
    calls.push({ operation, payload });
    return { rows: [], count: 0, page: payload.page, pages: 2, filterOptions: { supplier: ['Mauro'] } };
  } }));
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const root = dom.window.document.querySelector(entry.root);
  const search = root.querySelector('[data-gallery-quick-search]');
  assert.ok(search);
  const supplier = root.querySelector('[name="supplier"]');
  supplier.value = 'Mauro';
  search.value = 'CENTRAL 08/10/2026';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await settle();
  assert.equal(calls.at(-1).payload.filters.search, 'CENTRAL 08/10/2026');
  assert.equal(calls.at(-1).payload.filters.supplier, 'Mauro');
  assert.equal(calls.at(-1).payload.page, 1);
  search.value = '';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await settle();
  assert.equal(calls.at(-1).payload.filters.search, '');
  assert.equal(calls.at(-1).payload.filters.supplier, 'Mauro');
});

test('launch reopening applies text typed just before closing, instead of showing stale unfiltered rows', async t => {
  const entry = galleryCases.find(value => value.name === 'launch');
  const dom = new JSDOM('<body></body>');
  const calls = [];
  const gallery = entry.factory(galleryOptions(entry, dom.window.document, { request: async (_op, payload) => {
    calls.push(payload);
    return { rows: [], page: payload.page, pages: 1, filterOptions: {} };
  } }));
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const search = dom.window.document.querySelector('[data-gallery-quick-search]');
  search.value = 'alpha';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  gallery.close();
  await gallery.open();
  assert.equal(search.value, 'alpha');
  assert.equal(calls.at(-1).filters.search, 'alpha');
  assert.equal(calls.at(-1).page, 1);
});

for (const name of ['payments', 'recurring']) {
  test(`${name}: search matches the displayed civil date and supported lookup names`, async t => {
    const entry = galleryCases.find(value => value.name === name);
    const dom = new JSDOM('<body></body>');
    const row = { id: '91', fields: { STATUS: 'PAGAMENTO PREVISTO', FORNECEDOR: 'Mauro',
      'DATA PREVISTO PGTO': '2026-10-09T02:00:00Z', DATAINICIO: '2026-10-09T02:00:00Z',
      EQUIPAMENTO: { Name: 'Escavadeira' }, VALORTOTAL: 123.45, QTD: 2, FRETE: 6.78 } };
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, { snapshot: { rows: [row] } }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    await gallery.open();
    const root = dom.window.document.querySelector(entry.root);
    const search = root.querySelector('[data-gallery-quick-search]');
    const displayedDate = name === 'payments' ? '08/10/2026' : '09/10/2026';
    assert.ok(root.textContent.includes(displayedDate));
    search.value = displayedDate;
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await settle();
    assert.equal(root.querySelectorAll('[data-item-id]').length, 1);
    if (name === 'payments') {
      search.value = '09/10/2026';
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await settle();
      assert.equal(root.querySelectorAll('[data-item-id]').length, 0, 'UTC prefix must not create an incorrect displayed-date alias');
    }
    search.value = name === 'payments' ? '253,68' : 'Escavadeira';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await settle();
    assert.equal(root.querySelectorAll('[data-item-id]').length, 1);
  });
}

for (const name of ['orders', 'tasks']) {
  test(`${name}: timestamp search uses the gallery's displayed date`, async t => {
    const entry = galleryCases.find(value => value.name === name);
    const dom = new JSDOM('<body></body>');
    const row = { id: '91', fields: { STATUS: 'ATIVIDADE CRIADA', FORNECEDOR: 'Mauro',
      TAREFA: 'Inspeção', 'DATA FATAL': '2026-10-09T02:00:00Z', 'DATA PGTO': '2026-10-09T02:00:00Z' } };
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, { snapshot: { rows: [row] } }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    await gallery.open();
    const root = dom.window.document.querySelector(entry.root);
    const search = root.querySelector('[data-gallery-quick-search]');
    search.value = '09/10/2026';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await settle();
    assert.equal(root.querySelectorAll('[data-item-id]').length, 1);
  });
}

for (const name of ['payments', 'recurring']) {
  test(`${name}: empty quick search does not prepare unrelated searchable values`, async t => {
    const entry = galleryCases.find(value => value.name === name);
    const dom = new JSDOM('<body></body>');
    let preparations = 0;
    const rows = Array.from({ length: 200 }, (_, index) => {
      const fields = { STATUS: 'PAGAMENTO PREVISTO', FORNECEDOR: 'Mauro', VALORTOTAL: 123.45,
        'DATA PREVISTO PGTO': '2026-10-08', DATAINICIO: '2026-10-08' };
      Object.defineProperty(fields, 'SEARCHONLY', { enumerable: true, get() { preparations += 1; return 'extra'; } });
      return { id: String(index + 1), fields };
    });
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, { snapshot: { rows } }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    await gallery.open();
    const search = dom.window.document.querySelector('[data-gallery-quick-search]');
    preparations = 0;
    search.value = 'Mauro';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await settle();
    assert.ok(preparations >= rows.length);
    const searchPreparations = preparations;
    preparations = 0;
    search.value = '';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await settle();
    assert.ok(preparations <= searchPreparations - rows.length,
      'clearing search must skip per-row search preparation, while preserving structured filtering and card rendering');
  });
}
