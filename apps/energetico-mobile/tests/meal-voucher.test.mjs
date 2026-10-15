import test from 'node:test';
import assert from 'node:assert/strict';
import { mealVoucherTotal, validateMealVoucherDraft, MEAL_VOUCHER_REPLY_ID } from '../src/chat/meal-voucher.js';

const suppliers = [
  { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO' },
  { id: '2', label: 'Beto', branch: 'OBRA A', profession: 'SERVENTE' },
  { id: '3', label: 'Caio', branch: 'OBRA B', profession: 'PINTOR' },
];
const base = { date: '2026-10-15', dueDate: '2026-10-30', referenceMonth: '2026-10', stage: { id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }, account: { id: '8', label: 'CAIXA' }, orderMode: 'new', lines: [
  { supplier: suppliers[0], quantity: '2', unitValue: 'R$ 1,50' },
  { supplier: suppliers[1], quantity: '3', unitValue: '2,00' },
  { supplier: suppliers[2], quantity: '1', unitValue: '' },
] };

test('vale alimentação: total usa quantidade x valor e ignora fornecedores não preenchidos', () => {
  assert.equal(MEAL_VOUCHER_REPLY_ID, 'action_meal_voucher_launch');
  assert.equal(mealVoucherTotal(base.lines), 9);
  const result = validateMealVoucherDraft(base);
  assert.equal(result.lines.length, 2);
  assert.equal(result.total, 9);
  assert.equal(result.branch, 'OBRA A');
  assert.deepEqual(result.lines.map(line => line.supplier.profession), ['PEDREIRO', 'SERVENTE']);
});

test('vale alimentação: impede valor negativo, profissão vazia e lotes de filiais distintas', () => {
  assert.throws(() => validateMealVoucherDraft({ ...base, lines: [{ supplier: suppliers[0], quantity: '1', unitValue: '-2' }] }), /valor|número/i);
  assert.throws(() => validateMealVoucherDraft({ ...base, lines: [{ supplier: { ...suppliers[0], profession: '' }, quantity: '1', unitValue: '2' }] }), /profissão/i);
  assert.throws(() => validateMealVoucherDraft({ ...base, lines: [...base.lines.slice(0, 2), { supplier: suppliers[2], quantity: '1', unitValue: '1' }] }), /filial/i);
});

test('vale alimentação: pedido existente exige ID e datas válidas', () => {
  assert.throws(() => validateMealVoucherDraft({ ...base, orderMode: 'existing', orderId: '' }), /pedido/i);
  assert.throws(() => validateMealVoucherDraft({ ...base, dueDate: '2026-02-30' }), /data/i);
});

test('vale alimentação: sem quantidade ou sem valor não posta linha zerada, e exige mês de referência', () => {
  const result = validateMealVoucherDraft({ ...base, lines: [
    { supplier: suppliers[0], quantity: '', unitValue: '12' },
    { supplier: suppliers[1], quantity: '2', unitValue: '5' },
    { supplier: suppliers[2], quantity: '3', unitValue: '' },
  ] });
  assert.deepEqual(result.lines.map(line => line.supplier.label), ['Beto']);
  assert.equal(result.total, 10);
  assert.throws(() => validateMealVoucherDraft({ ...base, referenceMonth: '' }), /mês de referência/i);
  assert.throws(() => validateMealVoucherDraft({ ...base, referenceMonth: '2026-13' }), /mês de referência/i);
});

test('vale alimentação: valores explicitamente zerados também não viram lançamento', () => {
  const result = validateMealVoucherDraft({ ...base, lines: [
    { supplier: suppliers[0], quantity: '0', unitValue: '5' },
    { supplier: suppliers[1], quantity: '1', unitValue: '0' },
    { supplier: suppliers[2], quantity: '2', unitValue: '4' },
  ], stage: { id: '9', label: 'ACABAMENTO', branch: 'OBRA B' } });
  assert.deepEqual(result.lines.map(line => line.supplier.label), ['Caio']);
  assert.equal(result.total, 8);
});

test('quantidade zero omite a linha mesmo que o valor restante seja inválido', () => {
  const result = validateMealVoucherDraft({ ...base, lines: [
    { supplier: suppliers[0], quantity: '0', unitValue: 'abc' },
    { supplier: suppliers[1], quantity: '1', unitValue: '5' },
  ] });
  assert.deepEqual(result.lines.map(line => line.supplier.label), ['Beto']);
  assert.equal(result.total, 5);
});
