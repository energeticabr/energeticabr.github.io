import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';
import { attendanceBadgeState } from './helpers/attendance-rhid-badge-fixture.mjs';
import { attendanceBulkEligible, attendanceClockExempt } from '../src/chat/attendance-bulk-selection.js';
import { buildAttendanceRhidBadge } from '../src/chat/attendance-rhid-badges.js';

const date = '2026-11-04';
const empty = { entry1: null, exit1: null, entry2: null, exit2: null };
const punches = { entry1: '07:00', exit1: '12:00', entry2: '13:00', exit2: '17:00' };
function option(id, name, status = 'absent', extra = {}) {
  return { id: `pending_attendance_record:${id}`, label: `${id} - ${name}`, date,
    rhidBadge: { date, status, label: status, punches: empty, ...extra } };
}
function mount(t, options, presentation = 'attendance_multi_select') {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root), reads = [], replies = [];
  view.on('attendance-irregularity-read', async payload => { reads.push(payload); return ''; });
  view.on('select-reply', payload => replies.push(payload.replyId));
  const state = attendanceBadgeState({ id: 'select-all-policy', role: 'assistant', type: 'poll', presentation,
    databaseFilter: true, databaseFilterKey: 'presence', question: 'VALIDAR PRESENÇAS', options });
  view.render(state);
  t.after(() => { view.destroy(); dom.window.close(); });
  return { root, view, state, reads, replies,
    selected: () => [...root.querySelectorAll('input[data-action="attendance-select-toggle"]:checked')].map(input => input.dataset.replyId),
    all: () => root.querySelector('[data-action="attendance-select-all"]') };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

for (const presentation of ['attendance_multi_select', 'accordion']) {
  test(`selecionar todos exclui ausentes e inclui apenas Israel e Rafael sem ponto (${presentation})`, async t => {
    const { root, selected, all, reads, replies } = mount(t, [
      option(1, 'PESSOA PRESENTE', 'present', { punches, minutes: 540 }),
      option(2, 'PESSOA AUSENTE'),
      option(3, 'ISRAEL ESCORAMENTO E ARMAÇÕES', 'unregistered'),
      option(4, 'RAFAEL GONTIJO'),
      option(5, 'RAFAEL DA SILVA'), option(6, 'ISRAEL DE SOUZA'),
      option(7, 'SEM CADASTRO', 'unregistered'), option(8, 'SEM CONSULTA', 'unavailable'),
      { ...option(9, 'CONSULTANDO', 'loading') },
    ], presentation);
    all().click(); await tick();
    assert.deepEqual(selected(), ['1', '3', '4']);
    assert.deepEqual(reads, [], 'ausentes não entram na fila individual, nem para ler motivo já salvo');
    assert.equal(root.querySelector('[data-attendance-irregularity-dialog]'), null);
    assert.equal(all().checked, true, 'os ausentes excluídos não deixam Selecionar todos desmarcado');
    root.querySelector('[data-action="attendance-select-proceed"]').click();
    assert.deepEqual(replies, ['attendance_batch:1,3,4']);
    all().click();
    assert.deepEqual(selected(), []);
  });
}

test('ausente continua selecionável manualmente e preserva justificativa', async t => {
  const { root, all, reads, selected } = mount(t, [option(1, 'PRESENTE', 'present', { punches, minutes: 540 }), option(2, 'AUSENTE')]);
  all().click(); await tick();
  root.querySelector('input[data-reply-id="2"]').click(); await tick();
  assert.deepEqual(selected(), ['1']);
  assert.deepEqual(reads, [{ id: '2', date }]);
  assert.ok(root.querySelector('[data-attendance-irregularity-dialog]'));
});

test('lote filtrado só com ausentes não abre justificativa nem seleciona ninguém', async t => {
  const { root, all, selected, reads } = mount(t, [option(2, 'AUSENTE')]);
  all().click(); await tick();
  assert.deepEqual(selected(), []);
  assert.deepEqual(reads, []);
  assert.equal(all().checked, false);
  assert.equal(root.querySelector('[data-attendance-irregularity-dialog]'), null);
});

test('ponto parcial continua exigindo a justificativa existente no lote', async t => {
  const { root, all, selected, reads } = mount(t, [option(2, 'PONTO PARCIAL', 'inconsistent', { punches: { ...empty, entry1: '07:00' } })]);
  all().click(); await tick();
  assert.deepEqual(selected(), []);
  assert.deepEqual(reads, [{ id: '2', date }]);
  assert.ok(root.querySelector('[data-attendance-irregularity-dialog]'));
});

test('batidas reais ambíguas continuam na conferência, mesmo sem horário efetivo resolvido', async t => {
  const badge = buildAttendanceRhidBadge({ presenceId: '2', name: 'PONTO AMBÍGUO', date }, {
    date, rows: [{ Id: 'rhid-2', ID_PESSOA_RHID: '2', NOME_COLABORADOR: 'PONTO AMBÍGUO', DATA_REFERENCIA: date,
      BATIDAS_RHID: ['07:00', '07:05', '07:10'] }],
  });
  assert.equal(badge.status, 'inconsistent');
  assert.ok(Object.values(badge.punches).every(value => !value));
  const { root, all, reads } = mount(t, [{ ...option(2, 'PONTO AMBÍGUO'), rhidBadge: badge }]);
  all().click(); await tick();
  assert.deepEqual(reads, [{ id: '2', date }]);
  assert.ok(root.querySelector('[data-attendance-irregularity-dialog]'));
});

test('sincronização de fornecedores preserva seleção sem depender do ponto', t => {
  const { root, all, selected, replies } = mount(t, [
    { ...option(2, 'AUSENTE'), id: 'supplier_sync_target:2' },
  ], 'attendance_supplier_sync');
  all().click();
  assert.deepEqual(selected(), ['2']);
  root.querySelector('[data-action="attendance-select-proceed"]').click();
  assert.deepEqual(replies, ['supplier_sync_batch:2']);
});

test('nome completo do cadastro prevalece sobre o rótulo e IDs diários não definem exceções', () => {
  const poll = { presentation: 'attendance_multi_select' };
  assert.equal(attendanceClockExempt({ ...option(999, 'Outro rótulo'), source_values: { FORNECEDOR: '  Israel escoramento e armações ' } }, poll), true);
  assert.equal(attendanceClockExempt({ ...option(4, 'RAFAEL GONTIJO'), source_values: { FORNECEDOR: 'RAFAEL DA SILVA' } }, poll), false);
  assert.equal(attendanceClockExempt(option(555, 'RAFAEL GONTIJO'), poll), true);
});

test('horários vazios, inválidos e consultas desconhecidas ficam para seleção manual', () => {
  for (const badge of [undefined, { status: 'absent', minutes: 540 },
    { status: 'present', minutes: 540, punches: empty },
    { status: 'inconsistent', punches: { entry1: '25:00' } },
    { status: 'unavailable' }, { status: 'unregistered' }, { status: 'loading' }]) {
    assert.equal(attendanceBulkEligible({ ...option(10, 'OUTRA PESSOA'), rhidBadge: badge }), false);
  }
});

test('ausente marcado manualmente com justificativa é preservado ao selecionar todos', async t => {
  const { root, view, all, selected, reads } = mount(t, [option(1, 'PRESENTE', 'present', { punches, minutes: 540 }), option(2, 'AUSENTE')]);
  view.on('attendance-irregularity-save', async () => ({}));
  root.querySelector('input[data-reply-id="2"]').click(); await tick();
  root.querySelector('[data-role="attendance-irregularity-reason"]').value = 'Presente sem ponto';
  root.querySelector('[data-action="attendance-irregularity-submit"]').click();
  root.ownerDocument.querySelector('[data-edit-review-submit]').click(); await tick();
  assert.deepEqual(selected(), ['2']);
  all().click(); await tick();
  assert.deepEqual(selected(), ['1', '2']);
  assert.deepEqual(reads, [{ id: '2', date }]);
});
