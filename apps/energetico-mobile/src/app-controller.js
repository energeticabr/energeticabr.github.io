function errorMessage(error, fallback) {
  return error?.message || fallback;
}

export function createAppController({ store, view, client, auth, native }) {
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
      error: sessionError || state.error,
    });
  }

  function setSessionError(error, fallback) {
    sessionError = errorMessage(error, fallback);
    render();
  }

  async function continueConversation() {
    if (!account || stopped || flowBusy()) return false;
    cancelCompletionMenu();
    const conversationAccount = account;
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
    if (!account || stopped || flowBusy()) return false;
    cancelCompletionMenu();
    sessionError = null;
    let operation;
    try {
      attachmentRevision += 1;
      operation = store.beginText(text);
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
      if (confirmed) scheduleCompletionMenu(result);
      return confirmed;
    } catch (error) {
      if (operation) store.failText(operation, error);
      else setSessionError(error, "Não foi possível enviar a mensagem.");
      return false;
    }
  }

  async function uploadFile(fileId) {
    if (!account || stopped || flowBusy()) return false;
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
      if (confirmed) scheduleCompletionMenu(result);
      if (confirmed && item.sourceId) {
        try {
          await native.discardSharedItem(item.sourceId);
        } catch (error) {
          setSessionError(error, "O anexo foi enviado, mas a cópia compartilhada não pôde ser limpa.");
        }
      }
      return confirmed;
    } catch (error) {
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
    account = null;
    attachmentRevision += 1;
    native.closePreview?.();
    sessionStatus = "signed-out";
    sessionError = null;
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
        return store.syncAttachments(attachments);
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
    bind("draft-changed", command => { cancelCompletionMenu(); store.setDraft(command.value); });
    bind("send-text", () => sendText());
    bind("select-reply", command => sendText(command.label, command.replyId));
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
    unsubscribeStore = store.subscribe(render);
    render();

    try {
      account = await auth.initialize();
    } catch (error) {
      account = null;
      sessionError = errorMessage(error, "Não foi possível verificar a sessão Microsoft.");
    }

    const sharedFileIds = await importSharedFiles();
    sessionStatus = account ? "authenticated" : "signed-out";
    render();
    if (account) {
      await continueConversation();
      await processFiles(sharedFileIds);
    }
  }

  function stop() {
    cancelCompletionMenu();
    stopped = true;
    idleWaiters.forEach(resolve => resolve());
    idleWaiters.clear();
    attachmentRevision += 1;
    native.closePreview?.();
    unsubscribeStore?.();
    unsubscribeStore = null;
    unsubscribeCommands.splice(0).forEach(unsubscribe => unsubscribe?.());
    view.destroy?.();
  }

  return Object.freeze({ start, stop, sendText, uploadFile, refreshAttachments });
}
