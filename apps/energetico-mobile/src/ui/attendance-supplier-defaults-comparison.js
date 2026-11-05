import {escapeHtml} from './escape-html.js';

const display = value => value === null || value === undefined || String(value).trim() === '' ? 'EM BRANCO' : String(value);

export function supplierDefaultsComparisonMarkup(table) {
  if (table?.kind !== 'presence' || table.variant !== 'supplier_defaults_comparison' || !Array.isArray(table.rows) || !table.rows.length) return '';
  return `<div class="chat-supplier-defaults-wrap"><table class="chat-supplier-defaults-table" aria-label="Antes e depois dos padrões dos fornecedores">
    <thead><tr><th scope="col">Fornecedor</th><th scope="col">Antes</th><th scope="col">Depois</th></tr></thead>
    ${table.rows.map(row => `<tbody><tr><th class="chat-supplier-defaults-name" scope="rowgroup" rowspan="2">${escapeHtml(display(row?.supplier))}${row?.branch ? `<small>${escapeHtml(row.branch)}</small>` : ''}</th><td class="is-before"><small>Descritivo etapa</small>${escapeHtml(display(row?.descriptor?.before))}</td><td class="is-after"><small>Descritivo etapa</small>${escapeHtml(display(row?.descriptor?.after))}</td></tr><tr><td class="is-before"><small>Atividade executada</small>${escapeHtml(display(row?.activity?.before))}</td><td class="is-after"><small>Atividade executada</small>${escapeHtml(display(row?.activity?.after))}</td></tr></tbody>`).join('')}
  </table>${table.available === false ? '<p class="chat-supplier-defaults-warning" role="alert">Não foi possível consultar os padrões. Consulte novamente ou submeta sem alterar os cadastros.</p>' : ''}</div>`;
}
