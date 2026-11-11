import {escapeHtml} from './escape-html.js';

const display = value => value === null || value === undefined || String(value).trim() === '' ? 'EM BRANCO' : String(value);

export function provisionVariationChangesMarkup(table, question = '') {
  if (table?.kind !== 'provision_variation_changes'
      || !/HÁ ALGUMA VARIAÇÃO EM RELAÇÃO À LINHA ANTERIOR\?/iu.test(question)) return '';
  return fieldChangesMarkup(table.rows, 'Alterações nesta linha da provisão', 'Dado alterado');
}

export function fieldChangesMarkup(changes, label, columnTitle) {
  if (!Array.isArray(changes)) return '';
  const rows = changes.filter(row => row && typeof row.field === 'string' && row.field.trim());
  if (!rows.length) return '';
  return `<div class="chat-provision-changes"><table aria-label="${escapeHtml(label)}">
    <thead><tr><th scope="col">${escapeHtml(columnTitle)}</th><th scope="col">Antes</th><th scope="col">Depois</th></tr></thead>
    <tbody>${rows.map(row => `<tr><th scope="row">${escapeHtml(row.field)}</th><td class="is-before">${escapeHtml(display(row.before))}</td><td class="is-after">${escapeHtml(display(row.after))}</td></tr>`).join('')}</tbody>
  </table></div>`;
}
