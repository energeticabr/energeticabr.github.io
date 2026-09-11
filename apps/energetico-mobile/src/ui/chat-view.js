import { escapeHtml } from "./escape-html.js";
import { auditLogRow, renderAuditLogTable } from "./audit-log-table.js";

const MASCOT_URL = new URL("../../pwa/icons/mascote-192.png", import.meta.url).href;

function localDateIso(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function parseByteValue(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const bytes = Number(digits);
  return Number.isFinite(bytes) ? bytes : null;
}

function formatByteValue(value) {
  return formatBytes(parseByteValue(value) || 0);
}

function formatCompressionReduction(original, compressed) {
  const originalBytes = parseByteValue(original);
  const compressedBytes = parseByteValue(compressed);
  if (!originalBytes || compressedBytes == null) return "";
  const reduction = ((originalBytes - compressedBytes) / originalBytes) * 100;
  return ` (${reduction.toFixed(1)}% de redução)`;
}

function formatDisplayedByteValues(value) {
  let text = String(value ?? "");
  // Compression responses commonly arrive as “original → compressed bytes”.
  // Convert both sides so the user never has to compare raw byte counts.
  text = text.replace(/(\d[\d.,\s]*)\s*(?:→|->)\s*(\d[\d.,\s]*)\s*bytes(?:\s*\(\s*[\d.,]+\s*%\s*de\s+redução\s*\))?/gi,
    (_, original, compressed) => `${formatByteValue(original)} → ${formatByteValue(compressed)}${formatCompressionReduction(original, compressed)}`);
  // Also normalize the descriptive form used by some VM responses.
  text = text.replace(/(original\s+)(\d[\d.,\s]*)\s*bytes(\s*[,;:\-]\s*compactado\s+)(\d[\d.,\s]*)\s*bytes(?:\s*\(\s*[\d.,]+\s*%\s*de\s+redução\s*\))?/gi,
    (_, prefix, original, middle, compressed) => `${prefix}${formatByteValue(original)}${middle}${formatByteValue(compressed)}${formatCompressionReduction(original, compressed)}`);
  return text.replace(/(\d[\d.,\s]*)\s*bytes\b/gi, (_, bytes) => formatByteValue(bytes));
}

function formatChatText(value) {
  // Escape first: the only HTML accepted from message formatting is our own <strong>.
  return escapeHtml(formatDisplayedByteValues(String(value ?? "").replace(/\r\n?/g, "\n")))
    .replace(/(^|[^*])(\*{1,2})([^\s*](?:[^*\n]*[^\s*])?)\2(?!\*)/g,
      (_, prefix, marker, content) => `${prefix}<strong>${content}</strong>`);
}

function assistantAvatar() {
  return `<span class="chat-avatar chat-avatar--assistant"><img src="${MASCOT_URL}" alt="Mascote Energético"></span>`;
}

function userAvatar(account) {
  const name = String(account?.name || account?.username || "Usuário").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = `${parts[0]?.[0] || "U"}${parts.length > 1 ? parts.at(-1)?.[0] || "" : ""}`.toUpperCase();
  return `<span class="chat-avatar chat-avatar--user" aria-hidden="true">${escapeHtml(initials)}</span>`;
}

function draftMenuOptions(message) {
  const question = String(message?.question || message?.prompt || "");
  const options = Array.isArray(message?.options)
    ? message.options.map(option => ({ ...option })).filter(option => !isInlineDraftSaveOption(option))
    : [];
  // LOG DE AÇÕES belongs to the Auditoria e Documentos submenu. Filter it
  // from the root area chooser even if an older VM response still includes
  // the legacy option there; do not synthesize it into the root menu.
  const isRootAreaMenu = /QUAL\s+(?:ÁREA|AREA)[\s\S]*DESEJA\s+ACESSAR/i.test(question);
  const menuOptions = isRootAreaMenu
    ? options.filter(option => String(option?.reply || option?.id || "").trim().toLowerCase() !== "audit_log")
    : options;
  if (!/RASCUNHOS?/i.test(question)) return menuOptions;

  const deleteIds = new Set(menuOptions
    .map(option => String(option.reply || option.id || ""))
    .filter(value => value.startsWith("draft_delete:"))
    .map(value => value.slice("draft_delete:".length)));
  const result = [];
  const resumeIds = new Set();
  for (const option of menuOptions) {
    const reply = String(option.reply || option.id || "");
    if (reply.startsWith("draft_delete:")) {
      const draftId = reply.slice("draft_delete:".length);
      const rawLabel = String(option.label || option.title || draftId);
      const title = rawLabel.replace(/^🗑️\s*EXCLUIR\s*•\s*/i, "").replace(/^▶️\s*RETOMAR\s*•\s*/i, "");
      result.push({ ...option, label: `🗑️ EXCLUIR • ${title}` });
      continue;
    }
    if (reply.startsWith("draft_resume:")) {
      const draftId = reply.slice("draft_resume:".length);
      if (resumeIds.has(draftId)) continue;
      resumeIds.add(draftId);
    }
    result.push(option);
    if (!reply.startsWith("draft_resume:")) continue;
    const draftId = reply.slice("draft_resume:".length);
    if (!draftId || deleteIds.has(draftId)) continue;
    const rawLabel = String(option.label || option.title || draftId);
    const title = rawLabel.replace(/^▶️\s*RETOMAR\s*•\s*/i, "");
    result.push({ id: `draft_delete:${draftId}`, reply: `draft_delete:${draftId}`, label: `🗑️ EXCLUIR • ${title}` });
  }
  return result;
}

function isInlineDraftSaveOption(option) {
  const reply = String(option?.reply || option?.id || "").trim().toLowerCase();
  const label = String(option?.label || option?.title || "");
  return reply === "save_draft_main_menu"
    || /salvar\s+rascunho\s+e\s+retornar\s+ao\s+menu\s+(inicial|principal)/i.test(label);
}

function draftReplyId(option) {
  return String(option?.reply || option?.id || "");
}

function normalizedDateText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function isDateQuestion(message, options = []) {
  if (message?.calendarPicker === true || message?.calendar_picker === true) return true;
  const question = normalizedDateText(message?.question || message?.prompt || message?.text);
  if (!/\bdata\b/.test(question)) return false;
  const choices = options.map(option => normalizedDateText(option?.label || option?.title || option?.id)).join(" ");
  const datePreset = /\b(?:ontem|hoje|amanha|outra data|digitar data|data de hoje)\b/.test(choices);
  const dateFormat = /\b(?:dd\s*[,/]\s*dd|dd\/mm|dd\/mm\/aaaa|formato\s+dd)\b/.test(question);
  const directRequest = /\b(?:qual|informe|indique|digite|envie|selecione|escolha|nova)\b[^\n?.!]{0,80}\bdata\b/.test(question)
    || /\bdata\s+(?:de|do|da|inicial|final)\b/.test(question);
  return datePreset || dateFormat || directRequest;
}

function datePickerTriggerMarkup(busy) {
  return `<div class="chat-date-picker-trigger-wrap"><button class="chat-date-picker-trigger" type="button" data-action="open-date-picker" aria-label="Selecionar data pelo calendário" title="Selecionar data pelo calendário"${busy ? " disabled" : ""}>📅</button></div>`;
}

function navigationOptionKind(option) {
  const replyId = draftReplyId(option).trim().toLowerCase();
  const label = String(option?.label || option?.title || "");
  if (option?.navigation_back === true
    || replyId === "navigation_back"
    || /retornar\s+(?:à|a)\s+pergunta\s+anterior/i.test(label)) return "back";
  if (option?.navigation_main_menu === true
    || replyId === "navigation_main_menu"
    || /retornar\s+ao\s+menu\s+(?:inicial|principal)/i.test(label)) return "home";
  return "";
}

function draftTitle(option) {
  return String(option?.label || option?.title || option?.id || "")
    .replace(/^🗑️\s*EXCLUIR\s*•\s*/i, "")
    .replace(/^▶️\s*RETOMAR\s*•\s*/i, "");
}

function pollButton(option, busy, { deleteButton = false } = {}) {
  const replyId = draftReplyId(option);
  const label = option.label || option.title || option.id;
  const disabled = busy || option?.disabled === true;
  if (deleteButton) {
    const title = draftTitle(option);
    return `<button class="chat-draft-delete" type="button" data-action="select-reply" data-reply-id="${escapeHtml(replyId)}" data-label="${escapeHtml(`Excluir rascunho • ${title}`)}" aria-label="Excluir rascunho: ${escapeHtml(title)}" title="Excluir rascunho: ${escapeHtml(title)}"${disabled ? " disabled" : ""}>🗑️</button>`;
  }
  const toneClass = option?.tone === "danger" ? " chat-choice-button--danger" : "";
  return `<button class="chat-choice-button${toneClass}" type="button" data-action="select-reply" data-reply-id="${escapeHtml(replyId)}" data-label="${escapeHtml(label)}"${disabled ? " disabled" : ""}>${formatChatText(label)}</button>`;
}

function changeTableMarkup(table = {}) {
  table = table || {};
  const headers = Array.isArray(table.headers) && table.headers.length
    ? table.headers
    : ["Mudança", "Campo", "Antes", "Depois"];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  if (!rows.length) return "";
  return `<div class="chat-change-table" role="table" aria-label="Alterações no cadastro do fornecedor"><strong>${formatChatText(table.title || "⚠️ ALTERAÇÕES NO CADASTRO DO FORNECEDOR")}</strong><div class="chat-change-table-row chat-change-table-row--header" role="row">${headers.map(header => `<span role="columnheader">${escapeHtml(header)}</span>`).join("")}</div>${rows.length ? rows.map(row => `<div class="chat-change-table-row" role="row">${[row?.change ?? row?.index ?? "-", row?.field ?? "-", row?.before ?? "EM BRANCO", row?.after ?? "EM BRANCO"].map((value, index) => `<span class="chat-change-table-cell${index === 2 ? " is-before" : index === 3 ? " is-after" : ""}" role="cell">${escapeHtml(value)}</span>`).join("")}</div>`).join("") : `<div class="chat-change-table-empty">Nenhuma alteração identificada.</div>`}</div>`;
}

function changeTableQuestion(message, table) {
  const question = String(message?.question || message?.prompt || "");
  if (!table) return question;
  return question.replace(/\nMUDANÇA\s*\|[\s\S]*$/i, "").trim();
}

function presenceDetailTableMarkup(table) {
  if (!table) return "";
  const rows = Array.isArray(table) ? table : table.rows;
  if (!Array.isArray(rows) || !rows.length) return "";
  const cells = rows
    .filter(row => Array.isArray(row) && row.length)
    .flatMap(row => row)
    .filter(cell => cell && typeof cell === "object");
  if (!cells.length) return "";
  const title = Array.isArray(table) ? "📋 DADOS DA PRESENÇA" : (table.title || "📋 DADOS DA PRESENÇA");
  return `<div class="chat-presence-table" role="table" aria-label="Dados da presença do fornecedor"><strong>${formatChatText(title)}</strong>${rows.filter(row => Array.isArray(row) && row.length).map(row => `<div class="chat-presence-table-row" role="row">${row.map(cell => `<div class="chat-presence-table-cell${cell.muted ? " is-muted" : ""}" role="cell"><span>${escapeHtml(cell.label || "Campo")}</span><b>${escapeHtml(cell.value ?? "-")}</b></div>`).join("")}</div>`).join("")}</div>`;
}

function renderPoll(message, busy) {
  const allOptions = draftMenuOptions(message);
  const auditRows = allOptions.map(auditLogRow).filter(Boolean);
  // Navigation is rendered in the fixed flow bar so forms keep only the
  // choices for their current question.
  const options = allOptions.filter(option => !auditLogRow(option) && !navigationOptionKind(option));
  const isDraftMenu = /RASCUNHOS?/i.test(String(message.question || message.prompt || ""));
  const deleteByDraft = new Map(options
    .map(option => [draftReplyId(option), option])
    .filter(([replyId]) => replyId.startsWith("draft_delete:"))
    .map(([replyId, option]) => [replyId.slice("draft_delete:".length), option]));
  const seenDrafts = new Set();
  const choices = options.flatMap(option => {
    const replyId = draftReplyId(option);
    if (isDraftMenu && replyId.startsWith("draft_delete:")) return [];
    if (isDraftMenu && replyId.startsWith("draft_resume:")) {
      const draftId = replyId.slice("draft_resume:".length);
      if (seenDrafts.has(draftId)) return [];
      seenDrafts.add(draftId);
      const deleteOption = deleteByDraft.get(draftId);
      return [`<div class="chat-draft-option">${pollButton(option, busy)}${deleteOption ? pollButton(deleteOption, busy, { deleteButton: true }) : ""}</div>`];
    }
    return [pollButton(option, busy)];
  }).join("");
  const rawChangeTable = message.change_table || message.changeTable;
  const questionText = String(message.question || message.prompt || "");
  const changeTable = rawChangeTable
    && Array.isArray(rawChangeTable.rows)
    && rawChangeTable.rows.length
    && /fornecedor/i.test(questionText)
    ? rawChangeTable
    : null;
  const presenceTable = message.detail_table || message.detailTable;
  const calendarPicker = isDateQuestion(message, options);
  const isPendingAttendanceList = message?.presentation === "accordion";
  return `<div class="chat-choice-card${isPendingAttendanceList ? " chat-choice-card--pending-attendance" : ""}">
    <p>${formatChatText(changeTableQuestion(message, changeTable) || "Escolha uma opção")}</p>
    ${changeTableMarkup(changeTable)}
    ${presenceDetailTableMarkup(presenceTable)}
    ${renderAuditLogTable(auditRows, busy)}
    ${calendarPicker ? datePickerTriggerMarkup(busy) : ""}
    <div class="chat-choice-list">${choices}</div>
  </div>`;
}

function flowNavigation(messages) {
  const result = { back: false, home: false };
  for (const message of [...(Array.isArray(messages) ? messages : [])].reverse()) {
    if (message?.type !== "poll" || !Array.isArray(message.options)) continue;
    for (const option of message.options) {
      const kind = navigationOptionKind(option);
      if (kind === "back") result.back = true;
      if (kind === "home") result.home = true;
    }
    if (result.back && result.home) break;
  }
  return result;
}

function flowStatusMarkup(state, messages, busy) {
  // An active flow always has navigation, including text-only/confirmation
  // screens whose latest message is not a poll. The root menu has no
  // activeFlow, so it remains the only screen without this green bar.
  const back = `<button class="chat-flow-nav-button" type="button" data-action="select-reply" data-reply-id="navigation_back" data-label="↩️ RETORNAR À PERGUNTA ANTERIOR" aria-label="Retornar à pergunta anterior" title="Retornar à pergunta anterior"${busy ? " disabled" : ""}>↩️</button>`;
  const home = `<button class="chat-flow-nav-button" type="button" data-action="select-reply" data-reply-id="navigation_main_menu" data-label="🏠 RETORNAR AO MENU INICIAL" aria-label="Retornar ao menu inicial" title="Retornar ao menu inicial"${busy ? " disabled" : ""}>🏠</button>`;
  return `<div class="chat-flow-status">
    <div class="chat-flow-navigation" aria-label="Navegação do fluxo">${back}${home}</div>
    <strong class="chat-flow-title" title="${escapeHtml(state.activeFlow.title)}">${escapeHtml(state.activeFlow.title)}</strong>
    <button class="chat-flow-summary" type="button" data-action="show-summary"${busy ? " disabled" : ""}>Ver resumo</button>
  </div>`;
}

function presenceConfirmationMarkup(value = {}) {
  const id = String(value.id || "-");
  const supplier = String(value.supplier || "FORNECEDOR NÃO INFORMADO");
  const presence = String(value.presence || "").trim().toUpperCase() === "AUSENTE"
    ? "AUSENTE"
    : "PRESENTE";
  const tone = presence === "AUSENTE" ? "absent" : "present";
  return `<div class="chat-presence-confirmation"><span>ID ${escapeHtml(id)}: PRESENÇA DE ${escapeHtml(supplier)} APONTADA COMO</span> <strong class="chat-presence-confirmation__status chat-presence-confirmation__status--${tone}">${presence}</strong></div>`;
}

function renderMessage(message, account, busy) {
  if (message.type === "poll") {
    return `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong>${renderPoll(message, busy)}</div></article>`;
  }
  if (message.type === "image" || message.type === "document") {
    const label = message.caption || message.fileName || "Arquivo gerado";
    const preview = message.previewUrl
      ? `<img class="chat-media-preview__image" src="${escapeHtml(message.previewUrl)}" alt="Prévia de ${escapeHtml(label)}">`
      : `<span class="chat-media-preview__icon" aria-hidden="true">${message.type === "image" ? "🖼️" : "📄"}</span>`;
    return `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong><p>${message.caption ? formatChatText(label) : escapeHtml(label)}</p><button class="chat-media-preview chat-media-preview--${message.type}" type="button" data-action="open-media" data-message-id="${escapeHtml(message.id)}" aria-label="Abrir ${escapeHtml(label)}">${preview}<span class="chat-media-preview__caption"><b>${message.caption ? formatChatText(label) : escapeHtml(label)}</b><small>Toque para abrir o arquivo completo</small></span></button></div></article>`;
  }

  const isUser = message.role === "user";
  const name = isUser ? account?.name || "Você" : "Energético";
  const avatar = isUser ? userAvatar(account) : assistantAvatar();
  const presenceConfirmation = message.presence_confirmation || message.presenceConfirmation;
  const body = !isUser && presenceConfirmation
    ? presenceConfirmationMarkup(presenceConfirmation)
    : `<p>${isUser ? escapeHtml(message.text || "") : formatChatText(message.text)}</p>`;
  const datePicker = !isUser && isDateQuestion(message) ? datePickerTriggerMarkup(busy) : "";
  return `<article class="chat-message chat-message--${isUser ? "user" : "assistant"}">${avatar}<div class="chat-bubble"><strong>${escapeHtml(name)}</strong>${body}${datePicker}</div></article>`;
}

function renderPendingFile(item) {
  const fileName = item.file?.name || "arquivo";
  const statusLabel = item.status === "sending"
    ? "Enviando"
    : item.status === "failed" ? "Falhou" : "Pronto para enviar";
  const retry = item.status === "failed"
    ? `<button type="button" data-action="retry-file" data-file-id="${escapeHtml(item.id)}">Tentar novamente</button>`
    : "";
  return `<li class="pending-file pending-file--${escapeHtml(item.status)}">
    <span class="pending-file__icon" aria-hidden="true">📎</span>
    <span class="pending-file__details"><strong>${escapeHtml(fileName)}</strong><small>${escapeHtml(formatBytes(item.file?.size))} · ${statusLabel}</small>${item.error ? `<em>${escapeHtml(item.error)}</em>` : ""}</span>
    <span class="pending-file__actions"><button type="button" data-action="open-file" data-file-id="${escapeHtml(item.id)}" aria-label="Visualizar ${escapeHtml(fileName)}">Visualizar</button>${retry}<button type="button" data-action="remove-file" data-file-id="${escapeHtml(item.id)}" aria-label="Remover ${escapeHtml(fileName)}">Remover</button></span>
  </li>`;
}

function renderAttachments(attachments, busy = false, canTransfer = false, canBulkDelete = false) {
  if (!attachments.length) return "";
  const hasNewAttachment = attachments.some(item => !(item.existing === true || item.readOnly === true || item.origin === "existing"));
  const bulkDelete = canBulkDelete && hasNewAttachment
    ? `<span class="chat-attachments-danger-cluster"><button class="chat-attachments-delete-all" type="button" data-action="delete-all-attachments" aria-label="Eliminar todos os anexos" title="Eliminar todos os anexos"${busy ? " disabled" : ""}>ELIMINAR</button></span>`
    : "";
  const transfer = canTransfer
    ? `<button class="chat-attachments-transfer" type="button" data-action="transfer-attachments" aria-label="Transferir anexos" title="Transferir anexos"${busy ? " disabled" : ""}>TRANSFERIR</button>`
    : "";
  return `<details class="chat-attachments"><summary><span>📎 Anexos (${attachments.length})</span><span class="chat-attachments-summary-actions">${bulkDelete}${transfer}</span></summary>
    <ul>${attachments.map(item => {
      // Existing attachments are read-only snapshots loaded from SharePoint.
      // Treat readOnly as existing as a defensive fallback for older API
      // responses that did not include the explicit `existing` flag.
      const existing = item.existing === true || item.readOnly === true || item.origin === "existing";
      const label = existing ? "JÁ EXISTIA" : "NOVO";
      const actions = existing ? "" : `<span class="chat-attachment-actions"><button class="chat-attachment-compress" type="button" data-action="compress-attachment" data-file-id="${escapeHtml(item.id)}" aria-label="Comprimir anexo: ${escapeHtml(item.fileName)}" title="Comprimir anexo"${busy ? " disabled" : ""}>🗜️</button><button class="chat-attachment-delete" type="button" data-action="remove-attachment" data-file-id="${escapeHtml(item.id)}" aria-label="Excluir anexo: ${escapeHtml(item.fileName)}" title="Excluir anexo"${busy ? " disabled" : ""}>🗑️</button></span>`;
      const origin = existing ? "existing" : "new";
      const badge = `<span class="chat-attachment-badge chat-attachment-badge--${origin}">${label}</span>`;
      const description = existing ? "não será reenviado" : "será enviado ao concluir";
      return `<li class="chat-attachment-cluster" data-attachment-origin="${origin}"><button class="chat-attachment-open" type="button" data-action="open-file" data-file-id="${escapeHtml(item.id)}" aria-label="Visualizar ${escapeHtml(item.fileName)}">${item.previewUrl ? `<img class="chat-attachment-preview" src="${escapeHtml(item.previewUrl)}" alt="">` : `<span class="chat-attachment-icon" aria-hidden="true">${String(item.mimeType).toLowerCase() === "application/pdf" || item.fileName.toLowerCase().endsWith(".pdf") ? "📄" : "🖼️"}</span>`}<span><strong>${escapeHtml(item.fileName)}</strong><small>${escapeHtml(formatBytes(item.size))} · ${description} · Toque para visualizar</small>${badge}</span></button>${actions}</li>`;
    }).join("")}</ul>
  </details>`;
}

function settingsButton(extraClass = "") {
  return `<button class="header-action header-settings ${extraClass}" type="button" data-action="open-settings" aria-label="Instalar e configurar compartilhamento" title="Instalar e configurar compartilhamento"><span aria-hidden="true">⚙️</span></button>`;
}

function signOutConfirmationMarkup() {
  return `<div class="chat-confirmation-backdrop" data-sign-out-dialog>
    <div class="chat-confirmation" role="dialog" aria-modal="true" aria-labelledby="sign-out-title">
      <h2 id="sign-out-title">Tem certeza que deseja sair?</h2>
      <p>Sua sessão será encerrada e você voltará para a tela de entrada.</p>
      <div class="chat-confirmation__actions">
        <button class="chat-confirmation__cancel" type="button" data-action="cancel-sign-out">Não</button>
        <button class="chat-confirmation__confirm" type="button" data-action="confirm-sign-out">Sim</button>
      </div>
    </div>
  </div>`;
}

function attachmentSourceMarkup() {
  return `<div class="chat-confirmation-backdrop" data-attachment-source-dialog>
    <div class="chat-confirmation chat-attachment-source" role="dialog" aria-modal="true" aria-labelledby="attachment-source-title">
      <h2 id="attachment-source-title">Adicionar anexo</h2>
      <p>Escolha se deseja selecionar uma foto ou um arquivo.</p>
      <div class="chat-confirmation__stack">
        <button class="chat-confirmation__confirm" type="button" data-action="pick-photos">🖼️ Foto</button>
        <button class="chat-confirmation__confirm" type="button" data-action="pick-document-files">📎 Arquivo</button>
        <button class="chat-confirmation__cancel" type="button" data-action="cancel-attachment-source">Cancelar</button>
      </div>
    </div>
  </div>`;
}

function datePickerMarkup(value = "") {
  const selectedValue = value || localDateIso();
  return `<div class="chat-confirmation-backdrop" data-date-picker-dialog>
    <div class="chat-confirmation chat-date-picker" role="dialog" aria-modal="true" aria-labelledby="date-picker-title">
      <div class="chat-date-picker__header">
        <button class="chat-date-picker__close" type="button" data-action="cancel-date-picker" aria-label="Fechar calendário" title="Fechar calendário">×</button>
        <h2 id="date-picker-title">Selecionar data</h2>
      </div>
      <p>Escolha a data e toque em OK para enviar.</p>
      <input class="chat-date-picker__input" type="date" data-role="date-picker" value="${escapeHtml(selectedValue)}" aria-label="Data">
      <div class="chat-confirmation__actions">
        <button class="chat-confirmation__cancel" type="button" data-action="cancel-date-picker">Cancelar</button>
        <button class="chat-confirmation__confirm" type="button" data-action="confirm-date-picker">OK</button>
      </div>
    </div>
  </div>`;
}

function isSignaturePrompt(state = {}) {
  if (String(state.activeFlow?.id || "").trim().toLowerCase() !== "document_signing") return false;
  const messages = Array.isArray(state.messages) ? state.messages : [];
  const latest = [...messages].reverse().find(message => message?.role !== "user");
  const text = normalizedDateText(latest?.text || latest?.question || latest?.prompt);
  return /assinatura/.test(text) && /(?:envie|foto|imagem|aplicada)/.test(text);
}

function signaturePadTriggerMarkup(busy) {
  return `<div class="chat-signature-trigger-wrap"><button class="chat-signature-trigger" type="button" data-action="open-signature-pad" aria-label="Assinar na tela" title="Desenhar assinatura na tela"${busy ? " disabled" : ""}>✍️ ASSINAR NA TELA</button></div>`;
}

function signaturePadMarkup(error = "") {
  return `<div class="chat-confirmation-backdrop" data-signature-pad-dialog>
    <div class="chat-confirmation chat-signature-pad" role="dialog" aria-modal="true" aria-labelledby="signature-pad-title">
      <div class="chat-date-picker__header chat-signature-pad__header">
        <button class="chat-date-picker__close" type="button" data-action="cancel-signature-pad" aria-label="Fechar assinatura" title="Fechar assinatura">×</button>
        <h2 id="signature-pad-title">Assinar documento</h2>
      </div>
      <p>Desenhe sua assinatura usando o dedo. Somente o traço será enviado; o fundo branco será removido.</p>
      <div class="chat-signature-pad__surface">
        <canvas data-role="signature-pad" width="900" height="360" aria-label="Área para desenhar a assinatura"></canvas>
        <span class="chat-signature-pad__guide" aria-hidden="true">Desenhe aqui</span>
      </div>
      ${error ? `<p class="chat-signature-pad__error" role="alert">${escapeHtml(error)}</p>` : ""}
      <div class="chat-signature-pad__actions">
        <button class="chat-confirmation__cancel" type="button" data-action="clear-signature-pad">Limpar</button>
        <button class="chat-confirmation__cancel" type="button" data-action="cancel-signature-pad">Cancelar</button>
        <button class="chat-confirmation__confirm" type="button" data-action="confirm-signature-pad">Usar assinatura</button>
      </div>
    </div>
  </div>`;
}

function renderLaunches(launches, busy) {
  if (!launches) return "";
  const formatLaunchNumber = (value, digits, currency = false) => {
    const raw = String(value ?? "").trim();
    const compact = raw.replace(/R\$\s*/gi, "").replace(/\s/g, "");
    if (!compact) return raw;
    const normalized = compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact;
    const sign = normalized.startsWith("-") ? "-" : "";
    const unsigned = sign ? normalized.slice(1) : normalized;
    const [integerPart, fractionPart = ""] = unsigned.split(".");
    if (!/^\d+$/.test(integerPart) || !/^\d*$/.test(fractionPart)) return raw;
    const scale = 10n ** BigInt(digits);
    const keptFraction = fractionPart.padEnd(digits, "0").slice(0, digits);
    let scaled = BigInt(integerPart) * scale + BigInt(keptFraction || "0");
    if (fractionPart[digits] && fractionPart[digits] >= "5") scaled += 1n;
    const integer = scaled / scale;
    const fraction = digits ? String(scaled % scale).padStart(digits, "0") : "";
    const integerDisplay = String(integer).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const formatted = `${sign}${integerDisplay}${digits ? `,${fraction}` : ""}`;
    return currency ? `R$ ${formatted}` : formatted;
  };
  const currency = (value, digits = 2) => formatLaunchNumber(value, digits, true);
  return `<details class="chat-launches" data-batch-id="${escapeHtml(launches.id)}">
    <summary>Total: ${escapeHtml(currency(launches.totalDisplay, 2))}</summary>
    ${launches.lines.length ? `<div class="chat-launch-table" role="table" aria-label="Linhas de lançamento; valores em reais"><div class="chat-launch-row chat-launch-row--header" role="row"><span>Produto</span><span>Unit.</span><span>Qtd.</span><span>Frete</span><span>Total R$</span><span>Ações</span></div>${launches.lines.map(line => `<div class="chat-launch-entry" data-line-index="${line.index}"><div class="chat-launch-row" role="row"><strong title="${escapeHtml(line.product)}">${line.index}. ${escapeHtml(line.product)}</strong><span class="chat-launch-amount" title="${escapeHtml(currency(line.unitPriceDisplay, 1))}">${escapeHtml(formatLaunchNumber(line.unitPrice, 1))}</span><span class="chat-launch-amount">${escapeHtml(formatLaunchNumber(line.quantity, 1))}</span><span class="chat-launch-amount" title="${escapeHtml(currency(line.freightDisplay, 1))}">${escapeHtml(formatLaunchNumber(line.freight, 1))}</span><strong class="chat-launch-total" title="${escapeHtml(currency(line.totalDisplay, 2))}">${escapeHtml(formatLaunchNumber(line.totalDisplay, 2))}</strong><span class="chat-launch-actions"><button type="button" data-action="edit-launch-line" data-reply-id="${escapeHtml(line.editReply || "")}" data-label="Editar linha ${line.index}: ${escapeHtml(line.product)}" aria-label="Editar linha ${line.index}"${busy || !line.editReply ? " disabled" : ""}>✏️</button><button type="button" data-action="delete-launch-line" data-reply-id="${escapeHtml(line.deleteReply || "")}" data-label="Excluir linha ${line.index}: ${escapeHtml(line.product)}" aria-label="Excluir linha ${line.index}"${busy || !line.deleteReply ? " disabled" : ""}>🗑️</button><button type="button" data-action="toggle-launch-details" aria-label="Detalhes da linha ${line.index}" aria-expanded="false">▾</button></span></div><div class="chat-launch-details" hidden><strong>${line.index}. ${escapeHtml(line.product)}</strong><dl>${[["Fornecedor", "supplier"], ["Etapa", "stage"], ["Filial", "branch"], ["Conta", "account"]].map(([label, key]) => `<div><dt>${label}</dt><dd>${escapeHtml(line.details?.[key] || "Em branco")}</dd></div>`).join("")}<div><dt>Total</dt><dd>${escapeHtml(currency(line.totalDisplay, 2))}</dd></div></dl></div></div>`).join("")}</div>`
      : `<p>Nenhuma linha adicionada.</p>`}
  </details>`;
}

function renderMeasurementLines(measurements, busy) {
  if (!measurements) return "";
  const lines = Array.isArray(measurements.lines) ? measurements.lines : [];
  const value = item => escapeHtml(String(item ?? "Em branco"));
  const number = item => {
    const raw = String(item ?? "").trim();
    if (!raw || /^em branco$/i.test(raw)) return "-";
    const compact = raw.replace(/R\$\s*/gi, "").replace(/\s/g, "");
    const normalized = compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact;
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return raw;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return raw;
    return parsed.toLocaleString("pt-BR", { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  return `<details class="chat-measurements" data-batch-id="${escapeHtml(measurements.id)}">
    <summary>Total acumulado: ${value(measurements.totalDisplay)} · ${lines.length} linha(s)</summary>
    ${lines.length ? `<div class="chat-measurement-table" role="table" aria-label="Linhas de medição"><div class="chat-measurement-row chat-measurement-row--header" role="row"><span>Atividade</span><span>Qtd.</span><span>H</span><span>L</span><span>VLOR UN.</span><span>Total</span><span>Ações</span></div>${lines.map(line => `<div class="chat-measurement-entry" data-line-index="${line.index}"><div class="chat-measurement-row" role="row"><strong title="${value(line.activity)}">${line.index}. ${value(line.activity)}</strong><span class="chat-measurement-number">${number(line.quantity)}</span><span class="chat-measurement-number">${number(line.height)}</span><span class="chat-measurement-number">${number(line.width)}</span><span class="chat-measurement-number" title="${value(line.unitPriceDisplay)}">${number(line.unitPriceDisplay)}</span><strong class="chat-measurement-number" title="${value(line.totalDisplay)}">${number(line.totalDisplay)}</strong><span class="chat-measurement-actions"><button type="button" data-action="select-reply" data-reply-id="${value(line.editReply || "")}" data-label="Editar linha ${line.index}" aria-label="Editar linha ${line.index}"${busy || !line.editReply ? " disabled" : ""}>✏️</button><button type="button" data-action="select-reply" data-reply-id="${value(line.deleteReply || "")}" data-label="Excluir linha ${line.index}" aria-label="Excluir linha ${line.index}"${busy || !line.deleteReply ? " disabled" : ""}>🗑️</button><button type="button" data-action="toggle-measurement-details" aria-label="Detalhes da linha ${line.index}" aria-expanded="false">▾</button></span></div><div class="chat-measurement-details" hidden><strong>${line.index}. ${value(line.activity)}</strong><dl>${[["ID contrato", "contract"], ["Filial", "branch"], ["Descrição", "description"], ["Unidade", "unit"], ["Tipo de linha", "lineType"]].map(([label, key]) => `<div><dt>${label}</dt><dd>${value(line.details?.[key])}</dd></div>`).join("")}<div><dt>Anexos desta linha</dt><dd>${value(line.attachmentCount || 0)}</dd></div></dl></div></div>`).join("")}</div>` : `<p>Nenhuma linha de medição adicionada.</p>`}
  </details>`;
}

function renderRecovery(state) {
  const preview = state.recoveryPreview;
  const reference = state.recoveryReference;
  if (!preview && !reference) return "";
  const checking = state.recoveryBlocked;
  const rowMarkup = (preview?.activeFlow?.rows || []).map(row =>
    `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join("");
  const pending = reference?.pendingNames?.length ? reference.pendingNames : preview?.pendingNames || [];
  return `<details class="chat-recovery"${checking || reference ? " open" : ""}>
    <summary>${checking ? "Prévia salva neste aparelho" : reference ? "Rascunho da conversa anterior" : "Seu fluxo foi recuperado"}</summary>
    ${state.recoveryReferenceCount > 1 ? `<p>${state.recoveryReferenceCount} textos anteriores preservados. Recupere ou dispense este para acessar o próximo.</p>` : ""}
    ${preview?.activeFlow ? `<strong>${escapeHtml(preview.activeFlow.title)}</strong>` : ""}
    ${checking ? `<p>Conferindo o ponto atual com a VM. Nada será reenviado automaticamente.</p>` : ""}
    ${rowMarkup ? `<dl>${rowMarkup}</dl>` : ""}
    ${checking && preview?.question ? `<p><strong>Última pergunta</strong><br>${formatChatText(preview.question)}</p>` : ""}
    ${checking && preview?.draft ? `<p><strong>Rascunho salvo</strong><br>${escapeHtml(preview.draft)}</p>` : ""}
    ${reference?.draft ? `<p><strong>Texto anterior — ${escapeHtml(reference.activeFlow?.title || "conversa")}</strong><br>${escapeHtml(reference.draft)}</p>
      <p>${reference.uncertain ? "Havia um envio em andamento. Confira a resposta atual da VM antes de enviar novamente." : "Este texto não foi colocado na resposta atual para evitar misturar etapas."}</p>
      <button type="button" data-action="recover-draft"${checking || state.draft || state.activeText || state.resuming ? " disabled" : ""}>Usar rascunho no campo</button>
      ${state.draft ? `<small>O campo já contém texto. Esvazie-o para recuperar o rascunho anterior.</small>` : ""}` : ""}
    ${pending.length ? `<p>Arquivos que ainda estavam pendentes: ${pending.map(escapeHtml).join(", ")}. Confira os anexos do fluxo; selecione novamente apenas os que não chegaram à VM.</p>` : ""}
    ${!checking ? `<button type="button" data-action="dismiss-recovery">Dispensar prévia${reference?.draft ? " e rascunho anterior" : ""}</button>` : ""}
  </details>`;
}

export function renderPublicLinks() {
  return `<nav aria-label="Privacidade e suporte"><a href="https://www.energeticabr.com/energetico-privacidade.html" target="_blank" rel="noopener noreferrer">Privacidade</a> · <a href="https://www.energeticabr.com/energetico-suporte.html" target="_blank" rel="noopener noreferrer">Suporte</a></nav>`;
}

function renderSignedOut(status, error, showSettings, allowDemo) {
  const isLoading = status === "initializing";
  return `<section class="auth-screen">
    <div class="auth-card">
      <img class="auth-mascot" src="${MASCOT_URL}" alt="Mascote Energético">
      <p class="eyebrow">ENERGÉTICA</p>
      <h1>Energético</h1>
      <p>Seu assistente administrativo em uma conversa segura.</p>
      ${error ? `<p class="error-banner" role="alert">${escapeHtml(error)}</p>` : ""}
      <button class="primary-button" type="button" data-action="sign-in"${isLoading ? " disabled" : ""}>${isLoading ? "Verificando sessão…" : "Entrar com a Microsoft"}</button>
      ${allowDemo ? `<button type="button" data-action="demo-access"${isLoading ? " disabled" : ""}>Acesso de demonstração</button>` : ""}
      ${showSettings ? settingsButton("auth-settings") : ""}
      ${renderPublicLinks()}
    </div>
  </section>`;
}

export function renderChatMarkup(state = {}, { showSettings = false, allowDemo = false, demo = false, signOutConfirm = false, attachmentSource = false, datePicker = false, datePickerValue = "", signaturePad = false, signaturePadError = "" } = {}) {
  if (state.sessionStatus !== "authenticated") {
    return renderSignedOut(state.sessionStatus, state.error, showSettings, allowDemo);
  }

  const messages = Array.isArray(state.messages) ? state.messages : [];
  const pendingFiles = Array.isArray(state.pendingFiles) ? state.pendingFiles : [];
  const attachments = Array.isArray(state.attachments) ? state.attachments : [];
  const busy = Boolean(state.activeText || state.resuming || state.recoveryBlocked || state.responseTransitionPending)
    || pendingFiles.some(item => item.status === "sending");
  const pendingAttachment = pendingFiles.length > 0;
  const firstName = String(state.account?.name || "Você").split(/\s+/)[0];
  const signaturePrompt = isSignaturePrompt(state);

  return `<section class="chat-shell">
    <header class="chat-header">
      ${assistantAvatar()}
      <span><strong>Energético</strong><small>${demo ? `<span data-demo-banner role="status">Demonstração — dados fictícios</span>` : `${escapeHtml(firstName)}, conectado à VM`}</small></span>
      ${showSettings ? settingsButton() : ""}
      <button class="header-action" type="button" data-action="sign-out">Sair</button>
    </header>
    ${state.activeFlow ? flowStatusMarkup(state, messages, busy) : ""}
    ${state.error ? `<div class="error-banner" role="alert"><span>${escapeHtml(state.error)}</span><button type="button" data-action="retry-session"${state.resuming || state.activeText ? " disabled" : ""}>Retomar conversa</button></div>` : ""}
    <div class="chat-transcript" role="log" aria-live="polite" aria-relevant="additions text">
      ${state.recoveryWarning ? `<p class="error-banner" role="alert">${escapeHtml(state.recoveryWarning)}</p>` : ""}
      ${renderRecovery(state)}
      ${messages.length ? messages.map(message => renderMessage(message, state.account, busy)).join("") : state.recoveryPreview ? "" : `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong><p>Olá, ${escapeHtml(firstName)}. O que vamos fazer?</p></div></article>`}
    </div>
    ${busy ? `<div class="chat-progress" role="status" aria-live="polite"><span aria-hidden="true">●</span> ${state.responseTransitionPending ? "Atualizando a próxima pergunta…" : state.resuming ? "Retomando conversa…" : state.activeText ? "Processando sua resposta…" : state.recoveryBlocked ? "Aguardando conexão com a VM…" : "Enviando anexo…"}</div>` : ""}
    ${attachments.length || pendingFiles.length || state.activeFlow?.launches || state.activeFlow?.measurementLines ? `<div class="chat-file-tray">${renderAttachments(attachments, busy, Boolean(state.activeFlow), state.activeFlow?.allowBulkAttachmentDelete === true)}${pendingFiles.length ? `<ul class="pending-files" aria-label="Anexos pendentes">${pendingFiles.map(renderPendingFile).join("")}</ul>` : ""}${renderLaunches(state.activeFlow?.launches, busy)}${renderMeasurementLines(state.activeFlow?.measurementLines, busy)}</div>` : ""}
    ${signaturePrompt ? signaturePadTriggerMarkup(busy) : ""}
    <form class="chat-composer" data-chat-form>
      <div class="attachment-actions" aria-label="Adicionar anexo">
        <button type="button" data-action="pick-files" aria-label="Escolher fotos ou documentos"${busy ? " disabled" : ""}>📎</button>
        <button type="button" data-action="capture-photo" aria-label="Tirar foto"${busy ? " disabled" : ""}>📷</button>
      </div>
      <label class="sr-only" for="chatDraft">Mensagem</label>
      <textarea id="chatDraft" data-role="draft" rows="3" autocomplete="off" placeholder="Digite uma mensagem">${escapeHtml(state.draft || "")}</textarea>
      <button class="send-button" type="submit" data-action="send-text" aria-label="Enviar mensagem"${busy || pendingAttachment || !String(state.draft || "").trim() ? " disabled" : ""}>Enviar</button>
    </form>
    ${signOutConfirm ? signOutConfirmationMarkup() : ""}
    ${attachmentSource ? attachmentSourceMarkup() : ""}
    ${datePicker ? datePickerMarkup(datePickerValue) : ""}
    ${signaturePad ? signaturePadMarkup(signaturePadError) : ""}
  </section>`;
}

export function commandFromTarget(target) {
  const actionTarget = target?.closest?.("[data-action]");
  if (!actionTarget) return null;
  if (actionTarget.disabled || actionTarget.closest?.('[aria-disabled="true"]')) return null;
  return {
    type: actionTarget.dataset.action,
    ...(actionTarget.dataset.replyId ? { replyId: actionTarget.dataset.replyId } : {}),
    ...(actionTarget.dataset.label ? { label: actionTarget.dataset.label } : {}),
    ...(actionTarget.dataset.fileId ? { fileId: actionTarget.dataset.fileId } : {}),
    ...(actionTarget.dataset.messageId ? { messageId: actionTarget.dataset.messageId } : {}),
  };
}

export function createChatView(root, { onOpenSettings, onDemoAccess, onSignOut, demo = false } = {}) {
  if (!root?.addEventListener) throw new TypeError("A tela do Energético requer um elemento raiz.");
  const handlers = new Map();
  let messageKey = "";
  let lastState = null;
  let composerControls = { shell: null, composer: null };
  let composerBusy = false;
  let composing = false;
  let signOutConfirmOpen = false;
  let attachmentSourceOpen = false;
  let datePickerOpen = false;
  let datePickerValue = "";
  let signaturePadOpen = false;
  let signaturePadError = "";
  let signaturePadStrokes = [];
  let signaturePadCurrentStroke = null;

  function signaturePoint(canvas, event) {
    const rect = canvas.getBoundingClientRect?.() || { left: 0, top: 0, width: canvas.clientWidth || canvas.width, height: canvas.clientHeight || canvas.height };
    const width = Math.max(1, Number(rect.width) || canvas.width);
    const height = Math.max(1, Number(rect.height) || canvas.height);
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / height)),
    };
  }

  function drawSignatureStrokes(canvas) {
    const context = canvas?.getContext?.("2d");
    if (!context) return null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (signaturePadStrokes.length) canvas.dataset.ink = "true";
    else delete canvas.dataset.ink;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#102f3b";
    context.fillStyle = "#102f3b";
    context.lineWidth = Math.max(5, canvas.width / 125);
    for (const stroke of signaturePadStrokes) {
      if (!stroke?.length) continue;
      if (stroke.length === 1) {
        context.beginPath();
        context.arc(stroke[0].x * canvas.width, stroke[0].y * canvas.height, context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
        continue;
      }
      context.beginPath();
      context.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height);
      for (const point of stroke.slice(1)) context.lineTo(point.x * canvas.width, point.y * canvas.height);
      context.stroke();
    }
    return context;
  }

  function setupSignaturePad() {
    const canvas = root.querySelector?.('[data-role="signature-pad"]');
    if (!canvas) return;
    const context = drawSignatureStrokes(canvas);
    if (!context || canvas.dataset.bound === "true") return;
    canvas.dataset.bound = "true";
    const stop = event => {
      if (signaturePadCurrentStroke && event.pointerId != null) {
        try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* optional */ }
      }
      signaturePadCurrentStroke = null;
    };
    canvas.addEventListener("pointerdown", event => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      signaturePadCurrentStroke = [signaturePoint(canvas, event)];
      signaturePadStrokes.push(signaturePadCurrentStroke);
      canvas.dataset.ink = "true";
      try { canvas.setPointerCapture?.(event.pointerId); } catch { /* optional */ }
      drawSignatureStrokes(canvas);
    });
    canvas.addEventListener("pointermove", event => {
      if (!signaturePadCurrentStroke) return;
      event.preventDefault();
      signaturePadCurrentStroke.push(signaturePoint(canvas, event));
      drawSignatureStrokes(canvas);
    });
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", event => {
      if (event.buttons === 0) stop(event);
    });
  }

  function clearSignaturePad() {
    signaturePadStrokes = [];
    signaturePadCurrentStroke = null;
    signaturePadError = "";
    const canvas = root.querySelector?.('[data-role="signature-pad"]');
    if (canvas) {
      delete canvas.dataset.ink;
      drawSignatureStrokes(canvas);
    }
  }

  function signatureFile() {
    const canvas = root.querySelector?.('[data-role="signature-pad"]');
    if (!canvas || !signaturePadStrokes.length) return null;
    const context = canvas.getContext?.("2d");
    if (!context) return null;
    const pixels = context.getImageData?.(0, 0, canvas.width, canvas.height);
    if (!pixels?.data) return null;
    let left = canvas.width;
    let top = canvas.height;
    let right = -1;
    let bottom = -1;
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const alpha = pixels.data[offset + 3];
      const nearWhite = pixels.data[offset] > 245 && pixels.data[offset + 1] > 245 && pixels.data[offset + 2] > 245;
      if (!alpha || nearWhite) {
        pixels.data[offset + 3] = 0;
        continue;
      }
      const index = offset / 4;
      const x = index % canvas.width;
      const y = Math.floor(index / canvas.width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
    if (right < left || bottom < top) return null;
    context.putImageData?.(pixels, 0, 0);
    const padding = Math.max(12, Math.round(Math.max(right - left, bottom - top) * 0.08));
    const output = root.ownerDocument?.createElement?.("canvas") || document.createElement("canvas");
    output.width = right - left + 1 + padding * 2;
    output.height = bottom - top + 1 + padding * 2;
    const outputContext = output.getContext?.("2d");
    if (!outputContext) return null;
    outputContext.clearRect(0, 0, output.width, output.height);
    outputContext.drawImage(canvas, left, top, right - left + 1, bottom - top + 1, padding, padding, right - left + 1, bottom - top + 1);
    return output;
  }

  function confirmSignaturePad() {
    const output = signatureFile();
    if (!output) {
      signaturePadError = "Desenhe sua assinatura antes de continuar.";
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      return;
    }
    const finish = blob => {
      if (!blob) {
        signaturePadError = "Não foi possível preparar a assinatura. Tente novamente.";
        if (lastState) {
          const state = lastState;
          lastState = null;
          render(state);
        }
        return;
      }
      const FileCtor = globalThis.File;
      const file = typeof FileCtor === "function"
        ? new FileCtor([blob], "assinatura-desenhada.png", { type: "image/png", lastModified: Date.now() })
        : Object.assign(blob, { name: "assinatura-desenhada.png", lastModified: Date.now() });
      signaturePadOpen = false;
      signaturePadError = "";
      signaturePadStrokes = [];
      signaturePadCurrentStroke = null;
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      emit({ type: "signature-captured", file });
    };
    if (typeof output.toBlob === "function") output.toBlob(finish, "image/png");
    else finish(null);
  }

  function onlyDraftChanged(state) {
    return lastState && state.sessionStatus === "authenticated"
      && lastState.sessionStatus === state.sessionStatus
      && lastState.account?.name === state.account?.name
      && lastState.account?.username === state.account?.username
      && lastState.account?.homeAccountId === state.account?.homeAccountId
      && (!state.recoveryReference || Boolean(lastState.draft) === Boolean(state.draft))
      && ["messages", "attachments", "pendingFiles", "activeText", "activeFlow", "resuming", "responseTransitionPending", "error", "recoveryPreview", "recoveryReference", "recoveryReferenceCount", "recoveryWarning", "recoveryBlocked"].every(key => lastState[key] === state[key]);
  }

  function syncComposer(state, draftOnly = false) {
    const { draft } = composerControls;
    if (!composing && draft && draft.value !== (state.draft || "")) draft.value = state.draft || "";
    if (!draftOnly) composerBusy = Boolean(state.activeText || state.resuming || state.responseTransitionPending || state.recoveryBlocked)
      || (state.pendingFiles || []).some(item => item.status === "sending");
    for (const action of draftOnly ? ["send-text"] : ["send-text", "capture-photo", "pick-files"]) {
      const button = composerControls[action];
      const disabled = composerBusy || (action === "send-text" && (
        (state.pendingFiles || []).length > 0 || !String(state.draft || "").trim()
      ));
      if (button && button.disabled !== disabled) button.disabled = disabled;
    }
  }

  function updateShell(markup, state) {
    const shell = root.querySelector('.chat-shell');
    const composer = shell?.querySelector('[data-chat-form]');
    if (!composer || state.sessionStatus !== "authenticated") {
      root.innerHTML = markup;
      composing = false;
      const nextShell = root.querySelector('.chat-shell');
      const nextComposer = nextShell?.querySelector('[data-chat-form]');
      composerControls = { shell: nextShell, composer: nextComposer, draft: root.querySelector('[data-role="draft"]') };
      for (const action of ["send-text", "capture-photo", "pick-files"]) {
        composerControls[action] = root.querySelector(`[data-action="${action}"]`);
      }
      return;
    }
    composerControls.shell = shell;
    composerControls.composer = composer;
    const template = root.ownerDocument.createElement('template');
    template.innerHTML = markup;
    const nextShell = template.content.querySelector('.chat-shell');
    // Never detach the composer: restoring focus on a new field resets the iOS keyboard.
    for (const child of [...shell.children]) {
      if (child !== composer) child.remove();
    }
    for (const child of [...nextShell.children]) {
      if (!child.matches('[data-chat-form]')) shell.insertBefore(child, composer);
    }
  }

  function emit(command) {
    handlers.get(command.type)?.forEach(handler => handler(command));
  }

  function resizeDraft(draft) {
    if (!draft) return;
    draft.style.height = "auto";
    const minHeight = 76;
    const maxHeight = 176;
    const height = Math.min(Math.max(draft.scrollHeight || minHeight, minHeight), maxHeight);
    draft.style.height = `${height}px`;
    draft.style.overflowY = (draft.scrollHeight || 0) > maxHeight ? "auto" : "hidden";
  }

  function resetComposerLayout() {
    const draft = composerControls.draft;
    if (!draft) return;
    // A long previous answer must not leave the next prompt with an oversized
    // composer. It grows again only when the user types in the field.
    draft.style.height = "76px";
    draft.style.overflowY = "hidden";
  }

  function syncComposerInset() {
    const { shell, composer } = composerControls;
    if (!shell || !composer) return;
    const height = Number(composer.getBoundingClientRect?.().height || composer.offsetHeight || 0);
    if (height > 0) shell.style.setProperty('--chat-composer-height', `${Math.ceil(height)}px`);
  }

  function resetTranscriptPosition(transcript) {
    if (!transcript) return;
    const reset = () => {
      if (!transcript.isConnected) return;
      transcript.scrollTop = 0;
      transcript.scrollLeft = 0;
      transcript.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    };
    // Safari can restore the previous scroll anchor after the DOM update. Do
    // the reset now and again after layout/paint so the new question remains
    // visible even when the previous answer was a long option list.
    reset();
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === "function") {
      raf(reset);
      raf(() => raf(reset));
    } else {
      globalThis.setTimeout?.(reset, 0);
    }
  }

  function click(event) {
    const command = commandFromTarget(event.target);
    if (!command) return;
    if (command.type === "send-text") return;
    event.preventDefault?.();
    if (command.type === "toggle-launch-details") {
      const entry = event.target.closest('.chat-launch-entry');
      const details = entry?.querySelector('.chat-launch-details');
      if (details) {
        details.hidden = !details.hidden;
        const button = entry.querySelector('[data-action="toggle-launch-details"]');
        button.setAttribute('aria-expanded', String(!details.hidden));
        button.textContent = details.hidden ? '▾' : '▴';
      }
      return;
    }
    if (command.type === "toggle-measurement-details") {
      const entry = event.target.closest('.chat-measurement-entry');
      const details = entry?.querySelector('.chat-measurement-details');
      if (details) {
        details.hidden = !details.hidden;
        const button = entry.querySelector('[data-action="toggle-measurement-details"]');
        button.setAttribute('aria-expanded', String(!details.hidden));
        button.textContent = details.hidden ? '▾' : '▴';
      }
      return;
    }
    if (command.type === "sign-out") {
      if (signOutConfirmOpen) return;
      signOutConfirmOpen = true;
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      return;
    }
    if (command.type === "pick-files") {
      if (attachmentSourceOpen) return;
      attachmentSourceOpen = true;
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      return;
    }
    if (command.type === "open-date-picker") {
      if (datePickerOpen) return;
      datePickerOpen = true;
      datePickerValue = localDateIso();
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      globalThis.setTimeout?.(() => {
        const input = root.querySelector('[data-role="date-picker"]');
        input?.focus?.();
        try { input?.showPicker?.(); } catch { /* native picker is optional */ }
      }, 0);
      return;
    }
    if (command.type === "open-signature-pad") {
      if (signaturePadOpen) return;
      signaturePadOpen = true;
      signaturePadError = "";
      signaturePadStrokes = [];
      signaturePadCurrentStroke = null;
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      globalThis.setTimeout?.(() => {
        setupSignaturePad();
        root.querySelector('[data-role="signature-pad"]')?.focus?.();
      }, 0);
      return;
    }
    if (command.type === "clear-signature-pad") {
      clearSignaturePad();
      return;
    }
    if (command.type === "cancel-signature-pad") {
      signaturePadOpen = false;
      signaturePadError = "";
      signaturePadStrokes = [];
      signaturePadCurrentStroke = null;
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      return;
    }
    if (command.type === "confirm-signature-pad") {
      confirmSignaturePad();
      return;
    }
    if (command.type === "cancel-date-picker") {
      datePickerOpen = false;
      datePickerValue = "";
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      return;
    }
    if (command.type === "confirm-date-picker") {
      const value = String(root.querySelector('[data-role="date-picker"]')?.value || datePickerValue || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        root.querySelector('[data-role="date-picker"]')?.focus?.();
        return;
      }
      datePickerOpen = false;
      datePickerValue = "";
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      emit({ type: "date-selected", value });
      return;
    }
    if (command.type === "cancel-attachment-source") {
      attachmentSourceOpen = false;
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      return;
    }
    if (command.type === "pick-photos" || command.type === "pick-document-files") {
      attachmentSourceOpen = false;
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      emit({ type: command.type });
      return;
    }
    if (command.type === "cancel-sign-out") {
      signOutConfirmOpen = false;
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      return;
    }
    if (command.type === "confirm-sign-out") {
      signOutConfirmOpen = false;
      if (onSignOut) return onSignOut();
      emit({ type: "sign-out" });
      return;
    }
    if (command.type === "open-settings") return onOpenSettings?.();
    if (command.type === "demo-access") return onDemoAccess?.();
    emit(command);
  }

  function input(event) {
    if (event.target?.dataset?.role === "draft") {
      resizeDraft(event.target);
      syncComposerInset();
      emit({ type: "draft-changed", value: event.target.value });
    } else if (event.target?.dataset?.role === "date-picker") {
      datePickerValue = event.target.value;
    }
  }

  function submit(event) {
    if (!event.target?.matches?.("[data-chat-form]")) return;
    event.preventDefault?.();
    emit({ type: "send-text" });
  }

  function compositionStart(event) {
    if (event.target === composerControls.draft) composing = true;
  }

  function compositionEnd(event) {
    if (event.target !== composerControls.draft) return;
    composing = false;
    input(event);
  }

  function render(state) {
    if (onlyDraftChanged(state)) {
      syncComposer(state, true);
      lastState = state;
      return;
    }
    const attachmentsOpen = root.querySelector?.(".chat-attachments")?.open;
    const oldLaunches = root.querySelector?.(".chat-launches");
    const launchOpen = oldLaunches?.open;
    const sameLaunch = oldLaunches?.dataset.batchId === state.activeFlow?.launches?.id;
    const oldMeasurements = root.querySelector?.(".chat-measurements");
    const measurementOpen = oldMeasurements?.open;
    const sameMeasurements = oldMeasurements?.dataset.batchId === state.activeFlow?.measurementLines?.id;
    const responseFinished = Boolean(lastState?.activeText && !state.activeText && !state.error);
    const previousScroll = root.querySelector?.('[role="log"]')?.scrollTop || 0;
    const trayScroll = root.querySelector?.(".chat-file-tray")?.scrollTop || 0;
    const nextMessageKey = (state.messages || []).map(message => message.id).join("|");
    updateShell(renderChatMarkup(state, {
      showSettings: typeof onOpenSettings === "function",
      allowDemo: typeof onDemoAccess === "function",
      demo,
      signOutConfirm: signOutConfirmOpen,
      attachmentSource: attachmentSourceOpen,
      datePicker: datePickerOpen,
      datePickerValue,
      signaturePad: signaturePadOpen,
      signaturePadError,
    }), state);
    syncComposer(state);
    const attachments = root.querySelector?.(".chat-attachments");
    if (attachments && attachmentsOpen) attachments.open = true;
    const tray = root.querySelector?.(".chat-file-tray");
    const launches = root.querySelector?.(".chat-launches");
    if (launches && sameLaunch) launches.open = Boolean(launchOpen);
    const measurements = root.querySelector?.(".chat-measurements");
    if (measurements && sameMeasurements) measurements.open = Boolean(measurementOpen);
    if (tray) tray.scrollTop = (launches && !sameLaunch) || (measurements && !sameMeasurements) ? 0 : trayScroll;
    const transcript = root.querySelector?.('[role="log"]');
    const messageChanged = messageKey !== nextMessageKey;
    if (transcript) {
      if (responseFinished || (messageChanged && !state.activeText)) resetTranscriptPosition(transcript);
      else transcript.scrollTop = messageChanged ? transcript.scrollHeight : previousScroll;
    }
    if (responseFinished) resetComposerLayout();
    syncComposerInset();
    messageKey = nextMessageKey;
    lastState = state;
    if (signOutConfirmOpen) {
      root.querySelector('[data-action="cancel-sign-out"]')?.focus?.();
    }
    if (attachmentSourceOpen) {
      root.querySelector('[data-action="pick-photos"]')?.focus?.();
    }
    if (datePickerOpen) {
      root.querySelector('[data-role="date-picker"]')?.focus?.();
    }
    if (signaturePadOpen) setupSignaturePad();
  }

  root.addEventListener("click", click);
  root.addEventListener("input", input);
  root.addEventListener("submit", submit);
  root.addEventListener("compositionstart", compositionStart);
  root.addEventListener("compositionend", compositionEnd);

  return Object.freeze({
    render,
    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
      return () => handlers.get(type)?.delete(handler);
    },
    destroy() {
      root.removeEventListener("click", click);
      root.removeEventListener("input", input);
      root.removeEventListener("submit", submit);
      root.removeEventListener("compositionstart", compositionStart);
      root.removeEventListener("compositionend", compositionEnd);
      composerControls = { shell: null, composer: null };
      composing = false;
      handlers.clear();
      lastState = null;
      signOutConfirmOpen = false;
      attachmentSourceOpen = false;
      datePickerOpen = false;
      datePickerValue = "";
      signaturePadOpen = false;
      signaturePadError = "";
      signaturePadStrokes = [];
      signaturePadCurrentStroke = null;
      root.innerHTML = "";
    },
  });
}
