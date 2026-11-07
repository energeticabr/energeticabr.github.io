import {escapeHtml} from './escape-html.js';

const display = value => value === null || value === undefined || String(value).trim() === '' ? 'EM BRANCO' : String(value);

export function provisionVariationChangesMarkup(table, question = '') {
  if (table?.kind !== 'provision_variation_changes'
      || !/HÁ ALGUMA VARIAÇÃO EM RELAÇÃO À LINHA ANTERIOR\?/iu.test(question)
      || !Array.isArray(table.rows) || !table.rows.length) return '';
  const rows = table.rows.filter(row => row && typeof row.field === 'string' && row.field.trim());
  if (!rows.length) return '';
  return `<div class="chat-provision-changes"><table aria-label="Alterações nesta linha da provisão">
    <thead><tr><th scope="col">Dado alterado</th><th scope="col">Antes</th><th scope="col">Depois</th></tr></thead>
    <tbody>${rows.map(row => `<tr><th scope="row">${escapeHtml(row.field)}</th><td class="is-before">${escapeHtml(display(row.before))}</td><td class="is-after">${escapeHtml(display(row.after))}</td></tr>`).join('')}</tbody>
  </table></div>`;
}
