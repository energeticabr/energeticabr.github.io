import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatMarkup, createChatView } from '../src/ui/chat-view.js';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';

const cases = [
  ['investment', 'CADASTRO INVESTIMENTO', 'INSTITUICAO', ['INSTITUICAO', 'DESCRICAO', 'TIPO', 'INVESTIMENTO', 'TRIBUTAÇÃO', 'RENTABILIDADE', 'LIQUIDEZ', 'RISCO', 'PRAZO']],
  ['institution', 'INSTITUICAOEMISSORA', 'INSTITUICAOEMISSORA', ['INSTITUICAOEMISSORA', 'STATUS']],
  ['investment_type', 'CADASTROTIPOINVESTIMENTO', 'TIPO', ['TIPO', 'DESCRICAO', 'STATUS']],
  ['profitability', 'RENTABILIDADE', 'RENTABILIDADE', ['RENTABILIDADE', 'STATUS']],
  ['taxation', 'TRIBUTAÇÃO', 'TRIBUTACAO', ['TRIBUTACAO', 'STATUS', 'DESCRICAO']],
];
const menu = { id: 'financial-menu', role: 'assistant', type: 'poll',
  question: '🗂️ CADASTROS\nQUAL CADASTRO FINANCEIRO VOCÊ DESEJA EFETUAR?',
  options: cases.map(([name, list]) => ({ id: `action_register_${name}`, reply: `action_register_${name}`, label: `CADASTRO ${list}` })),
};
const state = { sessionStatus: 'authenticated', account: { name: 'Bernardo' }, messages: [menu], pendingFiles: [], draft: '' };

test('financial menu puts exactly one corresponding gallery to the right of every registration', () => {
  const dom = new JSDOM('<main id="app"></main>');
  const view = createChatView(dom.window.document.querySelector('main'));
  const selected = [];
  view.on('select-reply', event => selected.push(event.replyId));
  view.render(state);
  const pairs = [...dom.window.document.querySelectorAll('.chat-menu-gallery-pair')];
  assert.equal(pairs.length, 5);
  assert.deepEqual(pairs.map(pair => [...pair.querySelectorAll('[data-reply-id]')].map(b => b.dataset.replyId)),
    cases.map(([name]) => [`action_register_${name}`, `action_${name}_gallery`]));
  pairs.forEach(pair => pair.querySelector('[data-gallery-button]').click());
  assert.deepEqual(selected, cases.map(([name]) => `action_${name}_gallery`));
  view.destroy(); dom.window.close();
});

test('financial gallery pairing never changes unrelated registration questions', () => {
  const dom = new JSDOM(renderChatMarkup({ ...state, messages: [{ ...menu, question: 'INFORME A DESCRIÇÃO' }] }));
  assert.equal(dom.window.document.querySelector('[data-gallery-button]'), null);
  dom.window.close();
});

for (const [kind, list, primary, fields] of cases) {
  test(`${kind}: real gallery service reads the right base, filters records and exposes only editable business fields`, async () => {
    const columns = fields.map(name => ({ name, displayName: name, ...(name === 'PRAZO' ? { dateTime: { format: 'dateOnly' } } : { text: {} }) }));
    const rows = [
      { id: '2', eTag: '"v2"', fields: { [primary]: 'EXEMPLO B', STATUS: 'ATIVO' } },
      { id: '1', eTag: '"v1"', fields: { [primary]: 'UNICOALFA', STATUS: 'INATIVO' } },
    ];
    let resolved;
    const repository = {
      async resolveList(site, aliases) { resolved = { site, aliases }; return { id: aliases[0], status: 'resolved', displayName: aliases[0] }; },
      async getColumns(_site, source) { return source === 'INSTITUICAOEMISSORA' && kind === 'investment'
        ? [{ name: 'INSTITUICAOEMISSORA', displayName: 'Instituição', text: {} }]
        : [...columns, { name: 'Title', displayName: 'Título', text: {} }]; },
      async getItemsPage(_site, source) { return { items: source === 'INSTITUICAOEMISSORA' && kind === 'investment'
        ? [{ id: '1', fields: { INSTITUICAOEMISSORA: 'INSTITUIÇÃO CADASTRADA' } }] : rows, hasMore: false }; },
      async getItem(_site, _list, id) { return rows.find(row => row.id === id); },
      async updateItem() { throw new Error('The preview must never write'); },
    };
    const data = createRegistrationGalleryData({ kind, repository });
    const snapshot = await data.loadSnapshot();
    assert.equal(resolved.site, 'personal');
    assert.equal(resolved.aliases[0], list);
    const dom = new JSDOM('<body></body>');
    const gallery = createRegistrationGallery({ document: dom.window.document, kind, data });
    await gallery.open();
    assert.equal(dom.window.document.querySelectorAll('[data-registration-row]').length, 2);
    const search = dom.window.document.querySelector('[data-gallery-quick-search]');
    search.value = 'UNICOALFA';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(dom.window.document.querySelectorAll('[data-registration-row]').length, 1);
    assert.ok(dom.window.document.querySelector(`[data-filter-field="${primary}"]`));
    const editor = await data.loadEditor('1');
    assert.equal(editor.contract.readOnly, false);
    assert.deepEqual(editor.columns.map(column => column.name), fields);
    assert.equal(editor.columns.some(column => column.name === 'Title'), false);
    if (kind === 'taxation') assert.equal(editor.columns.find(column => column.name === 'STATUS').control, 'text');
    if (kind === 'investment') {
      const institution = editor.columns.find(column => column.name === 'INSTITUICAO');
      assert.equal(institution.control, 'select');
      assert.deepEqual(institution.choices, ['INSTITUIÇÃO CADASTRADA']);
      await assert.rejects(data.saveEditor(editor, { INSTITUICAO: 'VALOR INVENTADO' }), /opção|cadastrad|inválid|valor/i);
    }
    if (['institution', 'investment_type', 'profitability'].includes(kind)) {
      assert.equal(editor.columns.find(column => column.name === 'STATUS').control, 'select');
      assert.deepEqual(editor.columns.find(column => column.name === 'STATUS').choices, ['ATIVO', 'INATIVO']);
    }
    gallery.destroy(); dom.window.close();
  });
}
