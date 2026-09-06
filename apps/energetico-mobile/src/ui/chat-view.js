import { escapeHtml } from "./escape-html.js";

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function assistantAvatar() {
  return '<span class="chat-avatar chat-avatar--assistant"><img src="./mascote.png" alt="Mascote Energético"></span>';
}

function userAvatar(account) {
  const name = String(account?.name || account?.username || "Usuário").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = `${parts[0]?.[0] || "U"}${parts.length > 1 ? parts.at(-1)?.[0] || "" : ""}`.toUpperCase();
  return `<span class="chat-avatar chat-avatar--user" aria-hidden="true">${escapeHtml(initials)}</span>`;
}

function renderPoll(message) {
  const options = Array.isArray(message.options) ? message.options : [];
  return `<div class="chat-choice-card">
    <p>${escapeHtml(message.question || "Escolha uma opção")}</p>
    <div class="chat-choice-list">${options.map(option => {
      const replyId = option.reply || option.id;
      const label = option.label || option.title || option.id;
      return `<button type="button" data-action="select-reply" data-reply-id="${escapeHtml(replyId)}" data-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
    }).join("")}</div>
  </div>`;
}

function renderMessage(message, account) {
  if (message.type === "poll") {
    return `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong>${renderPoll(message)}</div></article>`;
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
    <span class="pending-file__actions">${retry}<button type="button" data-action="remove-file" data-file-id="${escapeHtml(item.id)}" aria-label="Remover ${escapeHtml(fileName)}">Remover</button></span>
  </li>`;
}

function renderSignedOut(status, error) {
  const isLoading = status === "initializing";
  return `<section class="auth-screen">
    <div class="auth-card">
      <img class="auth-mascot" src="./mascote.png" alt="Mascote Energético">
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
  const busy = Boolean(state.activeText) || pendingFiles.some(item => item.status === "sending");
  const firstName = String(state.account?.name || "Você").split(/\s+/)[0];

  return `<section class="chat-shell">
    <header class="chat-header">
      ${assistantAvatar()}
      <span><strong>Energético</strong><small>${escapeHtml(firstName)}, conectado à VM</small></span>
      <button class="header-action" type="button" data-action="sign-out">Sair</button>
    </header>
    ${state.error ? `<div class="error-banner" role="alert"><span>${escapeHtml(state.error)}</span><button type="button" data-action="retry-session">Tentar novamente</button></div>` : ""}
    <div class="chat-transcript" role="log" aria-live="polite" aria-relevant="additions text">
      ${messages.length ? messages.map(message => renderMessage(message, state.account)).join("") : `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong><p>Olá, ${escapeHtml(firstName)}. O que vamos fazer?</p></div></article>`}
    </div>
    ${pendingFiles.length ? `<ul class="pending-files" aria-label="Anexos pendentes">${pendingFiles.map(renderPendingFile).join("")}</ul>` : ""}
    <form class="chat-composer" data-chat-form>
      <div class="attachment-actions" aria-label="Adicionar anexo">
        <button type="button" data-action="capture-photo" aria-label="Tirar foto">📷</button>
        <button type="button" data-action="pick-files" aria-label="Escolher fotos ou documentos">📎</button>
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
      const active = globalThis.document?.activeElement;
      const restoreDraft = active?.dataset?.role === "draft";
      const selectionStart = restoreDraft ? active.selectionStart : null;
      root.innerHTML = renderChatMarkup(state);
      if (restoreDraft) {
        const draft = root.querySelector?.('[data-role="draft"]');
        draft?.focus?.();
        if (selectionStart !== null) draft?.setSelectionRange?.(selectionStart, selectionStart);
      }
      const transcript = root.querySelector?.('[role="log"]');
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
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
      root.innerHTML = "";
    },
  });
}
