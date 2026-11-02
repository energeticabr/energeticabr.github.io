import test from 'node:test';
import assert from 'node:assert/strict';

const columns = { asset: 'ID_x0020_IMOBILIZADO', launch: 'IDLANCAMENTO', name: 'Title', branch: 'FILIAL', percent: 'OData__x0025__x0020_DEPRECIA_x00c7__x0', date: 'DATA_x0020_DE_x0020_DEPRECIA_x00', amount: 'VALOR_x0020_DEPRECIA_x00c7__x00c', residual: 'VALOR_x0020_RESIDUAL' };
function before() {
  return {
    triggers: { Recurrence: { type: 'Recurrence', recurrence: { frequency: 'Day', interval: 1, timeZone: 'E. South America Standard Time', schedule: { hours: ['7'] } } } },
    actions: { Get_items: { inputs: { parameters: { table: 'a9bdb746-d54b-40c4-bf6b-3c49e9b1cd6e', $filter: "due and DEPRECIAR eq 'SIM'" } } },
      Report: { type: 'Compose', inputs: 'original consolidated report' },
      Apply_to_each: { type: 'Foreach', foreach: "@outputs('Get_items')?['body/value']", actions: {
        Compose: { type: 'Compose', inputs: '@original_depreciation()' }, Compose_1: { type: 'Compose', inputs: '@original_residual()' }, Compose_2: { type: 'Compose', inputs: '@original_next_date()' },
        Create_item: { runAfter: { Compose_2: ['Succeeded'] }, type: 'OpenApiConnection', inputs: { host: { operationId: 'PostItem', apiId: '/providers/Microsoft.PowerApps/apis/shared_sharepointonline', connectionName: 'shared_sharepointonline' }, authentication: "@parameters('$authentication')", parameters: { dataset: 'https://example.invalid/site', table: '40d7ef08-594a-4835-85d7-036eb1a098e0', 'item/field_9': "@outputs('Compose')", 'item/field_6': 'DEPRECIAÇÃO E AMORTIZAÇÃO' } } },
        Compose_4: { runAfter: { Create_item: ['Succeeded'] }, type: 'Compose', inputs: {} },
        Compose_5: { runAfter: { Compose_4: ['Succeeded'] }, type: 'Compose', inputs: '<tr>consolidated report</tr>' },
        Update_item: { runAfter: { Compose_5: ['Succeeded'] }, type: 'OpenApiConnection', inputs: { parameters: { table: 'a9bdb746-d54b-40c4-bf6b-3c49e9b1cd6e', id: "@items('Apply_to_each')?['ID']", 'item/VALORRESIDUAL': '@original_residual_formatter()', 'item/DATADEPRECIA_x00c7__x00c3_O': "@outputs('Compose_2')", 'item/HTML': '@append_previous_html()' } } },
        Condition: { type: 'If', runAfter: { Update_item: ['Succeeded'] }, expression: true, actions: {} },
      } },
    },
  };
}
async function build(definition = before()) { return (await import('../build-flow.mjs')).buildDepreciationLedgerFlow(definition, { columns }); }

test('preserva cálculos, lançamento financeiro, relatório e agendamento e troca somente o histórico do cadastro', async () => {
  const original = before(), untouched = structuredClone(original), next = await build(original);
  assert.deepEqual(original, untouched, 'não modifica o backup');
  assert.deepEqual(next.triggers, original.triggers);
  for (const action of ['Get_items', 'Report']) assert.deepEqual(next.actions[action], original.actions[action]);
  for (const action of ['Compose', 'Compose_1', 'Compose_2', 'Create_item', 'Compose_4', 'Compose_5', 'Condition']) assert.deepEqual(next.actions.Apply_to_each.actions[action], original.actions.Apply_to_each.actions[action]);
  const update = next.actions.Apply_to_each.actions.Update_item;
  const wanted = structuredClone(original.actions.Apply_to_each.actions.Update_item);
  delete wanted.inputs.parameters['item/HTML']; wanted.runAfter = { Create_depreciation_record: ['Succeeded'] };
  assert.deepEqual(update, wanted);
});

test('histórico depende do lançamento e contém seu ID real e as oito colunas corretas', async () => {
  const next = await build(), action = next.actions.Apply_to_each.actions.Create_depreciation_record;
  assert.deepEqual(action.runAfter, { Compose_5: ['Succeeded'] });
  assert.equal(action.inputs.parameters.table, 'f0f13292-f28c-4c09-8060-4d4af4664730');
  assert.equal(action.inputs.parameters['item/IDLANCAMENTO'], "@int(outputs('Create_item')?['body/ID'])");
  assert.equal(action.inputs.parameters['item/ID_x0020_IMOBILIZADO'], "@int(items('Apply_to_each')?['ID'])");
  assert.equal(action.inputs.parameters['item/Title'], "@coalesce(items('Apply_to_each')?['ITEM'], '')");
  assert.equal(action.inputs.parameters['item/FILIAL'], "@items('Apply_to_each')?['FILIAL']");
  assert.equal(action.inputs.parameters['item/DATA_x0020_DE_x0020_DEPRECIA_x00'], "@items('Apply_to_each')?['DATADEPRECIA_x00c7__x00c3_O']");
  assert.equal(action.inputs.parameters['item/OData__x0025__x0020_DEPRECIA_x00c7__x0'], "@div(float(replace(string(items('Apply_to_each')?['OData__x0025_DEPRECIACAO']), ',', '.')), 100)");
  assert.equal(action.inputs.parameters['item/VALOR_x0020_DEPRECIA_x00c7__x00c'], "@float(formatNumber(float(outputs('Compose')), '0.00', 'en-US'))");
  assert.equal(action.inputs.parameters['item/VALOR_x0020_RESIDUAL'], "@float(formatNumber(float(outputs('Compose_1')), '0.00', 'en-US'))");
  assert.equal(Object.keys(action.inputs.parameters).filter(key => key.startsWith('item/')).length, 8);
  assert.deepEqual(action.inputs.retryPolicy, { type: 'none' }, 'não repetir automaticamente um POST de histórico de resultado incerto');
});

test('reaplicar a transformação não acrescenta ações ou muda payloads', async () => {
  const once = await build(); assert.deepEqual(await build(once), once);
});

test('recusa fluxo inesperado ou mapa incompleto antes de produzir alteração', async () => {
  const { buildDepreciationLedgerFlow } = await import('../build-flow.mjs');
  const wrong = before(); wrong.actions.Apply_to_each.actions.Create_item.inputs.parameters.table = 'different-list';
  assert.throws(() => buildDepreciationLedgerFlow(wrong, { columns }), /LANCAMENTOS/);
  const missing = { ...columns }; delete missing.launch;
  assert.throws(() => buildDepreciationLedgerFlow(before(), { columns: missing }), /column/);
  const changed = before(); changed.actions.Apply_to_each.actions.Update_item.inputs.parameters['item/OTHER'] = 'unexpected';
  assert.throws(() => buildDepreciationLedgerFlow(changed, { columns }), /Update_item/);
});
