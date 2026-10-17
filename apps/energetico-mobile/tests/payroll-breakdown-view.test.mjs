import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPayrollBreakdownView } from '../src/ui/payroll-breakdown-view.js';
import { validatePayrollBreakdown } from '../src/chat/payroll-breakdown.js';
import { renderChatMarkup } from '../src/ui/chat-view.js';

function harness(options = {}) {
  const dom = new JSDOM('<main></main>', { url: 'https://example.test' }), documentRef = dom.window.document;
  let posts = 0, posted, fail = false;
  const supplier = { id: '7', label: 'FORNECEDOR TESTE', branch: '004 - EDIFÍCIO XAVANTE', profession: 'PEDREIRO' };
  const data = { loadSuppliers: async () => [supplier, { ...supplier, id: '8', label: 'OUTRO FORNECEDOR' }], post: async (draft, progress, changed) => {
    posts++; posted = structuredClone(draft); const summary = validatePayrollBreakdown(draft); progress.signature = JSON.stringify(summary); changed();
    if (fail) throw new Error('Rede indisponível');
    return { ...summary, lines: summary.lines.map((line, index) => ({ ...line, id: String(index + 10), parentId: String(index + 20) })) };
  } };
  const view = createPayrollBreakdownView({ data, documentRef, root: documentRef.querySelector('main'), sessionKey: 'account', storage: dom.window.localStorage, now: () => new Date('2026-10-16T12:00:00Z'), ...options });
  const click = async selector => { documentRef.querySelector(selector).click(); await new Promise(resolve => setImmediate(resolve)); };
  const input = (selector, value) => { const node = documentRef.querySelector(selector); node.value = value; node.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  return { dom, doc: documentRef, data, view, click, input, get posts() { return posts; }, get posted() { return posted; }, fail: () => { fail = true; }, recover: () => { fail = false; } };
}

test('fluxo filtra fornecedor, oferece sextas e fim do mês e só submete após conferência', async t => {
  const h = harness(); t.after(() => { h.view.destroy(); h.dom.window.close(); }); await h.view.open();
  h.input('[type=search]', 'TESTE'); assert.equal(h.doc.querySelector('[data-breakdown-supplier="8"]').hidden, true);
  await h.click('[data-breakdown-supplier="7"]'); assert.equal(h.doc.querySelector('[type=month]').value, '2026-10');
  await h.click('[data-breakdown-next]'); assert.equal(h.doc.querySelectorAll('[data-breakdown-date]').length, 6);
  assert.equal(h.doc.querySelector('[data-breakdown-quantity="2026-10-02:salary"]').value, '1');
  h.input('[data-breakdown-quantity="2026-10-02:salary"]', '5'); h.input('[data-breakdown-value="2026-10-02:salary"]', '100');
  h.input('[data-breakdown-value="2026-10-31:thirteenth"]', '50');
  assert.equal(h.doc.querySelectorAll('.payroll-breakdown-rubric--selected').length, 2);
  assert.match(h.doc.querySelector('.payroll-breakdown-total').textContent, /550,00/);
  await h.click('[data-breakdown-next]'); assert.equal(h.posts, 0);
  assert.equal(h.doc.querySelectorAll('.payroll-breakdown-review article').length, 2);
  assert.match(h.doc.querySelector('[aria-label="Totais por rubrica"]').textContent, /Salário.*500,00.*13º salário.*50,00.*Total geral.*550,00/s);
  await h.click('[data-breakdown-edit]'); assert.equal(h.doc.querySelector('[data-breakdown-quantity="2026-10-02:salary"]').value, '5');
  await h.click('[data-breakdown-next]'); await h.click('[data-breakdown-submit]'); assert.equal(h.posts, 1);
  assert.match(h.doc.body.textContent, /Provisões criadas com sucesso/); assert.equal(h.dom.window.localStorage.length, 0);
  await h.click('[data-breakdown-done]'); assert.equal(h.dom.window.localStorage.length, 0);
  await h.view.open(); assert.ok(h.doc.querySelector('[data-breakdown-supplier="7"]'));
  assert.equal(h.doc.querySelector('[data-breakdown-submit]'), null);
});

test('trocar mês recalcula o calendário e voltar do calendário retorna à pergunta do mês', async t => {
  const h = harness(); t.after(() => { h.view.destroy(); h.dom.window.close(); }); await h.view.open(); await h.click('[data-breakdown-supplier="7"]');
  h.input('[type=month]', ''); await h.click('[data-breakdown-next]'); assert.equal(h.doc.querySelector('[role=alert]').hidden, false);
  h.input('[type=month]', '2024-02'); await h.click('[data-breakdown-next]');
  assert.equal(h.doc.querySelector('[role=alert]').hidden, true);
  assert.ok(h.doc.querySelector('[data-breakdown-date="2024-02-29"]')); assert.equal(h.doc.querySelectorAll('[data-breakdown-date]').length, 5);
  await h.click('[aria-label="Voltar"]'); assert.equal(h.doc.querySelector('[type=month]').value, '2024-02');
  h.input('[type=month]', '2026-07'); await h.click('[data-breakdown-next]');
  assert.equal(h.doc.querySelectorAll('[data-breakdown-date="2026-07-31"]').length, 1);
  await h.click('[data-breakdown-next]'); assert.match(h.doc.querySelector('[role=alert]').textContent, /pelo menos/);
});

test('total recolhido abre rubricas somadas entre datas e atualiza sem fechar ou postar', async t => {
  const h = harness(); t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await h.view.open(); await h.click('[data-breakdown-supplier="7"]'); await h.click('[data-breakdown-next]');
  const panel = h.doc.querySelector('details.payroll-breakdown-totals');
  assert.ok(panel, 'total deve ser expansível'); assert.equal(panel.open, false);
  h.input('[data-breakdown-value="2026-10-02:salary"]', '100');
  h.input('[data-breakdown-quantity="2026-10-09:salary"]', '2');
  h.input('[data-breakdown-value="2026-10-09:salary"]', '50');
  h.input('[data-breakdown-value="2026-10-02:award"]', '25,50');
  assert.match(panel.querySelector('summary').textContent, /Total geral.*225,50/);
  await h.click('.payroll-breakdown-totals > summary'); assert.equal(panel.open, true);
  const table = () => panel.querySelector('table').textContent;
  assert.match(table(), /Salário.*200,00.*Prêmio.*25,50/s);
  h.input('[data-breakdown-value="2026-10-09:salary"]', '75');
  assert.equal(panel.open, true); assert.match(table(), /Salário.*250,00/s);
  h.input('[data-breakdown-value="2026-10-02:award"]', '');
  assert.match(table(), /Prêmio.*0,00/s); assert.match(panel.querySelector('summary').textContent, /250,00/);
  h.input('[data-breakdown-value="2026-10-02:salary"]', 'inválido');
  assert.match(panel.textContent, /confira os valores/i); assert.equal(panel.querySelector('table'), null);
  h.input('[data-breakdown-value="2026-10-02:salary"]', '100');
  assert.match(table(), /Salário.*250,00/s); assert.equal(panel.open, true); assert.equal(h.posts, 0);
  await h.click('[data-breakdown-next]');
  assert.equal(h.doc.querySelector('details.payroll-breakdown-totals').open, false);
  await h.click('.payroll-breakdown-totals > summary'); assert.equal(h.posts, 0);
  await h.click('[data-breakdown-submit]');
  assert.equal(h.doc.querySelector('details.payroll-breakdown-totals').open, false);
  assert.match(h.doc.querySelector('.payroll-breakdown-totals summary').textContent, /250,00/);
});

test('falha no envio mantém o lote para retomada após recriar a tela e impede alteração', async t => {
  const h = harness(); let restored; t.after(() => { h.view.destroy(); restored?.destroy(); h.dom.window.close(); });
  await h.view.open(); await h.click('[data-breakdown-supplier="7"]'); await h.click('[data-breakdown-next]');
  h.input('[data-breakdown-value="2026-10-02:salary"]', '10'); await h.click('[data-breakdown-next]'); h.fail(); await h.click('[data-breakdown-submit]');
  assert.match(h.doc.querySelector('[role=alert]').textContent, /Rede/); assert.equal(h.dom.window.localStorage.length, 1);
  h.view.destroy(); h.recover();
  restored = createPayrollBreakdownView({ data: h.data, documentRef: h.doc, sessionKey: 'account', storage: h.dom.window.localStorage }); await restored.open();
  assert.equal(h.doc.querySelector('[aria-label="Voltar"]').disabled, true); assert.equal(h.doc.querySelector('[data-breakdown-submit]').textContent, 'Retomar envio');
  await h.click('[data-breakdown-submit]'); assert.equal(h.posts, 2); assert.match(h.doc.body.textContent, /Provisões criadas com sucesso/);
});

test('menu de provisões exibe atalho somente na pergunta atual', () => {
  const menu = { id: 'menu', role: 'assistant', type: 'poll', question: 'QUAL OPERAÇÃO DE PROVISÃO?', options: [{ id: 'action_payment', label: 'CRIAR UMA PROVISÃO' }, { id: 'action_recurring_expense', label: 'CRIAR UMA DESPESA RECORRENTE' }] };
  const state = { sessionStatus: 'authenticated', account: { name: 'Teste' }, draft: '', pendingFiles: [], messages: [menu] };
  assert.match(renderChatMarkup(state), /DESDOBRAR FOLHA DE PGTO/);
  const dom = new JSDOM(renderChatMarkup({ ...state, messages: [menu, { id: 'next', role: 'assistant', type: 'poll', question: 'Fornecedor?', options: [] }] }));
  assert.equal(dom.window.document.querySelector('[data-reply-id="action_payroll_provision_breakdown"]'), null); dom.window.close();
});
