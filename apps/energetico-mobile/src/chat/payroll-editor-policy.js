import { PAYROLL_RUBRICS } from './supplier-payroll.js';
import { createPayrollProvisionReader, payrollProvisionId } from './payroll-provision-source.js';
import { payrollTaxType } from './payroll-tax-competence.js';

export const payrollFieldKey = value => String(value || '')
  .replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function payrollEditorColumns(columns, sheetOptions=[], launchOptions=[], {lockTaxIdentity=false}={}) {
  return columns.filter(c => !['TITLE','IDPROVISAO'].includes(payrollFieldKey(c.name))).map(column => {
    const name = payrollFieldKey(column.name);
    if(lockTaxIdentity&&['IDFOLHA','IDLANCAMENTO','TIPOPGTO'].includes(name))return {...column,readOnly:true,disabled:true,required:false};
    if (['VALORUNITARIO', 'QTD'].includes(name)) return { ...column, readOnly: true, required: false };
    if(name==='FORNECEDOR') return {...column,readOnly:true,disabled:true,required:false};
    if(name==='IDFOLHA') return {...column,control:'select',required:true,allowMultipleValues:false,choices:sheetOptions.map(option=>option.value),optionLabels:Object.fromEntries(sheetOptions.map(option=>[option.value,option.label])),powerApps:{closed:true,preserveCurrentValue:false}};
    if(name==='IDLANCAMENTO') return {...column,control:'select',required:true,allowMultipleValues:false,choices:launchOptions.map(option=>option.value),optionLabels:Object.fromEntries(launchOptions.map(option=>[option.value,option.label])),powerApps:{closed:true,preserveCurrentValue:false}};
    if (name!=='TIPOPGTO' || ['lookup', 'person'].includes(column.control)) return column;
    const choices = (column.choices?.length ? column.choices : PAYROLL_RUBRICS.map(r => r.payrollType)).filter(value=>!payrollTaxType(value));
    return { ...column, control: 'select', allowMultipleValues: false, choices,
      powerApps: { closed: true, choices, optionSources:[], preserveCurrentValue: true } };
  }).sort((a,b)=>{const order=['DATA','IDFOLHA','FORNECEDOR','IDLANCAMENTO','VALORUNITARIO','QTD'];const rank=c=>order.indexOf(payrollFieldKey(c.name));return (rank(a)<0?order.length:rank(a))-(rank(b)<0?order.length:rank(b));});
}

/** Re-read linked financial values on every refresh; never write copied values back. */
export function createPayrollSourceReader(repository, siteKey) {
  const readProvision = createPayrollProvisionReader(repository, siteKey);
  let descriptorPromise;
  async function descriptor() {
    return descriptorPromise ||= (async () => {
      const list = await repository.resolveList(siteKey, ['LANCAMENTOS', 'LANÇAMENTOS']);
      if (list?.status !== 'resolved' || !list.id) throw new Error('A base LANCAMENTOS não está disponível.');
      const columns = await repository.getColumns(siteKey, list.id);
      const find = aliases => columns.find(c => [c.name, c.displayName].some(n => aliases.includes(payrollFieldKey(n))))?.name;
      const amount = find(['VALORUNITARIO']), quantity = find(['QUANTIDADE', 'QTD']);
      if (!amount || !quantity) throw new Error('Valor unitário e quantidade não foram identificados em LANCAMENTOS.');
      return { list, amount, quantity, supplier:find(['FORNECEDOR']) };
    })().catch(error => { descriptorPromise = null; throw error; });
  }
  return async function read(fields, signal) {
    if (payrollProvisionId(fields)) return readProvision(fields, signal);
    const link = Object.entries(fields || {}).find(([n]) => payrollFieldKey(n) === 'IDLANCAMENTO')?.[1];
    if (link == null || String(link).trim() === '') return {};
    const id = String(link).trim();
    if (!/^[1-9]\d{0,14}$/.test(id)) throw new Error('O vínculo IDLANCAMENTO da folha é inválido.');
    const { list, amount, quantity, supplier } = await descriptor();
    const item = await repository.getItem(siteKey, list.id, id, '$expand=fields', signal ? { signal } : {});
    if (String(item?.id) !== id || item.fields?.[amount] == null || item.fields?.[quantity] == null) {
      throw new Error(`Não foi possível conferir o lançamento ${id} da folha.`);
    }
    const tax=payrollTaxType(Object.entries(fields||{}).find(([name])=>payrollFieldKey(name)==='TIPOPGTO')?.[1]);
    if(tax) {
      const employee=Object.entries(fields||{}).find(([name])=>payrollFieldKey(name)==='FORNECEDOR')?.[1];
      if(!supplier||!String(employee??'').trim()||payrollFieldKey(item.fields?.[supplier])!==payrollFieldKey(employee))throw new Error('O fornecedor do lançamento do encargo não corresponde ao funcionário da folha.');
    }
    const number = value => {
      const normalized = typeof value === 'string' && value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value;
      if (String(normalized).trim() === '' || !Number.isFinite(Number(normalized))) throw new Error(`O lançamento ${id} contém valores inválidos.`);
      return Number(normalized);
    };
    return { VALORUNITARIO: number(item.fields[amount]), QTD: number(item.fields[quantity]) };
  };
}
