import { escapeHtml } from './escape-html.js';

const text = value => typeof value === 'string' && value.trim();
const id = value => typeof value === 'string' && /^[1-9]\d*$/.test(value);

export function provisionSettlementReviewMarkup(table) {
  if (table?.kind !== 'provision_settlement_review' || !id(table.descriptionId)
    || !text(table.totalDisplay) || !Array.isArray(table.rows) || !table.rows.length
    || typeof table.canSubmit !== 'boolean' || typeof table.hasPaidRows !== 'boolean'
    || (table.hasPaidRows && !text(table.pendingTotalDisplay))
    || (table.notice != null && typeof table.notice !== 'string')
    || !table.rows.every(row => row && id(row.id) && Number.isSafeInteger(row.index) && row.index > 0
      && ['product', 'quantityDisplay', 'unitPriceDisplay', 'totalDisplay'].every(key => text(row[key]))
      && typeof row.paid === 'boolean' && (row.freightDisplay == null || typeof row.freightDisplay === 'string'))
    || new Set(table.rows.map(row => row.id)).size !== table.rows.length) return '';
  const value = escapeHtml;
  const label = `Detalhamento das provisões do descritivo ${table.descriptionId}`;
  return `<section class="provision-review" data-provision-settlement-review aria-label="${value(label)}">
    <h3>${value(text(table.title) ? table.title : `DETALHAMENTO — DESCRITIVO ${table.descriptionId}`)}</h3>
    <p class="provision-review__intro">Confira as linhas. Você pode submeter os valores de uma vez ou editar uma linha.</p>
    ${table.notice ? `<p class="provision-review__notice" role="status">${value(table.notice)}</p>` : ''}
    <div class="provision-review__scroll" role="region" aria-label="Tabela de provisões; deslize para ver as colunas" tabindex="0">
      <table aria-label="${value(label)}"><colgroup><col class="provision-review__product-col"><col class="provision-review__quantity-col"><col><col></colgroup>
        <thead><tr>${['PRODUTO', 'QTD', 'VALOR UNITÁRIO', 'VALOR TOTAL'].map(header => `<th scope="col">${header}</th>`).join('')}</tr></thead>
        <tbody>${table.rows.map(row => `<tr data-provision-id="${value(row.id)}">
          <th scope="row"><span class="provision-review__product">${row.index}. ${value(row.product)}</span><small>Provisão #${value(row.id)}</small>
            ${row.paid ? '<small class="provision-review__paid">Já baixada — somente consulta</small>' : ''}
            ${row.freightDisplay ? `<small class="provision-review__freight">Frete ${value(row.freightDisplay)} incluído</small>` : ''}</th>
          <td>${value(row.quantityDisplay)}</td><td>${value(row.unitPriceDisplay)}</td><td class="provision-review__total">${value(row.totalDisplay)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="3" scope="row">TOTAL GERAL</th><td>${value(table.totalDisplay)}</td></tr></tfoot>
      </table>
    </div>
    <p class="provision-review__scroll-hint">Deslize para ver todas as colunas →</p>
    ${table.hasPaidRows ? `<p class="provision-review__pending">Total pendente a baixar <strong>${value(table.pendingTotalDisplay)}</strong></p><p class="provision-review__readonly">As linhas já baixadas são apenas para consulta e não serão alteradas.</p>` : ''}
    <p class="provision-review__next">Submeter segue para os dados do pagamento. A baixa ainda terá uma confirmação final.</p>
  </section>`;
}
