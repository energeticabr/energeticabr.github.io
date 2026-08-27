import { escapeHtml, formatDateTime } from "../core/utils.js";
import { displayColumnValue } from "../data/column-mapper.js";

const EVENT_LABELS = Object.freeze({
  created: "Criação",
  edited: "Edição",
  "attachment-added": "Anexo adicionado",
  "attachment-removed": "Anexo removido",
});

function actorName(identity) {
  if (typeof identity === "string" && identity.trim()) return identity.trim();
  return identity?.user?.displayName
    || identity?.application?.displayName
    || identity?.displayName
    || "Usuário não informado";
}

function timestampOf(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sameMoment(left, right) {
  return Boolean(left && right) && timestampOf(left) === timestampOf(right);
}

function visibleColumns(columns = []) {
  return columns.filter(column => column?.name && column.hidden !== true);
}

function fieldChanges(before = {}, after = {}, columns = []) {
  return Object.freeze(visibleColumns(columns).flatMap(column => {
    const previous = displayColumnValue(before, column);
    const next = displayColumnValue(after, column);
    if (previous === next) return [];
    return [Object.freeze({ field: column.name, label: column.label || column.displayName || column.name, before: previous, after: next })];
  }));
}

function relatedEvent(record = {}) {
  const normalizedType = String(record.type || record.action || "").toLowerCase().replaceAll("_", "-");
  const type = normalizedType === "attachment-removed" || normalizedType === "anexo-removido"
    ? "attachment-removed"
    : normalizedType === "attachment-added" || normalizedType === "anexo-adicionado"
      ? "attachment-added"
      : normalizedType === "edited" || normalizedType === "updated"
        ? "edited"
        : normalizedType === "created"
          ? "created"
          : "related";
  const changes = Array.isArray(record.changes)
    ? record.changes.map(change => Object.freeze({
      field: change.field || "",
      label: change.label || change.field || "Campo",
      before: String(change.before ?? "Não informado"),
      after: String(change.after ?? "Não informado"),
    }))
    : [];
  return Object.freeze({
    type,
    label: record.label || EVENT_LABELS[type] || "Atualização relacionada",
    at: record.at || record.lastModifiedDateTime || "",
    actor: actorName(record.actor || record.modifiedBy || record.createdBy),
    fileName: record.fileName || record.name || "",
    changes: Object.freeze(changes),
  });
}

export function buildItemTimeline({ item = {}, versions = [], attachments = [], relatedRecords = [], columns = [] } = {}) {
  const events = [];
  if (item.createdDateTime) {
    events.push(Object.freeze({
      type: "created",
      label: EVENT_LABELS.created,
      at: item.createdDateTime,
      actor: actorName(item.createdBy),
      changes: Object.freeze([]),
    }));
  }

  const snapshots = (versions || [])
    .filter(version => version?.lastModifiedDateTime && version?.fields)
    .slice()
    .sort((left, right) => timestampOf(left.lastModifiedDateTime) - timestampOf(right.lastModifiedDateTime));

  for (let index = 1; index < snapshots.length; index += 1) {
    const current = snapshots[index];
    events.push(Object.freeze({
      type: "edited",
      label: EVENT_LABELS.edited,
      at: current.lastModifiedDateTime,
      actor: actorName(current.lastModifiedBy),
      changes: fieldChanges(snapshots[index - 1].fields, current.fields, columns),
    }));
  }

  const latestSnapshot = snapshots.at(-1);
  const currentChanges = latestSnapshot ? fieldChanges(latestSnapshot.fields, item.fields || {}, columns) : Object.freeze([]);
  const itemRepresentsNewerEdit = item.lastModifiedDateTime
    && !sameMoment(item.lastModifiedDateTime, item.createdDateTime)
    && (!latestSnapshot || snapshots.length === 1 || !sameMoment(latestSnapshot.lastModifiedDateTime, item.lastModifiedDateTime) || currentChanges.length > 0);
  if (itemRepresentsNewerEdit) {
    events.push(Object.freeze({
      type: "edited",
      label: EVENT_LABELS.edited,
      at: item.lastModifiedDateTime,
      actor: actorName(item.lastModifiedBy),
      changes: currentChanges,
    }));
  }

  for (const file of attachments || []) {
    if (!file?.name || !file?.uploadedAt) continue;
    events.push(Object.freeze({
      type: "attachment-added",
      label: EVENT_LABELS["attachment-added"],
      at: file.uploadedAt,
      actor: actorName(file.author),
      fileName: file.name,
      changes: Object.freeze([]),
    }));
  }

  for (const record of relatedRecords || []) {
    const event = relatedEvent(record);
    if (event.at) events.push(event);
  }

  return Object.freeze(events.sort((left, right) => timestampOf(right.at) - timestampOf(left.at)));
}

function flowingText(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function changesMarkup(changes = []) {
  if (!changes.length) return '<p class="history-no-diff">Campos alterados não disponíveis para esta edição.</p>';
  return `<dl class="history-changes">${changes.map(change => `<div class="history-change"><dt>${escapeHtml(change.label)}</dt><dd><span>Antes</span><p>${flowingText(change.before)}</p></dd><dd><span>Depois</span><p>${flowingText(change.after)}</p></dd></div>`).join("")}</dl>`;
}

export function itemTimelineMarkup({ availability = "available", events = [] } = {}) {
  const unavailable = availability === "forbidden" ? "Você não tem acesso ao histórico desta fonte."
    : availability === "missing" ? "O histórico desta fonte não está disponível."
      : availability === "error" ? "O histórico não pôde ser consultado agora. Tente novamente."
        : "";
  const content = unavailable
    ? `<p class="entity-empty">${escapeHtml(unavailable)}</p>`
    : `<ol class="activity-list item-history-list">${events.map(event => `<li class="history-event history-event-${escapeHtml(event.type)}" data-history-type="${escapeHtml(event.type)}"><div class="history-event-heading"><strong>${escapeHtml(event.label || EVENT_LABELS[event.type] || "Atualização")}</strong><span>${escapeHtml(event.actor || "Usuário não informado")} · ${escapeHtml(formatDateTime(event.at))}</span></div>${event.fileName ? `<p class="history-file">${escapeHtml(event.fileName)}</p>` : ""}${event.type === "edited" ? changesMarkup(event.changes) : ""}</li>`).join("") || '<li class="entity-empty">Ainda não há eventos disponíveis para este registro.</li>'}</ol>`;
  return `<section class="activity-panel item-history" aria-labelledby="activityTitle"><div class="panel-heading"><div><p class="page-eyebrow">Acompanhamento</p><h2 id="activityTitle">Histórico</h2></div></div>${content}</section>`;
}
