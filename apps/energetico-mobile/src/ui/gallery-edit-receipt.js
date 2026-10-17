const text = value => {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.map(text).join(', ') || '—';
  if (typeof value === 'object') return text(value.results ?? value.LookupValue ?? value.DisplayName ?? value.Title ?? value.label ?? value.LookupId);
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  return String(value);
};
const canonical = (value, column) => {
  if (value == null || value === '') return '';
  if (Array.isArray(value) || Array.isArray(value?.results)) return (value.results ?? value).map(v => String(v)).sort().join('\u0000');
  if (column.control === 'date') return String(value).slice(0, 10);
  if (column.control === 'datetime-local') return String(value).slice(0, 16);
  if (['number', 'currency'].includes(column.control) && Number.isFinite(Number(value))) return String(Number(value));
  if (column.control === 'checkbox') return /^(true|1)$/i.test(String(value)) ? 'true' : 'false';
  return String(value);
};
const display = (value, column) => {
  if (value == null || value === '') return '—';
  if (['date', 'datetime-local'].includes(column.control)) {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}${column.control === 'datetime-local' && match[4] ? ` ${match[4]}` : ''}`;
  }
  if (column.control === 'checkbox') return canonical(value, column) === 'true' ? 'Sim' : 'Não';
  if (column.control === 'currency' && Number.isFinite(Number(value))) return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (column.control === 'number' && Number.isFinite(Number(value))) return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 10 });
  return text(value);
};

/** Compare the loaded baseline with the fields actually submitted, before refresh changes the row. */
export function galleryEditChanges(context, fields, labels = {}, attachments = {}) {
  const original = context.item.fields;
  const changes = [];
  for (const column of context.columns) {
    if (column.readOnly || column.hidden || column.editable === false) continue;
    const relation = ['lookup', 'person'].includes(column.control);
    const name = relation && Object.hasOwn(fields, `${column.name}LookupId`) ? `${column.name}LookupId` : column.name;
    if (!Object.hasOwn(fields, name)) continue;
    const before = original[name], after = fields[name];
    if (canonical(before, column) === canonical(after, column)) continue;
    const relationshipDisplay = (value, label) => label ? `${text(label)} (ID: ${text(value)})` : text(value);
    changes.push({ label: column.label || column.name,
      before: relation ? relationshipDisplay(before, original[`${column.name}LookupValue`] ?? original[`${column.name}DisplayName`] ?? original[column.name]) : display(before, column),
      after: relation ? relationshipDisplay(after, labels[column.name]) : display(after, column) });
  }
  for (const file of attachments?.uploads || []) changes.push({ label: 'Anexo adicionado', before: '—', after: text(file.name) });
  for (const name of attachments?.deletions || []) changes.push({ label: 'Anexo removido', before: text(name), after: 'Removido' });
  return changes;
}

export function editReceipt({ id, galleryTitle, changes, confirmedAt }) {
  return { kind: 'edition', title: 'REGISTRO EDITADO', database: galleryTitle || 'Galeria',
    records: [
      { label: 'ID', value: String(id) },
      { label: 'Confirmação no aplicativo (Brasília)', value: new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium',
      }).format(confirmedAt) },
    ], changes: changes || [],
  };
}
