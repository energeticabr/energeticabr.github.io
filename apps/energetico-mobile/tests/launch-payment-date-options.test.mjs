import test from 'node:test';
import assert from 'node:assert/strict';
import { orderEffectivePaymentDateOptions, recommendEffectivePaymentDate } from '../src/chat/launch-payment-date-options.js';

const now = new Date('2026-11-19T15:00:00Z');
const options = () => [
  { id: 'blank', label: 'EM BRANCO' },
  { id: 'yesterday', label: '🔴 📆 ONTEM' },
  { id: 'today', label: '📅 HOJE' },
  { id: 'tomorrow', label: '1️⃣ AMANHÃ' },
  { id: 'other', label: 'OUTRA DATA' },
];
const poll = status => ({ type: 'poll', question: `QUAL É A DATA DE PAGAMENTO ${status}?`, options: options() });

for (const status of ['PREVISTO', 'EFETUADO']) {
  test(`${status}: mantém a ordem dos atalhos e remove amanhã`, () => {
    const message = poll(status);
    const before = structuredClone(message);
    assert.deepEqual(orderEffectivePaymentDateOptions(message, message.options).map(o => o.id), ['blank', 'yesterday', 'today', 'other']);
    assert.deepEqual(message, before);
  });
}

for (const [reply, answer, expectedId] of [
  ['today', '📅 HOJE', 'today'],
  ['yesterday', '🔴 📆 ONTEM', 'yesterday'],
  [null, '19/11/2026', 'today'],
  [null, '18/11/2026', 'yesterday'],
]) {
  test(`marca ${answer} no próprio lugar sem duplicar`, () => {
    const result = { messages: [poll('EFETUADO')] };
    const before = structuredClone(result);
    const actual = recommendEffectivePaymentDate(poll('PREVISTO'), answer, reply, result, now).messages[0].options;
    assert.deepEqual(actual.map(o => o.id), ['blank', 'yesterday', 'today', 'other']);
    assert.deepEqual(actual.filter(o => o.recommendedDate).map(o => o.id), [expectedId]);
    assert.deepEqual(result, before);
  });
}

test('somente uma data sem atalho aparece em primeiro com estrela', () => {
  const actual = recommendEffectivePaymentDate(poll('PREVISTO'), '20/11/2026', null, { messages: [poll('EFETUADO')] }, now).messages[0].options;
  assert.equal(actual[0].label, '20/11/2026');
  assert.equal(actual[0].recommendedDate, true);
  assert.deepEqual(actual.slice(1).map(o => o.id), ['blank', 'yesterday', 'today', 'other']);
});

test('reutiliza também um atalho de data explícita existente', () => {
  const effective = poll('EFETUADO');
  effective.options.splice(2, 0, { id: 'fixed-date', label: '25/11/2026' });
  const actual = recommendEffectivePaymentDate(poll('PREVISTO'), '25/11/2026', null, { messages: [effective] }, now).messages[0].options;
  assert.deepEqual(actual.map(o => o.id), ['blank', 'yesterday', 'fixed-date', 'today', 'other']);
  assert.equal(actual[2].recommendedDate, true);
});

test('não altera opções de outras perguntas', () => {
  const message = { type: 'poll', question: 'QUAL É A DATA DA VISITA?', options: options() };
  assert.equal(orderEffectivePaymentDateOptions(message, message.options), message.options);
});
