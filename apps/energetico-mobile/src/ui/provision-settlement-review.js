import { escapeHtml } from './escape-html.js';
import { validProvisionSettlementReviewTable, serverSelectedProvisionIds, provisionSelectionSummary } from './provision-settlement-selection.js';

const text = value => typeof value === 'string' && value.trim();
const readonlyLabel = row => text(row.readonlyLabel) ? row.readonlyLabel : 'Já baixada — somente consulta';
export function provisionSettlementReviewMarkup(table, { busy = false, current = true } = {}) {
  if (!validProvisionSettlementReviewTable(table)) return '';
  const value = escapeHtml;
  const label = `Detalhamento das provisões do descritivo ${table.descriptionId}`;
  const selection = table.selectionEnabled === true;
  const selectedIds = selection ? serverSelectedProvisionIds(table) : [];
  const pendingCount = table.rows.filter(row => !row.paid).length;
  const readonlyNotice = table.rows.some(row => row.paid && text(row.readonlyLabel))
    ? 'As linhas indisponíveis para baixa são apenas para consulta e não serão alteradas.'
    : 'As linhas já baixadas são apenas para consulta e não serão alteradas.';
  return `<section class="provision-review" data-provision-settlement-review data-description-id="${value(table.descriptionId)}"${selection ? ` data-provision-selection-enabled="true" data-provision-selection-active="${current}"` : ''} aria-label="${value(label)}">
    <h3>${value(text(table.title) ? table.title : `DETALHAMENTO — DESCRITIVO ${table.descriptionId}`)}</h3>
    <p class="provision-review__intro">${selection ? 'Selecione as provisões que deseja baixar. Você pode submeter as linhas selecionadas ou editar uma linha.' : 'Confira as linhas. Você pode submeter os valores de uma vez ou editar uma linha.'}</p>
    ${table.notice ? `<p class="provision-review__notice" role="status">${value(table.notice)}</p>` : ''}
    <div class="provision-review__scroll" role="region" aria-label="Tabela de provisões; deslize para ver as colunas" tabindex="0">
      <table aria-label="${value(label)}"><colgroup>${selection ? '<col class="provision-review__select-col">' : ''}<col class="provision-review__product-col"><col class="provision-review__quantity-col"><col><col></colgroup>
        <thead><tr>${selection ? '<th scope="col" class="provision-review__select-cell"><span class="sr-only">Selecionar</span></th>' : ''}${['PRODUTO', 'QTD', 'VALOR UNITÁRIO', 'VALOR TOTAL'].map(header => `<th scope="col"${header === 'QTD' ? ' class="provision-review__quantity"' : ''}>${header}</th>`).join('')}</tr></thead>
        <tbody>${table.rows.map(row => `<tr data-provision-id="${value(row.id)}">
          ${selection ? `<td class="provision-review__select-cell"><input type="checkbox" data-provision-select-id="${value(row.id)}" aria-label="${value(row.paid ? `Provisão #${row.id} — ${readonlyLabel(row)}` : `Selecionar provisão #${row.id} — ${row.product}`)}"${selectedIds.includes(row.id) ? ' checked' : ''}${row.paid || busy || !current ? ' disabled' : ''}></td>` : ''}
          <th scope="row"><span class="provision-review__product">${row.index}. ${value(row.product)}</span><small>Provisão #${value(row.id)}</small>
            ${row.paid ? `<small class="provision-review__paid">${value(readonlyLabel(row))}</small>` : ''}
            ${row.freightDisplay ? `<small class="provision-review__freight">Frete ${value(row.freightDisplay)} incluído</small>` : ''}</th>
          <td class="provision-review__quantity">${value(row.quantityDisplay)}</td><td>${value(row.unitPriceDisplay)}</td><td class="provision-review__total">${value(row.totalDisplay)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="${selection ? 4 : 3}" scope="row">TOTAL GERAL</th><td>${value(table.totalDisplay)}</td></tr></tfoot>
      </table>
    </div>
    <p class="provision-review__scroll-hint">Deslize para ver todas as colunas →</p>
    ${selection ? `<label class="provision-review__select-all"><input type="checkbox" data-provision-select-all${pendingCount && selectedIds.length === pendingCount ? ' checked' : ''}${busy || !current || !pendingCount ? ' disabled' : ''}> Selecionar todos</label><p class="provision-review__selection-summary" data-provision-selection-summary role="status" aria-live="polite">${value(provisionSelectionSummary(table, selectedIds))}</p>` : ''}
    ${table.hasPaidRows ? `<p class="provision-review__pending">Total pendente a baixar <strong>${value(table.pendingTotalDisplay)}</strong></p><p class="provision-review__readonly">${value(readonlyNotice)}</p>` : ''}
    <p class="provision-review__next">Submeter segue para os dados do pagamento. A baixa ainda terá uma confirmação final.</p>
  </section>`;
}
