import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGanttProfessionDetail } from '../src/chat/stage-gantt-detail-model.js';

test('dias por profissão somam datas de cada pessoa sem duplicar demonstrativos da etapa', () => {
  const row = (id, activityId, date, supplier, profession) => ({ id, activityId, date, supplier, profession });
  const detail = buildGanttProfessionDetail({ complete: true, rows: [
    row('1', '19', '2026-11-01', ' João Silva ', 'PEDREIRO'),
    row('2', '19', '2026-11-03', 'João Silva', 'Pedreiro'),
    row('3', '20', '2026-11-03', 'JOAO SILVA', 'PEDREIRO'),
    row('4', '19', '2026-11-03', 'José Santos', 'PEDREIRO'),
    row('5', '19', '2026-11-02', 'Ana', 'SERVENTE'),
    row('6', '19', '2026-11-02', 'Bia', ''),
  ] });
  assert.equal(detail.days, 5);
  const bricklayers = detail.professions.find(item => item.name === 'PEDREIRO');
  assert.equal(bricklayers.days, 3);
  assert.deepEqual(bricklayers.people, [
    { name: 'João Silva', days: 2, firstDate: '2026-11-01', lastDate: '2026-11-03' },
    { name: 'José Santos', days: 1, firstDate: '2026-11-03', lastDate: '2026-11-03' },
  ]);
  assert.equal(detail.professions.find(item => item.name === 'SEM PROFISSÃO').days, 1);
});

test('pessoas aparecem das mais presentes para as menos presentes, com desempate pelo nome', () => {
  let id = 0;
  const rows = [
    ['Ana', ['2026-11-02']],
    ['Zélia', ['2026-11-01', '2026-11-03', '2026-11-02']],
    ['Márcio', ['2026-11-01', '2026-11-02']],
    ['João', ['2026-11-03', '2026-11-01', '2026-11-01']],
  ].flatMap(([supplier, dates]) => dates.map(date => ({
    id: String(++id), activityId: '19', supplier, profession: 'PEDREIRO', date,
  })));
  const detail = buildGanttProfessionDetail({ complete: true, rows });
  assert.deepEqual(detail.professions[0].people, [
    { name: 'Zélia', days: 3, firstDate: '2026-11-01', lastDate: '2026-11-03' },
    { name: 'João', days: 2, firstDate: '2026-11-01', lastDate: '2026-11-03' },
    { name: 'Márcio', days: 2, firstDate: '2026-11-01', lastDate: '2026-11-02' },
    { name: 'Ana', days: 1, firstDate: '2026-11-02', lastDate: '2026-11-02' },
  ]);
  assert.equal(detail.days, 8);
});

test('detalhes incompletos ou datas inválidas impedem totais parciais', () => {
  assert.throws(() => buildGanttProfessionDetail({ complete: false, rows: [] }), /complet/i);
  assert.throws(() => buildGanttProfessionDetail({ complete: true, rows: [
    { id: '1', date: '2026-02-30', supplier: 'João', profession: 'PEDREIRO' },
  ] }), /data/i);
  assert.deepEqual(buildGanttProfessionDetail({ complete: true, rows: [] }), { days: 0, professions: [] });
});
