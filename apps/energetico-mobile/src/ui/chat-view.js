import { escapeHtml } from "./escape-html.js";

const MASCOT_URL = new URL("../../pwa/icons/mascote-192.png", import.meta.url).href;

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
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

function renderPoll(message, busy) {
  const options = Array.isArray(message.options) ? message.options : [];
  return `<div class="chat-choice-card">
    <p>${escapeHtml(message.question || "Escolha uma opção")}</p>
    <div class="chat-choice-list">${options.map(option => {
      const replyId = option.reply || option.id;
      const label = option.label || option.title || option.id;
      return `<button type="button" data-action="select-reply" data-reply-id="${escapeHtml(replyId)}" data-label="${escapeHtml(label)}"${busy ? " disabled" : ""}>${escapeHtml(label)}</button>`;
    }).join("")}</div>
  </div>`;
}

function renderMessage(message, account, busy) {
  if (message.type === "poll") {
    return `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong>${renderPoll(message, busy)}</div></article>`;
  }
  if (message.type === "image" || message.type === "document") {
    const label = message.caption || message.fileName || "Arquivo gerado";
    return `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong><p>${escapeHtml(label)}</p><button class="chat-media-button" type="button" data-action="open-media" data-message-id="${escapeHtml(message.id)}">Abrir ${message.type === "image" ? "imagem" : "documento"}</button></div></article>`;
  }

  const isUser = message.role === "user";
  const name = isUser ? account?.name || "Você" : "Energético";
  const avatar = isUser ? userAvatar(account) : assistantAvatar();
  return `<article class="chat-message chat-message--${isUser ? "user" : "assistant"}">${avatar}<div class="chat-bubble"><strong>${escapeHtml(name)}</strong><p>${escapeHtml(message.text || "")}</p></div></article>`;
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

function renderAttachments(attachments) {
  if (!attachments.length) return "";
  return `<details class="chat-attachments"><summary>📎 Anexos do fluxo (${attachments.length})</summary>
    <ul>${attachments.map(item => `<li><button type="button" data-action="open-file" data-file-id="${escapeHtml(item.id)}" aria-label="Visualizar ${escapeHtml(item.fileName)}"><span aria-hidden="true">📎</span><span><strong>${escapeHtml(item.fileName)}</strong><small>${escapeHtml(formatBytes(item.size))} · Toque para visualizar</small></span></button></li>`).join("")}</ul>
  </details>`;
}

function renderSignedOut(status, error) {
  const isLoading = status === "initializing";
  return `<section class="auth-screen">
    <div class="auth-card">
      <img class="auth-mascot" src="${MASCOT_URL}" alt="Mascote Energético">
      <p class="eyebrow">ENERGÉTICA</p>
      <h1>Energético</h1>
      <p>Seu assistente administrativo em uma conversa segura.</p>
      ${error ? `<p class="error-banner" role="alert">${escapeHtml(error)}</p>` : ""}
      <button class="primary-button" type="button" data-action="sign-in"${isLoading ? " disabled" : ""}>${isLoading ? "Verificando sessão…" : "Entrar com a Microsoft"}</button>
    </div>
  </section>`;
}

export function renderChatMarkup(state = {}) {
  if (state.sessionStatus !== "authenticated") {
    return renderSignedOut(state.sessionStatus, state.error);
  }

  const messages = Array.isArray(state.messages) ? state.messages : [];
  const pendingFiles = Array.isArray(state.pendingFiles) ? state.pendingFiles : [];
  const attachments = Array.isArray(state.attachments) ? state.attachments : [];
  const busy = Boolean(state.activeText || state.resuming) || pendingFiles.some(item => item.status === "sending");
  const firstName = String(state.account?.name || "Você").split(/\s+/)[0];

  return `<section class="chat-shell">
    <header class="chat-header">
      ${assistantAvatar()}
      <span><strong>Energético</strong><small>${escapeHtml(firstName)}, conectado à VM</small></span>
      <button class="header-action" type="button" data-action="sign-out">Sair</button>
    </header>
    ${state.error ? `<div class="error-banner" role="alert"><span>${escapeHtml(state.error)}</span><button type="button" data-action="retry-session"${busy ? " disabled" : ""}>Retomar conversa</button></div>` : ""}
    <div class="chat-transcript" role="log" aria-live="polite" aria-relevant="additions text">
      ${messages.length ? messages.map(message => renderMessage(message, state.account, busy)).join("") : `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong><p>Olá, ${escapeHtml(firstName)}. O que vamos fazer?</p></div></article>`}
    </div>
    ${busy ? `<div class="chat-progress" role="status" aria-live="polite"><span aria-hidden="true">●</span> ${state.resuming ? "Retomando conversa…" : state.activeText ? "Processando sua resposta…" : "Enviando anexo…"}</div>` : ""}
    ${attachments.length || pendingFiles.length ? `<div class="chat-file-tray">${renderAttachments(attachments)}${pendingFiles.length ? `<ul class="pending-files" aria-label="Anexos pendentes">${pendingFiles.map(renderPendingFile).join("")}</ul>` : ""}</div>` : ""}
    <form class="chat-composer" data-chat-form>
      <div class="attachment-actions" aria-label="Adicionar anexo">
        <button type="button" data-action="capture-photo" aria-label="Tirar foto"${busy ? " disabled" : ""}>📷</button>
        <button type="button" data-action="pick-files" aria-label="Escolher fotos ou documentos"${busy ? " disabled" : ""}>📎</button>
      </div>
      <label class="sr-only" for="chatDraft">Mensagem</label>
      <textarea id="chatDraft" data-role="draft" rows="1" autocomplete="off" placeholder="Digite uma mensagem"${busy ? " disabled" : ""}>${escapeHtml(state.draft || "")}</textarea>
      <button class="send-button" type="submit" data-action="send-text" aria-label="Enviar mensagem"${busy || !String(state.draft || "").trim() ? " disabled" : ""}>Enviar</button>
    </form>
  </section>`;
}

export function commandFromTarget(target) {
  const actionTarget = target?.closest?.("[data-action]");
  if (!actionTarget) return null;
  return {
    type: actionTarget.dataset.action,
    ...(actionTarget.dataset.replyId ? { replyId: actionTarget.dataset.replyId } : {}),
    ...(actionTarget.dataset.label ? { label: actionTarget.dataset.label } : {}),
    ...(actionTarget.dataset.fileId ? { fileId: actionTarget.dataset.fileId } : {}),
    ...(actionTarget.dataset.messageId ? { messageId: actionTarget.dataset.messageId } : {}),
  };
}

export function createChatView(root) {
  if (!root?.addEventListener) throw new TypeError("A tela do Energético requer um elemento raiz.");
  const handlers = new Map();
  let messageKey = "";
  let lastState = null;

  function onlyDraftChanged(state) {
    return lastState && state.sessionStatus === "authenticated"
      && lastState.sessionStatus === state.sessionStatus
      && lastState.account?.name === state.account?.name
      && lastState.account?.username === state.account?.username
      && lastState.account?.homeAccountId === state.account?.homeAccountId
      && ["messages", "attachments", "pendingFiles", "activeText", "resuming", "error"].every(key => lastState[key] === state[key]);
  }

  function emit(command) {
    handlers.get(command.type)?.forEach(handler => handler(command));
  }

  function click(event) {
    const command = commandFromTarget(event.target);
    if (!command) return;
    if (command.type === "send-text") return;
    event.preventDefault?.();
    emit(command);
  }

  function input(event) {
    if (event.target?.dataset?.role === "draft") {
      emit({ type: "draft-changed", value: event.target.value });
    }
  }

  function submit(event) {
    if (!event.target?.matches?.("[data-chat-form]")) return;
    event.preventDefault?.();
    emit({ type: "send-text" });
  }

  root.addEventListener("click", click);
  root.addEventListener("input", input);
  root.addEventListener("submit", submit);

  return Object.freeze({
    render(state) {
      if (onlyDraftChanged(state)) {
        const draft = root.querySelector('[data-role="draft"]');
        if (draft && draft.value !== (state.draft || "")) draft.value = state.draft || "";
        const send = root.querySelector('[data-action="send-text"]');
        if (send) send.disabled = Boolean(state.activeText || state.resuming) || (state.pendingFiles || []).some(item => item.status === "sending") || !String(state.draft || "").trim();
        lastState = state;
        return;
      }
      const active = (root.ownerDocument || globalThis.document)?.activeElement;
      const restoreDraft = active?.dataset?.role === "draft";
      const selectionStart = restoreDraft ? active.selectionStart : null;
      const attachmentsOpen = root.querySelector?.(".chat-attachments")?.open;
      const previousScroll = root.querySelector?.('[role="log"]')?.scrollTop || 0;
      const trayScroll = root.querySelector?.(".chat-file-tray")?.scrollTop || 0;
      const nextMessageKey = (state.messages || []).map(message => message.id).join("|");
      root.innerHTML = renderChatMarkup(state);
      const attachments = root.querySelector?.(".chat-attachments");
      if (attachments && attachmentsOpen) attachments.open = true;
      const tray = root.querySelector?.(".chat-file-tray");
      if (tray) tray.scrollTop = trayScroll;
      if (restoreDraft) {
        const draft = root.querySelector?.('[data-role="draft"]');
        draft?.focus?.();
        if (selectionStart !== null) draft?.setSelectionRange?.(selectionStart, selectionStart);
      }
      const transcript = root.querySelector?.('[role="log"]');
      if (transcript) transcript.scrollTop = messageKey === nextMessageKey ? previousScroll : transcript.scrollHeight;
      messageKey = nextMessageKey;
      lastState = state;
    },
    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
      return () => handlers.get(type)?.delete(handler);
    },
    focusComposer() {
      root.querySelector?.('[data-role="draft"]')?.focus?.();
    },
    destroy() {
      root.removeEventListener("click", click);
      root.removeEventListener("input", input);
      root.removeEventListener("submit", submit);
      handlers.clear();
      lastState = null;
      root.innerHTML = "";
    },
  });
}
