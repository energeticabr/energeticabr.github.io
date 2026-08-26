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
    ${showDiagnostics && diagnostic ? `<p class="source-diagnostic">Fonte: ${escapeHtml(diagnostic)}</p>` : ""}
    ${unavailable ? "" : `<div class="attachment-list">${files.map(file => `<article class="attachment-row"><div><strong>${escapeHtml(file.name)}</strong><p>${escapeHtml(file.type || "Tipo não informado")} · ${escapeHtml(formatBytes(file.size))} · ${escapeHtml(file.author || "Autor não informado")} · ${escapeHtml(formatDateTime(file.uploadedAt))}</p></div>${canEdit ? `<button type="button" class="button-danger" data-attachment-delete="${escapeHtml(file.name)}">Excluir</button>` : ""}</article>`).join("") || '<p class="entity-empty">Nenhum anexo neste registro.</p>'}</div>
    ${canEdit ? `<form class="attachment-upload" data-attachment-upload><label>Adicionar arquivo<input type="file" data-attachment-file accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" required></label><button type="submit" class="button-primary">Enviar anexo</button></form>` : ""}`}
  </section>`;
}

export function renderAttachmentsPanel(root, { availability, files, actions, onChanged, diagnostic, showDiagnostics } = {}) {
  if (!root) throw new TypeError("O painel de anexos requer um elemento raiz.");
  let disposed = false;
  const canEdit = availability === "available" && actions?.canEdit?.() === true;
  root.innerHTML = attachmentPanelMarkup({ availability, files, diagnostic, showDiagnostics, canEdit, ...actions?.getState?.() });
  const status = root.querySelector("[data-attachment-status]");
  const setStatus = ({ message = "", error = "" } = {}) => {
    if (disposed || !status) return;
    status.classList?.toggle?.("is-error", Boolean(error));
    status.textContent = error || message;
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
  const form = root.querySelector("[data-attachment-upload]");
  form?.addEventListener("submit", submit);
  const deleteButtons = [...root.querySelectorAll("[data-attachment-delete]")];
  deleteButtons.forEach(button => button.addEventListener("click", remove));
  return Object.freeze({
    cleanup() {
      disposed = true;
      form?.removeEventListener("submit", submit);
      deleteButtons.forEach(button => button.removeEventListener("click", remove));
    },
  });
}
