import { escapeHtml, formatDateTime } from "../core/utils.js";

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes < 1) return "Não informado";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function availabilityMessage(availability) {
  if (availability === "missing") return "Esta lista não está disponível para anexos.";
  if (availability === "forbidden") return "Você não tem acesso aos anexos desta lista.";
  if (availability === "error") return "Os anexos não puderam ser consultados agora. Tente novamente.";
  return "";
}

function inferredAttachmentType(file = {}) {
  const extension = String(file.name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === "pdf") return "application/pdf";
  if (["jpg", "jpeg", "jfif"].includes(extension)) return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "";
}

export function attachmentMimeType(file = {}) {
  const explicit = String(file.type || "").split(";", 1)[0].trim().toLowerCase();
  const inferred = inferredAttachmentType(file);
  if (!explicit || ["application/octet-stream", "binary/octet-stream", "image/jfif"].includes(explicit)) return inferred || explicit;
  return explicit;
}

export function attachmentPreviewKind(file = {}) {
  const type = attachmentMimeType(file);
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  return "unsupported";
}

export function createAttachmentBlob(bytes, file = {}) {
  const type = attachmentMimeType(file) || bytes?.type || "application/octet-stream";
  if (bytes instanceof Blob && bytes.type === type) return bytes;
  return new Blob([bytes], { type });
}

export function attachmentPanelMarkup({ availability = "available", canView = availability === "available", canEdit = false, files = [], message = "", error = "", diagnostic = "", showDiagnostics = false } = {}) {
  const unavailable = availability !== "available" || canView !== true;
  const effectiveAvailability = unavailable && availability === "available" ? "forbidden" : availability;
  return `<section class="attachments-panel" aria-labelledby="attachmentsTitle">
    <div class="panel-heading"><div><p class="page-eyebrow">Arquivos</p><h2 id="attachmentsTitle">Anexos</h2></div><span class="source-state source-state-${escapeHtml(effectiveAvailability)}">${escapeHtml(unavailable ? "Indisponível" : "Disponível")}</span></div>
    <p class="entity-toast ${error ? "is-error" : ""}" data-attachment-status role="status" aria-live="polite">${escapeHtml(error || message || availabilityMessage(effectiveAvailability))}</p>
    ${showDiagnostics ? `<p class="source-diagnostic" data-attachment-diagnostic${diagnostic ? "" : " hidden"}>Fonte: ${escapeHtml(diagnostic)}</p>` : ""}
    ${unavailable ? "" : `<div class="attachment-list">${files.map(file => `<article class="attachment-row"><div><strong>${escapeHtml(file.name)}</strong><p>${escapeHtml(attachmentMimeType(file) || "Tipo não informado")} · ${escapeHtml(formatBytes(file.size))} · ${escapeHtml(file.author || "Autor não informado")} · ${escapeHtml(formatDateTime(file.uploadedAt))}</p></div><div class="attachment-actions"><button type="button" class="button-secondary" data-attachment-open="${escapeHtml(file.name)}">Visualizar</button><button type="button" class="button-secondary" data-attachment-download="${escapeHtml(file.name)}">Baixar</button>${canEdit ? `<button type="button" class="button-danger" data-attachment-delete="${escapeHtml(file.name)}">Excluir</button>` : ""}</div></article>`).join("") || '<p class="entity-empty">Nenhum anexo neste registro.</p>'}</div><div data-attachment-viewer-host></div>
    ${canEdit ? `<form class="attachment-upload" data-attachment-upload><label>Adicionar arquivo<input type="file" data-attachment-file accept=".pdf,.jpg,.jpeg,.jfif,.png,.webp,.doc,.docx,.xls,.xlsx" required></label><button type="submit" class="button-primary">Enviar anexo</button></form>` : ""}`}
  </section>`;
}

export function attachmentViewerMarkup({ files = [], activeIndex = -1, preview, canEdit = false } = {}) {
  if (!preview || activeIndex < 0 || activeIndex >= files.length) return "";
  const kind = preview.kind || attachmentPreviewKind(preview);
  const safeUrl = typeof preview.url === "string" && preview.url.startsWith("blob:") ? preview.url : "";
  const previousDisabled = activeIndex <= 0 ? " disabled" : "";
  const nextDisabled = activeIndex >= files.length - 1 ? " disabled" : "";
  const content = kind === "image" && safeUrl
    ? `<img src="${escapeHtml(safeUrl)}" alt="Prévia de ${escapeHtml(preview.name)}">`
    : kind === "pdf" && safeUrl
      ? `<iframe src="${escapeHtml(safeUrl)}" title="Prévia de ${escapeHtml(preview.name)}"></iframe>`
      : kind === "image" || kind === "pdf"
        ? '<p class="entity-empty">A prévia segura não está disponível. Abra o arquivo novamente.</p>'
      : '<p class="entity-empty">Este tipo de arquivo não possui prévia no navegador. Use o botão Baixar.</p>';
  const upload = canEdit
    ? `<form class="attachment-viewer-upload" data-attachment-preview-upload><label>Adicionar anexo<input type="file" data-attachment-preview-file accept=".pdf,.jpg,.jpeg,.jfif,.png,.webp,.doc,.docx,.xls,.xlsx" required></label><button type="submit" class="button-primary">Enviar</button><span data-attachment-preview-upload-status role="status" aria-live="polite"></span></form>`
    : "";
  return `<dialog class="attachment-viewer" data-attachment-viewer aria-labelledby="attachmentViewerTitle"><header class="attachment-viewer-heading"><div><p class="page-eyebrow">Arquivo aberto: ${activeIndex + 1}/${files.length}</p><h3 id="attachmentViewerTitle">${escapeHtml(preview.name)}</h3></div><button type="button" class="button-secondary" data-attachment-preview-close aria-label="Fechar visualizador">Fechar</button></header><div class="attachment-preview-stage"><button type="button" class="button-secondary attachment-nav-button is-previous" data-attachment-previous${previousDisabled} aria-label="Anexo anterior" title="Anexo anterior"><span aria-hidden="true">←</span><span class="sr-only">Anterior</span></button><div class="attachment-preview-content">${content}</div><button type="button" class="button-secondary attachment-nav-button is-next" data-attachment-next${nextDisabled} aria-label="Próximo anexo" title="Próximo anexo"><span aria-hidden="true">→</span><span class="sr-only">Próximo</span></button></div><footer class="attachment-viewer-footer"><span>${activeIndex + 1} de ${files.length}</span><button type="button" class="button-primary" data-attachment-preview-download>Baixar</button>${upload}</footer></dialog>`;
}

export function bindAttachmentViewerBackdrop(dialog, onClose) {
  if (!dialog || typeof dialog.addEventListener !== "function" || typeof onClose !== "function") return () => undefined;
  const closeFromBackdrop = event => {
    if (event?.target === dialog) onClose();
  };
  dialog.addEventListener("click", closeFromBackdrop);
  return () => dialog.removeEventListener?.("click", closeFromBackdrop);
}

export function createAttachmentPreviewController({ files = [], actions, urlApi = globalThis.URL } = {}) {
  let disposed = false;
  let generation = 0;
  let state = Object.freeze({ activeIndex: -1, preview: undefined });
  const revoke = () => {
    if (state.preview?.url) urlApi?.revokeObjectURL?.(state.preview.url);
  };
  async function open(index) {
    if (disposed) return undefined;
    if (actions?.canView?.() !== true) throw new Error("Você não tem permissão para visualizar este anexo.");
    if (!Number.isInteger(index) || index < 0 || index >= files.length) throw new RangeError("O anexo selecionado não está disponível.");
    const token = ++generation;
    const file = files[index];
    const type = attachmentMimeType(file);
    const kind = attachmentPreviewKind(file);
    if (kind === "unsupported") {
      revoke();
      state = Object.freeze({ activeIndex: index, preview: Object.freeze({ name: file.name, type, kind }) });
      return state.preview;
    }
    const bytes = await actions.downloadAttachment(file.name);
    if (disposed || token !== generation) return undefined;
    if (!bytes || typeof urlApi?.createObjectURL !== "function" || typeof urlApi?.revokeObjectURL !== "function") throw new TypeError("Não foi possível preparar a prévia segura deste anexo.");
    const url = urlApi.createObjectURL(createAttachmentBlob(bytes, file));
    revoke();
    state = Object.freeze({ activeIndex: index, preview: Object.freeze({ name: file.name, type, kind, url }) });
    return state.preview;
  }
  return Object.freeze({
    open,
    previous: () => open(state.activeIndex - 1),
    next: () => open(state.activeIndex + 1),
    getState: () => state,
    close() {
      generation += 1;
      revoke();
      state = Object.freeze({ activeIndex: -1, preview: undefined });
    },
    cleanup() {
      disposed = true;
      generation += 1;
      revoke();
      state = Object.freeze({ activeIndex: -1, preview: undefined });
    },
  });
}

export function presentAttachment({ bytes, name, type, mode = "download", reservedWindow, urlApi = globalThis.URL, documentRef = globalThis.document } = {}) {
  if (!bytes || typeof urlApi?.createObjectURL !== "function" || typeof urlApi?.revokeObjectURL !== "function" || (mode === "download" && typeof documentRef?.createElement !== "function")) {
    throw new TypeError("Não foi possível preparar o anexo para abertura segura.");
  }
  const url = urlApi.createObjectURL(createAttachmentBlob(bytes, { name, type }));
  try {
    if (mode === "open") {
      if (!reservedWindow?.location) throw new TypeError("Não foi possível abrir uma nova aba para este anexo.");
      reservedWindow.location.href = url;
    } else {
      const link = documentRef.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
    }
  } catch (error) {
    urlApi.revokeObjectURL(url);
    throw error;
  }
  let revoked = false;
  return Object.freeze({
    revoke() {
      if (!revoked) {
        revoked = true;
        urlApi.revokeObjectURL(url);
      }
    },
  });
}

export function createAttachmentPresenter({ urlApi = globalThis.URL, documentRef = globalThis.document, windowRef = globalThis.window, setTimeoutFn = globalThis.setTimeout, clearTimeoutFn = globalThis.clearTimeout } = {}) {
  let disposed = false;
  const presentations = new Set();
  const revokeTimers = new Set();
  const reservations = new Set();
  const closeReservation = reservation => {
    if (!reservation) return;
    reservations.delete(reservation);
    reservation.close();
  };
  return Object.freeze({
    reserveOpenWindow() {
      if (disposed || typeof windowRef?.open !== "function") return undefined;
      const opened = windowRef.open("about:blank", "_blank");
      if (!opened) return undefined;
      let closed = false;
      const reservation = Object.freeze({
        window: opened,
        close() {
          if (!closed) {
            closed = true;
            try { opened.close?.(); } catch {}
          }
        },
      });
      reservations.add(reservation);
      return reservation;
    },
    present(options) {
      if (disposed) {
        closeReservation(options?.reservation);
        return undefined;
      }
      let presentation;
      try {
        presentation = presentAttachment({ ...options, reservedWindow: options?.reservation?.window || options?.reservedWindow, urlApi, documentRef });
      } catch (error) {
        closeReservation(options?.reservation);
        throw error;
      }
      reservations.delete(options?.reservation);
      presentations.add(presentation);
      const timer = setTimeoutFn(() => {
        presentation.revoke();
        presentations.delete(presentation);
        revokeTimers.delete(timer);
      }, 30000);
      revokeTimers.add(timer);
      return presentation;
    },
    cleanup() {
      disposed = true;
      revokeTimers.forEach(timer => clearTimeoutFn(timer));
      presentations.forEach(presentation => presentation.revoke());
      reservations.forEach(reservation => reservation.close());
      revokeTimers.clear();
      presentations.clear();
      reservations.clear();
    },
  });
}

function safeState(actions) {
  return actions?.getState?.() || {};
}

function failedAttachmentState(actions, operation) {
  const state = safeState(actions);
  return state.error ? state : { error: `Não foi possível ${operation}. Verifique sua conexão e tente novamente.` };
}

export function createAttachmentOpenHandler({ presenter, actions, file, setStatus, isActive = () => true } = {}) {
  return async () => {
    const reservation = presenter?.reserveOpenWindow?.();
    if (!reservation) {
      if (isActive()) setStatus?.({ error: "O navegador bloqueou a abertura em nova aba. Permita pop-ups para este site e tente novamente." });
      return false;
    }
    try {
      const bytes = await actions.downloadAttachment(file?.name);
      if (!isActive()) {
        reservation.close();
        return false;
      }
      const presentation = presenter.present({ bytes, name: file?.name, type: file?.type, mode: "open", reservation });
      if (!presentation) return false;
      if (isActive()) setStatus?.(safeState(actions));
      return true;
    } catch (error) {
      reservation.close();
      if (isActive()) setStatus?.(failedAttachmentState(actions, "abrir o anexo"));
      return false;
    }
  };
}

export function createAttachmentDownloadHandler({ presenter, actions, file, setStatus, isActive = () => true } = {}) {
  return async () => {
    try {
      const bytes = await actions.downloadAttachment(file?.name);
      if (!isActive()) return false;
      const presentation = presenter?.present?.({ bytes, name: file?.name, type: file?.type, mode: "download" });
      if (!presentation) return false;
      if (isActive()) setStatus?.(safeState(actions));
      return true;
    } catch (error) {
      if (isActive()) setStatus?.(failedAttachmentState(actions, "baixar o anexo"));
      return false;
    }
  };
}

export function renderAttachmentsPanel(root, { availability, files, actions, onChanged, diagnostic, showDiagnostics } = {}) {
  if (!root) throw new TypeError("O painel de anexos requer um elemento raiz.");
  let disposed = false;
  const canView = availability === "available" && actions?.canView?.() === true;
  const canEdit = canView && actions?.canEdit?.() === true;
  const visibleFiles = canView ? [...(files || [])] : [];
  const actionState = actions?.getState?.() || {};
  root.innerHTML = attachmentPanelMarkup({ availability, files: visibleFiles, canView, canEdit, ...actionState, diagnostic: actionState.diagnostic || diagnostic, showDiagnostics });
  const status = root.querySelector("[data-attachment-status]");
  const diagnosticTarget = root.querySelector("[data-attachment-diagnostic]");
  const viewerHost = root.querySelector("[data-attachment-viewer-host]");
  const setStatus = ({ message = "", error = "" } = {}) => {
    if (disposed || !status) return;
    status.classList?.toggle?.("is-error", Boolean(error));
    status.textContent = error || message;
    if (diagnosticTarget) {
      const diagnosticText = actions?.getState?.().diagnostic || "";
      diagnosticTarget.textContent = `Fonte: ${diagnosticText}`;
      diagnosticTarget.hidden = !diagnosticText;
    }
  };
  const uploadFromInput = async input => {
    const selected = input?.files?.[0];
    if (!selected) return setStatus({ error: "Selecione um arquivo para enviar." });
    try {
      await actions.uploadAttachment(selected);
      setStatus(actions.getState());
      await onChanged?.();
    } catch (error) {
      setStatus(actions.getState());
    }
  };
  const submit = event => {
    event.preventDefault();
    return uploadFromInput(root.querySelector("[data-attachment-file]"));
  };
  const remove = async event => {
    const fileName = event.currentTarget?.dataset?.attachmentDelete;
    try {
      await actions.deleteAttachment(fileName);
      setStatus(actions.getState());
      await onChanged?.();
    } catch (error) {
      setStatus(actions.getState());
    }
  };
  const presenter = createAttachmentPresenter();
  const previewController = createAttachmentPreviewController({ files: visibleFiles, actions });
  const downloadFile = file => createAttachmentDownloadHandler({ presenter, actions, file, setStatus, isActive: () => !disposed })();
  const closeViewer = () => {
    previewController.close();
    if (viewerHost) viewerHost.innerHTML = "";
  };
  const renderViewer = () => {
    if (disposed || !viewerHost) return;
    const previewState = previewController.getState();
    viewerHost.innerHTML = attachmentViewerMarkup({ files: visibleFiles, activeIndex: previewState.activeIndex, preview: previewState.preview, canEdit });
    const dialog = viewerHost.querySelector?.("[data-attachment-viewer]");
    bindAttachmentViewerBackdrop(dialog, closeViewer);
    dialog?.querySelector?.("[data-attachment-preview-close]")?.addEventListener("click", closeViewer);
    dialog?.querySelector?.("[data-attachment-previous]")?.addEventListener("click", async () => {
      try { await previewController.previous(); renderViewer(); } catch { setStatus(failedAttachmentState(actions, "visualizar o anexo")); }
    });
    dialog?.querySelector?.("[data-attachment-next]")?.addEventListener("click", async () => {
      try { await previewController.next(); renderViewer(); } catch { setStatus(failedAttachmentState(actions, "visualizar o anexo")); }
    });
    dialog?.querySelector?.("[data-attachment-preview-download]")?.addEventListener("click", () => {
      const file = visibleFiles[previewController.getState().activeIndex];
      if (file) downloadFile(file);
    });
    dialog?.querySelector?.("[data-attachment-preview-upload]")?.addEventListener("submit", event => {
      event.preventDefault();
      return uploadFromInput(event.currentTarget?.querySelector?.("[data-attachment-preview-file]"));
    });
    try { dialog?.showModal?.(); } catch { dialog?.setAttribute?.("open", ""); }
  };
  const form = root.querySelector("[data-attachment-upload]");
  form?.addEventListener("submit", submit);
  const deleteButtons = [...root.querySelectorAll("[data-attachment-delete]")];
  const openButtons = [...root.querySelectorAll("[data-attachment-open]")];
  const downloadButtons = [...root.querySelectorAll("[data-attachment-download]")];
  const open = async event => {
    const index = visibleFiles.findIndex(candidate => candidate.name === event.currentTarget?.dataset?.attachmentOpen);
    try {
      await previewController.open(index);
      if (!disposed) renderViewer();
    } catch {
      if (!disposed) setStatus(failedAttachmentState(actions, "visualizar o anexo"));
    }
  };
  const download = event => {
    const file = visibleFiles.find(candidate => candidate.name === event.currentTarget?.dataset?.attachmentDownload);
    return downloadFile(file);
  };
  deleteButtons.forEach(button => button.addEventListener("click", remove));
  openButtons.forEach(button => button.addEventListener("click", open));
  downloadButtons.forEach(button => button.addEventListener("click", download));
  return Object.freeze({
    cleanup() {
      disposed = true;
      form?.removeEventListener("submit", submit);
      deleteButtons.forEach(button => button.removeEventListener("click", remove));
      openButtons.forEach(button => button.removeEventListener("click", open));
      downloadButtons.forEach(button => button.removeEventListener("click", download));
      previewController.cleanup();
      presenter.cleanup();
    },
  });
}
