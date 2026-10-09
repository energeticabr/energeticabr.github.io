import { escapeHtml } from './escape-html.js';

const icons = {
  launch: '<path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M9 8h6M9 12h6M9 16h6"/>',
  order: '<path d="M2 3h3l3 12h11l3-8H6M9 19h.01M18 19h.01"/>',
  total: '<path d="m8 3 2 4h4l2-4ZM10 7c-4 4-6 6-6 10 0 3 3 4 8 4s8-1 8-4c0-4-2-6-6-10"/><path d="M14 11h-3a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-3M12 10v10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const row = (label, value, name) => `<div class="launch-completion__row"><dt>${icon(name)}<span>${label}</span></dt><dd>${escapeHtml(value)}</dd></div>`;

export function singleLaunchCompletionMarkup(receipt) {
  return `<section class="launch-completion" aria-label="Lançamento gravado">
    <header class="launch-completion__success">
      <span class="launch-completion__check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg></span>
      <div><h2>LANÇAMENTO GRAVADO!</h2><p>Os dados foram registrados com sucesso na base de dados LANCAMENTOS às ${escapeHtml(receipt.time)}.</p></div>
    </header>
    <h3 class="launch-completion__title"><span aria-hidden="true">🆔</span> REGISTROS CONFIRMADOS</h3>
    <dl class="launch-completion__records">
      ${row('LANÇAMENTO', `ID ${receipt.launchId}`, 'launch')}
      ${receipt.orderId ? row('PEDIDO', `ID ${receipt.orderId}`, 'order') : ''}
      ${row('VALOR TOTAL DOS LANÇAMENTOS', receipt.total, 'total')}
    </dl>
    <footer>${icon('clock')}<span>Registrado às ${escapeHtml(receipt.time)}</span></footer>
  </section>`;
}
