import { payrollDecimal, payrollKey, validPayrollDate } from './supplier-payroll.js';

const prefix = 'APP-folha-provisao-';
export function payrollProvisionId(fields) {
  const title = String(fields?.Title ?? '').trim();
  if (!title.startsWith(prefix)) return '';
  const id = title.slice(prefix.length);
  if (!/^[1-9]\d{0,14}$/.test(id)) throw new Error('O vínculo da provisão da folha é inválido.');
  if (fields.IDPROVISAO != null && String(fields.IDPROVISAO).trim() !== '' && String(fields.IDPROVISAO).trim() !== id)
    throw new Error('O identificador exclusivo da provisão diverge do vínculo da folha.');
  return id;
}
export const payrollProvisionTitle = id => `${prefix}${id}`;

/** The provision is the source of truth for both its current value and settlement. */
export function createPayrollProvisionReader(repository, siteKey) {
  let description;
  async function describe() {
    return description ||= (async () => {
      const list = await repository.resolveList(siteKey, ['PROVISÃO PGTOS', 'PROVISAO PGTOS', 'PROVISAO PAGAMENTOS']);
      if (list?.status !== 'resolved' || !list.id) throw new Error('A lista de provisões não está disponível.');
      const columns = await repository.getColumns(siteKey, list.id);
      const fields = {};
      for (const label of ['IDFOLHA','FORNECEDOR','TIPOPGTO','QTD','VALORTOTAL','FRETE','DATAPGTOEFETUADO','DATAPREVISTOPGTO']) {
        const matches = columns.filter(c => !c.computed && !c.hidden && [c.name,c.displayName].some(name => payrollKey(name) === payrollKey(label)));
        const exact = matches.filter(c => payrollKey(c.name) === payrollKey(label));
        const found = exact.length ? exact : matches;
        if (found.length !== 1) throw new Error(`O campo ${label} da provisão não foi identificado de forma única.`);
        fields[label] = found[0].name;
      }
      return { list, fields };
    })().catch(error => { description = null; throw error; });
  }
  return async (payment, signal) => {
    const id = payrollProvisionId(payment);
    if (!id) return {};
    const { list, fields } = await describe();
    const item = await repository.getItem(siteKey, list.id, id, '$expand=fields', signal ? { signal } : {});
    if (String(item?.id) !== id) throw new Error(`Não foi possível conferir a provisão ${id} da folha.`);
    const value = label => item.fields?.[fields[label]];
    const canonical = label => Object.entries(payment).find(([name]) => payrollKey(name) === payrollKey(label))?.[1];
    if (String(value('IDFOLHA') ?? '').trim() !== String(canonical('IDFOLHA') ?? '').trim()
      || payrollKey(value('FORNECEDOR')) !== payrollKey(canonical('FORNECEDOR'))
      || payrollKey(value('TIPOPGTO')) !== payrollKey(canonical('TIPOPGTO')))
      throw new Error(`O vínculo da folha, fornecedor ou rubrica da provisão ${id} mudou.`);
    const unit = payrollDecimal(value('VALORTOTAL')), quantity = payrollDecimal(value('QTD'));
    if (!quantity.gt(0)) throw new Error(`Quantidade inválida na provisão ${id}.`);
    const total = unit.times(quantity).plus(payrollDecimal(value('FRETE') || 0)).toDecimalPlaces(2);
    const cents = total.times(100);
    if (!Number.isSafeInteger(cents.toNumber())) throw new Error(`O valor da provisão ${id} excede o limite monetário.`);
    const paidDate = String(value('DATAPGTOEFETUADO') ?? '').trim().slice(0,10);
    if (paidDate && !validPayrollDate(paidDate)) throw new Error(`Data de pagamento inválida na provisão ${id}.`);
    return { VALORUNITARIO: unit.toNumber(), QTD: quantity.toNumber(), TOTALCENTAVOS: cents.toNumber(),
      IDPROVISAO: id, PGTOAGENDADO: paidDate ? 'PAGO' : 'PENDENTE',
      DATA: paidDate || String(value('DATAPREVISTOPGTO') ?? '').slice(0,10) };
  };
}
