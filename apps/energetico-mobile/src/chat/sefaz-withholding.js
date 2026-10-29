export const SEFAZ_RETENTION_FIELDS = Object.freeze({
  PIS_RETIDO: 'PIS retido', COFINS_RETIDA: 'COFINS retida', CSLL_RETIDA: 'CSLL retida',
  IRRF_RETIDO: 'IRRF retido', INSS_RETIDO: 'INSS retido', ISS_RETIDO: 'ISS retido',
});

const code = value => String(value ?? '').trim().toUpperCase().replace(/\s+/g, '_');

// This is a display of XML-declared withholding, not a calculation of tax liability.
export function buyerWithholding(fields = {}) {
  if (code(fields.STATUS_RETENCOES) !== 'RETENCAO_INFORMADA_XML' || code(fields.STATUS_IMPORTACAO) !== 'XML_COMPLETO'
      || code(fields.DIRECAO) !== 'ENTRADA' || code(fields.SITUACAO) !== 'AUTORIZADA') return null;
  const amounts = Object.entries(SEFAZ_RETENTION_FIELDS).flatMap(([field, label]) => {
    const raw = fields[field];
    if (typeof raw !== 'number' && !(typeof raw === 'string' && /^\d+(?:\.\d{1,2})?$/.test(raw))) return [];
    const cents = Math.round(Number(raw) * 100);
    return Number.isSafeInteger(cents) && cents > 0 ? [{field, label, cents}] : [];
  });
  return amounts.length ? {amounts, total: amounts.reduce((sum, item) => sum + item.cents, 0) / 100} : null;
}
