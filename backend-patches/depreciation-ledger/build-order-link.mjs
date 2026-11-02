import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORDER_EXPRESSION = "@if(empty(trim(string(coalesce(outputs('Create_item')?['body/AGRUPAR'], '')))), null, int(trim(string(outputs('Create_item')?['body/AGRUPAR']))))";
export function addDepreciationOrderLink(definition, column = 'IDPEDIDO') {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) throw new Error('Coluna do pedido inválida');
  const actions = definition?.actions?.Apply_to_each?.actions;
  if (actions?.Create_item?.inputs?.parameters?.table !== '40d7ef08-594a-4835-85d7-036eb1a098e0'
    || !Object.hasOwn(actions.Create_item.inputs.parameters, 'item/AGRUPAR')) throw new Error('Criação do lançamento inesperada');
  const history = actions?.Create_depreciation_record?.inputs?.parameters;
  if (history?.table !== 'f0f13292-f28c-4c09-8060-4d4af4664730'
    || history['item/IDLANCAMENTO'] !== "@int(outputs('Create_item')?['body/ID'])") throw new Error('Ação de histórico inesperada');
  if (actions?.Update_item?.inputs?.parameters?.table !== 'a9bdb746-d54b-40c4-bf6b-3c49e9b1cd6e'
    || Object.hasOwn(actions.Update_item.inputs.parameters, 'item/HTML')) throw new Error('Atualização do cadastro inesperada');
  if (Object.hasOwn(history, `item/${column}`) && history[`item/${column}`] !== ORDER_EXPRESSION) throw new Error('Vínculo de pedido já existente não corresponde à transformação');
  const next = structuredClone(definition);
  next.actions.Apply_to_each.actions.Create_depreciation_record.inputs.parameters[`item/${column}`] = ORDER_EXPRESSION;
  return next;
}

function id(value, label) {
  const raw = String(value ?? '').trim();
  if (!/^[1-9]\d{0,14}$/.test(raw)) throw new Error(`${label} inválido`);
  return Number(raw);
}
const blank = value => value == null || String(value).trim() === '';
export function planOrderBackfill(history, launches, orders) {
  const index = (rows, label) => {
    const result = new Map();
    for (const row of rows) { const key = id(row.ID ?? row.Id, label); if (result.has(key)) throw new Error(`${label} duplicado`); result.set(key, row); }
    return result;
  };
  const financial = index(launches, 'ID do lançamento'), requests = index(orders, 'ID do pedido');
  const result = { writes: [], withoutLaunch: 0, withoutOrder: 0, alreadyLinked: 0 };
  for (const row of index(history, 'ID do histórico').values()) {
    if (blank(row.IDLANCAMENTO)) { result.withoutLaunch++; continue; }
    const launchId = id(row.IDLANCAMENTO, 'ID do lançamento'), launch = financial.get(launchId);
    if (!launch) throw new Error(`O lançamento ${launchId} não foi comprovado`);
    if (blank(launch.AGRUPAR)) { result.withoutOrder++; continue; }
    const orderId = id(launch.AGRUPAR, 'ID do pedido');
    if (!requests.has(orderId)) throw new Error(`O pedido ${orderId} não foi comprovado`);
    if (!blank(row.IDPEDIDO)) {
      if (id(row.IDPEDIDO, 'ID do pedido existente') !== orderId) throw new Error('Conflito no pedido do histórico');
      result.alreadyLinked++; continue;
    }
    result.writes.push({ historyId: id(row.ID ?? row.Id, 'ID do histórico'), launchId, orderId });
  }
  return result;
}
export function verifyOrderValues(before, after, plan) {
  const current = new Map(after.map(row => [id(row.ID ?? row.Id, 'ID do histórico'), row]));
  if (current.size !== after.length || before.length !== after.length) throw new Error('Histórico incompleto na verificação do pedido');
  const writes = new Map(plan.writes.map(row => [row.historyId, row.orderId]));
  for (const row of before) {
    const historyId = id(row.ID ?? row.Id, 'ID do histórico'), now = current.get(historyId);
    if (!now) throw new Error('Histórico ausente na verificação do pedido');
    const expected = writes.has(historyId) ? writes.get(historyId) : row.IDPEDIDO;
    if (blank(expected) && blank(now.IDPEDIDO)) continue;
    if (blank(expected) || blank(now.IDPEDIDO) || id(expected, 'Pedido esperado') !== id(now.IDPEDIDO, 'Pedido atual')) throw new Error(`Pedido alterado fora do plano ou incorreto no histórico ${historyId}`);
  }
  return true;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  const [mode, source, arg2, arg3, arg4] = process.argv.slice(2);
  if (mode === 'flow') { const input = read(source); writeFileSync(arg2, JSON.stringify(addDepreciationOrderLink(input.properties?.definition || input), null, 2) + '\n'); }
  else if (mode === 'plan') {
    const history = read(source); writeFileSync(arg4, JSON.stringify(planOrderBackfill(history.value || history, read(arg2), read(arg3)), null, 2) + '\n');
  } else if (mode === 'verify') {
    const before = read(source), after = read(arg2); verifyOrderValues(before.value || before, after.value || after, read(arg3));
    process.stdout.write('ORDER_VALUES_VERIFIED\n');
  } else throw new Error('Use flow, plan ou verify');
}
