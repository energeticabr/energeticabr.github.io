import {escapeHtml} from './escape-html.js';

export function payrollAssignmentTableMarkup(table) {
  if (table?.kind !== 'payroll_assignment' || !Array.isArray(table.rows) || !table.rows.length) return '';
  const valid = table.rows.every(row => row && /^\d+$/.test(String(row.id))
    && Number(row.id) > 0 && typeof row.supplier === 'string' && row.supplier.trim()
    && typeof row.totalDisplay === 'string' && row.totalDisplay.trim());
  if (!valid) return '';
  return `<section class="payroll-assignment" data-payroll-assignment-table aria-label="Pagamentos em atribuição">
    <div class="payroll-assignment__scroll" role="region" aria-label="Tabela dos pagamentos em atribuição" tabindex="0">
      <table><caption class="sr-only">Pagamentos em atribuição</caption>
        <colgroup><col class="payroll-assignment__id"><col><col class="payroll-assignment__amount"></colgroup>
        <thead><tr><th scope="col">ID</th><th scope="col">FORNECEDOR</th><th scope="col">VALOR TOTAL</th></tr></thead>
        <tbody>${table.rows.map(row => `<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.supplier)}</td><td>${escapeHtml(row.totalDisplay)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </section>`;
}
