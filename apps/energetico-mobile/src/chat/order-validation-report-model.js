import Decimal from 'decimal.js';
import { provisionDateKey } from './pending-provision-dates.js';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const key = value => String(value ?? '').replace(/_x([0-9a-f]{4})_/gi,
  (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function text(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    for (const name of ['LookupValue', 'Value', 'value', 'Title', 'title', 'LookupId']) {
      if (value[name] != null) return text(value[name]);
    }
    return '';
  }
  return String(value);
}
const scalar = value => text(value).trim();

function valueFor(item, columns, aliases) {
  const fields = item?.fields || {};
  for (const alias of aliases) {
    const wanted = key(alias);
    const column = columns.find(entry => key(entry?.displayName) === wanted || key(entry?.name) === wanted);
    if (column && fields[column.name] != null) return fields[column.name];
    const direct = Object.entries(fields).find(([name, value]) => key(name) === wanted && value != null);
    if (direct) return direct[1];
  }
  return undefined;
}

function amount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? new Money(value) : null;
  let raw = scalar(value).replace(/^R\$\s*/, '').replace(/\s/g, '');
  if (raw.includes(',')) {
    if (/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(raw)) raw = raw.replaceAll('.', '').replace(',', '.');
    else if (/^-?\d{1,3}(?:,\d{3})+\.\d+$/.test(raw)) raw = raw.replaceAll(',', '');
    else return null;
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const result = new Money(raw);
  return result.isFinite() ? result : null;
}

function finite(value) {
  const result = value.toNumber();
  return Number.isFinite(result) ? result : null;
}

/** Reject transport/schema failures without mistaking legitimately blank fields for missing columns. */
export function assertOrderValidationSource(items, columns, kind) {
  const required = kind === 'orders'
    ? [['FILIAL'],['FORNECEDOR'],['NOTA FISCAL','NOTAFISCAL'],['STATUS'],['VALORTOTAL','VALOR TOTAL']]
    : [['FILIAL'],['FORNECEDOR'],['AGRUPAR'],['PRODUTO'],['VALOR UNITÁRIO','VALORUNITARIO'],['QUANTIDADE','QTD'],['FRETE']];
  for (const aliases of required) {
    if (!columns.some(column => typeof column?.name === 'string' && column.name.trim()
      && aliases.some(alias => key(column.name) === key(alias) || key(column.displayName) === key(alias)))) {
      throw new Error(`A coluna ${aliases[0]} está ausente na lista de ${kind === 'orders' ? 'pedidos' : 'lançamentos'}.`);
    }
  }
  const ids = new Set();
  for (const item of items) {
    const id = scalar(item?.id);
    if (!item || !/^[1-9]\d*$/.test(id) || ids.has(id) || !item.fields || typeof item.fields !== 'object' || Array.isArray(item.fields)) {
      throw new Error('O SharePoint retornou um item inválido ou repetido; o relatório não pode exibir totais parciais.');
    }
    ids.add(id);
  }
}

export function normalizeOrderValidationOrder(item, columns = []) {
  const read = (...aliases) => valueFor(item, columns, aliases);
  const get = (...aliases) => scalar(read(...aliases));
  const raw = read('VALORTOTAL', 'VALOR TOTAL');
  const total = scalar(raw) === '' ? null : amount(raw);
  const number = total == null ? null : finite(total);
  return Object.freeze({
    id: scalar(item?.id ?? read('ID')), branch: get('FILIAL'), supplier: get('FORNECEDOR'),
    invoice: get('NOTA FISCAL', 'NOTAFISCAL'), status: get('STATUS'), total: number,
    created: provisionDateKey(get('Criado', 'Created') || item?.createdDateTime || ''),
    invalidTotal: scalar(raw) !== '' && number == null,
  });
}

export function normalizeOrderValidationLaunch(item, columns = []) {
  const read = (...aliases) => valueFor(item, columns, aliases);
  const get = (...aliases) => scalar(read(...aliases));
  const operands = [read('VALOR UNITÁRIO', 'VALORUNITARIO'), read('QUANTIDADE', 'QTD'), read('FRETE')]
    .map(raw => scalar(raw) === '' ? new Money(0) : amount(raw));
  const total = operands.some(value => value == null) ? null : finite(operands[0].times(operands[1]).plus(operands[2]));
  return Object.freeze({
    id: scalar(item?.id ?? read('ID')),
    // AGRUPAR is text, not a numeric ID: preserve whitespace and leading zeros.
    orderId: text(read('AGRUPAR')), branch: get('FILIAL'), supplier: get('FORNECEDOR'),
    product: get('PRODUTO'), description: get('DESCRIÇÃO', 'DESCRICAO'), total, invalidTotal: total == null,
  });
}

const equals = (left, right) => scalar(left).toLocaleLowerCase('pt-BR') === scalar(right).toLocaleLowerCase('pt-BR');
const byId = (left, right) => scalar(left.id).localeCompare(scalar(right.id), 'pt-BR', { numeric: true });
const currency = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  .format(new Money(value).toDecimalPlaces(2).toNumber());

function sum(rows, blankAsZero = false) {
  if (rows.some(row => row.invalidTotal || (row.total == null ? !blankAsZero : !Number.isFinite(row.total)))) return null;
  return rows.reduce((total, row) => total.plus(row.total ?? 0), new Money(0));
}

function validate(order, linked) {
  const launches = [...linked].sort(byId);
  const accumulated = sum(launches);
  const launchTotal = accumulated == null ? null : finite(accumulated);
  const validOrder = !order.invalidTotal && (order.total == null || Number.isFinite(order.total));
  const difference = validOrder && launchTotal != null
    ? finite(new Money(order.total ?? 0).minus(accumulated)) : null;
  const missingLaunch = launches.length === 0;
  const nfPending = ['', '-', 'PENDENTE'].includes(scalar(order.invoice).toUpperCase());
  const branches = [...new Set(launches.map(row => scalar(row.branch)))];
  const suppliers = [...new Set(launches.map(row => scalar(row.supplier)))];
  const branchMismatch = launches.some(row => !equals(row.branch, order.branch));
  const supplierMismatch = launches.some(row => !equals(row.supplier, order.supplier));
  const branchProblem = !scalar(order.branch) || branchMismatch || branches.length > 1;
  const supplierProblem = !scalar(order.supplier) || supplierMismatch || suppliers.length > 1;
  // Round each side before subtracting, then compare strictly above one cent.
  const divergent = !missingLaunch && order.total != null && validOrder && launchTotal != null
    && new Money(order.total).toDecimalPlaces(2).minus(accumulated.toDecimalPlaces(2)).abs().gt('0.01');
  const invalidLaunch = launchTotal == null;
  const valueProblem = order.total == null || !validOrder || invalidLaunch || divergent;
  const issues = [];
  const issue = (condition, type, title, detail) => {
    if (condition) issues.push(Object.freeze({ type, title, detail }));
  };
  const branchList = branches.map(value => value || '-').join(' | ') || '-';
  const supplierList = suppliers.map(value => value || '-').join(' | ') || '-';
  issue(missingLaunch, 'SEM LANÇAMENTO', 'Nenhum lançamento vinculado', `Não existe lançamento com AGRUPAR = ${order.id}.`);
  issue(!scalar(order.branch), 'FILIAL', 'Filial do pedido em branco', 'O campo FILIAL do pedido está vazio.');
  issue(branchMismatch, 'FILIAL', 'Filial divergente', `Pedido: ${order.branch || '-'} | Lançamentos: ${branchList}.`);
  issue(branches.length > 1, 'FILIAL', 'Mais de uma filial nos lançamentos', `Filiais encontradas: ${branchList}.`);
  issue(!scalar(order.supplier), 'FORNECEDOR', 'Fornecedor do pedido em branco', 'O campo FORNECEDOR do pedido está vazio.');
  issue(supplierMismatch, 'FORNECEDOR', 'Fornecedor divergente', `Pedido: ${order.supplier || '-'} | Lançamentos: ${supplierList}.`);
  issue(suppliers.length > 1, 'FORNECEDOR', 'Mais de um fornecedor nos lançamentos', `Fornecedores encontrados: ${supplierList}.`);
  issue(nfPending, 'NOTA FISCAL', 'Nota fiscal ausente ou pendente', `Situação atual: ${order.invoice || '-'}.`);
  issue(order.total == null || !validOrder, 'VALOR', order.invalidTotal || !validOrder
    ? 'Valor total do pedido inválido' : 'Valor total do pedido em branco', order.invalidTotal || !validOrder
    ? 'O campo VALOR TOTAL do pedido não contém um número válido.' : 'O campo VALOR TOTAL do pedido está vazio.');
  issue(divergent || invalidLaunch, 'VALOR', invalidLaunch ? 'Valor dos lançamentos inválido' : 'Total do pedido diferente dos lançamentos',
    invalidLaunch ? 'Há valores inválidos nos lançamentos; o total não pode ser calculado.'
      : divergent ? `Pedido: ${currency(order.total)} | Lançamentos: ${currency(launchTotal)} | Diferença: ${currency(difference)}.` : '');
  return { ...order, launches: Object.freeze(launches), launchTotal, difference, issues: Object.freeze(issues),
    apto: issues.length === 0, nfPending, missingLaunch, valueProblem, branchProblem, supplierProblem,
    branchRowSpan: 0, supplierRowSpan: 0, branchGroupProblem: false, supplierGroupProblem: false };
}

function rowspans(rows, field) {
  for (let start = 0; start < rows.length;) {
    let end = start + 1;
    while (end < rows.length && equals(rows[start][field], rows[end][field])) end++;
    rows[start][`${field}RowSpan`] = end - start;
    rows[start][`${field}GroupProblem`] = rows.slice(start, end).some(row => row[`${field}Problem`]);
    start = end;
  }
}

/** Read-only PowerFx parity over complete normalized arrays; product selection never trims validation launches. */
export function buildOrderValidationReport({ orders = [], launches = [] } = {}, filters = {}) {
  const linkedByOrder = new Map();
  for (const launch of launches) {
    const id = text(launch.orderId);
    if (!linkedByOrder.has(id)) linkedByOrder.set(id, []);
    linkedByOrder.get(id).push(launch);
  }
  const status = scalar(filters.status) || 'PENDENTE AUDITORIA';
  const rows = orders.filter(order => equals(order.status, status)
    && (!scalar(filters.id) || text(order.id) === scalar(filters.id))
    && ['branch', 'supplier', 'invoice'].every(field => !scalar(filters[field]) || equals(order[field], filters[field]))
    && (!scalar(filters.product) || (linkedByOrder.get(text(order.id)) || []).some(row => equals(row.product, filters.product))))
    .sort((left, right) => byId(right, left)).map(order => validate(order, linkedByOrder.get(text(order.id)) || []));
  rowspans(rows, 'branch'); rowspans(rows, 'supplier');
  const total = sum(rows, true);
  const summary = Object.freeze({ orderCount: rows.length, total: total == null ? null : finite(total.toDecimalPlaces(2)),
    invoicePending: rows.filter(row => row.nfPending).length, withoutLaunch: rows.filter(row => row.missingLaunch).length,
    valueDivergent: rows.filter(row => row.valueProblem).length,
    supplierCount: new Set(rows.map(row => scalar(row.supplier)).filter(Boolean)).size });
  return Object.freeze({ summary, rows: Object.freeze(rows.map(Object.freeze)),
    detail: scalar(filters.id) ? rows.find(row => text(row.id) === scalar(filters.id)) || null : null });
}
