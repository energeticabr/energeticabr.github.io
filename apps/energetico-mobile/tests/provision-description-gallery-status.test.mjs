import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { createSharePointRepository } from '../../../portal/data/sharepoint-repository.js';
import { waitGalleryCatalogs } from './helpers/wait-gallery-catalogs.mjs';

test('STATUS discovery respects real Graph page limits and includes choices on later pages', async t => {
  const graph = { async request(path, options = {}) {
    assert.equal(options.method || 'GET', 'GET', 'status discovery never writes business data');
    if (path.includes('/columns')) return { value: [{ name: 'STATUS', text: {} }] };
    if (path.includes('/items')) {
      if (path.includes('/items/9')) return item(9, { STATUS: null });
      if (path.includes('$select=STATUS')) assert.equal(new URLSearchParams(path.split('?')[1]).get('$top'), '100');
      if (path.includes('parents')) return { value: [item(9, { STATUS: null })] };
      if (path.includes('$skiptoken=next')) return { value: [item(2, { STATUS: paid })] };
      return { value: [item(1, { STATUS: predicted })], '@odata.nextLink':
        'https://graph.microsoft.com/v1.0/sites/site/lists/children/items?$select=id&$expand=fields($select=STATUS)&$top=100&$skiptoken=next' };
    }
    if (/\/lists(?:\?|$)/.test(path)) return { value: [{ id: 'parents', displayName: 'DESCRITIVOPROVISAO', list: { template: 'genericList' } }, { id: 'children', displayName: 'PROVISÃO PGTOS', list: { template: 'genericList' } }] };
    return { id: 'site' };
  } };
  const repository = createSharePointRepository(graph, { personal: { host: 'example.sharepoint.com', path: '/sites/example', readTransport: 'graph' } });
  const f = { data: createRegistrationGalleryData({ kind: 'provisionDescription', repository }) };
  assert.deepEqual((await f.data.loadFilterOptions('STATUS')).map(option => option.value).sort(), [paid, predicted]);
  const v = await view(t, f), status = v.root.querySelector('[data-filter-field="STATUS"]');
  assert.equal(status.disabled, false, v.root.querySelector('.rg-feedback').textContent);
  assert.equal(status.value, predicted);
  assert.deepEqual([...status.options].map(option => option.value).sort(), ['', paid, predicted]);
  const context = await f.data.loadEditor('9');
  assert.deepEqual([...context.columns.find(column => column.name === 'STATUS').choices].sort(), [paid, predicted]);
});

const predicted = 'PAGAMENTO PREVISTO', paid = 'PAGAMENTO EFETUADO';
const item = (id, fields) => ({ id: String(id), eTag: `"v${id}"`, hasAttachments: false, fields });
function fixture({ parents, parentStatus = { name: 'STATUS', text: {} }, childStatus = { name: 'STATUS', text: {} }, children, inMemoryEdits = false } = {}) {
  parents ||= [item(9, { FORNECEDOR: 'A', STATUS: '', DATAPREVISTOPGTO: '2026-10-10' })];
  children ||= [item(1, { STATUS: predicted }), item(2, { STATUS: paid })];
  const columns = {
    parents: [parentStatus, { name: 'FORNECEDOR', text: {} }, { name: 'OBS', text: {} },
      { name: 'DATAPREVISTOPGTO', dateTime: {} }, { name: 'DATAPGTOEFETUADO', dateTime: {} },
      { name: 'DATAEXECUCAOAGENDAMENTO', dateTime: {} }].filter(Boolean),
    children: [childStatus, { name: 'DESCRITIVOPROVISAO', text: {} }].filter(Boolean),
  };
  const reads = [], writes = [];
  const repository = {
    async resolveList(_site, aliases) { return { status: 'resolved', id: aliases.includes('DESCRITIVOPROVISAO') ? 'parents' : aliases.includes('FORNECEDORES') ? 'suppliers' : 'children' }; },
    async getColumns(_site, list) { return list === 'suppliers' ? [{ name: 'CADASTRO', text: {} }] : structuredClone(columns[list]); },
    async getItemsPage(_site, list, query, options = {}) {
      reads.push({ list, query, cursor: options.cursor });
      if (list === 'suppliers') return { items: [{ id: '1', fields: { CADASTRO: 'A' } }], hasMore: false };
      if (list === 'parents') return { items: structuredClone(parents), hasMore: false };
      return options.cursor ? { items: structuredClone(children.slice(1)), hasMore: false }
        : { items: structuredClone(children.slice(0, 1)), hasMore: true, nextLink: 'second-status-page' };
    },
    async getItem(_site, list, id) { return structuredClone((list === 'parents' ? parents : children).find(row => row.id === id)); },
    async updateItem(site, list, id, fields, options) {
      assert.ok(inMemoryEdits, 'read-only tests must never submit a SharePoint change');
      assert.equal(site, 'personal');
      const record = (list === 'parents' ? parents : children).find(row => row.id === id);
      assert.equal(options.eTag, record.eTag, 'every in-memory write must use the loaded version');
      writes.push({ list, id, fields: structuredClone(fields) });
      Object.assign(record.fields, fields); record.eTag += 'n';
      return structuredClone(record);
    },
  };
  return { parents, children, columns, reads, writes, repository,
    data: createRegistrationGalleryData({ kind: 'provisionDescription', repository }) };
}
async function view(t, f) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const gallery = createRegistrationGallery({ document: dom.window.document, kind: 'provisionDescription', data: f.data });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const root = dom.window.document.querySelector('[data-gallery-kind="provisionDescription"]');
  await waitGalleryCatalogs(root);
  return { dom, gallery, root, ids: () => [...root.querySelectorAll('[data-registration-row]')].map(row => row.dataset.registrationRow),
    change(control, value) { assert.ok(control, 'the requested filter must exist'); control.value = value; control.dispatchEvent(new dom.window.Event('change', { bubbles: true })); } };
}
const mixedParents = () => [
  item(9, { FORNECEDOR: 'Pendente', STATUS: predicted, DATAPREVISTOPGTO: '2026-10-10' }),
  item(8, { FORNECEDOR: 'Pago', STATUS: paid, DATAPREVISTOPGTO: '2026-10-11', DATAPGTOEFETUADO: '2026-10-10' }),
  item(7, { FORNECEDOR: 'Status atrasado', STATUS: predicted, DATAPREVISTOPGTO: '2026-10-12', DATAPGTOEFETUADO: '2026-10-10' }),
  item(6, { FORNECEDOR: 'Agendamento executado', STATUS: predicted, DATAPREVISTOPGTO: '2026-10-13', DATAEXECUCAOAGENDAMENTO: '2026-10-10' }),
  item(5, { FORNECEDOR: 'Legado pendente', STATUS: '', DATAPREVISTOPGTO: '2026-10-14' }),
  item(4, { FORNECEDOR: 'Legado pago', STATUS: '', DATAPREVISTOPGTO: '2026-10-15', DATAPGTOEFETUADO: '2026-10-10' }),
  item(3, { FORNECEDOR: 'Legado executado', DATAPREVISTOPGTO: '2026-10-16', DATAEXECUCAOAGENDAMENTO: '2026-10-10' }),
];

test('STATUS uses the parent choice metadata even when a choice has no gallery records', async () => {
  const f = fixture({ parentStatus: { name: 'STATUS', choice: { choices: [predicted, paid], allowTextEntry: false } } });
  assert.deepEqual(await f.data.loadFilterOptions('STATUS'), [{ value: predicted, label: predicted }, { value: paid, label: paid }]);
  assert.equal(f.reads.length, 0, 'choice metadata must not require item enumeration');
});
test('a text STATUS uses distinct real parent and linked-list values across every page', async () => {
  const f = fixture();
  const options = await f.data.loadFilterOptions('STATUS');
  assert.ok(Array.isArray(options), 'the STATUS source must provide confirmed options');
  assert.deepEqual(options.map(option => option.value).sort(), [paid, predicted]);
  assert.ok(f.reads.some(read => read.list === 'children' && read.cursor === 'second-status-page'));
  assert.ok(f.reads.every(read => !/FORNECEDOR|OBS/.test(read.query)), 'status discovery selects only its own source field');
  assert.deepEqual(f.writes, []);
});
test('missing STATUS metadata and incomplete status pagination refuse invented choices', async () => {
  for (const problem of ['missing', 'pagination', 'value']) {
    const f = fixture();
    if (problem === 'missing') f.columns.children = [];
    if (problem === 'pagination') f.repository.getItemsPage = async (_site, list) => list === 'parents'
      ? { items: f.parents, hasMore: false } : { items: f.children, hasMore: true };
    if (problem === 'value') f.children[0].fields.STATUS = ['UNKNOWN'];
    await assert.rejects(f.data.loadFilterOptions('STATUS'), /STATUS|metadados|pagin|opç/i, problem);
    assert.deepEqual(f.writes, []);
  }
});
test('the initial gallery shows predicted and unexecuted parents, including blank legacy STATUS', async t => {
  const f = fixture({ parents: mixedParents() }), v = await view(t, f);
  assert.deepEqual(v.ids(), ['9', '5']);
  const status = v.root.querySelector('[data-filter-field="STATUS"]');
  assert.ok(status);
  assert.equal(status.value, predicted);
  assert.deepEqual([...status.options].map(option => option.value).sort(), ['', paid, predicted]);
  for (const row of v.root.querySelectorAll('[data-registration-row]')) assert.equal(row.querySelector('[data-field="STATUS"] dd')?.textContent, predicted);
  assert.equal(f.parents.find(row => row.id === '5').fields.STATUS, '', 'legacy status interpretation never rewrites source rows');
  assert.deepEqual(f.writes, []);
});
test('Todos and manual STATUS expose executed parents and keep both inclusive date bounds', async t => {
  const v = await view(t, fixture({ parents: mixedParents() }));
  v.change(v.root.querySelector('[data-filter-field="STATUS"]'), '');
  v.change(v.root.querySelector('[data-date-bound="start"]'), '2026-10-11');
  v.change(v.root.querySelector('[data-date-bound="end"]'), '2026-10-13');
  assert.deepEqual(v.ids(), ['8', '7', '6']);
  v.change(v.root.querySelector('[data-filter-field="STATUS"]'), paid);
  v.change(v.root.querySelector('[data-date-bound="start"]'), '2026-10-15');
  v.change(v.root.querySelector('[data-date-bound="end"]'), '2026-10-16');
  assert.deepEqual(v.ids(), ['4', '3']);
  assert.equal(v.root.querySelector('[data-registration-row="4"] [data-field="STATUS"] dd')?.textContent, paid);
  await v.gallery.open();
  assert.deepEqual(v.ids(), ['4', '3'], 'refresh must retain the manual status and dates');
});
test('unavailable status source preserves the predicted-only default instead of showing paid records', async t => {
  const f = fixture({ parents: mixedParents() });
  f.repository.getColumns = async (_site, list) => { if (list === 'children') throw new Error('offline'); return f.columns.parents; };
  const v = await view(t, f);
  assert.deepEqual(v.ids(), ['9', '5']);
  const status = v.root.querySelector('[data-filter-field="STATUS"]');
  assert.ok(status);
  assert.equal(status.disabled, true);
  assert.match(v.root.querySelector('.rg-feedback').textContent, /Filtro Status indisponível/);
});
test('an all-paid source leaves the initial gallery empty until the user selects Todos', async t => {
  const v = await view(t, fixture({ parents: [item(9, { STATUS: paid, DATAPGTOEFETUADO: '2026-10-10' })], children: [item(1, { STATUS: paid })] }));
  assert.deepEqual(v.ids(), []);
  v.change(v.root.querySelector('[data-filter-field="STATUS"]'), '');
  assert.deepEqual(v.ids(), ['9']);
});
for (const selected of [predicted, paid]) test(`closing during STATUS refresh preserves ${selected} on reopen`, async t => {
  const f = fixture({ parents: mixedParents() }), source = f.data;
  let suspend = false, release;
  f.data = { ...source, async loadFilterOptions(field, options) {
    if (field === 'STATUS' && suspend) {
      suspend = false;
      return new Promise(resolve => { release = resolve; });
    }
    return source.loadFilterOptions(field, options);
  } };
  const v = await view(t, f), control = v.root.querySelector('[data-filter-field="STATUS"]');
  v.change(control, selected);
  const start = v.root.querySelector('[data-date-bound="start"]'), end = v.root.querySelector('[data-date-bound="end"]');
  v.change(start, '2026-10-10');
  v.change(end, '2026-10-16');
  const expected = v.ids();
  suspend = true;
  const refreshing = v.gallery.open();
  for (let attempt = 0; attempt < 30 && !release; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function', 'refresh must be pending on the real STATUS provider');
  v.gallery.close();
  release([{value: predicted,label: predicted},{value: paid,label: paid}]);
  await refreshing;
  assert.equal(v.root.hidden, true, 'the old response cannot resurrect a closed gallery');
  await v.gallery.open();
  await waitGalleryCatalogs(v.root);
  assert.equal(control.value, selected);
  assert.equal(start.value, '2026-10-10');
  assert.equal(end.value, '2026-10-16');
  assert.deepEqual(v.ids(), expected);
  assert.deepEqual(f.writes, []);
});

test('the metadata editor renders text STATUS as a closed select using confirmed source values', async () => {
  const f = fixture();
  const context = await f.data.loadEditor('9'), status = context.columns.find(column => column.name === 'STATUS');
  assert.equal(status?.control, 'select');
  assert.equal(status.allowMultipleValues, false);
  assert.deepEqual([...status.choices].sort(), [paid, predicted]);
  await assert.rejects(f.data.saveEditor(context, { STATUS: 'STATUS INVENTADO' }), /opç/i);
  assert.deepEqual(f.writes, []);
});
test('changing the real STATUS dropdown saves parent and linked children and refreshes the predicted default', async t => {
  const f = fixture({ inMemoryEdits: true,
    parents: [item(9, { FORNECEDOR: 'A', STATUS: predicted, DATAPREVISTOPGTO: '2026-10-10T03:00:00Z' })],
    children: [item(1, { DESCRITIVOPROVISAO: '9', STATUS: predicted }), item(2, { DESCRITIVOPROVISAO: '9', STATUS: paid })] });
  const v = await view(t, f);
  v.root.querySelector('[data-registration-row="9"] [data-gallery-action="edit"]').click();
  async function waitFor(check) { for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(check(), JSON.stringify({ writes: f.writes, form: v.root.querySelector('[data-gallery-record-screen]')?.textContent })); }
  await waitFor(() => v.root.querySelector('[data-dynamic-form]'));
  const form = v.root.querySelector('[data-dynamic-form]'), status = form.querySelector('[name="STATUS"]');
  assert.equal(status.tagName, 'SELECT');
  assert.equal(status.multiple, false);
  assert.deepEqual([...status.options].map(option => option.value).filter(Boolean).sort(), [paid, predicted]);
  const chooser = status.closest('label').querySelector('[role="combobox"]');
  assert.equal(chooser.readOnly, true, 'the editor only accepts selection from the real dropdown');
  chooser.click();
  const paidOption = [...status.closest('label').querySelectorAll('[role="option"]')].find(option => option.textContent === paid);
  assert.ok(paidOption);
  paidOption.click();
  assert.equal(status.value, paid);
  form.dispatchEvent(new v.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => !v.root.querySelector('[data-gallery-record-screen]') && v.root.getAttribute('aria-busy') === 'false');
  assert.deepEqual(f.writes, [{ list: 'parents', id: '9', fields: { STATUS: paid } }, { list: 'children', id: '1', fields: { STATUS: paid } }]);
  assert.equal(f.parents[0].fields.STATUS, paid);
  assert.equal(f.children[0].fields.STATUS, paid);
  assert.deepEqual(v.ids(), [], 'the saved paid parent must leave the active predicted filter');
  v.change(v.root.querySelector('[data-filter-field="STATUS"]'), '');
  assert.deepEqual(v.ids(), ['9']);
  assert.equal(v.root.querySelector('[data-field="STATUS"] dd').textContent, paid);
});
