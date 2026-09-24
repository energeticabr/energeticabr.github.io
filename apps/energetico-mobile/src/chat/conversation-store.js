import { normalizeLaunchSnapshot } from "./launch-snapshot.js";
import { normalizeMeasurementSnapshot } from "./measurement-snapshot.js";

function cloneRemoteMessage(message, nextId) {
  const type = ["text", "poll", "image", "document"].includes(message?.type)
    ? message.type
    : "text";
  return Object.freeze({
    ...message,
    id: String(message?.id || nextId()),
    role: "assistant",
    type,
    ...(Array.isArray(message?.options)
      ? { options: Object.freeze(message.options.map(option => Object.freeze({ ...option }))) }
      : {}),
  });
}

function freezePending(item) {
  return Object.freeze({ ...item });
}

function freezeState(state) {
  return Object.freeze({
    ...state,
    messages: Object.isFrozen(state.messages) ? state.messages : Object.freeze([...state.messages]),
    attachments: Object.isFrozen(state.attachments) ? state.attachments : Object.freeze(state.attachments.map(item => Object.freeze({ ...item }))),
    pendingFiles: Object.isFrozen(state.pendingFiles) ? state.pendingFiles : Object.freeze(state.pendingFiles.map(freezePending)),
  });
}

function isAuditLogReport(message) {
  const question = String(message?.question || message?.prompt || message?.text || message?.caption || "");
  if (/LOG\s+DE\s+A[CÇ][OÕ]ES\s*[—-]/i.test(question)) return true;
  if (message?.type === "poll") {
    return (Array.isArray(message.options) ? message.options : []).some(option => (
      String(option?.reply || option?.id || "").trim().toLowerCase().startsWith("audit_log_row:")
    ));
  }
  return /LOG\s+DE\s+A[CÇ][OÕ]ES/i.test(question);
}

function isAuditLogQuery(text, replyId) {
  const reply = String(replyId || "").trim().toLowerCase();
  if (reply === "audit_log" || reply.startsWith("audit_log_row:")) return true;
  const value = String(text || "").trim();
  return /\b(?:\d{1,4}[./-]\d{1,2}[./-]\d{1,4}|hoje|ontem|amanh[ãa])\b/i.test(value);
}

function normalizeEpiDeliverySnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const normalizeProduct = item => {
    if (!item || typeof item !== "object") return null;
    const description = String(item.description ?? "");
    const unit = String(item.unit ?? "");
    if (!description) return null;
    return Object.freeze({
      description,
      ...(item.quantity != null ? { quantity: String(item.quantity) } : {}),
      unit,
    });
  };
  const snapshot = { stage: String(value.stage || "") };
  if (Object.hasOwn(value, "pendingProduct")) {
    snapshot.pendingProduct = normalizeProduct(value.pendingProduct);
  }
  if (Array.isArray(value.items)) {
    snapshot.items = Object.freeze(value.items.slice(0, 101).map(normalizeProduct).filter(Boolean));
  }
  return Object.freeze(snapshot);
}

export function createConversationStore({
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
  historyMode = "full",
} = {}) {
  let sequence = 0;
  const nextId = () => (
    typeof randomUUID === "function" ? String(randomUUID()) : `local-${++sequence}`
  );
  const listeners = new Set();
  let draftVersion = 0;
  let state = freezeState({
    draft: "",
    messages: [],
    attachments: [],
    pendingFiles: [],
    activeText: null,
    activeFlow: null,
    completionNavigation: null,
    error: null,
  });

  function publish(nextState) {
    state = freezeState(nextState);
    listeners.forEach(listener => listener(state));
    return state;
  }

  function remoteMessages(messages) {
    return (messages || []).filter(message => {
      if (["poll", "image", "document"].includes(message?.type)) return true;
      return (!message?.type || message.type === "text") && String(message?.text || "").trim();
    }).map(message => cloneRemoteMessage(message, nextId));
  }

  function nextMessages(messages, { resetConversation = false, userMessage, replaceAuditReport = false } = {}) {
    const incoming = remoteMessages(messages);
    const previous = replaceAuditReport
      ? state.messages.filter(message => !isAuditLogReport(message))
      : state.messages;
    if (historyMode === "current-step") {
      // Keep the current prompt if the server confirms without sending its replacement.
      return incoming.length || resetConversation ? incoming : previous;
    }
    return [
      ...(resetConversation ? [] : previous),
      ...(userMessage ? [userMessage] : []),
      ...incoming,
    ];
  }

  function signatureFromFlow(activeFlow) {
    const signature = activeFlow?.documentSigningPlacement?.signature;
    return signature && typeof signature === "object" ? signature : null;
  }

  function sameAttachmentValue(left, right) {
    return String(left || "").trim().toLocaleLowerCase() === String(right || "").trim().toLocaleLowerCase();
  }

  function isSignatureAttachment(item, activeFlow) {
    const signature = signatureFromFlow(activeFlow);
    if (!signature) return false;
    if (signature.id && sameAttachmentValue(item?.id, signature.id)) return true;
    if (signature.mediaUrl && sameAttachmentValue(item?.mediaUrl, signature.mediaUrl)) return true;
    return signature.fileName && sameAttachmentValue(item?.fileName, signature.fileName);
  }

  function isHiddenUploadedAttachment(item, uploadedItem) {
    if (uploadedItem?.hideFromAttachmentTray !== true) return false;
    if (String(item?.id || "") === String(uploadedItem.id || "")) return true;
    const uploadedFile = uploadedItem.file;
    const uploadedName = String(uploadedFile?.name || "").trim().toLocaleLowerCase();
    const attachmentName = String(item?.fileName || "").trim().toLocaleLowerCase();
    if (!uploadedName || !attachmentName || uploadedName !== attachmentName) return false;
    const uploadedType = String(uploadedFile?.type || "").trim().toLocaleLowerCase();
    const attachmentType = String(item?.mimeType || "").trim().toLocaleLowerCase();
    if (uploadedType && attachmentType && uploadedType !== attachmentType) return false;
    const uploadedSize = Number(uploadedFile?.size);
    const attachmentSize = Number(item?.size);
    return !Number.isFinite(uploadedSize) || !Number.isFinite(attachmentSize)
      || uploadedSize <= 0 || attachmentSize <= 0 || uploadedSize === attachmentSize;
  }

  function visibleAttachments(items, activeFlow, uploadedItem) {
    return items.filter(item => !isSignatureAttachment(item, activeFlow)
      && !isHiddenUploadedAttachment(item, uploadedItem));
  }

  function nextAttachments(result = {}, uploadedItem) {
    if (result.status === "construction_diary_abandoned") return [];
    const activeFlow = Object.hasOwn(result, "activeFlow") ? result.activeFlow : state.activeFlow;
    if (Array.isArray(result.attachments)) {
      // Algumas respostas da VM não incluem a coleção de anexos (ou a
      // serializam como vazia) ao reapresentar a pergunta seguinte. Não
      // descarte a lista local nesse caso: o snapshot explícito continua
      // sendo usado por syncAttachments e pelas ações de excluir/compactar.
      if (!result.attachments.length && result.resetConversation !== true) {
        return [
          ...visibleAttachments(state.attachments, activeFlow, uploadedItem),
          ...(uploadedItem && uploadedItem.hideFromAttachmentTray !== true ? [{
            id: uploadedItem.id,
            fileName: uploadedItem.file.name,
            mimeType: uploadedItem.file.type,
            size: uploadedItem.file.size,
            file: uploadedItem.file,
          }] : []),
        ];
      }
      return visibleAttachments(result.attachments.filter(item => item?.id && item?.mediaUrl), activeFlow, uploadedItem)
        .map(item => ({
        id: String(item.id),
        fileName: String(item.fileName || "arquivo"),
        mimeType: String(item.mimeType || "application/octet-stream"),
        size: Number(item.size || 0),
        mediaUrl: String(item.mediaUrl),
        ...(item.existing === true ? { existing: true } : {}),
        ...(item.readOnly === true ? { readOnly: true } : {}),
        ...(item.previewUrl ? { previewUrl: String(item.previewUrl) } : {}),
        }));
    }
    return [
      ...(result.resetConversation === true ? [] : visibleAttachments(state.attachments, activeFlow, uploadedItem)),
      ...(uploadedItem && uploadedItem.hideFromAttachmentTray !== true ? [{
        id: uploadedItem.id,
        fileName: uploadedItem.file.name,
        mimeType: uploadedItem.file.type,
        size: uploadedItem.file.size,
        file: uploadedItem.file,
      }] : []),
    ];
  }

  function placementSourceWithMedia(signingPlacement, role, attachments) {
    const source = signingPlacement?.[role];
    if (!source || typeof source !== "object" || source.mediaUrl) return source;
    const expectedId = String(source.id || "").trim();
    const expectedName = String(source.fileName || "").trim();
    const candidates = (Array.isArray(attachments) ? attachments : []).filter(item => {
      if (!item?.id || !item?.mediaUrl) return false;
      const mimeType = String(item.mimeType || "").trim().toLocaleLowerCase();
      const fileName = String(item.fileName || "").trim();
      const hasGenericMime = !mimeType
        || mimeType === "application/octet-stream"
        || mimeType === "binary/octet-stream";
      return role === "document"
        ? mimeType === "application/pdf" || (hasGenericMime && /\.pdf$/i.test(fileName))
        : mimeType.startsWith("image/")
          || (hasGenericMime && /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(fileName));
    });
    const idMatches = expectedId
      ? candidates.filter(item => sameAttachmentValue(item.id, expectedId)) : [];
    const nameMatches = expectedName
      ? candidates.filter(item => sameAttachmentValue(item.fileName, expectedName)) : [];
    const match = idMatches.length === 1
      ? idMatches[0]
      : nameMatches.length === 1 ? nameMatches[0] : null;
    return match ? { ...match, ...source, mediaUrl: String(match.mediaUrl) } : source;
  }

  function nextActiveFlow(result = {}) {
    if (!Object.hasOwn(result, "activeFlow")) return result.resetConversation ? null : state.activeFlow;
    const launches = normalizeLaunchSnapshot(result.activeFlow?.launches);
    const measurementLines = normalizeMeasurementSnapshot(result.activeFlow?.measurementLines);
    const epiDelivery = normalizeEpiDeliverySnapshot(result.activeFlow?.epiDelivery);
    const rawSigningPlacement = result.activeFlow?.documentSigningPlacement;
    const signingPlacement = rawSigningPlacement && typeof rawSigningPlacement === "object"
      ? {
        ...rawSigningPlacement,
        document: placementSourceWithMedia(rawSigningPlacement, "document", result.attachments),
        signature: placementSourceWithMedia(rawSigningPlacement, "signature", result.attachments),
      }
      : rawSigningPlacement;
    return result.activeFlow?.id && result.activeFlow?.title
      ? Object.freeze({ id: String(result.activeFlow.id), title: String(result.activeFlow.title),
        ...(launches ? { launches } : {}),
        ...(measurementLines ? { measurementLines } : {}),
        ...(epiDelivery ? { epiDelivery } : {}),
        ...(typeof result.activeFlow.contextId === "string" ? { contextId: result.activeFlow.contextId } : {}),
        ...(typeof result.activeFlow.paused === "boolean" ? { paused: result.activeFlow.paused } : {}),
        ...(typeof result.activeFlow.allowBulkAttachmentDelete === "boolean" ? { allowBulkAttachmentDelete: result.activeFlow.allowBulkAttachmentDelete } : {}),
        ...(signingPlacement && typeof signingPlacement === "object" ? {
          documentSigningPlacement: Object.freeze({
            stage: String(signingPlacement.stage || ""),
            scope: signingPlacement.scope === "all" || signingPlacement.scope === "final" || signingPlacement.scope === "single"
              ? signingPlacement.scope : null,
            ...(typeof signingPlacement.preserveSource === "boolean"
              ? { preserveSource: signingPlacement.preserveSource } : {}),
            ...(signingPlacement.signerName ? { signerName: String(signingPlacement.signerName) } : {}),
            ...(signingPlacement.signedAt ? { signedAt: String(signingPlacement.signedAt) } : {}),
            ...(signingPlacement.selection && typeof signingPlacement.selection === "object" ? {
              selection: Object.freeze({
                ...(Number.isInteger(Number(signingPlacement.selection.page)) ? { page: Number(signingPlacement.selection.page) } : {}),
                ...(Number.isFinite(Number(signingPlacement.selection.x)) ? { x: Number(signingPlacement.selection.x) } : {}),
                ...(Number.isFinite(Number(signingPlacement.selection.y)) ? { y: Number(signingPlacement.selection.y) } : {}),
                ...(Number.isFinite(Number(signingPlacement.selection.scale)) ? { scale: Number(signingPlacement.selection.scale) } : {}),
              }),
            } : {}),
            ...(signingPlacement.document && typeof signingPlacement.document === "object" ? {
              document: Object.freeze({
                ...(signingPlacement.document.id ? { id: String(signingPlacement.document.id) } : {}),
                ...(signingPlacement.document.fileName ? { fileName: String(signingPlacement.document.fileName) } : {}),
                ...(signingPlacement.document.mimeType ? { mimeType: String(signingPlacement.document.mimeType) } : {}),
                ...(signingPlacement.document.mediaUrl ? { mediaUrl: String(signingPlacement.document.mediaUrl) } : {}),
              }),
            } : {}),
            ...(signingPlacement.signature && typeof signingPlacement.signature === "object" ? {
              signature: Object.freeze({
                ...(signingPlacement.signature.id ? { id: String(signingPlacement.signature.id) } : {}),
                ...(signingPlacement.signature.fileName ? { fileName: String(signingPlacement.signature.fileName) } : {}),
                ...(signingPlacement.signature.mimeType ? { mimeType: String(signingPlacement.signature.mimeType) } : {}),
                ...(signingPlacement.signature.mediaUrl ? { mediaUrl: String(signingPlacement.signature.mediaUrl) } : {}),
              }),
            } : {}),
          }),
        } : {}),
        ...(Array.isArray(result.activeFlow.rows) ? { rows: Object.freeze(result.activeFlow.rows.slice(0, 50)
          .map(row => Object.freeze({ label: String(row.label || ""), value: String(row.value || "") }))) } : {}),
      })
      : null;
  }

  function nextCompletionNavigation(result = {}) {
    const completed = Array.isArray(result.results) && result.results.some(item => {
      const status = String(item?.status || "").trim().toLowerCase();
      return status === "completed" || status.endsWith("_completed");
    });
    const deferredCompletion = typeof result.deferredMenu?.completionId === "string"
      && result.deferredMenu.completionId.trim();
    if (completed || deferredCompletion) {
      return Object.freeze({
        homeOnly: true,
        title: String(state.activeFlow?.title || result.activeFlow?.title || "ITEM CRIADO"),
      });
    }
    return null;
  }

  function syncAttachments(attachments) {
    if (!Array.isArray(attachments)) return false;
    const normalized = visibleAttachments(
      attachments.filter(item => item?.id && item?.mediaUrl),
      state.activeFlow,
    ).map(item => ({
      id: String(item.id),
      fileName: String(item.fileName || "arquivo"),
      mimeType: String(item.mimeType || "application/octet-stream"),
      size: Number(item.size || 0),
      mediaUrl: String(item.mediaUrl),
      ...(item.existing === true ? { existing: true } : {}),
      ...(item.readOnly === true ? { readOnly: true } : {}),
      ...(item.previewUrl ? { previewUrl: String(item.previewUrl) } : {}),
    }));
    const unchanged = normalized.length === state.attachments.length
      && normalized.every((item, index) => ["id", "fileName", "mimeType", "size", "mediaUrl", "existing", "readOnly", "file"]
        .every(key => item[key] === state.attachments[index][key]));
    if (!unchanged) publish({ ...state, attachments: normalized });
    return true;
  }

  function setMessagePreview(messageId, previewUrl) {
    const id = String(messageId || "");
    if (!id || !previewUrl) return false;
    const messages = state.messages.map(message => message.id === id ? { ...message, previewUrl: String(previewUrl) } : message);
    if (messages.every((message, index) => message === state.messages[index])) return false;
    publish({ ...state, messages });
    return true;
  }

  function setAttachmentPreview(attachmentId, previewUrl) {
    const id = String(attachmentId || "");
    if (!id || !previewUrl) return false;
    const attachments = state.attachments.map(item => item.id === id ? { ...item, previewUrl: String(previewUrl) } : item);
    if (attachments.every((item, index) => item === state.attachments[index])) return false;
    publish({ ...state, attachments });
    return true;
  }

  function removeAttachment(attachmentId) {
    const id = String(attachmentId || "").trim();
    if (!id) return false;
    const attachments = state.attachments.filter(item => item.id !== id);
    if (attachments.length === state.attachments.length) return false;
    publish({ ...state, attachments });
    return true;
  }

  function clearSession() {
    draftVersion += 1;
    publish({ draft: "", messages: [], attachments: [], pendingFiles: [], activeText: null, activeFlow: null, completionNavigation: null, error: null });
  }

  function getState() {
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Assinante inválido.");
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function setDraft(value) {
    draftVersion += 1;
    publish({ ...state, draft: String(value || ""), error: null });
  }

  function beginText(text = state.draft, {
    allowEmpty = false,
    replaceAuditReport = false,
    silent = false,
    preserveDraft = false,
  } = {}) {
    const normalized = String(text || "").trim();
    if (!normalized && !allowEmpty) throw new Error("Digite uma mensagem antes de enviar.");
    const operation = Object.freeze({
      id: nextId(),
      text: normalized,
      draftVersion,
      replaceAuditReport: Boolean(replaceAuditReport && isAuditLogQuery(normalized)),
      silent: Boolean(silent),
      preserveDraft: Boolean(preserveDraft),
    });
    publish({ ...state, activeText: operation, error: null });
    return operation;
  }

  function confirmText(operation, result = {}) {
    if (!operation || state.activeText?.id !== operation.id) return false;
    const userMessage = operation.silent ? null : Object.freeze({
      id: `${operation.id}:user`,
      role: "user",
      type: "text",
      text: operation.text,
    });
    const shouldClearDraft = !operation.preserveDraft
      && operation.draftVersion === draftVersion
      && state.draft.trim() === operation.text;
    const fieldResult = result.results?.at(-1);
    const prefill = fieldResult?.inputPrefill;
    const shouldPrefill = !result.readOnlySummary && !result.resetConversation
      && fieldResult?.status === "awaiting_field" && prefill?.field === fieldResult.field
      && typeof prefill?.value === "string" && operation.draftVersion === draftVersion
      && (shouldClearDraft || !state.draft);
    publish({
      ...state,
      draft: shouldPrefill ? prefill.value : (shouldClearDraft ? "" : state.draft),
      activeFlow: nextActiveFlow(result),
      completionNavigation: nextCompletionNavigation(result),
      attachments: nextAttachments(result),
      messages: result.readOnlySummary ? state.messages : nextMessages(result.messages, {
        resetConversation: result.resetConversation === true,
        userMessage,
        replaceAuditReport: operation.replaceAuditReport,
      }),
      activeText: null,
      error: null,
    });
    return true;
  }

  function failText(operation, error) {
    if (!operation || state.activeText?.id !== operation.id) return false;
    publish({
      ...state,
      activeText: null,
      error: error?.message || "Não foi possível enviar a mensagem.",
    });
    return true;
  }

  function makePending(file, sourceId = null, { hideFromAttachmentTray = false } = {}) {
    return {
      id: nextId(),
      sourceId,
      file,
      ...(hideFromAttachmentTray ? { hideFromAttachmentTray: true } : {}),
      status: "pending",
      error: null,
      operationId: null,
    };
  }

  function queueFiles(files, options = {}) {
    const additions = Array.from(files || []).map(file => makePending(file, null, options));
    if (!additions.length) return state.pendingFiles;
    publish({ ...state, pendingFiles: [...state.pendingFiles, ...additions], error: null });
    return state.pendingFiles;
  }

  function replaceImportedFiles(files) {
    const known = new Set(state.pendingFiles.map(item => item.sourceId).filter(Boolean));
    const additions = [];
    for (const file of Array.from(files || [])) {
      const sourceId = String(file?.sourceId || file?.id || "").trim();
      if (!sourceId || known.has(sourceId)) continue;
      known.add(sourceId);
      additions.push(makePending(file, sourceId));
    }
    if (additions.length) {
      publish({ ...state, pendingFiles: [...state.pendingFiles, ...additions], error: null });
    }
    return state.pendingFiles;
  }

  function beginFile(fileId) {
    const index = state.pendingFiles.findIndex(item => item.id === fileId);
    if (index < 0) throw new Error("O anexo pendente não foi encontrado.");
    const item = state.pendingFiles[index];
    const operation = Object.freeze({
      id: nextId(),
      fileId,
      fileName: item.file?.name || "arquivo",
      file: item.file,
      sourceId: item.sourceId || null,
      previousMessageIds: Object.freeze(state.messages.map(message => message.id)),
    });
    const pendingFiles = state.pendingFiles.map((item, itemIndex) => (
      itemIndex === index
        ? { ...item, status: "sending", error: null, operationId: operation.id }
        : item
    ));
    publish({ ...state, pendingFiles, error: null });
    return operation;
  }

  function confirmFile(operation, result = {}) {
    const item = state.pendingFiles.find(candidate => (
      candidate.id === operation?.fileId && candidate.operationId === operation?.id
    ));
    if (!item) return false;
    const userMessage = Object.freeze({
      id: `${operation.id}:user`,
      role: "user",
      type: "file",
      text: `📎 ${item.file.name}`,
      fileName: item.file.name,
    });
    publish({
      ...state,
      messages: nextMessages(result.messages, {
        resetConversation: result.resetConversation === true,
        userMessage,
      }),
      pendingFiles: state.pendingFiles.filter(candidate => candidate.id !== item.id),
      activeFlow: nextActiveFlow(result),
      completionNavigation: nextCompletionNavigation(result),
      attachments: nextAttachments(result, item),
      error: null,
    });
    return true;
  }

  function failFile(operation, error) {
    const index = state.pendingFiles.findIndex(item => (
      item.id === operation?.fileId && item.operationId === operation?.id
    ));
    if (index < 0) return false;
    const fileName = state.pendingFiles[index].file?.name || "arquivo";
    const detail = error?.message || "Não foi possível enviar o arquivo.";
    const message = `O anexo ${fileName} não foi enviado e foi removido da lista. ${detail}`;
    const pendingFiles = state.pendingFiles.filter((_, itemIndex) => itemIndex !== index);
    publish({ ...state, pendingFiles, error: message });
    return true;
  }

  // Se a VM não confirmar a coleção de anexos, desfazemos a confirmação
  // visual, retiramos o arquivo que falhou da bandeja e notificamos o usuário.
  function revertFileConfirmation(operation, error) {
    const fileId = operation?.fileId;
    if (!fileId) return false;
    const fileName = operation.file?.name || "arquivo";
    const detail = error?.message || "A VM não confirmou o recebimento do anexo.";
    const message = `O anexo ${fileName} não foi confirmado e foi removido da lista. ${detail}`;
    const attachments = state.attachments.filter(item => item.id !== fileId);
    const previousMessageIds = new Set(operation.previousMessageIds || []);
    const messages = state.messages.filter(item => previousMessageIds.has(item.id));
    publish({
      ...state,
      messages,
      pendingFiles: state.pendingFiles.filter(item => item.id !== fileId),
      attachments,
      error: message,
    });
    return true;
  }

  function ingestRemoteMessages(messages, result = {}) {
    const { resetConversation = false, attachments } = result;
    publish({
      ...state,
      messages: nextMessages(messages, { resetConversation }),
      activeFlow: nextActiveFlow(result),
      completionNavigation: nextCompletionNavigation(result),
      attachments: nextAttachments(result),
      error: null,
    });
  }

  function replaceCurrentResponse(messages) {
    const incoming = remoteMessages(messages);
    if (historyMode === "current-step") {
      publish({ ...state, messages: incoming, error: null });
      return true;
    }
    let userIndex = -1;
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      if (state.messages[index].role === "user") {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) return false;
    publish({ ...state, messages: [...state.messages.slice(0, userIndex + 1), ...incoming], error: null });
    return true;
  }

  function discardFile(fileId) {
    const pendingFiles = state.pendingFiles.filter(item => item.id !== fileId);
    if (pendingFiles.length === state.pendingFiles.length) return false;
    publish({ ...state, pendingFiles, error: null });
    return true;
  }

  return Object.freeze({
    getState,
    subscribe,
    setDraft,
    beginText,
    confirmText,
    failText,
    queueFiles,
    beginFile,
    confirmFile,
    failFile,
    revertFileConfirmation,
    ingestRemoteMessages,
    replaceCurrentResponse,
    syncAttachments,
    setMessagePreview,
    setAttachmentPreview,
    removeAttachment,
    clearSession,
    replaceImportedFiles,
    discardFile,
  });
}
