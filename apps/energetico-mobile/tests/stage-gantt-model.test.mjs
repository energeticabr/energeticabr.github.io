import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStageGantt } from '../src/chat/stage-progress-model.js';

const launch = (id, branch, stage, status, startDate, endDate = '') => ({ id, branch, stage, status, startDate, endDate });
const activity = (id, branch, stage, activity, status, executionDate, plannedDate = '') =>
  ({ id, branch, stage, activity, status, executionDate, plannedDate, property: '', supplier: '' });

test('GANTT mantém as etapas sem demonstrativos e vincula cada atividade à sua filial e etapa', () => {
  const stages = buildStageGantt({
    complete: true,
    launches: [
      launch(1, 'Obra A', 'Fundação', 'INICIADO', '2026-11-02'),
      launch(2, 'Obra B', 'Fundação', 'FINALIZADO', '2026-11-01', '2026-11-03'),
      launch(3, 'Obra C', 'Pintura', 'NÃO INICIADO', ''),
    ],
    activities: [
      activity(4, 'OBRA A', 'Fundacao', 'Escavação', 'ATIVIDADE INICIADA', '05/11/2026'),
      activity(5, 'Obra B', 'Fundação', 'Concreto', 'ATIVIDADE FINALIZADA', '2026-11-02', '2026-11-02'),
      activity(6, 'Obra A', 'Fundação', 'Blocos', 'ATIVIDADE INICIADA', '2026-11-06', '2026-11-15'),
      activity(7, 'Obra A', 'Fundação', 'Armação', 'ATIVIDADE NÃO INICIADA', ''),
    ],
  }, '2026-11-16');
  assert.equal(stages.length, 3);
  const [a, b, c] = stages;
  assert.deepEqual(a.range, { start: '2026-11-02', end: '2026-11-16', throughToday: true, tone: 'ongoing' });
  assert.deepEqual(a.children.map(row => [row.name, row.range]), [
    ['Armação', null],
    ['Escavação', { start: '2026-11-05', end: '2026-11-16', throughToday: true, tone: 'ongoing' }],
    ['Blocos', { start: '2026-11-06', end: '2026-11-15', throughToday: false, tone: 'ongoing' }],
  ]);
  assert.equal(b.range.tone, 'finished');
  assert.deepEqual(b.children.map(row => [row.name, row.range.tone]), [['Concreto', 'finished']]);
  assert.equal(c.range, null);
  assert.deepEqual(c.children, []);
});

test('GANTT não converte data ausente ou anterior ao início em barra finalizada', () => {
  const [stage] = buildStageGantt({ complete: true,
    launches: [launch(1, 'Obra A', 'Fundação', 'FINALIZADO', '2026-11-06')],
    activities: [activity(1, 'Obra A', 'Fundação', 'Escavação', 'ATIVIDADE FINALIZADA', '2026-11-08', '2026-11-01')],
  }, '2026-11-16');
  assert.equal(stage.range, null);
  assert.equal(stage.children[0].range, null);
});
