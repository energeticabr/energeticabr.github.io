import { escapeHtml } from "../core/utils.js";
import { validateAttachment } from "../data/attachments.js?v=20260831-image-preview-v1";

function canonicalAttachmentField(value) {
  return String(value || "").replace(/[{}\s_-]/g, "").toUpperCase();
}

function normalizedFileName(value) {
  return String(value || "").trim();
}

function frozenFiles(files = []) {
  return Object.freeze([...(files || [])]);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes < 1) return "Tamanho não informado";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function powerAppsFormDeclaresAttachments(contract = {}) {
  const fields = contract?.formVariant?.formFields || contract?.formFields;
  return Array.isArray(fields) && fields.some(field => canonicalAttachmentField(field) === "ATTACHMENTS");
}

export function formAttachmentFieldMarkup({
  enabled = false,
  canView = false,
  canEdit = false,
  existingFiles = [],
  pendingFiles = [],
  removedNames = [],
  message = "",
  error = "",
  disabled = false,
} = {}) {
  if (!enabled) return "";
  const rows = formAttachmentRowsMarkup({ canView, canEdit, existingFiles, pendingFiles, removedNames, disabled });
  const status = error || message || (!canView && existingFiles.length ? "Você não tem permissão para consultar os anexos atuais." : "");
  return `<section class="dynamic-form-attachments" data-form-attachments aria-labelledby="formAttachmentsTitle">
    <div class="dynamic-form-heading"><div><p class="page-eyebrow">Arquivos</p><h3 id="formAttachmentsTitle">Anexos</h3></div></div>
    <p class="dynamic-form-errors${error ? " is-error" : ""}" data-form-attachment-status role="status" aria-live="polite"${status ? "" : " hidden"}>${escapeHtml(status)}</p>
    <div class="attachment-list" data-form-attachment-list>${rows}</div>
    <div data-form-attachment-viewer-host></div>
    ${canEdit ? `<label class="dynamic-field"><span>Adicionar arquivos</span><input type="file" data-form-attachment-input accept=".pdf,.jpg,.jpeg,.jfif,.png,.webp,.doc,.docx,.xls,.xlsx" multiple${disabled ? " disabled" : ""}></label>` : ""}
  </section>`;
}

export function formAttachmentRowsMarkup({
  canView = false,
  canEdit = false,
  existingFiles = [],
  pendingFiles = [],
  removedNames = [],
  disabled = false,
} = {}) {
  const removed = new Set((removedNames || []).map(name => normalizedFileName(name).toLocaleLowerCase("pt-BR")));
  const visibleExisting = canView
    ? existingFiles.filter(file => !removed.has(normalizedFileName(file?.name).toLocaleLowerCase("pt-BR")))
    : [];
  return [
    ...visibleExisting.map(file => `<article class="attachment-row" data-form-attachment-existing="${escapeHtml(file.name)}"><div><strong>${escapeHtml(file.name)}</strong><p>${escapeHtml(formatBytes(file.size))} · Salvo no SharePoint</p></div><div class="attachment-actions"><button type="button" class="button-secondary" data-form-attachment-open="${escapeHtml(file.name)}">Visualizar</button><button type="button" class="button-secondary" data-form-attachment-download="${escapeHtml(file.name)}">Baixar</button>${canEdit && !disabled ? `<button type="button" class="button-danger" data-form-attachment-remove-existing="${escapeHtml(file.name)}">Remover</button>` : ""}</div></article>`),
    ...pendingFiles.map(file => `<article class="attachment-row is-pending" data-form-attachment-pending="${escapeHtml(file.name)}"><div><strong>${escapeHtml(file.name)}</strong><p>${escapeHtml(formatBytes(file.size))} · Será enviado ao salvar</p></div>${canEdit && !disabled ? `<div class="attachment-actions"><button type="button" class="button-secondary" data-form-attachment-open="${escapeHtml(file.name)}">Visualizar</button><button type="button" class="button-danger" data-form-attachment-remove-upload="${escapeHtml(file.name)}">Remover</button></div>` : ""}</article>`),
  ].join("") || '<p class="entity-empty">Nenhum anexo preparado.</p>';
}

export function createFormAttachmentDraft({ existingFiles = [], readExisting } = {}) {
  const existing = [...(existingFiles || [])];
  let uploads = [];
  const deletions = new Set();
  const key = name => normalizedFileName(name).toLocaleLowerCase("pt-BR");
  const existingByName = new Map(existing.map(file => [key(file?.name), file]));

  function assertUnique(file) {
    const nameKey = key(file?.name);
    if (existingByName.has(nameKey) && !deletions.has(nameKey)) throw new Error(`O arquivo ${file.name} já existe neste registro.`);
    if (uploads.some(candidate => key(candidate?.name) === nameKey)) throw new Error(`O arquivo ${file.name} já foi selecionado.`);
  }

  function addUploads(files) {
    const selected = [...(files || [])];
    for (const file of selected) {
      const validation = validateAttachment(file);
      if (!validation.valid) throw new Error(validation.message);
      assertUnique(file);
      uploads.push(file);
    }
    return frozenFiles(uploads);
  }

  function removeUpload(name) {
    const target = key(name);
    const next = uploads.filter(file => key(file?.name) !== target);
    const removed = next.length !== uploads.length;
    uploads = next;
    return removed;
  }

  function removeExisting(name) {
    const target = key(name);
    if (!existingByName.has(target)) return false;
    deletions.add(target);
    return true;
  }

  function restoreExisting(name) {
    return deletions.delete(key(name));
  }

  function visibleFiles() {
    return frozenFiles([
      ...existing.filter(file => !deletions.has(key(file?.name))),
      ...uploads,
    ]);
  }

  async function readFile(index) {
    const files = visibleFiles();
    if (!Number.isInteger(index) || index < 0 || index >= files.length) throw new RangeError("O anexo selecionado não está disponível.");
    const file = files[index];
    if (uploads.includes(file) && typeof file?.arrayBuffer === "function") return file.arrayBuffer();
    if (typeof readExisting === "function") return readExisting(file);
    throw new Error("O anexo atual não pôde ser lido.");
  }

  return Object.freeze({
    addUploads,
    removeUpload,
    removeExisting,
    restoreExisting,
    visibleFiles,
    readFile,
    changes: () => Object.freeze({
      uploads: frozenFiles(uploads),
      deletions: Object.freeze(existing.filter(file => deletions.has(key(file?.name))).map(file => file.name)),
    }),
  });
}
