import test from 'node:test';
import assert from 'node:assert/strict';
import { scopePendingPresenceMessage, expandPresenceDatesMessage } from '../src/chat/presence-date-scope.js';

const dayControl = { id: 'pending_attendance_other_date', reply: 'pending_attendance_other_date', label: '📅 AVALIAR OUTRA DATA' };
const row = (id, date) => ({ id: `pending_attendance_record:${id}`, reply: `pending_attendance_record:${id}`,
  label: `${id} - FORNECEDOR EXEMPLO`, source_values: { Id: id, DATA: date, PRESENCA: 'PENDENTE' } });
const pending = options => ({ type: 'poll', presentation: 'attendance_multi_select',
  question: 'PRESENÇAS PENDENTES DE 09/10/2026', options });

test('checklist de Pendências usa a data real de cada opção e mantém o seletor de outra data', () => {
  const message = pending([row('2229', '2026-10-09T03:00:00Z'), row('2219', '2026-10-08'), dayControl]);
  const baseline = structuredClone(message);
  const result = scopePendingPresenceMessage(message, '2026-10-09');
  assert.deepEqual(result.options.map(option => option.reply), ['pending_attendance_record:2229', 'pending_attendance_other_date']);
  assert.equal(result.presentation, 'attendance_multi_select');
  assert.equal(result.presenceDateKey, '2026-10-09');
  assert.deepEqual(message, baseline, 'filtragem não modifica os dados recebidos');
});

test('checklist sem itens do dia mantém o controle de data em vez de mostrar outros dias', () => {
  const result = scopePendingPresenceMessage(pending([row('2219', '2026-10-08'), dayControl]), '2026-10-09');
  assert.deepEqual(result.options, [dayControl]);
  assert.deepEqual(result.presenceDateSummary, { date: '2026-10-09', count: 0 });
});

test('checklist de um único dia não perde o controle remoto de avaliar outra data', () => {
  const result = scopePendingPresenceMessage(pending([row('2229', '09/10/2026'), dayControl]), '2026-10-09');
  assert.deepEqual(result.options.map(option => option.reply), ['pending_attendance_record:2229', 'pending_attendance_other_date']);
  assert.equal(result.presenceDateKey, '2026-10-09');
});

test('checklist sem controle remoto conserva a expansão local para outras datas', () => {
  const message = pending([row('2229', '2026-10-09'), row('2219', '2026-10-08')]);
  const result = scopePendingPresenceMessage(message, '2026-10-09');
  assert.deepEqual(result.options.map(option => option.reply), ['pending_attendance_record:2229', 'presence_other_dates']);
  assert.deepEqual(expandPresenceDatesMessage(result).options, message.options);
});

test('o seletor RH explícito não é convertido em uma lista de Pendências', () => {
  const message = { type: 'poll', presentation: 'attendance_multi_select', question: 'QUAL PRESENÇA DESEJA VALIDAR?',
    options: [{ id: '1', date: '2026-10-09' }, { id: '2', date: '2026-10-08' }] };
  assert.equal(scopePendingPresenceMessage(message, '2026-10-09'), message);
});

test('o formato anterior continua usando datas do rótulo e permite expandir a lista', () => {
  const message = { type: 'poll', presentation: 'accordion', options: [
    { id: '1', label: '1 - EXEMPLO (09/10/2026)' }, { id: '2', label: '2 - EXEMPLO (08/10/2026)' },
  ] };
  const result = scopePendingPresenceMessage(message, '2026-10-09');
  assert.deepEqual(result.options.map(option => option.id), ['1', 'presence_other_dates']);
  assert.deepEqual(expandPresenceDatesMessage(result).options, message.options);
});
