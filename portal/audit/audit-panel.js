import { escapeHtml } from "../core/utils.js";

function rowsMarkup(rows) {
  if (!(rows || []).length) return '<p class="dashboard-empty">Nenhuma movimentação nesta data.</p>';
  return `<ul class="dashboard-list">${rows.map(row => `<li><strong>${escapeHtml(row.label)}</strong><span>${row.created} criado(s) · ${row.edited} editado(s)</span></li>`).join("")}</ul>`;
}
export function auditPanelMarkup(summary = {}) {
  return `<section class="dashboard-section dashboard-audit" aria-labelledby="dashboardAuditTitle">
    <div class="dashboard-section-heading"><div><p class="page-eyebrow">Rastreabilidade SharePoint</p><h2 id="dashboardAuditTitle">Auditoria por data</h2></div>
      <label>Data <input type="date" data-audit-date value="${escapeHtml(summary.date || "")}"></label>
    </div>
    <section class="dashboard-metrics" aria-label="Totais de auditoria">
      <article class="dashboard-metric"><strong>${Number(summary.created) || 0}</strong><span>Criados</span></article>
      <article class="dashboard-metric"><strong>${Number(summary.edited) || 0}</strong><span>Editados</span></article>
    </section>
    <div class="dashboard-columns">
      <section><h3>Por base</h3>${rowsMarkup(summary.bySource)}</section>
      <section><h3>Por usuário</h3>${rowsMarkup(summary.byUser)}</section>
    </div>
  </section>`;
}
