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
const PORTAL_TRANSFER_ATTACHMENTS_ID = "portal_transfer_attachments";
const FLOW_REMINDER_DELAY_MS = 5 * 60 * 1000;
const FLOW_REMINDER_TITLE = "Energético";
const PENDING_PROVISION_REMINDER_KEY = "energetico.pending-provision-reminder";

function localDateIso(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  let attachmentActionBusy = false;
  const idleWaiters = new Set();
  let completionMenuTimer = null;
  let completionMenuRevision = 0;
  let responseTransitionTimer = null;
  let responseTransitionRevision = 0;
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
  let unsubscribeResume = null;
  let sharedResume = null;
  let sharedResumeRequested = false;
  let starting = false;
  let sessionRevision = 0;
  let flowReminderTimer = null;
  let flowReminderRevision = 0;
  let pendingProvisionSnapshot = null;
  let pendingProvisionReminderOpen = false;
  let pendingProvisionReminderError = "";
  let pendingProvisionRequest = null;
  let pendingProvisionSessionDismissed = false;
  const storageWarning = "Não foi possível salvar a prévia neste aparelho. Os dados já recebidos pela VM continuam preservados, mas copie o rascunho antes de fechar.";

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

  function reminderTimeout(callback) {
    const timer = setTimeout(callback, FLOW_REMINDER_DELAY_MS);
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

  function handleBackground() {
    // “Lembrar sempre que abrir” deve voltar a aparecer quando o aplicativo
    // for aberto novamente nesta mesma sessão, depois de ter ido ao fundo.
    pendingProvisionSessionDismissed = false;
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
    return refreshPendingProvisionSnapshot();
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

  function cancelPendingProvisionReminder() {
    void native.cancelProvisionReminder?.();
  }

  function schedulePendingProvisionReminder(delayMs) {
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
    if (pendingProvisionRequest) return pendingProvisionRequest;
    const snapshotAccount = account;
    const snapshotRevision = sessionRevision;
    pendingProvisionRequest = Promise.resolve().then(async () => {
      try {
        const snapshot = await client.getPendingProvisionSnapshot();
        if (stopped || account !== snapshotAccount || sessionRevision !== snapshotRevision) return false;
        const due = snapshot?.due === true && Array.isArray(snapshot.rows) && snapshot.rows.length > 0;
        if (!due) {
          cancelPendingProvisionReminder();
          pendingProvisionSnapshot = null;
          pendingProvisionReminderOpen = false;
          pendingProvisionReminderError = "";
          render();
          return false;
        }
        if (!pendingProvisionReminderSuppressed()) {
          pendingProvisionSnapshot = snapshot;
          pendingProvisionReminderOpen = false;
          pendingProvisionReminderError = "";
          render();
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

  function closePendingProvisions() {
    if (!pendingProvisionSnapshot) return false;
    pendingProvisionReminderOpen = true;
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
    else cancelPendingProvisionReminder();
    pendingProvisionSnapshot = null;
    pendingProvisionReminderOpen = false;
    pendingProvisionReminderError = "";
    render();
    return true;
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
    const hasPendingFiles = state.pendingFiles.length > 0;
    const hasRecoveryContent = Boolean(
      state.activeFlow
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
    const results = result.results || [];
    const state = store.getState();
    const completed = results.some(item => {
      const status = String(item?.status || "").trim().toLowerCase();
      return status === "completed" || status.endsWith("_completed");
    });
    if (completed) {
      recoveryPreview = null;
      recoveryReference = null;
      olderReferences = [];
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
      if (stopped || account !== transitionAccount || revision !== responseTransitionRevision) return;
      attachmentRevision += 1;
      store.replaceCurrentResponse(nextMessages);
      hydrateMediaPreviews();
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
    view.render({
      ...state,
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
      pendingProvisionReminderOpen,
      pendingProvisionReminderError,
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
      // A retomada pode devolver a pergunta atual sem a coleção de anexos
      // (especialmente após fechar/reabrir o aplicativo). Consulte o snapshot
      // explicitamente para que a lista suspensa reapareça antes da próxima
      // resposta do usuário.
      if (typeof client.getAttachments === "function") {
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
    const pendingError = pendingAttachmentGuard();
    if (pendingError) {
      setSessionError(new Error(pendingError));
      return false;
    }
    const attachmentVerification = verifyAttachmentSnapshotBeforeSubmit();
    if (attachmentVerification !== true && !await attachmentVerification) return false;
    cancelResponseTransition();
    cancelCompletionMenu();
    sessionError = null;
    const previousState = store.getState();
    let operation;
    try {
      attachmentRevision += 1;
      operation = store.beginText(text, {
        allowEmpty: replyId === PORTAL_MAIN_MENU_CONFIRM_ID || replyId === PORTAL_TRANSFER_ATTACHMENTS_ID,
        // A second date (or a selected LOG row) must replace the previous
        // report instead of leaving an older day's table visible underneath.
        replaceAuditReport: Boolean(previousState.messages?.some?.(message => (
          message?.type === "poll"
            ? String(message.question || message.prompt || "").toLocaleLowerCase("pt-BR").includes("log de ações")
              || (Array.isArray(message.options) && message.options.some(option => String(option?.reply || option?.id || "").startsWith("audit_log_row:")))
            : /log\s+de\s+a[cç][oõ]es/i.test(String(message?.caption || message?.text || ""))
        ))),
      });
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
      const staged = stagedResponse(result);
      const confirmed = store.confirmText(operation, staged?.immediate || result);
      if (confirmed) {
        hydrateMediaPreviews();
        reconcileSavedFlow(result, previousState);
        recoveryUncertain = false;
        recoveryPreview = null;
        persistRecovery();
        render();
        if (staged) scheduleResponseTransition(staged.nextMessages);
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
      operation = store.beginFile(fileId);
      const cachedResult = item.file.confirmedResult;
      if (cachedResult && (cachedResult.status !== "processed" || !Array.isArray(cachedResult.messages))) {
        throw new Error("A confirmação armazenada do anexo é inválida.");
      }
      const result = cachedResult || await client.sendFile(item.file);
      attachmentRevision += 1;
      const staged = stagedResponse(result);
      const confirmed = store.confirmFile(operation, staged?.immediate || result);
      if (confirmed) {
        hydrateMediaPreviews();
        recoveryUncertain = false;
        persistRecovery();
        const hasRemoteAttachmentSnapshot = Array.isArray(result.attachments)
          && result.attachments.some(attachment => attachment?.id && attachment?.mediaUrl);
        const uploadCompleted = result?.resetConversation === true
          || result?.returned_to_main_menu === true
          || (Array.isArray(result?.results) && result.results.some(item => {
            const status = String(item?.status || "").trim().toLowerCase();
            return status === "completed"
              || status.endsWith("_completed")
              || status === "document_signed";
          }));
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
        if (staged) scheduleResponseTransition(staged.nextMessages);
        scheduleCompletionMenu(result);
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
      for (const id of ids) {
        while (!stopped && account === queuedAccount && flowBusy()) {
          await new Promise(resolve => idleWaiters.add(resolve));
        }
        if (stopped || !account || account !== queuedAccount) return;
        const uploaded = await uploadFile(id);
        if (!uploaded) {
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
    const importAccount = account;
    const importRevision = sessionRevision;
    const stillCurrent = () => !stopped && account === importAccount && sessionRevision === importRevision;
    try {
      const files = await native.importSharedItems();
      if (!stillCurrent()) return [];
      store.replaceImportedFiles(files);
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
    sessionStatus = "initializing";
    sessionError = null;
    render();
    try {
      const signedInAccount = await auth.signIn();
      if (stopped || sessionRevision !== signInRevision) return false;
      account = signedInAccount;
      if (!account) {
        sessionStatus = "signed-out";
        render();
        return false;
      }
      sessionStatus = "authenticated";
      pendingProvisionSessionDismissed = false;
      openRecovery();
      render();
      await continueConversation();
      await refreshPendingProvisionSnapshot();
      const pendingIds = store.getState().pendingFiles
        .filter(item => item.status !== "sending")
        .map(item => item.id);
      await processFiles(pendingIds);
      if (sharedResumeRequested) await resumeSharedFiles();
      return true;
    } catch (error) {
      if (stopped || sessionRevision !== signInRevision) return false;
      account = null;
      sessionStatus = "signed-out";
      setSessionError(error, "Não foi possível entrar com a Microsoft.");
      return false;
    }
  }

  async function signOut() {
    sessionRevision += 1;
    sharedResumeRequested = false;
    cancelFlowReminder();
    cancelPendingProvisionReminder();
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
    pendingProvisionReminderOpen = false;
    pendingProvisionReminderError = "";
    pendingProvisionRequest = null;
    pendingProvisionSessionDismissed = false;
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
        const ids = await importSharedFiles();
        if (stopped || account !== resumeAccount || sessionRevision !== resumeRevision) continue;
        if (account) await processFiles(ids);
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
      const refreshed = await refreshAttachments({ silent: true, force: true });
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

  async function removeAttachment(fileId) {
    if (!account || stopped || flowBusy() || typeof client.deleteAttachment !== "function") return false;
    const item = store.getState().attachments.find(candidate => candidate.id === fileId);
    if (!item) return false;
    if (typeof globalThis.confirm === "function"
      && !globalThis.confirm(`Excluir o anexo “${item.fileName || "arquivo"}” deste fluxo?`)) return false;
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

  async function resolveCurrentAttachment(fileId) {
    const previous = store.getState().attachments.find(candidate => candidate.id === fileId);
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
    cancelCompletionMenu();
    sessionError = null;
    const actionAccount = account;
    attachmentActionBusy = true;
    attachmentRevision += 1;
    render();
    try {
      const result = await client.compressAttachment(item.id);
      if (stopped || account !== actionAccount) return false;
      store.ingestRemoteMessages(result.messages, { ...result, resetConversation: false, attachments: result.attachments });
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

  async function chooseAttachmentCompression(choice) {
    if (!account || stopped || flowBusy() || typeof client.chooseAttachmentCompression !== "function") return false;
    cancelCompletionMenu();
    sessionError = null;
    const actionAccount = account;
    attachmentActionBusy = true;
    attachmentRevision += 1;
    render();
    try {
      const result = await client.chooseAttachmentCompression(choice);
      if (stopped || account !== actionAccount) return false;
      store.ingestRemoteMessages(result.messages, { ...result, resetConversation: false, attachments: result.attachments });
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
      const state = store.getState();
      if (command.replyId?.startsWith("attachment_compression_")) {
        return chooseAttachmentCompression(command.replyId);
      }
      if (command.replyId === "navigation_main_menu" && state.activeFlow) {
        return sendText("", PORTAL_MAIN_MENU_CONFIRM_ID);
      }
      return sendText(command.label, command.replyId);
    });
    bind("show-summary", () => sendText("resumo", "flow_summary"));
    bind("edit-launch-line", command => sendText(command.label, command.replyId));
    bind("delete-launch-line", command => {
      if (flowBusy()) return;
      if (typeof globalThis.confirm === "function" && !globalThis.confirm(`${command.label}? Esta linha será retirada do lançamento em andamento.`)) return;
      return sendText(command.label, command.replyId);
    });
    bind("transfer-attachments", () => {
      if (flowBusy()) return;
      return sendText("", PORTAL_TRANSFER_ATTACHMENTS_ID);
    });
    bind("capture-photo", () => queueSelectedFiles(() => native.capturePhoto()));
    bind("pick-photos", () => queueSelectedFiles(() => native.pickPhotos()));
    bind("pick-document-files", () => queueSelectedFiles(() => native.pickDocuments()));
    bind("signature-captured", command => {
      const file = command?.file;
      if (!file || typeof file !== "object") return false;
      return queueSelectedFiles(() => [file]);
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
    bind("close-pending-provisions", closePendingProvisions);
    bind("pending-provisions-reminder-choice", command => choosePendingProvisionReminder(command.value));
    bind("sign-in", signIn);
    bind("sign-out", signOut);
    bind("retry-session", () => (account ? continueConversation() : signIn()));
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

    try {
      const dispose = await native.onResume?.(() => {
        handleForeground();
        return resumeSharedFiles();
      }, handleBackground);
      if (stopped) dispose?.();
      else unsubscribeResume = dispose;
    } catch (error) {
      if (!stopped && sessionRevision === startRevision) {
        setSessionError(error, "Não foi possível acompanhar os arquivos compartilhados. Feche e abra o aplicativo para recebê-los.");
      }
    }
    if (stopped || sessionRevision !== startRevision) { starting = false; return; }
    try {
      const initializedAccount = await auth.initialize();
      if (stopped || sessionRevision !== startRevision) { starting = false; return; }
      account = initializedAccount;
    } catch (error) {
      if (stopped || sessionRevision !== startRevision) { starting = false; return; }
      account = null;
      sessionError = errorMessage(error, "Não foi possível verificar a sessão Microsoft.");
    }

    const sharedFileIds = await importSharedFiles();
    if (stopped || sessionRevision !== startRevision) { starting = false; return; }
    sessionStatus = account ? "authenticated" : "signed-out";
    pendingProvisionSessionDismissed = false;
    openRecovery();
    render();
    if (account) {
      await continueConversation();
      await refreshPendingProvisionSnapshot();
      await processFiles(sharedFileIds);
    }
    starting = false;
    if (sharedResumeRequested) await resumeSharedFiles();
  }

  function stop() {
    flushRecovery();
    cancelFlowReminder();
    cancelPendingProvisionReminder();
    cancelCompletionMenu();
    cancelResponseTransition();
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
  });
}
