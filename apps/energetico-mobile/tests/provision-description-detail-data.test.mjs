import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentProgrammingGalleryData } from '../src/chat/orders-gallery-data.js';

const child = (id, parent, fields = {}) => ({ id, fields: { ID: Number(id), DESCRITIVOPROVISAO: parent,
  FORNECEDOR: `FORNECEDOR FICTÍCIO ${id}`, DESCRICAOPGTO: 'Material de teste', QTD: '2',
  VALORTOTAL: '10', FRETE: '5', STATUS: 'PAGAMENTO PREVISTO', ...fields } });

function fixture(overrides = {}, options = {}) {
  const calls = [];
  const parent = { id: '33', fields: { ID: 33, FORNECEDOR: 'DIVERSOS', OBS: 'Grupo fictício', VALORTOTAL: '45' } };
  const pages = [
    { items: [child('350', '33'), child('351', '34')], hasMore: true, nextLink: 'page-2' },
    { items: [child('371', '33', { STATUS: 'PAGO', IDFOLHA: '24' })], hasMore: false, nextLink: '' },
  ];
  const repository = {
    async resolveList(_site, aliases) {
      return { status: 'resolved', id: aliases.includes('DESCRITIVOPROVISAO') ? 'parents' : 'children' };
    },
    async getColumns() { return [{ name: 'DESCRITIVOPROVISAO', text: {} }]; },
    async getItem() { return structuredClone(parent); },
    async getItemsPage(_site, _list, _query, { pageNumber }) { return structuredClone(pages[pageNumber - 1]); },
    ...overrides,
    updateItem() { throw new Error('Detalhamento não pode gravar registros.'); },
    createItem() { throw new Error('Detalhamento não pode criar registros.'); },
    deleteItem() { throw new Error('Detalhamento não pode excluir registros.'); },
  };
  for (const name of Object.keys(repository)) {
    const original = repository[name];
    repository[name] = (...args) => { calls.push([name, ...args]); return original(...args); };
  }
  const data = createPaymentProgrammingGalleryData({ repository, ...options });
  assert.equal(typeof data.loadDescriptionGroup, 'function', 'a galeria deve oferecer a consulta do descritivo');
  const load = (...args) => data.loadDescriptionGroup(...args);
  return { load, calls, parent, pages };
}

test('consulta todas as páginas e inclui provisões pagas sem misturar outro descritivo ou escrever', async () => {
  const ctx = fixture();
  const result = await ctx.load('33');
  assert.equal(result.description.id, '33');
  assert.deepEqual(result.provisions.map(row => row.id), ['350', '371']);
  assert.equal(result.provisions[1].fields.STATUS, 'PAGO');
  assert.equal(result.provisions[1].fields.IDFOLHA, '24');
  const reads = ctx.calls.filter(([name]) => name === 'getItemsPage');
  assert.equal(reads.length, 2);
  assert.equal(reads[1][4].cursor, 'page-2');
  assert.equal(reads.some(call => /\$filter/i.test(call[3])), false, 'não depende de índice do vínculo nem do filtro da galeria');
  assert.equal(ctx.calls.some(([name]) => /update|create|delete|upload/i.test(name)), false);
});

test('resolve o nome interno opaco pelo metadado e preserva os campos originais', async () => {
  const row = child('350', undefined, { field_23: '33', OBS: '<b>Texto literal</b>' });
  delete row.fields.DESCRITIVOPROVISAO;
  const original = structuredClone(row);
  const ctx = fixture({
    async getColumns() { return [{ name: 'field_23', displayName: 'Descritivo Provisão', text: {} }]; },
    async getItemsPage() { return { items: [row], hasMore: false }; },
  });
  const result = await ctx.load('33');
  assert.equal(result.provisions[0].id, '350');
  assert.equal(result.provisions[0].fields.OBS, '<b>Texto literal</b>');
  assert.deepEqual(row, original);
});

test('nova abertura lê o vínculo atual mesmo depois de outra sessão mover a provisão', async () => {
  let parent = '33';
  const ctx = fixture({ async getItemsPage() { return { items: [child('350', parent)], hasMore: false }; } });
  assert.equal((await ctx.load('33')).provisions.length, 1);
  parent = '34';
  assert.deepEqual((await ctx.load('33')).provisions, []);
});

test('vínculo usa ID exato e não inclui 133 ou 330 na consulta de 33', async () => {
  const ctx = fixture({ async getItemsPage() {
    return { items: [child('1', '133'), child('2', '330'), child('3', '33'), child('4', '')], hasMore: false };
  } });
  assert.deepEqual((await ctx.load('33')).provisions.map(row => row.id), ['3']);
});

for (const raw of ['', '0', '-1', '33x', "33' or true", '1234567890123456']) {
  test(`ID inválido ${JSON.stringify(raw)} não inicia consulta`, async () => {
    const ctx = fixture();
    await assert.rejects(async () => ctx.load(raw), /ID|vínculo|descritivo/i);
    assert.deepEqual(ctx.calls, []);
  });
}

test('descritivo indisponível não vira uma lista vazia nem consulta provisões', async () => {
  const ctx = fixture({ async getItem() { throw Object.assign(new Error('Ausente'), { status: 404 }); } });
  await assert.rejects(async () => ctx.load('33'), error => error.code === 'provision_description_not_found');
  assert.equal(ctx.calls.some(([name]) => name === 'getItemsPage'), false);
});

test('lista pai ausente falha sem consultar seus registros ou provisões', async () => {
  const ctx = fixture({ async resolveList(_site, aliases) {
    return aliases.includes('DESCRITIVOPROVISAO') ? { status: 'missing' } : { status: 'resolved', id: 'children' };
  } });
  await assert.rejects(async () => ctx.load('33'), /descritivo|lista/i);
  assert.equal(ctx.calls.some(([name]) => name === 'getItem' || name === 'getItemsPage'), false);
});

test('identidade de descritivo retornada incorretamente é rejeitada', async () => {
  const ctx = fixture({ async getItem() { return { id: '34', fields: { ID: 34 } }; } });
  await assert.rejects(async () => ctx.load('33'), /identidade|descritivo/i);
});

test('ID físico e campo ID contraditórios nunca são apresentados como a provisão correta', async () => {
  const ctx = fixture({ async getItemsPage() { return { items: [child('350', '33', { ID: 999 })], hasMore: false }; } });
  await assert.rejects(async () => ctx.load('33'), /identidade|ID|provisão/i);
});

for (const page of [
  { items: [], hasMore: true },
  { items: [], hasMore: false, nextLink: 'unexpected' },
  { items: [], hasMore: false, complete: false },
  { items: [], hasMore: false, partial: true },
  { items: [], hasMore: false, truncated: true },
  { items: [] },
  { hasMore: false },
]) {
  test(`paginação incompleta ou inconsistente não produz resultado parcial: ${JSON.stringify(page)}`, async () => {
    const ctx = fixture({ async getItemsPage() { return page; } });
    await assert.rejects(async () => ctx.load('33'), /complet|página|pagina|cursor|consulta|resposta/i);
  });
}

test('cursor cíclico interrompe a leitura sem repetir páginas indefinidamente', async () => {
  const ctx = fixture({ async getItemsPage(_site, _list, _query, { pageNumber }) {
    return { items: [child(String(pageNumber), '33')], hasMore: true, nextLink: 'same-cursor' };
  } });
  await assert.rejects(async () => ctx.load('33'), /cursor|pagina|página/i);
  assert.equal(ctx.calls.filter(([name]) => name === 'getItemsPage').length, 2);
});

test('provisão duplicada entre páginas não fica oculta por deduplicação', async () => {
  const ctx = fixture({ async getItemsPage(_site, _list, _query, { pageNumber }) {
    return { items: [child('350', '33')], hasMore: pageNumber === 1, nextLink: pageNumber === 1 ? 'next' : '' };
  } });
  await assert.rejects(async () => ctx.load('33'), /duplicad|repetid/i);
});

test('100 páginas é um limite de falha explícita e não uma truncagem silenciosa', async () => {
  const ctx = fixture({ async getItemsPage(_site, _list, _query, { pageNumber }) {
    return { items: [child(String(1000 + pageNumber), '33')], hasMore: true, nextLink: `page-${pageNumber + 1}` };
  } });
  await assert.rejects(async () => ctx.load('33'), /limite|páginas/i);
  assert.equal(ctx.calls.filter(([name]) => name === 'getItemsPage').length, 100);
});

test('colunas de vínculo ambíguas falham sem adivinhar o campo', async () => {
  const ctx = fixture({ async getColumns() { return ['field_23', 'field_24'].map(name => ({ name, displayName: 'Descritivo Provisão', text: {} })); } });
  await assert.rejects(async () => ctx.load('33'), /metadad|vínculo|coluna/i);
});

test('cancelamento após a primeira página impede as próximas e não entrega resultado', async () => {
  const controller = new AbortController();
  const ctx = fixture({ async getItemsPage() { controller.abort(); return { items: [], hasMore: true, nextLink: 'next' }; } });
  await assert.rejects(async () => ctx.load('33', { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(ctx.calls.filter(([name]) => name === 'getItemsPage').length, 1);
});

test('sessão encerrada durante a leitura não expõe os registros carregados', async () => {
  let expired = false;
  const ctx = fixture({ async getItemsPage() { expired = true; return { items: [child('350', '33')], hasMore: false }; } }, {
    assertSession() { if (expired) throw new Error('Sessão encerrada'); },
  });
  await assert.rejects(async () => ctx.load('33'), /Sessão encerrada/);
});

test('remoção do descritivo durante a leitura não exibe um cabeçalho antigo', async () => {
  let reads = 0;
  const ctx = fixture({ async getItem() {
    if (++reads > 1) throw Object.assign(new Error('Ausente'), { status: 404 });
    return { id: '33', fields: { ID: 33 } };
  } });
  await assert.rejects(async () => ctx.load('33'), error => error.code === 'provision_description_not_found');
});
