import { escapeHtml } from "./escape-html.js";

const MASCOT_URL = new URL("../../pwa/icons/mascote-192.png", import.meta.url).href;

function formatChatText(value) {
  // Escape first: the only HTML accepted from message formatting is our own <strong>.
  return escapeHtml(String(value ?? "").replace(/\r\n?/g, "\n"))
    .replace(/(^|[^*])(\*{1,2})([^\s*](?:[^*\n]*[^\s*])?)\2(?!\*)/g,
      (_, prefix, marker, content) => `${prefix}<strong>${content}</strong>`);
}

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
    <p>${formatChatText(message.question || "Escolha uma opção")}</p>
    <div class="chat-choice-list">${options.map(option => {
      const replyId = option.reply || option.id;
      const label = option.label || option.title || option.id;
      return `<button type="button" data-action="select-reply" data-reply-id="${escapeHtml(replyId)}" data-label="${escapeHtml(label)}"${busy ? " disabled" : ""}>${formatChatText(label)}</button>`;
    }).join("")}</div>
  </div>`;
}

function renderMessage(message, account, busy) {
  if (message.type === "poll") {
    return `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong>${renderPoll(message, busy)}</div></article>`;
  }
  if (message.type === "image" || message.type === "document") {
    const label = message.caption || message.fileName || "Arquivo gerado";
    return `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong><p>${message.caption ? formatChatText(label) : escapeHtml(label)}</p><button class="chat-media-button" type="button" data-action="open-media" data-message-id="${escapeHtml(message.id)}">Abrir ${message.type === "image" ? "imagem" : "documento"}</button></div></article>`;
  }

  const isUser = message.role === "user";
  const name = isUser ? account?.name || "Você" : "Energético";
  const avatar = isUser ? userAvatar(account) : assistantAvatar();
  return `<article class="chat-message chat-message--${isUser ? "user" : "assistant"}">${avatar}<div class="chat-bubble"><strong>${escapeHtml(name)}</strong><p>${isUser ? escapeHtml(message.text || "") : formatChatText(message.text)}</p></div></article>`;
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

function settingsButton(extraClass = "") {
  return `<button class="header-action header-settings ${extraClass}" type="button" data-action="open-settings" aria-label="Instalar e configurar compartilhamento" title="Instalar e configurar compartilhamento"><span aria-hidden="true">⚙️</span></button>`;
}

function renderLaunches(launches) {
  if (!launches) return "";
  const quantity = value => {
    const [integer, fraction] = value.split(".");
    return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (fraction ? `,${fraction}` : "");
  };
  return `<details class="chat-launches" data-batch-id="${escapeHtml(launches.id)}">
    <summary>Total: ${escapeHtml(launches.totalDisplay)}</summary>
    ${launches.lines.length ? `<ol>${launches.lines.map(line => `<li><strong>${line.index}. ${escapeHtml(line.product)}</strong>
      <dl><div><dt>Valor unitário</dt><dd>${escapeHtml(line.unitPriceDisplay)}</dd></div>
      <div><dt>Quantidade</dt><dd>${escapeHtml(quantity(line.quantity))} ${escapeHtml(line.unit)}</dd></div>
      <div><dt>Frete</dt><dd>${escapeHtml(line.freightDisplay)}</dd></div>
      <div><dt>Total</dt><dd>${escapeHtml(line.totalDisplay)}</dd></div></dl></li>`).join("")}</ol>`
      : `<p>Nenhuma linha adicionada.</p>`}
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

function renderSignedOut(status, error, showSettings) {
  const isLoading = status === "initializing";
  return `<section class="auth-screen">
    <div class="auth-card">
      <img class="auth-mascot" src="${MASCOT_URL}" alt="Mascote Energético">
      <p class="eyebrow">ENERGÉTICA</p>
      <h1>Energético</h1>
      <p>Seu assistente administrativo em uma conversa segura.</p>
      ${error ? `<p class="error-banner" role="alert">${escapeHtml(error)}</p>` : ""}
      <button class="primary-button" type="button" data-action="sign-in"${isLoading ? " disabled" : ""}>${isLoading ? "Verificando sessão…" : "Entrar com a Microsoft"}</button>
      ${showSettings ? settingsButton("auth-settings") : ""}
    </div>
  </section>`;
}

export function renderChatMarkup(state = {}, { showSettings = false } = {}) {
  if (state.sessionStatus !== "authenticated") {
    return renderSignedOut(state.sessionStatus, state.error, showSettings);
  }

  const messages = Array.isArray(state.messages) ? state.messages : [];
  const pendingFiles = Array.isArray(state.pendingFiles) ? state.pendingFiles : [];
  const attachments = Array.isArray(state.attachments) ? state.attachments : [];
  const busy = Boolean(state.activeText || state.resuming || state.recoveryBlocked) || pendingFiles.some(item => item.status === "sending");
  const firstName = String(state.account?.name || "Você").split(/\s+/)[0];

  return `<section class="chat-shell">
    <header class="chat-header">
      ${assistantAvatar()}
      <span><strong>Energético</strong><small>${escapeHtml(firstName)}, conectado à VM</small></span>
      ${showSettings ? settingsButton() : ""}
      <button class="header-action" type="button" data-action="sign-out">Sair</button>
    </header>
    ${state.activeFlow ? `<div class="chat-flow-status"><span><small>Fluxo em andamento</small><strong>${escapeHtml(state.activeFlow.title)}</strong></span><button type="button" data-action="show-summary"${busy ? " disabled" : ""}>Ver resumo</button></div>` : ""}
    ${state.error ? `<div class="error-banner" role="alert"><span>${escapeHtml(state.error)}</span><button type="button" data-action="retry-session"${state.resuming || state.activeText ? " disabled" : ""}>Retomar conversa</button></div>` : ""}
    <div class="chat-transcript" role="log" aria-live="polite" aria-relevant="additions text">
      ${state.recoveryWarning ? `<p class="error-banner" role="alert">${escapeHtml(state.recoveryWarning)}</p>` : ""}
      ${renderRecovery(state)}
      ${messages.length ? messages.map(message => renderMessage(message, state.account, busy)).join("") : state.recoveryPreview ? "" : `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong><p>Olá, ${escapeHtml(firstName)}. O que vamos fazer?</p></div></article>`}
    </div>
    ${busy ? `<div class="chat-progress" role="status" aria-live="polite"><span aria-hidden="true">●</span> ${state.resuming ? "Retomando conversa…" : state.activeText ? "Processando sua resposta…" : state.recoveryBlocked ? "Aguardando conexão com a VM…" : "Enviando anexo…"}</div>` : ""}
    ${attachments.length || pendingFiles.length || state.activeFlow?.launches ? `<div class="chat-file-tray">${renderAttachments(attachments)}${pendingFiles.length ? `<ul class="pending-files" aria-label="Anexos pendentes">${pendingFiles.map(renderPendingFile).join("")}</ul>` : ""}${renderLaunches(state.activeFlow?.launches)}</div>` : ""}
    <form class="chat-composer" data-chat-form>
      <div class="attachment-actions" aria-label="Adicionar anexo">
        <button type="button" data-action="capture-photo" aria-label="Tirar foto"${busy ? " disabled" : ""}>📷</button>
        <button type="button" data-action="pick-files" aria-label="Escolher fotos ou documentos"${busy ? " disabled" : ""}>📎</button>
      </div>
      <label class="sr-only" for="chatDraft">Mensagem</label>
      <textarea id="chatDraft" data-role="draft" rows="3" autocomplete="off" placeholder="Digite uma mensagem">${escapeHtml(state.draft || "")}</textarea>
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

export function createChatView(root, { onOpenSettings } = {}) {
  if (!root?.addEventListener) throw new TypeError("A tela do Energético requer um elemento raiz.");
  const handlers = new Map();
  let messageKey = "";
  let lastState = null;
  let composerControls = {};
  let composerBusy = false;
  let composing = false;

  function onlyDraftChanged(state) {
    return lastState && state.sessionStatus === "authenticated"
      && lastState.sessionStatus === state.sessionStatus
      && lastState.account?.name === state.account?.name
      && lastState.account?.username === state.account?.username
      && lastState.account?.homeAccountId === state.account?.homeAccountId
      && (!state.recoveryReference || Boolean(lastState.draft) === Boolean(state.draft))
      && ["messages", "attachments", "pendingFiles", "activeText", "activeFlow", "resuming", "error", "recoveryPreview", "recoveryReference", "recoveryReferenceCount", "recoveryWarning", "recoveryBlocked"].every(key => lastState[key] === state[key]);
  }

  function syncComposer(state, draftOnly = false) {
    const { draft } = composerControls;
    if (!composing && draft && draft.value !== (state.draft || "")) draft.value = state.draft || "";
    if (!draftOnly) composerBusy = Boolean(state.activeText || state.resuming || state.recoveryBlocked) || (state.pendingFiles || []).some(item => item.status === "sending");
    for (const action of draftOnly ? ["send-text"] : ["send-text", "capture-photo", "pick-files"]) {
      const button = composerControls[action];
      const disabled = composerBusy || (action === "send-text" && !String(state.draft || "").trim());
      if (button && button.disabled !== disabled) button.disabled = disabled;
    }
  }

  function updateShell(markup, state) {
    const shell = root.querySelector('.chat-shell');
    const composer = shell?.querySelector('[data-chat-form]');
    if (!composer || state.sessionStatus !== "authenticated") {
      root.innerHTML = markup;
      composing = false;
      composerControls = { draft: root.querySelector('[data-role="draft"]') };
      for (const action of ["send-text", "capture-photo", "pick-files"]) {
        composerControls[action] = root.querySelector(`[data-action="${action}"]`);
      }
      return;
    }
    const template = root.ownerDocument.createElement('template');
    template.innerHTML = markup;
    const nextShell = template.content.querySelector('.chat-shell');
    // Never detach the composer: restoring focus on a new field resets the iOS keyboard.
    for (const child of [...shell.children]) {
      if (child !== composer) child.remove();
    }
    for (const child of [...nextShell.children]) {
      if (!child.matches('[data-chat-form]')) shell.insertBefore(child, composer);
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

  function click(event) {
    const command = commandFromTarget(event.target);
    if (!command) return;
    if (command.type === "send-text") return;
    event.preventDefault?.();
    if (command.type === "open-settings") return onOpenSettings?.();
    emit(command);
  }

  function input(event) {
    if (event.target?.dataset?.role === "draft") {
      resizeDraft(event.target);
      emit({ type: "draft-changed", value: event.target.value });
    }
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

  root.addEventListener("click", click);
  root.addEventListener("input", input);
  root.addEventListener("submit", submit);
  root.addEventListener("compositionstart", compositionStart);
  root.addEventListener("compositionend", compositionEnd);

  return Object.freeze({
    render(state) {
      if (onlyDraftChanged(state)) {
        syncComposer(state, true);
        lastState = state;
        return;
      }
      const attachmentsOpen = root.querySelector?.(".chat-attachments")?.open;
      const oldLaunches = root.querySelector?.(".chat-launches");
      const launchOpen = oldLaunches?.open;
      const sameLaunch = oldLaunches?.dataset.batchId === state.activeFlow?.launches?.id;
      const previousScroll = root.querySelector?.('[role="log"]')?.scrollTop || 0;
      const trayScroll = root.querySelector?.(".chat-file-tray")?.scrollTop || 0;
      const nextMessageKey = (state.messages || []).map(message => message.id).join("|");
      updateShell(renderChatMarkup(state, { showSettings: typeof onOpenSettings === "function" }), state);
      syncComposer(state);
      const attachments = root.querySelector?.(".chat-attachments");
      if (attachments && attachmentsOpen) attachments.open = true;
      const tray = root.querySelector?.(".chat-file-tray");
      const launches = root.querySelector?.(".chat-launches");
      if (launches && sameLaunch) launches.open = Boolean(launchOpen);
      if (tray) tray.scrollTop = launches && !sameLaunch ? 0 : trayScroll;
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
    destroy() {
      root.removeEventListener("click", click);
      root.removeEventListener("input", input);
      root.removeEventListener("submit", submit);
      root.removeEventListener("compositionstart", compositionStart);
      root.removeEventListener("compositionend", compositionEnd);
      composerControls = {};
      composing = false;
      handlers.clear();
      lastState = null;
      root.innerHTML = "";
    },
  });
}
