import { PAYROLL_RUBRICS } from './supplier-payroll.js';

export const payrollFieldKey = value => String(value || '')
  .replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function payrollEditorColumns(columns) {
  return columns.filter(c => payrollFieldKey(c.name) !== 'TITLE').map(column => {
    const name = payrollFieldKey(column.name);
    if (['VALORUNITARIO', 'QTD'].includes(name)) return { ...column, readOnly: true, required: false };
    if (!['FORNECEDOR', 'TIPOPGTO'].includes(name) || ['lookup', 'person'].includes(column.control)) return column;
    const choices = name === 'TIPOPGTO' ? (column.choices?.length ? column.choices : PAYROLL_RUBRICS.map(r => r.payrollType)) : [];
    const optionSources = name === 'FORNECEDOR' ? [{ kind: 'related', listName: 'FORNECEDORES', valueField: 'CADASTRO', displayFields: ['CADASTRO'], searchFields: ['CADASTRO'] }] : [];
    return { ...column, control: 'select', allowMultipleValues: false, choices,
      powerApps: { closed: true, choices, optionSources, preserveCurrentValue: true } };
  });
}

/** Re-read linked financial values on every refresh; never write copied values back. */
export function createPayrollSourceReader(repository, siteKey) {
  let descriptorPromise;
  async function descriptor() {
    return descriptorPromise ||= (async () => {
      const list = await repository.resolveList(siteKey, ['LANCAMENTOS', 'LANÇAMENTOS']);
      if (list?.status !== 'resolved' || !list.id) throw new Error('A base LANCAMENTOS não está disponível.');
      const columns = await repository.getColumns(siteKey, list.id);
      const find = aliases => columns.find(c => [c.name, c.displayName].some(n => aliases.includes(payrollFieldKey(n))))?.name;
      const amount = find(['VALORUNITARIO']), quantity = find(['QUANTIDADE', 'QTD']);
      if (!amount || !quantity) throw new Error('Valor unitário e quantidade não foram identificados em LANCAMENTOS.');
      return { list, amount, quantity };
    })().catch(error => { descriptorPromise = null; throw error; });
  }
  return async function read(fields, signal) {
    const link = Object.entries(fields || {}).find(([n]) => payrollFieldKey(n) === 'IDLANCAMENTO')?.[1];
    if (link == null || String(link).trim() === '') return {};
    const id = String(link).trim();
    if (!/^[1-9]\d{0,14}$/.test(id)) throw new Error('O vínculo IDLANCAMENTO da folha é inválido.');
    const { list, amount, quantity } = await descriptor();
    const item = await repository.getItem(siteKey, list.id, id, '$expand=fields', signal ? { signal } : {});
    if (String(item?.id) !== id || item.fields?.[amount] == null || item.fields?.[quantity] == null) {
      throw new Error(`Não foi possível conferir o lançamento ${id} da folha.`);
    }
    const number = value => {
      const normalized = typeof value === 'string' && value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value;
      if (String(normalized).trim() === '' || !Number.isFinite(Number(normalized))) throw new Error(`O lançamento ${id} contém valores inválidos.`);
      return Number(normalized);
    };
    return { VALORUNITARIO: number(item.fields[amount]), QTD: number(item.fields[quantity]) };
  };
}
