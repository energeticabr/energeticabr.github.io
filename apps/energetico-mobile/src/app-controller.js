import { createMediaThumbnail } from "./web/media-thumbnail.js";
import { latestDatabaseFilter, preserveDatabaseFilterRegistrationOptions } from "./chat/database-filter.js";
import { normalizePartialDateSubmission } from "./chat/date-input.js";
import {
  PRESENCE_OTHER_DATES_REPLY_ID,
  expandPresenceDatesMessage,
  latestPresenceValidationDate,
  scopePresenceResult,
} from "./chat/presence-date-scope.js";

async function defaultSignPdfAttachment(input) {
  const module = await import("./web/pdf-signing.js");
  return module.signPdfAttachment(input);
}

async function defaultLaunchGalleryFactory(options) {
  const { createLaunchGallery } = await import("./ui/launch-gallery-view.js");
  return createLaunchGallery(options);
}

async function defaultOrdersGalleryFactory(options) {
  const { createOrdersGallery } = await import("./ui/orders-gallery-view.js");
  return createOrdersGallery(options);
}

async function defaultOrdersGalleryDataFactory(options) {
  const { createOrdersGalleryData } = await import("./chat/orders-gallery-data.js");
  return createOrdersGalleryData(options);
}

async function defaultTasksGalleryFactory(options) {
  const { createTasksGallery } = await import("./ui/tasks-gallery-view.js");
  return createTasksGallery(options);
}

async function defaultTasksGalleryDataFactory(options) {
  const { createTasksGalleryData } = await import("./chat/orders-gallery-data.js");
  return createTasksGalleryData(options);
}

async function defaultPaymentProgrammingGalleryFactory(options) {
  const { createPaymentProgrammingGallery } = await import("./ui/payment-programming-gallery-view.js");
  return createPaymentProgrammingGallery(options);
}

async function defaultPaymentProgrammingGalleryDataFactory(options) {
  const { createPaymentProgrammingGalleryData } = await import("./chat/orders-gallery-data.js");
  return createPaymentProgrammingGalleryData(options);
}

async function defaultRecurringExpensesGalleryFactory(options) {
  const { createRecurringExpensesGallery } = await import("./ui/recurring-expenses-gallery-view.js");
  return createRecurringExpensesGallery(options);
}

async function defaultRecurringExpensesGalleryDataFactory(options) {
  const { createRecurringExpensesGalleryData } = await import("./chat/orders-gallery-data.js");
  return createRecurringExpensesGalleryData(options);
}

async function defaultRegistrationGalleryFactory(options) {
  const { createRegistrationGallery } = await import("./ui/registration-gallery-view.js");
  return createRegistrationGallery(options);
}

async function defaultRegistrationGalleryDataFactory(options) {
  const { createRegistrationGalleryData } = await import("./chat/registration-gallery-data.js");
  return createRegistrationGalleryData(options);
}

async function defaultPendingProvisionAttachmentsDataFactory(options) {
  const { createPendingProvisionAttachmentsData } = await import("./chat/orders-gallery-data.js");
  return createPendingProvisionAttachmentsData(options);
}

function errorMessage(error, fallback) {
  return error?.message || fallback;
}

export function shouldRemoveSignedSource(targetId, preserveSource) {
  return Boolean(String(targetId || "").trim())
    && preserveSource !== true;
}

function withTimeout(promise, timeoutMs, message) {
  const duration = Math.max(1, Number(timeoutMs) || 15_000);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), duration);
    timer?.unref?.();
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function currentQuestion(messages) {
  return messages.filter(message => message.role === "assistant")
    .map(message => message.question || message.text || message.caption || "")
    .filter(Boolean).join("\n");
}

function newUploadMessageId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const hex = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, "0").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const PORTAL_MAIN_MENU_CONFIRM_ID = "portal_confirm_main_menu";
const PORTAL_TRANSFER_ATTACHMENTS_ID = "portal_transfer_attachments";
const LAUNCH_GALLERY_ID = "action_launch_gallery";
const ORDERS_GALLERY_ID = "action_orders_gallery";
const TASKS_GALLERY_ID = "action_tasks_gallery";
const PAYMENT_PROGRAMMING_GALLERY_ID = "action_payment_programming_gallery";
const RECURRING_EXPENSES_GALLERY_ID = "action_recurring_expenses_gallery";
const POWERBI_DASHBOARD_REPLY_ID = "action_powerbi_dashboard";
const POWERBI_SCOPES = Object.freeze(["https://analysis.windows.net/powerbi/api/Report.Read.All"]);
const REGISTRATION_GALLERY_KIND = Object.freeze({
  action_group_gallery: "group",
  action_family_gallery: "family",
  action_subfamily_gallery: "subfamily",
  action_product_gallery: "product",
  action_documents_gallery: "documents",
});
const DOCUMENT_SIGNING_EDIT_SIGNATURE_ID = "document_signing_edit_signature";
const DOCUMENT_SIGNING_REOPEN_LAST_ID = "document_signing_reopen_last";
const DOCUMENT_SIGNING_POSITION_BACK_ID = "document_signing_position_back";
const DOCUMENT_LINE_FINALIZE_ID = "document_line_finalize";
const EPI_ORDER_BLANK_REPLY_ID = "document_signing_epi_order_blank";
const EPI_SUPPLIER_DOCUMENT_BLANK_REPLY_ID = "document_signing_epi_supplier_document_blank";
const NAVIGATION_BACK_ID = "navigation_back";
const FLOW_REMINDER_DELAY_MS = 5 * 60 * 1000;
const FLOW_REMINDER_TITLE = "Energético";
const ATTACHMENT_REMINDER_DELAY_MS = 5 * 60 * 1000;
const ATTACHMENT_REMINDER_BODY = "Anexo recebido há 5 minutos sem postagem";
const SHARED_IMPORT_TIMEOUT_MS = 15_000;
const RESUME_LISTENER_TIMEOUT_MS = 5_000;
const AUTH_INITIALIZE_TIMEOUT_MS = 15_000;
// Interactive Microsoft login includes the system browser, MFA and possible
// Conditional Access. Fifteen seconds is enough for silent restoration but
// can expire while the user is still completing the browser step.
const AUTH_SIGN_IN_TIMEOUT_MS = 120_000;
const PENDING_PROVISION_REMINDER_KEY = "energetico.pending-provision-reminder";
const PENDING_PROVISION_ATTACHMENT_CONCURRENCY = 4;
const DELEGATED_TASKS_ORDER_KEY = "energetico.delegated-tasks-order";
const DOCUMENT_LINE_SELECTION_KEY = "energetico.document-line-selection";
const AUTO_COMPRESSION_THRESHOLD_BYTES = 5 * 1024 * 1024;

function isMenuFlow(flow) {
  return String(flow?.id || "").trim().toLocaleLowerCase("pt-BR").startsWith("menu:");
}

function documentSigningFlow(flow) {
  return String(flow?.id || "").trim().toLocaleLowerCase("pt-BR") === "document_signing";
}

function normalizedChoiceText(value) {
  return String(value || "").trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function lineAdditionDecision(result, activeFlow) {
  if (!documentSigningFlow(activeFlow)) return null;
  const latestPoll = [...(Array.isArray(result?.messages) ? result.messages : [])]
    .reverse()
    .find(message => message?.role !== "user" && message?.type === "poll");
  if (!latestPoll || !Array.isArray(latestPoll.options)) return null;
  const question = normalizedChoiceText(latestPoll.question || latestPoll.prompt || latestPoll.text);
  if (!/(?:outro\s+produto|outra\s+linha|mais\s+(?:um|uma)\s+produto)/i.test(question)) return null;
  const matchingOption = pattern => latestPoll.options.find(option => {
    const replyId = normalizedChoiceText(option?.reply || option?.id);
    const label = normalizedChoiceText(option?.label || option?.title);
    return pattern.test(replyId) || pattern.test(label.replace(/^[✅❌]\s*/u, ""));
  }) || null;
  const advanceOption = matchingOption(/^(?:sim|yes)\b/);
  if (!advanceOption) return null;
  return {
    advanceOption,
    finalizeOption: matchingOption(/^(?:nao|no)\b/),
  };
}

function documentProductPollKind(message) {
  if (message?.type !== "poll" || !Array.isArray(message.options)) return "";
  const filterKey = normalizedChoiceText(message.databaseFilterKey);
  if (filterKey === "document_signing_payment_product") return "payment";
  if (filterKey === "document_signing_epi_product") return "epi";
  const question = normalizedChoiceText(message.question || message.prompt || message.text);
  if (/\bqual\b.*\bproduto\b.*foi\s+pago/i.test(question)) return "payment";
  if (/\bqual\b.*\bproduto\b.*epi\s+foi\s+entregue/i.test(question)) return "epi";
  return "";
}

function epiDescriptionKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("pt-BR")
    .replace(/ß/gu, "ss")
    .replace(/ς/gu, "σ");
}

function epiDeliveryProduct(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.sourceId ?? item.source_id ?? item.id ?? "").trim();
  const description = String(item.description ?? item.PRODUTO ?? "").trim();
  const unit = String(item.unit ?? item.UNIDADE ?? "").trim();
  if (!description) return null;
  return {
    id,
    replyId: id,
    description,
    unit,
    quantity: item.quantity,
    label: String(item.label || `${id ? `${id} - ` : ""}${description}${unit ? ` (${unit})` : ""}`),
    option: { ...item },
  };
}

function epiDeliveryItemKey(item) {
  const description = epiDescriptionKey(item?.description);
  if (!description) return "";
  return JSON.stringify([description, epiDescriptionKey(item?.unit)]);
}

function epiProductDetails(option) {
  const source = option?.source_values || option?.sourceValues || {};
  const label = String(option?.label || option?.title || option?.value || "").trim();
  const withoutId = label.replace(/^\s*[^\-–—]+\s*[\-–—]\s*/u, "");
  const unitMatch = withoutId.match(/\s+\(([^()]*)\)\s*$/u);
  const description = String(source.PRODUTO || option?.description || option?.value
    || (unitMatch ? withoutId.slice(0, unitMatch.index) : withoutId)).trim();
  const id = String(option?.id || option?.reply || "").trim();
  return {
    id,
    replyId: String(option?.reply || option?.id || "").trim(),
    label,
    description,
    unit: String(source.UNIDADE || option?.unit || unitMatch?.[1] || "").trim(),
    option: { ...option },
  };
}

function epiOptionMatchesReply(option, replyId) {
  const sought = String(replyId || "").trim();
  if (!sought) return false;
  return [option?.id, option?.reply].some(value => {
    const candidate = String(value || "").trim();
    return candidate === sought
      || sought.endsWith(":" + candidate)
      || candidate.endsWith(":" + sought);
  });
}

function isEpiQuantityQuestion(poll) {
  if (poll?.type !== "poll") return false;
  const question = normalizedChoiceText(poll.question || poll.prompt || poll.text);
  return /\bquantidade\b|\bqtd\b/i.test(question);
}

function isEmptyEpiProductCatalog(result) {
  const text = (Array.isArray(result?.messages) ? result.messages : [])
    .map(message => message?.text || message?.question || "")
    .join(" ");
  return /nao ha produtos epi ativos cadastrados/i.test(normalizedChoiceText(text));
}

function epiQuantityPdfCompatible(value) {
  let raw = String(value || "").trim().replace(/ /g, "");
  if (!raw || raw.length > 24 || /e/i.test(raw)) return false;
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(/,/g, ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(raw)) return false;
  if (raw.startsWith("-")) return false;
  const unsigned = raw.replace(/^[+-]/u, "");
  const [integer = "0", fraction = ""] = unsigned.split(".");
  if (fraction.length > 6) return false;
  const whole = integer.replace(/^0+(?=\d)/u, "") || "0";
  const maximum = "999999999999999";
  if (whole.length > maximum.length || (whole.length === maximum.length && whole > maximum)) return false;
  if (whole === maximum && /[1-9]/u.test(fraction)) return false;
  return /[1-9]/u.test(whole + fraction);
}

function isDocumentProductPoll(message) {
  return Boolean(documentProductPollKind(message));
}

function latestDocumentProductKind(messages = []) {
  const poll = [...messages].reverse().find(message => message?.role !== "user" && isDocumentProductPoll(message));
  return poll ? documentProductPollKind(poll) : "";
}

function withLegacyDocumentLineFinalize(result) {
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const pollIndex = messages.findLastIndex(message => message?.role !== "user" && isDocumentProductPoll(message));
  if (pollIndex < 0) return result;
  const poll = messages[pollIndex];
  if (poll.options.some(option => String(option?.reply || option?.id || "") === DOCUMENT_LINE_FINALIZE_ID)) {
    return result;
  }
  const nextMessages = messages.slice();
  nextMessages[pollIndex] = {
    ...poll,
    options: [{
      id: DOCUMENT_LINE_FINALIZE_ID,
      reply: DOCUMENT_LINE_FINALIZE_ID,
      label: "✅ FINALIZAR",
      legacyDocumentLineFinalize: true,
    }, ...poll.options],
  };
  return { ...result, messages: nextMessages };
}

function currentDocumentLineFinalizeOption(messages = []) {
  const latestPoll = [...messages].reverse().find(message => message?.role !== "user" && message?.type === "poll");
  if (!latestPoll || !Array.isArray(latestPoll.options)) return null;
  return latestPoll.options.find(option => (
    String(option?.reply || option?.id || "") === DOCUMENT_LINE_FINALIZE_ID
  )) || null;
}

function currentLineDecisionOption(messages, activeFlow) {
  return lineAdditionDecision({ messages }, activeFlow)?.finalizeOption || null;
}

function isMainMenuPrompt(text) {
  return /qual\s+(?:área|area|fluxo)\s+voc[eê]\s+deseja\s+(?:acessar|iniciar)/i.test(String(text || ""));
}

function isMenuResult(result) {
  const stage = String(result?.stage || "").trim().toLocaleLowerCase("pt-BR");
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const hasMenuPrompt = messages.some(message => {
    const text = String(message?.question || message?.prompt || message?.text || "");
    return isMainMenuPrompt(text);
  });
  const responsePrompt = String(result?.question || result?.prompt || "");
  return result?.returned_to_main_menu === true
    || result?.resetConversation === true
    || stage === "choosing_group"
    || hasMenuPrompt
    || isMainMenuPrompt(responsePrompt);
}

function hasAttachmentTransferPrompt(messages = []) {
  return (Array.isArray(messages) ? messages : []).some(message => (
    normalizedChoiceText(message?.question || message?.prompt || message?.text || message?.caption)
      .includes("transferir anexos para o menu principal")
  ));
}

function hasAttachmentTransferConfirmation(result = {}) {
  if (result.attachmentsTransferred === true || result.attachments_transferred === true) return true;
  const resultFlags = Array.isArray(result.results) ? result.results : [];
  if (resultFlags.some(item => item?.attachmentsTransferred === true || item?.attachments_transferred === true)) return true;
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const confirmationText = normalizedChoiceText([
    result.message,
    result.question,
    result.prompt,
    ...messages.map(message => message?.question || message?.prompt || message?.text || message?.caption),
  ].filter(Boolean).join(" "));
  return /\banexos?\s+(?:foram\s+)?transferid[oa]s?\b/.test(confirmationText);
}

function isDifferentActiveFlow(previousFlow, nextFlow) {
  if (!nextFlow) return false;
  if (!previousFlow) return true;
  return ["id", "contextId", "title"].some(key => (
    previousFlow[key] != null
      && nextFlow[key] != null
      && String(previousFlow[key]).trim() !== String(nextFlow[key]).trim()
  ));
}

function hasAttachmentCompressionChoice(messages = []) {
  return (Array.isArray(messages) ? messages : []).some(message => (
    Array.isArray(message?.options)
      && message.options.some(option => String(option?.reply || option?.id || "")
        .trim().toLowerCase().startsWith("attachment_compression_"))
  ));
}

function attachmentCompressionDescriptor(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim();
  const fileName = String(item.fileName || item.file?.name || "arquivo").trim() || "arquivo";
  const mimeType = String(item.mimeType || item.file?.type || "application/octet-stream").trim();
  const size = Number(item.size ?? item.file?.size ?? 0);
  const mediaUrl = String(item.mediaUrl || "").trim();
  if (!id && !mediaUrl) return null;
  return {
    ...(id ? { id } : {}),
    fileName,
    mimeType,
    size: Number.isFinite(size) ? size : 0,
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(item.previewUrl ? { previewUrl: String(item.previewUrl) } : {}),
  };
}

function attachCompressionPreview(result, originalAttachment) {
  const original = attachmentCompressionDescriptor(originalAttachment);
  if (!original) return result;
  const remoteAttachments = Array.isArray(result?.attachments) ? result.attachments : [];
  const compressed = remoteAttachments.find(item => String(item?.id || "") === original.id)
    || remoteAttachments.find(item => String(item?.fileName || "").trim() === original.fileName)
    || null;
  if (!compressed) return result;
  const compressedDescriptor = attachmentCompressionDescriptor(compressed);
  if (!compressedDescriptor) return result;
  const preview = { original, compressed: compressedDescriptor };
  const messages = Array.isArray(result?.messages) ? result.messages : [];
  const targetIndex = messages.findLastIndex(message => (
    message?.type === "poll"
      && Array.isArray(message.options)
      && message.options.some(option => String(option?.reply || option?.id || "").trim().toLowerCase().startsWith("attachment_compression_"))
  ));
  if (targetIndex < 0) return result;
  const nextMessages = messages.slice();
  nextMessages[targetIndex] = {
    ...nextMessages[targetIndex],
    attachment_compression_preview: preview,
  };
  return { ...result, messages: nextMessages };
}

function localDateIso(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pendingProvisionDateInputValue(value) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const local = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return local ? `${local[1]}/${local[2]}/${local[3]}` : "";
}

function pendingProvisionDateIso(value) {
  const match = String(value || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (month < 1 || month > 12 || day < 1 || date.getFullYear() !== year
    || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function pendingProvisionStorageKey(account) {
  const id = String(account?.homeAccountId || account?.username || "").trim();
  return id ? `${PENDING_PROVISION_REMINDER_KEY}:${id}` : "";
}

function readPendingProvisionReminder(account) {
  const key = pendingProvisionStorageKey(account);
  if (!key || !globalThis.localStorage) return null;
  try {
    const value = JSON.parse(globalThis.localStorage.getItem(key) || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function writePendingProvisionReminder(account, value) {
  const key = pendingProvisionStorageKey(account);
  if (!key || !globalThis.localStorage) return;
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private browsing quota failure should not block the reminder screen.
  }
}

function delegatedTasksStorageKey(account) {
  const id = String(account?.homeAccountId || account?.username || "").trim();
  return id ? `${DELEGATED_TASKS_ORDER_KEY}:${id}` : "";
}

function readDelegatedTaskOrder(account) {
  const key = delegatedTasksStorageKey(account);
  if (!key || !globalThis.localStorage) return [];
  try {
    const value = JSON.parse(globalThis.localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.map(item => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeDelegatedTaskOrder(account, order) {
  const key = delegatedTasksStorageKey(account);
  if (!key || !globalThis.localStorage) return;
  try { globalThis.localStorage.setItem(key, JSON.stringify(order)); } catch { /* quota/private mode */ }
}

function documentLineSelectionStorageKey(account) {
  const id = String(account?.homeAccountId || account?.username || "").trim();
  return id ? `${DOCUMENT_LINE_SELECTION_KEY}:${id}` : "";
}

function readDocumentLineSelection(account, activeFlow, productKind) {
  const key = documentLineSelectionStorageKey(account);
  if (!key || !globalThis.localStorage || !documentSigningFlow(activeFlow) || !productKind) return null;
  try {
    const value = JSON.parse(globalThis.localStorage.getItem(key) || "null");
    if (!value || typeof value !== "object" || value.productKind !== productKind) return null;
    const savedContext = String(value.contextId || "").trim();
    const currentContext = String(activeFlow?.contextId || "").trim();
    if (!savedContext || !currentContext || savedContext !== currentContext) return null;
    const option = value.finalizeOption;
    return option && (option.reply || option.id) ? option : null;
  } catch {
    return null;
  }
}

function writeDocumentLineSelection(account, activeFlow, productKind, finalizeOption) {
  const key = documentLineSelectionStorageKey(account);
  if (!key || !globalThis.localStorage) return;
  try {
    if (!finalizeOption) {
      globalThis.localStorage.removeItem(key);
      return;
    }
    // The legacy VM exposes FINALIZAR one step behind the product list. Keep
    // that decision across an app restart so the visible list remains usable.
    globalThis.localStorage.setItem(key, JSON.stringify({
      contextId: String(activeFlow?.contextId || "").trim(),
      productKind,
      finalizeOption: {
        id: String(finalizeOption.id || finalizeOption.reply || ""),
        reply: String(finalizeOption.reply || finalizeOption.id || ""),
        label: String(finalizeOption.label || finalizeOption.title || "NÃO"),
      },
    }));
  } catch {
    // Persistence is best effort; the current session remains functional.
  }
}

function normalizeDelegatedTasks(snapshot, account) {
  if (!snapshot || !Array.isArray(snapshot.rows)) return null;
  const rows = snapshot.rows.filter(row => row && row.id != null).map(row => ({
    ...row,
    id: String(row.id),
    task: String(row.task || row.title || "Tarefa sem descrição"),
  }));
  const known = new Map(rows.map(row => [row.id, row]));
  const ordered = [];
  for (const id of readDelegatedTaskOrder(account)) {
    const row = known.get(id);
    if (row) { ordered.push(row); known.delete(id); }
  }
  ordered.push(...known.values());
  writeDelegatedTaskOrder(account, ordered.map(row => row.id));
  return { ...snapshot, rows: ordered };
}

export function createAppController({
  store,
  view,
  client,
  auth,
  native,
  recovery,
  mediaLoadTimeoutMs = 30_000,
  authTimeoutMs,
  authSignInTimeoutMs,
  signPdfAttachment = defaultSignPdfAttachment,
  launchGalleryFactory = defaultLaunchGalleryFactory,
  ordersGalleryFactory = defaultOrdersGalleryFactory,
  ordersGalleryDataFactory = defaultOrdersGalleryDataFactory,
  tasksGalleryFactory = defaultTasksGalleryFactory,
  tasksGalleryDataFactory = defaultTasksGalleryDataFactory,
  paymentProgrammingGalleryFactory = defaultPaymentProgrammingGalleryFactory,
  paymentProgrammingGalleryDataFactory = defaultPaymentProgrammingGalleryDataFactory,
  recurringExpensesGalleryFactory = defaultRecurringExpensesGalleryFactory,
  recurringExpensesGalleryDataFactory = defaultRecurringExpensesGalleryDataFactory,
  registrationGalleryFactory = defaultRegistrationGalleryFactory,
  registrationGalleryDataFactory = defaultRegistrationGalleryDataFactory,
  pendingProvisionAttachmentsDataFactory = defaultPendingProvisionAttachmentsDataFactory,
  databaseFilterDebounceMs = 300,
}) {
  if (!store || !view || !client || !auth || !native) {
    throw new TypeError("O controlador requer todos os serviços do Energético.");
  }

  const initializeTimeoutMs = Number.isFinite(Number(authTimeoutMs))
    ? Number(authTimeoutMs)
    : AUTH_INITIALIZE_TIMEOUT_MS;
  // Keep the old authTimeoutMs test/integration override useful while making
  // the production interactive timeout long enough for Microsoft MFA.
  const signInTimeoutMs = Number.isFinite(Number(authSignInTimeoutMs))
    ? Number(authSignInTimeoutMs)
    : Number.isFinite(Number(authTimeoutMs))
      ? Number(authTimeoutMs)
      : AUTH_SIGN_IN_TIMEOUT_MS;

  let account = null;
  let attachmentTransferPending = false;
  let attachmentTransferCompleted = false;
  // Render an actionable login immediately. Session restoration is silent and
  // must never leave the first screen disabled while a native bridge responds.
  let sessionStatus = "signed-out";
  let sessionError = null;
  let started = false;
  let stopped = false;
  let launchGallery = null;
  let launchGalleryOpening = null;
  let ordersGallery = null;
  let ordersGalleryOpening = null;
  let tasksGallery = null;
  let tasksGalleryOpening = null;
  let paymentProgrammingGallery = null;
  let paymentProgrammingGalleryOpening = null;
  let recurringExpensesGallery = null;
  let recurringExpensesGalleryOpening = null;
  const registrationGalleries = new Map();
  const registrationGalleryOpenings = new Map();
  let gallerySignatureResolve = null;
  let unsubscribeStore = null;
  const unsubscribeCommands = [];
  let uploadQueue = Promise.resolve();
  let attachmentRevision = 0;
  let snapshotPending = null;
  let resuming = false;
  let attachmentActionBusy = false;
  const idleWaiters = new Set();
  let completionMenuTimer = null;
  let completionMenuRevision = 0;
  let responseTransitionTimer = null;
  let responseTransitionRevision = 0;
  const responseTransitionWaiters = new Set();
  let databaseFilterTimer = null;
  let databaseFilterRevision = 0;
  let lastDatabaseFilter = { key: "", query: "" };
  let databaseFilterRequestedKey = "";
  let lastPresenceValidationDate = "";
  let legacyDocumentLineFinalizeOption = null;
  const epiSelectedProducts = new Map();
  const epiButtonItems = new Map();
  const epiRemoteItems = new Map();
  let pendingEpiButtonProduct = null;
  let epiDirectFinalizeOption = null;
  let epiFinalizeProgress = null;
  let epiRenderSourceMessages = null;
  let epiRenderSourcePoll = null;
  let epiRenderSelectionSignature = "";
  let epiRenderMessages = null;
  let epiSelectionIds = [];
  let epiSelectionIdsSignature = "[]";
  let recoveryAccountId = null;
  let recoveryVerified = false;
  let recoveryPreview = null;
  let recoveryReference = null;
  let olderReferences = [];
  let recoveryUncertain = false;
  let recoveryWarning = null;
  const previewUrls = new Set();
  const previewLoading = new Set();
  const previewTimers = new Set();
  let signaturePlacementLoad = null;
  let signaturePlacementData = null;
  // A generated signed document can be edited after the VM has already
  // returned to the main menu. Keep its source files locally so the resize
  // button opens the placement viewer instead of sending an unknown command
  // that the VM interprets as a request for the main menu.
  let signaturePlacementOverride = null;
  let signaturePlacementGeneration = 0;
  let signaturePlacementEditPending = false;
  let signaturePlacementStamp = null;
  let attachmentSigningBusy = false;
  let draftEditRevision = 0;
  let checkpointMessages = null;
  let checkpointQuestion = "";
  let unsubscribeRecovery = null;
  let unsubscribeResume = null;
  let sharedResume = null;
  let sharedResumeRequested = false;
  let sharedImportInFlight = null;
  let sharedImportAccount;
  // A read that finishes after the account/session changed belongs to the
  // previous session. Keep its source IDs out of the next login so a stale
  // shared attachment cannot be uploaded after sign-out.
  const ignoredSharedIds = new Set();

  function clearLegacyDocumentLineSelection() {
    legacyDocumentLineFinalizeOption = null;
    writeDocumentLineSelection(account, null, "", null);
  }
  function clearEpiProductSelection() {
    epiSelectedProducts.clear();
    epiButtonItems.clear();
    epiRemoteItems.clear();
    pendingEpiButtonProduct = null;
    epiDirectFinalizeOption = null;
    epiFinalizeProgress = null;
  }
  function epiCommittedItemKeys() {
    return new Set([
      ...[...epiRemoteItems.values()].map(item => epiDescriptionKey(item.description)),
      ...epiButtonItems.keys(),
    ].filter(Boolean));
  }
  function epiCommittedItemCount() {
    const keys = new Set(epiRemoteItems.keys());
    for (const item of epiButtonItems.values()) {
      const key = epiDeliveryItemKey(item);
      if (key) keys.add(key);
    }
    return keys.size;
  }
  function syncEpiDeliverySnapshot(activeFlow) {
    if (activeFlow === undefined) return;
    if (!documentSigningFlow(activeFlow)) {
      clearEpiProductSelection();
      return;
    }
    const delivery = activeFlow?.epiDelivery;
    if (!delivery || typeof delivery !== "object") return;
    if (Array.isArray(delivery.items)) {
      epiRemoteItems.clear();
      for (const rawItem of delivery.items) {
        const item = epiDeliveryProduct(rawItem);
        const key = epiDeliveryItemKey(item);
        if (key && !epiRemoteItems.has(key)) epiRemoteItems.set(key, item);
      }
    }
    if (delivery.stage === "document_signing_epi_quantity") {
      const pending = epiDeliveryProduct(delivery.pendingProduct);
      if (pending) pendingEpiButtonProduct = pending;
    } else if (Object.hasOwn(delivery, "pendingProduct") && delivery.pendingProduct == null) {
      pendingEpiButtonProduct = null;
    }
  }
  function reconcileEpiFinalizeProgress(activeFlow, messages) {
    const progress = epiFinalizeProgress;
    const delivery = activeFlow?.epiDelivery;
    if (!progress || !documentSigningFlow(activeFlow) || !delivery || typeof delivery !== "object") return;

    const committedDescriptions = epiCommittedItemKeys();
    for (const [id, product] of epiSelectedProducts) {
      if (committedDescriptions.has(epiDescriptionKey(product.description))) epiSelectedProducts.delete(id);
    }

    if (delivery.stage === "document_signing_epi_quantity") {
      const pending = epiDeliveryProduct(delivery.pendingProduct);
      const pendingKey = epiDeliveryItemKey(pending);
      const pendingIndex = progress.products.findIndex(product => epiDeliveryItemKey(product) === pendingKey);
      if (pendingIndex >= 0) {
        progress.index = pendingIndex;
        progress.phase = "quantity";
        delete progress.advanceReplyId;
      }
      return;
    }

    if (delivery.stage === "document_signing_epi_more") {
      // The VM's more stage proves the quantity was accepted, even when its
      // response was lost locally. Resume at the explicit yes/no decision.
      for (let index = progress.index; index < progress.products.length; index += 1) {
        if (committedDescriptions.has(epiDescriptionKey(progress.products[index].description))) {
          progress.index = index;
        }
      }
      const advanceOption = lineAdditionDecision({ messages }, activeFlow)?.advanceOption;
      progress.phase = "advance";
      progress.advanceReplyId = String(advanceOption?.reply || advanceOption?.id || progress.advanceReplyId || "yes");
      return;
    }

    if (delivery.stage === "document_signing_epi_product" && progress.phase === "advance") {
      // Product stage after an uncertain SIM means the VM already advanced.
      // Discard the stale cursor so remaining checkboxes can be finalized
      // again; the committed item is excluded from the next batch by snapshot.
      const advancedProduct = progress.products[progress.index];
      if (advancedProduct) {
        const advancedDescription = epiDescriptionKey(advancedProduct.description);
        for (const [id, product] of epiSelectedProducts) {
          if (epiDescriptionKey(product.description) === advancedDescription) epiSelectedProducts.delete(id);
        }
      }
      epiFinalizeProgress = null;
    }
  }
  let starting = false;
  let sessionRevision = 0;
  let flowReminderTimer = null;
  let flowReminderRevision = 0;
  let attachmentReminderTimer = null;
  let attachmentReminderRevision = 0;
  let pendingProvisionSnapshot = null;
  let pendingNotesSnapshot = null;
  let pendingNotesSessionDismissed = false;
  let pendingNoteLaunchOrderId = "";
  let pendingNoteLaunchFailed = false;
  let pendingNoteLaunchNeedsResync = false;
  let pendingNoteLaunchProgress = null;
  let pendingProvisionReminderOpen = false;
  let pendingProvisionReminderError = "";
  let pendingProvisionRequest = null;
  let pendingProvisionSessionDismissed = false;
  let pendingProvisionReminderTimer = null;
  let pendingProvisionReminderRevision = 0;
  let pendingProvisionAttachmentsData = null;
  let pendingProvisionAttachmentsAccount = null;
  let pendingProvisionAttachmentsDataRequest = null;
  let pendingProvisionAttachmentsDataRequestAccount = null;
  let pendingProvisionSharePointAuthorization = null;
  let pendingProvisionAttachmentStates = new Map();
  let pendingProvisionAttachmentStateRevision = 0;
  let pendingProvisionExpandedPaymentId = "";
  let pendingProvisionSettlementPaymentId = "";
  let pendingProvisionDateEditPaymentId = "";
  let pendingProvisionDateEditValue = "";
  let pendingProvisionDateEditError = "";
  let pendingProvisionDateEditBusy = false;
  let pendingProvisionUploads = new Map();
  let pendingProvisionUploadsRevision = 0;
  let currentAssistantPollSnapshot = null;
  let pendingProvisionAttachmentGeneration = 0;
  let delegatedTasksSnapshot = null;
  let delegatedTasksRequest = null;
  const storageWarning = "Não foi possível salvar a prévia neste aparelho. Os dados já recebidos pela VM continuam preservados, mas copie o rascunho antes de fechar.";

  function signaturePlacementRequest() {
    if (signaturePlacementEditPending) return null;
    const state = store.getState();
    const activePlacement = state.activeFlow?.documentSigningPlacement;
    const placement = signaturePlacementOverride || activePlacement;
    if (!placement || ![
      "document_signing_waiting_configuration",
      "document_signing_waiting_position",
    ].includes(String(placement.stage || ""))) return null;
    const attachments = Array.isArray(state.attachments) ? state.attachments : [];
    const hasGenericMime = item => {
      const mimeType = String(item?.mimeType || "").trim().toLowerCase();
      return !mimeType || mimeType === "application/octet-stream" || mimeType === "binary/octet-stream";
    };
    const isPdf = item => String(item?.mimeType || "").trim().toLowerCase() === "application/pdf"
      || (hasGenericMime(item) && /\.pdf$/i.test(String(item?.fileName || "").trim()));
    const isImage = item => String(item?.mimeType || "").trim().toLowerCase().startsWith("image/")
      || (hasGenericMime(item) && /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(String(item?.fileName || "").trim()));
    const hasDeclaredSource = source => Boolean(
      String(source?.id || "").trim() || String(source?.fileName || "").trim(),
    );
    const uniqueAttachment = predicate => {
      const matches = attachments.filter(predicate);
      return matches.length === 1 ? matches[0] : null;
    };
    const document = placement.document?.mediaUrl || placement.document?.blob
      ? { ...placement.document, id: String(placement.document.id || placement.document.mediaUrl) }
      : hasDeclaredSource(placement.document) ? null : uniqueAttachment(isPdf);
    const signature = placement.signature?.mediaUrl || placement.signature?.blob
      ? { ...placement.signature, id: String(placement.signature.id || placement.signature.mediaUrl) }
      : hasDeclaredSource(placement.signature)
        ? null
        : uniqueAttachment(item => item?.id !== document?.id && isImage(item));
    const canLoadDocument = Boolean(document?.blob || document?.mediaUrl);
    const canLoadSignature = Boolean(signature?.blob || signature?.mediaUrl);
    if (!document?.id || !signature?.id || !canLoadDocument || !canLoadSignature
      || ((!document.blob || !signature.blob) && typeof client.fetchMedia !== "function")) return null;
    const targetAttachment = attachments.find(item => (
      String(item?.id || "") === String(document.id || "")
      || (document.mediaUrl && String(item?.mediaUrl || "") === String(document.mediaUrl))
    ));
    const stage = String(placement.stage || "");
    return {
      key: `${document.id}:${signature.id}:${stage}:${signaturePlacementOverride?.messageId || "active"}`,
      stage,
      document,
      signature,
      signerName: String(
        placement.signerName
          || state.activeFlow?.signerName
          || state.account?.displayName
          || state.account?.name
          || "USUÁRIO",
      ).trim() || "USUÁRIO",
      signedAt: placement.signedAt || state.activeFlow?.signedAt || null,
      selection: placement.selection || null,
      preserveSource: placement.preserveSource === true,
      ...(targetAttachment?.id ? { targetAttachmentId: String(targetAttachment.id) } : {}),
    };
  }

  function localPlacementForRequest(request) {
    if (signaturePlacementOverride?.kind === "attachment") return signaturePlacementOverride;
    if (signaturePlacementData?.key !== request?.key
      || signaturePlacementData.status !== "ready") return null;
    const documentBlob = signaturePlacementData.document?.blob;
    const signatureBlob = signaturePlacementData.signature?.blob;
    if (!documentBlob || typeof documentBlob.arrayBuffer !== "function"
      || !signatureBlob || typeof signatureBlob.arrayBuffer !== "function") return null;
    return {
      kind: request.targetAttachmentId ? "attachment" : "document",
      requestKey: request.key,
      ...(request.targetAttachmentId ? { targetAttachmentId: request.targetAttachmentId } : {}),
      messageId: request.targetAttachmentId ? `attachment:${request.targetAttachmentId}` : `document:${request.key}`,
      stage: request.stage,
      document: {
        ...request.document,
        id: String(request.targetAttachmentId || request.document.id),
        fileName: String(request.document.fileName || "documento.pdf"),
        mimeType: "application/pdf",
        blob: documentBlob,
      },
      signature: {
        ...request.signature,
        blob: signatureBlob,
      },
      signerName: request.signerName,
      signedAt: request.signedAt,
      preserveSource: request.preserveSource === true,
      uploadMessageId: newUploadMessageId(),
    };
  }

  function fetchMediaWithTimeout(item, label) {
    const timeout = Math.max(1, Number(mediaLoadTimeoutMs) || 30_000);
    const options = typeof AbortController === "function" ? new AbortController() : null;
    let timer = null;
    const request = Promise.resolve().then(() => client.fetchMedia(item, options ? { signal: options.signal } : undefined));
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        options?.abort?.();
        reject(new Error(`O carregamento de ${label} demorou mais que o esperado.`));
      }, timeout);
    });
    return Promise.race([request, deadline]).finally(() => {
      if (timer !== null) clearTimeout(timer);
    });
  }

  function syncSignaturePlacement() {
    const request = signaturePlacementRequest();
    if (!request) {
      if (signaturePlacementData || signaturePlacementLoad) {
        signaturePlacementGeneration += 1;
        signaturePlacementLoad = null;
        signaturePlacementData = null;
      }
      return null;
    }
    if (signaturePlacementStamp && signaturePlacementStamp.key !== request.key) signaturePlacementStamp = null;
    if (signaturePlacementData?.key === request.key
      && ["loading", "ready", "signing", "error"].includes(signaturePlacementData.status)) return signaturePlacementData;
    if (signaturePlacementLoad?.key === request.key) return signaturePlacementData;

    const generation = ++signaturePlacementGeneration;
    const load = { key: request.key, generation };
    signaturePlacementLoad = load;
    signaturePlacementData = {
      status: "loading",
      key: request.key,
      stage: request.stage,
      document: { fileName: request.document.fileName },
      signature: { fileName: request.signature.fileName },
      signerName: request.signerName,
      signedAt: request.signedAt,
      selection: request.selection,
    };
    // Render the modal immediately while both files are downloaded.
    render();
    Promise.all([
      request.document.blob || fetchMediaWithTimeout(request.document, "o documento"),
      request.signature.blob || fetchMediaWithTimeout(request.signature, "a assinatura"),
    ])
      .then(([documentBlob, signatureBlob]) => {
        if (stopped || generation !== signaturePlacementGeneration || signaturePlacementLoad?.key !== request.key) return;
        if (!documentBlob || typeof documentBlob.arrayBuffer !== "function"
          || !signatureBlob || typeof signatureBlob.arrayBuffer !== "function") {
          throw new Error("A VM não devolveu os arquivos para posicionar a assinatura.");
        }
        signaturePlacementData = {
          status: "ready",
          key: request.key,
          stage: request.stage,
          document: { fileName: request.document.fileName, blob: documentBlob },
          signature: { fileName: request.signature.fileName, blob: signatureBlob },
          signerName: request.signerName,
          signedAt: request.signedAt,
          selection: request.selection,
        };
      })
      .catch(error => {
        if (stopped || generation !== signaturePlacementGeneration || signaturePlacementLoad?.key !== request.key) return;
        signaturePlacementData = {
          status: "error",
          key: request.key,
          stage: request.stage,
          error: errorMessage(error, "Não foi possível carregar o documento para escolher o local da assinatura."),
        };
      })
      .finally(() => {
        if (signaturePlacementLoad?.key === request.key) signaturePlacementLoad = null;
        // Render only after the load guard is released.  Rendering from the
        // promise callback while `signaturePlacementLoad` was still active
        // could leave the loading dialog mounted; opening it again with the X
        // happened to trigger the missing render and made the PDF appear.
        if (!stopped && generation === signaturePlacementGeneration
          && signaturePlacementData?.key === request.key) render();
      });
    return signaturePlacementData;
  }

  function invalidateSignaturePlacement({ clearOverride = false } = {}) {
    if (clearOverride) signaturePlacementOverride = null;
    signaturePlacementStamp = null;
    signaturePlacementGeneration += 1;
    signaturePlacementLoad = null;
    signaturePlacementData = null;
  }

  function withUploadedSignaturePlacementSources(result, uploadedItem) {
    const placement = result?.activeFlow?.documentSigningPlacement;
    if (uploadedItem?.hideFromAttachmentTray !== true || !placement || ![
      "document_signing_waiting_configuration",
      "document_signing_waiting_position",
    ].includes(String(placement.stage || ""))) return result;
    if (placement.document?.mediaUrl && placement.signature?.mediaUrl) return result;

    const attachments = Array.isArray(result.attachments) ? result.attachments : [];
    const isPdf = item => String(item?.mimeType || "").toLowerCase() === "application/pdf"
      || /\.pdf$/i.test(String(item?.fileName || "").trim());
    const isImage = item => String(item?.mimeType || "").toLowerCase().startsWith("image/")
      || /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(String(item?.fileName || "").trim());
    const document = placement.document?.mediaUrl
      ? placement.document
      : [...attachments].reverse().find(isPdf);
    const uploadedFile = uploadedItem.file;
    const uploadedName = String(uploadedFile?.name || "").trim().toLocaleLowerCase();
    const uploadedType = String(uploadedFile?.type || "").trim().toLocaleLowerCase();
    const uploadedSize = Number(uploadedFile?.size);
    const images = [...attachments].reverse().filter(item => item?.id !== document?.id && isImage(item));
    const signature = placement.signature?.mediaUrl
      ? placement.signature
      : images.find(item => {
        const sameName = !uploadedName
          || String(item?.fileName || "").trim().toLocaleLowerCase() === uploadedName;
        const sameType = !uploadedType
          || String(item?.mimeType || "").trim().toLocaleLowerCase() === uploadedType;
        const remoteSize = Number(item?.size);
        const sameSize = !Number.isFinite(uploadedSize) || uploadedSize <= 0
          || !Number.isFinite(remoteSize) || remoteSize <= 0 || remoteSize === uploadedSize;
        return sameName && sameType && sameSize;
      }) || images[0];
    if (!document?.mediaUrl || !signature?.mediaUrl) return result;

    return {
      ...result,
      activeFlow: {
        ...result.activeFlow,
        documentSigningPlacement: {
          ...placement,
          document,
          signature,
        },
      },
    };
  }

  function flowReminderDetails() {
    const activeFlow = store.getState().activeFlow;
    const flowTitle = String(activeFlow?.title || "").trim();
    if (!account || stopped || !activeFlow?.id || !flowTitle) return null;
    return {
      title: FLOW_REMINDER_TITLE,
      body: `O fluxo de ${flowTitle} está aguardando finalização.`,
    };
  }

  function notifyFlowReminder(details) {
    if (typeof globalThis.Notification !== "function"
      || globalThis.Notification.permission !== "granted") return false;
    try {
      new globalThis.Notification(details.title, {
        body: details.body,
        tag: "energetico-active-flow",
      });
      return true;
    } catch {
      return false;
    }
  }

  function cancelFlowReminder() {
    flowReminderRevision += 1;
    if (flowReminderTimer !== null) clearTimeout(flowReminderTimer);
    flowReminderTimer = null;
    void native.cancelFlowReminder?.();
  }

  function reminderTimeout(callback, delayMs = FLOW_REMINDER_DELAY_MS) {
    const timer = setTimeout(callback, delayMs);
    // Node based controller tests must not stay alive for five minutes just
    // because an inactive-flow fallback was armed.
    timer?.unref?.();
    return timer;
  }

  function armFlowReminder() {
    cancelFlowReminder();
    const details = flowReminderDetails();
    if (!details) return;
    const revision = flowReminderRevision;
    flowReminderTimer = reminderTimeout(() => {
      flowReminderTimer = null;
      if (stopped || revision !== flowReminderRevision || !flowReminderDetails()) return;
      notifyFlowReminder(details);
    }, FLOW_REMINDER_DELAY_MS);
  }

  function clearPendingProvisionAttachmentState({ clearData = false } = {}) {
    pendingProvisionAttachmentGeneration += 1;
    pendingProvisionAttachmentStates = new Map();
    pendingProvisionAttachmentStateRevision += 1;
    pendingProvisionExpandedPaymentId = "";
    pendingProvisionDateEditPaymentId = "";
    pendingProvisionDateEditValue = "";
    pendingProvisionDateEditError = "";
    pendingProvisionDateEditBusy = false;
    pendingProvisionUploads = new Map();
    pendingProvisionUploadsRevision += 1;
    if (clearData) {
      pendingProvisionAttachmentsData = null;
      pendingProvisionAttachmentsAccount = null;
      pendingProvisionAttachmentsDataRequest = null;
      pendingProvisionAttachmentsDataRequestAccount = null;
    }
  }

  function pendingProvisionAttachmentStateForView() {
    return Object.fromEntries(pendingProvisionAttachmentStates.entries());
  }

  function pendingProvisionUploadsForView() {
    return Object.fromEntries([...pendingProvisionUploads.entries()].map(([paymentId, state]) => [paymentId, {
      items: (state.items || []).map(item => ({
        id: String(item.id || item.file?.id || item.fileName || ""),
        fileName: String(item.file?.name || item.fileName || "arquivo"),
        size: Number(item.file?.size ?? item.size) || 0,
        status: String(item.status || "ready"),
      })),
      busy: state.busy === true,
      error: String(state.error || ""),
    }]));
  }

  function setPendingProvisionUploads(paymentId, state) {
    pendingProvisionUploads.set(paymentId, state);
    pendingProvisionUploadsRevision += 1;
  }

  function setPendingProvisionAttachmentState(paymentId, state) {
    pendingProvisionAttachmentStates.set(paymentId, state);
    pendingProvisionAttachmentStateRevision += 1;
  }

  function pendingProvisionAttachmentLoadIsCurrent({ targetAccount, targetRevision, generation, snapshot }) {
    return !stopped
      && account === targetAccount
      && sessionRevision === targetRevision
      && pendingProvisionAttachmentGeneration === generation
      && pendingProvisionSnapshot === snapshot;
  }

  async function getPendingProvisionAttachmentsData(targetAccount = account, targetRevision = sessionRevision) {
    if (!targetAccount || stopped) throw new Error("A sessão Microsoft não está ativa.");
    if (pendingProvisionAttachmentsData && pendingProvisionAttachmentsAccount === targetAccount) {
      return pendingProvisionAttachmentsData;
    }
    if (pendingProvisionAttachmentsDataRequest && pendingProvisionAttachmentsDataRequestAccount === targetAccount) {
      return pendingProvisionAttachmentsDataRequest;
    }
    const assertCurrentSession = () => {
      if (stopped || account !== targetAccount || sessionRevision !== targetRevision) {
        throw new Error("A sessão dos anexos foi encerrada.");
      }
    };
    const tokenProvider = async scopes => {
      assertCurrentSession();
      try {
        return await auth.getToken(scopes);
      } catch (error) {
        if (error?.code !== "AUTH_REQUIRED" || typeof auth.authorize !== "function") throw error;
        if (!pendingProvisionSharePointAuthorization) {
          const authorization = Promise.resolve(auth.authorize(scopes)).finally(() => {
            if (pendingProvisionSharePointAuthorization === authorization) {
              pendingProvisionSharePointAuthorization = null;
            }
          });
          pendingProvisionSharePointAuthorization = authorization;
        }
        await pendingProvisionSharePointAuthorization;
        assertCurrentSession();
        return auth.getToken(scopes);
      }
    };
    const request = Promise.resolve().then(() => pendingProvisionAttachmentsDataFactory({ tokenProvider })).then(data => {
      if (typeof data?.listAttachments !== "function" || typeof data?.downloadAttachment !== "function") {
        throw new Error("A consulta autenticada dos anexos não está disponível.");
      }
      return data;
    });
    pendingProvisionAttachmentsDataRequest = request;
    pendingProvisionAttachmentsDataRequestAccount = targetAccount;
    try {
      const data = await request;
      assertCurrentSession();
      pendingProvisionAttachmentsData = data;
      pendingProvisionAttachmentsAccount = targetAccount;
      return data;
    } catch (error) {
      if (pendingProvisionAttachmentsDataRequest === request) {
        pendingProvisionAttachmentsDataRequest = null;
        pendingProvisionAttachmentsDataRequestAccount = null;
      }
      throw error;
    }
  }

  async function loadPendingProvisionAttachmentList(paymentId, context) {
    const id = String(paymentId || "").trim();
    if (!id || !pendingProvisionAttachmentLoadIsCurrent(context)) return false;
    const current = pendingProvisionAttachmentStates.get(id);
    setPendingProvisionAttachmentState(id, { ...current, status: "loading", error: "", actionError: "" });
    render();
    try {
      const data = await getPendingProvisionAttachmentsData(context.targetAccount, context.targetRevision);
      const items = await data.listAttachments(id);
      if (!pendingProvisionAttachmentLoadIsCurrent(context)) return false;
      const safeItems = (Array.isArray(items) ? items : []).filter(item => item?.fileName);
      setPendingProvisionAttachmentState(id, {
        status: safeItems.length ? "available" : "empty",
        items: safeItems,
        error: "",
        actionError: "",
      });
      render();
      return true;
    } catch {
      if (!pendingProvisionAttachmentLoadIsCurrent(context)) return false;
      setPendingProvisionAttachmentState(id, {
        status: "error",
        items: [],
        error: "Não foi possível consultar os anexos. Toque na seta para tentar novamente.",
        actionError: "",
      });
      render();
      return false;
    }
  }

  function beginPendingProvisionAttachmentDiscovery(snapshot) {
    clearPendingProvisionAttachmentState();
    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    const context = {
      targetAccount: account,
      targetRevision: sessionRevision,
      generation: pendingProvisionAttachmentGeneration,
      snapshot,
    };
    for (const row of rows) {
      const id = String(row?.id ?? "").trim();
      if (id) setPendingProvisionAttachmentState(id, { status: "loading", items: [], error: "", actionError: "" });
    }
    render();
    if (!rows.length) return;
    let cursor = 0;
    const workers = Array.from({
      length: Math.min(PENDING_PROVISION_ATTACHMENT_CONCURRENCY, rows.length),
    }, async () => {
      while (cursor < rows.length && pendingProvisionAttachmentLoadIsCurrent(context)) {
        const row = rows[cursor++];
        const id = String(row?.id ?? "").trim();
        if (id) await loadPendingProvisionAttachmentList(id, context);
      }
    });
    void Promise.all(workers);
  }

  function attachmentReminderDetails() {
    const attachments = store.getState().attachments;
    if (!account || stopped || !Array.isArray(attachments) || !attachments.length) return null;
    return { title: FLOW_REMINDER_TITLE, body: ATTACHMENT_REMINDER_BODY };
  }

  function notifyAttachmentReminder(details) {
    if (typeof globalThis.Notification !== "function"
      || globalThis.Notification.permission !== "granted") return false;
    try {
      new globalThis.Notification(details.title, {
        body: details.body,
        tag: "energetico-attachment-without-posting",
      });
      return true;
    } catch {
      return false;
    }
  }

  function cancelAttachmentReminder() {
    attachmentReminderRevision += 1;
    if (attachmentReminderTimer !== null) clearTimeout(attachmentReminderTimer);
    attachmentReminderTimer = null;
    void native.cancelAttachmentReminder?.();
  }

  function scheduleAttachmentReminder() {
    cancelAttachmentReminder();
    const details = attachmentReminderDetails();
    if (!details) return;
    const revision = attachmentReminderRevision;
    const schedule = native.scheduleAttachmentReminder?.({
      ...details,
      delayMs: ATTACHMENT_REMINDER_DELAY_MS,
    });
    Promise.resolve(schedule).then(scheduled => {
      if (stopped || revision !== attachmentReminderRevision || !attachmentReminderDetails()) {
        if (scheduled) void native.cancelAttachmentReminder?.();
        return;
      }
      if (scheduled) return;
      attachmentReminderTimer = reminderTimeout(() => {
        attachmentReminderTimer = null;
        if (stopped || revision !== attachmentReminderRevision || !attachmentReminderDetails()) return;
        notifyAttachmentReminder(details);
      }, ATTACHMENT_REMINDER_DELAY_MS);
    }).catch(() => {
      if (stopped || revision !== attachmentReminderRevision || !attachmentReminderDetails()) return;
      attachmentReminderTimer = reminderTimeout(() => {
        attachmentReminderTimer = null;
        if (stopped || revision !== attachmentReminderRevision || !attachmentReminderDetails()) return;
        notifyAttachmentReminder(details);
      }, ATTACHMENT_REMINDER_DELAY_MS);
    });
  }

  function handleBackground() {
    // A WebView may be backgrounded without delivering the final pointerup.
    // Stop only the live canvas interaction so returning to the app cannot
    // append background coordinates to the previous signature stroke.
    view.pauseSignaturePad?.();
    if (attachmentReminderDetails()) scheduleAttachmentReminder();
    else cancelAttachmentReminder();
    const details = flowReminderDetails();
    if (!details) return;
    cancelFlowReminder();
    const revision = flowReminderRevision;
    const schedule = native.scheduleFlowReminder?.({
      ...details,
      delayMs: FLOW_REMINDER_DELAY_MS,
    });
    Promise.resolve(schedule).then(scheduled => {
      if (stopped || revision !== flowReminderRevision || !flowReminderDetails()) {
        if (scheduled) void native.cancelFlowReminder?.();
        return;
      }
      if (scheduled) return;
      flowReminderTimer = reminderTimeout(() => {
        flowReminderTimer = null;
        if (stopped || revision !== flowReminderRevision || !flowReminderDetails()) return;
        notifyFlowReminder(details);
      }, FLOW_REMINDER_DELAY_MS);
    }).catch(() => {
      if (stopped || revision !== flowReminderRevision || !flowReminderDetails()) return;
      flowReminderTimer = reminderTimeout(() => {
        flowReminderTimer = null;
        if (stopped || revision !== flowReminderRevision || !flowReminderDetails()) return;
        notifyFlowReminder(details);
      }, FLOW_REMINDER_DELAY_MS);
    });
  }

  async function handleForeground() {
    armFlowReminder();
    if (attachmentReminderDetails()) scheduleAttachmentReminder();
    else cancelAttachmentReminder();
    await Promise.all([refreshPendingProvisionSnapshot(), refreshDelegatedTasksSnapshot()]);
    return true;
  }

  function pendingProvisionReminderSuppressed() {
    if (pendingProvisionSessionDismissed) return true;
    const saved = readPendingProvisionReminder(account);
    if (!saved) return false;
    if (saved.mode === "always") return false;
    if (saved.mode === "today") return saved.date === localDateIso();
    const until = Number(saved.until);
    return Number.isFinite(until) && until > Date.now();
  }

  function cancelScheduledPendingProvisionReminder() {
    pendingProvisionReminderRevision += 1;
    if (pendingProvisionReminderTimer !== null) clearTimeout(pendingProvisionReminderTimer);
    pendingProvisionReminderTimer = null;
    void native.cancelProvisionReminder?.();
  }

  function schedulePendingProvisionReminder(delayMs) {
    pendingProvisionReminderRevision += 1;
    const revision = pendingProvisionReminderRevision;
    if (pendingProvisionReminderTimer !== null) clearTimeout(pendingProvisionReminderTimer);
    pendingProvisionReminderTimer = reminderTimeout(() => {
      pendingProvisionReminderTimer = null;
      if (stopped || revision !== pendingProvisionReminderRevision || !account) return;
      void refreshPendingProvisionSnapshot();
    }, delayMs);
    const details = {
      title: FLOW_REMINDER_TITLE,
      body: "Há provisões de pagamento vencidas ou com vencimento hoje.",
      delayMs,
    };
    const schedule = native.scheduleProvisionReminder?.(details);
    if (schedule !== undefined) void Promise.resolve(schedule).catch(() => {});
  }

  async function refreshPendingProvisionSnapshot() {
    if (!account || stopped || typeof client.getPendingProvisionSnapshot !== "function") return false;
    if (pendingProvisionReminderOpen || pendingProvisionSnapshot) return true;
    if (pendingProvisionSessionDismissed) return false;
    if (pendingProvisionRequest) return pendingProvisionRequest;
    const snapshotAccount = account;
    const snapshotRevision = sessionRevision;
    pendingProvisionRequest = Promise.resolve().then(async () => {
      try {
        const snapshot = await client.getPendingProvisionSnapshot();
        if (stopped || account !== snapshotAccount || sessionRevision !== snapshotRevision) return false;
        const due = snapshot?.due === true && Array.isArray(snapshot.rows) && snapshot.rows.length > 0;
        if (!due) {
          cancelScheduledPendingProvisionReminder();
          pendingProvisionSnapshot = null;
          pendingProvisionReminderOpen = false;
          pendingProvisionReminderError = "";
          clearPendingProvisionAttachmentState();
          render();
          return false;
        }
        if (!pendingProvisionReminderSuppressed()) {
          cancelScheduledPendingProvisionReminder();
          pendingProvisionSnapshot = snapshot;
          pendingProvisionReminderOpen = false;
          pendingProvisionReminderError = "";
          beginPendingProvisionAttachmentDiscovery(snapshot);
        }
        return due;
      } catch {
        // A temporary network failure must not hide the normal chat. The next
        // foreground event retries the read-only check.
        return false;
      } finally {
        pendingProvisionRequest = null;
      }
    });
    return pendingProvisionRequest;
  }

  async function refreshPendingNotesSnapshot() {
    if (!account || stopped || typeof client.getPendingNotesSnapshot !== "function") return false;
    const snapshotAccount = account;
    const snapshotRevision = sessionRevision;
    try {
      const snapshot = await client.getPendingNotesSnapshot();
      if (stopped || account !== snapshotAccount || sessionRevision !== snapshotRevision) return false;
      if (!pendingNotesSessionDismissed && Array.isArray(snapshot?.rows) && snapshot.rows.length) {
        pendingNotesSnapshot = snapshot;
        render();
      }
      return true;
    } catch {
      return false;
    }
  }

  function dismissPendingNotes() {
    pendingNotesSessionDismissed = true;
    pendingNotesSnapshot = null;
    pendingNoteLaunchProgress = null;
    pendingNoteLaunchNeedsResync = false;
    pendingNoteLaunchFailed = false;
    render();
    return true;
  }

  async function refreshDelegatedTasksSnapshot() {
    if (!account || stopped || typeof client.getDelegatedTasks !== "function") return false;
    if (delegatedTasksRequest) return delegatedTasksRequest;
    const snapshotAccount = account;
    const snapshotRevision = sessionRevision;
    delegatedTasksRequest = Promise.resolve().then(async () => {
      try {
        const snapshot = normalizeDelegatedTasks(await client.getDelegatedTasks(), snapshotAccount);
        if (stopped || account !== snapshotAccount || sessionRevision !== snapshotRevision) return false;
        delegatedTasksSnapshot = snapshot;
        render();
        return Boolean(snapshot?.rows?.length);
      } catch {
        return false;
      } finally {
        delegatedTasksRequest = null;
      }
    });
    return delegatedTasksRequest;
  }

  async function completeDelegatedTask(taskId) {
    if (flowBusy() || typeof client.completeDelegatedTask !== "function") return false;
    const id = String(taskId || "").trim();
    if (!/^\d+$/.test(id)) return false;
    try {
      const result = await client.completeDelegatedTask(id);
      if (result?.delegatedTasks) delegatedTasksSnapshot = normalizeDelegatedTasks(result.delegatedTasks, account);
      else await refreshDelegatedTasksSnapshot();
      render();
      return true;
    } catch (error) {
      setSessionError(error, "Não foi possível concluir a tarefa delegada.");
      return false;
    }
  }

  function reorderDelegatedTasks(order) {
    if (!account || !delegatedTasksSnapshot || !Array.isArray(order)) return false;
    const ids = order.map(item => String(item || "").trim()).filter(Boolean);
    const byId = new Map(delegatedTasksSnapshot.rows.map(row => [String(row.id), row]));
    const rows = [...ids.map(id => byId.get(id)).filter(Boolean), ...delegatedTasksSnapshot.rows.filter(row => !ids.includes(String(row.id)))];
    delegatedTasksSnapshot = { ...delegatedTasksSnapshot, rows };
    writeDelegatedTaskOrder(account, rows.map(row => row.id));
    render();
    return true;
  }

  function closePendingProvisions() {
    if (!pendingProvisionSnapshot) return false;
    pendingProvisionReminderOpen = true;
    pendingProvisionReminderError = "";
    render();
    return true;
  }

  function dismissPendingProvisions() {
    if (!pendingProvisionSnapshot) return false;
    pendingProvisionSessionDismissed = true;
    pendingProvisionSnapshot = null;
    pendingProvisionReminderOpen = false;
    pendingProvisionReminderError = "";
    clearPendingProvisionAttachmentState();
    render();
    return true;
  }

  function cancelPendingProvisionReminderChoice() {
    if (!pendingProvisionSnapshot) return false;
    pendingProvisionReminderOpen = false;
    pendingProvisionReminderError = "";
    render();
    return true;
  }

  function choosePendingProvisionReminder(value) {
    if (!pendingProvisionSnapshot) return false;
    const choice = String(value || "").trim().toLowerCase();
    let saved;
    let delayMs = 0;
    if (choice === "always") {
      saved = { mode: "always" };
      pendingProvisionSessionDismissed = true;
    } else if (choice === "2h") {
      delayMs = 2 * 60 * 60 * 1000;
      saved = { mode: "hours", until: Date.now() + delayMs };
    } else if (choice === "today") {
      saved = { mode: "today", date: localDateIso() };
    } else {
      const hours = Number.parseFloat(String(value || "").replace(",", "."));
      if (!Number.isFinite(hours) || hours <= 0 || hours > 8760) {
        pendingProvisionReminderError = "Informe um número de horas entre 0,1 e 8760.";
        render();
        return false;
      }
      delayMs = Math.round(hours * 60 * 60 * 1000);
      saved = { mode: "hours", until: Date.now() + delayMs };
    }
    writePendingProvisionReminder(account, saved);
    if (delayMs) schedulePendingProvisionReminder(delayMs);
    else cancelScheduledPendingProvisionReminder();
    pendingProvisionSnapshot = null;
    pendingProvisionReminderOpen = false;
    pendingProvisionReminderError = "";
    clearPendingProvisionAttachmentState();
    render();
    return true;
  }

  function latestAssistantPoll(messages = store.getState().messages) {
    const current = [...(Array.isArray(messages) ? messages : [])].reverse().find(message => message?.role !== "user");
    return current?.type === "poll" && Array.isArray(current.options) ? current : null;
  }

  function rememberCurrentAssistantPoll(result, messages = result?.messages) {
    const poll = latestAssistantPoll(messages);
    if (!poll) {
      currentAssistantPollSnapshot = null;
      return;
    }
    const activeFlow = Object.hasOwn(result || {}, "activeFlow")
      ? result.activeFlow
      : result?.resetConversation === true ? null : store.getState().activeFlow;
    currentAssistantPollSnapshot = { poll, activeFlow };
  }

  function normalizedSettlementText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleUpperCase("pt-BR")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isScheduledSettlementFlow(activeFlow) {
    const signature = normalizedSettlementText([activeFlow?.id, activeFlow?.title].filter(Boolean).join(" "));
    return /SCHEDULED.{0,20}PAYMENT|PAYMENT.{0,20}SETTLEMENT|SETTLE.{0,20}PAYMENT/.test(signature)
      || /BAIXAR.{0,20}PAGAMENTO|PAGAMENTO.{0,20}AGENDADO/.test(signature);
  }

  function hasScheduledPaymentSelectionQuestion(poll) {
    const question = normalizedSettlementText(poll?.question || poll?.prompt || poll?.text);
    return /PAGAMENTO/.test(question)
      && /AGENDADO|PREVISTO/.test(question)
      && /QUAL|SELECIONE|ESCOLHA/.test(question)
      && /PAGO|BAIXA|BAIXAR/.test(question);
  }

  function isScheduledPaymentSelection(poll, activeFlow) {
    return isScheduledSettlementFlow(activeFlow) && hasScheduledPaymentSelectionQuestion(poll);
  }

  function currentAssistantPoll() {
    const snapshot = currentAssistantPollSnapshot;
    if (!snapshot) return null;
    if (hasScheduledPaymentSelectionQuestion(snapshot.poll)
      && !isScheduledSettlementFlow(snapshot.activeFlow)) return null;
    return snapshot.poll;
  }

  function currentAssistantActiveFlow() {
    return currentAssistantPollSnapshot?.activeFlow ?? store.getState().activeFlow;
  }

  function isSettlementQuantityQuestion(poll) {
    return /\bQTD\b|QUANTIDADE/.test(normalizedSettlementText(poll?.question || poll?.prompt || poll?.text));
  }

  function scheduledSettlementEntry(poll) {
    const matches = (Array.isArray(poll?.options) ? poll.options : []).filter(option => {
      const label = normalizedSettlementText([option?.label, option?.title, option?.text].filter(Boolean).join(" "));
      const reference = normalizedSettlementText([option?.reply, option?.id].filter(Boolean).join(" "));
      const hasAction = /BAIXAR|DAR BAIXA|CONFIRMAR BAIXA|REGISTRAR BAIXA/.test(label)
        || /SETTLE|PAYMENT_SETTLEMENT|BAIXAR_PAGAMENTO/.test(reference);
      return hasAction
        && /PAGAMENTO|PGTO|PAGTO/.test(`${label} ${reference}`)
        && /AGENDADO|PREVISTO/.test(`${label} ${reference}`);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function pendingGroupOption(poll) {
    const matches = (Array.isArray(poll?.options) ? poll.options : []).filter(option => {
      const reference = String(option?.reply || option?.id || "").trim().toLocaleLowerCase("pt-BR");
      const label = normalizedSettlementText([option?.label, option?.title, option?.text].filter(Boolean).join(" "));
      return reference === "group_pending" || /(^|\s)PENDENCIAS(?:\s*\(\d+\))?(\s|$)/.test(label);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function pendingProvisionsOption(poll) {
    const matches = (Array.isArray(poll?.options) ? poll.options : []).filter(option =>
      String(option?.reply || option?.id || "").trim().toLowerCase() === "pending_payment_provisions");
    return matches.length === 1 ? matches[0] : null;
  }

  function isPortalGroupMenu(poll, activeFlow) {
    const flowId = String(activeFlow?.id || "").trim().toLocaleLowerCase("pt-BR");
    const question = normalizedSettlementText(poll?.question || poll?.prompt || poll?.text);
    return /^group_[a-z0-9_]+$/.test(flowId)
      || /QUAL AREA VOCE DESEJA ACESSAR/.test(question)
      || /QUAL FLUXO VOCE DESEJA INICIAR/.test(question)
      || (Array.isArray(poll?.options) && poll.options.some(option => /^group_[a-z0-9_]+$/i.test(String(option?.reply || option?.id || "").trim())));
  }

  function isSuppliesFlowMenu(poll, activeFlow) {
    const flowId = String(activeFlow?.id || "").trim().toLocaleLowerCase("pt-BR");
    const question = normalizedSettlementText(poll?.question || poll?.prompt || poll?.text);
    return flowId === "group_supplies"
      || /SUPRIMENTOS.*QUAL FLUXO VOCE DESEJA INICIAR/.test(question);
  }

  function isPaymentProvisionAttachmentFlow(poll, activeFlow) {
    const context = normalizedSettlementText([
      activeFlow?.id, activeFlow?.title, poll?.question, poll?.prompt, poll?.text,
    ].filter(Boolean).join(" "));
    return /ADICIONAR.{0,40}ANEXOS?.{0,60}PROVISAO.{0,25}PAGAMENTO/.test(context)
      || /PROVISAO.{0,25}PAGAMENTO.{0,60}ADICIONAR.{0,30}ANEXOS?/.test(context);
  }

  function isDraftExitConfirmation(poll) {
    const options = Array.isArray(poll?.options) ? poll.options : [];
    return options.some(option => /^portal_draft_exit_(?:save|discard)$/i.test(String(option?.reply || option?.id || "").trim()))
      || /RASCUNHO.*MENU PRINCIPAL/.test(normalizedSettlementText(poll?.question || poll?.prompt || poll?.text));
  }

  function scheduledPaymentOption(poll, paymentId) {
    const id = String(paymentId || "").trim();
    if (!/^\d+$/.test(id)) return null;
    const matches = (Array.isArray(poll?.options) ? poll.options : []).filter(option => {
      const directValues = [option?.paymentId, option?.payment_id, option?.reply, option?.id]
        .map(value => String(value ?? "").trim());
      if (directValues.includes(id)) return true;
      if (directValues.some(value => new RegExp(`^(?:scheduled[_-]?payment|payment|provision|pending[_-]?provision)[:_-]${id}$`, "i").test(value))) return true;
      const label = String(option?.label || option?.title || option?.text || "").trim();
      return new RegExp(`^#?${id}\\s*(?:[-–—:])`).test(label);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function pendingNoteOption(poll, replyId) {
    const options = (Array.isArray(poll?.options) ? poll.options : []).filter(option =>
      String(option?.reply || option?.id || "").trim() === replyId);
    return options.length === 1 ? options[0] : null;
  }

  function isPendingNoteOrderQuestion(poll) {
    return /QUAL E O PEDIDO EXISTENTE/.test(normalizedSettlementText(poll?.question || poll?.prompt || poll?.text));
  }

  function isPendingNoteDateQuestion(poll) {
    return /DATA DE PAGAMENTO PREVISTO/.test(normalizedSettlementText(poll?.question || poll?.prompt || poll?.text));
  }

  function isSelectedPendingNoteOrder(activeFlow, orderId) {
    if (activeFlow?.id !== "launch" || !Array.isArray(activeFlow.rows)) return false;
    const rows = label => activeFlow.rows.filter(row => normalizedSettlementText(row?.label) === label);
    const type = rows("TIPO DE PEDIDO");
    const selected = rows("ID DO PEDIDO EXISTENTE");
    return type.length === 1 && normalizedSettlementText(type[0].value) === "PEDIDO EXISTENTE"
      && selected.length === 1 && String(selected[0].value ?? "").trim() === orderId;
  }

  async function launchPendingNote(orderId) {
    const id = String(orderId || "").trim();
    if (!/^\d+$/.test(id) || !account || stopped || flowBusy() || pendingNoteLaunchOrderId
      || !pendingNotesSnapshot?.rows?.some(row => String(row?.id ?? "").trim() === id)) return false;
    const targetAccount = account;
    const targetRevision = sessionRevision;
    const progress = pendingNoteLaunchProgress?.orderId === id
      && pendingNoteLaunchProgress.account === targetAccount
      && pendingNoteLaunchProgress.revision === targetRevision
      ? pendingNoteLaunchProgress
      : { orderId: id, account: targetAccount, revision: targetRevision,
        launchedByPopup: false, existingOrderAttempted: false, modalityAttempted: false,
        orderAttempted: false, orderPromptContextId: "" };
    pendingNoteLaunchProgress = progress;
    const currentAttempt = () => pendingNoteLaunchProgress === progress
      && account === targetAccount && sessionRevision === targetRevision && !stopped;
    pendingNoteLaunchOrderId = id;
    pendingNoteLaunchFailed = false;
    render();
    let succeeded = false;
    const advance = async (option, stageName, onRequest) => {
      if (!currentAttempt()) return false;
      if (!option) {
        setSessionError(new Error(`A VM não mostrou ${stageName}. O popup permanece aberto para tentar novamente.`));
        return false;
      }
      const sent = await sendSettlementReply(
        String(option.label || option.title || option.text || option.id || ""),
        String(option.reply || option.id || ""), targetAccount, targetRevision, onRequest, currentAttempt,
      );
      if (!sent && currentAttempt()) {
        pendingNoteLaunchNeedsResync = true;
        if (!sessionError && !store.getState().error) {
          setSessionError(new Error(`Não foi possível avançar em ${stageName}. Retome a conversa e tente novamente.`));
        }
      }
      return sent;
    };
    try {
      let resynced = false;
      if (pendingNoteLaunchNeedsResync) {
        pendingNoteLaunchNeedsResync = false;
        if (!await continueConversation()) {
          if (currentAttempt()) pendingNoteLaunchNeedsResync = true;
          return false;
        }
        resynced = true;
      }
      if (!currentAttempt()) return false;
      let poll = currentAssistantPoll();
      const stages = [
        ["group_supplies", "o menu de áreas com Suprimentos"],
        ["action_supply_launches", "Lançamentos em Suprimentos"],
        ["action_launch", "Efetuar Lançamento no submenu de Suprimentos"],
        ["choice:pedido_lancamento:2", "Pedido Existente"],
        ["choice:tipo_lancamento:2", "Lançamento Múltiplo"],
      ];
      let stage = stages.findIndex(([reply]) => pendingNoteOption(poll, reply));
      if (currentAssistantActiveFlow()?.id === "launch" && stage >= 3
        && !progress.launchedByPopup && !progress.existingOrderAttempted) {
        // A launch already in progress belongs to a different action. The
        // popup must start its own Pedido Existente flow, not inherit it.
        stage = -1;
      }
      if (isPendingNoteDateQuestion(poll) && currentAssistantActiveFlow()?.id === "launch"
        && !progress.orderAttempted) stage = -1;
      else if (isPendingNoteDateQuestion(poll) && currentAssistantActiveFlow()?.id === "launch") {
        const contextId = String(currentAssistantActiveFlow()?.contextId || "");
        if (resynced && progress.orderAttempted && progress.orderPromptContextId
          && contextId && contextId !== progress.orderPromptContextId
          && isSelectedPendingNoteOrder(currentAssistantActiveFlow(), id)) {
          succeeded = true;
          dismissPendingNotes();
          return true;
        }
        setSessionError(new Error(`A pergunta de data atual não comprova a seleção do pedido ${id} por este atalho. O popup permanece aberto.`));
        return false;
      }
      if (stage < 0 && isPendingNoteOrderQuestion(poll) && currentAssistantActiveFlow()?.id === "launch") {
        stage = stages.length;
      }
      if (stage >= 4 && (!progress.existingOrderAttempted
        || (stage >= 5 && !progress.modalityAttempted))) {
        setSessionError(new Error("O lançamento em andamento não foi iniciado como Pedido Existente por este atalho. Conclua ou saia desse fluxo antes de tentar novamente."));
        return false;
      }
      if (stage < 0) {
        const diaryActive = /^construction_diary_(?:create|fill)$/.test(String(currentAssistantActiveFlow()?.id || ""));
        if (!await advance(diaryActive
          ? { reply: "abandon_construction_diary", label: "ABANDONAR DIÁRIO DE OBRAS" }
          : { reply: PORTAL_MAIN_MENU_CONFIRM_ID, label: "" }, "a saída do fluxo anterior")) return false;
        poll = currentAssistantPoll();
        if (isDraftExitConfirmation(poll)) {
          if (!await advance(pendingNoteOption(poll, "portal_draft_exit_discard"), "a saída sem salvar do fluxo anterior")) return false;
          poll = currentAssistantPoll();
        }
        if (pendingNoteOption(poll, "diary_partial_save_no")) {
          if (!await advance(pendingNoteOption(poll, "diary_partial_save_no"), "a saída do diário sem postar")) return false;
          poll = currentAssistantPoll();
        }
        if (!isPortalGroupMenu(poll, currentAssistantActiveFlow())) {
          setSessionError(new Error("A VM não confirmou a saída do fluxo anterior. O popup permanece aberto."));
          return false;
        }
        stage = 0;
      }
      for (let index = stage; index < stages.length; index++) {
        const [reply, name] = stages[index];
        const option = pendingNoteOption(poll, reply);
        const onRequest = index === 2 ? () => { progress.launchedByPopup = true; }
          : index === 3 ? () => { progress.existingOrderAttempted = true; }
          : index === 4 ? () => { progress.modalityAttempted = true; } : undefined;
        if (!await advance(option, name, onRequest)) return false;
        if (!currentAttempt()) return false;
        poll = currentAssistantPoll();
      }
      if (!isPendingNoteOrderQuestion(poll)) {
        setSessionError(new Error("A VM não mostrou a seleção do pedido existente. O popup permanece aberto para tentar novamente."));
        return false;
      }
      const order = pendingNoteOption(poll, `choice:pedido_existente_lancamento:${id}`);
      progress.orderPromptContextId = String(currentAssistantActiveFlow()?.contextId || "");
      if (!progress.orderPromptContextId) {
        setSessionError(new Error("A VM não identificou o contexto do pedido existente. O popup permanece aberto."));
        return false;
      }
      const markOrderRequest = () => { progress.orderAttempted = true; };
      const selected = order
        ? await advance(order, `o pedido ${id}`, markOrderRequest)
        : await sendSettlementReply(id, undefined, targetAccount, targetRevision, markOrderRequest, currentAttempt);
      if (!selected) {
        if (!currentAttempt()) return false;
        pendingNoteLaunchNeedsResync = true;
        if (!sessionError && !store.getState().error) {
          setSessionError(new Error(`Não foi possível selecionar o pedido ${id}. Retome a conversa e tente novamente.`));
        }
        return false;
      }
      if (!currentAttempt()) return false;
      poll = currentAssistantPoll();
      if (!isPendingNoteDateQuestion(poll) || currentAssistantActiveFlow()?.id !== "launch"
        || !currentAssistantActiveFlow()?.contextId
        || currentAssistantActiveFlow().contextId === progress.orderPromptContextId) {
        setSessionError(new Error(isPendingNoteOrderQuestion(poll)
          ? `O pedido ${id} não foi encontrado pela VM. Confira a lista e tente novamente.`
          : `A VM recebeu o pedido ${id}, mas não mostrou a pergunta de data. Confira a etapa atual.`));
        return false;
      }
      if (!isSelectedPendingNoteOrder(currentAssistantActiveFlow(), id)) {
        setSessionError(new Error(`A VM não confirmou a seleção do pedido ${id}. O popup permanece aberto para conferir a etapa atual.`));
        return false;
      }
      succeeded = true;
      dismissPendingNotes();
      return true;
    } catch (error) {
      if (currentAttempt()) {
        setSessionError(error, `Não foi possível iniciar o lançamento do pedido ${id}.`);
      }
      return false;
    } finally {
      if (account === targetAccount && sessionRevision === targetRevision) {
        if (pendingNoteLaunchProgress === progress) pendingNoteLaunchFailed = !succeeded;
        pendingNoteLaunchOrderId = "";
        if (!stopped) render();
      }
    }
  }

  function hidePendingProvisionsForSettlement() {
    pendingProvisionSnapshot = null;
    pendingProvisionReminderOpen = false;
    pendingProvisionReminderError = "";
    clearPendingProvisionAttachmentState();
    render();
  }

  async function sendSettlementReply(text, replyId, targetAccount, targetRevision, onRequest, isCurrent) {
    const sent = await sendText(text, replyId, { onRequest, isCurrent });
    if (!sent || stopped || account !== targetAccount || sessionRevision !== targetRevision) return false;
    const transitioned = await waitForResponseTransition();
    return transitioned && !stopped && account === targetAccount && sessionRevision === targetRevision;
  }

  async function enterScheduledPaymentSelection(poll, targetAccount, targetRevision) {
    if (isScheduledPaymentSelection(poll, currentAssistantActiveFlow())) return poll;

    const activeFlow = currentAssistantActiveFlow();
    const restartFromMainMenu = isSuppliesFlowMenu(poll, activeFlow);
    let entry = restartFromMainMenu ? null : scheduledSettlementEntry(poll);
    let provisionsOption = restartFromMainMenu ? null : pendingProvisionsOption(poll);
    if (!entry && !provisionsOption) {
      let pendingOption = restartFromMainMenu ? null : pendingGroupOption(poll);
      if (!pendingOption) {
        const diaryActive = /^construction_diary_(?:create|fill)$/.test(String(activeFlow?.id || ""));
        const returned = await sendSettlementReply(
          diaryActive ? "ABANDONAR DIÁRIO DE OBRAS" : "",
          diaryActive ? "abandon_construction_diary" : PORTAL_MAIN_MENU_CONFIRM_ID,
          targetAccount, targetRevision,
        );
        if (!returned) return null;
        poll = currentAssistantPoll();
        if (isDraftExitConfirmation(poll)) {
          const discard = pendingNoteOption(poll, "portal_draft_exit_discard");
          if (!discard || !await sendSettlementReply(
            String(discard.label || discard.title || "ELIMINAR RASCUNHO FORMULÁRIO"),
            String(discard.reply || discard.id), targetAccount, targetRevision,
          )) return null;
          poll = currentAssistantPoll();
        }
        const diaryExit = pendingNoteOption(poll, "diary_partial_save_no");
        if (diaryExit) {
          if (!await sendSettlementReply(
            String(diaryExit.label || diaryExit.title || "SAIR SEM POSTAR AGORA"),
            String(diaryExit.reply || diaryExit.id), targetAccount, targetRevision,
          )) return null;
          poll = currentAssistantPoll();
        }
        if (!isPortalGroupMenu(poll, currentAssistantActiveFlow())) {
          setSessionError(new Error("A VM não confirmou a saída do fluxo anterior. A baixa não foi iniciada."));
          return null;
        }
        pendingOption = pendingGroupOption(poll);
      }
      if (!pendingOption) {
        setSessionError(new Error("Não consegui abrir Pendências pelo menu atual. Seus dados foram preservados; volte a Pendências e tente novamente."));
        return null;
      }

      const openedPending = await sendSettlementReply(
        String(pendingOption.label || pendingOption.title || "PENDÊNCIAS"),
        String(pendingOption.reply || pendingOption.id || "group_pending"),
        targetAccount,
        targetRevision,
      );
      if (!openedPending) return null;
      poll = currentAssistantPoll();
      entry = scheduledSettlementEntry(poll);
      provisionsOption = pendingProvisionsOption(poll);
    }

    if (!entry && provisionsOption) {
      const openedProvisions = await sendSettlementReply(
        String(provisionsOption.label || provisionsOption.title || "PROVISÕES PGTO PENDENTES"),
        String(provisionsOption.reply || provisionsOption.id || "pending_payment_provisions"),
        targetAccount,
        targetRevision,
      );
      if (!openedProvisions) return null;
      poll = currentAssistantPoll();
      entry = scheduledSettlementEntry(poll);
    }

    if (!entry) {
      setSessionError(new Error("A VM não mostrou a opção de baixa de pagamento agendado em Pendências. O fluxo foi preservado para você continuar."));
      return null;
    }
    const entered = await sendSettlementReply(
      String(entry.label || entry.title || "BAIXAR PAGAMENTO AGENDADO"),
      String(entry.reply || entry.id || ""),
      targetAccount,
      targetRevision,
    );
    if (!entered) return null;
    poll = currentAssistantPoll();
    if (!isScheduledPaymentSelection(poll, currentAssistantActiveFlow())) {
      setSessionError(new Error("A VM não abriu a seleção de pagamentos agendados. O fluxo foi preservado para você continuar."));
      return null;
    }
    return poll;
  }

  function editPendingProvisionDueDate(paymentId) {
    const id = String(paymentId || "").trim();
    const row = pendingProvisionSnapshot?.rows?.find(item => String(item?.id ?? "").trim() === id);
    if (!account || stopped || pendingProvisionReminderOpen || pendingProvisionDateEditBusy || !row || !id) return false;
    pendingProvisionDateEditPaymentId = id;
    pendingProvisionDateEditValue = pendingProvisionDateInputValue(row.dueDate);
    pendingProvisionDateEditError = "";
    render();
    return true;
  }

  function cancelPendingProvisionDateEdit() {
    if (!pendingProvisionDateEditPaymentId || pendingProvisionDateEditBusy) return false;
    pendingProvisionDateEditPaymentId = "";
    pendingProvisionDateEditValue = "";
    pendingProvisionDateEditError = "";
    render();
    return true;
  }

  async function savePendingProvisionDueDate(paymentId, rawValue) {
    const id = String(paymentId || "").trim();
    if (!account || stopped || pendingProvisionReminderOpen || pendingProvisionDateEditBusy
      || !id || id !== pendingProvisionDateEditPaymentId
      || !pendingProvisionSnapshot?.rows?.some(row => String(row?.id ?? "").trim() === id)) return false;
    const date = pendingProvisionDateIso(rawValue);
    if (!date) {
      pendingProvisionDateEditValue = String(rawValue || "").slice(0, 10);
      pendingProvisionDateEditError = "Digite uma data válida no formato DD/MM/AAAA.";
      render();
      return false;
    }
    const targetAccount = account;
    const targetRevision = sessionRevision;
    pendingProvisionDateEditBusy = true;
    pendingProvisionDateEditValue = pendingProvisionDateInputValue(date);
    pendingProvisionDateEditError = "";
    render();
    try {
      const data = await getPendingProvisionAttachmentsData(targetAccount, targetRevision);
      if (typeof data.updateDueDate !== "function") throw new Error("A edição da data não está disponível para esta provisão.");
      await data.updateDueDate(id, date);
      if (stopped || account !== targetAccount || sessionRevision !== targetRevision) return false;

      const updatedRows = (pendingProvisionSnapshot?.rows || []).flatMap(row => {
        if (String(row?.id ?? "").trim() !== id) return [row];
        if (date > localDateIso()) return [];
        return [{ ...row, dueDate: `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` }];
      });
      pendingProvisionDateEditPaymentId = "";
      pendingProvisionDateEditValue = "";
      pendingProvisionDateEditError = "";
      pendingProvisionDateEditBusy = false;
      if (updatedRows.length) {
        pendingProvisionSnapshot = { ...pendingProvisionSnapshot, due: true, count: updatedRows.length, rows: updatedRows };
        if (!updatedRows.some(row => String(row?.id ?? "").trim() === pendingProvisionExpandedPaymentId)) {
          pendingProvisionExpandedPaymentId = "";
        }
      } else {
        pendingProvisionSnapshot = null;
        pendingProvisionReminderOpen = false;
        clearPendingProvisionAttachmentState();
      }
      render();
      return true;
    } catch {
      if (stopped || account !== targetAccount || sessionRevision !== targetRevision) return false;
      pendingProvisionDateEditBusy = false;
      pendingProvisionDateEditError = "Não foi possível atualizar a data no SharePoint. Confira a conexão e tente novamente.";
      render();
      return false;
    }
  }

  async function pickPendingProvisionAttachments(paymentId) {
    const id = String(paymentId || "").trim();
    if (!account || stopped || pendingProvisionReminderOpen || !id
      || pendingProvisionExpandedPaymentId !== id
      || pendingProvisionAttachmentStates.get(id)?.status !== "available"
      || typeof native.pickDocuments !== "function") return false;
    const targetAccount = account;
    const targetRevision = sessionRevision;
    try {
      const picked = Array.from(await native.pickDocuments() || []);
      if (stopped || account !== targetAccount || sessionRevision !== targetRevision || !picked.length) return false;
      const attachmentNames = new Set((pendingProvisionAttachmentStates.get(id)?.items || [])
        .map(item => String(item.fileName || "").toLocaleLowerCase("pt-BR")));
      const current = pendingProvisionUploads.get(id) || { items: [], busy: false, error: "" };
      const queuedNames = new Set((current.items || []).map(item => String(item.file?.name || item.fileName || "").toLocaleLowerCase("pt-BR")));
      const additions = [];
      for (const file of picked) {
        const fileName = String(file?.name || "").trim();
        if (!fileName || typeof file?.arrayBuffer !== "function") continue;
        const key = fileName.toLocaleLowerCase("pt-BR");
        const conflict = attachmentNames.has(key) || queuedNames.has(key);
        additions.push({
          id: String(file.id || newUploadMessageId()),
          file,
          fileName,
          size: Number(file.size) || 0,
          status: conflict ? "conflict" : "ready",
          error: "",
        });
        queuedNames.add(key);
      }
      if (!additions.length) {
        setPendingProvisionUploads(id, { ...current, error: "Não foi possível ler os arquivos selecionados." });
        render();
        return false;
      }
      setPendingProvisionUploads(id, {
        ...current,
        items: [...(current.items || []), ...additions],
        error: additions.some(item => item.status === "conflict")
          ? "Um arquivo com esse nome já existe nesta provisão ou foi selecionado mais de uma vez. Remova ou renomeie o arquivo repetido."
          : "",
      });
      render();
      return true;
    } catch {
      if (!stopped && account === targetAccount && sessionRevision === targetRevision) {
        const current = pendingProvisionUploads.get(id) || { items: [], busy: false, error: "" };
        setPendingProvisionUploads(id, { ...current, error: "Não foi possível selecionar os anexos. Tente novamente." });
        render();
      }
      return false;
    }
  }

  function removePendingProvisionUpload(paymentId, uploadId) {
    const id = String(paymentId || "").trim();
    const current = pendingProvisionUploads.get(id);
    const selectedId = String(uploadId || "");
    if (!current || current.busy || !selectedId) return false;
    const items = current.items.filter(item => String(item.id || item.file?.id || item.fileName || "") !== selectedId);
    if (items.length === current.items.length) return false;
    if (items.length) setPendingProvisionUploads(id, { ...current, items, error: "" });
    else {
      pendingProvisionUploads.delete(id);
      pendingProvisionUploadsRevision += 1;
    }
    render();
    return true;
  }

  async function sendPendingProvisionAttachments(paymentId) {
    const id = String(paymentId || "").trim();
    const current = pendingProvisionUploads.get(id);
    const sendableItems = (current?.items || []).filter(item => item.status !== "conflict");
    if (!account || stopped || pendingProvisionReminderOpen || !id || !sendableItems.length || current.busy
      || pendingProvisionAttachmentStates.get(id)?.status !== "available") return false;
    const targetAccount = account;
    const targetRevision = sessionRevision;
    let items = [...current.items];
    setPendingProvisionUploads(id, { ...current, items, busy: true, error: "" });
    render();
    try {
      const data = await getPendingProvisionAttachmentsData(targetAccount, targetRevision);
      if (typeof data.uploadAttachment !== "function" || typeof data.listAttachments !== "function") {
        throw new Error("O envio de anexos para esta provisão não está disponível.");
      }
      const before = await data.listAttachments(id, { refresh: true });
      const beforeNames = new Set((before || []).map(item => String(item.fileName || "").toLocaleLowerCase("pt-BR")));
      const conflicts = new Set();
      for (const staged of [...sendableItems]) {
        if (stopped || account !== targetAccount || sessionRevision !== targetRevision) return false;
        const name = String(staged.file?.name || staged.fileName || "");
        const key = name.toLocaleLowerCase("pt-BR");
        if (beforeNames.has(key)) {
          if (staged.status === "error") {
            items = items.filter(item => item.file !== staged.file);
          } else {
            conflicts.add(key);
            items = items.map(item => item.file === staged.file ? { ...item, status: "conflict", error: "Já existe um anexo com esse nome." } : item);
          }
          setPendingProvisionUploads(id, { ...pendingProvisionUploads.get(id), items, busy: true });
          render();
          continue;
        }
        if (staged.status === "conflict") continue;
        items = items.map(item => item.file === staged.file ? { ...item, status: "uploading", error: "" } : item);
        setPendingProvisionUploads(id, { ...pendingProvisionUploads.get(id), items, busy: true });
        render();
        try {
          await data.uploadAttachment(id, staged.file);
          items = items.filter(item => item.file !== staged.file);
          setPendingProvisionUploads(id, { ...pendingProvisionUploads.get(id), items, busy: true });
          render();
        } catch {
          items = items.map(item => item.file === staged.file ? { ...item, status: "error", error: "O SharePoint não confirmou o envio." } : item);
          setPendingProvisionUploads(id, { ...pendingProvisionUploads.get(id), items, busy: true });
          render();
        }
      }
      if (stopped || account !== targetAccount || sessionRevision !== targetRevision) return false;
      const refreshed = await data.listAttachments(id, { refresh: true });
      if (stopped || account !== targetAccount || sessionRevision !== targetRevision) return false;
      const refreshedItems = (Array.isArray(refreshed) ? refreshed : []).filter(item => item?.fileName);
      const refreshedNames = new Set(refreshedItems.map(item => String(item.fileName).toLocaleLowerCase("pt-BR")));
      items = items.filter(item => !(item.status === "error"
        && refreshedNames.has(String(item.file?.name || item.fileName || "").toLocaleLowerCase("pt-BR"))
        && !beforeNames.has(String(item.file?.name || item.fileName || "").toLocaleLowerCase("pt-BR"))));
      setPendingProvisionAttachmentState(id, {
        status: refreshedItems.length ? "available" : "empty",
        items: refreshedItems,
        error: "",
        actionError: "",
      });
      setPendingProvisionUploads(id, {
        items,
        busy: false,
        error: items.length
          ? conflicts.size || items.some(item => item.status === "conflict")
            ? "Corrija os nomes repetidos e reenvie os arquivos restantes."
            : "Alguns anexos não foram confirmados; os arquivos restantes continuam na fila para nova tentativa."
          : "",
      });
      render();
      return items.length === 0;
    } catch {
      if (stopped || account !== targetAccount || sessionRevision !== targetRevision) return false;
      setPendingProvisionUploads(id, {
        ...pendingProvisionUploads.get(id),
        items: pendingProvisionUploads.get(id)?.items || items,
        busy: false,
        error: "Não foi possível concluir o envio. Os arquivos continuam na fila para nova tentativa.",
      });
      render();
      return false;
    }
  }

  async function settlePendingProvision(paymentId) {
    const id = String(paymentId || "").trim();
    if (!account || stopped || flowBusy() || pendingProvisionReminderOpen
      || pendingProvisionSettlementPaymentId || !id) return false;
    const row = pendingProvisionSnapshot?.rows?.find(item => String(item?.id ?? "").trim() === id);
    if (!row) return false;

    const targetAccount = account;
    const targetRevision = sessionRevision;
    pendingProvisionSettlementPaymentId = id;
    render();
    try {
      let poll = currentAssistantPoll();
      if (!isScheduledPaymentSelection(poll, currentAssistantActiveFlow())) {
        poll = await enterScheduledPaymentSelection(poll, targetAccount, targetRevision);
        if (!poll) return false;
      }

      const option = scheduledPaymentOption(poll, id);
      if (!option) {
        hidePendingProvisionsForSettlement();
        setSessionError(new Error(`Não encontrei o pagamento ${id} na lista da VM. O fluxo continua disponível para seleção manual.`));
        return false;
      }
      hidePendingProvisionsForSettlement();
      const selected = await sendSettlementReply(
        String(option.label || option.title || id),
        String(option.reply || option.id || id),
        targetAccount,
        targetRevision,
      );
      if (!selected) return false;
      const nextPoll = currentAssistantPoll();
      if (!isSettlementQuantityQuestion(nextPoll)) {
        setSessionError(new Error("A VM recebeu o pagamento selecionado, mas não apresentou a pergunta de quantidade esperada. Confira o fluxo antes de continuar."));
        return false;
      }
      return true;
    } finally {
      if (account === targetAccount && sessionRevision === targetRevision) {
        pendingProvisionSettlementPaymentId = "";
        if (!stopped) render();
      }
    }
  }

  function togglePendingProvisionAttachments(paymentId) {
    if (!pendingProvisionSnapshot || pendingProvisionReminderOpen) return false;
    const id = String(paymentId || "").trim();
    const entry = pendingProvisionAttachmentStates.get(id);
    if (!entry) return false;
    if (entry.status === "error") return retryPendingProvisionAttachments(id);
    if (entry.status !== "available" || !entry.items?.length) return false;
    pendingProvisionExpandedPaymentId = pendingProvisionExpandedPaymentId === id ? "" : id;
    render();
    return true;
  }

  function retryPendingProvisionAttachments(paymentId) {
    if (!pendingProvisionSnapshot || pendingProvisionReminderOpen) return false;
    const id = String(paymentId || "").trim();
    if (!id || pendingProvisionAttachmentStates.get(id)?.status !== "error") return false;
    const context = {
      targetAccount: account,
      targetRevision: sessionRevision,
      generation: pendingProvisionAttachmentGeneration,
      snapshot: pendingProvisionSnapshot,
    };
    void loadPendingProvisionAttachmentList(id, context);
    return true;
  }

  async function pendingProvisionAttachmentBlob(paymentId, attachment, targetAccount, targetRevision) {
    const data = await getPendingProvisionAttachmentsData(targetAccount, targetRevision);
    const payload = await data.downloadAttachment(paymentId, attachment.fileName);
    if (stopped || account !== targetAccount || sessionRevision !== targetRevision) return null;
    const mimeType = String(attachment.mimeType || "application/octet-stream");
    return payload instanceof Blob && payload.type === mimeType
      ? payload
      : new Blob([payload], { type: mimeType });
  }

  async function openPendingProvisionAttachment(paymentId, fileName) {
    if (!account || stopped || pendingProvisionReminderOpen) return false;
    const id = String(paymentId || "").trim();
    const name = String(fileName || "").trim();
    const entry = pendingProvisionAttachmentStates.get(id);
    const attachment = entry?.items?.find(item => item.fileName === name);
    if (!attachment) return false;
    const targetAccount = account;
    const targetRevision = sessionRevision;
    try {
      const blob = await pendingProvisionAttachmentBlob(id, attachment, targetAccount, targetRevision);
      if (!blob || stopped || account !== targetAccount) return false;
      await showMedia(blob, attachment.fileName);
      return true;
    } catch {
      if (!stopped && account === targetAccount) {
        setPendingProvisionAttachmentState(id, {
          ...entry,
          actionError: `Não foi possível abrir ${attachment.fileName}. Tente novamente.`,
        });
        render();
      }
      return false;
    }
  }

  async function sharePendingProvisionAttachment(paymentId, fileName) {
    if (!account || stopped || pendingProvisionReminderOpen || typeof native.exportMedia !== "function") return false;
    const id = String(paymentId || "").trim();
    const name = String(fileName || "").trim();
    const entry = pendingProvisionAttachmentStates.get(id);
    const attachment = entry?.items?.find(item => item.fileName === name);
    if (!attachment) return false;
    const targetAccount = account;
    const targetRevision = sessionRevision;
    try {
      const blob = await pendingProvisionAttachmentBlob(id, attachment, targetAccount, targetRevision);
      if (!blob || stopped || account !== targetAccount) return false;
      await native.exportMedia(blob, attachment.fileName);
      return true;
    } catch {
      if (!stopped && account === targetAccount) {
        setPendingProvisionAttachmentState(id, {
          ...entry,
          actionError: `Não foi possível encaminhar ${attachment.fileName}. Tente novamente.`,
        });
        render();
      }
      return false;
    }
  }

  function openRecovery() {
    recoveryAccountId = recovery && account?.homeAccountId || null;
    recoveryVerified = false;
    recoveryPreview = recoveryAccountId ? recovery.read(recoveryAccountId) : null;
    recoveryReference = recoveryPreview?.reference || null;
    olderReferences = recoveryPreview?.references || [];
    recoveryUncertain = false;
    draftEditRevision = 0;
  }

  function persistRecovery() {
    if (!recoveryAccountId || stopped) return;
    const state = store.getState();
    if (!recoveryVerified) {
      // Do not replace the saved preview with an empty/offline startup screen.
      if (draftEditRevision > 0) {
        const keepPreview = recoveryPreview?.draft && recoveryPreview.draft !== state.draft;
        const references = [recoveryReference, ...olderReferences].filter(Boolean);
        recovery.schedule(recoveryAccountId, {
          ...recoveryPreview, draft: state.draft,
          reference: keepPreview ? recoveryPreview : references[0] || null,
          references: keepPreview ? references : references.slice(1),
        });
      }
      return;
    }
    if (checkpointMessages !== state.messages) {
      checkpointMessages = state.messages;
      checkpointQuestion = currentQuestion(state.messages);
    }
    const resumableFlow = state.activeFlow && !isMenuFlow(state.activeFlow)
      ? state.activeFlow
      : null;
    const hasPendingFiles = state.pendingFiles.length > 0;
    const hasRecoveryContent = Boolean(
      resumableFlow
      || state.draft
      || state.activeText
      || hasPendingFiles
      || recoveryUncertain
      || recoveryReference
      || olderReferences.length
    );
    if (!hasRecoveryContent) {
      recovery.clear(recoveryAccountId);
      recoveryPreview = null;
      return;
    }
    recovery.schedule(recoveryAccountId, {
      activeFlow: resumableFlow, question: checkpointQuestion,
      draft: state.draft || state.activeText?.text || "",
      pendingNames: state.pendingFiles.map(item => item.file?.name || "arquivo"),
      uncertain: recoveryUncertain || Boolean(state.activeText) || state.pendingFiles.some(item => item.status === "sending"),
      reference: recoveryReference,
      references: olderReferences,
    });
  }

  function flushRecovery() {
    if (!recoveryAccountId || stopped) return;
    persistRecovery();
    if (recovery.flush() === false) {
      recoveryWarning = storageWarning;
      render();
    }
  }

  function reconcileRecovery(draftRevision, result = {}) {
    if (!recoveryAccountId || recoveryVerified) return;
    const saved = recoveryPreview;
    const state = store.getState();
    // A menu returned by the VM is already the current state and cannot be
    // resumed. Discard an older preview and its staged files instead of
    // promoting them to a recovery card every time the app opens.
    if (isMenuFlow(state.activeFlow) || isMenuResult(result)) {
      // The main menu is a terminal boundary for the previous flow. Always
      // discard its preview and attachment snapshot, even when the VM omits
      // the explicit reset/returned flags and there is no local preview.
      cancelAttachmentReminder();
      store.syncAttachments([]);
      recoveryVerified = true;
      recoveryPreview = null;
      recoveryReference = null;
      olderReferences = [];
      persistRecovery();
      return;
    }
    const sameContext = Boolean(saved?.activeFlow?.contextId
      && saved.activeFlow.contextId === state.activeFlow?.contextId);
    recoveryVerified = true;
    if (saved) {
      const sameQuestion = Boolean(saved.question && saved.question === currentQuestion(state.messages));
      const restore = sameContext && sameQuestion && !state.activeFlow?.paused && !saved.uncertain && !state.draft
        && draftRevision === draftEditRevision;
      if (saved.draft && restore) store.setDraft(saved.draft);
      if ((!restore && saved.draft) || saved.uncertain || saved.pendingNames?.length) {
        if (recoveryReference && (saved.draft !== recoveryReference.draft
          || saved.activeFlow?.contextId !== recoveryReference.activeFlow?.contextId)) {
          olderReferences = [recoveryReference, ...olderReferences];
        }
        recoveryReference = { ...saved, reference: null, references: [] };
      }
    }
    recoveryPreview = state.activeFlow ? {
      activeFlow: state.activeFlow, question: "", draft: "", pendingNames: [], status: "current",
    } : null;
    persistRecovery();
  }

  function recoverDraft() {
    if (!recoveryVerified || !recoveryReference?.draft || store.getState().draft) return;
    cancelCompletionMenu();
    const draft = recoveryReference.draft;
    recoveryReference = olderReferences[0] || null;
    olderReferences = olderReferences.slice(1);
    recoveryPreview = null;
    store.setDraft(draft);
  }

  function reconcileSavedFlow(result, previousState) {
    const results = result.results || [];
    const state = store.getState();
    const completed = isMenuResult(result) || result.resetConversation === true || results.some(item => {
      const status = String(item?.status || "").trim().toLowerCase();
      return status === "completed" || status.endsWith("_completed");
    });
    if (completed) {
      cancelAttachmentReminder();
      recoveryPreview = null;
      recoveryReference = null;
      olderReferences = [];
      // A successful submission consumes the staged files. Do not keep an
      // attachment from the completed post in the tray after reopening.
      if (result.preserveTransferredAttachmentTray !== true) store.syncAttachments([]);
      return;
    }
    if (result.returned_to_main_menu === true) {
      // A confirmed menu exit is represented by the VM draft catalogue/menu;
      // do not put the just-decided flow back above that menu as a local card.
      // The VM has already either copied the staged media into the draft,
      // deleted it for a normal exit, or deliberately retained it for the
      // transfer action. Reconcile the authoritative snapshot immediately so
      // the next menu never renders a stale tray.
      store.syncAttachments(Array.isArray(result.attachments) ? result.attachments : []);
      cancelAttachmentReminder();
      if (recoveryAccountId) {
        recoveryPreview = null;
        recoveryReference = null;
        olderReferences = [];
      }
      return;
    }
    if (!recoveryAccountId) return;
    if (results.some(item => item.draft_saved === true) && state.draft && previousState.activeFlow) {
      if (recoveryReference) olderReferences = [recoveryReference, ...olderReferences];
      recoveryReference = {
        activeFlow: previousState.activeFlow, draft: state.draft,
        question: currentQuestion(previousState.messages),
        pendingNames: previousState.pendingFiles.map(item => item.file?.name || "arquivo"),
        uncertain: recoveryUncertain,
      };
      store.setDraft("");
    }
    if (results.some(item => item.draft_resumed === true) && !store.getState().draft
      && state.activeFlow?.contextId && !state.activeFlow.paused) {
      const references = [recoveryReference, ...olderReferences].filter(Boolean);
      const index = references.findIndex(item => item.draft && !item.uncertain
        && item.activeFlow?.contextId === state.activeFlow.contextId
        && item.question && item.question === currentQuestion(state.messages));
      if (index >= 0) {
        const [saved] = references.splice(index, 1);
        recoveryReference = references[0] || null;
        olderReferences = references.slice(1);
        store.setDraft(saved.draft);
      }
    }
  }

  function cancelCompletionMenu() {
    completionMenuRevision += 1;
    if (completionMenuTimer !== null) clearTimeout(completionMenuTimer);
    completionMenuTimer = null;
  }

  function cancelResponseTransition() {
    responseTransitionRevision += 1;
    if (responseTransitionTimer !== null) clearTimeout(responseTransitionTimer);
    responseTransitionTimer = null;
    responseTransitionWaiters.forEach(resolve => resolve(false));
    responseTransitionWaiters.clear();
  }

  function waitForResponseTransition() {
    if (responseTransitionTimer === null) return Promise.resolve(true);
    return new Promise(resolve => responseTransitionWaiters.add(resolve));
  }

  function isTransientSuccessMessage(message) {
    if (message?.type !== "text") return false;
    const text = String(message.text || "").trim().toLocaleLowerCase("pt-BR");
    if (!text || /(?:erro|falha|não foi|nao foi|impossível|impossivel|não pôde|nao pode)/i.test(text)) return false;
    return /(?:anexo|arquivo|foto|pdf|tarefa|lançamento|lancamento|documento)/i.test(text)
      && /(?:recebid|enviad|adicionad|registrad|processad|salv|confirmad|sucesso)/i.test(text);
  }

  function stagedResponse(result) {
    if (result?.resetConversation === true || !Array.isArray(result?.messages) || result.messages.length < 2) return null;
    const [first, ...next] = result.messages;
    if (!isTransientSuccessMessage(first) || !next.length) return null;
    return { immediate: { ...result, messages: [first] }, nextMessages: next };
  }

  function scheduleResponseTransition(nextMessages) {
    cancelResponseTransition();
    const revision = responseTransitionRevision;
    const transitionAccount = account;
    responseTransitionTimer = setTimeout(() => {
      responseTransitionTimer = null;
      if (stopped || account !== transitionAccount || revision !== responseTransitionRevision) {
        responseTransitionWaiters.forEach(resolve => resolve(false));
        responseTransitionWaiters.clear();
        return;
      }
      attachmentRevision += 1;
      const replaced = store.replaceCurrentResponse(nextMessages);
      if (replaced) rememberCurrentAssistantPoll({}, nextMessages);
      hydrateMediaPreviews();
      responseTransitionWaiters.forEach(resolve => resolve(replaced));
      responseTransitionWaiters.clear();
    }, 1000);
    render();
  }

  function scheduleCompletionMenu(result) {
    const completionId = result.deferredMenu?.completionId;
    const delaySeconds = result.deferredMenu?.delaySeconds;
    if (!account || stopped || typeof client.getCompletionMenu !== "function"
      || typeof completionId !== "string" || !completionId.trim()
      || !Number.isFinite(delaySeconds) || delaySeconds < 0 || delaySeconds > 60) return;
    cancelCompletionMenu();
    const revision = completionMenuRevision;
    const menuAccount = account;
    const stillCurrent = () => !stopped && account === menuAccount
      && revision === completionMenuRevision && !flowBusy() && !store.getState().draft.trim();
    completionMenuTimer = setTimeout(async () => {
      completionMenuTimer = null;
      if (!stillCurrent()) return;
      try {
        const menu = await client.getCompletionMenu(completionId);
        if (!stillCurrent() || menu.results?.some(item => item.status === "obsolete")) return;
        if (!menu.results?.some(item => item.status === "sent") || !menu.messages?.length) {
          throw new Error("A VM não devolveu o menu principal.");
        }
        attachmentRevision += 1;
        store.ingestRemoteMessages(menu.messages, { ...menu, resetConversation: true });
        rememberCurrentAssistantPoll({ ...menu, resetConversation: true }, menu.messages);
        cancelAttachmentReminder();
        hydrateMediaPreviews();
      } catch {
        if (stillCurrent()) setSessionError(new Error("O cadastro continua confirmado, mas não foi possível carregar o menu principal. Toque em Retomar conversa."));
      }
    }, delaySeconds * 1000);
  }

  function flowBusy() {
    const state = store.getState();
    return resuming || attachmentActionBusy || responseTransitionTimer !== null
      || Boolean(state.activeText) || state.pendingFiles.some(item => item.status === "sending");
  }

  function cancelDatabaseFilter({ resetLast = false } = {}) {
    if (databaseFilterTimer !== null) clearTimeout(databaseFilterTimer);
    databaseFilterTimer = null;
    databaseFilterRevision += 1;
    if (resetLast) {
      lastDatabaseFilter = { key: "", query: "" };
      databaseFilterRequestedKey = "";
    }
  }

  function scheduleDatabaseFilter(command = {}) {
    const context = latestDatabaseFilter(store.getState().messages);
    if (!context || context.key !== String(command.filterKey || "")) return false;
    if (databaseFilterTimer !== null) clearTimeout(databaseFilterTimer);
    const revision = ++databaseFilterRevision;
    const query = String(command.value || "").trim();
    if (query && query.split(/\s+/u).length > 2) {
      databaseFilterTimer = null;
      return false;
    }
    const run = async () => {
      databaseFilterTimer = null;
      const current = latestDatabaseFilter(store.getState().messages);
      if (stopped || revision !== databaseFilterRevision || !current || current.key !== context.key) return;
      if (flowBusy()) {
        databaseFilterTimer = setTimeout(run, 50);
        databaseFilterTimer?.unref?.();
        return;
      }
      if (lastDatabaseFilter.key === context.key && lastDatabaseFilter.query === query) return;
      if (!query && databaseFilterRequestedKey !== context.key) return;
      if (query) databaseFilterRequestedKey = context.key;
      const sent = await sendText(
        query || "Limpar filtro",
        query ? undefined : "filter_clear",
        { silent: true, preserveDraft: true },
      );
      if (sent && revision === databaseFilterRevision) {
        lastDatabaseFilter = { key: context.key, query };
      }
    };
    databaseFilterTimer = setTimeout(run, Math.max(0, Number(databaseFilterDebounceMs) || 0));
    databaseFilterTimer?.unref?.();
    return true;
  }

  function discardExpiredTemporaryAttachment() {
    const state = store.getState();
    const message = [...(state.messages || [])].reverse().find(item => {
      const text = [item?.question, item?.prompt, item?.text, item?.caption].filter(Boolean).join(" ");
      const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
      return /anexo\s+temporario\s+nao\s+esta\s+mais\s+disponivel/.test(normalized)
        && /dados\s+do\s+formulario\s+foram\s+preservados/.test(normalized)
        && /reenvie\s+o\s+arquivo/.test(normalized);
    });
    if (!message) return false;
    const rawText = [message.question, message.prompt, message.text, message.caption]
      .filter(Boolean)
      .join(" ");
    const fileName = rawText.match(/reenvie\s+o\s+arquivo\s*:\s*([\s\S]+)$/i)?.[1]?.trim();
    const normalizeFileName = value => String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLocaleLowerCase("pt-BR");
    const normalizedFileName = normalizeFileName(fileName);
    const target = state.attachments.find(item => normalizeFileName(item.fileName) === normalizedFileName)
      || (state.attachments.length === 1 ? state.attachments[0] : null);
    return target ? store.removeAttachment(target.id) : false;
  }

  function pendingAttachmentGuard() {
    const pending = store.getState().pendingFiles;
    if (!pending.length) return null;
    const failed = pending.filter(item => item.status === "failed");
    if (failed.length) {
      const names = failed.map(item => item.file?.name || "arquivo").join(", ");
      return `Há anexo(s) que não foram confirmados pela VM (${names}). Tente novamente ou remova-os antes de enviar o formulário.`;
    }
    return "Aguarde a confirmação de todos os anexos antes de enviar o formulário.";
  }

  function verifyAttachmentSnapshotBeforeSubmit() {
    const current = store.getState().attachments;
    if (!current.length || typeof client.getAttachments !== "function") return true;
    return Promise.resolve().then(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const remote = await client.getAttachments();
        if (!Array.isArray(remote)) throw new Error("A VM não devolveu a confirmação dos anexos.");
        const remoteIds = new Set(remote.filter(item => item?.id && item?.mediaUrl).map(item => String(item.id)));
        const missing = current.filter(item => item?.id && !remoteIds.has(String(item.id)));
        if (!missing.length) {
          // Atualiza URLs/metadados somente depois de confirmar a coleção
          // inteira. Uma resposta transitória vazia não pode apagar a galeria
          // local nem esconder os arquivos que o usuário acabou de enviar.
          store.syncAttachments(remote);
          return true;
        }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error(
        "A VM não confirmou todos os anexos deste fluxo. A postagem foi bloqueada; os arquivos foram mantidos para uma nova tentativa.",
      );
    }).catch(error => {
      setSessionError(error, "Não foi possível confirmar os anexos antes da postagem.");
      return false;
    });
  }

  function render() {
    if (!flowBusy() || stopped || !account) {
      const waiters = [...idleWaiters];
      idleWaiters.clear();
      waiters.forEach(resolve => resolve());
    }
    const state = store.getState();
    // Keep the checked batch visually stable while the VM records each item.
    const nextEpiSelectionIds = epiFinalizeProgress
      ? epiFinalizeProgress.products.map(product => String(product.id))
      : [...epiSelectedProducts.keys()];
    const nextEpiSelectionIdsSignature = JSON.stringify(nextEpiSelectionIds);
    if (nextEpiSelectionIdsSignature !== epiSelectionIdsSignature) {
      epiSelectionIds = nextEpiSelectionIds;
      epiSelectionIdsSignature = nextEpiSelectionIdsSignature;
    }
    let renderMessages = state.messages;
    if (documentSigningFlow(state.activeFlow) && Array.isArray(state.messages)) {
      const activePoll = latestAssistantPoll(state.messages);
      if (documentProductPollKind(activePoll) === "epi") {
        if (epiRenderSourceMessages !== state.messages
          || epiRenderSourcePoll !== activePoll
          || epiRenderSelectionSignature !== epiSelectionIdsSignature) {
          const activePollIndex = state.messages.lastIndexOf(activePoll);
          renderMessages = state.messages.slice();
          if (activePollIndex >= 0) {
            renderMessages[activePollIndex] = { ...activePoll, epiSelectedProductIds: epiSelectionIds };
          }
          epiRenderSourceMessages = state.messages;
          epiRenderSourcePoll = activePoll;
          epiRenderSelectionSignature = epiSelectionIdsSignature;
          epiRenderMessages = renderMessages;
        } else {
          renderMessages = epiRenderMessages;
        }
      }
    }
    const signaturePlacement = syncSignaturePlacement();
    view.render({
      ...state,
      ...(renderMessages !== state.messages ? { messages: renderMessages } : {}),
      epiSelectedProductIds: epiSelectionIds,
      account,
      sessionStatus,
      resuming,
      responseTransitionPending: responseTransitionTimer !== null,
      recoveryPreview,
      recoveryReference,
      recoveryReferenceCount: (recoveryReference ? 1 : 0) + olderReferences.length,
      recoveryWarning,
      recoveryBlocked: Boolean(recoveryAccountId && !recoveryVerified),
      pendingProvisions: pendingProvisionSnapshot,
      pendingNotes: pendingNotesSnapshot,
      pendingNoteLaunchOrderId,
      pendingNoteLaunchFailed,
      pendingProvisionReminderOpen,
      pendingProvisionReminderError,
      pendingProvisionAttachments: pendingProvisionAttachmentStateForView(),
      pendingProvisionAttachmentRevision: pendingProvisionAttachmentStateRevision,
      pendingProvisionExpandedPaymentId,
      pendingProvisionSettlementPaymentId,
      pendingProvisionDateEditPaymentId,
      pendingProvisionDateEditValue,
      pendingProvisionDateEditError,
      pendingProvisionDateEditBusy,
      pendingProvisionUploads: pendingProvisionUploadsForView(),
      pendingProvisionUploadsRevision,
      delegatedTasks: delegatedTasksSnapshot,
      signaturePlacement,
      error: sessionError || state.error,
    });
  }

  function preparePresenceResult(result) {
    return scopePresenceResult(result, lastPresenceValidationDate);
  }

  function setSessionError(error, fallback) {
    sessionError = errorMessage(error, fallback);
    render();
  }

  async function powerBiAccessToken() {
    try {
      return await auth.getToken(POWERBI_SCOPES);
    } catch (error) {
      if (error?.code !== "AUTH_REQUIRED" || typeof auth.authorize !== "function") throw error;
      await auth.authorize(POWERBI_SCOPES, { resumeAction: POWERBI_DASHBOARD_REPLY_ID });
      return auth.getToken(POWERBI_SCOPES);
    }
  }

  async function openPowerBiDashboard() {
    const dashboardAccount = account;
    if (!dashboardAccount || stopped) return false;
    try {
      const accessToken = await powerBiAccessToken();
      if (stopped || account !== dashboardAccount) return false;
      return await (view.openPowerBiDashboard?.({
        accessToken,
        onHome: () => sendText("", PORTAL_MAIN_MENU_CONFIRM_ID),
        getAccessToken: async () => {
          if (stopped || account !== dashboardAccount) throw new Error("A sessão do Power BI foi encerrada.");
          return powerBiAccessToken();
        },
      }) ?? false);
    } catch (error) {
      if (!stopped && account === dashboardAccount) {
        setSessionError(error, "Não foi possível abrir o Power BI. Verifique a permissão Microsoft Report.Read.All e o acesso da conta ao relatório.");
      }
      return false;
    }
  }

  function updateEpiProductSelection({ productId, selected } = {}) {
    if (epiFinalizeProgress) {
      render();
      return false;
    }
    const state = store.getState();
    syncEpiDeliverySnapshot(state.activeFlow);
    const poll = latestAssistantPoll(state.messages);
    if (!documentSigningFlow(state.activeFlow) || documentProductPollKind(poll) !== "epi") return false;
    const option = poll.options.find(item => String(item?.id || item?.reply || "") === String(productId || ""));
    if (!option) return false;
    const product = epiProductDetails(option);
    const key = epiDescriptionKey(product.description);
    if (!product.id || !key) return false;

    if (selected) {
      if (epiCommittedItemKeys().has(key)) {
        setSessionError(new Error("Este EPI já foi incluído; o PDF não aceita descrições repetidas."));
        return false;
      }
      if ([...epiSelectedProducts.values()].some(item => (
        item.id !== product.id && epiDescriptionKey(item.description) === key
      ))) {
        setSessionError(new Error("Este produto já está selecionado; o PDF não aceita descrições repetidas."));
        return false;
      }
      const isNew = !epiSelectedProducts.has(product.id);
      if (isNew && epiSelectedProducts.size + epiCommittedItemCount() >= 100) {
        setSessionError(new Error("O comprovante aceita no máximo 100 itens."));
        return false;
      }
      epiSelectedProducts.set(product.id, product);
    } else {
      epiSelectedProducts.delete(product.id);
    }
    sessionError = null;
    render();
    return true;
  }

  function updateEpiProductSelectionBatch({ productIds, selected } = {}) {
    if (epiFinalizeProgress || !Array.isArray(productIds) || !productIds.length) return false;
    const state = store.getState();
    syncEpiDeliverySnapshot(state.activeFlow);
    const poll = latestAssistantPoll(state.messages);
    if (!documentSigningFlow(state.activeFlow) || documentProductPollKind(poll) !== "epi") return false;
    const ids = [...new Set(productIds.map(String))];
    const next = new Map(epiSelectedProducts);
    if (selected) {
      const committedKeys = epiCommittedItemKeys();
      const selectedKeys = new Set([...next.values()].map(item => epiDescriptionKey(item.description)));
      for (const id of ids) {
        if (next.has(id)) continue;
        const option = poll.options.find(item => String(item?.id || item?.reply || "") === id);
        if (!option) return false;
        const product = epiProductDetails(option);
        const key = epiDescriptionKey(product.description);
        if (!product.id || !key) return false;
        if (committedKeys.has(key) || selectedKeys.has(key)) {
          setSessionError(new Error("Este produto já foi incluído; o PDF não aceita descrições repetidas."));
          return false;
        }
        if (next.size + epiCommittedItemCount() >= 100) {
          setSessionError(new Error("O comprovante aceita no máximo 100 itens."));
          return false;
        }
        next.set(id, product);
        selectedKeys.add(key);
      }
    } else {
      for (const id of ids) next.delete(id);
    }
    epiSelectedProducts.clear();
    for (const [id, product] of next) epiSelectedProducts.set(id, product);
    sessionError = null;
    render();
    return true;
  }

  function hydrateMediaPreviews() {
    // The VM does not assign message IDs. Use the normalized store records,
    // whose IDs are also used by the view and setMessagePreview.
    const { messages, attachments } = store.getState();
    const previewAccount = account;
    const candidates = [
      ...(Array.isArray(messages) ? messages.map(item => ({ ...item, previewKey: `message:${item.id}` })) : []),
      ...(Array.isArray(attachments) ? attachments.map(item => ({ ...item, previewKey: `attachment:${item.id}` })) : []),
    ].filter(item => item.id && item.mediaUrl && (
      item.type === "image" || item.type === "document"
      || String(item.mimeType || "").startsWith("image/")
      || String(item.mimeType || "").toLowerCase() === "application/pdf"
      || /\.pdf$/i.test(String(item.fileName || "").trim())
    ));
    for (const item of candidates) {
      if (previewLoading.has(item.previewKey) || item.previewUrl) continue;
      previewLoading.add(item.previewKey);
      const timer = setTimeout(() => {
        previewTimers.delete(timer);
        client.fetchMedia(item)
          .then(blob => createMediaThumbnail(blob, item.fileName || item.caption || "arquivo"))
          .then(url => {
            if (!url) return;
            if (stopped || !account || account !== previewAccount) {
              URL.revokeObjectURL(url);
              return;
            }
            previewUrls.add(url);
            if (item.previewKey.startsWith("message:")) store.setMessagePreview(item.id, url);
            else store.setAttachmentPreview(item.id, url);
          })
          .catch(() => {})
          .finally(() => previewLoading.delete(item.previewKey));
      }, 100);
      previewTimers.add(timer);
    }
  }

  async function continueConversation() {
    if (!account || stopped || flowBusy()) return false;
    cancelResponseTransition();
    currentAssistantPollSnapshot = null;
    cancelCompletionMenu();
    const conversationAccount = account;
    const resumeDraftRevision = draftEditRevision;
    sessionError = null;
    resuming = true;
    render();
    try {
      attachmentRevision += 1;
      const result = preparePresenceResult(await client.sendText({ text: "", replyId: "input_continue" }));
      if (account !== conversationAccount || stopped) return false;
      // Some resume responses identify the current menu only by its stage and
      // accidentally echo the previous flow metadata. Treat that response as
      // authoritative menu state so the old header cannot become resumable.
      const menuResult = isMenuResult(result);
      let ingestedResult = menuResult
        ? { ...result, activeFlow: null, resetConversation: true, attachments: [] }
        : result;
      if (menuResult) {
        clearLegacyDocumentLineSelection();
        clearEpiProductSelection();
      } else {
        syncEpiDeliverySnapshot(ingestedResult.activeFlow);
        reconcileEpiFinalizeProgress(ingestedResult.activeFlow, ingestedResult.messages);
        const productKind = latestDocumentProductKind(ingestedResult.messages);
        const restoredFinalizeOption = readDocumentLineSelection(
          account,
          ingestedResult.activeFlow,
          productKind,
        );
        if (restoredFinalizeOption) {
          legacyDocumentLineFinalizeOption = restoredFinalizeOption;
          ingestedResult = withLegacyDocumentLineFinalize(ingestedResult);
        }
      }
      attachmentRevision += 1;
      store.ingestRemoteMessages(ingestedResult.messages, {
        ...ingestedResult,
        resetConversation: ingestedResult.resetConversation === true,
        attachments: ingestedResult.attachments,
      });
      rememberCurrentAssistantPoll(ingestedResult, ingestedResult.messages);
      hydrateMediaPreviews();
      // A retomada pode devolver a pergunta atual sem a coleção de anexos
      // (especialmente após fechar/reabrir o aplicativo). Consulte o snapshot
      // explicitamente para que a lista suspensa reapareça antes da próxima
      // resposta do usuário.
      if (!menuResult && typeof client.getAttachments === "function") {
        try {
          const attachments = await client.getAttachments();
          if (account === conversationAccount && !stopped) {
            attachmentRevision += 1;
            store.syncAttachments(attachments);
            hydrateMediaPreviews();
          }
        } catch {
          // A resposta da VM continua válida; a próxima atualização tentará
          // novamente sem bloquear a conversa.
        }
      }
      reconcileRecovery(resumeDraftRevision, ingestedResult);
      if (attachmentReminderDetails()) scheduleAttachmentReminder();
      else cancelAttachmentReminder();
      scheduleCompletionMenu(result);
      return true;
    } catch (error) {
      if (!stopped && account === conversationAccount) setSessionError(error, "Não foi possível retomar a conversa com a VM.");
      return false;
    } finally {
      resuming = false;
      if (!stopped) render();
    }
  }

  function disposeLaunchGallery() {
    gallerySignatureResolve?.(null);
    gallerySignatureResolve = null;
    launchGallery?.destroy?.();
    launchGallery = null;
  }

  function disposeOrdersGallery() {
    ordersGallery?.destroy?.();
    ordersGallery = null;
  }

  function disposeTasksGallery() {
    tasksGallery?.destroy?.();
    tasksGallery = null;
  }

  function disposePaymentProgrammingGallery() {
    paymentProgrammingGallery?.destroy?.();
    paymentProgrammingGallery = null;
  }

  function disposeRecurringExpensesGallery() {
    recurringExpensesGallery?.destroy?.();
    recurringExpensesGallery = null;
  }

  function disposeRegistrationGalleries() {
    for (const gallery of registrationGalleries.values()) gallery.destroy?.();
    registrationGalleries.clear();
    registrationGalleryOpenings.clear();
  }

  function galleryAddToTray(assertSession) {
    return ({ blob, fileName } = {}) => {
      assertSession();
      if (!blob || typeof blob.slice !== "function" || typeof blob.arrayBuffer !== "function") {
        throw new Error("O anexo selecionado não está disponível para adicionar.");
      }
      const name = String(fileName || "anexo");
      const type = String(blob.type || "application/octet-stream");
      const FileConstructor = globalThis.File;
      const file = typeof FileConstructor === "function"
        ? new FileConstructor([blob], name, { type })
        : Object.assign(new Blob([blob], { type }), { name });
      return queueSelectedFiles(() => [file]);
    };
  }

  function openGalleryMedia(sourceItems, assertSession) {
    assertSession();
    const items = (Array.isArray(sourceItems) ? sourceItems : []).map(item => ({
      ...item,
      fileName: String(item?.fileName || "arquivo"),
      source: item?.source,
    })).filter(item => item.source != null);
    const first = items[0];
    if (!first) return undefined;
    const options = { onAddToTray: galleryAddToTray(assertSession) };
    if (typeof native.previewMediaCollection === "function") {
      return native.previewMediaCollection(items, options);
    }
    if (typeof native.previewMedia === "function") {
      return native.previewMedia(first.source, first.fileName, options);
    }
    return showMedia(first.source, first.fileName);
  }

  async function openLaunchGallery() {
    if (!account || stopped || flowBusy()) return false;
    if (launchGalleryOpening) return launchGalleryOpening;
    const galleryAccount = account;
    const assertSession = () => {
      if (stopped || account !== galleryAccount) throw new Error("A sessão da galeria foi encerrada.");
    };
    launchGalleryOpening = (async () => {
      try {
        if (!launchGallery) {
          const panel = await launchGalleryFactory({
            request: async (operation, payload) => {
              assertSession();
              const result = await client.launchGalleryRequest(operation, payload);
              assertSession();
              return result;
            },
            upload: async (id, file, options) => {
              assertSession();
              const result = await client.uploadLaunchGalleryFile(id, file, options);
              assertSession();
              return result;
            },
            openMedia: descriptor => {
              assertSession();
              return showMedia(client.fetchMedia(descriptor), descriptor.fileName || "arquivo", {
                onAddToTray: galleryAddToTray(assertSession),
              });
            },
            openMediaCollection: descriptors => {
              assertSession();
              const items = (Array.isArray(descriptors) ? descriptors : []).map(descriptor => ({
                ...descriptor,
                source: client.fetchMedia(descriptor),
              }));
              return openGalleryMedia(items, assertSession);
            },
            loadMediaPreview: async descriptor => {
              assertSession();
              const blob = await fetchMediaWithTimeout(descriptor, "a prévia do anexo");
              assertSession();
              const url = await createMediaThumbnail(blob, descriptor.fileName || "imagem");
              if (url) previewUrls.add(url);
              return url;
            },
            captureSignature: () => {
              assertSession();
              gallerySignatureResolve?.(null);
              return new Promise(resolve => {
                gallerySignatureResolve = resolve;
                if (!view.openSignaturePad?.("launch-gallery")) {
                  gallerySignatureResolve = null;
                  resolve(null);
                }
              });
            },
            onClose: () => { gallerySignatureResolve?.(null); gallerySignatureResolve = null; },
            onHome: () => { assertSession(); return sendText("", PORTAL_MAIN_MENU_CONFIRM_ID); },
          });
          if (stopped || account !== galleryAccount) { panel.destroy?.(); return false; }
          launchGallery = panel;
        }
        await launchGallery.open();
        return true;
      } catch (error) {
        if (!stopped && account === galleryAccount) setSessionError(error, "Não foi possível abrir a galeria.");
        return false;
      } finally {
        launchGalleryOpening = null;
      }
    })();
    return launchGalleryOpening;
  }

  async function openOrdersGallery() {
    if (!account || stopped || flowBusy()) return false;
    if (ordersGalleryOpening) return ordersGalleryOpening;
    const galleryAccount = account;
    const assertSession = () => {
      if (stopped || account !== galleryAccount) throw new Error("A sessão da Galeria de Pedidos foi encerrada.");
    };
    ordersGalleryOpening = (async () => {
      try {
        if (!ordersGallery) {
          const data = await ordersGalleryDataFactory({ tokenProvider: scopes => {
            assertSession();
            return auth.getToken(scopes).catch(async error => {
              if (error?.code !== "AUTH_REQUIRED" || typeof auth.authorize !== "function") throw error;
              await auth.authorize(scopes, { resumeAction: ORDERS_GALLERY_ID });
              assertSession();
              return auth.getToken(scopes);
            });
          } });
          assertSession();
          const panel = await ordersGalleryFactory({
            data,
            openMediaCollection: items => openGalleryMedia(items, assertSession),
            onHome: () => { assertSession(); return sendText("", PORTAL_MAIN_MENU_CONFIRM_ID); },
          });
          if (stopped || account !== galleryAccount) { panel.destroy?.(); return false; }
          ordersGallery = panel;
        }
        await ordersGallery.open();
        return true;
      } catch (error) {
        if (!stopped && account === galleryAccount) setSessionError(error, "Não foi possível abrir a Galeria de Pedidos.");
        return false;
      } finally {
        ordersGalleryOpening = null;
      }
    })();
    return ordersGalleryOpening;
  }

  async function openTasksGallery() {
    if (!account || stopped || flowBusy()) return false;
    if (tasksGalleryOpening) return tasksGalleryOpening;
    const galleryAccount = account;
    const assertSession = () => {
      if (stopped || account !== galleryAccount) throw new Error("A sessão da Galeria de Tarefas foi encerrada.");
    };
    tasksGalleryOpening = (async () => {
      try {
        if (!tasksGallery) {
          const data = await tasksGalleryDataFactory({ tokenProvider: scopes => {
            assertSession();
            return auth.getToken(scopes).catch(async error => {
              if (error?.code !== "AUTH_REQUIRED" || typeof auth.authorize !== "function") throw error;
              await auth.authorize(scopes, { resumeAction: TASKS_GALLERY_ID });
              assertSession();
              return auth.getToken(scopes);
            });
          } });
          assertSession();
          const panel = await tasksGalleryFactory({
            data,
            openMediaCollection: items => openGalleryMedia(items, assertSession),
            onHome: () => { assertSession(); return sendText("", PORTAL_MAIN_MENU_CONFIRM_ID); },
          });
          if (stopped || account !== galleryAccount) { panel.destroy?.(); return false; }
          tasksGallery = panel;
        }
        await tasksGallery.open();
        return true;
      } catch (error) {
        if (!stopped && account === galleryAccount) setSessionError(error, "Não foi possível abrir a Galeria de Tarefas.");
        return false;
      } finally {
        tasksGalleryOpening = null;
      }
    })();
    return tasksGalleryOpening;
  }

  async function openPaymentProgrammingGallery() {
    if (!account || stopped || flowBusy()) return false;
    if (paymentProgrammingGalleryOpening) return paymentProgrammingGalleryOpening;
    const galleryAccount = account;
    const assertSession = () => {
      if (stopped || account !== galleryAccount) throw new Error("A sessão da Galeria de Programação de Pagamentos foi encerrada.");
    };
    paymentProgrammingGalleryOpening = (async () => {
      try {
        if (!paymentProgrammingGallery) {
          const data = await paymentProgrammingGalleryDataFactory({ tokenProvider: scopes => {
            assertSession();
            return auth.getToken(scopes).catch(async error => {
              if (error?.code !== "AUTH_REQUIRED" || typeof auth.authorize !== "function") throw error;
              await auth.authorize(scopes, { resumeAction: PAYMENT_PROGRAMMING_GALLERY_ID });
              assertSession();
              return auth.getToken(scopes);
            });
          } });
          assertSession();
          const panel = await paymentProgrammingGalleryFactory({
            data,
            openMediaCollection: items => openGalleryMedia(items, assertSession),
            onHome: () => { assertSession(); return sendText("", PORTAL_MAIN_MENU_CONFIRM_ID); },
          });
          if (stopped || account !== galleryAccount) { panel.destroy?.(); return false; }
          paymentProgrammingGallery = panel;
        }
        await paymentProgrammingGallery.open();
        return true;
      } catch (error) {
        if (!stopped && account === galleryAccount) setSessionError(error, "Não foi possível abrir a Galeria de Programação de Pagamentos.");
        return false;
      } finally {
        paymentProgrammingGalleryOpening = null;
      }
    })();
    return paymentProgrammingGalleryOpening;
  }

  async function openRecurringExpensesGallery() {
    if (!account || stopped || flowBusy()) return false;
    if (recurringExpensesGalleryOpening) return recurringExpensesGalleryOpening;
    const galleryAccount = account;
    const assertSession = () => {
      if (stopped || account !== galleryAccount) throw new Error("A sessão da Galeria de Despesas Recorrentes foi encerrada.");
    };
    recurringExpensesGalleryOpening = (async () => {
      try {
        if (!recurringExpensesGallery) {
          const data = await recurringExpensesGalleryDataFactory({ tokenProvider: scopes => {
            assertSession();
            return auth.getToken(scopes).catch(async error => {
              if (error?.code !== "AUTH_REQUIRED" || typeof auth.authorize !== "function") throw error;
              await auth.authorize(scopes, { resumeAction: RECURRING_EXPENSES_GALLERY_ID });
              assertSession();
              return auth.getToken(scopes);
            });
          } });
          assertSession();
          const panel = await recurringExpensesGalleryFactory({
            data,
            openMediaCollection: items => openGalleryMedia(items, assertSession),
            onHome: () => { assertSession(); return sendText("", PORTAL_MAIN_MENU_CONFIRM_ID); },
          });
          if (stopped || account !== galleryAccount) { panel.destroy?.(); return false; }
          recurringExpensesGallery = panel;
        }
        await recurringExpensesGallery.open();
        return true;
      } catch (error) {
        if (!stopped && account === galleryAccount) setSessionError(error, "Não foi possível abrir a Galeria de Despesas Recorrentes.");
        return false;
      } finally {
        recurringExpensesGalleryOpening = null;
      }
    })();
    return recurringExpensesGalleryOpening;
  }

  async function openRegistrationGallery(kind, replyId) {
    if (!account || stopped || flowBusy()) return false;
    if (registrationGalleryOpenings.has(kind)) return registrationGalleryOpenings.get(kind);
    const galleryAccount = account;
    const assertSession = () => {
      if (stopped || account !== galleryAccount) throw new Error("A sessão da galeria de cadastros foi encerrada.");
    };
    const opening = (async () => {
      try {
        if (!registrationGalleries.has(kind)) {
          const data = await registrationGalleryDataFactory({ kind, tokenProvider: scopes => {
            assertSession();
            return auth.getToken(scopes).catch(async error => {
              if (error?.code !== "AUTH_REQUIRED" || typeof auth.authorize !== "function") throw error;
              await auth.authorize(scopes, { resumeAction: replyId });
              assertSession();
              return auth.getToken(scopes);
            });
          } });
          assertSession();
          const panel = await registrationGalleryFactory({
            kind, data,
            ...(kind === "documents" ? {
              openMediaCollection: items => {
                assertSession();
                const collection = (Array.isArray(items) ? items : []).map(item => ({
                  fileName: String(item?.fileName || "arquivo"),
                  source: item?.source,
                })).filter(item => item.source != null);
                return openGalleryMedia(collection, assertSession);
              },
            } : {}),
            onHome: () => { assertSession(); return sendText("", PORTAL_MAIN_MENU_CONFIRM_ID); },
          });
          if (stopped || account !== galleryAccount) { panel.destroy?.(); return false; }
          registrationGalleries.set(kind, panel);
        }
        await registrationGalleries.get(kind).open();
        return true;
      } catch (error) {
        if (!stopped && account === galleryAccount) setSessionError(error, "Não foi possível abrir a galeria de cadastros.");
        return false;
      } finally {
        registrationGalleryOpenings.delete(kind);
      }
    })();
    registrationGalleryOpenings.set(kind, opening);
    return opening;
  }

  async function sendText(text = store.getState().draft, replyId, behavior = {}) {
    if (!account || stopped || flowBusy() || (recoveryAccountId && !recoveryVerified)) return false;
    const continuingWithoutAttachment = String(replyId || "").trim().toLowerCase() === "input_continue";
    const pendingError = pendingAttachmentGuard();
    if (pendingError && !continuingWithoutAttachment) {
      setSessionError(new Error(pendingError));
      return false;
    }
    if (!continuingWithoutAttachment) {
      const attachmentVerification = verifyAttachmentSnapshotBeforeSubmit();
      if (attachmentVerification !== true && !await attachmentVerification) return false;
    }
    // Attachment verification may have yielded while the pending-note popup was closed.
    if (behavior.isCurrent?.() === false) return false;
    cancelAttachmentReminder();
    cancelResponseTransition();
    cancelCompletionMenu();
    sessionError = null;
    const editingSignature = replyId === DOCUMENT_SIGNING_EDIT_SIGNATURE_ID;
    const positioningSignature = String(replyId || "").startsWith("document_signing_position_point:");
    const previousState = store.getState();
    const previousAssistantPollSnapshot = currentAssistantPollSnapshot;
    syncEpiDeliverySnapshot(previousState.activeFlow);
    const previousPoll = (behavior.epiFinalizeStep === true || epiFinalizeProgress?.phase === "quantity")
      ? currentAssistantPoll() || latestAssistantPoll(previousState.messages)
      : latestAssistantPoll(previousState.messages);
    const resumedEpiQuantity = previousState.activeFlow?.epiDelivery?.stage === "document_signing_epi_quantity";
    const epiFinalizeAdvanceRetry = Boolean(
      epiFinalizeProgress?.phase === "advance"
      && String(replyId || "") === epiFinalizeProgress.advanceReplyId
    );
    if (epiFinalizeProgress?.phase === "advance" && !epiFinalizeAdvanceRetry) {
      setSessionError(new Error("Escolha SIM para continuar os EPIs selecionados antes de finalizar."));
      return false;
    }
    const epiFinalizeQuantityRetry = Boolean(
      behavior.epiFinalizeStep !== true
      && epiFinalizeProgress?.phase === "quantity"
      && documentSigningFlow(previousState.activeFlow)
      && isEpiQuantityQuestion(previousPoll)
    );
    const epiQuantityAnswer = Boolean(
      replyId !== NAVIGATION_BACK_ID
      && (pendingEpiButtonProduct || epiFinalizeQuantityRetry || resumedEpiQuantity)
      && documentSigningFlow(previousState.activeFlow)
      && isEpiQuantityQuestion(previousPoll)
    );
    const epiQuantityProduct = epiQuantityAnswer
      ? pendingEpiButtonProduct || epiDeliveryProduct(previousState.activeFlow?.epiDelivery?.pendingProduct)
      : null;
    const epiQuantityValue = String(text || replyId || "");
    if (epiQuantityAnswer && !epiQuantityPdfCompatible(epiQuantityValue)) {
      setSessionError(new Error(
        "Quantidade fora dos limites aceitos pelo PDF (até 15 dígitos inteiros e 6 casas decimais).",
      ));
      return false;
    }
    const submissionText = normalizePartialDateSubmission(text, previousState.messages);
    const validatedPresenceDate = latestPresenceValidationDate(previousState.messages);
    if (validatedPresenceDate) lastPresenceValidationDate = validatedPresenceDate;
    let operation;
    let epiAdvanceError = null;
    let remoteResponseReceived = false;
    try {
      if (editingSignature) {
        signaturePlacementEditPending = true;
        invalidateSignaturePlacement({ clearOverride: true });
      }
      attachmentRevision += 1;
      currentAssistantPollSnapshot = null;
      operation = store.beginText(submissionText, {
        allowEmpty: replyId === PORTAL_MAIN_MENU_CONFIRM_ID
          || replyId === PORTAL_TRANSFER_ATTACHMENTS_ID
          || replyId === EPI_ORDER_BLANK_REPLY_ID
          || replyId === EPI_SUPPLIER_DOCUMENT_BLANK_REPLY_ID
          || continuingWithoutAttachment,
        // A second date (or a selected LOG row) must replace the previous
        // report instead of leaving an older day's table visible underneath.
        replaceAuditReport: Boolean(previousState.messages?.some?.(message => (
          message?.type === "poll"
            ? String(message.question || message.prompt || "").toLocaleLowerCase("pt-BR").includes("log de ações")
              || (Array.isArray(message.options) && message.options.some(option => String(option?.reply || option?.id || "").startsWith("audit_log_row:")))
            : /log\s+de\s+a[cç][oõ]es/i.test(String(message?.caption || message?.text || ""))
        ))),
        silent: behavior.silent === true || behavior.epiFinalizeStep === true,
        preserveDraft: behavior.preserveDraft === true,
      });
      behavior.onRequest?.();
      let result = preparePresenceResult(await client.sendText({
        text: operation.text,
        ...(replyId ? { replyId } : {}),
      }));
      remoteResponseReceived = true;
      result = preserveDatabaseFilterRegistrationOptions([previousPoll], result);
      const quantityResult = result;
      const retryingLastCheckboxQuantity = epiFinalizeQuantityRetry
        && epiFinalizeProgress.index === epiFinalizeProgress.products.length - 1;
      const lineDecision = behavior.skipLineAdditionAdvance === true || retryingLastCheckboxQuantity
        ? null
        : lineAdditionDecision(result, result.activeFlow || previousState.activeFlow);
      if (lineDecision?.advanceOption) {
        legacyDocumentLineFinalizeOption = lineDecision.finalizeOption;
        const advanceOption = lineDecision.advanceOption;
        let advancedResult;
        try {
          advancedResult = preparePresenceResult(await client.sendText({
            text: String(advanceOption.label || advanceOption.title || "SIM"),
            ...(advanceOption.reply || advanceOption.id ? { replyId: String(advanceOption.reply || advanceOption.id) } : {}),
          }));
        } catch (error) {
          if (behavior.epiFinalizeStep === true && epiQuantityAnswer && epiFinalizeProgress) {
            epiAdvanceError = error;
            epiFinalizeProgress.phase = "advance";
            epiFinalizeProgress.advanceReplyId = String(advanceOption.reply || advanceOption.id || "yes");
            result = quantityResult;
          } else {
            throw error;
          }
        }
        if (!epiAdvanceError && epiQuantityAnswer && lineDecision.finalizeOption && isEmptyEpiProductCatalog(advancedResult)) {
          const returnedToMore = preparePresenceResult(await client.sendText({
            text: "↩️ RETORNAR À PERGUNTA ANTERIOR",
            replyId: NAVIGATION_BACK_ID,
          }));
          const recoveredFinalizeOption = currentLineDecisionOption(
            returnedToMore.messages,
            returnedToMore.activeFlow || previousState.activeFlow,
          );
          if (recoveredFinalizeOption) {
            epiDirectFinalizeOption = lineDecision.finalizeOption;
            const emptyProductPoll = {
              type: "poll",
              question: "🦺 NÃO HÁ OUTROS PRODUTOS EPI. FINALIZE PARA GERAR O PDF.",
              databaseFilterKey: "document_signing_epi_product",
              options: [{
                id: DOCUMENT_LINE_FINALIZE_ID,
                reply: DOCUMENT_LINE_FINALIZE_ID,
                label: "✅ FINALIZAR",
                legacyDocumentLineFinalize: true,
              }],
            };
            result = {
              ...returnedToMore,
              messages: [...(returnedToMore.messages || []), emptyProductPoll],
            };
          } else {
            result = returnedToMore;
          }
        } else if (!epiAdvanceError) {
          result = advancedResult;
        }
        writeDocumentLineSelection(
          account,
          result.activeFlow || previousState.activeFlow,
          latestDocumentProductKind(result.messages) || latestDocumentProductKind(previousState.messages),
          legacyDocumentLineFinalizeOption,
        );
      }
      if (legacyDocumentLineFinalizeOption) result = withLegacyDocumentLineFinalize(result);
      // A generated-document edit uses a local override while the VM flow is
      // no longer active. Drop that override before confirming the response;
      // otherwise the synchronous store render reopens the old editor and
      // hides the newly generated document.
      if (positioningSignature) invalidateSignaturePlacement({ clearOverride: true });
      attachmentRevision += 1;
      const summaryStatus = result.results?.find(item => ["flow_summary", "no_active_flow", "flow_summary_failed"].includes(item.status))?.status;
      if (summaryStatus) {
        const confirmed = store.confirmText(operation, { ...result, readOnlySummary: true });
        if (!confirmed) return false;
        rememberCurrentAssistantPoll(result, result.messages);
        const image = result.messages.find(item => item.type === "image" && item.mediaUrl);
        if (summaryStatus === "flow_summary" && image) {
          try {
            await showMedia(client.fetchMedia(image), image.fileName || "Resumo do fluxo.png");
          } catch (error) {
            if (!stopped && account) setSessionError(error, "Não foi possível abrir o resumo.");
          }
        } else {
          setSessionError(new Error(result.messages.find(item => item.type === "text")?.text || "Não foi possível gerar o resumo."));
        }
        return true;
      }
      const menuResult = isMenuResult(result);
      const transferPromptWasActive = attachmentTransferPending
        && hasAttachmentTransferPrompt(previousState.messages);
      const transferConfirmedInResponse = attachmentTransferPending
        && hasAttachmentTransferConfirmation(result);
      const transferPromptCancelled = transferPromptWasActive
        && !transferConfirmedInResponse
        && !hasAttachmentTransferPrompt(result.messages);
      const preserveTransferredAttachments = attachmentTransferPending
        && previousState.attachments.length > 0
        && (transferConfirmedInResponse || attachmentTransferCompleted);
      const enteredNextTransferredFlow = attachmentTransferPending
        && attachmentTransferCompleted
        && !menuResult
        && isDifferentActiveFlow(previousState.activeFlow, result.activeFlow);
      const transferAttachmentSnapshot = Array.isArray(result.attachments) && result.attachments.length
        ? result.attachments
        : previousState.attachments;
      const effectiveResult = menuResult
        ? {
          ...result,
          activeFlow: null,
          resetConversation: true,
          attachments: preserveTransferredAttachments ? transferAttachmentSnapshot : [],
          ...(preserveTransferredAttachments ? { preserveTransferredAttachmentTray: true } : {}),
        }
        : transferConfirmedInResponse
          ? {
            ...result,
            attachments: Array.isArray(result.attachments) && result.attachments.length
              ? result.attachments
              : previousState.attachments,
            preserveTransferredAttachmentTray: true,
          }
          : enteredNextTransferredFlow && (!Array.isArray(result.attachments) || !result.attachments.length)
            ? { ...result, attachments: previousState.attachments }
          : result;
      if (menuResult) {
        lastPresenceValidationDate = "";
        clearLegacyDocumentLineSelection();
        clearEpiProductSelection();
      }
      const hideEpiFinalizeResponse = behavior.epiFinalizeStep === true
        && Boolean(epiFinalizeProgress)
        && epiFinalizeProgress?.phase !== "finalize"
        && !epiAdvanceError;
      // Automatic batch prompts remain in the controller snapshot for routing,
      // but their intermediate screens do not enter the visible conversation.
      const presentationResult = hideEpiFinalizeResponse
        ? { ...effectiveResult, messages: [] }
        : effectiveResult;
      const staged = stagedResponse(presentationResult);
      const confirmed = store.confirmText(operation, staged?.immediate || presentationResult);
      let resumeEpiFinalize = false;
      if (confirmed) {
        if (epiQuantityAnswer && epiQuantityProduct && !isEpiQuantityQuestion(latestAssistantPoll(effectiveResult.messages))) {
          const key = epiDescriptionKey(epiQuantityProduct.description);
          if (key) {
            epiButtonItems.set(key, { ...epiQuantityProduct, quantity: epiQuantityValue });
            for (const [id, product] of epiSelectedProducts) {
              if (epiDescriptionKey(product.description) === key) epiSelectedProducts.delete(id);
            }
          }
          if (pendingEpiButtonProduct === epiQuantityProduct) pendingEpiButtonProduct = null;
        }
        if (epiFinalizeAdvanceRetry && epiFinalizeProgress) {
          epiFinalizeProgress.index += 1;
          epiFinalizeProgress.phase = epiFinalizeProgress.index < epiFinalizeProgress.products.length
            ? "select"
            : "finalize";
          delete epiFinalizeProgress.advanceReplyId;
          resumeEpiFinalize = true;
        }
        if (epiFinalizeQuantityRetry && epiFinalizeProgress) {
          epiFinalizeProgress.index += 1;
          epiFinalizeProgress.phase = epiFinalizeProgress.index < epiFinalizeProgress.products.length
            ? "select"
            : "finalize";
          resumeEpiFinalize = true;
        }
        syncEpiDeliverySnapshot(effectiveResult.activeFlow);
        if (epiAdvanceError) sessionError = errorMessage(epiAdvanceError, "Não foi possível avançar para o próximo EPI.");
        rememberCurrentAssistantPoll(effectiveResult, staged?.nextMessages || effectiveResult.messages);
        if (transferPromptCancelled) {
          attachmentTransferPending = false;
          attachmentTransferCompleted = false;
        } else if (transferConfirmedInResponse
          && !isDifferentActiveFlow(previousState.activeFlow, result.activeFlow)) {
          attachmentTransferCompleted = true;
        } else if (enteredNextTransferredFlow || transferConfirmedInResponse) {
          attachmentTransferPending = false;
          attachmentTransferCompleted = false;
        }
        hydrateMediaPreviews();
        reconcileSavedFlow(effectiveResult, previousState);
        recoveryUncertain = false;
        recoveryPreview = null;
        persistRecovery();
        render();
        if (staged) scheduleResponseTransition(staged.nextMessages);
        scheduleCompletionMenu(effectiveResult);
        if (resumeEpiFinalize) await finalizeEpiProductSelection();
      }
      return confirmed && !epiAdvanceError;
    } catch (error) {
      // Preserve the hidden step so a failed automatic answer can be retried
      // against the same VM question instead of a stale visible poll.
      if (!remoteResponseReceived && behavior.epiFinalizeStep === true && previousAssistantPollSnapshot) {
        currentAssistantPollSnapshot = previousAssistantPollSnapshot;
      }
      if (operation && store.getState().activeText?.id === operation.id && error?.code === "NETWORK_UNCERTAIN") recoveryUncertain = true;
      if (operation) store.failText(operation, error);
      else setSessionError(error, "Não foi possível enviar a mensagem.");
      return false;
    } finally {
      if (editingSignature) {
        signaturePlacementEditPending = false;
        if (!stopped) render();
      }
    }
  }

  async function finalizeEpiProductSelection() {
    if (!epiFinalizeProgress) {
      const selected = [];
      const seen = epiCommittedItemKeys();
      for (const product of epiSelectedProducts.values()) {
        const key = epiDescriptionKey(product.description);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        selected.push(product);
      }
      if (!selected.length) return null;
      if (selected.length + epiCommittedItemCount() > 100) {
        setSessionError(new Error("O comprovante aceita no máximo 100 itens."));
        return false;
      }
      epiFinalizeProgress = { products: selected, index: 0, phase: "select" };
    }

    const progress = epiFinalizeProgress;
    while (progress.index < progress.products.length) {
      const product = progress.products[progress.index];
      if (progress.phase === "select") {
        const chosen = await sendText(product.label, product.replyId, { epiFinalizeStep: true });
        if (!chosen) return false;
        progress.phase = "quantity";
      }
      const isLast = progress.index === progress.products.length - 1;
      const quantitySent = await sendText("1", undefined, {
        skipLineAdditionAdvance: isLast,
        epiFinalizeStep: true,
      });
      if (!quantitySent) return false;
      progress.index += 1;
      progress.phase = progress.index < progress.products.length ? "select" : "finalize";
    }

    if (progress.phase === "finalize") {
      const state = store.getState();
      const currentPoll = currentAssistantPoll();
      const finalizeOption = currentLineDecisionOption(
        currentPoll ? [currentPoll] : state.messages,
        currentAssistantActiveFlow() || state.activeFlow,
      );
      if (!finalizeOption) {
        setSessionError(new Error("Não foi possível concluir a seleção de EPI. Tente novamente."));
        return false;
      }
      const finalized = await sendText(
        String(finalizeOption.label || finalizeOption.title || "❌ NÃO"),
        String(finalizeOption.reply || finalizeOption.id || ""),
        { skipLineAdditionAdvance: true, epiFinalizeStep: true },
      );
      if (finalized) {
        clearLegacyDocumentLineSelection();
        clearEpiProductSelection();
      }
      return finalized;
    }
    return false;
  }

  async function finalizeDocumentLines() {
    const state = store.getState();
    const option = currentDocumentLineFinalizeOption(state.messages);
    if (option?.legacyDocumentLineFinalize === true && epiDirectFinalizeOption) {
      const finalized = await sendText(
        String(epiDirectFinalizeOption.label || epiDirectFinalizeOption.title || "❌ NÃO"),
        String(epiDirectFinalizeOption.reply || epiDirectFinalizeOption.id || ""),
        { skipLineAdditionAdvance: true },
      );
      if (finalized) {
        clearLegacyDocumentLineSelection();
        clearEpiProductSelection();
      }
      return finalized;
    }
    if (epiFinalizeProgress || (documentProductPollKind(latestAssistantPoll(state.messages)) === "epi" && epiSelectedProducts.size)) {
      const checkboxFinalized = await finalizeEpiProductSelection();
      if (checkboxFinalized !== null) return checkboxFinalized;
    }
    if (option?.legacyDocumentLineFinalize !== true || !legacyDocumentLineFinalizeOption) {
      const finalized = await sendText(
        String(option?.label || option?.title || "✅ FINALIZAR"),
        String(option?.reply || option?.id || DOCUMENT_LINE_FINALIZE_ID),
      );
      if (finalized) {
        clearLegacyDocumentLineSelection();
        clearEpiProductSelection();
      }
      return finalized;
    }
    const returnedToDecision = await sendText(
      "↩️ RETORNAR À PERGUNTA ANTERIOR",
      NAVIGATION_BACK_ID,
      { silent: true, preserveDraft: true, skipLineAdditionAdvance: true },
    );
    if (!returnedToDecision) return false;
    const currentState = store.getState();
    const finalizeOption = currentLineDecisionOption(currentState.messages, currentState.activeFlow);
    if (!finalizeOption) {
      setSessionError(new Error("Não foi possível finalizar a seleção de produtos. Tente novamente."));
      return false;
    }
    const finalized = await sendText(
      String(finalizeOption.label || finalizeOption.title || "NÃO"),
      String(finalizeOption.reply || finalizeOption.id || ""),
      { skipLineAdditionAdvance: true },
    );
    if (finalized) {
      clearLegacyDocumentLineSelection();
      clearEpiProductSelection();
    }
    return finalized;
  }

  function reopenGeneratedSignature(command = {}) {
    if (!account || stopped || flowBusy()) return false;
    const state = store.getState();
    const messageId = String(command?.messageId || "").trim();
    const candidates = messageId
      ? state.messages.filter(message => String(message?.id || "") === messageId)
      : [...state.messages].reverse();
    const message = candidates.find(item => {
      const edit = item?.signatureEdit || item?.signature_edit;
      return item?.type === "document"
        && edit?.document?.mediaUrl
        && edit?.signature?.mediaUrl;
    });
    const edit = message?.signatureEdit || message?.signature_edit;
    if (!message || !edit?.document?.mediaUrl || !edit?.signature?.mediaUrl) {
      // A final signed-document card can outlive the active VM flow.  Sending
      // the old command in that state makes the VM interpret it as a fresh
      // navigation request and drops the user at the main menu.  Only retain
      // the legacy command while a signing flow is still active; otherwise
      // keep the current conversation visible and report the missing source.
      if (state.activeFlow?.id === "document_signing") {
        return sendText("Redimensionar assinatura", DOCUMENT_SIGNING_REOPEN_LAST_ID);
      }
      setSessionError(new Error("A fonte do documento assinado não está disponível para redimensionamento."));
      return false;
    }
    const document = {
      ...edit.document,
      id: String(edit.document.id || edit.document.mediaUrl),
      fileName: String(edit.document.fileName || "documento.pdf"),
    };
    const signature = {
      ...edit.signature,
      id: String(edit.signature.id || edit.signature.mediaUrl),
      fileName: String(edit.signature.fileName || "assinatura.png"),
    };
    signaturePlacementOverride = {
      messageId: String(message.id),
      stage: "document_signing_waiting_position",
      document,
      signature,
      signerName: String(
        edit.signerName || edit.signer_name || message.signerName
          || account.displayName || account.name || "USUÁRIO",
      ).trim() || "USUÁRIO",
      signedAt: edit.signedAt || edit.signed_at || message.signedAt || null,
      selection: edit.selection || edit.position || null,
    };
    cancelCompletionMenu();
    cancelAttachmentReminder();
    sessionError = null;
    signaturePlacementGeneration += 1;
    signaturePlacementLoad = null;
    signaturePlacementData = null;
    render();
    return true;
  }

  async function uploadFile(fileId) {
    if (!account || stopped || flowBusy() || (recoveryAccountId && !recoveryVerified)) return false;
    cancelAttachmentReminder();
    cancelResponseTransition();
    const uploadAccount = account;
    const item = store.getState().pendingFiles.find(candidate => candidate.id === fileId);
    if (!item) return false;
    const previousAttachmentCount = store.getState().attachments.length;
    cancelCompletionMenu();
    sessionError = null;
    let operation;
    try {
      attachmentRevision += 1;
      currentAssistantPollSnapshot = null;
      operation = store.beginFile(fileId);
      const cachedResult = item.file.confirmedResult;
      if (cachedResult && (cachedResult.status !== "processed" || !Array.isArray(cachedResult.messages))) {
        throw new Error("A confirmação armazenada do anexo é inválida.");
      }
      const result = cachedResult || await client.sendFile(item.file);
      attachmentRevision += 1;
      const menuResult = isMenuResult(result);
      const responseResult = menuResult
        ? { ...result, activeFlow: null, resetConversation: true, attachments: [] }
        : result;
      const effectiveResult = withUploadedSignaturePlacementSources(responseResult, item);
      const staged = stagedResponse(effectiveResult);
      const confirmed = store.confirmFile(operation, staged?.immediate || effectiveResult);
      if (confirmed) {
        rememberCurrentAssistantPoll(effectiveResult, staged?.nextMessages || effectiveResult.messages);
        hydrateMediaPreviews();
        recoveryUncertain = false;
        persistRecovery();
        const hasRemoteAttachmentSnapshot = Array.isArray(effectiveResult.attachments)
          && effectiveResult.attachments.some(attachment => attachment?.id && attachment?.mediaUrl);
        const uploadCompleted = isMenuResult(effectiveResult) || effectiveResult?.resetConversation === true
          || effectiveResult?.returned_to_main_menu === true
          || (Array.isArray(effectiveResult?.results) && effectiveResult.results.some(item => {
            const status = String(item?.status || "").trim().toLowerCase();
            return status === "completed"
              || status.endsWith("_completed")
              || status === "document_signed";
          }));
        if (uploadCompleted) {
          // A completed upload belongs to the posted message/document, not to
          // the next flow. Clear any attachment snapshot that the VM echoed
          // back so a stale posted file cannot reappear in the tray.
          cancelAttachmentReminder();
          store.syncAttachments([]);
        }
        // Fluxos que terminam o envio (como assinatura de documentos) limpam
        // os anexos na VM de propósito. Nesses casos uma nova consulta deve
        // retornar zero itens e não pode ser tratada como upload falho.
        if (!hasRemoteAttachmentSnapshot && !uploadCompleted
          && typeof client.getAttachments === "function") {
          const synchronized = await syncAttachmentSnapshotAfterUpload(uploadAccount, {
            minimumCount: previousAttachmentCount + 1,
          });
          if (!synchronized) {
            const confirmationError = new Error(
              "A VM não confirmou este anexo. Ele foi mantido como falho para tentar novamente; o formulário está bloqueado até confirmar ou remover o arquivo.",
            );
            store.revertFileConfirmation(operation, confirmationError);
            setSessionError(confirmationError);
            return false;
          }
        }
        if (!uploadCompleted && attachmentReminderDetails()) scheduleAttachmentReminder();
        else cancelAttachmentReminder();
        await maybeOfferAttachmentCompression(item, effectiveResult, uploadCompleted);
        if (staged) scheduleResponseTransition(staged.nextMessages);
        scheduleCompletionMenu(effectiveResult);
      }
      if (confirmed && item.sourceId) {
        try {
          await native.discardSharedItem(item.sourceId);
        } catch (error) {
          setSessionError(error, "O anexo foi enviado, mas a cópia compartilhada não pôde ser limpa.");
        }
      }
      return confirmed;
    } catch (error) {
      if (operation && store.getState().pendingFiles.some(item => item.operationId === operation.id)
        && error?.code === "NETWORK_UNCERTAIN") recoveryUncertain = true;
      if (operation) store.failFile(operation, error);
      else setSessionError(error, "Não foi possível enviar o arquivo.");
      return false;
    }
  }

  function processFiles(fileIds) {
    const ids = [...fileIds];
    const queuedAccount = account;
    uploadQueue = uploadQueue.then(async () => {
      const failures = [];
      let allUploaded = true;
      for (const id of ids) {
        while (!stopped && account === queuedAccount && flowBusy()) {
          await new Promise(resolve => idleWaiters.add(resolve));
        }
        if (stopped || !account || account !== queuedAccount) return false;
        const uploaded = await uploadFile(id);
        if (!uploaded) {
          allUploaded = false;
          const failure = store.getState().error || sessionError;
          if (failure) failures.push(String(failure));
        }
      }
      // A later successful upload clears the store's transient error. Keep
      // the failure banner from this batch visible so the user is told which
      // attachment was removed even when other files continue successfully.
      if (failures.length && !stopped && account === queuedAccount) {
        sessionError = failures.join(" ");
        render();
      }
      return allUploaded && failures.length === 0;
    });
    return uploadQueue;
  }

  async function queueSelectedFiles(selector, options = {}) {
    if (recoveryAccountId && !recoveryVerified) return false;
    cancelAttachmentReminder();
    cancelCompletionMenu();
    const selectionAccount = account;
    sessionError = null;
    render();
    try {
      const knownIds = new Set(store.getState().pendingFiles.map(item => item.id));
      const files = await selector();
      if (stopped || !account || account !== selectionAccount) return false;
      store.queueFiles(files, options);
      const newIds = store.getState().pendingFiles
        .filter(item => !knownIds.has(item.id))
        .map(item => item.id);
      return processFiles(newIds);
    } catch (error) {
      setSessionError(error, "Não foi possível adicionar o anexo.");
      return false;
    }
  }

  async function importSharedFiles() {
    if (sharedImportInFlight) return sharedImportInFlight;
    sharedImportAccount = account;
    sharedImportInFlight = importSharedFilesOnce();
    try {
      return await sharedImportInFlight;
    } finally {
      sharedImportInFlight = null;
      sharedImportAccount = undefined;
    }
  }

  async function importSharedFilesOnce() {
    const importAccount = account;
    const importRevision = sessionRevision;
    const preAuthenticationImport = importAccount == null;
    const stillCurrent = () => !stopped && (preAuthenticationImport
      || (account === importAccount && sessionRevision === importRevision));
    try {
      const files = await withTimeout(native.importSharedItems(), SHARED_IMPORT_TIMEOUT_MS,
        "A leitura dos anexos compartilhados demorou mais que o esperado.");
      if (!stillCurrent()) {
        for (const file of files || []) {
          const sourceId = String(file?.sourceId || "").trim();
          if (sourceId) ignoredSharedIds.add(sourceId);
        }
        return [];
      }
      const currentFiles = (files || []).filter(file => {
        const sourceId = String(file?.sourceId || "").trim();
        return !sourceId || !ignoredSharedIds.has(sourceId);
      });
      store.replaceImportedFiles(currentFiles);
      return store.getState().pendingFiles
        .filter(item => item.sourceId && item.status !== "sending")
        .map(item => item.id);
    } catch (error) {
      if (stillCurrent()) setSessionError(error, "Não foi possível ler os itens compartilhados.");
      return [];
    }
  }

  async function signIn() {
    const signInRevision = ++sessionRevision;
    pendingNoteLaunchProgress = null;
    pendingNoteLaunchNeedsResync = false;
    pendingNoteLaunchOrderId = "";
    pendingNoteLaunchFailed = false;
    sessionStatus = "initializing";
    sessionError = null;
    render();
    try {
      const signedInAccount = await withTimeout(auth.signIn(), signInTimeoutMs,
        "O login Microsoft demorou mais que o esperado. Tente novamente.");
      if (stopped || sessionRevision !== signInRevision) return false;
      const accountKey = value => value?.homeAccountId || value?.localAccountId || value?.username || value?.id || value;
      if (account && (!signedInAccount || accountKey(account) !== accountKey(signedInAccount))) {
        clearEpiProductSelection();
      }
      account = signedInAccount;
      if (!account) {
        clearEpiProductSelection();
        sessionStatus = "signed-out";
        render();
        return false;
      }
      lastPresenceValidationDate = "";
      legacyDocumentLineFinalizeOption = null;
      sessionStatus = "authenticated";
      pendingProvisionSessionDismissed = false;
      pendingNotesSessionDismissed = false;
      clearPendingProvisionAttachmentState({ clearData: true });
      pendingProvisionSharePointAuthorization = null;
      openRecovery();
      render();
      await continueConversation();
      await refreshPendingProvisionSnapshot();
      await refreshPendingNotesSnapshot();
      await refreshDelegatedTasksSnapshot();
      // A shared file may have arrived before the user authenticated. Read
      // the native inbox now that the account is known, then process it with
      // the same upload path as files selected inside the app.
      let importedIds = [];
      if (sharedImportInFlight && sharedImportAccount === null) {
        // A pre-authentication read may belong to the share intent that opened
        // the app. Do not make login wait for a slow Android content provider;
        // process its files when that read eventually completes.
        const pendingImport = sharedImportInFlight;
        pendingImport.then(ids => {
          if (!stopped && account === signedInAccount && sessionRevision === signInRevision) {
            void processFiles(ids);
          }
        }).catch(() => {});
      } else if (!sharedImportInFlight) {
        importedIds = await importSharedFiles();
      }
      const pendingIds = store.getState().pendingFiles
        .filter(item => item.status !== "sending")
        .map(item => item.id);
      await processFiles([...new Set([...importedIds, ...pendingIds])]);
      if (sharedResumeRequested) await resumeSharedFiles();
      return true;
    } catch (error) {
      if (stopped || sessionRevision !== signInRevision) return false;
      // A timeout must release both the JavaScript coalescing promise and the
      // native browser transaction. Otherwise a retry can attach to a call
      // whose callback has already been lost in the Android lifecycle.
      try { await withTimeout(auth.cancelSignIn?.(), 2_000, ""); } catch { /* best effort */ }
      clearEpiProductSelection();
      account = null;
      sessionStatus = "signed-out";
      setSessionError(error, "Não foi possível entrar com a Microsoft.");
      return false;
    }
  }

  async function signOut() {
    disposeLaunchGallery();
    disposeOrdersGallery();
    disposeTasksGallery();
    disposePaymentProgrammingGallery();
    disposeRecurringExpensesGallery();
    disposeRegistrationGalleries();
    sessionRevision += 1;
    sharedResumeRequested = false;
    cancelFlowReminder();
    cancelAttachmentReminder();
    cancelScheduledPendingProvisionReminder();
    cancelCompletionMenu();
    cancelResponseTransition();
    const cleared = recoveryAccountId ? recovery.clear(recoveryAccountId) : true;
    recoveryAccountId = null;
    recoveryPreview = null;
    recoveryReference = null;
    olderReferences = [];
    recoveryUncertain = false;
    recoveryWarning = null;
    pendingProvisionSnapshot = null;
    pendingNotesSnapshot = null;
    pendingNotesSessionDismissed = false;
    pendingNoteLaunchOrderId = "";
    pendingNoteLaunchFailed = false;
    pendingNoteLaunchNeedsResync = false;
    pendingNoteLaunchProgress = null;
    currentAssistantPollSnapshot = null;
    pendingProvisionSettlementPaymentId = "";
    pendingProvisionReminderOpen = false;
    pendingProvisionReminderError = "";
    pendingProvisionRequest = null;
    pendingProvisionSessionDismissed = false;
    clearPendingProvisionAttachmentState({ clearData: true });
    pendingProvisionSharePointAuthorization = null;
    lastPresenceValidationDate = "";
    clearLegacyDocumentLineSelection();
    clearEpiProductSelection();
    delegatedTasksSnapshot = null;
    delegatedTasksRequest = null;
    attachmentTransferPending = false;
    attachmentTransferCompleted = false;
    signaturePlacementEditPending = false;
    invalidateSignaturePlacement({ clearOverride: true });
    account = null;
    attachmentRevision += 1;
    native.closePreview?.();
    sessionStatus = "signed-out";
    sessionError = cleared === false ? "A sessão foi encerrada, mas o aparelho bloqueou a limpeza da prévia local. Limpe os dados deste site se estiver usando um aparelho compartilhado." : null;
    store.clearSession();
    render();
    try {
      await auth.signOut();
      return true;
    } catch (error) {
      setSessionError(error, "Não foi possível sair da conta.");
      return false;
    }
  }

  async function openMedia(messageId) {
    if (!account || stopped) return false;
    const message = store.getState().messages.find(item => item.id === messageId);
    if (!message) {
      setSessionError(new Error("O arquivo solicitado não está mais na conversa."));
      return false;
    }
    try {
      await showMedia(client.fetchMedia(message), message.fileName || message.caption || "arquivo");
      return true;
    } catch (error) {
      setSessionError(error, "Não foi possível abrir o arquivo.");
      return false;
    }
  }

  async function refreshAttachments({ silent = false, force = false } = {}) {
    if (!account || stopped || typeof client.getAttachments !== "function") return false;
    const state = store.getState();
    if (!force && flowBusy()) return false;
    const lastMessage = state.messages.at?.(-1) || state.messages[state.messages.length - 1];
    const lastMessageText = lastMessage?.question || lastMessage?.prompt || lastMessage?.text || "";
    if (!state.activeFlow && isMainMenuPrompt(lastMessageText)) {
      // Attachment snapshots belong to the active flow. Once the VM has
      // returned the main menu, a delayed foreground/page restore must not
      // bring back files consumed by the completed post.
      store.syncAttachments([]);
      return true;
    }
    if (snapshotPending) return snapshotPending;
    const revision = attachmentRevision;
    const snapshotAccount = account;
    snapshotPending = (async () => {
      try {
        const attachments = await client.getAttachments();
        if (stopped || account !== snapshotAccount || attachmentRevision !== revision) return false;
        const synced = store.syncAttachments(attachments);
        hydrateMediaPreviews();
        return synced;
      } catch (error) {
        if (!silent && !stopped && account === snapshotAccount && attachmentRevision === revision) {
          setSessionError(error, "Não foi possível atualizar os anexos.");
        }
        return false;
      } finally {
        snapshotPending = null;
      }
    })();
    return snapshotPending;
  }

  function formatDatePickerValue(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
  }

  function resumeSharedFiles() {
    if (stopped) return Promise.resolve(false);
    sharedResumeRequested = true;
    if (starting || sessionStatus === "initializing") return Promise.resolve(false);
    if (sharedResume) return sharedResume;
    // Coalesce events in this turn, but re-read if another activation arrives
    // while an import or upload is in flight: it can contain new shared files.
    sharedResume = Promise.resolve().then(async () => {
      while (sharedResumeRequested && !stopped && !starting && sessionStatus !== "initializing") {
        sharedResumeRequested = false;
        const resumeAccount = account;
        const resumeRevision = sessionRevision;
        const hadPreAuthenticationImport = sharedImportInFlight && sharedImportAccount === null;
        const ids = await importSharedFiles();
        if (stopped || account !== resumeAccount || sessionRevision !== resumeRevision) continue;
        if (account) await processFiles(ids);
        // If activation overlapped the non-blocking cold-start read, perform
        // one fresh read after it settles so a newly shared item is not hidden
        // behind the earlier empty result.
        if (hadPreAuthenticationImport && !stopped) sharedResumeRequested = true;
      }
      return true;
    }).finally(() => { sharedResume = null; });
    return sharedResume;
  }

  async function syncAttachmentSnapshotAfterUpload(snapshotAccount = account, { minimumCount = 0 } = {}) {
    if (!snapshotAccount || stopped || account !== snapshotAccount || typeof client.getAttachments !== "function") return false;
    // A large upload can be acknowledged before the attachment index is
    // visible to the follow-up snapshot request. Keep the form open while
    // that local VM state catches up instead of marking a confirmed file as
    // failed after only half a second.
    const retryDelays = [250, 500, 1000, 1500];
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        const attachments = await client.getAttachments();
        if (stopped || account !== snapshotAccount) return false;
        const confirmed = (Array.isArray(attachments) ? attachments : [])
          .filter(item => item?.id && item?.mediaUrl);
        if (confirmed.length >= minimumCount) {
          attachmentRevision += 1;
          store.syncAttachments(attachments);
          hydrateMediaPreviews();
          return true;
        }
      } catch {
        // Uma resposta transitória da VM não confirma o upload; tente mais
        // duas vezes antes de devolver o arquivo para retry.
      }
      if (attempt < retryDelays.length) {
        await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
      }
    }
    return false;
  }

  async function showMedia(source, fileName, previewOptions) {
    if (native.previewMedia) return native.previewMedia(source, fileName, previewOptions);
    const previewAccount = account;
    const blob = await source;
    if (!stopped && account === previewAccount) return native.exportMedia(blob, fileName);
  }

  async function loadAttachment(item) {
    if (item.file) return item.file;
    try {
      return await client.fetchMedia(item);
    } catch (error) {
      if (error?.status !== 404) throw error;
      const refreshed = await refreshAttachments({ silent: true, force: true });
      const current = refreshed && store.getState().attachments.find(candidate => candidate.id === item.id);
      if (!current) throw new Error("Este anexo não está mais disponível no fluxo atual. Feche a prévia para voltar ao chat.");
      return client.fetchMedia(current);
    }
  }

  function normalizedSignaturePoint(rawPoint) {
    const page = Number(rawPoint?.page);
    const x = Number(rawPoint?.x);
    const y = Number(rawPoint?.y);
    const scale = Number(rawPoint?.scale ?? 0.5);
    if (!Number.isInteger(page) || page < 1
      || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1
      || !Number.isFinite(scale) || scale < 0.2 || scale > 2) return null;
    return { page, x, y, scale };
  }

  function signedPdfFileName(value) {
    const name = String(value || "documento.pdf").trim() || "documento.pdf";
    return /\.pdf$/i.test(name) ? name.replace(/\.pdf$/i, "-assinado.pdf") : `${name}-assinado.pdf`;
  }

  async function beginAttachmentSignature(fileId, signatureFile) {
    if (!account || stopped || attachmentSigningBusy) return false;
    const item = store.getState().attachments.find(candidate => String(candidate.id) === String(fileId));
    const isPdf = String(item?.mimeType || "").toLowerCase() === "application/pdf"
      || /\.pdf$/i.test(String(item?.fileName || ""));
    if (!item || !isPdf) {
      setSessionError(new Error("Selecione um documento PDF da bandeja para inserir a assinatura."));
      return false;
    }

    const signingAccount = account;
    attachmentSigningBusy = true;
    sessionError = null;
    render();
    try {
      const documentBlob = await loadAttachment(item);
      if (stopped || account !== signingAccount) return false;
      if (!documentBlob || typeof documentBlob.arrayBuffer !== "function") {
        throw new Error("O documento escolhido não pôde ser preparado para assinatura.");
      }
      const signatureId = `local-signature:${item.id}:${Number(signatureFile.lastModified) || Date.now()}`;
      signaturePlacementOverride = {
        kind: "attachment",
        targetAttachmentId: String(item.id),
        messageId: `attachment:${item.id}`,
        stage: "document_signing_waiting_position",
        document: {
          ...item,
          id: String(item.id),
          fileName: String(item.fileName || "documento.pdf"),
          mimeType: "application/pdf",
          blob: documentBlob,
        },
        signature: {
          id: signatureId,
          fileName: String(signatureFile.name || "assinatura-desenhada.png"),
          mimeType: String(signatureFile.type || "image/png"),
          blob: signatureFile,
        },
        signerName: String(account.displayName || account.name || "USUÁRIO").trim() || "USUÁRIO",
        signedAt: new Date().toISOString(),
        uploadMessageId: newUploadMessageId(),
      };
      invalidateSignaturePlacement();
      render();
      return true;
    } catch (error) {
      if (!stopped && account === signingAccount) {
        invalidateSignaturePlacement({ clearOverride: true });
        setSessionError(error, "Não foi possível abrir o PDF para posicionar a assinatura.");
      }
      return false;
    } finally {
      attachmentSigningBusy = false;
      if (!stopped && account === signingAccount) render();
    }
  }

  async function completeAttachmentSignature(rawPoint, stampInput = null) {
    const request = signaturePlacementRequest();
    const placement = localPlacementForRequest(request);
    const point = normalizedSignaturePoint(rawPoint);
    if (!account || stopped || attachmentSigningBusy
      || !["attachment", "document"].includes(placement?.kind) || !point) return false;
    const stamp = stampInput || signaturePlacementStamp;

    const signingAccount = account;
    const previousPlacementData = signaturePlacementData;
    const signingGeneration = signaturePlacementGeneration;
    const stillCurrent = () => !stopped && account === signingAccount
      && (signaturePlacementOverride === placement || request?.key === signaturePlacementRequest()?.key)
      && signaturePlacementGeneration === signingGeneration;
    attachmentSigningBusy = true;
    sessionError = null;
    if (signaturePlacementData) signaturePlacementData = { ...signaturePlacementData, status: "signing" };
    render();
    try {
      const signedBlob = await signPdfAttachment({
        documentBlob: placement.document.blob,
        documentFileName: placement.document.fileName,
        signatureBlob: placement.signature.blob,
        point,
        ...(stamp?.blob && stamp?.point
          ? { stampBlob: stamp.blob, stampPoint: stamp.point }
          : {}),
        signerName: placement.signerName,
        signedAt: placement.signedAt,
      });
      if (!stillCurrent()) return false;
      if (!signedBlob || typeof signedBlob.arrayBuffer !== "function") {
        throw new Error("O PDF assinado não foi gerado corretamente.");
      }
      const fileName = signedPdfFileName(placement.document.fileName);
      const FileCtor = globalThis.File;
      const signedFile = typeof FileCtor === "function"
        ? new FileCtor([signedBlob], fileName, { type: "application/pdf", lastModified: Date.now() })
        : Object.assign(signedBlob, { name: fileName, lastModified: Date.now() });
      Object.defineProperty(signedFile, "uploadMessageId", {
        value: placement.uploadMessageId,
        configurable: true,
      });

      // The generated PDF is the replacement artifact, not a second user
      // attachment. Keep it out of the tray while the VM reconciles the
      // upload and returns the final flow state.
      const uploaded = await queueSelectedFiles(() => [signedFile], {
        hideFromAttachmentTray: true,
      });
      if (!uploaded) throw new Error("O PDF assinado foi preservado para nova tentativa, mas ainda não foi confirmado pela VM.");

      const targetId = String(placement.targetAttachmentId || "");
      // In the document-signing workflow the source PDF remains necessary for
      // "voltar e ajustar assinatura" and the generated payment/EPI preview
      // is a separate workflow artifact. Removing the source here used to
      // make the backend fall back to the generic "envie um PDF" stage.
      if (shouldRemoveSignedSource(targetId, placement.preserveSource)) {
        const currentSource = await resolveCurrentAttachment(targetId, placement.document);
        if (currentSource) {
          const removed = await removeAttachment(currentSource.id, { confirm: false, allowBusy: true });
          if (!removed && store.getState().attachments.some(item => String(item.id) === String(currentSource.id))) {
            sessionError = "O PDF assinado foi adicionado, mas o documento original não pôde ser retirado da bandeja.";
          }
        } else {
          const indistinguishableSources = store.getState().attachments.filter(item => (
            item.fileName === placement.document.fileName
            && item.mimeType === placement.document.mimeType
          ));
          if (indistinguishableSources.length > 0) {
            sessionError = "O PDF assinado foi adicionado, mas o original não pôde ser identificado entre arquivos iguais. Os originais idênticos foram preservados para evitar excluir o documento errado.";
          }
        }
      }
      invalidateSignaturePlacement({ clearOverride: true });
      render();
      return true;
    } catch (error) {
      if (!stopped && account === signingAccount) {
        signaturePlacementData = previousPlacementData;
        setSessionError(error, "Não foi possível gerar e adicionar o PDF assinado.");
      }
      return false;
    } finally {
      attachmentSigningBusy = false;
      if (!stopped && account === signingAccount) render();
    }
  }

  async function openFile(fileId) {
    if (!account || stopped) return false;
    const state = store.getState();
    const item = state.pendingFiles.find(file => file.id === fileId)
      || state.attachments.find(file => file.id === fileId);
    if (!item) return false;
    try {
      await showMedia(loadAttachment(item), item.fileName || item.file?.name || "arquivo");
      return true;
    } catch (error) {
      if (!stopped && account) setSessionError(error, "Não foi possível visualizar o anexo.");
      return false;
    }
  }

  async function shareAttachment(fileId) {
    if (!account || stopped) return false;
    const shareAccount = account;
    const state = store.getState();
    const item = state.pendingFiles.find(file => file.id === fileId)
      || state.attachments.find(file => file.id === fileId);
    if (!item) return false;
    try {
      const blob = await loadAttachment(item);
      if (stopped || account !== shareAccount) return false;
      const result = await native.exportMedia(blob, item.fileName || item.file?.name || "arquivo");
      return result !== null;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      if (!stopped && account === shareAccount) setSessionError(error, "Não foi possível encaminhar o anexo.");
      return false;
    }
  }

  async function removeFile(fileId) {
    const item = store.getState().pendingFiles.find(candidate => candidate.id === fileId);
    if (!item || item.status === "sending") return false;
    try {
      cancelAttachmentReminder();
      if (item.sourceId) await native.discardSharedItem(item.sourceId);
      return store.discardFile(fileId);
    } catch (error) {
      setSessionError(error, "Não foi possível remover o anexo.");
      return false;
    }
  }

  async function removeAttachment(fileId, { confirm = true, allowBusy = false } = {}) {
    if (!account || stopped || (!allowBusy && flowBusy()) || typeof client.deleteAttachment !== "function") return false;
    const item = store.getState().attachments.find(candidate => candidate.id === fileId);
    if (!item) return false;
    if (confirm && typeof globalThis.confirm === "function"
      && !globalThis.confirm(`Excluir o anexo “${item.fileName || "arquivo"}” deste fluxo?`)) return false;
    cancelAttachmentReminder();
    cancelCompletionMenu();
    sessionError = null;
    const removalAccount = account;
    attachmentRevision += 1;
    try {
      const result = await client.deleteAttachment(item.id);
      if (stopped || account !== removalAccount) return false;
      attachmentRevision += 1;
      store.removeAttachment(item.id);
      if (Array.isArray(result?.attachments)) store.syncAttachments(result.attachments);
      hydrateMediaPreviews();
      render();
      return true;
    } catch (error) {
      if (!stopped && account === removalAccount) setSessionError(error, "Não foi possível excluir o anexo.");
      return false;
    }
  }

  async function removeAllAttachments() {
    if (!account || stopped || flowBusy() || typeof client.deleteAllAttachments !== "function") return false;
    const state = store.getState();
    const hasNewAttachment = state.attachments.some(item => item?.existing !== true
      && item?.readOnly !== true && item?.origin !== "existing");
    if (state.activeFlow?.allowBulkAttachmentDelete !== true || !hasNewAttachment) return false;
    if (typeof globalThis.confirm === "function"
      && !globalThis.confirm("TEM CERTEZA QUE DESEJA DELETAR TODOS OS ANEXOS DESSE FLUXO?")) return false;
    cancelAttachmentReminder();
    cancelCompletionMenu();
    sessionError = null;
    const actionAccount = account;
    attachmentActionBusy = true;
    attachmentRevision += 1;
    render();
    try {
      const result = await client.deleteAllAttachments();
      if (stopped || account !== actionAccount) return false;
      store.ingestRemoteMessages(result?.messages, { ...result, resetConversation: false, attachments: result?.attachments || [] });
      rememberCurrentAssistantPoll(result, result?.messages);
      if (Array.isArray(result?.attachments)) store.syncAttachments(result.attachments);
      hydrateMediaPreviews();
      return true;
    } catch (error) {
      if (!stopped && account === actionAccount) setSessionError(error, "Não foi possível eliminar os anexos.");
      return false;
    } finally {
      attachmentActionBusy = false;
      attachmentRevision += 1;
      if (!stopped) render();
    }
  }

  async function resolveCurrentAttachment(fileId, reference = null) {
    const previous = reference || store.getState().attachments.find(candidate => candidate.id === fileId);
    if (!previous) return null;
    // The VM derives the public id from the current flow revision. A response
    // that omitted attachments could leave the UI with an id from the prior
    // revision, so refresh before actions that mutate a retained file.
    await refreshAttachments({ silent: true, force: true });
    const current = store.getState().attachments;
    const exact = current.find(candidate => candidate.id === fileId);
    if (exact) return exact;
    const sameFile = current.filter(candidate => (
      candidate.fileName === previous.fileName
      && candidate.mimeType === previous.mimeType
      && Number(candidate.size) === Number(previous.size)
    ));
    if (sameFile.length === 1) return sameFile[0];
    // Some VM paths recalculate the displayed size while retaining the same
    // file. If the name/type identify a single current file, it is safe to
    // use that refreshed entry even when its metadata size changed slightly.
    const sameNamedType = current.filter(candidate => (
      candidate.fileName === previous.fileName && candidate.mimeType === previous.mimeType
    ));
    return sameNamedType.length === 1 ? sameNamedType[0] : null;
  }

  async function compressAttachment(fileId) {
    if (!account || stopped || flowBusy() || typeof client.compressAttachment !== "function") return false;
    const item = await resolveCurrentAttachment(fileId);
    if (!item) return false;
    cancelAttachmentReminder();
    cancelCompletionMenu();
    sessionError = null;
    const actionAccount = account;
    attachmentActionBusy = true;
    attachmentRevision += 1;
    render();
    try {
      currentAssistantPollSnapshot = null;
      const result = attachCompressionPreview(await client.compressAttachment(item.id), item);
      if (stopped || account !== actionAccount) return false;
      store.ingestRemoteMessages(result.messages, { ...result, resetConversation: false, attachments: result.attachments });
      rememberCurrentAssistantPoll(result, result.messages);
      hydrateMediaPreviews();
      return true;
    } catch (error) {
      if (!stopped && account === actionAccount) setSessionError(error, "Não foi possível comprimir o anexo.");
      return false;
    } finally {
      attachmentActionBusy = false;
      attachmentRevision += 1;
      if (!stopped) render();
    }
  }

  async function maybeOfferAttachmentCompression(uploadedItem, result, uploadCompleted) {
    if (uploadCompleted || typeof client.compressAttachment !== "function") return false;
    const uploadedFile = uploadedItem?.file;
    if (!(Number(uploadedFile?.size) > AUTO_COMPRESSION_THRESHOLD_BYTES)) return false;
    if (hasAttachmentCompressionChoice(result?.messages)) return false;
    const state = store.getState();
    if (!state.activeFlow) return false;
    const candidates = state.attachments.filter(item => (
      item?.fileName === uploadedFile?.name
      && (!uploadedFile?.type || !item?.mimeType || item.mimeType === uploadedFile.type)
      && (!Number(uploadedFile?.size) || !Number(item?.size) || Number(item.size) === Number(uploadedFile.size))
    ));
    const attachment = candidates.at(-1);
    if (!attachment?.id) return false;
    return compressAttachment(attachment.id);
  }

  async function chooseAttachmentCompression(choice) {
    if (!account || stopped || flowBusy() || typeof client.chooseAttachmentCompression !== "function") return false;
    cancelAttachmentReminder();
    cancelCompletionMenu();
    sessionError = null;
    const actionAccount = account;
    attachmentActionBusy = true;
    attachmentRevision += 1;
    render();
    try {
      currentAssistantPollSnapshot = null;
      const result = await client.chooseAttachmentCompression(choice);
      if (stopped || account !== actionAccount) return false;
      store.ingestRemoteMessages(result.messages, { ...result, resetConversation: false, attachments: result.attachments });
      rememberCurrentAssistantPoll(result, result.messages);
      hydrateMediaPreviews();
      return true;
    } catch (error) {
      if (!stopped && account === actionAccount) setSessionError(error, "Não foi possível concluir a escolha do anexo.");
      return false;
    } finally {
      attachmentActionBusy = false;
      attachmentRevision += 1;
      if (!stopped) render();
    }
  }

  function bind(type, handler) {
    unsubscribeCommands.push(view.on(type, handler));
  }

  function bindCommands() {
    bind("draft-changed", command => { draftEditRevision += 1; cancelCompletionMenu(); store.setDraft(command.value); });
    bind("database-filter-changed", scheduleDatabaseFilter);
    bind("epi-product-selection-changed", updateEpiProductSelection);
    bind("epi-product-select-all", updateEpiProductSelectionBatch);
    bind("recover-draft", recoverDraft);
    bind("dismiss-recovery", () => {
      recoveryPreview = null;
      recoveryReference = olderReferences[0] || null;
      olderReferences = olderReferences.slice(1);
      persistRecovery(); render();
    });
    bind("send-text", () => sendText());
    bind("date-selected", command => {
      const formatted = formatDatePickerValue(command.value);
      return formatted ? sendText(formatted) : false;
    });
    bind("select-reply", command => {
      if (/^pending_document_delete:\d+$/i.test(String(command.replyId || ""))) return false;
      if (command.replyId === POWERBI_DASHBOARD_REPLY_ID) return openPowerBiDashboard();
      if (REGISTRATION_GALLERY_KIND[command.replyId]) return openRegistrationGallery(REGISTRATION_GALLERY_KIND[command.replyId], command.replyId);
      if (command.replyId === LAUNCH_GALLERY_ID) return openLaunchGallery();
      if (command.replyId === ORDERS_GALLERY_ID) return openOrdersGallery();
      if (command.replyId === TASKS_GALLERY_ID) return openTasksGallery();
      if (command.replyId === PAYMENT_PROGRAMMING_GALLERY_ID) return openPaymentProgrammingGallery();
      if (command.replyId === RECURRING_EXPENSES_GALLERY_ID) return openRecurringExpensesGallery();
      const state = store.getState();
      syncEpiDeliverySnapshot(state.activeFlow);
      if ([EPI_ORDER_BLANK_REPLY_ID, EPI_SUPPLIER_DOCUMENT_BLANK_REPLY_ID].includes(command.replyId)) {
        const poll = latestAssistantPoll(state.messages);
        const optionIsCurrent = (poll?.options || []).some(option => [
          option?.id,
          option?.reply,
          option?.replyId,
        ].some(value => String(value || "") === command.replyId));
        if (!documentSigningFlow(state.activeFlow) || !optionIsCurrent) return false;
        return sendText("", command.replyId, { silent: true });
      }
      if (command.replyId === "document_signing_epi") clearEpiProductSelection();
      if (command.replyId === DOCUMENT_LINE_FINALIZE_ID) return finalizeDocumentLines();
      const currentPoll = latestAssistantPoll(state.messages);
      if (documentSigningFlow(state.activeFlow) && documentProductPollKind(currentPoll) === "epi") {
        const productOption = currentPoll.options.find(option => epiOptionMatchesReply(option, command.replyId));
        if (productOption) {
          const product = epiProductDetails(productOption);
          const key = epiDescriptionKey(product.description);
          if (key && epiCommittedItemKeys().has(key)) {
            setSessionError(new Error("Este produto já foi incluído; o PDF não aceita descrições repetidas."));
            return false;
          }
          if (key && !epiSelectedProducts.has(product.id)
            && epiSelectedProducts.size + epiCommittedItemCount() >= 100) {
            setSessionError(new Error("O comprovante aceita no máximo 100 itens."));
            return false;
          }
          pendingEpiButtonProduct = product;
        }
      }
      if (command.replyId === PRESENCE_OTHER_DATES_REPLY_ID) {
        const pending = [...state.messages].reverse().find(message => (
          Array.isArray(message?.presenceDateAllOptions)
          && message?.presenceDateExpanded !== true
        ));
        if (!pending) return false;
        lastPresenceValidationDate = "";
        return store.replaceCurrentResponse([expandPresenceDatesMessage(pending)]);
      }
      const pendingDocumentDelete = String(command.replyId || "").match(/^pending_document_delete_confirmed:(\d+)$/i);
      if (pendingDocumentDelete) {
        if (flowBusy()) return false;
        return sendText(command.label || `Documento ${pendingDocumentDelete[1]}`, command.replyId);
      }
      if (command.replyId?.startsWith("attachment_compression_")) {
        return chooseAttachmentCompression(command.replyId);
      }
      if (command.replyId === "navigation_main_menu") {
        return sendText("", PORTAL_MAIN_MENU_CONFIRM_ID);
      }
      if (command.replyId === "attachment_upload_skip") {
        discardExpiredTemporaryAttachment();
        return sendText("", "input_continue");
      }
      if (latestDatabaseFilter(state.messages)) {
        cancelDatabaseFilter({ resetLast: true });
        store.setDraft("");
      }
      return sendText(command.label, command.replyId);
    });
    bind("show-summary", () => sendText("resumo", "flow_summary"));
    bind("finish-flow", () => {
      if (flowBusy()) return false;
      return sendText("FINALIZAR");
    });
    bind("edit-launch-line", command => sendText(command.label, command.replyId));
    bind("delete-launch-line", command => {
      if (flowBusy()) return;
      if (typeof globalThis.confirm === "function" && !globalThis.confirm(`${command.label}? Esta linha será retirada do lançamento em andamento.`)) return;
      return sendText(command.label, command.replyId);
    });
    bind("transfer-attachments", async () => {
      if (flowBusy()) return;
      const previousPending = attachmentTransferPending;
      const previousCompleted = attachmentTransferCompleted;
      attachmentTransferPending = store.getState().attachments.length > 0;
      attachmentTransferCompleted = false;
      const sent = await sendText("", PORTAL_TRANSFER_ATTACHMENTS_ID);
      if (!sent) {
        attachmentTransferPending = previousPending;
        attachmentTransferCompleted = previousCompleted;
      }
      return sent;
    });
    bind("capture-photo", () => queueSelectedFiles(() => native.capturePhoto()));
    bind("pick-photos", () => queueSelectedFiles(() => native.pickPhotos()));
    bind("pick-document-files", () => queueSelectedFiles(() => native.pickDocuments()));
    bind("files-dropped", command => queueSelectedFiles(() => command.files));
    bind("signature-captured", command => {
      const file = command?.file;
      if (!file || typeof file !== "object") return false;
      if (command.fileId === "launch-gallery") {
        gallerySignatureResolve?.(file);
        gallerySignatureResolve = null;
        return true;
      }
      if (command?.fileId && store.getState().activeFlow?.id !== "document_signing") {
        return beginAttachmentSignature(command.fileId, file);
      }
      return queueSelectedFiles(() => [file], { hideFromAttachmentTray: true });
    });
    bind("signature-cancelled", command => {
      if (command.fileId !== "launch-gallery") return;
      gallerySignatureResolve?.(null);
      gallerySignatureResolve = null;
    });
    bind("signature-placement-position", command => {
      if (flowBusy()) return false;
      const point = normalizedSignaturePoint(command?.point);
      if (!point) return false;
      const commandStamp = command?.stampBlob && command?.stampPoint
        ? { blob: command.stampBlob, point: normalizedSignaturePoint(command.stampPoint) }
        : null;
      const stamp = commandStamp?.point ? commandStamp : signaturePlacementStamp;
      if (stamp?.point) {
        const request = signaturePlacementRequest();
        if (localPlacementForRequest(request)) return completeAttachmentSignature(point, stamp);
        setSessionError(new Error("Este PDF ainda não está disponível localmente para receber a assinatura de Bernardo."));
        return false;
      }
      if (signaturePlacementOverride?.kind === "attachment") return completeAttachmentSignature(point, stamp);
      const { page, x, y, scale } = point;
      const normalizedX = x.toFixed(6);
      const normalizedY = y.toFixed(6);
      const normalizedScale = scale.toFixed(6);
      return sendText("Posicionar assinatura", `document_signing_position_point:${page}:${normalizedX}:${normalizedY}:${normalizedScale}`);
    });
    bind("signature-placement-edit", () => {
      if (signaturePlacementOverride?.kind === "attachment") {
        const fileId = signaturePlacementOverride.targetAttachmentId;
        invalidateSignaturePlacement({ clearOverride: true });
        render();
        return view.openSignaturePad?.(fileId) ?? false;
      }
      return sendText("Editar assinatura", DOCUMENT_SIGNING_EDIT_SIGNATURE_ID);
    });
    bind("signature-placement-stamp", command => {
      const stampPoint = normalizedSignaturePoint(command?.stampPoint);
      const stampBlob = command?.stampBlob;
      const request = signaturePlacementRequest();
      if (!stampBlob || typeof stampBlob.arrayBuffer !== "function" || !stampPoint || !request) return false;
      signaturePlacementStamp = { key: request.key, blob: stampBlob, point: stampPoint };
      return true;
    });
    bind("resize-signature", command => reopenGeneratedSignature(command));
    bind("signature-placement-close", () => {
      if (signaturePlacementOverride) {
        if (attachmentSigningBusy) return false;
        invalidateSignaturePlacement({ clearOverride: true });
        render();
        return true;
      }
      return sendText("Voltar", DOCUMENT_SIGNING_POSITION_BACK_ID);
    });
    // Keep the command available to native hosts that emit the legacy event
    // directly; the visible clip button now opens the source chooser first.
    bind("pick-files", () => queueSelectedFiles(() => native.pickDocuments()));
    bind("retry-file", command => processFiles([command.fileId]));
    bind("remove-file", command => removeFile(command.fileId));
    bind("remove-attachment", command => removeAttachment(command.fileId));
    bind("delete-all-attachments", () => removeAllAttachments());
    bind("compress-attachment", command => compressAttachment(command.fileId));
    bind("open-media", command => openMedia(command.messageId));
    bind("open-file", command => openFile(command.fileId));
    bind("share-attachment", command => shareAttachment(command.fileId));
    bind("close-pending-provisions", closePendingProvisions);
    bind("dismiss-pending-provisions", dismissPendingProvisions);
    bind("dismiss-pending-notes", dismissPendingNotes);
    bind("launch-pending-note", command => launchPendingNote(command.orderId));
    bind("cancel-pending-provisions-reminder", cancelPendingProvisionReminderChoice);
    bind("pending-provisions-reminder-choice", command => choosePendingProvisionReminder(command.value));
    bind("edit-pending-provision-due-date", command => editPendingProvisionDueDate(command.paymentId));
    bind("cancel-pending-provision-date-edit", cancelPendingProvisionDateEdit);
    bind("save-pending-provision-due-date", command => savePendingProvisionDueDate(command.paymentId, command.value));
    bind("settle-pending-provision", command => settlePendingProvision(command.paymentId));
    bind("toggle-pending-provision-attachments", command => togglePendingProvisionAttachments(command.paymentId));
    bind("retry-pending-provision-attachments", command => retryPendingProvisionAttachments(command.paymentId));
    bind("open-pending-provision-attachment", command => openPendingProvisionAttachment(command.paymentId, command.fileName));
    bind("share-pending-provision-attachment", command => sharePendingProvisionAttachment(command.paymentId, command.fileName));
    bind("pick-pending-provision-attachments", command => pickPendingProvisionAttachments(command.paymentId));
    bind("remove-pending-provision-upload", command => removePendingProvisionUpload(command.paymentId, command.uploadId));
    bind("send-pending-provision-attachments", command => sendPendingProvisionAttachments(command.paymentId));
    bind("complete-delegated-task", command => completeDelegatedTask(command.taskId));
    bind("delegated-tasks-reordered", command => reorderDelegatedTasks(command.order));
    bind("sign-in", signIn);
    bind("sign-out", signOut);
    bind("retry-session", () => (account ? continueConversation() : signIn()));
  }

  function registerResumeListener(startRevision) {
    try {
      // Register in the background. Some Android WebViews can delay installing
      // an App listener; that must not prevent the login screen from becoming
      // usable.
      const registration = native.onResume?.(() => {
        handleForeground();
        return resumeSharedFiles();
      }, handleBackground);
      void withTimeout(registration, RESUME_LISTENER_TIMEOUT_MS,
        "A inscrição para acompanhar o aplicativo demorou mais que o esperado.")
        .then(dispose => {
          if (stopped) dispose?.();
          else unsubscribeResume = dispose;
        })
        .catch(error => {
          if (!stopped && sessionRevision === startRevision) {
            setSessionError(error, "Não foi possível acompanhar os arquivos compartilhados. Feche e abra o aplicativo para recebê-los.");
          }
        });
    } catch (error) {
      if (!stopped && sessionRevision === startRevision) {
        setSessionError(error, "Não foi possível acompanhar os arquivos compartilhados. Feche e abra o aplicativo para recebê-los.");
      }
    }
  }

  async function start() {
    if (started) return;
    started = true;
    stopped = false;
    starting = true;
    const startRevision = sessionRevision;
    bindCommands();
    unsubscribeRecovery = recovery?.subscribe?.(ok => {
      recoveryWarning = ok ? null : storageWarning;
      if (!stopped) render();
    });
    unsubscribeStore = store.subscribe(() => {
      persistRecovery();
      render();
      if (globalThis.document?.visibilityState !== "hidden") armFlowReminder();
    });
    render();
    registerResumeListener(startRevision);

    if (stopped || sessionRevision !== startRevision) { starting = false; return; }
    try {
      const initializedAccount = await withTimeout(auth.initialize(), initializeTimeoutMs,
        "A verificação da sessão Microsoft demorou mais que o esperado.");
      if (stopped || sessionRevision !== startRevision) { starting = false; return; }
      account = initializedAccount;
    } catch (error) {
      if (stopped || sessionRevision !== startRevision) { starting = false; return; }
      // The controller timeout only detaches from the promise. Explicitly
      // release the authentication service so the next tap can retry the
      // native initialization instead of waiting on the expired call.
      try { await withTimeout(auth.cancelSignIn?.(), 2_000, ""); } catch { /* best effort */ }
      account = null;
      sessionError = errorMessage(error, "Não foi possível verificar a sessão Microsoft.");
    }

    sessionStatus = account ? "authenticated" : "signed-out";
    pendingProvisionSessionDismissed = false;
    pendingNotesSessionDismissed = false;
    clearPendingProvisionAttachmentState({ clearData: true });
    pendingProvisionSharePointAuthorization = null;
    openRecovery();
    render();
    const sharedFileIdsPromise = importSharedFiles();
    if (account) {
      await continueConversation();
      await refreshPendingProvisionSnapshot();
      await refreshPendingNotesSnapshot();
      await refreshDelegatedTasksSnapshot();
      const sharedFileIds = await sharedFileIdsPromise;
      await processFiles(sharedFileIds);
    } else {
      // Keep importing a file shared before authentication, but never hold the
      // login screen on native storage or a slow content provider.
      void sharedFileIdsPromise;
    }
    starting = false;
    if (sharedResumeRequested) await resumeSharedFiles();
    const pendingAction = account ? auth.consumePendingAction?.() : null;
    if (pendingAction === ORDERS_GALLERY_ID) await openOrdersGallery();
    else if (pendingAction === TASKS_GALLERY_ID) await openTasksGallery();
    else if (pendingAction === PAYMENT_PROGRAMMING_GALLERY_ID) await openPaymentProgrammingGallery();
    else if (pendingAction === RECURRING_EXPENSES_GALLERY_ID) await openRecurringExpensesGallery();
    else if (pendingAction === POWERBI_DASHBOARD_REPLY_ID) await openPowerBiDashboard();
    else if (REGISTRATION_GALLERY_KIND[pendingAction]) await openRegistrationGallery(REGISTRATION_GALLERY_KIND[pendingAction], pendingAction);
  }

  function stop() {
    pendingNoteLaunchProgress = null;
    pendingNoteLaunchNeedsResync = false;
    disposeLaunchGallery();
    disposeOrdersGallery();
    disposeTasksGallery();
    disposePaymentProgrammingGallery();
    disposeRecurringExpensesGallery();
    disposeRegistrationGalleries();
    flushRecovery();
    cancelFlowReminder();
    cancelAttachmentReminder();
    pendingProvisionReminderRevision += 1;
    if (pendingProvisionReminderTimer !== null) clearTimeout(pendingProvisionReminderTimer);
    pendingProvisionReminderTimer = null;
    clearPendingProvisionAttachmentState({ clearData: true });
    cancelCompletionMenu();
    cancelResponseTransition();
    cancelDatabaseFilter({ resetLast: true });
    stopped = true;
    sharedResumeRequested = false;
    idleWaiters.forEach(resolve => resolve());
    idleWaiters.clear();
    attachmentRevision += 1;
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    previewUrls.clear();
    previewTimers.forEach(timer => clearTimeout(timer));
    previewTimers.clear();
    previewLoading.clear();
    signaturePlacementGeneration += 1;
    signaturePlacementLoad = null;
    signaturePlacementData = null;
    signaturePlacementOverride = null;
    signaturePlacementEditPending = false;
    native.closePreview?.();
    unsubscribeStore?.();
    unsubscribeStore = null;
    unsubscribeRecovery?.();
    unsubscribeRecovery = null;
    unsubscribeResume?.();
    unsubscribeResume = null;
    unsubscribeCommands.splice(0).forEach(unsubscribe => unsubscribe?.());
    view.destroy?.();
  }

  return Object.freeze({
    start,
    stop,
    sendText,
    uploadFile,
    refreshAttachments,
    flushRecovery,
    handleBackground,
    handleForeground,
    refreshDelegatedTasksSnapshot,
  });
}
