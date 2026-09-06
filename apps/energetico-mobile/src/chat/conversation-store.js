import { normalizeLaunchSnapshot } from "./launch-snapshot.js";

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

  function nextMessages(messages, { resetConversation = false, userMessage } = {}) {
    const incoming = remoteMessages(messages);
    if (historyMode === "current-step") {
      // Keep the current prompt if the server confirms without sending its replacement.
      return incoming.length || resetConversation ? incoming : state.messages;
    }
    return [
      ...(resetConversation ? [] : state.messages),
      ...(userMessage ? [userMessage] : []),
      ...incoming,
    ];
  }

  function nextAttachments(result = {}, uploadedItem) {
    if (Array.isArray(result.attachments)) {
      return result.attachments.filter(item => item?.id && item?.mediaUrl).map(item => ({
        id: String(item.id),
        fileName: String(item.fileName || "arquivo"),
        mimeType: String(item.mimeType || "application/octet-stream"),
        size: Number(item.size || 0),
        mediaUrl: String(item.mediaUrl),
      }));
    }
    return [
      ...(result.resetConversation === true ? [] : state.attachments),
      ...(uploadedItem ? [{
        id: uploadedItem.id,
        fileName: uploadedItem.file.name,
        mimeType: uploadedItem.file.type,
        size: uploadedItem.file.size,
        file: uploadedItem.file,
      }] : []),
    ];
  }

  function nextActiveFlow(result = {}) {
    if (!Object.hasOwn(result, "activeFlow")) return result.resetConversation ? null : state.activeFlow;
    const launches = normalizeLaunchSnapshot(result.activeFlow?.launches);
    return result.activeFlow?.id && result.activeFlow?.title
      ? Object.freeze({ id: String(result.activeFlow.id), title: String(result.activeFlow.title),
        ...(launches ? { launches } : {}),
        ...(typeof result.activeFlow.contextId === "string" ? { contextId: result.activeFlow.contextId } : {}),
        ...(typeof result.activeFlow.paused === "boolean" ? { paused: result.activeFlow.paused } : {}),
        ...(Array.isArray(result.activeFlow.rows) ? { rows: Object.freeze(result.activeFlow.rows.slice(0, 50)
          .map(row => Object.freeze({ label: String(row.label || ""), value: String(row.value || "") }))) } : {}),
      })
      : null;
  }

  function syncAttachments(attachments) {
    if (!Array.isArray(attachments)) return false;
    const normalized = nextAttachments({ attachments });
    const unchanged = normalized.length === state.attachments.length
      && normalized.every((item, index) => ["id", "fileName", "mimeType", "size", "mediaUrl", "file"]
        .every(key => item[key] === state.attachments[index][key]));
    if (!unchanged) publish({ ...state, attachments: normalized });
    return true;
  }

  function clearSession() {
    draftVersion += 1;
    publish({ draft: "", messages: [], attachments: [], pendingFiles: [], activeText: null, activeFlow: null, error: null });
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

  function beginText(text = state.draft) {
    const normalized = String(text || "").trim();
    if (!normalized) throw new Error("Digite uma mensagem antes de enviar.");
    const operation = Object.freeze({
      id: nextId(),
      text: normalized,
      draftVersion,
    });
    publish({ ...state, activeText: operation, error: null });
    return operation;
  }

  function confirmText(operation, result = {}) {
    if (!operation || state.activeText?.id !== operation.id) return false;
    const userMessage = Object.freeze({
      id: `${operation.id}:user`,
      role: "user",
      type: "text",
      text: operation.text,
    });
    const shouldClearDraft = operation.draftVersion === draftVersion
      && state.draft.trim() === operation.text;
    publish({
      ...state,
      draft: shouldClearDraft ? "" : state.draft,
      activeFlow: nextActiveFlow(result),
      attachments: nextAttachments(result),
      messages: result.readOnlySummary ? state.messages : nextMessages(result.messages, {
        resetConversation: result.resetConversation === true,
        userMessage,
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

  function makePending(file, sourceId = null) {
    return {
      id: nextId(),
      sourceId,
      file,
      status: "pending",
      error: null,
      operationId: null,
    };
  }

  function queueFiles(files) {
    const additions = Array.from(files || []).map(file => makePending(file));
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
    const operation = Object.freeze({ id: nextId(), fileId });
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
    const message = error?.message || "Não foi possível enviar o arquivo.";
    const pendingFiles = state.pendingFiles.map((item, itemIndex) => (
      itemIndex === index
        ? { ...item, status: "failed", error: message, operationId: null }
        : item
    ));
    publish({ ...state, pendingFiles, error: message });
    return true;
  }

  function ingestRemoteMessages(messages, result = {}) {
    const { resetConversation = false, attachments } = result;
    publish({
      ...state,
      messages: nextMessages(messages, { resetConversation }),
      activeFlow: nextActiveFlow(result),
      attachments: nextAttachments({ resetConversation, attachments }),
      error: null,
    });
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
    ingestRemoteMessages,
    syncAttachments,
    clearSession,
    replaceImportedFiles,
    discardFile,
  });
}
