import { escapeHtml } from "../core/utils.js";

function displayValue(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function classTokens(value) {
  return String(value || "")
    .split(/\s+/)
    .map(token => token.replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean);
}

function className(...values) {
  return values.flatMap(classTokens).join(" ");
}

function areaToken(value) {
  return classTokens(value)[0] || "";
}

function safeUrl(value, { image = false } = {}) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^(?:https?:|blob:)/i.test(url) || /^(?:#|\/|\.\/|\.\.\/)/.test(url)) return url;
  if (image && /^data:image\/(?:gif|jpe?g|png|webp);base64,/i.test(url)) return url;
  return "";
}

function actionConfig(value, defaultLabel) {
  if (!value) return null;
  if (value === true) return { label: defaultLabel };
  if (typeof value === "string") return { label: value };
  if (typeof value !== "object" || value.enabled === false) return null;
  return { ...value, label: displayValue(value.label || defaultLabel) };
}

function statusConfig(status, statusClass = "") {
  if (status && typeof status === "object") {
    return {
      label: displayValue(status.label ?? status.value),
      classes: className(status.className, statusClass),
    };
  }
  return { label: displayValue(status), classes: className(statusClass) };
}

function fieldMarkup(field = {}) {
  const area = displayValue(field.area);
  const token = areaToken(area);
  const classes = className(
    "powerapps-freeform-field",
    token && `is-area-${token}`,
    field.wide === true && "is-wide",
    field.emphasis && `is-${areaToken(field.emphasis)}`,
    field.className,
  );
  const areaAttribute = area ? ` data-gallery-area="${escapeHtml(area)}"` : "";
  return `<div class="${escapeHtml(classes)}"${areaAttribute}><dt>${escapeHtml(displayValue(field.label))}</dt><dd data-label="${escapeHtml(displayValue(field.label))}">${escapeHtml(displayValue(field.value))}</dd></div>`;
}

function attachmentMarkup(attachment, rowId) {
  if (!attachment || typeof attachment !== "object" || attachment.enabled === false) return "";
  const kind = ["image", "pdf"].includes(String(attachment.kind || "").toLowerCase())
    ? String(attachment.kind).toLowerCase()
    : "file";
  const name = displayValue(attachment.name || attachment.label || "Anexo");
  const actionLabel = displayValue(attachment.actionLabel || "Visualizar anexo");
  const actionId = displayValue(attachment.actionId ?? rowId);
  const previewUrl = kind === "image" ? safeUrl(attachment.previewUrl, { image: true }) : "";
  const preview = previewUrl
    ? `<img src="${escapeHtml(previewUrl)}" alt="Previa de ${escapeHtml(name)}" loading="lazy">`
    : `<span class="powerapps-freeform-attachment-badge" aria-hidden="true">${kind === "pdf" ? "PDF" : kind === "image" ? "IMG" : "ANEXO"}</span>`;
  const hidden = attachment.hidden === true ? " hidden" : "";
  return `<div class="powerapps-freeform-attachment is-${kind}"><button type="button" class="entity-gallery-attachment"${hidden} data-gallery-attachment="${escapeHtml(actionId)}" aria-label="${escapeHtml(`${actionLabel}: ${name}`)}">${preview}<span class="powerapps-freeform-attachment-name">${escapeHtml(name)}</span><span class="powerapps-freeform-attachment-label">${escapeHtml(actionLabel)}</span></button></div>`;
}

function actionsMarkup(actions = {}, rowId) {
  const edit = actionConfig(actions.edit, "Editar");
  const remove = actionConfig(actions.delete, "Excluir");
  const detail = actionConfig(actions.detail, "Abrir detalhes");
  const approve = actionConfig(actions.approve, "Aprovar");
  if (!edit && !remove && !detail && !approve) return "";
  const id = displayValue(rowId);
  const editMarkup = edit
    ? `<button class="button-primary" type="button" data-entity-edit="${escapeHtml(id)}" aria-label="${escapeHtml(`${edit.label} registro #${id}`)}">${escapeHtml(edit.label)}</button>`
    : "";
  const deleteMarkup = remove
    ? `<button class="button-danger" type="button" data-entity-delete="${escapeHtml(id)}" aria-label="${escapeHtml(`${remove.label} registro #${id}`)}">${escapeHtml(remove.label)}</button>`
    : "";
  const href = detail ? safeUrl(detail.href) || "#" : "";
  const detailMarkup = detail
    ? `<a class="button-secondary" href="${escapeHtml(href)}" aria-label="${escapeHtml(`${detail.label} do registro #${id}`)}">${escapeHtml(detail.label)}</a>`
    : "";
  const approveMarkup = approve
    ? `<button class="button-secondary" type="button" data-entity-approve="${escapeHtml(id)}" aria-label="${escapeHtml(`${approve.label} registro #${id}`)}">${escapeHtml(approve.label)}</button>`
    : "";
  return `<div class="powerapps-freeform-actions entity-row-actions">${editMarkup}${detailMarkup}${approveMarkup}${deleteMarkup}</div>`;
}

export function powerAppsFreeformGalleryRowMarkup({
  id = "",
  title = "",
  fields = [],
  status,
  statusClass = "",
  attachment,
  actions = {},
  compact = false,
  selected = false,
  className: customClassName = "",
} = {}) {
  const rowId = displayValue(id);
  const resolvedStatus = statusConfig(status, statusClass);
  const classes = className(
    "powerapps-freeform-row",
    compact && "is-compact",
    selected && "is-selected",
    resolvedStatus.classes,
    customClassName,
  );
  const selectedAttributes = selected ? ' aria-current="true" data-entity-selected="true"' : "";
  const heading = title === undefined || title === null || String(title) === ""
    ? ""
    : `<h2 class="powerapps-freeform-title">${escapeHtml(displayValue(title))}</h2>`;
  const statusMarkup = resolvedStatus.label === ""
    ? ""
    : `<span class="${escapeHtml(className("powerapps-freeform-status", resolvedStatus.classes))}">${escapeHtml(resolvedStatus.label)}</span>`;
  const safeFields = Array.isArray(fields) ? fields : [];

  return `<article class="${escapeHtml(classes)}" data-powerapps-freeform-row="${escapeHtml(rowId)}"${selectedAttributes}><header class="powerapps-freeform-heading">${heading}${statusMarkup}</header><div class="powerapps-freeform-body">${attachmentMarkup(attachment, rowId)}<dl class="powerapps-freeform-fields">${safeFields.map(fieldMarkup).join("")}</dl></div>${actionsMarkup(actions, rowId)}</article>`;
}

export function powerAppsFreeformGalleryMarkup({
  rows = [],
  ariaLabel = "Galeria de registros",
  emptyMessage = "Nenhum registro encontrado.",
  compact = false,
  className: customClassName = "",
} = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const classes = className("powerapps-freeform-gallery", compact && "is-compact", customClassName);
  const content = safeRows.length
    ? safeRows.map(row => powerAppsFreeformGalleryRowMarkup({ ...row, compact: row?.compact ?? compact })).join("")
    : `<p class="powerapps-freeform-empty" role="status">${escapeHtml(displayValue(emptyMessage))}</p>`;
  return `<section class="${escapeHtml(classes)}" aria-label="${escapeHtml(displayValue(ariaLabel))}" data-powerapps-freeform-gallery>${content}</section>`;
}
