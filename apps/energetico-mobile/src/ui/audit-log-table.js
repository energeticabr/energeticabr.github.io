import { escapeHtml } from "./escape-html.js";

const statuses = {
  CRIADO: { label: "Criado", className: "created" },
  EDITADO: { label: "Editado", className: "edited" },
  ELIMINADO: { label: "Eliminado", className: "deleted" },
};

// Keep the VM's reply ID intact: the table only changes presentation.
export function auditLogRow(option) {
  const replyId = String(option?.reply || option?.id || "");
  if (!replyId.startsWith("audit_log_row:")) return null;
  const label = String(option.label || option.title || "");
  const parts = label.split("•").map(part => part.trim());
  if (parts.length < 4) return null;
  const time = parts.pop();
  const status = statuses[parts.pop().toUpperCase()];
  const id = parts.shift();
  const database = parts.join(" • ");
  if (!status || !id || !database || !/^(?:\d{2}:\d{2}(?::\d{2})?|--:--)$/.test(time)) return null;
  return { replyId, label, id, database, time, status };
}

export function renderAuditLogTable(rows, busy) {
  if (!rows.length) return "";
  return `<table class="chat-audit-table" aria-label="Log de ações">
    <colgroup><col class="audit-col-id"><col class="audit-col-database"><col class="audit-col-time"><col class="audit-col-status"></colgroup>
    <thead><tr><th scope="col">ID</th><th scope="col">Base de dados</th><th scope="col">Horário</th><th scope="col">Status</th></tr></thead>
    <tbody>${rows.map(row => {
      const action = `data-action="select-reply" data-reply-id="${escapeHtml(row.replyId)}" data-label="${escapeHtml(row.label)}"`;
      return `<tr${busy ? ' aria-disabled="true"' : ` ${action}`}>
        <td><button type="button" ${action} aria-label="Ver item ${escapeHtml(row.id)} de ${escapeHtml(row.database)}, ${row.status.label}, ${escapeHtml(row.time)}"${busy ? " disabled" : ""}>${escapeHtml(row.id)}</button></td>
        <td>${escapeHtml(row.database)}</td><td class="audit-time">${escapeHtml(row.time)}</td>
        <td><span class="chat-audit-status chat-audit-status--${row.status.className}">${row.status.label}</span></td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;
}
