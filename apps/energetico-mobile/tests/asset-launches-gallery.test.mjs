import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';

const columns = [
  ['Title', 'IMOBILIZADO', 'text'], ['FILIAL', 'FILIAL', 'text'],
  ['_x0025__x0020_DEPRECIA_x00c7__x0', '% DEPRECIAÇÃO', 'number'],
  ['DATA_x0020_DE_x0020_DEPRECIA_x00', 'DATA DE DEPRECIAÇÃO', 'dateTime'],
  ['VALOR_x0020_DEPRECIA_x00c7__x00c', 'VALOR DEPRECIAÇÃO', 'currency'],
  ['VALOR_x0020_RESIDUAL', 'VALOR RESIDUAL', 'currency'],
  ['ID_x0020_IMOBILIZADO', 'ID IMOBILIZADO', 'number'],
  ['IDLANCAMENTO', 'ID LANÇAMENTO', 'number'],
  ['IDPEDIDO', 'NÚMERO DO PEDIDO', 'number'],
].map(([name, displayName, type]) => ({ name, displayName, [type]: {} }));
const item = (id, name = '') => ({ id: String(id), fields: {
  Title: name, FILIAL: '001 - FILIAL TESTE', _x0025__x0020_DEPRECIA_x00c7__x0: 0.02,
  DATA_x0020_DE_x0020_DEPRECIA_x00: '2026-11-01T03:00:00Z',
  VALOR_x0020_DEPRECIA_x00c7__x00c: 86.76, VALOR_x0020_RESIDUAL: 4251.26, ID_x0020_IMOBILIZADO: 2,
} });
function source(rows, { failSecondPage = false } = {}) {
  return createRegistrationGalleryData({ kind: 'assetLaunches', repository: {
    async resolveList(site, aliases) {
      assert.equal(site, 'personal'); assert.equal(aliases[0], 'LANCAMENTOSIMOBILIZADOS');
      return { status: 'resolved', id: 'f0f13292-f28c-4c09-8060-4d4af4664730' };
    },
    async getColumns() { return columns; },
    async getItemsPage(_site, _list, _query, { cursor } = {}) {
      if (cursor && failSecondPage) throw new Error('Falha na segunda página');
      const start = Number(cursor || 0), end = start + 100;
      return { items: rows.slice(start, end), hasMore: end < rows.length, nextLink: end < rows.length ? String(end) : null };
    },
  } });
}

test('lançamentos carrega os 275 registros da lista nova, incluindo páginas e nomes vazios', async () => {
  const data = source(Array.from({ length: 275 }, (_, i) => item(i + 1)));
  const snapshot = await data.loadSnapshot();
  assert.equal(snapshot.rows.length, 275);
  assert.equal(new Set(snapshot.rows.map(row => row.id)).size, 275);
  assert.equal(snapshot.rows[0].fields['ID IMOBILIZADO'], 2);
  assert.equal(snapshot.rows[0].fields['% DEPRECIAÇÃO'], 0.02);
  assert.equal(snapshot.rows[0].fields.IMOBILIZADO, '');
  assert.equal(data.saveEditor, undefined);
  assert.equal(data.deleteItem, undefined);
});

test('lançamentos não apresenta um histórico incompleto como carga bem-sucedida', async () => {
  await assert.rejects(source(Array.from({ length: 101 }, (_, i) => item(i + 1)), { failSecondPage: true }).loadSnapshot(), /segunda página/);
});

test('galeria mostra reais, percentual, data e vínculo do bem; busca e filtros funcionam sem edição', async t => {
  const dom = new JSDOM('<!doctype html><body></body>'); t.after(() => dom.window.close());
  const rows = [item(1, 'BETONEIRA DE TESTE'), item(2)];
  rows[1].fields.ID_x0020_IMOBILIZADO = 94;
  rows[1].fields.VALOR_x0020_DEPRECIA_x00c7__x00c = 0;
  rows[0].fields.IDLANCAMENTO = 4321;
  rows[0].fields.IDPEDIDO = 494;
  const gallery = createRegistrationGallery({ document: dom.window.document, kind: 'assetLaunches', data: source(rows) });
  t.after(() => gallery.destroy()); await gallery.open();
  const doc = dom.window.document;
  assert.match(doc.querySelector('h1').textContent, /LANÇAMENTOS IMOBILIZADOS/);
  const card = doc.querySelector('[data-registration-row="1"]');
  assert.match(card.textContent, /86,76/); assert.match(card.textContent, /4\.251,26/);
  assert.match(card.textContent, /2%/); assert.doesNotMatch(card.textContent, /200%/);
  assert.match(card.textContent, /01\/11\/2026/);
  assert.equal(card.querySelector('[data-field="ID IMOBILIZADO"] dd').textContent, '2');
  assert.equal(card.querySelector('[data-field="ID LANÇAMENTO"] dd').textContent, '4.321');
  assert.equal(card.querySelector('[data-field="NÚMERO DO PEDIDO"] dd').textContent, '494');
  assert.equal(doc.querySelector('[data-registration-row="2"] [data-field="ID LANÇAMENTO"]'), null, 'registro legado não recebe um vínculo inventado');
  assert.match(doc.querySelector('[data-registration-row="2"]').textContent, /0,00/);
  assert.equal(doc.querySelector('[data-action="create-registration"]'), null);
  assert.equal(doc.querySelector('[data-gallery-action="edit"]'), null);
  assert.equal(doc.querySelector('[data-gallery-action="delete"]'), null);
  const search = doc.querySelector('input[type="search"]'); search.value = '94';
  search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepEqual([...doc.querySelectorAll('[data-registration-row]')].map(node => node.dataset.registrationRow), ['2', '1'], 'a busca também encontra o pedido 494');
  search.value = ''; search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const filter = doc.querySelector('[data-filter-field="ID IMOBILIZADO"]'); filter.value = '2';
  filter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([...doc.querySelectorAll('[data-registration-row]')].map(node => node.dataset.registrationRow), ['1']);
});

test('ordena todos os lançamentos por nome antes de paginar e permite voltar aos mais recentes', async t => {
  const dom = new JSDOM('<!doctype html><body></body>'); t.after(() => dom.window.close());
  const rows = Array.from({ length: 65 }, (_, i) => item(i + 1, `Z EQUIPAMENTO ${i + 1}`));
  rows[64] = item(65, 'ÁRVORE DE TESTE');
  rows[0] = item(1, 'BETONEIRA DE TESTE');
  const gallery = createRegistrationGallery({ document: dom.window.document, kind: 'assetLaunches', data: source(rows) });
  t.after(() => gallery.destroy()); await gallery.open();
  const doc = dom.window.document, sort = doc.querySelector('[data-gallery-sort]');
  assert.ok(sort, 'ordenação disponível fora dos filtros');
  assert.equal(sort.closest('details'), null);
  assert.equal(sort.value, 'name:asc');
  assert.deepEqual([...doc.querySelectorAll('[data-registration-row]')].slice(0, 2).map(n => n.dataset.registrationRow), ['65', '1']);
  sort.value = 'recent:desc'; sort.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual([...doc.querySelectorAll('[data-registration-row]')].slice(0, 2).map(n => n.dataset.registrationRow), ['65', '64']);
  const search = doc.querySelector('input[type="search"]'); search.value = 'BETONEIRA';
  search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepEqual([...doc.querySelectorAll('[data-registration-row]')].map(n => n.dataset.registrationRow), ['1']);
});
