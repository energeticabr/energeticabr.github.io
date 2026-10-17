import { escapeHtml } from './escape-html.js';

const icons = {
  launch: '<path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M9 8h6M9 12h6M9 16h6"/>',
  order: '<path d="M2 3h3l3 12h11l3-8H6M9 19h.01M18 19h.01"/>',
  total: '<path d="m8 3 2 4h4l2-4ZM10 7c-4 4-6 6-6 10 0 3 3 4 8 4s8-1 8-4c0-4-2-6-6-10"/><path d="M14 11h-3a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-3M12 10v10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const row = (label, value, name) => `<div class="launch-completion__row"><dt>${icon(name)}<span>${escapeHtml(label)}</span></dt><dd>${escapeHtml(value)}</dd></div>`;

export function postingCompletionMarkup(receipt, notesMarkup = '', sender = null) {
  if (receipt.kind === 'attendance-batch') {
    return `<section class="launch-completion launch-completion--attendance-batch" aria-label="${escapeHtml(receipt.title)}"><header class="launch-completion__success"><span class="launch-completion__check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg></span><div><h2>${escapeHtml(receipt.title)}</h2></div></header></section>`;
  }
  const settlement = receipt.kind === 'provision-settlement';
  const orderAttachments = receipt.kind === 'order-attachments';
  const diary = receipt.kind === 'diary';
  const brandedReceipt = settlement || orderAttachments || diary;
  const taskCompletion = receipt.kind === 'task-completion';
  const deletion = receipt.kind === 'deletion';
  const edition = receipt.kind === 'edition';
  const completedProcess = brandedReceipt || taskCompletion || deletion || edition;
  return `<section class="launch-completion${settlement ? ' launch-completion--provision-settlement' : orderAttachments ? ' launch-completion--order-attachments' : diary ? ' launch-completion--diary' : ''}" aria-label="${escapeHtml(receipt.title)}">
    ${brandedReceipt && sender ? `<div class="launch-completion-sender"><div class="launch-completion-sender__identity"><strong>${escapeHtml(sender.name)}</strong><time>${escapeHtml(receipt.time)}</time></div><img src="${escapeHtml(sender.mascotUrl)}" alt="Mascote Energético"></div>` : ''}
    <header class="launch-completion__success">
      <span class="launch-completion__check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg></span>
      <div><h2>${settlement ? 'PAGAMENTO AGENDADO' : orderAttachments ? 'ANEXOS DO PEDIDO' : diary ? 'DIÁRIO DE OBRA PREENCHIDO' : `${escapeHtml(receipt.title)}!`}</h2><p>${edition ? `Edição concluída com sucesso · ${escapeHtml(receipt.database)}` : deletion ? `Exclusão concluída com sucesso · ${escapeHtml(receipt.database)}` : settlement ? 'Baixado na base de dados' : orderAttachments ? 'Adicionados na base de dados' : diary ? 'Registrado na base de dados' : taskCompletion ? `Conclusão registrada na base de dados ${escapeHtml(receipt.database)}.` : `Operação concluída com sucesso na base de dados ${escapeHtml(receipt.database)} às ${escapeHtml(receipt.time)}.`}</p></div>
    </header>
    ${brandedReceipt ? `<div class="launch-completion__operation">${icon('clock')}<div><strong>${escapeHtml(receipt.database)}</strong> <span>ÀS ${escapeHtml(receipt.time)}</span></div></div>` : ''}
    <h3 class="launch-completion__title"><span aria-hidden="true">${brandedReceipt ? icon('database') : '🆔'}</span> ${edition ? 'RESUMO DA EDIÇÃO' : deletion ? 'RESUMO DO REGISTRO EXCLUÍDO' : 'REGISTROS CONFIRMADOS'}</h3>
    ${deletion || edition ? `<table class="gallery-deletion-table" aria-label="${edition ? 'Resumo do registro editado' : 'Resumo do registro excluído'}"><tbody>${receipt.records.map(record => `<tr><th scope="row">${escapeHtml(record.label)}</th><td>${escapeHtml(record.value)}</td></tr>`).join('')}</tbody></table>` : `<dl class="launch-completion__records">
      ${receipt.records.map(record => row(record.label, record.value, record.icon)).join('')}
    </dl>`}
    ${edition ? `<table class="gallery-deletion-table gallery-edit-table" aria-label="Campos alterados"><tbody>${receipt.changes.map(change => `<tr><th scope="row">${escapeHtml(change.label)}</th><td><span class="gallery-edit-value-label">Antes</span>${escapeHtml(change.before)}<span class="gallery-edit-value-label">Depois</span>${escapeHtml(change.after)}</td></tr>`).join('')}</tbody></table>${receipt.changes.length ? '' : '<p>Nenhum campo foi alterado.</p>'}` : ''}
    ${notesMarkup ? `<div class="launch-completion__details">${notesMarkup}</div>` : ''}
    <footer>${icon(completedProcess ? 'check' : 'clock')}<span>${completedProcess ? 'Processo concluído com sucesso!' : `Registrado às ${escapeHtml(receipt.time)}`}</span></footer>
  </section>`;
}
