import test from 'node:test';
import assert from 'node:assert/strict';
import { addDepreciationOrderLink, planOrderBackfill, verifyOrderValues, ORDER_EXPRESSION } from '../build-order-link.mjs';

function flow() { return { triggers: { daily: { interval: 1 } }, actions: { Apply_to_each: { actions: {
  Create_item: { inputs: { parameters: { table: '40d7ef08-594a-4835-85d7-036eb1a098e0', 'item/AGRUPAR': '@existing_group()' } } },
  Create_depreciation_record: { type: 'OpenApiConnection', inputs: { parameters: { table: 'f0f13292-f28c-4c09-8060-4d4af4664730', 'item/IDLANCAMENTO': "@int(outputs('Create_item')?['body/ID'])" } } },
  Update_item: { inputs: { parameters: { table: 'a9bdb746-d54b-40c4-bf6b-3c49e9b1cd6e', 'item/VALORRESIDUAL': '@unchanged()' } } },
} } } }; }
test('pedido usa AGRUPAR do lançamento real e muda exclusivamente um campo do histórico', () => {
  const original = flow(), expected = structuredClone(original);
  expected.actions.Apply_to_each.actions.Create_depreciation_record.inputs.parameters['item/IDPEDIDO'] = ORDER_EXPRESSION;
  const result = addDepreciationOrderLink(original);
  assert.deepEqual(result, expected); assert.deepEqual(original, flow());
  assert.match(ORDER_EXPRESSION, /outputs\('Create_item'\)\?\['body\/AGRUPAR'\]/);
  assert.match(ORDER_EXPRESSION, /null/); assert.match(ORDER_EXPRESSION, /trim/);
  assert.deepEqual(addDepreciationOrderLink(result), result);
  const wrong = flow(); wrong.actions.Apply_to_each.actions.Create_depreciation_record.inputs.parameters.table = 'other';
  assert.throws(() => addDepreciationOrderLink(wrong), /histórico|history/i);
});
test('carga usa somente a cadeia de IDs comprovada e é idempotente; legado sem lançamento não recebe suposição', () => {
  const rows = [{ ID: 275, IDLANCAMENTO: null }, { ID: 276, IDLANCAMENTO: 3720 }];
  const launches = [{ ID: 3720, AGRUPAR: '494' }], orders = [{ ID: 494 }];
  const result = planOrderBackfill(rows, launches, orders);
  assert.deepEqual(result.writes, [{ historyId: 276, launchId: 3720, orderId: 494 }]); assert.equal(result.withoutLaunch, 1);
  assert.equal(planOrderBackfill([{ ID: 276, IDLANCAMENTO: 3720, IDPEDIDO: 494 }], launches, orders).writes.length, 0);
  assert.throws(() => planOrderBackfill([{ ID: 276, IDLANCAMENTO: 3720, IDPEDIDO: 495 }], launches, orders), /conflit/i);
  assert.throws(() => planOrderBackfill(rows, launches, []), /pedido/i);
  assert.throws(() => planOrderBackfill(rows, [{ ID: 3720, AGRUPAR: '494 OR 1' }], orders), /pedido/i);
  assert.throws(() => planOrderBackfill(rows, [], orders), /lançamento/i);
});
test('verificação recusa pedido novo em legado fora do plano e exige o pedido exato no registro planejado', () => {
  const before = [{ ID: 275, IDLANCAMENTO: null }, { ID: 276, IDLANCAMENTO: 3720 }];
  const plan = { writes: [{ historyId: 276, orderId: 494 }] };
  assert.doesNotThrow(() => verifyOrderValues(before, [{ ID: 275, IDPEDIDO: null }, { ID: 276, IDPEDIDO: 494 }], plan));
  assert.throws(() => verifyOrderValues(before, [{ ID: 275, IDPEDIDO: 494 }, { ID: 276, IDPEDIDO: 494 }], plan), /pedido/i);
  assert.throws(() => verifyOrderValues(before, [{ ID: 275 }, { ID: 276, IDPEDIDO: 495 }], plan), /pedido/i);
});
