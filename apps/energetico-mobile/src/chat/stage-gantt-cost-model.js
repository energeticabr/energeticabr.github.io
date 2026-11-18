import { stageReportGroupKey } from './operations-reports-model.js';
import { buildSpendingReport9, managementExpensePeriods } from './spending-reports-model.js';
import { normalizeStageProgressDate } from './stage-progress-model.js';

export function buildGanttCostDetail(snapshot, selection, filters = {}) {
  if (!snapshot || snapshot.error || snapshot.partial || snapshot.truncated || snapshot.aborted
    || snapshot.complete === false || !['launches', 'provisions', 'productTypes'].every(name => Array.isArray(snapshot[name]))) {
    throw new TypeError('O custo exige um snapshot completo.');
  }
  if (typeof selection?.branch !== 'string' || !selection.branch.trim()
    || typeof selection?.stage !== 'string' || !selection.stage.trim()) {
    throw new TypeError('Informe a filial e a etapa do custo.');
  }
  const selectedKey = stageReportGroupKey(selection);
  const scoped = { productTypes: snapshot.productTypes };
  for (const name of ['launches', 'provisions']) {
    scoped[name] = snapshot[name].filter(row => stageReportGroupKey(row) === selectedKey).map(row => ({
      ...row, ...selection,
      ...(name === 'launches' ? { paymentDate: normalizeStageProgressDate(row.paymentDate) }
        : { dueDate: normalizeStageProgressDate(row.dueDate) }),
    }));
  }
  const periods = managementExpensePeriods(scoped);
  const years = [...new Set(periods.map(period => period.slice(0, 4)))].reverse();
  const year = years.includes(filters.year) ? filters.year : years[0] || '';
  const months = periods.filter(period => period.startsWith(`${year}-`)).map(period => String(Number(period.slice(5))));
  const month = filters.month === '' ? '' : months.includes(filters.month) ? filters.month : months.at(-1) || '';
  return { years, months, year, month, report: buildSpendingReport9(scoped, { ...selection, year, month }) };
}
