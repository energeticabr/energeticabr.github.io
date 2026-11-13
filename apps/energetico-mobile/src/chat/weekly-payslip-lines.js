import { PAYROLL_RUBRICS, payrollDecimal, payrollKey, payrollTaxType, payrollTotal } from './supplier-payroll.js';

export const WEEKLY_PAYSLIP_RUBRICS = PAYROLL_RUBRICS.filter(rubric => !payrollTaxType(rubric.payrollType));

function decimalText(value) {
  const text = String(value ?? '').trim();
  const scientific = text.match(/^(\d)(?:\.(\d+))?e-(\d+)$/i);
  if (!scientific || Number(scientific[3]) < 1 || Number(scientific[3]) > 323) return text;
  const [, integer, fraction = '', exponent] = scientific;
  return `0.${'0'.repeat(Number(exponent) - 1)}${integer}${fraction}`;
}

export function weeklyPayslipLines(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > WEEKLY_PAYSLIP_RUBRICS.length)
    throw new Error('Inclua pelo menos uma rubrica no holerite.');
  const seen = new Set();
  return rows.map(row => {
    const rubric = WEEKLY_PAYSLIP_RUBRICS.find(({ id, label }) => id === row?.rubrica
      || (row?.rubrica == null && row?.label && payrollKey(label) === payrollKey(row.label)));
    if (!rubric || seen.has(rubric.id)) throw new Error('Escolha uma rubrica válida e diferente em cada linha.');
    seen.add(rubric.id);
    const quantity = payrollDecimal(decimalText(row.quantity));
    const unitValue = payrollDecimal(decimalText(row.unitValue));
    if (quantity.lte(0) || unitValue.lte(0) || !quantity.toNumber() || !unitValue.toNumber())
      throw new Error(`Informe quantidade e valor unitário positivos em ${rubric.label}.`);
    if (row.formaPgto != null && (typeof row.formaPgto !== 'string' || row.formaPgto.length > 255 || /[\u0000-\u001f]/.test(row.formaPgto)))
      throw new Error(`Informe uma forma de pagamento válida em ${rubric.label}.`);
    const line = { rubrica: rubric.id, label: rubric.label, quantity: quantity.toFixed(), unitValue: unitValue.toFixed(),
      formaPgto: row.formaPgto?.trim() || null };
    return { ...line, total: payrollTotal([line]) };
  });
}

export function weeklyPayslipTotal(lines) {
  return payrollTotal(lines);
}
