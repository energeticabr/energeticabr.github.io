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

function setup(t, loadAssignments) {
  const dom = new JSDOM('<!doctype html><main id="app"></main>');
  const view = createStageGanttView({ document: dom.window.document, data: {
    loadSnapshot: async () => snapshot, loadAssignments,
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
  const bar = view.element.querySelector('.gantt-bar');
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
