import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { createAssetReportView } from '../src/ui/asset-report-view.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function report(id = '96') {
  return { assetId: id, asset: { id, fields: { IMOBILIZADO: 'GUINCHO DE TESTE' }, details: [
    { name: 'ITEM', label: 'IMOBILIZADO', value: 'GUINCHO DE TESTE', type: 'text' },
    { name: 'VALORRESIDUAL', label: 'Valor residual', value: 4723.9, type: 'currency' },
    { name: 'FUNCAO', label: 'FUNÇÃO', value: '<img src=x onerror=alert(1)>', type: 'text' },
    { name: 'PERCENTUAL', label: '% DEPRECIAÇÃO', value: 3, type: 'percentWhole' },
    { name: 'DATACOMPRA', label: 'Data compra', value: '2025-01-01T03:00:00Z', type: 'date' },
  ] }, historyTotal: 146.1, history: [
    { id: '275', fields: { IMOBILIZADO: '', FILIAL: 'FILIAL HISTÓRICA', 'ID IMOBILIZADO': Number(id), 'DATA DE DEPRECIAÇÃO': '2026-11-01T03:00:00Z',
      '% DEPRECIAÇÃO': 0.03, 'VALOR DEPRECIAÇÃO': 146.1, 'VALOR RESIDUAL': 4723.9, 'ID LANÇAMENTO': 4321 } },
    { id: '250', fields: { FILIAL: 'FILIAL HISTÓRICA', 'ID IMOBILIZADO': Number(id), 'DATA DE DEPRECIAÇÃO': '2026-10-01', '% DEPRECIAÇÃO': 0.03,
      'VALOR DEPRECIAÇÃO': 0, 'VALOR RESIDUAL': 4870, 'ID LANÇAMENTO': null } },
  ] };
}
function domFor(t) { const dom = new JSDOM('<!doctype html><body><section id="host"><button id="trigger">Bem</button><div id="background"></div></section></body>'); t.after(() => dom.window.close()); return dom; }

test('toque nos cartões das duas galerias usa o ID do bem e retorna à mesma página, busca e posição', async t => {
  for (const kind of ['assetLaunches', 'asset']) {
    const dom = domFor(t), doc = dom.window.document, calls = [];
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: String(kind === 'assetLaunches' ? 275 + i : 96 + i), hasAttachments: false,
      fields: { IMOBILIZADO: `GUINCHO DE TESTE ${i}`, 'ID IMOBILIZADO': 96 + i, FILIAL: 'FILIAL TESTE' } }));
    const gallery = createRegistrationGallery({ document: doc, kind, data: {
      async loadSnapshot() { return { rows }; }, async loadAssetReport(id) { calls.push(id); return report(id); },
    } }); t.after(() => gallery.destroy()); await gallery.open();
    const search = doc.querySelector('input[type="search"]'); search.value = 'GUINCHO'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const root = doc.querySelector('[data-gallery-kind]');
    [...doc.querySelectorAll('.rg-pagination button')].find(b => b.textContent === 'Próxima').click();
    root.scrollTop = 440;
    const trigger = root.querySelector('[data-asset-report-trigger]'); trigger.focus(); trigger.click(); await tick();
    const expectedId = kind === 'assetLaunches' ? '96' : '116';
    assert.deepEqual(calls, [expectedId]);
    const modal = doc.querySelector(`[data-asset-report="${expectedId}"]`); assert.ok(modal);
    assert.match(modal.textContent, /Dados cadastrais/); assert.match(modal.textContent, /Histórico de depreciação/);
    assert.ok(modal.textContent.indexOf('Dados cadastrais') < modal.textContent.indexOf('Histórico de depreciação'));
    assert.match(modal.textContent, /4\.723,90/); assert.match(modal.textContent, /146,10/); assert.match(modal.textContent, /01\/11\/2026/);
    assert.match(modal.textContent, /3%/); assert.doesNotMatch(modal.textContent, /300%/);
    assert.equal(modal.querySelector('img'), null); assert.match(modal.textContent, /<img src=x/);
    assert.equal(modal.querySelectorAll('[data-asset-history-row]').length, 2);
    assert.equal(modal.querySelector('[data-asset-history-row="250"] [data-history-financial-id]').textContent, '—');
    assert.match(modal.querySelector('[data-asset-history-row="275"] [data-history-financial-id]').textContent, /4321/);
    modal.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(doc.querySelector('[data-asset-report]'), null); assert.equal(root.hidden, false);
    assert.equal(search.value, 'GUINCHO'); assert.match(root.querySelector('.rg-pagination').textContent, /Página 2 de 2/);
    assert.equal(root.scrollTop, 440); assert.equal(doc.activeElement, trigger);
  }
});

test('anexos e editar permanecem independentes do relatório no cadastro', async t => {
  const dom = domFor(t), doc = dom.window.document; let reads = 0, attachments = 0, edits = 0;
  const gallery = createRegistrationGallery({ document: doc, kind: 'asset', data: {
    async loadSnapshot() { return { rows: [{ id: '96', hasAttachments: true, fields: { IMOBILIZADO: 'GUINCHO' } }] }; },
    async loadAssetReport() { reads++; return report(); },
    async listAttachments() { attachments++; return []; }, async downloadAttachment() {},
    async loadEditor() { edits++; throw new Error('Teste de editor'); },
  } }); t.after(() => gallery.destroy()); await gallery.open();
  await tick(); const beforeAttachments = attachments;
  doc.querySelector('[data-action="registration-attachments"]').click(); await tick();
  assert.equal(attachments, beforeAttachments + 1); assert.equal(reads, 0);
  doc.querySelector('[data-gallery-action="edit"]').click(); await tick();
  assert.equal(edits, 1); assert.equal(reads, 0); assert.equal(doc.querySelector('[data-asset-report]'), null);
});

test('Tab alcança o cartão nas duas galerias e Enter abre o relatório correto', async t => {
  for (const kind of ['asset', 'assetLaunches']) {
    const dom = domFor(t), doc = dom.window.document, calls = [];
    const gallery = createRegistrationGallery({ document: doc, kind, data: {
      async loadSnapshot() { return { rows: [{ id: kind === 'asset' ? '96' : '275', hasAttachments: false, fields: { IMOBILIZADO: 'GUINCHO', 'ID IMOBILIZADO': 96 } }] }; },
      async loadAssetReport(id) { calls.push(id); return report(id); },
    } }); t.after(() => gallery.destroy()); await gallery.open();
    const previous = doc.querySelector('summary'); previous.focus();
    const trigger = doc.querySelector('[data-asset-report-trigger]');
    for (let tabs = 0; tabs < 20 && doc.activeElement !== trigger; tabs++) doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(doc.activeElement, trigger);
    trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick();
    assert.deepEqual(calls, ['96']); assert.ok(doc.querySelector('[data-asset-report="96"]'));
  }
});

test('modal cancela respostas antigas, refaz o mesmo bem após erro e não confunde ausência de histórico com falha', async t => {
  const dom = domFor(t), doc = dom.window.document, host = doc.querySelector('#host'), background = doc.querySelector('#background'), trigger = doc.querySelector('#trigger');
  const pending = [], calls = [];
  const modal = createAssetReportView({ document: doc, host, background: [background], loadReport(id, options) {
    calls.push({ id, signal: options.signal }); return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  } }); t.after(() => modal.destroy());
  modal.open('96', trigger); assert.equal(background.inert, true);
  modal.open('95', trigger); assert.equal(calls[0].signal.aborted, true);
  pending[0].resolve(report('96')); await tick(); assert.equal(doc.querySelector('[data-asset-report="96"]'), null);
  pending[1].reject(new Error('Falha na página 2')); await tick();
  assert.ok(doc.querySelector('[role="alert"]')); assert.equal(doc.querySelector('[data-asset-report-empty]'), null);
  doc.querySelector('[data-action="retry-asset-report"]').click();
  assert.equal(calls.at(-1).id, '95'); const empty = report('95'); empty.history = []; empty.historyTotal = 0;
  pending[2].resolve(empty); await tick(); assert.match(doc.querySelector('[data-asset-report-empty]').textContent, /Nenhuma depreciação/);
  modal.close(); assert.equal(background.inert, false); assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  modal.open('96', trigger); modal.close(); assert.equal(calls.at(-1).signal.aborted, true);
  pending[3].resolve(report()); await tick(); assert.equal(doc.querySelector('[data-asset-report]'), null);
});

test('timeout permite tentar novamente; Escape e Tab ficam no relatório; resposta de outro bem é recusada', async t => {
  const dom = domFor(t), doc = dom.window.document, host = doc.querySelector('#host'), trigger = doc.querySelector('#trigger');
  const modal = createAssetReportView({ document: doc, host, background: [], timeoutMs: 15, loadReport: () => new Promise(() => {}) }); t.after(() => modal.destroy());
  modal.open('96', trigger); await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(doc.querySelector('[role="alert"]').textContent, /demorou/);
  const close = doc.querySelector('[data-action="close-asset-report"]'), retry = doc.querySelector('[data-action="retry-asset-report"]');
  retry.focus(); retry.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); assert.equal(doc.activeElement, close);
  close.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); assert.equal(doc.activeElement, retry);
  modal.close();
  const wrong = createAssetReportView({ document: doc, host, background: [], loadReport: async () => report('95') }); t.after(() => wrong.destroy());
  wrong.open('96', trigger); await tick(); assert.ok(doc.querySelector('[role="alert"]')); assert.equal(doc.querySelector('[data-asset-history-row]'), null);
});

test('fechar ou atualizar a galeria aborta o relatório pendente', async t => {
  const dom = domFor(t), doc = dom.window.document; const signals = [];
  const gallery = createRegistrationGallery({ document: doc, kind: 'assetLaunches', data: {
    async loadSnapshot() { return { rows: [{ id: '275', fields: { IMOBILIZADO: 'GUINCHO', 'ID IMOBILIZADO': 96 } }] }; },
    loadAssetReport(_id, { signal }) { signals.push(signal); return new Promise(() => {}); },
  } }); t.after(() => gallery.destroy()); await gallery.open();
  doc.querySelector('[data-asset-report-trigger]').click(); gallery.close(); assert.equal(signals[0].aborted, true);
  await gallery.open(); doc.querySelector('[data-asset-report-trigger]').click(); await gallery.open(); assert.equal(signals[1].aborted, true);
});
