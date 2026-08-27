import { formatDateTime } from "../core/utils.js";
import { displayColumnValue } from "../data/column-mapper.js";

function assertAuthorized(entity, access, can) {
  const allowed = entity?.capabilities?.view === true && can?.(access, entity.moduleId, "view") === true;
  if (!allowed) throw new Error("Você não tem permissão para exportar este registro.");
}

function csvCell(value) {
  const text = String(value ?? "");
  const neutralized = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

function safeName(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function buildVisibleItemExport({ entity, item = {}, columns = [], attachments = [], access, can } = {}) {
  assertAuthorized(entity, access, can);
  const rows = [
    ["Área", entity?.title || "Registro"],
    ["Registro", item.id || ""],
    ["Criado em", formatDateTime(item.createdDateTime)],
    ["Atualizado em", formatDateTime(item.lastModifiedDateTime)],
    ...columns.filter(column => column?.name && column.hidden !== true).map(column => [
      column.label || column.displayName || column.name,
      displayColumnValue(item.fields || {}, column),
    ]),
    ...(attachments || []).filter(file => file?.name).map((file, index) => [`Anexo ${index + 1}`, file.name]),
  ];
  const content = `\uFEFF${rows.map(([label, value]) => `${label};${csvCell(value)}`).join("\r\n")}\r\n`;
  const entityName = safeName(entity?.id, "registro");
  const itemName = safeName(item.id, "item");
  return Object.freeze({ filename: `${entityName}-${itemName}.csv`, mimeType: "text/csv;charset=utf-8", content });
}

export function downloadItemExport(artifact, { urlApi = globalThis.URL, documentRef = globalThis.document } = {}) {
  if (!artifact?.filename || typeof artifact.content !== "string" || typeof urlApi?.createObjectURL !== "function" || typeof urlApi?.revokeObjectURL !== "function" || typeof documentRef?.createElement !== "function") {
    throw new TypeError("Não foi possível preparar a exportação deste registro.");
  }
  const url = urlApi.createObjectURL(new Blob([artifact.content], { type: artifact.mimeType || "text/csv;charset=utf-8" }));
  const link = documentRef.createElement("a");
  try {
    link.href = url;
    link.download = safeName(artifact.filename.replace(/\.csv$/i, ""), "registro") + ".csv";
    documentRef.body?.append?.(link);
    link.click();
  } finally {
    link.remove?.();
    urlApi.revokeObjectURL(url);
  }
}
