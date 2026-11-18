import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createStageGanttView } from '../src/ui/stage-gantt-view.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const snapshot = { complete: true,
  launches: [{ id: '1', branch: 'Xavante', stage: 'Estrutura', type: 'ATIVIDADE COMUM',
    status: 'INICIADO', startDate: '2026-11-01' }],
  activities: [{ id: '129', branch: 'Xavante', stage: 'Estrutura', activity: 'Paredes',
    property: 'Todos', supplier: 'Edgar', status: 'ATIVIDADE INICIADA', executionDate: '2026-11-02' }],
};
const detail = { complete: true, rows: [
  { id: '1', activityId: '129', date: '2026-11-02', supplier: '<João>', profession: 'PEDREIRO' },
  { id: '2', activityId: '129', date: '2026-11-04', supplier: '<João>', profession: 'PEDREIRO' },
] };

function setup(t, loadAssignments, extra = {}) {
  const dom = new JSDOM('<!doctype html><main id="app"></main>');
  const view = createStageGanttView({ document: dom.window.document, data: {
    loadSnapshot: async () => snapshot, loadAssignments, ...extra,
  }});
  t.after(() => { view.destroy(); dom.window.close(); });
  return { view, doc: dom.window.document, win: dom.window };
}

test('barra abre profissões, mais mostra pessoas com dias e datas, Escape retorna à barra', async t => {
  const calls = [];
  const { view, doc, win } = setup(t, async selection => { calls.push(selection); return detail; });
  await view.open();
  assert.equal(calls.length, 0);
  view.element.querySelector('.gantt-toggle').click();
  const bar = view.element.querySelector('.gantt-row--activity .gantt-bar');
  bar.focus(); bar.click(); await tick();
  const popup = view.element.querySelector('.gantt-detail-backdrop');
  assert.equal(popup.hidden, false);
  assert.deepEqual(calls, [{ branch: 'Xavante', activityIds: ['129'] }]);
  assert.equal(view.element.querySelector('.gantt-dialog').inert, true);
  assert.match(popup.textContent, /PEDREIRO2 dias/);
  const toggle = popup.querySelector('.gantt-profession-toggle');
  assert.equal(toggle.textContent, '+');
  assert.equal(popup.querySelector('.gantt-people').hidden, true);
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...popup.querySelectorAll('tbody td')].map(node => node.textContent),
    ['<João>', '2', '02/11/2026', '04/11/2026']);
  assert.equal(popup.querySelector('joão'), null);
  toggle.click();
  assert.equal(popup.querySelector('.gantt-people').hidden, true);
  popup.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(popup.hidden, true);
  assert.equal(view.element.hidden, false);
  assert.equal(doc.activeElement, bar);
});

test('falha permite repetir e fechar ignora resposta atrasada sem alterar o gráfico', async t => {
  let resolve, signal, reads = 0;
  const { view } = setup(t, async (_selection, options) => {
    signal = options.signal;
    if (++reads === 1) throw new Error('network');
    if (reads === 2) return new Promise(done => { resolve = done; });
    return { complete: true, rows: [] };
  });
  await view.open();
  view.element.querySelector('.gantt-toggle').click();
  const bar = view.element.querySelector('.gantt-row--activity .gantt-bar');
  const scroll = view.element.querySelector('.gantt-scroll');
  scroll.scrollLeft = 120;
  bar.click(); await tick();
  const popup = view.element.querySelector('.gantt-detail-backdrop');
  popup.querySelector('.gantt-detail-retry').click(); await tick();
  popup.querySelector('.gantt-detail-close').click();
  assert.equal(signal.aborted, true);
  bar.click(); await tick();
  assert.match(popup.textContent, /Nenhuma presença/);
  resolve(detail); await tick();
  assert.match(popup.textContent, /Nenhuma presença/);
  assert.equal(scroll.scrollLeft, 120);
  view.close();
  assert.equal(popup.hidden, true);
  assert.equal(view.element.querySelector('.gantt-dialog').inert, false);
});

test('etapa oferece duas análises antes de consultar; profissão mantém seleção e descritivo não pergunta', async t => {
  const calls = [];
  const { view } = setup(t, async selection => { calls.push(selection); return detail; });
  await view.open();
  view.element.querySelector('.gantt-row--stage .gantt-bar').click(); await tick();
  const popup = view.element.querySelector('.gantt-detail-backdrop');
  assert.equal(calls.length, 0);
  assert.ok(popup.querySelector('[data-analysis="professions"]'));
  assert.ok(popup.querySelector('[data-analysis="cost"]'));
  popup.querySelector('[data-analysis="professions"]').click(); await tick();
  assert.equal(calls.length, 1); assert.match(popup.textContent, /PEDREIRO/);
  popup.querySelector('.gantt-detail-back').click();
  assert.equal(calls.length, 1);
  assert.ok(popup.querySelector('[data-analysis="cost"]'));
});

const costs = { launches: [
  { id: '1', branch: 'Xavante', stage: 'Estrutura', paymentDate: '2025-01-10', total: 10, product: 'Concreto' },
  { id: '2', branch: 'Xavante', stage: 'Estrutura', paymentDate: '2026-02-10', total: 200, product: 'Concreto' },
], provisions: [{ id: '3', branch: 'Xavante', stage: 'Estrutura', dueDate: '2026-02-15', total: 50, product: 'Concreto' }],
productTypes: [{ product: 'Concreto', expenseType: 'MATERIAL' }] };

test('custo abre pago/previsto por período e trocar filtros recalcula sem nova leitura', async t => {
  let reads = 0;
  const { view, doc, win } = setup(t, async () => detail, { loadCostSnapshot: async () => { reads++; return costs; } });
  await view.open();
  const bar = view.element.querySelector('.gantt-row--stage .gantt-bar'); bar.click();
  const popup = view.element.querySelector('.gantt-detail-backdrop');
  popup.querySelector('[data-analysis="cost"]').click(); await tick();
  assert.equal(reads, 1);
  const year = popup.querySelector('select[name="year"]'), month = popup.querySelector('select[name="month"]');
  assert.deepEqual([...year.options].map(n => n.value), ['2026', '2025']);
  assert.deepEqual([...month.options].map(n => n.value), ['', '2']);
  assert.match(popup.querySelector('[data-cost-total="paid"]').textContent, /200,00/);
  assert.match(popup.querySelector('[data-cost-total="forecast"]').textContent, /50,00/);
  popup.querySelector('.gantt-cost-toggle').click();
  assert.match(popup.querySelector('.gantt-cost-product').textContent, /Concreto/);
  year.value = '2025'; year.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.deepEqual([...popup.querySelector('select[name="month"]').options].map(n => n.value), ['', '1']);
  assert.match(popup.querySelector('[data-cost-total="total"]').textContent, /10,00/);
  assert.equal(reads, 1);
  popup.querySelector('.gantt-detail-close').click(); assert.equal(doc.activeElement, bar);
});

test('custo falho permite repetir; voltar cancela e descarta resposta antiga', async t => {
  let reads = 0, finish, signal;
  const { view } = setup(t, async () => detail, { loadCostSnapshot: async options => {
    signal = options.signal;
    if (++reads === 1) throw new Error('network');
    return new Promise(resolve => { finish = resolve; });
  } });
  await view.open(); view.element.querySelector('.gantt-row--stage .gantt-bar').click();
  const popup = view.element.querySelector('.gantt-detail-backdrop');
  popup.querySelector('[data-analysis="cost"]').click(); await tick();
  popup.querySelector('.gantt-detail-retry').click(); await tick();
  popup.querySelector('.gantt-detail-back').click();
  assert.equal(signal.aborted, true);
  finish(costs); await tick();
  assert.ok(popup.querySelector('[data-analysis="cost"]'));
  assert.equal(popup.querySelector('select'), null);
});
