import { escapeHtml } from './escape-html.js';

export function pendingProvisionAttachmentTray(paymentId, upload = {}, locked = false) {
  const id = escapeHtml(paymentId), items = upload.items || [];
  const busy = locked || upload.busy === true;
  const picking = upload.picking === true;
  const disabled = busy || picking ? ' disabled' : '';
  const sendable = items.some(item => item.status !== 'conflict');
  return `<section class="chat-pending-provision__upload-tray" aria-label="Adicionar anexos ao descritivo ${id}" aria-busy="${busy || picking}">
    <button type="button" class="chat-pending-provision__add-files" data-action="choose-pending-provision-attachment-source" data-payment-id="${id}"${disabled}>＋ ${picking ? 'Selecionando arquivos…' : 'Adicionar anexos'}</button>
    ${items.length ? `<ul class="chat-pending-provision__upload-queue" aria-label="Novos anexos">${items.map(item => {
      const name = escapeHtml(item.fileName || 'arquivo');
      const status = item.status === 'conflict' ? 'Nome repetido' : item.status === 'error' ? 'Falha no envio' : item.status === 'uploading' ? 'Enviando…' : 'Pronto para enviar';
      return `<li><span><strong>${name}</strong><small>${status}${item.error ? ` — ${escapeHtml(item.error)}` : ''}</small></span><button type="button" data-action="remove-pending-provision-upload" data-payment-id="${id}" data-upload-id="${escapeHtml(item.id || item.fileName)}" aria-label="Remover ${name}"${disabled}>×</button></li>`;
    }).join('')}</ul>
    <div class="chat-confirmation__actions">
      <button type="button" class="chat-confirmation__cancel" data-action="cancel-pending-provision-uploads" data-payment-id="${id}"${busy ? ' disabled' : ''}>Cancelar</button>
      <button type="button" class="chat-confirmation__confirm" data-action="send-pending-provision-attachments" data-payment-id="${id}"${busy || picking || !sendable ? ' disabled' : ''}>${upload.busy ? 'Enviando…' : 'Submeter'}</button>
    </div>` : ''}
    ${upload.error ? `<p class="chat-pending-provision__error" role="alert">${escapeHtml(upload.error)}</p>` : ''}
  </section>`;
}
