import Decimal from 'decimal.js';
import { PAYROLL_RUBRICS, payrollDecimal, payrollKey, validPayrollDate } from './supplier-payroll.js';

export const PAYROLL_BREAKDOWN_REPLY_ID = 'action_payroll_provision_breakdown';
export { PAYROLL_RUBRICS };

export function isPayrollBreakdownMenu(message) {
  const ids = new Set((message?.options || []).flatMap(option => [option.id, option.reply, option.replyId]).filter(Boolean));
  return ids.has('action_payment') && ids.has('action_recurring_expense');
}

export function payrollProvisionDates(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || '')) || Number(month.slice(0, 4)) < 1900)
    throw new RangeError('Selecione um mês e ano válidos.');
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return Array.from({ length: last }, (_, index) => {
    const day = index + 1, date = `${month}-${String(day).padStart(2, '0')}`;
    const friday = new Date(`${date}T12:00:00Z`).getUTCDay() === 5;
    return { date, friday, monthEnd: day === last };
  }).filter(day => day.friday || day.monthEnd);
}

export function payrollProvisionObservation(label, date) {
  return `Pagamento de ${label} referente à semana anterior à data ${date.split('-').reverse().join('/')}`;
}

export function validatePayrollBreakdown(draft) {
  const allowed = new Set(payrollProvisionDates(draft?.month).map(day => day.date));
  const supplier = draft?.supplier;
  if (!/^[1-9]\d*$/.test(String(supplier?.id || '')) || !String(supplier?.label || '').trim())
    throw new RangeError('Selecione um fornecedor cadastrado.');
  if (!String(supplier.branch || '').trim()) throw new RangeError('O fornecedor não possui filial padrão cadastrada.');
  if (!String(supplier.profession || '').trim()) throw new RangeError('O fornecedor não possui profissão cadastrada.');
  const seen = new Set(), lines = [];
  for (const raw of draft.lines || []) {
    if (String(raw.unitValue ?? '').trim() === '') continue;
    const unit = payrollDecimal(raw.unitValue);
    if (unit.isZero()) continue;
    const rubric = PAYROLL_RUBRICS.find(item => item.id === raw.rubric);
    if (!rubric || !validPayrollDate(raw.date) || !allowed.has(raw.date)) throw new RangeError('A rubrica ou data da provisão é inválida.');
    const identity = `${raw.date}:${rubric.id}`;
    if (seen.has(identity)) throw new RangeError('Há uma rubrica repetida na mesma data.');
    seen.add(identity);
    const quantity = payrollDecimal(raw.quantity);
    if (!quantity.gt(0)) throw new RangeError(`Informe a quantidade de ${rubric.label} em ${raw.date.split('-').reverse().join('/')}.`);
    const amount = quantity.times(unit).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (!amount.gt(0) || amount.times(100).gt(Number.MAX_SAFE_INTEGER)) throw new RangeError('O total da rubrica está fora do limite.');
    lines.push({ date: raw.date, rubric: rubric.id, label: rubric.label, payrollType: rubric.payrollType,
      quantity: quantity.toNumber(), unitValue: unit.toNumber(), total: amount.toNumber(),
      observation: payrollProvisionObservation(rubric.label, raw.date) });
  }
  if (!lines.length) throw new RangeError('Preencha pelo menos uma rubrica com quantidade e valor maiores que zero.');
  lines.sort((a, b) => a.date.localeCompare(b.date) || PAYROLL_RUBRICS.findIndex(r => r.id === a.rubric) - PAYROLL_RUBRICS.findIndex(r => r.id === b.rubric));
  const total = lines.reduce((sum, line) => sum.plus(line.total), new Decimal(0));
  if (total.times(100).gt(Number.MAX_SAFE_INTEGER)) throw new RangeError('O total ultrapassa o limite de precisão monetária.');
  return { supplier: { ...supplier }, month: draft.month, lines, total: total.toNumber(),
    rubrics: PAYROLL_RUBRICS.map(rubric => ({ rubric: rubric.id, label: rubric.label,
      total: lines.filter(line => line.rubric === rubric.id).reduce((sum, line) => sum.plus(line.total), new Decimal(0)).toNumber() })) };
}

export function payrollBreakdownSupplierMatches(left, right) {
  return String(left?.id) === String(right?.id) && ['label', 'branch', 'profession'].every(field => payrollKey(left?.[field]) === payrollKey(right?.[field]));
}
