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

  function render() {
    const state = store.getState();
    view.render({
      ...state,
      account,
      sessionStatus,
      error: sessionError || state.error,
    });
  }

  function setSessionError(error, fallback) {
    sessionError = errorMessage(error, fallback);
    render();
  }

  async function continueConversation() {
    if (!account || stopped) return false;
    sessionError = null;
    render();
    try {
      const result = await client.sendText({ text: "", replyId: "input_continue" });
      store.ingestRemoteMessages(result.messages, {
        resetConversation: result.resetConversation === true,
      });
      return true;
    } catch (error) {
      setSessionError(error, "Não foi possível retomar a conversa com a VM.");
      return false;
    }
  }

  async function sendText(text = store.getState().draft, replyId) {
    if (!account || stopped) return false;
    sessionError = null;
    let operation;
    try {
      operation = store.beginText(text);
      const result = await client.sendText({
        text: operation.text,
        ...(replyId ? { replyId } : {}),
      });
      store.confirmText(operation, result);
      view.focusComposer?.();
      return true;
    } catch (error) {
      if (operation) store.failText(operation, error);
      else setSessionError(error, "Não foi possível enviar a mensagem.");
      return false;
    }
  }

  async function uploadFile(fileId) {
    if (!account || stopped) return false;
    const item = store.getState().pendingFiles.find(candidate => candidate.id === fileId);
    if (!item) return false;
    sessionError = null;
    let operation;
    try {
      operation = store.beginFile(fileId);
      const cachedResult = item.file.confirmedResult;
      if (cachedResult && (cachedResult.status !== "processed" || !Array.isArray(cachedResult.messages))) {
        throw new Error("A confirmação armazenada do anexo é inválida.");
      }
      const result = cachedResult || await client.sendFile(item.file);
      const confirmed = store.confirmFile(operation, result);
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
    uploadQueue = uploadQueue.then(async () => {
      for (const id of ids) {
        await uploadFile(id);
      }
    });
    return uploadQueue;
  }

  async function queueSelectedFiles(selector) {
    sessionError = null;
    render();
    try {
      const knownIds = new Set(store.getState().pendingFiles.map(item => item.id));
      const files = await selector();
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
    try {
      await auth.signOut();
      account = null;
      sessionStatus = "signed-out";
      sessionError = null;
      render();
      return true;
    } catch (error) {
      setSessionError(error, "Não foi possível sair da conta.");
      return false;
    }
  }

  async function openMedia(messageId) {
    const message = store.getState().messages.find(item => item.id === messageId);
    if (!message) {
      setSessionError(new Error("O arquivo solicitado não está mais na conversa."));
      return false;
    }
    try {
      const blob = await client.fetchMedia(message);
      await native.exportMedia(blob, message.fileName || message.caption || "arquivo");
      return true;
    } catch (error) {
      setSessionError(error, "Não foi possível abrir o arquivo.");
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
    bind("draft-changed", command => store.setDraft(command.value));
    bind("send-text", () => sendText());
    bind("select-reply", command => sendText(command.label, command.replyId));
    bind("capture-photo", () => queueSelectedFiles(() => native.capturePhoto()));
    bind("pick-files", () => queueSelectedFiles(() => native.pickDocuments()));
    bind("retry-file", command => processFiles([command.fileId]));
    bind("remove-file", command => removeFile(command.fileId));
    bind("open-media", command => openMedia(command.messageId));
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
    stopped = true;
    unsubscribeStore?.();
    unsubscribeStore = null;
    unsubscribeCommands.splice(0).forEach(unsubscribe => unsubscribe?.());
    view.destroy?.();
  }

  return Object.freeze({ start, stop, sendText, uploadFile });
}
