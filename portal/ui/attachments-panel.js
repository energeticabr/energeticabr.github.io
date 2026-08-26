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

export function attachmentPanelMarkup({ availability = "available", canEdit = false, files = [], message = "", error = "", diagnostic = "", showDiagnostics = false } = {}) {
  const unavailable = availability !== "available";
  return `<section class="attachments-panel" aria-labelledby="attachmentsTitle">
    <div class="panel-heading"><div><p class="page-eyebrow">Arquivos</p><h2 id="attachmentsTitle">Anexos</h2></div><span class="source-state source-state-${escapeHtml(availability)}">${escapeHtml(availability === "available" ? "Disponível" : "Indisponível")}</span></div>
    <p class="entity-toast ${error ? "is-error" : ""}" data-attachment-status role="status" aria-live="polite">${escapeHtml(error || message || availabilityMessage(availability))}</p>
    ${showDiagnostics ? `<p class="source-diagnostic" data-attachment-diagnostic${diagnostic ? "" : " hidden"}>Fonte: ${escapeHtml(diagnostic)}</p>` : ""}
    ${unavailable ? "" : `<div class="attachment-list">${files.map(file => `<article class="attachment-row"><div><strong>${escapeHtml(file.name)}</strong><p>${escapeHtml(file.type || "Tipo não informado")} · ${escapeHtml(formatBytes(file.size))} · ${escapeHtml(file.author || "Autor não informado")} · ${escapeHtml(formatDateTime(file.uploadedAt))}</p></div><div class="attachment-actions"><button type="button" class="button-secondary" data-attachment-open="${escapeHtml(file.name)}">Abrir</button><button type="button" class="button-secondary" data-attachment-download="${escapeHtml(file.name)}">Baixar</button>${canEdit ? `<button type="button" class="button-danger" data-attachment-delete="${escapeHtml(file.name)}">Excluir</button>` : ""}</div></article>`).join("") || '<p class="entity-empty">Nenhum anexo neste registro.</p>'}</div>
    ${canEdit ? `<form class="attachment-upload" data-attachment-upload><label>Adicionar arquivo<input type="file" data-attachment-file accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" required></label><button type="submit" class="button-primary">Enviar anexo</button></form>` : ""}`}
  </section>`;
}

export function presentAttachment({ bytes, name, type, mode = "download", urlApi = globalThis.URL, documentRef = globalThis.document } = {}) {
  if (!bytes || typeof urlApi?.createObjectURL !== "function" || typeof urlApi?.revokeObjectURL !== "function" || typeof documentRef?.createElement !== "function") {
    throw new TypeError("Não foi possível preparar o anexo para abertura segura.");
  }
  const url = urlApi.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes], { type: type || "application/octet-stream" }));
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = name;
  if (mode === "open") {
    link.target = "_blank";
    link.rel = "noopener";
  }
  link.click();
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

export function createAttachmentPresenter({ urlApi = globalThis.URL, documentRef = globalThis.document, setTimeoutFn = globalThis.setTimeout, clearTimeoutFn = globalThis.clearTimeout } = {}) {
  let disposed = false;
  const presentations = new Set();
  const revokeTimers = new Set();
  return Object.freeze({
    present(options) {
      if (disposed) return undefined;
      const presentation = presentAttachment({ ...options, urlApi, documentRef });
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
      revokeTimers.clear();
      presentations.clear();
    },
  });
}

export function renderAttachmentsPanel(root, { availability, files, actions, onChanged, diagnostic, showDiagnostics } = {}) {
  if (!root) throw new TypeError("O painel de anexos requer um elemento raiz.");
  let disposed = false;
  const canEdit = availability === "available" && actions?.canEdit?.() === true;
  const actionState = actions?.getState?.() || {};
  root.innerHTML = attachmentPanelMarkup({ availability, files, canEdit, ...actionState, diagnostic: actionState.diagnostic || diagnostic, showDiagnostics });
  const status = root.querySelector("[data-attachment-status]");
  const diagnosticTarget = root.querySelector("[data-attachment-diagnostic]");
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
  const submit = async event => {
    event.preventDefault();
    const input = root.querySelector("[data-attachment-file]");
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
  const openOrDownload = mode => async event => {
    const fileName = event.currentTarget?.dataset?.[mode === "open" ? "attachmentOpen" : "attachmentDownload"];
    const file = (files || []).find(candidate => candidate.name === fileName);
    try {
      const bytes = await actions.downloadAttachment(fileName);
      presenter.present({ bytes, name: fileName, type: file?.type, mode });
      setStatus(actions.getState());
    } catch (error) {
      setStatus(actions.getState());
    }
  };
  const form = root.querySelector("[data-attachment-upload]");
  form?.addEventListener("submit", submit);
  const deleteButtons = [...root.querySelectorAll("[data-attachment-delete]")];
  const openButtons = [...root.querySelectorAll("[data-attachment-open]")];
  const downloadButtons = [...root.querySelectorAll("[data-attachment-download]")];
  const open = openOrDownload("open");
  const download = openOrDownload("download");
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
      presenter.cleanup();
    },
  });
}
