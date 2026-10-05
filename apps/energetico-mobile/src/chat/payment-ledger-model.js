import Decimal from 'decimal.js';

const folded = value => String(value ?? '').trim().toLocaleLowerCase('pt-BR');
const compare = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true });
const sum = rows => rows.every(row => Number.isFinite(row.total))
  ? rows.reduce((total, row) => total.plus(new Decimal(row.total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)), new Decimal(0)).toNumber() : null;

// The period is the payment period, not the purchase/creation date.
export function buildPaymentLedger(launches = [], filters = {}) {
  const selected = launches.filter(row => {
    if (!row.paymentDate) return false;
    if (filters.startDate && row.paymentDate < filters.startDate) return false;
    if (filters.endDate && row.paymentDate > filters.endDate) return false;
    return ['branch', 'order', 'product', 'supplier', 'disbursement'].every(name => !filters[name]
      || folded(filters[name]) === folded(row[name]));
  }).sort((a, b) => compare(b.paymentDate, a.paymentDate) || compare(a.supplier, b.supplier)
    || compare(a.branch, b.branch) || compare(a.account, b.account) || compare(a.order, b.order) || compare(b.id, a.id));
  const grouped = new Map();
  for (const row of selected) {
    const key = JSON.stringify([row.paymentDate, folded(row.supplier)]);
    if (!grouped.has(key)) grouped.set(key, { date: row.paymentDate, supplier: row.supplier, rows: [] });
    grouped.get(key).rows.push(row);
  }
  return { count: selected.length, total: sum(selected),
    groups: [...grouped.values()].map(group => ({ ...group, total: sum(group.rows) })) };
}
