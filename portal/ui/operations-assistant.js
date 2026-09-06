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

export function remoteMessageMarkup(message = {}) {
  if (message.type === "poll") {
    return `<div class="assistant-choice-card" data-assistant-choice-card><p>${formatAssistantText(message.question || "Escolha uma opção")}</p><div class="assistant-module-menu">${(message.options || []).map(option => `<button type="button" data-assistant-reply="${escapeHtml(option.reply || option.id)}" data-assistant-label="${escapeHtml(option.label || option.title || option.id)}">${escapeHtml(option.label || option.title || option.id)}</button>`).join("")}</div></div>`;
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
        ? `<img class="assistant-media-preview" src="${escapeHtml(objectUrl)}" alt="${escapeHtml(message.caption || fileName)}">`
        : mimeType === "application/pdf"
          ? `<iframe class="assistant-media-preview is-pdf" src="${escapeHtml(objectUrl)}" title="${escapeHtml(message.caption || fileName)}"></iframe>`
          : `<p>Arquivo pronto para download.</p>`;
      if (content) content.innerHTML = `${preview}<a class="assistant-media-download" href="${escapeHtml(objectUrl)}" download="${escapeHtml(fileName)}">Baixar arquivo</a>`;
    } catch (error) {
      if (content) content.textContent = error?.message || "Não foi possível carregar o resumo.";
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
