import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStageGantt } from '../src/chat/stage-progress-model.js';

const launch = (id, branch, stage, status, startDate, endDate = '', type = 'ATIVIDADE COMUM') =>
  ({ id, branch, stage, status, startDate, endDate, type });
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
  assert.deepEqual(stages.map(row => row.branch), ['Obra B', 'Obra A', 'Obra C']);
  const [b, a, c] = stages;
  assert.deepEqual(a.range, { start: '2026-11-02', end: '2026-11-16', throughToday: true, tone: 'ongoing' });
  assert.deepEqual(a.children.map(row => [row.name, row.range]), [
    ['Escavação', { start: '2026-11-05', end: '2026-11-16', throughToday: true, tone: 'ongoing' }],
    ['Blocos', { start: '2026-11-06', end: '2026-11-15', throughToday: false, tone: 'ongoing' }],
    ['Armação', null],
  ]);
  assert.equal(b.range.tone, 'finished');
  assert.deepEqual(b.children.map(row => [row.name, row.range.tone]), [['Concreto', 'finished']]);
  assert.equal(c.range, null);
  assert.deepEqual(c.children, []);
});

test('GANTT ordena pelo início mesmo sem barra e preserva desempates e dados de origem', () => {
  const snapshot = { complete: true, launches: [
    launch(1, 'Obra A', 'A sem início', 'NÃO INICIADO', ''),
    launch(2, 'Obra A', 'B posterior', 'INICIADO', '2026-11-10'),
    launch(3, 'Obra A', 'C anterior sem fim', 'FINALIZADO', '2026-01-02'),
    launch(4, 'Obra A', 'D mesma data', 'INICIADO', '02/01/2026'),
  ], activities: [
    activity(1, 'Obra A', 'B posterior', 'A sem início', 'ATIVIDADE NÃO INICIADA', ''),
    activity(2, 'Obra A', 'B posterior', 'B posterior', 'ATIVIDADE INICIADA', '2026-11-12'),
    activity(3, 'Obra A', 'B posterior', 'C anterior', 'ATIVIDADE FINALIZADA', '03/01/2026'),
    activity(4, 'Obra A', 'B posterior', 'D mesma data', 'ATIVIDADE INICIADA', '2026-01-03'),
  ] };
  const original = structuredClone(snapshot);
  const stages = buildStageGantt(snapshot, '2026-11-16');
  assert.deepEqual(stages.map(row => row.name), ['C anterior sem fim', 'D mesma data', 'B posterior', 'A sem início']);
  assert.deepEqual(stages[2].children.map(row => row.name), ['C anterior', 'D mesma data', 'B posterior', 'A sem início']);
  assert.equal(stages[0].range, null);
  assert.deepEqual(snapshot, original);
});

test('GANTT não converte data ausente ou anterior ao início em barra finalizada', () => {
  const [stage] = buildStageGantt({ complete: true,
    launches: [launch(1, 'Obra A', 'Fundação', 'FINALIZADO', '2026-11-06')],
    activities: [activity(1, 'Obra A', 'Fundação', 'Escavação', 'ATIVIDADE FINALIZADA', '2026-11-08', '2026-11-01')],
  }, '2026-11-16');
  assert.equal(stage.range, null);
  assert.equal(stage.children[0].range, null);
});

test('GANTT usa o TIPO da etapa por filial e exclui fantasmas antes de escolher o lançamento', () => {
  const stageName = 'DESPESAS COM CORRETAGEM';
  const stages = buildStageGantt({ complete: true,
    launches: [
      launch(1, 'Xavante', stageName, 'INICIADO', '2026-11-01', '', ' atividade comum '),
      launch(2, 'Xavante', stageName, 'INICIADO', '2026-11-02', '', 'ATIVIDADE FANTASMA'),
      launch(3, 'Ouro Preto', stageName, 'INICIADO', '2026-11-03', '', 'ATIVIDADE FANTASMA'),
      launch(4, 'Xavante', 'DESPESAS COM VIGILANCIA E MEDIÇÃO', 'NÃO INICIADO', '', '', 'ATIVIDADE FANTASMA'),
      launch(5, 'Xavante', 'Sem classificação', 'NÃO INICIADO', '', '', ''),
    ],
    activities: [
      activity(1, 'XAVANTE', stageName.toLowerCase(), 'Atendimento', 'ATIVIDADE INICIADA', '2026-11-01'),
      activity(2, 'Ouro Preto', stageName, 'Atendimento', 'ATIVIDADE INICIADA', '2026-11-03'),
      activity(3, 'Xavante', 'Sem etapa correspondente', 'Demonstrativo avulso', 'ATIVIDADE INICIADA', '2026-11-05'),
    ],
  }, '2026-11-16');
  assert.deepEqual(stages.map(row => [row.branch, row.name, row.start, row.children.map(child => child.name)]),
    [['Xavante', stageName, '2026-11-01', ['Atendimento']]]);
});
