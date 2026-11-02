import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = 'a9bdb746-d54b-40c4-bf6b-3c49e9b1cd6e';
const LAUNCHES = '40d7ef08-594a-4835-85d7-036eb1a098e0';
export const HISTORY = 'f0f13292-f28c-4c09-8060-4d4af4664730';
export const HISTORY_ACTION = 'Create_depreciation_record';
const COLUMN_KEYS = ['asset', 'launch', 'name', 'branch', 'percent', 'date', 'amount', 'residual'];

export function buildDepreciationLedgerFlow(definition, { columns } = {}) {
  if (!columns || COLUMN_KEYS.some(key => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(columns[key] || ''))
    || new Set(COLUMN_KEYS.map(key => columns[key])).size !== 8) throw new Error('Incomplete or invalid history column map');
  const actions = definition?.actions?.Apply_to_each?.actions;
  if (definition?.actions?.Get_items?.inputs?.parameters?.table !== ASSETS
    || actions?.Update_item?.inputs?.parameters?.table !== ASSETS) throw new Error('Unexpected IMOBILIZADOS flow');
  if (actions?.Create_item?.inputs?.parameters?.table !== LAUNCHES
    || actions.Create_item.inputs.host?.operationId !== 'PostItem') throw new Error('Unexpected LANCAMENTOS creation');
  for (const key of ['Compose', 'Compose_1', 'Compose_2', 'Compose_5']) {
    if (!actions[key]) throw new Error(`Missing calculation/report action ${key}`);
  }
  const allowedUpdate = new Set(['dataset', 'table', 'id', 'item/DATADEPRECIA_x00c7__x00c3_O', 'item/VALORRESIDUAL', 'item/HTML']);
  if (Object.keys(actions.Update_item.inputs.parameters).some(key => !allowedUpdate.has(key))
    || !Object.hasOwn(actions.Update_item.inputs.parameters, 'item/VALORRESIDUAL')
    || !Object.hasOwn(actions.Update_item.inputs.parameters, 'item/DATADEPRECIA_x00c7__x00c3_O')) throw new Error('Unexpected Update_item fields');
  const created = {
    type: 'OpenApiConnection', runAfter: { Compose_5: ['Succeeded'] },
    inputs: {
      host: structuredClone(actions.Create_item.inputs.host),
      authentication: actions.Create_item.inputs.authentication,
      retryPolicy: { type: 'none' },
      parameters: {
        dataset: actions.Create_item.inputs.parameters.dataset, table: HISTORY,
        [`item/${columns.name}`]: "@coalesce(items('Apply_to_each')?['ITEM'], '')",
        [`item/${columns.branch}`]: "@items('Apply_to_each')?['FILIAL']",
        [`item/${columns.percent}`]: "@div(float(replace(string(items('Apply_to_each')?['OData__x0025_DEPRECIACAO']), ',', '.')), 100)",
        [`item/${columns.date}`]: "@items('Apply_to_each')?['DATADEPRECIA_x00c7__x00c3_O']",
        [`item/${columns.amount}`]: "@float(formatNumber(float(outputs('Compose')), '0.00', 'en-US'))",
        [`item/${columns.residual}`]: "@float(formatNumber(float(outputs('Compose_1')), '0.00', 'en-US'))",
        [`item/${columns.asset}`]: "@int(items('Apply_to_each')?['ID'])",
        [`item/${columns.launch}`]: "@int(outputs('Create_item')?['body/ID'])",
      },
    },
  };
  if (actions[HISTORY_ACTION]) {
    if (JSON.stringify(actions[HISTORY_ACTION]) !== JSON.stringify(created)
      || Object.hasOwn(actions.Update_item.inputs.parameters, 'item/HTML')
      || JSON.stringify(actions.Update_item.runAfter) !== JSON.stringify({ [HISTORY_ACTION]: ['Succeeded'] })) throw new Error('Existing ledger transformation does not match expected definition');
    return structuredClone(definition);
  }
  if (!Object.hasOwn(actions.Update_item.inputs.parameters, 'item/HTML')
    || JSON.stringify(actions.Update_item.runAfter) !== JSON.stringify({ Compose_5: ['Succeeded'] })) throw new Error('Unexpected Update_item dependencies');
  const result = structuredClone(definition), loop = result.actions.Apply_to_each.actions;
  loop[HISTORY_ACTION] = created;
  delete loop.Update_item.inputs.parameters['item/HTML'];
  loop.Update_item.runAfter = { [HISTORY_ACTION]: ['Succeeded'] };
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(Array.from({ length: Math.floor((process.argv.length - 2) / 2) }, (_, i) => [process.argv[2 + i * 2], process.argv[3 + i * 2]]));
  if (!args['--source'] || !args['--columns'] || !args['--output']) throw new Error('Required: --source flow.json --columns columns.json --output definition.json');
  const source = JSON.parse(readFileSync(args['--source'], 'utf8').replace(/^\uFEFF/, ''));
  const columns = JSON.parse(readFileSync(args['--columns'], 'utf8').replace(/^\uFEFF/, ''));
  const result = buildDepreciationLedgerFlow(source.properties?.definition || source, { columns });
  writeFileSync(args['--output'], JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ status: 'BUILT', historyList: HISTORY, columns: COLUMN_KEYS.length, htmlWrites: false }) + '\n');
}
