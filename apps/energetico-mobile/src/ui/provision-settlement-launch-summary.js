import { escapeHtml } from './escape-html.js';

const money = 'R\\$\\s*(-?(?:\\d{1,3}(?:\\.\\d{3})+|\\d+),\\d{2})';
const rowPattern = new RegExp(`^PROVISÃO ([1-9]\\d*) — (.+) — QTD (.+) — TOTAL ${money}$`, 'u');
const quantityPattern = /^-?(?:\d+(?:[.,]\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?)$/u;

function totalCurrency(cents) {
  const digits = (cents < 0n ? -cents : cents).toString().padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${cents < 0n ? '-' : ''}${whole},${digits.slice(-2)}`;
}

// This legacy poll has totals, not unit prices. Render only received facts;
// in particular, total / quantity could incorrectly treat freight as unit price.
export function provisionSettlementLaunchSummaryMarkup(message) {
  const question = message?.question || message?.prompt;
  if (typeof question !== 'string') return '';
  const lines = question.trim().split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const heading = lines.shift()?.match(/^(?:👉\s*)?DESCRITIVO ([1-9]\d*) — RESUMO DAS LINHAS:$/u);
  if (!heading) return '';
  const rows = [], ids = new Set();
  let cents = 0n;
  while (lines.length && lines[0].startsWith('PROVISÃO ')) {
    const match = lines.shift().match(rowPattern);
    if (!match) return '';
    const [, id, product, quantity, amount] = match;
    if (ids.has(id) || !product.trim() || !quantityPattern.test(quantity)
      || / — (?:QTD|TOTAL) |PROVISÃO [1-9]\d* —/u.test(product)) return '';
    ids.add(id);
    cents += BigInt(amount.replace(/[.,]/gu, ''));
    rows.push({ id, product, quantity, amount });
  }
  if (!rows.length || lines.some(line => /^PROVISÃO\b/u.test(line))
    || !lines.some(line => line.startsWith('DESEJA ADICIONAR TODAS ESTAS LINHAS EM LANÇAMENTOS?'))) return '';
  const label = `Resumo das provisões do descritivo ${heading[1]}`;
  return `<section class="provision-review provision-launch-summary" data-provision-launch-summary aria-label="${escapeHtml(label)}">
    <h3>RESUMO — DESCRITIVO ${escapeHtml(heading[1])}</h3>
    <div class="provision-review__scroll" role="region" aria-label="${escapeHtml(label)}" tabindex="0">
      <table aria-label="${escapeHtml(label)}">
        <colgroup><col class="provision-launch-summary__product-col"><col class="provision-launch-summary__quantity-col"><col></colgroup>
        <thead><tr><th scope="col">PRODUTO / PROVISÃO</th><th scope="col">QTD</th><th scope="col">VALOR TOTAL</th></tr></thead>
        <tbody>${rows.map(row => `<tr data-provision-id="${escapeHtml(row.id)}">
          <th scope="row">${escapeHtml(row.product)}<small class="provision-launch-summary__id">Provisão #${escapeHtml(row.id)}</small></th>
          <td>${escapeHtml(row.quantity)}</td><td class="provision-review__total">R$ ${escapeHtml(row.amount)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="2" scope="row">TOTAL GERAL</th><td>${escapeHtml(totalCurrency(cents))}</td></tr></tfoot>
      </table>
    </div>
    ${lines.map(line => `<p class="${line.startsWith('DESEJA ADICIONAR') ? 'provision-launch-summary__question' : 'provision-review__notice'}">${escapeHtml(line)}</p>`).join('')}
  </section>`;
}
