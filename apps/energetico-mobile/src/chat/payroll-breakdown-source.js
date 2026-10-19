import Decimal from 'decimal.js';
import { payrollKey } from './supplier-payroll.js';
import { payrollFieldKey } from './payroll-editor-policy.js';
import { createPayrollProvisionReader, payrollProvisionId } from './payroll-provision-source.js';

const scalar = value => String(value?.LookupValue ?? value?.Value ?? value?.value ?? value ?? '').trim();
const identity = value => {
  const id = scalar(value);
  if (!/^[1-9]\d{0,14}$/.test(id)) throw new Error('O vínculo financeiro da folha é inválido.');
  return id;
};

/** Breakdown-only legacy reader: source ownership and applicable links precede money. */
export function createPayrollBreakdownSourceReader(repository, siteKey) {
  const readProvision = createPayrollProvisionReader(repository, siteKey);
  return async (payment, supplier) => {
    if (payrollProvisionId(payment)) return readProvision(payment);
    if (scalar(payment.IDPROVISAO)) throw new Error('O vínculo da provisão da folha é inconsistente.');
    if (!payrollKey(supplier?.label) || !payrollKey(supplier?.branch)) throw new Error('Confira o fornecedor e a filial da folha.');
    async function read(names, id) {
      id = identity(id);
      const list = await repository.resolveList(siteKey, names);
      if (!list?.id || list.status !== 'resolved') throw new Error(`A lista ${names[0]} não está disponível.`);
      const columns = await repository.getColumns(siteKey, list.id);
      if (!Array.isArray(columns)) throw new Error(`Os campos de ${names[0]} não estão disponíveis.`);
      const item = await repository.getItem(siteKey, list.id, id, '$expand=fields');
      if (String(item?.id) !== id) throw new Error(`O vínculo ${names[0]} ${id} não foi confirmado.`);
      return (labels, optional = false) => {
        labels = Array.isArray(labels) ? labels : [labels];
        const keys = labels.map(payrollFieldKey);
        const matches = columns.filter(c => !c.computed && !c.hidden && [c.name,c.displayName].some(n => keys.includes(payrollFieldKey(n))));
        const exact = matches.filter(c => keys.includes(payrollFieldKey(c.name)));
        // Graph can expose read-only LinkTitle mirrors without a computed facet.
        // A renamed writable Title is the actual source, not those visual links.
        const writable = matches.filter(c => !c.readOnly);
        const found = exact.length ? exact : writable.length ? writable : matches;
        if (!found.length && optional) return '';
        if (found.length !== 1) throw new Error(`O campo ${labels[0]} de ${names[0]} não foi identificado de forma única.`);
        return scalar(item.fields?.[found[0].name]);
      };
    }
    function owned(value) {
      if (payrollKey(value('FORNECEDOR')) !== payrollKey(supplier.label)) throw new Error('O fornecedor do vínculo financeiro mudou.');
      if (payrollKey(value('FILIAL')) !== payrollKey(supplier.branch)) throw new Error('A filial do vínculo financeiro mudou.');
    }
    function linked(value) {
      const sheet = value('IDFOLHA',true), type = value('TIPOPGTO',true);
      if (sheet && sheet !== scalar(payment.IDFOLHA) || type && payrollKey(type) !== payrollKey(payment.TIPOPGTO))
        throw new Error('O vínculo da folha ou rubrica financeira mudou.');
    }
    const launchId = identity(payment.IDLANCAMENTO), launch = await read(['LANCAMENTOS','LANÇAMENTOS'],launchId);
    owned(launch); linked(launch);
    const provisionId = launch('IDPGTOAGENDADO',true), orderId = launch('AGRUPAR',true);
    if (provisionId) {
      const provision = await read(['PROVISÃO PGTOS','PROVISAO PGTOS','PROVISAO PAGAMENTOS'],provisionId);
      owned(provision); linked(provision);
      const links = provision('IDLANCAMENTOS');
      if (!/^[1-9]\d*(?:\s*[,;\r\n]\s*[1-9]\d*)*$/.test(links) || !links.split(/[,;\r\n]/).map(s=>s.trim()).includes(launchId))
        throw new Error('O vínculo reverso da provisão mudou.');
      const provisionOrder = provision('IDPEDIDO',true);
      if (provisionOrder !== orderId) throw new Error('O pedido vinculado à provisão mudou.');
    }
    if (orderId) { const order = await read(['NOTASPENDENTES'],orderId); owned(order); }
    const decimal = raw => {
      const normalized = raw.includes(',') ? raw.replace(/\./g,'').replace(',','.') : raw;
      if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`O lançamento ${launchId} contém valores inválidos.`);
      const value = new Decimal(normalized);
      if (!value.isFinite() || value.abs().gt(1e12)) throw new Error(`O lançamento ${launchId} contém valores inválidos.`);
      return value;
    };
    const unit = decimal(launch('VALORUNITARIO')), quantity = decimal(launch(['QUANTIDADE','QTD']));
    const cents = unit.times(quantity).plus(decimal(launch('FRETE') || '0')).toDecimalPlaces(2,Decimal.ROUND_HALF_UP).times(100);
    if (!Number.isSafeInteger(cents.toNumber())) throw new Error(`O valor do lançamento ${launchId} excede o limite monetário.`);
    return { VALORUNITARIO: unit.toNumber(), QTD: quantity.toNumber(), TOTALCENTAVOS: cents.toNumber() };
  };
}
