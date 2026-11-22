import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createStageGanttView } from '../src/ui/stage-gantt-view.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, overrides = {}) {
  const dom = new JSDOM('<!doctype html>');
  const snapshot = { complete: true,
    launches: [{ id: '7', branch: 'Obra A', stage: 'Fundação', type: 'ATIVIDADE COMUM', status: 'INICIADO', startDate: '2026-11-01', endDate: '', percent: null }],
    activities: [
      { id: '129', branch: 'Obra A', stage: 'Fundação', activity: 'Escavação', property: '', supplier: 'João', status: 'ATIVIDADE INICIADA', executionDate: '2026-11-02', plannedDate: '' },
      { id: '130', branch: 'Obra A', stage: 'Fundação', activity: 'Concreto', property: '', supplier: 'João', status: 'ATIVIDADE FINALIZADA', executionDate: '2026-11-03', plannedDate: '2026-11-17' },
    ],
  };
  const writes = [];
  const data = {
    loadSnapshot: async () => snapshot,
    loadAssignments: async () => ({ complete: true, rows: [
      { id: '1', date: '2026-11-04', supplier: 'João', profession: 'PEDREIRO' },
      { id: '2', date: '2026-11-12', supplier: 'João', profession: 'PEDREIRO' },
      { id: '3', date: '2026-11-08', supplier: 'João', profession: 'PEDREIRO' },
    ] }),
    finalizeActivity: async (id, date, options) => {
      writes.push({ id, date, options });
      return { ...snapshot.activities.find(row => row.id === id), plannedDate: date, status: 'ATIVIDADE FINALIZADA' };
    },
    finalizeStage: async (id, date, options) => {
      writes.push({ id, date, options });
      return { ...snapshot.launches[0], endDate: date, status: 'FINALIZADO' };
    },
    startStage: async (id, date, options) => {
      writes.push({ id, date, options });
      return { ...snapshot.launches[0], startDate: date, status: 'INICIADO' };
    },
    startActivity: async (id, date, options) => {
      writes.push({ id, date, options });
      return { ...snapshot.activities.find(row => row.id === id), executionDate: date, status: 'ATIVIDADE INICIADA' };
    }, ...overrides,
  };
  const view = createStageGanttView({ document: dom.window.document, data, now: () => new Date(2026, 10, 18) });
  t.after(() => { view.destroy(); dom.window.close(); });
  const root = view.element;
  const submit = () => root.querySelector('.gantt-finish-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  return { view, root, snapshot, writes, submit };
}

for (const kind of ['stage', 'activity']) test(`inicia ${kind} informando a data e atualiza a barra do Gantt`, async t => {
  const h = fixture(t, { loadAssignments: () => assert.fail('Iniciar não consulta presença') });
  const row = kind === 'stage' ? h.snapshot.launches[0] : h.snapshot.activities[0];
  row.status = kind === 'stage' ? 'NÃO INICIADO' : 'ATIVIDADE NÃO INICIADA';
  if (kind === 'stage') row.startDate = '';
  else row.executionDate = '';
  await h.view.open();
  if (kind === 'activity') h.root.querySelector('.gantt-toggle').click();
  const findRow = () => [...h.root.querySelectorAll(`.gantt-row--${kind}`)]
    .find(node => node.querySelector('.gantt-name').textContent === (row.activity || row.stage));
  const start = findRow().querySelector('button[aria-label^="Iniciar"]');
  assert.ok(start);
  const finish = findRow().querySelector('.gantt-finish-button');
  assert.equal(start.nextElementSibling, finish);
  assert.equal(finish.disabled, true);
  assert.equal(findRow().querySelector('.gantt-bar'), null);
  start.click();
  const input = h.root.querySelector('input[type=date]');
  assert.match(input.parentElement.textContent, /Data de início/);
  assert.equal(input.value, '');
  h.submit();
  assert.equal(h.writes.length, 0);
  input.value = '2026-11-10';
  h.submit(); h.submit(); await tick();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].id, row.id);
  assert.equal(h.writes[0].date, '2026-11-10');
  assert.deepEqual(h.writes[0].options[kind === 'stage' ? 'expectedStage' : 'expectedActivity'], row);
  assert.equal(findRow().querySelector('button[aria-label^="Iniciar"]'), null);
  assert.equal(findRow().querySelector('.gantt-bar').dataset.tone, 'ongoing');
  assert.equal(findRow().querySelector('.gantt-bar-date--start').textContent, '10/11/2026');
});

test('retoma o início no Gantt com a data escolhida sem enviar automaticamente', async t => {
  const h = fixture(t, { loadAssignments: () => assert.fail('Iniciar não consulta presença') });
  h.snapshot.activities[0].status = 'ATIVIDADE NÃO INICIADA';
  h.snapshot.activities[0].branch = 'OBRA A';
  await h.view.open({ finishDraft: { id: '129', date: '2026-11-09', operation: 'start' } });
  assert.equal(h.root.querySelector('select').value, 'Obra A');
  assert.equal(h.root.querySelector('.gantt-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(h.root.querySelector('.gantt-finish-overlay').hidden, false);
  assert.match(h.root.querySelector('.gantt-finish-form h2').textContent, /Iniciar atividade/);
  assert.equal(h.root.querySelector('input').value, '2026-11-09');
  assert.equal(h.writes.length, 0);
});

test('finaliza o descritivo com data sugerida pela última presença e permite editar antes de salvar', async t => {
  let selection;
  const h = fixture(t, { loadAssignments: async value => {
    selection = value;
    return { complete: true, rows: [
      { id: '1', date: '2026-11-04', supplier: 'João', profession: '' },
      { id: '2', date: '2026-11-12', supplier: 'João', profession: '' },
    ] };
  } });
  await h.view.open(); h.root.querySelector('.gantt-toggle').click();
  const row = h.root.querySelector('.gantt-row--activity');
  const completed = h.root.querySelectorAll('.gantt-row--activity')[1];
  assert.equal(completed.querySelector('.gantt-finish-button'), null);
  assert.equal(completed.querySelector('.gantt-cluster--description').dataset.tone, 'finished');
  const cluster = row.querySelector('.gantt-cluster--description');
  assert.equal(cluster.dataset.tone, 'ongoing');
  const finish = row.querySelector('.gantt-finish-button');
  assert.ok(cluster.contains(finish), 'o botão pertence ao mesmo cartão do descritivo');
  assert.equal(cluster.querySelector('.gantt-name').textContent, 'Escavação');
  assert.doesNotMatch(row.querySelector('.gantt-label').textContent, /Parte de:/);
  finish.click(); await tick();
  assert.deepEqual(selection, { branch: 'Obra A', activityIds: ['129'] });
  const input = h.root.querySelector('input[type=date]');
  assert.equal(input.value, '2026-11-12'); assert.equal(h.writes.length, 0);
  input.value = '2026-11-13'; h.submit(); h.submit(); await tick();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].date, '2026-11-13');
  assert.deepEqual(h.writes[0].options.expectedActivity, { ...h.snapshot.activities[0] });
  const updated = h.root.querySelector('.gantt-row--activity');
  assert.equal(updated.querySelector('.gantt-bar').dataset.tone, 'finished');
  assert.equal(updated.querySelector('.gantt-bar-date--end').textContent, '13/11/2026');
  assert.equal(updated.querySelector('.gantt-finish-button'), null);
  assert.equal(updated.querySelector('.gantt-cluster--description').dataset.tone, 'finished');
});

test('etapa consulta todos os descritivos e usa presença em vez da data fim dos filhos', async t => {
  const selections = [];
  const h = fixture(t, { loadAssignments: async value => {
    selections.push(value);
    return { complete: true, rows: [{ id: '1', date: '2026-11-12', supplier: 'João', profession: '' }] };
  } });
  h.snapshot.activities[0].status = 'ATIVIDADE FINALIZADA';
  h.snapshot.activities[0].plannedDate = '2026-11-15';
  await h.view.open();
  const finish = h.root.querySelector('.gantt-row--stage .gantt-finish-button');
  assert.ok(finish); assert.equal(finish.disabled, false);
  finish.click(); await tick();
  assert.deepEqual(selections, [{ branch: 'Obra A', activityIds: ['129', '130'] }]);
  assert.equal(h.root.querySelector('input').value, '2026-11-12');
  h.submit(); await tick();
  assert.equal(h.writes[0].id, '7');
  assert.equal(h.writes[0].options.expectedStage.id, '7');
  assert.equal(h.root.querySelector('.gantt-row--stage .gantt-bar').dataset.tone, 'finished');
  assert.equal(h.root.querySelector('.gantt-row--stage .gantt-finish-button'), null);
  assert.equal(h.root.querySelector('.gantt-row--stage .gantt-cluster--description').dataset.tone, 'finished');
});

test('etapa pendente mantém botão desabilitado e cancelar ignora consulta atrasada', async t => {
  let resolve, signal;
  const h = fixture(t, { loadAssignments: (_selection, options) => {
    signal = options.signal;
    return new Promise(done => { resolve = done; });
  } });
  await h.view.open();
  assert.equal(h.root.querySelector('.gantt-finish-button')?.disabled, true);
  h.root.querySelector('.gantt-toggle').click();
  const trigger = h.root.querySelector('.gantt-row--activity .gantt-finish-button');
  trigger.click();
  assert.equal(h.root.querySelector('input').disabled, true);
  h.root.querySelector('.gantt-finish-cancel').click();
  assert.equal(signal.aborted, true);
  resolve({ complete: true, rows: [] }); await tick();
  assert.equal(h.root.querySelector('.gantt-finish-overlay').hidden, true);
  assert.equal(h.writes.length, 0);
  assert.equal(h.root.ownerDocument.activeElement, trigger);
});

for (const response of ['empty', 'failure', 'partial']) test(`consulta ${response} deixa data vazia para preenchimento manual`, async t => {
  const h = fixture(t, { loadAssignments: async () => {
    if (response === 'failure') throw new Error('offline');
    return { complete: response !== 'partial', rows: [] };
  } });
  await h.view.open(); h.root.querySelector('.gantt-toggle').click();
  h.root.querySelector('.gantt-row--activity .gantt-finish-button').click(); await tick();
  const input = h.root.querySelector('input');
  assert.equal(input.value, ''); assert.equal(input.disabled, false);
  h.submit(); await tick(); assert.equal(h.writes.length, 0);
  input.value = '2026-11-10'; h.submit(); await tick(); assert.equal(h.writes.length, 1);
});

test('retoma o item e a data do consentimento sem enviar automaticamente', async t => {
  const h = fixture(t, { loadAssignments: () => assert.fail('não substitui a data escolhida') });
  await h.view.open({ finishDraft: { id: '129', date: '2026-11-09' } });
  assert.equal(h.root.querySelector('.gantt-finish-overlay')?.hidden, false);
  assert.equal(h.root.querySelector('input').value, '2026-11-09');
  assert.equal(h.writes.length, 0);
});

test('retomada do consentimento seleciona a filial do item recuperado', async t => {
  const h = fixture(t);
  h.snapshot.launches.push({ ...h.snapshot.launches[0], id: '8', branch: '004 - EDIFÍCIO XAVANTE' });
  await h.view.open({ finishDraft: { id: '129', date: '2026-11-09' } });
  assert.equal(h.root.querySelector('select').value, 'Obra A');
  assert.match(h.root.querySelector('.gantt-row--stage .gantt-name').textContent, /Fundação/);
});

test('falha de concorrência conserva a data editada e não mostra finalização', async t => {
  const h = fixture(t, { finalizeActivity: async () => { throw Object.assign(new Error('changed'), { status: 412 }); } });
  await h.view.open(); h.root.querySelector('.gantt-toggle').click();
  h.root.querySelector('.gantt-row--activity .gantt-finish-button').click(); await tick();
  h.root.querySelector('input').value = '2026-11-10'; h.submit(); await tick();
  assert.equal(h.root.querySelector('.gantt-finish-overlay').hidden, false);
  assert.equal(h.root.querySelector('input').value, '2026-11-10');
  assert.match(h.root.querySelector('.gantt-finish-form [role=status]').textContent, /mudou no SharePoint/);
  assert.equal(h.root.querySelector('.gantt-row--activity .gantt-bar').dataset.tone, 'ongoing');
});
