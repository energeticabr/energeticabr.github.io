import { escapeHtml } from "../core/utils.js";

function safeId(value) {
  return String(value || "chart").replace(/[^A-Za-z0-9_-]/g, "-");
}
export function interactiveBarChartMarkup(model = {}) {
  const series = model.series || [];
  const width = 640;
  const rowHeight = 42;
  const labelWidth = 150;
  const chartWidth = width - labelWidth - 54;
  const height = Math.max(92, 42 + series.length * rowHeight);
  const maximum = Math.max(1, ...series.map(row => Number(row.value) || 0));
  const bars = series.map((row, index) => {
    const y = 28 + index * rowHeight;
    const barWidth = Math.max(2, Math.round(((Number(row.value) || 0) / maximum) * chartWidth));
    const active = String(model.activeValue || "") === String(row.key);
    const label = `${row.label}: ${Number(row.value) || 0}`;
    return `<g role="button" tabindex="0" aria-label="${escapeHtml(label)}" aria-pressed="${active}" data-chart-dimension="${escapeHtml(model.dimension)}" data-chart-value="${escapeHtml(row.key)}">
      <text x="0" y="${y + 16}" fill="#153a4c" font-size="13">${escapeHtml(row.label)}</text>
      <rect x="${labelWidth}" y="${y}" width="${barWidth}" height="24" rx="4" fill="${active ? "#0b6b4d" : "#1776a8"}"></rect>
      <text x="${labelWidth + barWidth + 8}" y="${y + 17}" fill="#153a4c" font-size="13" font-weight="700">${Number(row.value) || 0}</text>
    </g>`;
  }).join("");
  return `<section class="dashboard-section dashboard-chart" aria-labelledby="${safeId(model.id)}Title">
    <div class="dashboard-section-heading"><h2 id="${safeId(model.id)}Title">${escapeHtml(model.title || "Indicador")}</h2></div>
    ${series.length ? `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeHtml(model.title || "Gráfico interativo")}">${bars}</svg>` : '<p class="dashboard-empty">Sem dados para este recorte.</p>'}
  </section>`;
}
