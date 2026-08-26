import { escapeHtml, formatDateTime } from "../core/utils.js";

function actorName(identity) {
  return identity?.user?.displayName || identity?.application?.displayName || "Usuário não informado";
}

export function buildActivityHistory(item = {}, versions = [], relatedRecords = []) {
  const entries = [];
  if (item.createdDateTime) entries.push({ type: "created", label: "Criado", at: item.createdDateTime, actor: actorName(item.createdBy) });
  if (item.lastModifiedDateTime && item.lastModifiedDateTime !== item.createdDateTime) entries.push({ type: "updated", label: "Atualizado", at: item.lastModifiedDateTime, actor: actorName(item.lastModifiedBy) });
  for (const version of versions || []) {
    if (version.lastModifiedDateTime) entries.push({ type: "version", label: "Versão registrada", at: version.lastModifiedDateTime, actor: actorName(version.lastModifiedBy) });
  }
  for (const related of relatedRecords || []) {
    if (related?.at && related?.label) entries.push({ type: "related", label: related.label, at: related.at, actor: related.actor || "Usuário não informado" });
  }
  return Object.freeze(entries.sort((left, right) => Date.parse(right.at) - Date.parse(left.at)));
}

export function activityPanelMarkup({ availability = "available", history = [] } = {}) {
  const text = availability === "forbidden" ? "Você não tem acesso ao histórico desta fonte."
    : availability === "missing" ? "O histórico desta fonte não está disponível."
      : availability === "error" ? "O histórico não pôde ser consultado agora. Tente novamente."
        : "";
  return `<section class="activity-panel" aria-labelledby="activityTitle"><div class="panel-heading"><div><p class="page-eyebrow">Acompanhamento</p><h2 id="activityTitle">Histórico</h2></div></div>${text ? `<p class="entity-empty">${escapeHtml(text)}</p>` : `<ol class="activity-list">${history.map(entry => `<li><strong>${escapeHtml(entry.label)}</strong><span>${escapeHtml(entry.actor)} · ${escapeHtml(formatDateTime(entry.at))}</span></li>`).join("") || '<li class="entity-empty">Ainda não há eventos disponíveis para este registro.</li>'}</ol>`}</section>`;
}
