import { assistantQuickActions, resolveAssistantCommand } from "../assistant/assistant-intents.js";
import { loadPresenceValidation } from "../assistant/presence-validation.js";
import { escapeHtml } from "../core/utils.js";

function accountName(account) {
  return account?.name || account?.idTokenClaims?.name || account?.username || "Usuário";
}

function initials(name) {
  const parts = String(name || "U").trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || "U"}${parts.length > 1 ? parts.at(-1)?.[0] || "" : ""}`.toUpperCase();
}

function mascotAvatar(src, extraClass = "") {
  return `<span class="assistant-avatar is-energetico ${extraClass}"><img src="${escapeHtml(src)}" alt="Energético"></span>`;
}

function userAvatar(account) {
  return `<span class="assistant-avatar is-user-avatar"><img data-assistant-user-photo alt="Foto de ${escapeHtml(accountName(account))}" hidden><span data-assistant-user-initials>${escapeHtml(initials(accountName(account)))}</span></span>`;
}

export function formatAssistantText(value = "") {
  return escapeHtml(String(value).replace(/\r\n?/g, "\n"))
    .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
}

function moduleChoices(menuItems, quickActions = []) {
  const operations = quickActions.length ? `<p>Operações</p><div class="assistant-module-menu assistant-quick-menu">${quickActions.map(item => `<button type="button" data-assistant-command="${escapeHtml(item.command)}">${escapeHtml(item.label)}</button>`).join("")}</div>` : "";
  return `<div class="assistant-choice-card" data-assistant-choice-card>${operations}<p>Menu principal</p><div class="assistant-module-menu">${menuItems.map(item => `<button type="button" data-assistant-module="${escapeHtml(item.moduleId)}" data-assistant-command="abrir ${escapeHtml(item.label)}">${escapeHtml(item.label)}</button>`).join("")}</div></div>`;
}

export function assistantMarkup({ account = {}, mascotSrc = "assets/mascote-energetica-transparente.png", menuItems = [], quickActions = [] } = {}) {
  return `<button class="operations-assistant-launcher" data-assistant-open type="button" aria-controls="operationsAssistantPanel" aria-expanded="false">
    ${mascotAvatar(mascotSrc, "is-launcher")}<span>Falar com o Energético</span>
  </button>
  <section class="operations-assistant-panel" id="operationsAssistantPanel" data-operations-assistant hidden aria-label="Chat com o Energético">
    <header class="assistant-header">${mascotAvatar(mascotSrc)}<span><strong>Energético</strong><small>Assistente administrativo</small></span><button data-assistant-menu type="button" title="Menu principal" aria-label="Abrir menu principal">Menu</button><button data-assistant-close type="button" title="Fechar" aria-label="Fechar conversa">×</button></header>
    <div class="assistant-transcript" data-assistant-transcript aria-live="polite">
      <article class="assistant-message is-energetico">${mascotAvatar(mascotSrc)}<div class="assistant-bubble"><strong>Energético</strong><p>Olá, ${escapeHtml(accountName(account).split(" ")[0])}. O que vamos fazer?</p></div></article>
      ${moduleChoices(menuItems, quickActions)}
    </div>
    <form class="assistant-composer" data-assistant-form>
      ${userAvatar(account)}
      <div class="assistant-attachment-actions">
        <button data-assistant-camera type="button" aria-label="Tirar foto" title="Tirar foto">📷</button>
        <button data-assistant-file type="button" aria-label="Anexar fotos ou arquivos" title="Anexar fotos ou arquivos">📎</button>
      </div>
      <input data-assistant-camera-input accept="image/*" capture="environment" type="file" hidden>
      <input data-assistant-file-input type="file" multiple hidden>
      <div class="assistant-pending-attachments" data-assistant-attachments hidden></div>
      <label class="sr-only" for="assistantInput">Mensagem</label><input id="assistantInput" data-assistant-input autocomplete="off" placeholder="Digite uma operação ou consulta"><button type="submit">Enviar</button>
    </form>
  </section>`;
}

export function removeConsumedAssistantChoice(target) {
  const card = target?.closest?.("[data-assistant-choice-card]");
  if (!card) return false;
  card.remove();
  return true;
}

export function shouldResetAssistantConversation(result = {}) {
  return result?.resetConversation === true;
}

export async function processAssistantAttachments(files, sendFile, onConfirmed = async () => {}) {
  if (typeof sendFile !== "function") throw new TypeError("O envio de anexos não está disponível.");
  let remaining = Array.from(files || []);
  while (remaining.length) {
    const file = remaining[0];
    let result;
    try {
      result = await sendFile(file);
    } catch (error) {
      return { completed: false, remaining, error };
    }
    remaining = remaining.slice(1);
    await onConfirmed(file, result, [...remaining]);
  }
  return { completed: true, remaining: [], error: undefined };
}

export function clearAssistantConversation(
  transcript,
  mediaObjectUrls,
  revokeObjectUrl = url => globalThis.URL?.revokeObjectURL?.(url),
) {
  mediaObjectUrls?.forEach?.(url => revokeObjectUrl?.(url));
  mediaObjectUrls?.clear?.();
  if (!transcript) return;
  transcript.innerHTML = "";
  transcript.scrollTop = 0;
}

function assistantDraftReplyId(option) {
  return String(option?.reply || option?.id || "");
}

function assistantDraftTitle(option) {
  return String(option?.label || option?.title || option?.id || "")
    .replace(/^🗑️\s*EXCLUIR\s*•\s*/i, "")
    .replace(/^▶️\s*RETOMAR\s*•\s*/i, "");
}

function formatLaunchValue(value, digits, currency = false) {
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
}

export function remoteMessageMarkup(message = {}) {
  if (message.type === "poll") {
    const options = Array.isArray(message.options) ? [...message.options] : [];
    const question = String(message.question || message.prompt || "");
    const hasDraftMenu = /RASCUNHOS?/i.test(question);
    if (hasDraftMenu) {
      const existingDeletes = new Set(options.map(option => String(option.reply || option.id || "")).filter(value => value.startsWith("draft_delete:")).map(value => value.slice("draft_delete:".length)));
      options.filter(option => String(option.reply || option.id || "").startsWith("draft_resume:")).forEach(option => {
        const resumeReply = String(option.reply || option.id || "");
        const draftId = resumeReply.slice("draft_resume:".length);
        if (!draftId || existingDeletes.has(draftId)) return;
        const title = String(option.label || option.title || option.id || "").replace(/^▶️\s*RETOMAR\s*•\s*/i, "");
        options.push({ id: `draft_delete:${draftId}`, reply: `draft_delete:${draftId}`, label: `🗑️ EXCLUIR • ${title}`, draftDelete: true });
      });
      options.forEach(option => {
        const reply = String(option.reply || option.id || "");
        if (!reply.startsWith("draft_delete:")) return;
        const title = String(option.label || option.title || reply.slice("draft_delete:".length))
          .replace(/^🗑️\s*EXCLUIR\s*•\s*/i, "")
          .replace(/^▶️\s*RETOMAR\s*•\s*/i, "");
        option.label = `🗑️ EXCLUIR • ${title}`;
        option.draftDelete = true;
      });
      const seenResumeIds = new Set();
      const uniqueOptions = options.filter(option => {
        const reply = String(option.reply || option.id || "");
        if (!reply.startsWith("draft_resume:")) return true;
        const draftId = reply.slice("draft_resume:".length);
        if (seenResumeIds.has(draftId)) return false;
        seenResumeIds.add(draftId);
        return true;
      });
      options.splice(0, options.length, ...uniqueOptions);
    }
    const draftDeleteById = new Map(options
      .map(option => [assistantDraftReplyId(option), option])
      .filter(([replyId]) => replyId.startsWith("draft_delete:"))
      .map(([replyId, option]) => [replyId.slice("draft_delete:".length), option]));
    const seenDraftIds = new Set();
    const renderedOptions = options.flatMap(option => {
      const replyId = assistantDraftReplyId(option);
      if (hasDraftMenu && replyId.startsWith("draft_delete:")) return [];
      const label = option.label || option.title || option.id;
      if (hasDraftMenu && replyId.startsWith("draft_resume:")) {
        const draftId = replyId.slice("draft_resume:".length);
        if (seenDraftIds.has(draftId)) return [];
        seenDraftIds.add(draftId);
        const deleteOption = draftDeleteById.get(draftId);
        const deleteReply = assistantDraftReplyId(deleteOption || { id: `draft_delete:${draftId}` });
        const deleteTitle = assistantDraftTitle(deleteOption || option);
        const deleteButton = `<button type="button" class="assistant-draft-delete" data-assistant-draft-delete="true" data-assistant-reply="${escapeHtml(deleteReply)}" data-assistant-label="${escapeHtml(`Excluir rascunho • ${deleteTitle}`)}" aria-label="Excluir rascunho: ${escapeHtml(deleteTitle)}" title="Excluir rascunho: ${escapeHtml(deleteTitle)}">🗑️</button>`;
        const resumeButton = `<button type="button" data-assistant-reply="${escapeHtml(replyId)}" data-assistant-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
        return [`<div class="assistant-draft-option">${resumeButton}${deleteButton}</div>`];
      }
      return [`<button type="button" ${option.draftDelete ? "data-assistant-draft-delete=\"true\"" : ""} data-assistant-reply="${escapeHtml(replyId)}" data-assistant-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`];
    }).join("");
    return `<div class="assistant-choice-card" data-assistant-choice-card><p>${formatAssistantText(question || "Escolha uma opção")}</p><div class="assistant-module-menu">${renderedOptions}</div></div>`;
  }
  if (message.type === "document" || message.type === "image") {
    const label = message.caption || message.fileName || "Arquivo gerado";
    return `<figure class="assistant-media" data-assistant-media>
      <figcaption>${escapeHtml(label)}</figcaption>
      <div class="assistant-media-content" data-assistant-media-content>Carregando resumo...</div>
    </figure>`;
  }
  return `<p>${formatAssistantText(message.text || "")}</p>`;
}

function displayValue(value, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

/**
 * Renders the read-only projection returned by the VM for a multiple launch.
 * Each launch line is deliberately a single grid row so product, unit price,
 * quantity, freight and total stay aligned on the same horizontal line.
 */
export function launchesMarkup(launches = {}) {
  const lines = Array.isArray(launches?.lines) ? launches.lines : [];
  if (!lines.length) return "";
  const rows = lines.map((line, index) => {
    const lineNumber = Number.isInteger(Number(line.index)) ? Number(line.index) : index + 1;
    return `<div class="assistant-launch-row" data-assistant-launch-row role="row">
      <span role="cell" class="assistant-launch-product" title="${escapeHtml(displayValue(line.product))}">${escapeHtml(displayValue(line.product))}</span>
      <span role="cell" class="assistant-launch-amount">${escapeHtml(formatLaunchValue(displayValue(line.unitPriceDisplay || line.unitPrice), 1, true))}</span>
      <span role="cell" class="assistant-launch-amount">${escapeHtml(formatLaunchValue(displayValue(line.quantity), 1))}</span>
      <span role="cell" class="assistant-launch-amount">${escapeHtml(formatLaunchValue(displayValue(line.freightDisplay || line.freight), 1, true))}</span>
      <span role="cell" class="assistant-launch-total">${escapeHtml(formatLaunchValue(displayValue(line.totalDisplay || line.total), 2, true))}</span>
      <span role="cell"><button type="button" class="assistant-launch-edit" data-assistant-edit-launch-line="${lineNumber}">Editar</button></span>
    </div>`;
  }).join("");
  return `<details class="assistant-launches" data-assistant-launches>
    <summary><strong>LANÇAMENTOS MÚLTIPLOS</strong><span>${escapeHtml(formatLaunchValue(displayValue(launches.totalDisplay), 2, true))} · ${lines.length} linha(s)</span></summary>
    <div class="assistant-launch-table" role="table" aria-label="Linhas de lançamento">
      <div class="assistant-launch-row assistant-launch-row--header" role="row">
        <span role="columnheader">Produto</span><span role="columnheader">Unitário</span><span role="columnheader">Qtd.</span><span role="columnheader">Frete</span><span role="columnheader">Total</span><span role="columnheader">Ação</span>
      </div>
      ${rows}
    </div>
  </details>`;
}

export function attachmentPreviewMarkup(attachment = {}) {
  const label = attachment.fileName || attachment.name || "Anexo";
  const mimeType = String(attachment.mimeType || attachment.type || "").toLowerCase();
  const preview = mimeType.startsWith("image/")
    ? `<span class="assistant-attachment-preview-placeholder">Prévia da imagem</span>`
    : mimeType === "application/pdf"
      ? `<span class="assistant-attachment-preview-placeholder">Prévia do PDF</span>`
      : `<span class="assistant-attachment-preview-placeholder">Arquivo</span>`;
  return `<figure class="assistant-media assistant-attachment-media" data-assistant-attachment-media data-attachment-id="${escapeHtml(attachment.id || label)}">
    <figcaption>${escapeHtml(label)}</figcaption>
    <div class="assistant-media-content" data-assistant-media-content>${preview}</div>
  </figure>`;
}

function choiceMarkup(menuItems, quickActions) {
  return moduleChoices(menuItems, quickActions);
}

export function createOperationsAssistant(root, context = {}) {
  if (!root) throw new TypeError("O assistente operacional requer um elemento raiz.");
  const mascotSrc = context.mascotSrc || "assets/mascote-energetica-transparente.png";
  const menuItems = context.menuItems || [];
  const quickActions = context.quickActions || assistantQuickActions(context);
  root.innerHTML = assistantMarkup({ account: context.account, mascotSrc, menuItems, quickActions });
  const panel = root.querySelector?.("[data-operations-assistant]");
  const launcher = root.querySelector?.("[data-assistant-open]");
  const transcript = root.querySelector?.("[data-assistant-transcript]");
  const input = root.querySelector?.("[data-assistant-input]");
  const form = root.querySelector?.("[data-assistant-form]");
  const cameraInput = root.querySelector?.("[data-assistant-camera-input]");
  const fileInput = root.querySelector?.("[data-assistant-file-input]");
  const attachmentList = root.querySelector?.("[data-assistant-attachments]");
  let busy = false;
  let pending;
  let remoteStarted = false;
  const mediaObjectUrls = new Set();
  let pendingFiles = [];

  const setOpen = open => {
    if (!panel) return;
    panel.hidden = !open;
    launcher?.setAttribute?.("aria-expanded", String(Boolean(open)));
    if (open) globalThis.setTimeout?.(() => input?.focus?.(), 0);
  };

  const appendMessage = (role, message) => {
    if (!transcript) return;
    const article = globalThis.document?.createElement?.("article");
    if (!article) return;
    article.className = `assistant-message is-${role}`;
    const avatar = role === "user" ? userAvatar(context.account) : mascotAvatar(mascotSrc);
    const name = role === "user" ? accountName(context.account) : "Energético";
    article.innerHTML = `${avatar}<div class="assistant-bubble"><strong>${escapeHtml(name)}</strong><p>${formatAssistantText(message)}</p></div>`;
    transcript.append?.(article);
    transcript.scrollTop = transcript.scrollHeight;
    if (context.userPhotoUrl) setUserPhoto(context.userPhotoUrl);
  };

  const appendChoices = () => {
    if (!transcript || transcript.querySelector?.("[data-assistant-choice-card]")) return;
    const wrapper = globalThis.document?.createElement?.("div");
    if (!wrapper) return;
    wrapper.innerHTML = choiceMarkup(menuItems, quickActions);
    const card = wrapper.firstElementChild;
    if (card) transcript.append?.(card);
    transcript.scrollTop = transcript.scrollHeight;
  };

  const appendRemotePoll = message => {
    transcript?.querySelectorAll?.("[data-assistant-choice-card]").forEach(card => card.remove());
    const wrapper = globalThis.document?.createElement?.("div");
    if (!wrapper || !transcript) return;
    wrapper.innerHTML = remoteMessageMarkup(message);
    const card = wrapper.firstElementChild;
    if (card) transcript.append?.(card);
    transcript.scrollTop = transcript.scrollHeight;
  };

  const appendRemoteMedia = async message => {
    if (!transcript) return;
    const article = globalThis.document?.createElement?.("article");
    if (!article) return;
    article.className = "assistant-message is-energetico is-media";
    article.innerHTML = `${mascotAvatar(mascotSrc)}<div class="assistant-bubble"><strong>Energético</strong>${remoteMessageMarkup(message)}</div>`;
    transcript.append?.(article);
    transcript.scrollTop = transcript.scrollHeight;
    const content = article.querySelector?.("[data-assistant-media-content]");
    try {
      if (!message.mediaUrl || !context.chatClient?.fetchMedia) throw new Error("Resumo indisponível.");
      const blob = await context.chatClient.fetchMedia(message);
      const objectUrl = globalThis.URL?.createObjectURL?.(blob);
      if (!objectUrl) throw new Error("O navegador não conseguiu abrir o resumo.");
      mediaObjectUrls.add(objectUrl);
      const mimeType = String(message.mimeType || blob.type || "").toLowerCase();
      const fileName = message.fileName || "resumo";
      const preview = mimeType.startsWith("image/")
        ? `<a class="assistant-media-preview-link" href="${escapeHtml(objectUrl)}" target="_blank" rel="noopener" aria-label="Abrir ${escapeHtml(fileName)}"><img class="assistant-media-preview" src="${escapeHtml(objectUrl)}" alt="${escapeHtml(message.caption || fileName)}"></a>`
        : mimeType === "application/pdf"
          ? `<a class="assistant-media-preview-link is-document" href="${escapeHtml(objectUrl)}" target="_blank" rel="noopener" aria-label="Abrir ${escapeHtml(fileName)}"><iframe class="assistant-media-preview is-pdf" src="${escapeHtml(objectUrl)}" title="${escapeHtml(message.caption || fileName)}"></iframe></a>`
          : `<p>Arquivo pronto para abrir ou baixar.</p>`;
      if (content) content.innerHTML = `${preview}<a class="assistant-media-open" href="${escapeHtml(objectUrl)}" target="_blank" rel="noopener">Abrir documento completo</a><a class="assistant-media-download" href="${escapeHtml(objectUrl)}" download="${escapeHtml(fileName)}">Baixar arquivo</a>`;
    } catch (error) {
      if (content) content.textContent = error?.message || "Não foi possível carregar o resumo.";
    }
    transcript.scrollTop = transcript.scrollHeight;
  };

  const appendLaunches = launches => {
    if (!transcript) return;
    transcript.querySelectorAll?.("[data-assistant-launches]").forEach(item => item.closest?.(".assistant-message")?.remove?.() || item.remove());
    const markup = launchesMarkup(launches);
    if (!markup) return;
    const article = globalThis.document?.createElement?.("article");
    if (!article) return;
    article.className = "assistant-message is-energetico is-launches";
    article.innerHTML = `${mascotAvatar(mascotSrc)}<div class="assistant-bubble"><strong>Energético</strong>${markup}</div>`;
    transcript.append?.(article);
    transcript.scrollTop = transcript.scrollHeight;
  };

  const appendAttachmentPreviews = async attachments => {
    if (!transcript || !Array.isArray(attachments) || !attachments.length) return;
    transcript.querySelectorAll?.("[data-assistant-attachment-previews]").forEach(item => item.remove());
    const article = globalThis.document?.createElement?.("article");
    if (!article) return;
    article.className = "assistant-message is-energetico is-media is-attachments";
    article.dataset.assistantAttachmentPreviews = "true";
    article.innerHTML = `${mascotAvatar(mascotSrc)}<div class="assistant-bubble"><strong>Energético</strong>${attachments.map(attachmentPreviewMarkup).join("")}</div>`;
    transcript.append?.(article);
    const figures = Array.from(article.querySelectorAll?.("[data-assistant-attachment-media]") || []);
    for (const attachment of attachments) {
      const attachmentKey = String(attachment.id || attachment.fileName || "");
      const figure = figures.find(item => item.dataset?.attachmentId === attachmentKey);
      const content = figure?.querySelector?.("[data-assistant-media-content]");
      if (!content || !attachment.mediaUrl || !context.chatClient?.fetchMedia) continue;
      try {
        const blob = await context.chatClient.fetchMedia(attachment);
        const objectUrl = globalThis.URL?.createObjectURL?.(blob);
        if (!objectUrl) throw new Error("O navegador não conseguiu abrir o anexo.");
        mediaObjectUrls.add(objectUrl);
        const mimeType = String(attachment.mimeType || blob.type || "").toLowerCase();
        const fileName = attachment.fileName || "anexo";
        const preview = mimeType.startsWith("image/")
          ? `<a class="assistant-media-preview-link" href="${escapeHtml(objectUrl)}" target="_blank" rel="noopener" aria-label="Abrir ${escapeHtml(fileName)}"><img class="assistant-media-preview" src="${escapeHtml(objectUrl)}" alt="${escapeHtml(fileName)}"></a>`
          : mimeType === "application/pdf"
            ? `<a class="assistant-media-preview-link is-document" href="${escapeHtml(objectUrl)}" target="_blank" rel="noopener" aria-label="Abrir ${escapeHtml(fileName)}"><iframe class="assistant-media-preview is-pdf" src="${escapeHtml(objectUrl)}" title="${escapeHtml(fileName)}"></iframe></a>`
            : `<p>Arquivo pronto para abrir ou baixar.</p>`;
        content.innerHTML = `${preview}<a class="assistant-media-open" href="${escapeHtml(objectUrl)}" target="_blank" rel="noopener">Abrir documento completo</a><a class="assistant-media-download" href="${escapeHtml(objectUrl)}" download="${escapeHtml(fileName)}">Baixar arquivo</a>`;
      } catch (error) {
        content.textContent = error?.message || "Não foi possível carregar a prévia.";
      }
    }
    transcript.scrollTop = transcript.scrollHeight;
  };

  const renderRemoteMessages = async messages => {
    for (const message of messages || []) {
      if (message.type === "poll") appendRemotePoll(message);
      else if (message.type === "text") appendMessage("energetico", message.text || "");
      else if (message.type === "document" || message.type === "image") await appendRemoteMedia(message);
    }
  };

  const renderPendingFiles = () => {
    if (!attachmentList) return;
    attachmentList.hidden = pendingFiles.length === 0;
    attachmentList.innerHTML = pendingFiles.map((file, index) => (
      `<span><span>📎 ${escapeHtml(file.name || "arquivo")}</span><button type="button" data-assistant-remove-file="${index}" aria-label="Remover ${escapeHtml(file.name || "arquivo")}">×</button></span>`
    )).join("");
  };

  const addSelectedFiles = event => {
    const selected = Array.from(event?.target?.files || []);
    if (!selected.length) return;
    pendingFiles = [...pendingFiles, ...selected];
    renderPendingFiles();
    if (event.target) event.target.value = "";
  };

  const processRemoteResult = async result => {
    const resetConversation = shouldResetAssistantConversation(result);
    if (resetConversation) clearAssistantConversation(transcript, mediaObjectUrls);
    await renderRemoteMessages(result?.messages);
    appendLaunches(result?.activeFlow?.launches);
    await appendAttachmentPreviews(result?.attachments);
    if (resetConversation && !result?.messages?.some?.(message => message.type === "poll")) {
      const menuResult = await context.chatClient.send({
        text: "MENU PRINCIPAL",
        replyId: "navigation_main_menu",
      });
      await renderRemoteMessages(menuResult?.messages);
    }
  };

  const executeRemote = async ({ text = "", replyId } = {}) => {
    if (!context.chatClient || busy) return false;
    busy = true;
    form?.classList?.add?.("is-busy");
    try {
      const result = await context.chatClient.send({ text, replyId });
      await processRemoteResult(result);
      return true;
    } catch (error) {
      appendMessage("energetico", `Não consegui falar com a VM agora: ${error?.message || "falha de comunicação"}`);
      return false;
    } finally {
      busy = false;
      form?.classList?.remove?.("is-busy");
    }
  };

  const executeLaunchLineEdit = async lineNumber => {
    if (!context.chatClient || busy) return false;
    const line = Math.max(1, Number(lineNumber) || 1);
    busy = true;
    form?.classList?.add?.("is-busy");
    appendMessage("user", `✏️ EDITAR LINHA ${line}`);
    try {
      // A VM já possui o fluxo de edição: primeiro abrimos a escolha de linha
      // e, em seguida, selecionamos a linha pedida pelo usuário. As duas
      // requisições são sequenciais para preservar o estado salvo do fluxo.
      const editMenu = await context.chatClient.send({ text: "EDITAR", replyId: "confirm_edit" });
      const poll = (editMenu?.messages || []).find(message => message?.type === "poll");
      const option = (poll?.options || []).find(item => {
        const reply = String(item?.reply ?? item?.id ?? "");
        const label = String(item?.label || item?.title || "");
        return reply === String(line) || reply.endsWith(`:${line}`) || new RegExp(`LINHA\\s+${line}\\b`, "i").test(label);
      });
      const replyId = option?.reply || option?.id || String(line);
      const result = await context.chatClient.send({ text: `LINHA ${line}`, replyId });
      await processRemoteResult(result);
      return true;
    } catch (error) {
      appendMessage("energetico", `Não consegui abrir a edição da linha ${line}: ${error?.message || "falha de comunicação"}`);
      return false;
    } finally {
      busy = false;
      form?.classList?.remove?.("is-busy");
    }
  };

  const executePendingFiles = async () => {
    if (!context.chatClient?.sendFile || busy || !pendingFiles.length) return false;
    busy = true;
    form?.classList?.add?.("is-busy");
    let completed = true;
    try {
      const outcome = await processAssistantAttachments(
        pendingFiles,
        file => context.chatClient.sendFile(file),
        async (file, result, remaining) => {
          appendMessage("user", `📎 ${file.name || "arquivo"}`);
          pendingFiles = remaining;
          renderPendingFiles();
          await processRemoteResult(result);
        },
      );
      pendingFiles = outcome.remaining;
      completed = outcome.completed;
      if (!outcome.completed) {
        appendMessage("energetico", `O arquivo não foi enviado: ${outcome.error?.message || "falha de comunicação"}. Ele continua selecionado para você tentar novamente.`);
      }
      return completed;
    } catch (error) {
      appendMessage("energetico", `O arquivo foi processado, mas não consegui carregar a resposta: ${error?.message || "falha de comunicação"}.`);
      return false;
    } finally {
      busy = false;
      form?.classList?.remove?.("is-busy");
    }
  };

  const validationMessage = summary => {
    const date = String(summary.date || "").split("-").reverse().join("/");
    const result = summary.inconsistencies
      ? `${summary.inconsistencies} registro(s) precisam de conferência.`
      : "Nenhuma inconsistência estrutural foi encontrada.";
    return `${date}: ${summary.presenceCount} presença(s), ${summary.descriptionCount} descritivo(s) e ${summary.uniquePeople} pessoa(s). ${result}`;
  };

  const execute = async commandText => {
    const command = resolveAssistantCommand(commandText, context);
    pending = command.pending;
    if (command.type === "help") {
      appendMessage("energetico", command.message);
      appendChoices();
      return;
    }
    if (command.type === "presence-validation") {
      if (busy) return;
      busy = true;
      appendMessage("energetico", command.message);
      try {
        const summary = await loadPresenceValidation(context.repository, context.entities, {});
        appendMessage("energetico", validationMessage(summary));
      } catch (error) {
        appendMessage("energetico", `Não consegui concluir a conferência: ${error?.message || "falha ao consultar o SharePoint"}`);
      } finally {
        busy = false;
      }
      return;
    }
    appendMessage("energetico", command.message);
    if (command.type === "navigate") {
      pending = undefined;
      context.navigate?.(command.route.name, command.route.params);
    }
  };

  const submitCommand = commandText => {
    const value = String(commandText || "").trim();
    if (!value || busy) return;
    appendMessage("user", value);
    if (context.chatClient) {
      void executeRemote({ text: value });
      return;
    }
    const pendingEntity = pending?.entityId && (context.entities || []).find(entity => entity.id === pending.entityId);
    const effectiveCommand = pending?.action === "edit" && pendingEntity && /^\d+$/.test(value)
      ? `editar ${pendingEntity.title} ${value}` : value;
    if (effectiveCommand === value) pending = undefined;
    void execute(effectiveCommand);
  };

  const click = event => {
    const removeFileButton = event.target?.closest?.("[data-assistant-remove-file]");
    if (removeFileButton) {
      if (busy) return;
      const index = Number(removeFileButton.dataset.assistantRemoveFile);
      if (Number.isInteger(index) && index >= 0 && index < pendingFiles.length) {
        pendingFiles = pendingFiles.filter((_file, itemIndex) => itemIndex !== index);
        renderPendingFiles();
      }
      return;
    }
    if (event.target?.closest?.("[data-assistant-camera]")) {
      if (busy) return;
      cameraInput?.click?.();
      return;
    }
    if (event.target?.closest?.("[data-assistant-file]")) {
      if (busy) return;
      fileInput?.click?.();
      return;
    }
    const editLaunchLineButton = event.target?.closest?.("[data-assistant-edit-launch-line]");
    if (editLaunchLineButton) {
      void executeLaunchLineEdit(editLaunchLineButton.dataset.assistantEditLaunchLine);
      return;
    }
    const replyButton = event.target?.closest?.("[data-assistant-reply]");
    if (replyButton) {
      const label = replyButton.dataset.assistantLabel || replyButton.textContent || "Opção selecionada";
      const replyId = replyButton.dataset.assistantReply;
      removeConsumedAssistantChoice(replyButton);
      appendMessage("user", label);
      void executeRemote({ text: label, replyId });
      return;
    }
    const commandButton = event.target?.closest?.("[data-assistant-command]");
    if (commandButton) {
      removeConsumedAssistantChoice(commandButton);
      submitCommand(commandButton.dataset.assistantCommand);
      return;
    }
    if (event.target?.closest?.("[data-assistant-open]")) {
      setOpen(true);
      if (context.chatClient && !remoteStarted) {
        remoteStarted = true;
        transcript?.querySelectorAll?.("[data-assistant-choice-card]").forEach(card => card.remove());
        void executeRemote({ text: "CONTINUAR", replyId: "input_continue" });
      }
    }
    if (event.target?.closest?.("[data-assistant-close]")) setOpen(false);
    if (event.target?.closest?.("[data-assistant-menu]")) {
      if (busy) return;
      setOpen(true);
      if (context.chatClient) {
        transcript?.querySelectorAll?.("[data-assistant-choice-card]").forEach(card => card.remove());
        void executeRemote({ text: "MENU PRINCIPAL", replyId: "navigation_main_menu" });
      } else appendChoices();
    }
  };
  const submit = event => {
    event.preventDefault?.();
    if (pendingFiles.length) {
      void executePendingFiles();
      return;
    }
    const value = input?.value || "";
    if (input) input.value = "";
    submitCommand(value);
  };
  const keydown = event => {
    if (event.key === "Escape" && !panel?.hidden) setOpen(false);
  };

  function setUserPhoto(url) {
    context.userPhotoUrl = url || "";
    root.querySelectorAll?.("[data-assistant-user-photo]").forEach(photo => {
      photo.src = url || "";
      photo.hidden = !url;
      const fallback = photo.parentElement?.querySelector?.("[data-assistant-user-initials]");
      if (fallback) fallback.hidden = Boolean(url);
    });
  }

  root.addEventListener?.("click", click);
  form?.addEventListener?.("submit", submit);
  cameraInput?.addEventListener?.("change", addSelectedFiles);
  fileInput?.addEventListener?.("change", addSelectedFiles);
  globalThis.window?.addEventListener?.("keydown", keydown);
  return Object.freeze({
    open: () => setOpen(true),
    close: () => setOpen(false),
    setUserPhoto,
    submit: submitCommand,
    cleanup: () => {
      root.removeEventListener?.("click", click);
      form?.removeEventListener?.("submit", submit);
      cameraInput?.removeEventListener?.("change", addSelectedFiles);
      fileInput?.removeEventListener?.("change", addSelectedFiles);
      globalThis.window?.removeEventListener?.("keydown", keydown);
      mediaObjectUrls.forEach(url => globalThis.URL?.revokeObjectURL?.(url));
      mediaObjectUrls.clear();
      pendingFiles = [];
      root.innerHTML = "";
    },
  });
}
