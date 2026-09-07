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

function draftMenuOptions(message) {
  const question = String(message?.question || message?.prompt || "");
  const options = Array.isArray(message?.options) ? message.options.map(option => ({ ...option })) : [];
  if (!/RASCUNHOS?/i.test(question)) return options;

  const deleteIds = new Set(options
    .map(option => String(option.reply || option.id || ""))
    .filter(value => value.startsWith("draft_delete:"))
    .map(value => value.slice("draft_delete:".length)));
  const result = [];
  const resumeIds = new Set();
  for (const option of options) {
    const reply = String(option.reply || option.id || "");
    if (reply.startsWith("draft_delete:")) {
      const draftId = reply.slice("draft_delete:".length);
      const rawLabel = String(option.label || option.title || draftId);
      const title = rawLabel.replace(/^🗑️\s*EXCLUIR\s*•\s*/i, "").replace(/^▶️\s*RETOMAR\s*•\s*/i, "");
      result.push({ ...option, label: `🗑️ EXCLUIR • ${title}` });
      continue;
    }
    if (reply.startsWith("draft_resume:")) {
      const draftId = reply.slice("draft_resume:".length);
      if (resumeIds.has(draftId)) continue;
      resumeIds.add(draftId);
    }
    result.push(option);
    if (!reply.startsWith("draft_resume:")) continue;
    const draftId = reply.slice("draft_resume:".length);
    if (!draftId || deleteIds.has(draftId)) continue;
    const rawLabel = String(option.label || option.title || draftId);
    const title = rawLabel.replace(/^▶️\s*RETOMAR\s*•\s*/i, "");
    result.push({ id: `draft_delete:${draftId}`, reply: `draft_delete:${draftId}`, label: `🗑️ EXCLUIR • ${title}` });
  }
  return result;
}

function draftReplyId(option) {
  return String(option?.reply || option?.id || "");
}

function draftTitle(option) {
  return String(option?.label || option?.title || option?.id || "")
    .replace(/^🗑️\s*EXCLUIR\s*•\s*/i, "")
    .replace(/^▶️\s*RETOMAR\s*•\s*/i, "");
}

function pollButton(option, busy, { deleteButton = false } = {}) {
  const replyId = draftReplyId(option);
  const label = option.label || option.title || option.id;
  if (deleteButton) {
    const title = draftTitle(option);
    return `<button class="chat-draft-delete" type="button" data-action="select-reply" data-reply-id="${escapeHtml(replyId)}" data-label="${escapeHtml(`Excluir rascunho • ${title}`)}" aria-label="Excluir rascunho: ${escapeHtml(title)}" title="Excluir rascunho: ${escapeHtml(title)}"${busy ? " disabled" : ""}>🗑️</button>`;
  }
  return `<button type="button" data-action="select-reply" data-reply-id="${escapeHtml(replyId)}" data-label="${escapeHtml(label)}"${busy ? " disabled" : ""}>${formatChatText(label)}</button>`;
}

function renderPoll(message, busy) {
  const options = draftMenuOptions(message);
  const isDraftMenu = /RASCUNHOS?/i.test(String(message.question || message.prompt || ""));
  const deleteByDraft = new Map(options
    .map(option => [draftReplyId(option), option])
    .filter(([replyId]) => replyId.startsWith("draft_delete:"))
    .map(([replyId, option]) => [replyId.slice("draft_delete:".length), option]));
  const seenDrafts = new Set();
  const choices = options.flatMap(option => {
    const replyId = draftReplyId(option);
    if (isDraftMenu && replyId.startsWith("draft_delete:")) return [];
    if (isDraftMenu && replyId.startsWith("draft_resume:")) {
      const draftId = replyId.slice("draft_resume:".length);
      if (seenDrafts.has(draftId)) return [];
      seenDrafts.add(draftId);
      const deleteOption = deleteByDraft.get(draftId);
      return [`<div class="chat-draft-option">${pollButton(option, busy)}${deleteOption ? pollButton(deleteOption, busy, { deleteButton: true }) : ""}</div>`];
    }
    return [pollButton(option, busy)];
  }).join("");
  return `<div class="chat-choice-card">
    <p>${formatChatText(message.question || "Escolha uma opção")}</p>
    <div class="chat-choice-list">${choices}</div>
  </div>`;
}

function renderMessage(message, account, busy) {
  if (message.type === "poll") {
    return `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong>${renderPoll(message, busy)}</div></article>`;
  }
  if (message.type === "image" || message.type === "document") {
    const label = message.caption || message.fileName || "Arquivo gerado";
    const preview = message.previewUrl
      ? `<img class="chat-media-preview__image" src="${escapeHtml(message.previewUrl)}" alt="Prévia de ${escapeHtml(label)}">`
      : `<span class="chat-media-preview__icon" aria-hidden="true">${message.type === "image" ? "🖼️" : "📄"}</span>`;
    return `<article class="chat-message chat-message--assistant">${assistantAvatar()}<div class="chat-bubble"><strong>Energético</strong><p>${message.caption ? formatChatText(label) : escapeHtml(label)}</p><button class="chat-media-preview chat-media-preview--${message.type}" type="button" data-action="open-media" data-message-id="${escapeHtml(message.id)}" aria-label="Abrir ${escapeHtml(label)}">${preview}<span class="chat-media-preview__caption"><b>${message.caption ? formatChatText(label) : escapeHtml(label)}</b><small>Toque para abrir o arquivo completo</small></span></button></div></article>`;
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
    <ul>${attachments.map(item => `<li><button type="button" data-action="open-file" data-file-id="${escapeHtml(item.id)}" aria-label="Visualizar ${escapeHtml(item.fileName)}">${item.previewUrl ? `<img class="chat-attachment-preview" src="${escapeHtml(item.previewUrl)}" alt="">` : `<span class="chat-attachment-icon" aria-hidden="true">${String(item.mimeType).toLowerCase() === "application/pdf" || item.fileName.toLowerCase().endsWith(".pdf") ? "📄" : "🖼️"}</span>`}<span><strong>${escapeHtml(item.fileName)}</strong><small>${escapeHtml(formatBytes(item.size))} · Toque para visualizar</small></span></button></li>`).join("")}</ul>
  </details>`;
}

function settingsButton(extraClass = "") {
  return `<button class="header-action header-settings ${extraClass}" type="button" data-action="open-settings" aria-label="Instalar e configurar compartilhamento" title="Instalar e configurar compartilhamento"><span aria-hidden="true">⚙️</span></button>`;
}

function renderLaunches(launches) {
  if (!launches) return "";
  const formatLaunchNumber = (value, digits, currency = false) => {
    const raw = String(value ?? "").trim();
    const compact = raw.replace(/R\$\s*/gi, "").replace(/\s/g, "");
    if (!compact) return raw;
    const normalized = compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact;
    const sign = normalized.startsWith("-") ? "-" : "";
    const unsigned = sign ? normalized.slice(1) : normalized;
    const [integerPart, fractionPart = ""] = unsigned.split(".");
    if (!/^\d+$/.test(integerPart) || !/^\d*$/.test(fractionPart)) return raw;
    const scale = 10n ** BigInt(digits);
    const keptFraction = fractionPart.padEnd(digits, "0").slice(0, digits);
    let scaled = BigInt(integerPart) * scale + BigInt(keptFraction || "0");
    if (fractionPart[digits] && fractionPart[digits] >= "5") scaled += 1n;
    const integer = scaled / scale;
    const fraction = digits ? String(scaled % scale).padStart(digits, "0") : "";
    const integerDisplay = String(integer).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const formatted = `${sign}${integerDisplay}${digits ? `,${fraction}` : ""}`;
    return currency ? `R$ ${formatted}` : formatted;
  };
  const currency = (value, digits = 2) => formatLaunchNumber(value, digits, true);
  return `<details class="chat-launches" data-batch-id="${escapeHtml(launches.id)}">
    <summary>Total: ${escapeHtml(currency(launches.totalDisplay, 2))}</summary>
    ${launches.lines.length ? `<div class="chat-launch-table" role="table" aria-label="Linhas de lançamento"><div class="chat-launch-row chat-launch-row--header" role="row"><span>Produto</span><span>Unitário</span><span>Qtd.</span><span>Frete</span><span>Total</span></div>${launches.lines.map(line => `<div class="chat-launch-row" role="row"><strong title="${escapeHtml(line.product)}">${line.index}. ${escapeHtml(line.product)}</strong><span class="chat-launch-amount">${escapeHtml(currency(line.unitPriceDisplay, 1))}</span><span class="chat-launch-amount">${escapeHtml(formatLaunchNumber(line.quantity, 1))}</span><span class="chat-launch-amount">${escapeHtml(currency(line.freightDisplay, 1))}</span><strong class="chat-launch-total">${escapeHtml(currency(line.totalDisplay, 2))}</strong></div>`).join("")}</div>`
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
        <button type="button" data-action="pick-files" aria-label="Escolher fotos ou documentos"${busy ? " disabled" : ""}>📎</button>
        <button type="button" data-action="capture-photo" aria-label="Tirar foto"${busy ? " disabled" : ""}>📷</button>
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
