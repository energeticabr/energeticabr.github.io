const key = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const technical = /^(ID|TITLE|ETAG|ODATA.*|FIELDS|FIELD\d+|ATTACHMENTS?|ATTACHMENTFILES|HASATTACHMENTS|EXPECTEDMODIFIED)$/;
const text = value => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  if (typeof value === 'object') return text(value.LookupValue ?? value.Value ?? value.DisplayName ?? value.Title ?? value.label);
  return String(value);
};

/** Snapshot only the display fields; no extra network reads after the record is deleted. */
export function galleryDeletionFields(fields, format = (_name, value) => text(value)) {
  return Object.entries(fields || {})
    .filter(([name, value]) => !technical.test(key(name)) && !name.startsWith('@') && value != null && value !== '')
    .map(([name, value]) => ({ label: name.replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))), value: format(name, value) }));
}

export function deletionReceipt({ id, galleryTitle, records, confirmedAt }) {
  const timestamp = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium',
  }).format(confirmedAt);
  const seen = new Set(['ID']);
  const details = [];
  for (const record of records || []) {
    const label = text(record.label).trim(), value = text(record.value).trim();
    if (!label || !value || value === '—' || seen.has(key(label))) continue;
    seen.add(key(label));
    details.push({ label, value, icon: 'launch' });
  }
  return {
    kind: 'deletion', title: 'REGISTRO EXCLUÍDO', database: galleryTitle || 'Galeria',
    records: [
      { label: 'ID', value: String(id), icon: 'launch' },
      ...details,
      { label: 'Confirmação no aplicativo (Brasília)', value: timestamp, icon: 'clock' },
    ],
  };
}
