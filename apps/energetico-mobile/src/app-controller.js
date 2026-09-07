import { createMediaThumbnail } from "./web/media-thumbnail.js";

function errorMessage(error, fallback) {
  return error?.message || fallback;
}

function currentQuestion(messages) {
  return messages.filter(message => message.role === "assistant")
    .map(message => message.question || message.text || message.caption || "")
    .filter(Boolean).join("\n");
}

const PORTAL_MAIN_MENU_CONFIRM_ID = "portal_confirm_main_menu";

export function createAppController({ store, view, client, auth, native, recovery }) {
  if (!store || !view || !client || !auth || !native) {
    throw new TypeError("O controlador requer todos os serviços do Energético.");
  }

  let account = null;
  let sessionStatus = "initializing";
  let sessionError = null;
  let started = false;
  let stopped = false;
  let unsubscribeStore = null;
  const unsubscribeCommands = [];
  let uploadQueue = Promise.resolve();
  let attachmentRevision = 0;
  let snapshotPending = null;
  let resuming = false;
  const idleWaiters = new Set();
  let completionMenuTimer = null;
  let completionMenuRevision = 0;
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
  let draftEditRevision = 0;
  let checkpointMessages = null;
  let checkpointQuestion = "";
  let unsubscribeRecovery = null;
  const storageWarning = "Não foi possível salvar a prévia neste aparelho. Os dados já recebidos pela VM continuam preservados, mas copie o rascunho antes de fechar.";

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
    recovery.schedule(recoveryAccountId, {
      activeFlow: state.activeFlow, question: checkpointQuestion,
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

  function reconcileRecovery(draftRevision) {
    if (!recoveryAccountId || recoveryVerified) return;
    const saved = recoveryPreview;
    const state = store.getState();
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
    if (!recoveryAccountId) return;
    const results = result.results || [];
    const state = store.getState();
    if (result.returned_to_main_menu === true) {
      // A confirmed menu exit is represented by the VM draft catalogue/menu;
      // do not put the just-decided flow back above that menu as a local card.
      recoveryPreview = null;
      recoveryReference = null;
      olderReferences = [];
      return;
    }
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
        hydrateMediaPreviews();
      } catch {
        if (stillCurrent()) setSessionError(new Error("O cadastro continua confirmado, mas não foi possível carregar o menu principal. Toque em Retomar conversa."));
      }
    }, delaySeconds * 1000);
  }

  function flowBusy() {
    const state = store.getState();
    return resuming || Boolean(state.activeText) || state.pendingFiles.some(item => item.status === "sending");
  }

  function render() {
    if (!flowBusy() || stopped || !account) {
      const waiters = [...idleWaiters];
      idleWaiters.clear();
      waiters.forEach(resolve => resolve());
    }
    const state = store.getState();
    view.render({
      ...state,
      account,
      sessionStatus,
      resuming,
      recoveryPreview,
      recoveryReference,
      recoveryReferenceCount: (recoveryReference ? 1 : 0) + olderReferences.length,
      recoveryWarning,
      recoveryBlocked: Boolean(recoveryAccountId && !recoveryVerified),
      error: sessionError || state.error,
    });
  }

  function setSessionError(error, fallback) {
    sessionError = errorMessage(error, fallback);
    render();
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
    cancelCompletionMenu();
    const conversationAccount = account;
    const resumeDraftRevision = draftEditRevision;
    sessionError = null;
    resuming = true;
    render();
    try {
      attachmentRevision += 1;
      const result = await client.sendText({ text: "", replyId: "input_continue" });
      if (account !== conversationAccount || stopped) return false;
      attachmentRevision += 1;
      store.ingestRemoteMessages(result.messages, {
        ...result,
        resetConversation: result.resetConversation === true,
        attachments: result.attachments,
      });
      hydrateMediaPreviews();
      reconcileRecovery(resumeDraftRevision);
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

  async function sendText(text = store.getState().draft, replyId) {
    if (!account || stopped || flowBusy() || (recoveryAccountId && !recoveryVerified)) return false;
    cancelCompletionMenu();
    sessionError = null;
    const previousState = store.getState();
    let operation;
    try {
      attachmentRevision += 1;
      operation = store.beginText(text, { allowEmpty: replyId === PORTAL_MAIN_MENU_CONFIRM_ID });
      const result = await client.sendText({
        text: operation.text,
        ...(replyId ? { replyId } : {}),
      });
      attachmentRevision += 1;
      const summaryStatus = result.results?.find(item => ["flow_summary", "no_active_flow", "flow_summary_failed"].includes(item.status))?.status;
      if (summaryStatus) {
        const confirmed = store.confirmText(operation, { ...result, readOnlySummary: true });
        if (!confirmed) return false;
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
      const confirmed = store.confirmText(operation, result);
      if (confirmed) {
        hydrateMediaPreviews();
        reconcileSavedFlow(result, previousState);
        recoveryUncertain = false;
        recoveryPreview = null;
        persistRecovery();
        render();
        scheduleCompletionMenu(result);
      }
      return confirmed;
    } catch (error) {
      if (operation && store.getState().activeText?.id === operation.id && error?.code === "NETWORK_UNCERTAIN") recoveryUncertain = true;
      if (operation) store.failText(operation, error);
      else setSessionError(error, "Não foi possível enviar a mensagem.");
      return false;
    }
  }

  async function uploadFile(fileId) {
    if (!account || stopped || flowBusy() || (recoveryAccountId && !recoveryVerified)) return false;
    const item = store.getState().pendingFiles.find(candidate => candidate.id === fileId);
    if (!item) return false;
    cancelCompletionMenu();
    sessionError = null;
    let operation;
    try {
      attachmentRevision += 1;
      operation = store.beginFile(fileId);
      const cachedResult = item.file.confirmedResult;
      if (cachedResult && (cachedResult.status !== "processed" || !Array.isArray(cachedResult.messages))) {
        throw new Error("A confirmação armazenada do anexo é inválida.");
      }
      const result = cachedResult || await client.sendFile(item.file);
      attachmentRevision += 1;
      const confirmed = store.confirmFile(operation, result);
      if (confirmed) { hydrateMediaPreviews(); recoveryUncertain = false; persistRecovery(); scheduleCompletionMenu(result); }
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
      for (const id of ids) {
        while (!stopped && account === queuedAccount && flowBusy()) {
          await new Promise(resolve => idleWaiters.add(resolve));
        }
        if (stopped || !account || account !== queuedAccount) return;
        await uploadFile(id);
      }
    });
    return uploadQueue;
  }

  async function queueSelectedFiles(selector) {
    if (recoveryAccountId && !recoveryVerified) return false;
    cancelCompletionMenu();
    const selectionAccount = account;
    sessionError = null;
    render();
    try {
      const knownIds = new Set(store.getState().pendingFiles.map(item => item.id));
      const files = await selector();
      if (stopped || !account || account !== selectionAccount) return false;
      store.queueFiles(files);
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
    try {
      const files = await native.importSharedItems();
      store.replaceImportedFiles(files);
      return store.getState().pendingFiles
        .filter(item => item.sourceId && item.status !== "sending")
        .map(item => item.id);
    } catch (error) {
      setSessionError(error, "Não foi possível ler os itens compartilhados.");
      return [];
    }
  }

  async function signIn() {
    sessionStatus = "initializing";
    sessionError = null;
    render();
    try {
      account = await auth.signIn();
      if (!account) {
        sessionStatus = "signed-out";
        render();
        return false;
      }
      sessionStatus = "authenticated";
      openRecovery();
      render();
      await continueConversation();
      const pendingIds = store.getState().pendingFiles
        .filter(item => item.status !== "sending")
        .map(item => item.id);
      await processFiles(pendingIds);
      return true;
    } catch (error) {
      account = null;
      sessionStatus = "signed-out";
      setSessionError(error, "Não foi possível entrar com a Microsoft.");
      return false;
    }
  }

  async function signOut() {
    cancelCompletionMenu();
    const cleared = recoveryAccountId ? recovery.clear(recoveryAccountId) : true;
    recoveryAccountId = null;
    recoveryPreview = null;
    recoveryReference = null;
    olderReferences = [];
    recoveryUncertain = false;
    recoveryWarning = null;
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

  async function refreshAttachments({ silent = false } = {}) {
    if (!account || stopped || typeof client.getAttachments !== "function") return false;
    const state = store.getState();
    if (flowBusy()) return false;
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

  async function showMedia(source, fileName) {
    if (native.previewMedia) return native.previewMedia(source, fileName);
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
      const refreshed = await refreshAttachments({ silent: true });
      const current = refreshed && store.getState().attachments.find(candidate => candidate.id === item.id);
      if (!current) throw new Error("Este anexo não está mais disponível no fluxo atual. Feche a prévia para voltar ao chat.");
      return client.fetchMedia(current);
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

  async function removeFile(fileId) {
    const item = store.getState().pendingFiles.find(candidate => candidate.id === fileId);
    if (!item || item.status === "sending") return false;
    try {
      if (item.sourceId) await native.discardSharedItem(item.sourceId);
      return store.discardFile(fileId);
    } catch (error) {
      setSessionError(error, "Não foi possível remover o anexo.");
      return false;
    }
  }

  function bind(type, handler) {
    unsubscribeCommands.push(view.on(type, handler));
  }

  function bindCommands() {
    bind("draft-changed", command => { draftEditRevision += 1; cancelCompletionMenu(); store.setDraft(command.value); });
    bind("recover-draft", recoverDraft);
    bind("dismiss-recovery", () => {
      recoveryPreview = null;
      recoveryReference = olderReferences[0] || null;
      olderReferences = olderReferences.slice(1);
      persistRecovery(); render();
    });
    bind("send-text", () => sendText());
    bind("select-reply", command => {
      const state = store.getState();
      if (command.replyId === "navigation_main_menu" && state.activeFlow) {
        return sendText("", PORTAL_MAIN_MENU_CONFIRM_ID);
      }
      return sendText(command.label, command.replyId);
    });
    bind("show-summary", () => sendText("resumo", "flow_summary"));
    bind("capture-photo", () => queueSelectedFiles(() => native.capturePhoto()));
    bind("pick-files", () => queueSelectedFiles(() => native.pickDocuments()));
    bind("retry-file", command => processFiles([command.fileId]));
    bind("remove-file", command => removeFile(command.fileId));
    bind("open-media", command => openMedia(command.messageId));
    bind("open-file", command => openFile(command.fileId));
    bind("sign-in", signIn);
    bind("sign-out", signOut);
    bind("retry-session", () => (account ? continueConversation() : signIn()));
  }

  async function start() {
    if (started) return;
    started = true;
    stopped = false;
    bindCommands();
    unsubscribeRecovery = recovery?.subscribe?.(ok => {
      recoveryWarning = ok ? null : storageWarning;
      if (!stopped) render();
    });
    unsubscribeStore = store.subscribe(() => { persistRecovery(); render(); });
    render();

    try {
      account = await auth.initialize();
    } catch (error) {
      account = null;
      sessionError = errorMessage(error, "Não foi possível verificar a sessão Microsoft.");
    }

    const sharedFileIds = await importSharedFiles();
    sessionStatus = account ? "authenticated" : "signed-out";
    openRecovery();
    render();
    if (account) {
      await continueConversation();
      await processFiles(sharedFileIds);
    }
  }

  function stop() {
    flushRecovery();
    cancelCompletionMenu();
    stopped = true;
    idleWaiters.forEach(resolve => resolve());
    idleWaiters.clear();
    attachmentRevision += 1;
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    previewUrls.clear();
    previewTimers.forEach(timer => clearTimeout(timer));
    previewTimers.clear();
    previewLoading.clear();
    native.closePreview?.();
    unsubscribeStore?.();
    unsubscribeStore = null;
    unsubscribeRecovery?.();
    unsubscribeRecovery = null;
    unsubscribeCommands.splice(0).forEach(unsubscribe => unsubscribe?.());
    view.destroy?.();
  }

  return Object.freeze({ start, stop, sendText, uploadFile, refreshAttachments, flushRecovery });
}
