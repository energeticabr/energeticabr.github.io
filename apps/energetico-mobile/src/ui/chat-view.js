import { escapeHtml } from "./escape-html.js";
import { auditLogRow, renderAuditLogTable } from "./audit-log-table.js";
import { createSignaturePlacement } from "../web/signature-placement.js";
import { latestDatabaseFilter } from "../chat/database-filter.js";
import { PRESENCE_OTHER_DATES_REPLY_ID } from "../chat/presence-date-scope.js";

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

function isPaymentReceiptDocument(value) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLocaleUpperCase("pt-BR");
  return normalized.includes("COMPROVANTEPAGAMENTO") || normalized.includes("COMPROVANTEPGTO");
}

function isEpiDeliveryDocument(value) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLocaleUpperCase("pt-BR");
  return normalized.includes("ENTREGAEPI") || normalized.includes("COMPROVANTEEPI");
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

const QUESTION_FIELD_LABELS = [
  "DATA DE PAGAMENTO PREVISTO",
  "DATA DE PAGAMENTO EFETUADO",
  "DATA DE PAGAMENTO",
  "DATA PGTO PREVISTO",
  "DATA PGTO EFETUADO",
  "OBSERVAÇÕES ENTREGA",
  "PAGAMENTO NA ENTREGA",
  "FORMA DE PGTO",
  "TIPO DE OPERAÇÃO",
  "TIPO DE TRANSAÇÃO",
  "PESSOA RELACIONADA",
  "UNIDADE DE MEDIDA",
  "FORMA DE PAGAMENTO",
  "VALOR UNITÁRIO",
  "VALOR TOTAL",
  "DATA DE VENCIMENTO",
  "TIPO DE HOMOLOGAÇÃO",
  "TIPO DE DOCUMENTO",
  "TIPO DE MARCO",
  "TIPO DE DESPESA",
  "DATA/HORA",
  "SUBFAMÍLIA",
  "OBSERVAÇÕES",
  "DOCUMENTO",
  "FORNECEDOR",
  "PROFISSÃO",
  "FILIAL",
  "PRODUTO",
  "UNIDADE",
  "QUANTIDADE",
  "VALOR",
  "PAGAMENTO",
  "CONTRATO",
  "IMÓVEL",
  "ETAPA",
  "STATUS",
  "FAMÍLIA",
  "DESCRIÇÃO",
  "OBSERVAÇÃO",
  "MOTIVAÇÃO",
  "MOTIVO",
  "PRIORIDADE",
  "OPERAÇÃO",
  "RELATÓRIO",
  "PROVISÃO",
  "COTAÇÃO",
  "PERÍODO",
  "EMISSÃO",
  "VALIDADE",
  "IDENTIFICAÇÃO",
  "PRESENÇA",
  "ATIVIDADE",
  "LANÇAMENTO",
  "DESPESA",
  "CLIENTE",
  "OBRA",
  "CONTA",
  "TAREFA",
  "RESPONSÁVEL",
  "FUNÇÃO",
  "EQUIPAMENTO",
  "ANEXO",
  "ASSINATURA",
  "NÚMERO",
  "CÓDIGO",
  "HOMOLOGAÇÃO",
  "TÍTULO",
  "ENDEREÇO",
  "CIDADE",
  "TELEFONE",
  "WHATSAPP",
  "E-MAIL",
  "EMAIL",
  "CPF",
  "CNPJ",
  "NOME",
  "ID",
].sort((left, right) => right.length - left.length);

function normalizedQuestionWithMap(value) {
  const raw = String(value ?? "");
  let normalized = "";
  const map = [];
  let offset = 0;
  for (const character of raw) {
    const folded = character
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleUpperCase("pt-BR");
    for (let index = 0; index < folded.length; index += 1) {
      normalized += folded[index];
      map.push({ start: offset, end: offset + character.length });
    }
    offset += character.length;
  }
  return { raw, normalized, map };
}

function questionFieldRange(value) {
  const { raw, normalized, map } = normalizedQuestionWithMap(value);
  let best = null;
  for (const label of QUESTION_FIELD_LABELS) {
    const needle = label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleUpperCase("pt-BR");
    let searchFrom = 0;
    while (searchFrom < normalized.length) {
      const match = normalized.indexOf(needle, searchFrom);
      if (match < 0) break;
      const start = map[match]?.start;
      const end = map[match + needle.length - 1]?.end;
      const before = start === undefined ? "" : raw[start - 1];
      const after = end === undefined ? "" : raw[end];
      const wordCharacter = /[\p{L}\p{N}_]/u;
      if (!wordCharacter.test(before || "") && !wordCharacter.test(after || "")) {
        const candidate = { start, end };
        if (!best || start < best.start || (start === best.start && end > best.end)) {
          best = candidate;
        }
        break;
      }
      searchFrom = match + needle.length;
    }
  }
  return best;
}

function formatQuestionText(value) {
  const text = String(value ?? "");
  const range = questionFieldRange(text);
  const formatted = formatChatText(text);
  if (!range) return formatted;
  const fieldHtml = formatChatText(text.slice(range.start, range.end));
  return formatted.replace(
    fieldHtml,
    `<span class="chat-question-field">${fieldHtml}</span>`,
  );
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

function expiredTemporaryAttachmentOptions(message, options) {
  const messageText = normalizedDateText([
    message?.question,
    message?.prompt,
    message?.text,
    message?.caption,
  ].filter(Boolean).join(" "));
  const isExpiredTemporaryAttachment = /anexo\s+temporario\s+nao\s+esta\s+mais\s+disponivel/.test(messageText)
    && /dados\s+do\s+formulario\s+foram\s+preservados/.test(messageText)
    && /reenvie\s+o\s+arquivo/.test(messageText);
  if (!isExpiredTemporaryAttachment || options.some(option => draftReplyId(option).trim().toLowerCase() === "attachment_upload_skip")) {
    return options;
  }
  return [...options, {
    id: "attachment_upload_skip",
    reply: "attachment_upload_skip",
    label: "➡️ PROSSEGUIR SEM ANEXO",
  }];
}

function databaseFilteredOptions(message, options, draft = "", enabled = true) {
  if (!enabled || message?.databaseFilter !== true) return options;
  const query = String(draft || "").trim();
  if (!query || query.split(/\s+/u).length > 2) return options;
  const words = normalizedDateText(query).split(/\s+/u).filter(Boolean);
  if (!words.length) return options;
  return options.filter(option => {
    if (String(option?.reply || option?.id || "").trim() === PRESENCE_OTHER_DATES_REPLY_ID) return true;
    const searchable = normalizedDateText([
      option?.label,
      option?.title,
      option?.name,
      option?.displayName,
      option?.text,
      option?.searchText,
      option?.value,
      option?.id,
      option?.reply,
    ].filter(value => value != null).join(" "));
    return words.every(word => searchable.includes(word));
  });
}

function isDateQuestion(message, options = []) {
  if (message?.calendarPicker === true || message?.calendar_picker === true) return true;
  const question = normalizedDateText(message?.question || message?.prompt || message?.text);
  if (!/\bdata\b/.test(question)) return false;
  const choices = options.map(option => normalizedDateText(option?.label || option?.title || option?.id)).join(" ");
  const datePreset = /\b(?:ontem|hoje|amanha|outra data|digitar data|data de hoje)\b/.test(choices);
  const dateFormat = /\b(?:dd\s*[,/]\s*dd|dd\/mm|dd\/mm\/aaaa|formato\s+dd)\b/.test(question);
  const directRequest = /\b(?:qual|informe|indique|digite|envie|selecione|escolha|nova)\b[^\n?.!]{0,80}\bdata\b/.test(question);
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

function pollButton(option, busy, { deleteButton = false, deleteClass = "chat-draft-delete" } = {}) {
  const replyId = draftReplyId(option);
  const label = option.label || option.title || option.id;
  const disabled = busy || option?.disabled === true;
  if (deleteButton) {
    const title = option?.deleteTitle || draftTitle(option);
    const noun = option?.deleteFor === "document" ? "documento" : "rascunho";
    return `<button class="${escapeHtml(deleteClass)}" type="button" data-action="select-reply" data-reply-id="${escapeHtml(replyId)}" data-label="${escapeHtml(`Excluir ${noun} • ${title}`)}" aria-label="Excluir ${noun}: ${escapeHtml(title)}" title="Excluir ${noun}: ${escapeHtml(title)}"${disabled ? " disabled" : ""}>🗑️</button>`;
  }
  const toneClass = option?.tone === "danger"
    ? " chat-choice-button--danger"
    : option?.tone === "finish" ? " chat-choice-button--finish" : "";
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

function isSignedDocumentMessage(message) {
  if (message?.type !== "document") return false;
  const label = normalizedDateText(message?.caption || message?.fileName || message?.text);
  return /\bdocumento\s+assinado\b/.test(label)
    || /\bassinado\s+e\s+enviado\b/.test(label)
    || /\bassinatura\s+aplicada\b/.test(label);
}

function isAutomaticMainMenuMessage(message) {
  if (message?.type !== "poll") return false;
  const question = normalizedDateText(message?.question || message?.prompt || message?.text);
  return /qual\s+area\s+voce\s+deseja\s+acessar/.test(question);
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

function paymentAuditValue(row, keys, fallback = "-") {
  if (!row || typeof row !== "object") return fallback;
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
  }
  return fallback;
}

function paymentAuditTableMarkup(table) {
  if (!table || typeof table !== "object") return "";
  const rows = Array.isArray(table.rows) ? table.rows : [];
  if (!rows.length) return "";
  const headers = Array.isArray(table.headers) && table.headers.length
    ? table.headers.slice(0, 3)
    : ["ID", "VALOR DIÁRIO", "VALOR DO LANÇAMENTO"];
  const normalizedRows = rows.map(row => Array.isArray(row)
    ? [row[0] ?? "-", row[1] ?? "-", row[2] ?? "-"]
    : [
      paymentAuditValue(row, ["id", "ID", "identifier", "identificador"]),
      paymentAuditValue(row, ["dailyValue", "daily_value", "valorDiario", "valor_diario", "VLORDIARIO", "valor diário"]),
      paymentAuditValue(row, ["launchValue", "launch_value", "valorLancamento", "valor_lancamento", "valor do lançamento", "valor do lancamento"]),
    ]);
  const totals = table.totals || table.total || {};
  const totalDaily = Array.isArray(totals) ? totals[1] : paymentAuditValue(totals, ["dailyValue", "daily_value", "valorDiario", "valor_diario", "VLORDIARIO", "valor diário"]);
  const totalLaunch = Array.isArray(totals) ? totals[2] : paymentAuditValue(totals, ["launchValue", "launch_value", "valorLancamento", "valor_lancamento", "valor do lançamento", "valor do lancamento"]);
  const title = table.title || "📊 COMPARAÇÃO DOS VALORES";
  return `<div class="chat-payment-audit-table" role="table" aria-label="Comparação dos valores da auditoria de pagamento"><strong>${formatChatText(title)}</strong><div class="chat-payment-audit-table__row chat-payment-audit-table__row--header" role="row">${headers.map(header => `<span role="columnheader">${escapeHtml(header)}</span>`).join("")}</div>${normalizedRows.map(row => `<div class="chat-payment-audit-table__row" role="row">${row.map(value => `<span role="cell">${escapeHtml(value)}</span>`).join("")}</div>`).join("")}<div class="chat-payment-audit-table__row chat-payment-audit-table__row--total" role="row"><strong role="cell">TOTAL</strong><strong role="cell">${escapeHtml(totalDaily)}</strong><strong role="cell">${escapeHtml(totalLaunch)}</strong></div></div>`;
}

function presenceDateSummaryMarkup(summary) {
  if (!summary || typeof summary !== "object") return "";
  const rawDate = String(summary.date || "").trim();
  const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match ? `${match[3]}/${match[2]}/${match[1]}` : rawDate || "a data selecionada";
  const count = Math.max(0, Number(summary.count) || 0);
  return `<div class="chat-presence-date-summary" role="status"><strong>📅 ${escapeHtml(date)}</strong><span>${count} presença(s) pendente(s) para esta data.</span><small>Use “VER OUTRAS DATAS” para consultar outros dias.</small></div>`;
}

function isProductLineSelector(message, activeFlow) {
  if (String(activeFlow?.id || "").trim().toLocaleLowerCase("pt-BR") !== "document_signing") return false;
  if (message?.line_item_selector === true || message?.lineItemSelector === true) return true;
  const question = normalizedDateText(message?.question || message?.prompt || message?.text);
  if (!/\b(?:produto|epi|equipamento)\b/i.test(question)) return false;
  return /\b(?:qual|selecione|escolha)\b/i.test(question)
    && !Array.from(message.options || []).some(option => /^attachment_/i.test(draftReplyId(option)));
}

function delegatedTaskRows(message, snapshot) {
  if (snapshot && Array.isArray(snapshot.rows)) {
    return snapshot.rows.map(row => ({
      id: String(row.id || ""),
      task: String(row.task || row.title || "Tarefa sem descrição"),
      responsible: String(row.responsible || row.responsavel || ""),
      priority: row.priority === true,
      fatalDate: String(row.fatalDate || ""),
      branch: String(row.branch || ""),
      association: String(row.association || ""),
      status: String(row.status || ""),
    })).filter(row => row.id);
  }
  return (Array.isArray(message?.options) ? message.options : [])
    .map(option => option?.task && typeof option.task === "object"
      ? { ...option.task, id: String(option.task.id || option.value || "") }
      : null)
    .filter(row => row?.id);
}

function delegatedTasksMarkup(message, busy, snapshot) {
  const rows = delegatedTaskRows(message, snapshot);
  if (!rows.length) return `<div class="chat-delegated-tasks-empty">✅ Não há tarefas delegadas pendentes.</div>`;
  return `<div class="chat-delegated-tasks" data-role="delegated-tasks-gallery">
    <label class="chat-delegated-tasks__search"><span class="sr-only">Pesquisar tarefas delegadas</span><input type="search" data-role="delegated-tasks-search" placeholder="Pesquisar tarefa…" autocomplete="off"></label>
    <div class="chat-delegated-tasks__list" role="list" aria-label="Tarefas delegadas pendentes">${rows.map(row => {
      const details = [row.responsible && `Responsável: ${row.responsible}`, row.fatalDate && `Data fatal: ${row.fatalDate}`, row.branch, row.association].filter(Boolean).join(" · ");
      return `<article class="chat-delegated-task" data-delegated-task-item data-task-id="${escapeHtml(row.id)}" draggable="true" role="listitem"><span class="chat-delegated-task__handle" aria-hidden="true">☷</span><div class="chat-delegated-task__body"><strong>${row.priority ? "⭐ " : ""}${escapeHtml(row.task)}</strong><small>${escapeHtml(details || "Tarefa delegada pendente")}</small></div><button class="chat-delegated-task__complete" type="button" data-action="complete-delegated-task" data-task-id="${escapeHtml(row.id)}" aria-label="Concluir tarefa ${escapeHtml(row.id)}" title="Concluir tarefa"${busy ? " disabled" : ""}>✅</button></article>`;
    }).join("")}</div>
    <p class="chat-delegated-tasks__hint">Arraste uma tarefa para ordenar por relevância. A ordem fica salva neste aparelho.</p>
  </div>`;
}

function renderPoll(message, busy, delegatedTasks, draft = "", databaseFilterMessage = null, activeFlow = null) {
  const allOptions = databaseFilteredOptions(
    message,
    expiredTemporaryAttachmentOptions(message, draftMenuOptions(message)),
    draft,
    databaseFilterMessage === message,
  );
  const auditRows = allOptions.map(auditLogRow).filter(Boolean);
  // Navigation is rendered in the fixed flow bar so forms keep only the
  // choices for their current question.
  const options = allOptions.filter(option => !auditLogRow(option) && !navigationOptionKind(option));
  const paymentAuditTable = message.payment_audit_table || message.paymentAuditTable
    || (message.detail_table?.kind === "payment_audit" ? message.detail_table : null)
    || (message.detailTable?.kind === "payment_audit" ? message.detailTable : null);
  const lineSelector = isProductLineSelector(message, activeFlow);
  const hasLineFinalizer = options.some(option => draftReplyId(option).trim().toLowerCase() === "document_line_finalize");
  const displayOptions = lineSelector && !hasLineFinalizer
    ? [{ id: "document_line_finalize", reply: "document_line_finalize", label: "✅ FINALIZAR", tone: "finish", terminal_option: true }, ...options]
    : options;
  const isDraftMenu = /RASCUNHOS?/i.test(String(message.question || message.prompt || ""));
  const deleteByDraft = new Map(options
    .map(option => [draftReplyId(option), option])
    .filter(([replyId]) => replyId.startsWith("draft_delete:"))
    .map(([replyId, option]) => [replyId.slice("draft_delete:".length), option]));
  const seenDrafts = new Set();
  const choices = displayOptions.flatMap(option => {
    const replyId = draftReplyId(option);
    if (isDraftMenu && replyId.startsWith("draft_delete:")) return [];
    if (isDraftMenu && replyId.startsWith("draft_resume:")) {
      const draftId = replyId.slice("draft_resume:".length);
      if (seenDrafts.has(draftId)) return [];
      seenDrafts.add(draftId);
      const deleteOption = deleteByDraft.get(draftId);
      return [`<div class="chat-draft-option">${pollButton(option, busy)}${deleteOption ? pollButton(deleteOption, busy, { deleteButton: true }) : ""}</div>`];
    }
    if (option?.delete_action && !option.terminal_option) {
      const deleteAction = {
        ...option.delete_action,
        deleteFor: "document",
        deleteTitle: draftTitle(option),
      };
      return [`<div class="chat-document-option">${pollButton(option, busy)}${pollButton(deleteAction, busy, { deleteButton: true, deleteClass: "chat-document-option__delete" })}</div>`];
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
  const isDelegatedTasks = message?.presentation === "delegated_tasks";
  const choiceListClass = displayOptions.length === 1
    ? "chat-choice-list chat-choice-list--single"
    : "chat-choice-list";
  return `<div class="chat-choice-card${isPendingAttendanceList ? " chat-choice-card--pending-attendance" : ""}">
    <p>${formatQuestionText(changeTableQuestion(message, changeTable) || "Escolha uma opção")}</p>
    ${changeTableMarkup(changeTable)}
    ${presenceDetailTableMarkup(presenceTable)}
    ${paymentAuditTableMarkup(paymentAuditTable)}
    ${presenceDateSummaryMarkup(message.presenceDateSummary)}
    ${renderAuditLogTable(auditRows, busy)}
    ${calendarPicker ? datePickerTriggerMarkup(busy) : ""}
    ${isDelegatedTasks ? delegatedTasksMarkup(message, busy, delegatedTasks) : `<div class="${choiceListClass}">${choices}</div>`}
  </div>`;
}

function flowNavigation(messages) {
  const result = { back: false, home: false };
  const latestPoll = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find(message => message?.role !== "user" && message?.type === "poll");
  if (!Array.isArray(latestPoll?.options)) return result;
  for (const option of latestPoll.options) {
    const kind = navigationOptionKind(option);
    if (kind === "back") result.back = true;
    if (kind === "home") result.home = true;
  }
  return result;
}

function latestPollTitle(messages) {
  const latestPoll = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find(message => message?.role !== "user" && message?.type === "poll");
  return String(latestPoll?.question || latestPoll?.prompt || latestPoll?.text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean)
    || "Fluxo em andamento";
}

function asksToFinishFlow(messages) {
  const latestAssistantMessage = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find(message => message?.role !== "user"
      && (message?.type === "text" || message?.type === "poll"));
  const prompt = latestAssistantMessage?.type === "poll"
    ? latestAssistantMessage.question || latestAssistantMessage.prompt || latestAssistantMessage.text
    : latestAssistantMessage?.text || latestAssistantMessage?.question || latestAssistantMessage?.prompt;
  const promptText = String(prompt || "");
  const hasAttachmentContinuation = Array.isArray(latestAssistantMessage?.options)
    && latestAssistantMessage.options.some(option => draftReplyId(option).trim().toLowerCase() === "attachment_upload_continue");
  if (hasAttachmentContinuation) return true;
  if (/\b(?:responda|digite|envie)\s*(?:[:\-]\s*)?["“”']?\s*finalizar\b/i.test(promptText)) return true;
  return /envie\s+o\s+primeiro\s+anexo/i.test(promptText)
    && /(?:adicionar\s+mais\s+anexos|cada\s+envio)/i.test(promptText)
    && /\bfinalizar\b/i.test(promptText);
}

function flowStatusMarkup(state, messages, busy, fallbackTitle = "", { homeOnly = false } = {}) {
  // An active flow always has navigation, including text-only/confirmation
  // screens whose latest message is not a poll. The root menu has no
  // activeFlow, so it remains the only screen without this green bar.
  const title = String(state.activeFlow?.title || state.completionNavigation?.title || fallbackTitle || "Fluxo em andamento");
  const back = homeOnly ? "" : `<button class="chat-flow-nav-button" type="button" data-action="select-reply" data-reply-id="navigation_back" data-label="↩️ RETORNAR À PERGUNTA ANTERIOR" aria-label="Retornar à pergunta anterior" title="Retornar à pergunta anterior"${busy ? " disabled" : ""}>↩️</button>`;
  const home = `<button class="chat-flow-nav-button" type="button" data-action="select-reply" data-reply-id="navigation_main_menu" data-label="🏠 RETORNAR AO MENU INICIAL" aria-label="Retornar ao menu inicial" title="Retornar ao menu inicial"${busy ? " disabled" : ""}>🏠</button>`;
  const finish = !homeOnly && asksToFinishFlow(messages)
    ? `<button class="chat-flow-finish" type="button" data-action="finish-flow" aria-label="Finalizar anexos" title="Finalizar anexos"${busy ? " disabled" : ""}>FINALIZAR</button>`
    : "";
  const actions = homeOnly
    ? ""
    : `${finish}<button class="chat-flow-summary" type="button" data-action="show-summary"${busy ? " disabled" : ""}>Ver resumo</button>`;
  return `<div class="chat-flow-status">
    <div class="chat-flow-navigation" aria-label="Navegação do fluxo">${back}${home}</div>
    <strong class="chat-flow-title" title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
    <div class="chat-flow-actions">${actions}</div>
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

function renderMessage(message, account, busy, { finalSignedDocument = false, delegatedTasks = null, draft = "", databaseFilterMessage = null, activeFlow = null } = {}) {
  if (message.type === "poll") {
    return `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong>${renderPoll(message, busy, delegatedTasks, draft, databaseFilterMessage, activeFlow)}</div></article>`;
  }
  if (message.type === "image" || message.type === "document") {
    const label = message.caption || message.fileName || "Arquivo gerado";
    const signatureEdit = message.signatureEdit || message.signature_edit;
    const signatureEditAvailable = message.signatureEditAvailable === true
      || message.signature_edit_available === true;
    const canEditSignature = message.type === "document"
      && (isSignedDocumentMessage(message)
        || (signatureEdit?.document?.mediaUrl && signatureEdit?.signature?.mediaUrl)
        || signatureEditAvailable);
    const preview = message.previewUrl
      ? `<img class="chat-media-preview__image" src="${escapeHtml(message.previewUrl)}" alt="Prévia de ${escapeHtml(label)}">`
      : `<span class="chat-media-preview__icon" aria-hidden="true">${message.type === "image" ? "🖼️" : "📄"}</span>`;
    const signatureEditAction = canEditSignature
      ? `<button class="signature-edit-generated" type="button" data-action="resize-signature" data-message-id="${escapeHtml(message.id)}" aria-label="Redimensionar ou reposicionar assinatura"${busy ? " disabled" : ""}>✍️ REDIMENSIONAR ASSINATURA / MUDAR DE LUGAR</button>`
      : "";
    const returnMenuAction = finalSignedDocument
      ? `<button class="signature-return-menu" type="button" data-action="select-reply" data-reply-id="navigation_main_menu" data-label="🏠 RETORNAR AO MENU INICIAL" aria-label="Retornar ao menu inicial"${busy ? " disabled" : ""}>🏠 RETORNAR AO MENU INICIAL</button>`
      : "";
    const signatureActions = signatureEditAction || returnMenuAction
      ? `<div class="signature-final-actions">${signatureEditAction}${returnMenuAction}</div>`
      : "";
    return `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong><p>${message.caption ? formatChatText(label) : escapeHtml(label)}</p><button class="chat-media-preview chat-media-preview--${message.type}" type="button" data-action="open-media" data-message-id="${escapeHtml(message.id)}" aria-label="Abrir ${escapeHtml(label)}">${preview}<span class="chat-media-preview__caption"><b>${message.caption ? formatChatText(label) : escapeHtml(label)}</b><small>Toque para abrir o arquivo completo</small></span></button>${signatureActions}</div></article>`;
  }

  const isUser = message.role === "user";
  const name = isUser ? account?.name || "Você" : "Energético";
  const avatar = isUser ? userAvatar(account) : assistantAvatar();
  const presenceConfirmation = message.presence_confirmation || message.presenceConfirmation;
  const paymentAuditTable = message.payment_audit_table || message.paymentAuditTable
    || (message.detail_table?.kind === "payment_audit" ? message.detail_table : null)
    || (message.detailTable?.kind === "payment_audit" ? message.detailTable : null);
  const body = !isUser && presenceConfirmation
    ? presenceConfirmationMarkup(presenceConfirmation)
    : `${isUser ? `<p>${escapeHtml(message.text || "")}</p>` : `<p>${formatQuestionText(message.text)}</p>${paymentAuditTableMarkup(paymentAuditTable)}${presenceDateSummaryMarkup(message.presenceDateSummary)}`}`;
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
      const actions = existing ? "" : `<span class="chat-attachment-actions"><button class="chat-attachment-sign" type="button" data-action="open-signature-pad" data-file-id="${escapeHtml(item.id)}" aria-label="Assinar documento: ${escapeHtml(item.fileName)}" title="Assinar documento"${busy ? " disabled" : ""}>✍️</button><button class="chat-attachment-compress" type="button" data-action="compress-attachment" data-file-id="${escapeHtml(item.id)}" aria-label="Comprimir anexo: ${escapeHtml(item.fileName)}" title="Comprimir anexo"${busy ? " disabled" : ""}>🗜️</button><button class="chat-attachment-delete" type="button" data-action="remove-attachment" data-file-id="${escapeHtml(item.id)}" aria-label="Excluir anexo: ${escapeHtml(item.fileName)}" title="Excluir anexo"${busy ? " disabled" : ""}>🗑️</button></span>`;
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
  return `<div class="chat-confirmation-backdrop" data-popup-backdrop="true" data-popup-close-action="cancel-sign-out" data-sign-out-dialog>
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

function pendingProvisionValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  return raw;
}

function pendingProvisionsMarkup(snapshot, reminderOpen = false, reminderError = "") {
  if (!snapshot || !snapshot.due) return "";
  if (reminderOpen) {
    return `<div class="chat-confirmation-backdrop" data-popup-backdrop="true" data-popup-close-action="cancel-pending-provisions-reminder" data-pending-provisions-dialog>
      <div class="chat-confirmation chat-pending-provisions-reminder" role="dialog" aria-modal="true" aria-labelledby="pending-provisions-reminder-title">
        <div class="chat-date-picker__header chat-pending-provisions__header">
          <h2 id="pending-provisions-reminder-title">Deseja voltar a ser lembrado em quantas horas?</h2>
        </div>
        <p>Escolha uma opção ou informe o intervalo em horas.</p>
        <div class="chat-confirmation__stack">
          <button class="chat-confirmation__confirm" type="button" data-action="pending-provisions-reminder-choice" data-value="always">Lembrar sempre que abrir</button>
          <button class="chat-confirmation__confirm" type="button" data-action="pending-provisions-reminder-choice" data-value="2h">Lembrar em 2 horas</button>
          <button class="chat-confirmation__cancel" type="button" data-action="pending-provisions-reminder-choice" data-value="today">Não voltar a lembrar hoje</button>
          <label class="chat-pending-provisions__hours">Lembrar em
            <input type="number" min="0.1" max="8760" step="0.1" data-role="pending-provisions-hours" inputmode="decimal" placeholder="horas" aria-label="Quantidade de horas">
            horas
          </label>
          <button class="chat-confirmation__confirm" type="button" data-action="pending-provisions-reminder-custom">Aplicar intervalo digitado</button>
          <button class="chat-confirmation__cancel" type="button" data-action="cancel-pending-provisions-reminder">Cancelar</button>
          ${reminderError ? `<p class="chat-signature-pad__error" role="alert">${escapeHtml(reminderError)}</p>` : ""}
        </div>
      </div>
    </div>`;
  }
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  return `<div class="chat-confirmation-backdrop" data-popup-backdrop="true" data-popup-close-action="dismiss-pending-provisions" data-pending-provisions-dialog>
    <div class="chat-confirmation chat-pending-provisions" role="dialog" aria-modal="true" aria-labelledby="pending-provisions-title">
      <div class="chat-date-picker__header chat-pending-provisions__header">
        <button class="chat-date-picker__close" type="button" data-action="dismiss-pending-provisions" data-immediate-action="true" aria-label="Fechar pendências" title="Fechar pendências">×</button>
        <h2 id="pending-provisions-title">💳 Provisões de pagamento pendentes</h2>
      </div>
      <p>Vencidas ou com vencimento hoje (${rows.length}).</p>
      <div class="chat-pending-provisions__list" role="list" aria-label="Provisões vencidas ou que vencem hoje">
        ${rows.map(row => `<article class="chat-pending-provision" role="listitem">
          <strong>${escapeHtml(pendingProvisionValue(row.supplier || "Fornecedor não informado"))}</strong>
          <span>Vencimento: ${escapeHtml(pendingProvisionValue(row.dueDate))}</span>
          <span>${escapeHtml(pendingProvisionValue(row.product || "Produto não informado"))} · ${escapeHtml(pendingProvisionValue(row.total || "Valor não informado"))}</span>
          ${row.branch || row.property ? `<small>${escapeHtml([row.branch, row.property].filter(Boolean).join(" · "))}</small>` : ""}
        </article>`).join("")}
      </div>
    </div>
  </div>`;
}

function attachmentSourceMarkup() {
  return `<div class="chat-confirmation-backdrop" data-popup-backdrop="true" data-popup-close-action="cancel-attachment-source" data-attachment-source-dialog>
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
  return `<div class="chat-confirmation-backdrop" data-popup-backdrop="true" data-popup-close-action="cancel-date-picker" data-date-picker-dialog>
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
  return `<div class="chat-confirmation-backdrop" data-popup-backdrop="true" data-popup-close-action="cancel-signature-pad" data-signature-pad-dialog>
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

function signaturePlacementReopenMarkup() {
  return `<div class="signature-placement-reopen"><button type="button" data-action="open-signature-placement">📄 POSICIONAR ASSINATURA</button></div>`;
}

function signaturePlacementMarkup(placement, busy, stampApplied = false) {
  const hasStamp = stampApplied || placement?.stampApplied === true;
  const documentFileName = placement?.document?.fileName;
  const signatureDocumentLayout = isPaymentReceiptDocument(documentFileName)
    ? "payment"
    : isEpiDeliveryDocument(documentFileName) ? "epi" : "";
  const selected = placement?.selection && Number.isFinite(Number(placement.selection.x))
    && Number.isFinite(Number(placement.selection.y));
  if (placement?.status === "loading") {
    return `<div class="signature-placement-backdrop" data-popup-backdrop="true" data-popup-close-action="close-signature-placement" data-signature-placement-dialog><div class="signature-placement-dialog" role="dialog" aria-modal="true" aria-labelledby="signature-placement-title"><header class="signature-placement-header"><button class="signature-placement-close" type="button" data-action="close-signature-placement" aria-label="Fechar posicionamento">×</button><h2 id="signature-placement-title">Posicionar assinatura</h2></header><p class="signature-placement-instructions">Carregando o documento para você escolher o local da assinatura…</p></div></div>`;
  }
  if (placement?.status === "signing") {
    return `<div class="signature-placement-backdrop" data-signature-placement-dialog><div class="signature-placement-dialog" role="dialog" aria-modal="true" aria-labelledby="signature-placement-title"><header class="signature-placement-header"><h2 id="signature-placement-title">Gerando PDF assinado</h2></header><p class="signature-placement-instructions" role="status">Aguarde a confirmação do novo documento. O original continuará preservado até o envio terminar.</p></div></div>`;
  }
  if (placement?.status === "error") {
    return `<div class="signature-placement-backdrop" data-popup-backdrop="true" data-popup-close-action="close-signature-placement" data-signature-placement-dialog><div class="signature-placement-dialog" role="dialog" aria-modal="true" aria-labelledby="signature-placement-title"><header class="signature-placement-header"><button class="signature-placement-close" type="button" data-action="close-signature-placement" aria-label="Fechar posicionamento">×</button><h2 id="signature-placement-title">Posicionar assinatura</h2></header><p class="signature-placement-instructions" role="alert">${escapeHtml(placement.error || "Não foi possível carregar o documento.")}</p></div></div>`;
  }
  return `<div class="signature-placement-backdrop" data-popup-backdrop="true" data-popup-close-action="close-signature-placement" data-signature-placement-dialog>
    <div class="signature-placement-dialog" role="dialog" aria-modal="true" aria-labelledby="signature-placement-title">
      <header class="signature-placement-header">
        <button class="signature-placement-close" type="button" data-action="close-signature-placement" aria-label="Fechar posicionamento" title="Fechar posicionamento">×</button>
        <h2 id="signature-placement-title">Posicionar assinatura no PDF</h2>
        <div class="signature-placement-header-actions">
          <button class="signature-placement-stamp" type="button" data-action="signature-placement-add-stamp"${busy || hasStamp ? " disabled" : ""}>${hasStamp ? "✅ ASSINATURA ADICIONADA" : "✍️ ADICIONAR ASSINATURA DE BERNARDO"}</button>
        </div>
      </header>
      <p class="signature-placement-stamp-status" data-role="signature-placement-stamp-status" role="status" aria-live="polite"></p>
      <div class="signature-placement-document" data-role="signature-placement-document"${signatureDocumentLayout ? ` data-signature-document-layout="${signatureDocumentLayout}"` : ""}></div>
      <div class="signature-placement-size" aria-label="Tamanho da assinatura selecionada">
        <span>Tamanho</span>
        <button type="button" data-action="signature-placement-shrink" aria-label="Reduzir assinatura"${busy ? " disabled" : ""}>−</button>
        <strong data-role="signature-placement-scale">${Math.round(Math.max(0.2, Math.min(2, Number(placement?.selection?.scale) || 0.5)) * 100)}%</strong>
        <button type="button" data-action="signature-placement-grow" aria-label="Aumentar assinatura"${busy ? " disabled" : ""}>＋</button>
      </div>
      <div class="signature-placement-actions">
        <button class="signature-placement-edit" type="button" data-action="signature-placement-edit"${busy ? " disabled" : ""}>✍️ Editar assinatura</button>
        <button class="signature-placement-confirm" type="button" data-action="signature-placement-confirm"${busy || !selected ? " disabled" : ""}>✅ ${hasStamp ? "SUBSTITUIR PDF" : "Continuar"}</button>
      </div>
    </div>
  </div>`;
}

// SIGNATURE_GESTURE_LOCK_START: signature-pad-coordinates
/**
 * Convert a pointer/touch event into coordinates relative to the visible
 * canvas. The canvas is rendered with a responsive CSS size, so using the
 * bitmap dimensions directly makes strokes land in the wrong place on a
 * scaled phone screen. Some WebViews also expose coordinates only on the
 * touch list; keeping all fallbacks here prevents NaN points from silently
 * dropping a part of the signature.
 */
export function signaturePointFromEvent(canvas, event = {}, preferredTouchIdentifier = null) {
  const rect = canvas?.getBoundingClientRect?.() || {
    left: 0,
    top: 0,
    width: canvas?.clientWidth || canvas?.width || 1,
    height: canvas?.clientHeight || canvas?.height || 1,
  };
  const width = Math.max(1, Number(rect.width) || Number(canvas?.clientWidth) || Number(canvas?.width) || 1);
  const height = Math.max(1, Number(rect.height) || Number(canvas?.clientHeight) || Number(canvas?.height) || 1);
  const touchCandidates = [
    ...Array.from(event?.changedTouches || []),
    ...Array.from(event?.touches || []),
  ];
  const touch = preferredTouchIdentifier != null
    ? touchCandidates.find(candidate => candidate?.identifier === preferredTouchIdentifier) || null
    : touchCandidates[0] || null;
  const source = touch || event;
  const view = canvas?.ownerDocument?.defaultView;
  const scrollX = Number(view?.scrollX) || 0;
  const scrollY = Number(view?.scrollY) || 0;
  const clientX = Number(source?.clientX);
  const clientY = Number(source?.clientY);
  const pageX = Number(source?.pageX);
  const pageY = Number(source?.pageY);
  const offsetX = Number(source?.offsetX);
  const offsetY = Number(source?.offsetY);
  let localX;
  let localY;
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    localX = clientX - Number(rect.left || 0);
    localY = clientY - Number(rect.top || 0);
  } else if (Number.isFinite(pageX) && Number.isFinite(pageY)) {
    localX = pageX - scrollX - Number(rect.left || 0);
    localY = pageY - scrollY - Number(rect.top || 0);
  } else if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
    localX = offsetX;
    localY = offsetY;
  } else {
    // A few Android WebViews emit a move event without coordinates while the
    // touch stream is being handed between pointer and touch events. Using the
    // canvas center here creates artificial rays from the original point.
    return null;
  }
  return {
    x: Math.max(0, Math.min(1, localX / width)),
    y: Math.max(0, Math.min(1, localY / height)),
  };
}
// SIGNATURE_GESTURE_LOCK_END: signature-pad-coordinates

// SIGNATURE_GESTURE_LOCK_START: signature-pad-canvas-sizing
export function resizeSignatureCanvasToDisplay(canvas, pixelRatio = null) {
  const rect = canvas?.getBoundingClientRect?.();
  const cssWidth = Number(rect?.width);
  const cssHeight = Number(rect?.height);
  if (!canvas || !Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth <= 0 || cssHeight <= 0) return false;
  const viewRatio = Number(canvas.ownerDocument?.defaultView?.devicePixelRatio);
  const ratio = Math.min(2, Math.max(1, Number(pixelRatio) || viewRatio || 1));
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}
// SIGNATURE_GESTURE_LOCK_END: signature-pad-canvas-sizing

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
      <button class="primary-button" type="button" data-action="sign-in"${isLoading ? " disabled" : ""}>${isLoading ? "Entrando com a Microsoft…" : "Entrar com a Microsoft"}</button>
      ${allowDemo ? `<button type="button" data-action="demo-access"${isLoading ? " disabled" : ""}>Acesso de demonstração</button>` : ""}
      ${showSettings ? settingsButton("auth-settings") : ""}
      ${renderPublicLinks()}
    </div>
  </section>`;
}

export function renderChatMarkup(state = {}, { showSettings = false, allowDemo = false, demo = false, signOutConfirm = false, attachmentSource = false, datePicker = false, datePickerValue = "", signaturePad = false, signaturePadError = "", signaturePlacement = null, signaturePlacementStampApplied = false } = {}) {
  if (state.sessionStatus !== "authenticated") {
    return renderSignedOut(state.sessionStatus, state.error, showSettings, allowDemo);
  }

  const messages = Array.isArray(state.messages) ? state.messages : [];
  let finalSignedIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isSignedDocumentMessage(messages[index])) {
      finalSignedIndex = index;
      break;
    }
  }
  const trailingMessages = finalSignedIndex >= 0 ? messages.slice(finalSignedIndex + 1) : [];
  const replaceSignedDocumentMenu = !state.activeFlow
    && finalSignedIndex >= 0
    && trailingMessages.length > 0
    && trailingMessages.every(isAutomaticMainMenuMessage);
  const visibleMessages = replaceSignedDocumentMenu
    ? messages.filter((message, index) => index <= finalSignedIndex || !isAutomaticMainMenuMessage(message))
    : messages;
  const latestPoll = [...visibleMessages]
    .reverse()
    .find(message => message?.role !== "user" && message?.type === "poll");
  const databaseFilter = latestDatabaseFilter(visibleMessages);
  const navigation = flowNavigation(visibleMessages);
  const inferredIntermediateFlow = !state.activeFlow
    && !isAutomaticMainMenuMessage(latestPoll)
    && (navigation.back || navigation.home);
  const completedCreation = state.completionNavigation?.homeOnly === true;
  const showFlowStatus = Boolean(state.activeFlow || inferredIntermediateFlow || completedCreation);
  // Falhas são notificadas no banner de erro; não devem permanecer na barra
  // suspensa como se ainda estivessem aguardando envio.
  const pendingFiles = (Array.isArray(state.pendingFiles) ? state.pendingFiles : [])
    .filter(item => item?.status !== "failed");
  const attachments = Array.isArray(state.attachments) ? state.attachments : [];
  const busy = Boolean(state.activeText || state.resuming || state.recoveryBlocked || state.responseTransitionPending)
    || pendingFiles.some(item => item.status === "sending");
  const pendingAttachment = pendingFiles.length > 0;
  const firstName = String(state.account?.name || "Você").split(/\s+/)[0];
  const signaturePrompt = isSignaturePrompt(state);
  const placement = signaturePlacement || state.signaturePlacement || null;

  return `<section class="chat-shell">
    <header class="chat-header">
      ${assistantAvatar()}
      <span><strong>Energético</strong><small>${demo ? `<span data-demo-banner role="status">Demonstração — dados fictícios</span>` : `${escapeHtml(firstName)}, conectado à VM`}</small></span>
      ${showSettings ? settingsButton() : ""}
      <button class="header-action" type="button" data-action="sign-out">Sair</button>
    </header>
    ${showFlowStatus ? flowStatusMarkup(state, visibleMessages, busy, latestPollTitle(visibleMessages), { homeOnly: completedCreation }) : ""}
    ${state.error ? `<div class="error-banner" role="alert"><span>${escapeHtml(state.error)}</span><button type="button" data-action="retry-session"${state.resuming || state.activeText ? " disabled" : ""}>Retomar conversa</button></div>` : ""}
    <div class="chat-transcript" role="log" aria-live="polite" aria-relevant="additions text">
      ${state.recoveryWarning ? `<p class="error-banner" role="alert">${escapeHtml(state.recoveryWarning)}</p>` : ""}
      ${renderRecovery(state)}
      ${visibleMessages.length ? visibleMessages.map((message, index) => renderMessage(message, state.account, busy, { finalSignedDocument: index === finalSignedIndex && isSignedDocumentMessage(message), delegatedTasks: state.delegatedTasks, draft: state.draft, databaseFilterMessage: databaseFilter?.message, activeFlow: state.activeFlow })).join("") : state.recoveryPreview ? "" : `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong><p>Olá, ${escapeHtml(firstName)}. O que vamos fazer?</p></div></article>`}
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
      <textarea id="chatDraft" data-role="draft"${databaseFilter ? ` data-database-filter-key="${escapeHtml(databaseFilter.key)}"` : ""} rows="3" autocomplete="off" placeholder="${databaseFilter ? "Digite para filtrar…" : "Digite uma mensagem"}">${escapeHtml(state.draft || "")}</textarea>
      <button class="send-button" type="submit" data-action="send-text" aria-label="Enviar mensagem"${busy || pendingAttachment || !String(state.draft || "").trim() ? " disabled" : ""}>Enviar</button>
    </form>
    ${signOutConfirm ? signOutConfirmationMarkup() : ""}
    ${attachmentSource ? attachmentSourceMarkup() : ""}
    ${datePicker ? datePickerMarkup(datePickerValue) : ""}
    ${signaturePad ? signaturePadMarkup(signaturePadError) : ""}
    ${placement?.status === "ready" && placement.open === false ? signaturePlacementReopenMarkup() : ""}
    ${placement && placement.open !== false ? signaturePlacementMarkup(placement, busy, signaturePlacementStampApplied) : ""}
    ${pendingProvisionsMarkup(state.pendingProvisions, state.pendingProvisionReminderOpen, state.pendingProvisionReminderError)}
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
    ...(actionTarget.dataset.taskId ? { taskId: actionTarget.dataset.taskId } : {}),
    ...(actionTarget.dataset.value ? { value: actionTarget.dataset.value } : {}),
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
  let signaturePadTargetFileId = "";
  let signaturePadError = "";
  // SIGNATURE_GESTURE_LOCK_START: signature-pad-gesture-state
  let signaturePadStrokes = [];
  let signaturePadCurrentStroke = null;
  let signaturePadPointerId = null;
  let signaturePadPointerType = null;
  let signaturePadTouchIdentifier = null;
  let signaturePadAnchorPoint = null;
  let signaturePadMoveFamily = null;
  let signaturePadListenersTarget = null;
  let signaturePadListenersCleanup = null;
  // SIGNATURE_GESTURE_LOCK_END: signature-pad-gesture-state
  let signaturePlacementRuntime = null;
  let signaturePlacementRuntimeKey = "";
  let signaturePlacementSelection = null;
  let signaturePlacementScale = 0.5;
  let signaturePlacementStampBlob = null;
  let signaturePlacementStampPoint = null;
  let signaturePlacementStampKey = "";
  let signaturePlacementClosedKey = "";

  // SIGNATURE_GESTURE_LOCK_START: signature-pad-rendering
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
  // SIGNATURE_GESTURE_LOCK_END: signature-pad-rendering

  // SIGNATURE_GESTURE_LOCK_START: signature-pad-event-arbitration
  function setupSignaturePad() {
    const canvas = root.querySelector?.('[data-role="signature-pad"]');
    if (!canvas) return;
    resizeSignatureCanvasToDisplay(canvas);
    const context = drawSignatureStrokes(canvas);
    if (!context || canvas.dataset.bound === "true") return;
    canvas.dataset.bound = "true";

    // Pointer capture keeps receiving movement when the finger briefly goes
    // outside the canvas. A touch pointerleave must not finish the stroke:
    // iOS can emit it with buttons=0 while a touch is still down, which used
    // to leave gaps in signatures drawn across the middle or near the edges.
    const pointerKey = event => {
      if (event?.pointerId != null) return `pointer:${event.pointerId}`;
      if (String(event?.type || "").startsWith("touch")) {
        const touch = event.changedTouches?.[0] || event.touches?.[0];
        if (touch?.identifier != null) return `touch:${touch.identifier}`;
        return "touch";
      }
      return "mouse";
    };
    const pointerType = event => {
      if (event?.pointerType) return String(event.pointerType).toLowerCase();
      if (/^touch/i.test(String(event?.type || ""))) return "touch";
      return "mouse";
    };
    const touchIdentifier = event => {
      const touch = event?.changedTouches?.[0] || event?.touches?.[0];
      return touch?.identifier != null ? touch.identifier : null;
    };
    const eventTouches = (event, property) => Array.from(event?.[property] || []);
    const nearestTouch = (touches, anchor) => {
      if (!touches.length) return null;
      if (!anchor || !Number.isFinite(anchor.clientX) || !Number.isFinite(anchor.clientY)) {
        return touches.length === 1 ? touches[0] : null;
      }
      return touches.reduce((nearest, touch) => {
        const distance = ((Number(touch?.clientX) || 0) - anchor.clientX) ** 2
          + ((Number(touch?.clientY) || 0) - anchor.clientY) ** 2;
        return !nearest || distance < nearest.distance ? { touch, distance } : nearest;
      }, null)?.touch || null;
    };
    const contactWasReleased = event => {
      // WebKit on iPhone may report buttons=0 for an active touch pointer.
      // That flag is reliable for mouse/pen, but not for finger contact.
      if (event?.pointerId != null
        && pointerType(event) !== "touch"
        && event?.buttons === 0) return true;
      const touchCount = Number(event?.touches?.length);
      return /^touchmove$/i.test(String(event?.type || ""))
        && Number.isFinite(touchCount)
        && touchCount === 0;
    };
    const matchesPointer = event => {
      if (signaturePadPointerId == null || pointerKey(event) === signaturePadPointerId) return true;
      // iOS WebViews can dispatch pointerdown and then deliver the rest of a
      // vertical stroke as touchmove/touchend — or do the reverse and start
      // with touchstart before continuing with pointermove. Both event
      // families represent the same primary finger in WKWebView.
      if (signaturePadPointerType !== "touch" || pointerType(event) !== "touch") return false;
      if (event?.pointerId != null) return event?.isPrimary !== false;
      const activeTouches = eventTouches(event, "touches");
      const changedTouches = eventTouches(event, "changedTouches");
      if (signaturePadTouchIdentifier == null) {
        const eventType = String(event?.type || "");
        const changedIds = new Set(changedTouches.map(touch => touch?.identifier));
        const existingTouches = /^touchstart$/i.test(eventType)
          ? activeTouches.filter(touch => !changedIds.has(touch?.identifier))
          : activeTouches;
        const candidates = /^touch(?:end|cancel)$/i.test(eventType)
          ? [...changedTouches, ...activeTouches]
          : existingTouches;
        const candidate = nearestTouch(candidates, signaturePadAnchorPoint)
          || (activeTouches.length === 0 && changedTouches.length === 1 ? changedTouches[0] : null);
        if (candidate?.identifier != null) signaturePadTouchIdentifier = candidate.identifier;
      }
      if (signaturePadTouchIdentifier == null) return false;
      if (changedTouches.length) {
        return changedTouches.some(touch => touch?.identifier === signaturePadTouchIdentifier);
      }
      return activeTouches.some(touch => touch?.identifier === signaturePadTouchIdentifier);
    };
    const removeDocumentListeners = () => {
      const target = signaturePadListenersTarget;
      if (!target) return;
      target.removeEventListener?.("pointermove", move);
      target.removeEventListener?.("pointerup", stop);
      target.removeEventListener?.("pointercancel", stop);
      target.removeEventListener?.("touchmove", move);
      target.removeEventListener?.("touchend", stop);
      target.removeEventListener?.("touchcancel", stop);
      target.removeEventListener?.("mousemove", move);
      target.removeEventListener?.("mouseup", stop);
      signaturePadListenersTarget = null;
      if (signaturePadListenersCleanup === removeDocumentListeners) signaturePadListenersCleanup = null;
    };
    const addDocumentListeners = () => {
      const target = canvas.ownerDocument;
      if (!target?.addEventListener || signaturePadListenersTarget === target) return;
      removeDocumentListeners();
      target.addEventListener("pointermove", move, { passive: false });
      target.addEventListener("pointerup", stop);
      target.addEventListener("pointercancel", stop);
      target.addEventListener("touchmove", move, { passive: false });
      target.addEventListener("touchend", stop, { passive: false });
      target.addEventListener("touchcancel", stop, { passive: false });
      target.addEventListener("mousemove", move, { passive: false });
      target.addEventListener("mouseup", stop);
      signaturePadListenersTarget = target;
      signaturePadListenersCleanup = removeDocumentListeners;
    };
    const stop = event => {
      const samePointer = matchesPointer(event);
      if (signaturePadCurrentStroke && samePointer) {
        if (event?.pointerId != null) {
          try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* optional */ }
        }
        signaturePadCurrentStroke = null;
        signaturePadPointerId = null;
        signaturePadPointerType = null;
        signaturePadTouchIdentifier = null;
        signaturePadAnchorPoint = null;
        signaturePadMoveFamily = null;
        removeDocumentListeners();
      }
    };
    const begin = event => {
      const type = pointerType(event);
      const identifier = touchIdentifier(event);
      // Ignore secondary fingers/pointers so a second touch cannot replace
      // the active stroke halfway through a signature.
      if (event?.isPrimary === false) return;
      if (signaturePadCurrentStroke) {
        // Bind the fallback touch only when it is the sole active finger.
        // matchesPointer intentionally rejects a secondary touchstart.
        matchesPointer(event);
        return;
      }
      const isMouse = event?.pointerType === "mouse" || (!event?.pointerType && event?.button != null);
      if (isMouse && event.button !== 0) return;
      event.preventDefault?.();
      const startPoint = signaturePointFromEvent(canvas, event);
      if (!startPoint) return;
      signaturePadPointerId = pointerKey(event);
      signaturePadPointerType = type;
      signaturePadTouchIdentifier = type === "touch" ? identifier : null;
      const source = event?.changedTouches?.[0] || event?.touches?.[0] || event;
      signaturePadAnchorPoint = {
        clientX: Number(source?.clientX),
        clientY: Number(source?.clientY),
      };
      signaturePadMoveFamily = null;
      signaturePadCurrentStroke = [startPoint];
      signaturePadStrokes.push(signaturePadCurrentStroke);
      canvas.dataset.ink = "true";
      if (event?.pointerId != null) {
        try { canvas.setPointerCapture?.(event.pointerId); } catch { /* optional */ }
      }
      addDocumentListeners();
      // Draw a dot immediately. A short tap or a first move that iOS
      // coalesces still produces visible ink and remains part of the export.
      drawSignatureStrokes(canvas);
    };
    const move = event => {
      if (!signaturePadCurrentStroke || !matchesPointer(event)) return;
      if (contactWasReleased(event)) {
        stop(event);
        return;
      }
      event.preventDefault?.();
      const nextPoint = signaturePointFromEvent(canvas, event, signaturePadTouchIdentifier);
      // A troca pointer -> touch do WKWebView pode começar com um pointermove
      // sem coordenadas. Ele não pode escolher a família do traço porque o
      // touchmove válido seguinte é justamente o que carrega o movimento.
      if (!nextPoint) return;
      const previousPoint = signaturePadCurrentStroke.at(-1);
      const rect = canvas.getBoundingClientRect?.() || {};
      const movedPixels = previousPoint
        ? Math.hypot(
          (nextPoint.x - previousPoint.x) * (Number(rect.width) || 1),
          (nextPoint.y - previousPoint.y) * (Number(rect.height) || 1),
        )
        : Infinity;
      if (movedPixels < 0.5) return;

      /*
       * CODEX: NÃO EDITE NEM "SIMPLIFIQUE" NOVAMENTE ESTE BLOCO DE GESTOS.
       * O próprio Codex já fez uma correção incorreta aqui: travou a família
       * antes de existir um ponto válido e voltou a quebrar traços iniciados
       * para cima no iPhone. A família só pode ser fixada após movimento real;
       * isso também impede que eventos duplicados recriem os feixes aleatórios.
       */
      // Some iOS WebViews emit both PointerEvent and TouchEvent updates for
      // the same finger. Lock the stroke to whichever family produces the
      // first real move so duplicate coordinates cannot fan out into rays.
      const eventType = String(event?.type || "").toLowerCase();
      const moveFamily = eventType.startsWith("touch")
        ? "touch"
        : eventType.startsWith("pointer") ? "pointer" : "mouse";
      if (signaturePadMoveFamily && signaturePadMoveFamily !== moveFamily) return;
      signaturePadMoveFamily ||= moveFamily;
      signaturePadCurrentStroke.push(nextPoint);
      drawSignatureStrokes(canvas);
    };
    const view = canvas.ownerDocument?.defaultView;
    const supportsPointerEvents = Boolean(view?.PointerEvent || globalThis.PointerEvent);
    if (supportsPointerEvents) {
      canvas.addEventListener("pointerdown", begin, { passive: false });
      canvas.addEventListener("lostpointercapture", event => {
        // WebKit may report a lost capture while a finger is still pressed,
        // especially when the stroke travels upward. Keep the stroke active
        // and let pointerup/touchend finish it; mouse capture loss is safe to
        // finish only after its button is released.
        const touchPointer = event?.pointerType === "touch"
          || String(signaturePadPointerId || "").startsWith("touch:");
        if (!touchPointer && event?.buttons === 0) stop(event);
      });
      canvas.addEventListener("pointerleave", event => {
        // Mouse pointers do not have capture on every older WebView. Touch
        // pointers intentionally stay active here; pointerleave is not a
        // reliable end-of-contact signal on iOS.
        if (event.pointerType === "mouse" && event.buttons === 0) stop(event);
      });
    }
    // Keep only the start fallbacks on the canvas. Once a stroke starts, all
    // movement/end events are handled by the document listeners above. If
    // they were also attached to the canvas, a normal bubbling event would be
    // processed twice; after a re-render that could combine with an old
    // document listener and create the phantom rays seen on tablets.
    canvas.addEventListener("touchstart", begin, { passive: false });
    canvas.addEventListener("mousedown", begin);
    // A foreground refresh can replace the canvas while a finger is still
    // down. Rebind the active stroke to the new canvas after its old document
    // listeners were removed by updateShell.
    if (signaturePadCurrentStroke) addDocumentListeners();
  }
  // SIGNATURE_GESTURE_LOCK_END: signature-pad-event-arbitration

  // SIGNATURE_GESTURE_LOCK_START: signature-pad-lifecycle
  function clearSignaturePad() {
    signaturePadListenersCleanup?.();
    signaturePadStrokes = [];
    signaturePadCurrentStroke = null;
    signaturePadPointerId = null;
    signaturePadPointerType = null;
    signaturePadTouchIdentifier = null;
    signaturePadAnchorPoint = null;
    signaturePadMoveFamily = null;
    signaturePadError = "";
    const canvas = root.querySelector?.('[data-role="signature-pad"]');
    if (canvas) {
      delete canvas.dataset.ink;
      drawSignatureStrokes(canvas);
    }
  }

  function pauseSignaturePad() {
    signaturePadListenersCleanup?.();
    signaturePadCurrentStroke = null;
    signaturePadPointerId = null;
    signaturePadPointerType = null;
    signaturePadTouchIdentifier = null;
    signaturePadAnchorPoint = null;
    signaturePadMoveFamily = null;
  }
  function openSignaturePad(fileId = "") {
    if (signaturePadOpen) return false;
    signaturePadOpen = true;
    signaturePadTargetFileId = String(fileId || "").trim();
    signaturePadError = "";
    signaturePadStrokes = [];
    signaturePadCurrentStroke = null;
    signaturePadPointerId = null;
    signaturePadPointerType = null;
    signaturePadTouchIdentifier = null;
    signaturePadAnchorPoint = null;
    signaturePadMoveFamily = null;
    if (lastState) {
      const state = lastState;
      lastState = null;
      render(state);
    }
    globalThis.setTimeout?.(() => {
      setupSignaturePad();
      root.querySelector('[data-role="signature-pad"]')?.focus?.();
    }, 0);
    return true;
  }
  // SIGNATURE_GESTURE_LOCK_END: signature-pad-lifecycle

  // SIGNATURE_GESTURE_LOCK_START: signature-placement-mount
  function closeSignaturePlacement(eventType = "signature-placement-close") {
    const placement = lastState?.signaturePlacement;
    if (!placement?.key) return;
    signaturePlacementClosedKey = placement.key;
    signaturePlacementRuntime?.destroy();
    signaturePlacementRuntime = null;
    // Keep the key while the VM finishes loading the PDF. Clearing it here
    // makes the next render treat the same placement as a new one and opens
    // the viewer again instead of returning to the previous chat screen.
    signaturePlacementRuntimeKey = placement.key;
    if (lastState) {
      const state = lastState;
      lastState = null;
      render(state);
    }
    emit({ type: eventType });
  }

  function openSignaturePlacement() {
    signaturePlacementClosedKey = "";
    if (lastState) {
      const state = lastState;
      lastState = null;
      render(state);
    }
  }

  function setupSignaturePlacement(placement) {
    const container = root.querySelector?.('[data-role="signature-placement-document"]');
    if (!container || placement?.status !== "ready" || placement.open === false) return;
    if (signaturePlacementRuntimeKey === placement.key && signaturePlacementRuntime) {
      // The chat shell can be rebuilt by an unrelated VM update while the
      // same document remains active. In that case the old runtime points to
      // a detached container and the new one would stay empty forever.
      if (container.querySelector?.('[data-role="signature-placement-pdf"]')
        || container.querySelector?.('.signature-placement-pdf')) return;
      signaturePlacementRuntime.destroy?.();
      signaturePlacementRuntime = null;
      signaturePlacementRuntimeKey = "";
    }
    signaturePlacementRuntime?.destroy();
    signaturePlacementRuntime = null;
    const nextPlacementKey = placement.key || "";
    try {
      signaturePlacementRuntime = createSignaturePlacement({
        documentBlob: placement.document?.blob,
        signatureBlob: placement.signature?.blob,
        container,
        documentRef: root.ownerDocument,
        selection: signaturePlacementSelection,
        signerName: placement.signerName,
        signedAt: placement.signedAt,
        onPoint: point => {
          signaturePlacementSelection = {
            ...point,
            scale: signaturePlacementScale,
          };
          // Keep the mounted PDF viewer in place while the user taps or
          // drags. Re-rendering the whole chat here detaches the canvas and
          // made the document disappear immediately after a click.
          const confirm = root.querySelector?.('[data-action="signature-placement-confirm"]');
          if (confirm) confirm.disabled = composerBusy || !point;
        },
        onScale: scale => {
          signaturePlacementScale = scale;
          if (signaturePlacementSelection) signaturePlacementSelection = { ...signaturePlacementSelection, scale };
          const label = root.querySelector?.('[data-role="signature-placement-scale"]');
          if (label) label.textContent = `${Math.round(scale * 100)}%`;
        },
      });
      signaturePlacementRuntimeKey = nextPlacementKey;
      signaturePlacementRuntime.ready.catch(() => {});
    } catch {
      // Do not mark a failed mount as complete. A transient PDF.js/canvas
      // failure can then be retried by the next render without requiring the
      // user to close and reopen the viewer.
      signaturePlacementRuntimeKey = "";
      // The controller has already validated the blobs; a browser without
      // canvas/PDF support simply leaves the explanatory panel in place.
    }
  }
  // SIGNATURE_GESTURE_LOCK_END: signature-placement-mount

  function configureSignaturePlacementStamp(placement) {
    const runtime = signaturePlacementRuntime;
    if (!runtime || placement?.status !== "ready" || placement.open === false) return;
    const placementKey = placement.key || "";
    runtime.setStampListener?.({
      onStamp: ({ blob, point }) => {
        signaturePlacementStampBlob = blob;
        signaturePlacementStampPoint = point;
        signaturePlacementStampKey = placementKey;
        const button = root.querySelector?.('[data-action="signature-placement-add-stamp"]');
        if (button) {
          button.disabled = true;
          button.textContent = "✅ ASSINATURA ADICIONADA";
        }
        const confirm = root.querySelector?.('[data-action="signature-placement-confirm"]');
        if (confirm) confirm.textContent = "✅ SUBSTITUIR PDF";
        emit({ type: "signature-placement-stamp", stampBlob: blob, stampPoint: point });
      },
      onStampError: error => {
        const status = root.querySelector?.('[data-role="signature-placement-stamp-status"]');
        if (status) status.textContent = error?.message || "Não foi possível adicionar a assinatura de Bernardo.";
      },
    });
    if (signaturePlacementStampKey === placementKey
      && signaturePlacementStampBlob
      && !runtime.hasStamp?.()) {
      runtime.addBernardoStamp?.({
        blob: signaturePlacementStampBlob,
        point: signaturePlacementStampPoint,
        notify: false,
      }).catch?.(error => {
        const status = root.querySelector?.('[data-role="signature-placement-stamp-status"]');
        if (status) status.textContent = error?.message || "Não foi possível restaurar a assinatura de Bernardo.";
      });
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
      const fileId = signaturePadTargetFileId;
      signaturePadListenersCleanup?.();
      signaturePadOpen = false;
      signaturePadTargetFileId = "";
      signaturePadError = "";
      signaturePadStrokes = [];
      signaturePadCurrentStroke = null;
      signaturePadPointerId = null;
      signaturePadPointerType = null;
      signaturePadTouchIdentifier = null;
      signaturePadAnchorPoint = null;
      signaturePadMoveFamily = null;
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      emit({ type: "signature-captured", file, ...(fileId ? { fileId } : {}) });
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
       && [
         "messages", "attachments", "pendingFiles", "activeText", "activeFlow", "resuming",
         "responseTransitionPending", "error", "recoveryPreview", "recoveryReference",
         "recoveryReferenceCount", "recoveryWarning", "recoveryBlocked", "signaturePlacement",
         "delegatedTasks", "pendingProvisions", "pendingProvisionReminderOpen",
         "pendingProvisionReminderError",
       ].every(key => lastState[key] === state[key]);
  }

  function syncComposer(state, draftOnly = false) {
    const { draft } = composerControls;
    if (!composing && draft && draft.value !== (state.draft || "")) draft.value = state.draft || "";
    if (draft) {
      const databaseFilter = latestDatabaseFilter(state.messages || []);
      if (databaseFilter) draft.dataset.databaseFilterKey = databaseFilter.key;
      else delete draft.dataset.databaseFilterKey;
      draft.placeholder = databaseFilter ? "Digite para filtrar…" : "Digite uma mensagem";
    }
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

  function updateShell(markup, state, {
    preserveSignaturePad = false,
    preserveSignaturePlacement = false,
  } = {}) {
    const shell = root.querySelector('.chat-shell');
    const composer = shell?.querySelector('[data-chat-form]');
    const preservedOverlays = [];
    if (preserveSignaturePad) {
      const dialog = shell?.querySelector('[data-signature-pad-dialog]');
      if (dialog) preservedOverlays.push(dialog);
    }
    if (preserveSignaturePlacement) {
      const dialog = shell?.querySelector('[data-signature-placement-dialog]');
      if (dialog) preservedOverlays.push(dialog);
    }
    // The signature UI can be replaced by either branch below during a
    // session update. Detach listeners only when that active UI is actually
    // being replaced; transient VM refreshes must keep its runtime mounted.
    if (signaturePadOpen && !preserveSignaturePad) signaturePadListenersCleanup?.();
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
      if (child !== composer && !preservedOverlays.includes(child)) child.remove();
    }
    for (const child of [...nextShell.children]) {
      if (child.matches('[data-chat-form]')) continue;
      if (preserveSignaturePad && child.matches('[data-signature-pad-dialog]')) continue;
      if (preserveSignaturePlacement && child.matches('[data-signature-placement-dialog]')) continue;
      shell.insertBefore(child, composer);
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
    const clickedAction = event.target?.closest?.("[data-action]");
    const pendingImmediateClick = immediateClickSuppression;
    immediateClickSuppression = null;
    if (pendingImmediateClick && pendingImmediateClick.expiresAt >= Date.now()) {
      const clickedCommand = commandFromTarget(event.target);
      if (clickedAction === pendingImmediateClick.target
        || sameCommand(clickedCommand, pendingImmediateClick.command)) {
        event.preventDefault?.();
        return;
      }
    }
    const backdrop = event.target?.matches?.("[data-popup-backdrop]") ? event.target : null;
    const command = commandFromTarget(event.target)
      || (backdrop?.dataset.popupCloseAction ? { type: backdrop.dataset.popupCloseAction } : null);
    if (!command) return;
    if (command.type === "send-text") return;
    event.preventDefault?.();
    if (command.type === "select-reply"
      && String(command.replyId || "").trim().toLowerCase() === "attachment_upload_continue") {
      if (attachmentSourceOpen) return;
      attachmentSourceOpen = true;
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      return;
    }
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
      openSignaturePad(command.fileId);
      return;
    }
    if (command.type === "clear-signature-pad") {
      clearSignaturePad();
      return;
    }
    if (command.type === "cancel-signature-pad") {
      const cancelledFileId = signaturePadTargetFileId;
      signaturePadListenersCleanup?.();
      signaturePadOpen = false;
      signaturePadTargetFileId = "";
      signaturePadError = "";
      signaturePadStrokes = [];
      signaturePadCurrentStroke = null;
      signaturePadPointerId = null;
      signaturePadPointerType = null;
      signaturePadTouchIdentifier = null;
      signaturePadAnchorPoint = null;
      signaturePadMoveFamily = null;
      if (lastState) {
        const state = lastState;
        lastState = null;
        render(state);
      }
      emit({ type: "signature-cancelled", fileId: cancelledFileId });
      return;
    }
    if (command.type === "confirm-signature-pad") {
      confirmSignaturePad();
      return;
    }
    if (command.type === "open-signature-placement") {
      openSignaturePlacement();
      return;
    }
    if (command.type === "close-signature-placement") {
      closeSignaturePlacement();
      return;
    }
    if (command.type === "signature-placement-edit") {
      closeSignaturePlacement("signature-placement-edit");
      return;
    }
    if (command.type === "signature-placement-add-stamp") {
      const runtime = signaturePlacementRuntime;
      const button = root.querySelector('[data-action="signature-placement-add-stamp"]');
      if (!runtime?.addBernardoStamp || button?.disabled) return;
      if (button) {
        button.disabled = true;
        button.textContent = "⏳ CARREGANDO ASSINATURA...";
      }
      Promise.resolve(runtime.addBernardoStamp()).catch(error => {
        if (button) {
          button.disabled = false;
          button.textContent = "✍️ ADICIONAR ASSINATURA DE BERNARDO";
        }
        const status = root.querySelector?.('[data-role="signature-placement-stamp-status"]');
        if (status) status.textContent = error?.message || "Não foi possível adicionar a assinatura de Bernardo.";
      });
      return;
    }
    if (command.type === "signature-placement-shrink" || command.type === "signature-placement-grow") {
      const runtime = signaturePlacementRuntime;
      const resize = runtime?.resizeSelected || runtime?.resizeSignature;
      if (!resize) return;
      const scale = resize(command.type === "signature-placement-grow" ? 0.1 : -0.1);
      const label = root.querySelector('[data-role="signature-placement-scale"]');
      if (label) label.textContent = `${Math.round(scale * 100)}%`;
      return;
    }
    if (command.type === "signature-placement-confirm") {
      if (signaturePlacementSelection) {
        const stamp = signaturePlacementRuntime?.getStamp?.();
        emit({
          type: "signature-placement-position",
          point: { ...signaturePlacementSelection },
          ...(stamp ? { stampBlob: stamp.blob, stampPoint: stamp.point } : {}),
        });
      }
      return;
    }
    if (command.type === "pending-provisions-reminder-custom") {
      emit({
        type: "pending-provisions-reminder-choice",
        value: String(root.querySelector('[data-role="pending-provisions-hours"]')?.value || "").trim(),
      });
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
      if (event.target.dataset.databaseFilterKey) {
        emit({
          type: "database-filter-changed",
          value: event.target.value,
          filterKey: event.target.dataset.databaseFilterKey,
        });
      }
    } else if (event.target?.dataset?.role === "date-picker") {
      datePickerValue = event.target.value;
    } else if (event.target?.dataset?.role === "delegated-tasks-search") {
      const query = normalizedDateText(event.target.value || "");
      root.querySelectorAll?.("[data-delegated-task-item]").forEach(item => {
        item.hidden = query && !normalizedDateText(item.textContent || "").includes(query);
      });
    }
  }

  let draggedDelegatedTaskId = "";
  let pointerDelegatedDrag = null;
  let immediateClickSuppression = null;

  function isTouchLikePointer(event) {
    return ["touch", "pen"].includes(String(event?.pointerType || "").toLowerCase());
  }

  function sameCommand(left, right) {
    return left?.type === right?.type
      && left?.replyId === right?.replyId
      && left?.fileId === right?.fileId
      && left?.messageId === right?.messageId
      && left?.taskId === right?.taskId;
  }

  function rememberImmediateClick(target, command) {
    immediateClickSuppression = {
      target,
      command,
      expiresAt: Date.now() + 750,
    };
  }

  function delegatedTaskAtPoint(event) {
    const element = root.ownerDocument?.elementFromPoint?.(Number(event.clientX), Number(event.clientY));
    return element?.closest?.("[data-delegated-task-item]") || null;
  }

  function pointerDown(event) {
    const explicitImmediateTarget = event.target?.closest?.('[data-action][data-immediate-action="true"]');
    const immediateTarget = explicitImmediateTarget
      || (isTouchLikePointer(event)
        ? event.target?.closest?.('button[data-action]:not([data-action="send-text"])')
        : null);
    if (immediateTarget && event.isPrimary !== false) {
      const command = commandFromTarget(immediateTarget);
      if (command) {
        event.preventDefault?.();
        rememberImmediateClick(immediateTarget, command);
        // This control is handled locally by the view. The mobile first-touch
        // path normally emits commands for the controller and suppresses the
        // synthetic click, but there is no controller listener for opening
        // the signature pad. Run the local action here so the first tap is
        // never lost after the DOM is rebuilt for the modal.
        if (command.type === "open-signature-pad") {
          openSignaturePad(command.fileId);
          return;
        }
        emit(command);
        return;
      }
    }
    const item = event.target?.closest?.("[data-delegated-task-item]");
    if (!item || event.target?.closest?.("[data-action=complete-delegated-task]") || event.isPrimary === false) return;
    pointerDelegatedDrag = { item, id: String(item.dataset.taskId || ""), startY: Number(event.clientY) || 0, active: false };
  }

  function pointerMove(event) {
    const drag = pointerDelegatedDrag;
    if (!drag || !drag.id) return;
    const distance = Math.abs((Number(event.clientY) || 0) - drag.startY);
    if (!drag.active && distance < 6) return;
    drag.active = true;
    event.preventDefault?.();
    drag.item.classList.add("is-dragging");
    const target = delegatedTaskAtPoint(event);
    if (!target || target === drag.item) return;
    const list = target.parentElement;
    if (!list) return;
    const rect = target.getBoundingClientRect?.();
    list.insertBefore(drag.item, rect && event.clientY > rect.top + rect.height / 2 ? target.nextSibling : target);
  }

  function pointerUp() {
    const drag = pointerDelegatedDrag;
    pointerDelegatedDrag = null;
    if (!drag?.active) return;
    drag.item.classList.remove("is-dragging");
    const list = root.querySelector?.(".chat-delegated-tasks__list");
    const order = [...(list?.querySelectorAll?.("[data-task-id]") || [])].map(node => node.dataset.taskId).filter(Boolean);
    emit({ type: "delegated-tasks-reordered", order });
  }

  function dragStart(event) {
    const item = event.target?.closest?.("[data-delegated-task-item]");
    if (!item || item.querySelector?.("[data-action=complete-delegated-task]") === event.target) return;
    draggedDelegatedTaskId = String(item.dataset.taskId || "");
    event.dataTransfer?.setData?.("text/plain", draggedDelegatedTaskId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    item.classList.add("is-dragging");
  }

  function dragOver(event) {
    if (!draggedDelegatedTaskId) return;
    const item = event.target?.closest?.("[data-delegated-task-item]");
    if (!item || item.dataset.taskId === draggedDelegatedTaskId) return;
    event.preventDefault?.();
    const list = item.parentElement;
    const escapedId = globalThis.CSS?.escape?.(draggedDelegatedTaskId) || draggedDelegatedTaskId.replace(/[^\w-]/g, "");
    const dragged = list?.querySelector?.(`[data-task-id="${escapedId}"]`);
    if (!list || !dragged) return;
    const rect = item.getBoundingClientRect?.();
    const after = rect && event.clientY > rect.top + rect.height / 2;
    list.insertBefore(dragged, after ? item.nextSibling : item);
  }

  function dragEnd(event) {
    const item = event.target?.closest?.("[data-delegated-task-item]");
    item?.classList.remove("is-dragging");
    if (!draggedDelegatedTaskId) return;
    const list = root.querySelector?.(".chat-delegated-tasks__list");
    const order = [...(list?.querySelectorAll?.("[data-task-id]") || [])].map(node => node.dataset.taskId).filter(Boolean);
    draggedDelegatedTaskId = "";
    emit({ type: "delegated-tasks-reordered", order });
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
    const placement = state.signaturePlacement;
    const previousPlacement = lastState?.signaturePlacement;
    const preserveSignaturePad = signaturePadOpen && Boolean(lastState);
    const preserveSignaturePlacement = Boolean(
      signaturePlacementRuntime
      && placement?.status === "ready"
      && placement.open !== false
      && previousPlacement?.key === placement.key
      && previousPlacement?.status === placement.status,
    );
    if (placement?.key !== signaturePlacementRuntimeKey) {
      signaturePlacementRuntime?.destroy();
      signaturePlacementRuntime = null;
      signaturePlacementRuntimeKey = "";
      signaturePlacementSelection = placement?.selection || null;
      signaturePlacementScale = Number(placement?.selection?.scale) || 0.5;
      signaturePlacementStampBlob = null;
      signaturePlacementStampPoint = null;
      signaturePlacementStampKey = placement?.key || "";
      signaturePlacementClosedKey = "";
    }
    if (!placement) {
      signaturePlacementStampBlob = null;
      signaturePlacementStampPoint = null;
      signaturePlacementStampKey = "";
    }
    const renderState = placement
      ? { ...state, signaturePlacement: { ...placement, selection: signaturePlacementSelection, open: signaturePlacementClosedKey !== placement.key } }
      : state;
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
    updateShell(renderChatMarkup(renderState, {
      showSettings: typeof onOpenSettings === "function",
      allowDemo: typeof onDemoAccess === "function",
      demo,
      signOutConfirm: signOutConfirmOpen,
      attachmentSource: attachmentSourceOpen,
      datePicker: datePickerOpen,
      datePickerValue,
      signaturePad: signaturePadOpen,
      signaturePadError,
      signaturePlacementStampApplied: Boolean(
        placement?.key && signaturePlacementStampKey === placement.key && signaturePlacementStampBlob,
      ),
    }), state, { preserveSignaturePad, preserveSignaturePlacement });
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
    // SIGNATURE_GESTURE_LOCK_START: signature-pad-mount
    if (signaturePadOpen) setupSignaturePad();
    setupSignaturePlacement(renderState.signaturePlacement);
    // SIGNATURE_GESTURE_LOCK_END: signature-pad-mount
    configureSignaturePlacementStamp(renderState.signaturePlacement);
  }

  function prepareSignaturePadForFirstContact(event) {
    const canvas = event?.target?.closest?.('[data-role="signature-pad"]');
    if (!canvas) return;
    // Capture runs before the canvas handlers. The first iPhone touch can
    // arrive while the modal is still settling its flex layout; synchronizing
    // here prevents that first upward stroke from using the placeholder bitmap.
    if (resizeSignatureCanvasToDisplay(canvas)) drawSignatureStrokes(canvas);
  }

  root.addEventListener("click", click);
  root.addEventListener("input", input);
  root.addEventListener("dragstart", dragStart);
  root.addEventListener("dragover", dragOver);
  root.addEventListener("dragend", dragEnd);
  root.addEventListener("pointerdown", pointerDown, { passive: false });
  root.addEventListener("pointermove", pointerMove, { passive: false });
  root.addEventListener("pointerup", pointerUp);
  root.addEventListener("pointercancel", pointerUp);
  root.addEventListener("pointerdown", prepareSignaturePadForFirstContact, { capture: true, passive: false });
  root.addEventListener("touchstart", prepareSignaturePadForFirstContact, { capture: true, passive: false });
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
      root.removeEventListener("dragstart", dragStart);
      root.removeEventListener("dragover", dragOver);
      root.removeEventListener("dragend", dragEnd);
      root.removeEventListener("pointerdown", pointerDown);
      root.removeEventListener("pointermove", pointerMove);
      root.removeEventListener("pointerup", pointerUp);
      root.removeEventListener("pointercancel", pointerUp);
      root.removeEventListener("pointerdown", prepareSignaturePadForFirstContact, { capture: true });
      root.removeEventListener("touchstart", prepareSignaturePadForFirstContact, { capture: true });
      root.removeEventListener("submit", submit);
      root.removeEventListener("compositionstart", compositionStart);
      root.removeEventListener("compositionend", compositionEnd);
      composerControls = { shell: null, composer: null };
      composing = false;
      handlers.clear();
      lastState = null;
      signaturePlacementRuntime?.destroy();
      signaturePlacementRuntime = null;
      signaturePlacementRuntimeKey = "";
      signOutConfirmOpen = false;
      attachmentSourceOpen = false;
      datePickerOpen = false;
      datePickerValue = "";
      signaturePadOpen = false;
      signaturePadTargetFileId = "";
      signaturePadError = "";
      signaturePadStrokes = [];
      signaturePadCurrentStroke = null;
      signaturePadPointerId = null;
      signaturePadPointerType = null;
      signaturePadTouchIdentifier = null;
      signaturePadAnchorPoint = null;
      signaturePadMoveFamily = null;
      signaturePadListenersCleanup?.();
      root.innerHTML = "";
    },
    pauseSignaturePad,
    openSignaturePad,
  });
}
