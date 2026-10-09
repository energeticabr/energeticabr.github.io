// Read-only projection of the worker's confirmed-write notice. This does not
// submit data or prove a write; unrecognized/partial notices keep their text.
export function postingCompletion(message) {
  if (message?.role === 'user' || (message?.type && message.type !== 'text')
    || message?.presence_confirmation || message?.presenceConfirmation
    || message?.payment_audit_table || message?.paymentAuditTable
    || message?.detail_table || message?.detailTable || message?.presenceDateSummary) return null;
  const lines = String(message?.text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const plain = lines.map(line => line.replaceAll('*', ''));
  if (/\bNÃO\b/i.test(plain[0] || '')) return null;
  if (plain.some(line => /❌|\b(?:erro|falha)\b|NÃO (?:FOI|FORAM|GRAVAD|CADASTRAD|REGISTRAD)/i.test(line))) return null;
  const heading = plain[0]?.match(/^(?:✅\s*)?(?:🟢\s*)?([\p{L}\d][\p{L}\d /()&.,-]* (?:GRAVAD[OA]S?|CADASTRAD[OA]S?|REGISTRAD[OA]S?|ATUALIZAD[OA]S?|VINCULAD[OA]S?|ELIMINAD[OA]S?)) NA BASE DE DADOS ([\p{L}\d][\p{L}\d /()&.,_-]*) ÀS ((?:[01]\d|2[0-3]):[0-5]\d)\.?\s*(?:🕒)?$/iu);
  if (!heading || !/^(?:🆔\s*)?REGISTROS CONFIRMADOS:$/i.test(plain[1] || '')) return null;
  const records = [];
  const notes = [];
  let identifiers = 0;
  for (let i = 2; i < plain.length; i++) {
    const line = plain[i];
    if (/^(?:•\s*)?(?:⚠|🚨|❗|❕|AVISO\b|ATENÇÃO\b|ATENCAO\b)/i.test(line)) {
      notes.push(lines[i]);
      continue;
    }
    const identifier = line.match(/^•\s*([^:<>]+):\s*(IDS? [1-9]\d*(?:,\s*[1-9]\d*)*)$/i);
    const amount = line.match(/^💰\s*([^:<>]+):\s*(R\$\s*(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2})$/i);
    if (identifier) {
      identifiers++;
      records.push(Object.freeze({ label: identifier[1].trim(), value: identifier[2], icon: /^PEDIDOS?$/i.test(identifier[1]) ? 'order' : 'launch' }));
    } else if (amount) {
      records.push(Object.freeze({ label: amount[1].trim(), value: amount[2], icon: 'total' }));
    } else if (/^•[^:]*:\s*IDS?\b|^💰[^:]*:\s*R\$/i.test(line)) {
      return null; // Do not hide a malformed identifier/amount in notes.
    } else {
      notes.push(lines[i]);
    }
  }
  if (!identifiers) return null;
  return Object.freeze({ title: heading[1], database: heading[2], time: heading[3], records: Object.freeze(records), notes: Object.freeze(notes) });
}
