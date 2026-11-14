import Decimal from 'decimal.js';

const applicationPrefix = 'IDFOLHA-PENDENTE:';

export const isPayrollAllocation = (fields) => typeof fields?.Title === 'string' && fields.Title.startsWith(applicationPrefix);

/** Allocation rows own the apportioned amount; IDLANCAMENTO only identifies the original payment. */
export function readPayrollAllocation(fields) {
  if (!isPayrollAllocation(fields)) return null;
  const amount = String(fields.VALORUNITARIO ?? '').trim();
  const original = String(fields.IDLANCAMENTO ?? '').trim();
  if (!/^IDFOLHA-PENDENTE:[a-f0-9]{64}:[a-f0-9]{64}$/.test(fields.Title)
    || !/^[1-9]\d{0,14}$/.test(original) || !/^[1-9]\d{0,14}$/.test(String(fields.IDFOLHA ?? '').trim())
    || fields.IDPROVISAO != null && !['', '0'].includes(String(fields.IDPROVISAO).trim())
    || !/^1(?:[.,]0+)?$/.test(String(fields.QTD ?? '').trim())
    || !/^\d+(?:[.,]\d{1,2})?$/.test(amount)) {
    throw new Error('Os dados do rateio vinculado à folha são inconsistentes.');
  }
  const cents = new Decimal(amount.replace(',', '.')).times(100).toNumber();
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error('O rateio vinculado à folha não tem um valor válido.');
  }
  return { VALORUNITARIO: cents / 100, QTD: 1, TOTALCENTAVOS: cents, PGTOAGENDADO: 'PAGO' };
}
