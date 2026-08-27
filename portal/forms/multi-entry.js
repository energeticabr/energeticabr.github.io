import { escapeHtml } from "../core/utils.js";
import { formatGalleryValue } from "../gallery/gallery-model.js";

function immutableRow(row) {
  return Object.freeze({
    id: row.id,
    fields: Object.freeze({ ...(row.fields || {}) }),
    rawValues: Object.freeze({ ...(row.rawValues || {}) }),
    relationshipLabels: Object.freeze({ ...(row.relationshipLabels || {}) }),
    attachments: Object.freeze({
      uploads: Object.freeze([...(row.attachments?.uploads || [])]),
      deletions: Object.freeze([...(row.attachments?.deletions || [])]),
    }),
    status: row.status,
    message: row.message,
    result: row.result,
  });
}

function queueValue(row, columns, labels = []) {
  const normalize = value => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR");
  const wanted = labels.map(normalize);
  const candidates = (columns || []).filter(column => wanted.some(label => normalize(column.label || column.name).includes(label)));
  const fieldEntries = Object.entries(row.fields || {});
  for (const column of candidates) {
    const matchingEntry = fieldEntries.find(([name]) => normalize(name) === normalize(column.name) || normalize(name) === normalize(column.label));
    const fields = matchingEntry ? { ...row.fields, [column.name]: matchingEntry[1] } : row.fields;
    const value = formatGalleryValue(fields, column);
    if (value && value !== "Não informado") return value;
    const relationshipValue = row.relationshipLabels?.[column.name];
    if (relationshipValue) return String(relationshipValue);
  }
  const fallback = fieldEntries.find(([name]) => wanted.some(label => normalize(name).includes(label)));
  if (fallback?.[1] !== null && fallback?.[1] !== undefined && String(fallback[1]).trim()) return String(fallback[1]);
  return "";
}

function lancamentosQueueSummary(row, columns) {
  const produto = queueValue(row, columns, ["PRODUTO"]);
  const unitario = queueValue(row, columns, ["VALOR UNITÁRIO", "VALOR UNITARIO"]);
  const quantidade = queueValue(row, columns, ["QUANTIDADE"]);
  const frete = queueValue(row, columns, ["FRETE"]);
  const parseNumber = value => Number(String(value).replace(/[^0-9,-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
  const total = parseNumber(unitario) * parseNumber(quantidade) + parseNumber(frete);
  return [
    produto && `PRODUTO: ${produto}`,
    unitario && `VALOR UNITÁRIO: ${unitario}`,
    quantidade && `QUANTIDADE: ${quantidade}`,
    frete && `FRETE: ${frete}`,
    total ? `VALOR TOTAL: R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "",
    queueValue(row, columns, ["FORNECEDOR"]),
    queueValue(row, columns, ["FILIAL"]),
    queueValue(row, columns, ["ETAPA"]),
    queueValue(row, columns, ["TIPO DE DESPESA"]),
  ].filter(Boolean).join(" · ") || row.id;
}

export function createMultiEntryQueue(options = {}) {
  let nextId = 1;
  let rows = [];
  let activeSubmission;
  const notify = () => options.onChange?.(snapshot());
  const snapshot = () => Object.freeze(rows.map(immutableRow));

  function add(fields, rawValues = {}, relationshipLabels = {}, attachments = {}) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields) || !Object.keys(fields).length) {
      throw new TypeError("O lançamento múltiplo requer ao menos um campo validado.");
    }
    const row = {
      id: `row-${nextId++}`,
      fields: { ...fields },
      rawValues: { ...rawValues },
      relationshipLabels: { ...relationshipLabels },
      attachments: { uploads: [...(attachments.uploads || [])], deletions: [...(attachments.deletions || [])] },
      status: "pending",
      message: "Aguardando envio.",
      result: undefined,
    };
    rows = [...rows, row];
    notify();
    return immutableRow(row);
  }

  function remove(id) {
    const current = rows.find(row => row.id === id);
    if (!current || current.status === "submitting") return false;
    rows = rows.filter(row => row.id !== id);
    notify();
    return true;
  }

  async function submitAll(submit) {
    if (typeof submit !== "function") throw new TypeError("O lançamento múltiplo requer uma função de gravação.");
    if (activeSubmission) return activeSubmission;
    activeSubmission = (async () => {
      for (const row of rows) {
        if (row.status === "success") continue;
        row.status = "submitting";
        row.message = "Enviando...";
        notify();
        try {
          row.result = await submit(immutableRow(row));
          row.status = "success";
          row.message = "Registro criado com sucesso.";
        } catch (error) {
          row.result = undefined;
          row.status = "error";
          row.message = error?.message || "Não foi possível criar este registro.";
        }
        notify();
      }
      return snapshot();
    })();
    try {
      return await activeSubmission;
    } finally {
      activeSubmission = undefined;
    }
  }

  function clearSuccessful() {
    rows = rows.filter(row => row.status !== "success");
    notify();
  }

  return Object.freeze({ add, remove, submitAll, snapshot, clearSuccessful });
}

export function multiEntryQueueMarkup(rows = [], columns = [], options = {}) {
  const visible = (columns || []).filter(column => !column.hidden).slice(0, 3);
  const statusLabel = Object.freeze({ pending: "Pendente", submitting: "Enviando", success: "Enviado", error: "Falhou" });
  const summary = options.mode === "lancamentos-gallery3-1"
    ? row => lancamentosQueueSummary(row, columns)
    : row => visible.map(column => formatGalleryValue(row.fields, column)).filter(Boolean).join(" · ") || row.id;
  return `<section class="multi-entry-queue" data-multi-entry-queue aria-labelledby="multiEntryTitle">
    <div class="dynamic-form-heading"><div><p class="page-eyebrow">Lançamento múltiplo</p><h3 id="multiEntryTitle">Itens preparados</h3></div><strong>${rows.length}</strong></div>
    <div data-multi-entry-rows>${rows.map(row => `<article class="multi-entry-row is-${escapeHtml(row.status)}" data-multi-entry-row="${escapeHtml(row.id)}"><div><strong>${escapeHtml(summary(row))}</strong><p>${escapeHtml(row.message || statusLabel[row.status] || "Pendente")}</p></div><span>${escapeHtml(statusLabel[row.status] || row.status)}</span>${row.status === "submitting" ? "" : `<button type="button" class="button-secondary" data-multi-entry-remove="${escapeHtml(row.id)}">Remover</button>`}</article>`).join("") || '<p class="entity-empty">Adicione ao menos um item antes de submeter.</p>'}</div>
    <button type="button" class="button-primary" data-multi-entry-submit${rows.some(row => row.status === "pending" || row.status === "error") ? "" : " disabled"}>Submeter tudo</button>
  </section>`;
}
