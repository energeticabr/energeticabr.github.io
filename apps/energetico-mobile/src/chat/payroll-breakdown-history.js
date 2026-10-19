import Decimal from 'decimal.js';
import { payrollProvisionDates } from './payroll-breakdown.js';
import { validPayrollDate } from './supplier-payroll.js';

export function payrollCombinedTotal(forecast, paid) {
  const total = new Decimal(forecast).plus(paid).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (!total.isFinite() || !Number.isSafeInteger(total.times(100).toNumber())) throw new RangeError('O total excede o limite monetário.');
  return total.toNumber();
}
function week(date) {
  if (!validPayrollDate(date)) throw new RangeError('Data de pagamento inválida.');
  const start = new Date(`${date}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const at = offset => { const day = new Date(start); day.setUTCDate(day.getUTCDate() + offset); return day.toISOString().slice(0,10); };
  return { weekStart: at(0), weekEnd: at(6), fridayDate: at(4) };
}
export function payrollBreakdownPeriods(month, payments = [], today) {
  if (!validPayrollDate(today)) throw new RangeError('Data de referência inválida.');
  const periods = payrollProvisionDates(month).map(day => ({ ...day, ...week(day.date), payments: [], editable: true }));
  const ids = new Set();
  for (const payment of payments) {
    if (!payment.id || ids.has(String(payment.id))) throw new Error('Identidade de pagamento ausente ou duplicada.');
    ids.add(String(payment.id));
    const bounds = week(payment.date);
    let period = periods.find(day => day.date === bounds.fridayDate)
      || periods.find(day => day.monthEnd && day.weekStart === bounds.weekStart);
    if (!period) {
      period = { date: bounds.fridayDate, friday: true, monthEnd: false, ...bounds, payments: [], editable: false };
      periods.push(period);
    }
    period.payments.push(payment);
  }
  return periods.sort((a,b) => a.date.localeCompare(b.date)).map(period => ({ ...period,
    past: period.weekEnd < today, editable: period.editable && period.weekEnd >= today }));
}
