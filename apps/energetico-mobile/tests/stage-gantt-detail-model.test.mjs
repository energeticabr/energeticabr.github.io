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

test('detalhes incompletos ou datas inválidas impedem totais parciais', () => {
  assert.throws(() => buildGanttProfessionDetail({ complete: false, rows: [] }), /complet/i);
  assert.throws(() => buildGanttProfessionDetail({ complete: true, rows: [
    { id: '1', date: '2026-02-30', supplier: 'João', profession: 'PEDREIRO' },
  ] }), /data/i);
  assert.deepEqual(buildGanttProfessionDetail({ complete: true, rows: [] }), { days: 0, professions: [] });
});
