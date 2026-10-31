const key = value => String(value ?? '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const NAMES = ['DATAPREVISTOPGTO', 'DATAPGTOEFETUADO', 'PGTOAGENDADO', 'STATUS'];
const status = value => String(value ?? '').trim().toUpperCase();

export function provisionDueFields(columns = []) {
  return Object.fromEntries(NAMES.map(name => {
    const internal = columns.filter(column => key(column.name) === name);
    const matches = internal.length ? internal : columns.filter(column => key(column.displayName) === name);
    if (matches.length > 1) throw new Error(`Metadados ambíguos de ${name} para o vencimento do descritivo.`);
    return [name, matches[0]?.name || name];
  }));
}

function day(value) {
  const text = String(value ?? '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/);
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!iso && !br) return '';
  const result = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : `${br[3]}-${br[2]}-${br[1]}`;
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result
    || iso && text.includes('T') && !Number.isFinite(Date.parse(text))) return '';
  return result;
}

export function sameProvisionDue(left, right) {
  const a = day(left), b = day(right);
  return a && b ? a === b : String(left ?? '') === String(right ?? '');
}

export function provisionEarliestUnpaidDue(children, names = provisionDueFields()) {
  let earliest = '';
  for (const { fields = {} } of children) {
    // Same proof as provision_description_review.provision_is_paid: a real
    // payment date AND a final payment marker. Scheduling alone proves nothing.
    if (day(fields[names.DATAPGTOEFETUADO]) && (status(fields[names.PGTOAGENDADO]) === 'PAGO'
      || status(fields[names.STATUS]) === 'PAGAMENTO EFETUADO')) continue;
    const due = day(fields[names.DATAPREVISTOPGTO]);
    if (!due) throw new Error('Provisão não comprovadamente paga sem data de vencimento válida; recálculo interrompido.');
    if (!earliest || due < earliest) earliest = due;
  }
  return earliest ? `${earliest}T00:00:00Z` : null;
}

export function provisionChildrenStamp(children) {
  return JSON.stringify(children.map(row => [String(row.id), String(row.eTag || row['@odata.etag'] || ''),
    Object.entries(row.fields || {}).sort(([a], [b]) => a.localeCompare(b))])
    .sort(([a], [b]) => a.localeCompare(b)));
}
