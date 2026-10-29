export const SEFAZ_RETENTION_FIELDS = Object.freeze({
  PIS_RETIDO: 'PIS retido', COFINS_RETIDA: 'COFINS retida', CSLL_RETIDA: 'CSLL retida',
  CONTRIB_SOCIAIS_RETIDAS: 'PIS/COFINS/CSLL retidos',
  IRRF_RETIDO: 'IRRF retido', INSS_RETIDO: 'INSS retido', ISS_RETIDO: 'ISS retido',
});

const code = value => String(value ?? '').trim().toUpperCase().replace(/\s+/g, '_');

export function fiscalDocumentType(fields = {}) {
  const explicit = {'NF-E':'NF-e','CT-E':'CT-e','NFS-E':'NFS-e'}[code(fields.TIPO_FISCAL)];
  return explicit || ({'55':'NF-e','57':'CT-e','67':'CT-e','NFS-E':'NFS-e'}[code(fields.MODELO)] || '');
}

// This is a display of XML-declared withholding, not a calculation of tax liability.
export function buyerWithholding(fields = {}) {
  const type = fiscalDocumentType(fields), roles = String(fields.PAPEL_EMPRESA ?? '').split(';').map(code);
  if ((type === 'NFS-e' || type === 'CT-e') && !roles.includes('TOMADOR')) return null;
  if (code(fields.STATUS_RETENCOES) !== 'RETENCAO_INFORMADA_XML' || code(fields.STATUS_IMPORTACAO) !== 'XML_COMPLETO'
      || code(fields.DIRECAO) !== 'ENTRADA' || code(fields.SITUACAO) !== 'AUTORIZADA') return null;
  const centsOf = raw => {
    if (typeof raw !== 'number' && !(typeof raw === 'string' && /^\d+(?:\.\d{1,2})?$/.test(raw))) return null;
    const cents = Math.round(Number(raw) * 100);
    return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
  };
  const socialAggregate = centsOf(fields.CONTRIB_SOCIAIS_RETIDAS);
  const amounts = Object.entries(SEFAZ_RETENTION_FIELDS).flatMap(([field, label]) => {
    if (socialAggregate > 0 && ['PIS_RETIDO', 'COFINS_RETIDA', 'CSLL_RETIDA'].includes(field)) return [];
    const cents = centsOf(fields[field]);
    return cents > 0 ? [{field, label, cents}] : [];
  });
  const totalCents = centsOf(fields.TOTAL_RETIDO) ?? amounts.reduce((sum, item) => sum + item.cents, 0);
  return Number.isSafeInteger(totalCents) && totalCents > 0 ? {amounts, total: totalCents / 100} : null;
}
