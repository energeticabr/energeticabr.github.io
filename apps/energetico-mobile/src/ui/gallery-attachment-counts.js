const COUNT_FIELD_NAMES = new Set([
  "ATTACHMENTCOUNT",
  "ATTACHMENTSCOUNT",
  "ANEXOSCOUNT",
  "QUANTIDADEDEANEXOS",
  "QUANTIDADEANEXOS",
  "QTDANEXOS",
  "TOTALANEXOS",
]);

function normalizedKey(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function numericCount(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)(?:\s*(?:anexos?|attachments?))?$/i);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) ? count : null;
}

function collectionCount(value) {
  if (Array.isArray(value)) return value.filter(Boolean).length;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.length;
      if (parsed && typeof parsed === "object") return collectionCount(parsed);
    } catch { /* Non-JSON attachment text is not a count. */ }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value.value)) return value.value.filter(Boolean).length;
  if (Array.isArray(value.results)) return value.results.filter(Boolean).length;
  return null;
}

function formattedCount(count) {
  return `${count} ${count === 1 ? "anexo" : "anexos"}`;
}

export function knownGalleryAttachmentCount(row) {
  for (const value of [row?.attachmentCount, row?.attachmentsCount, row?.attachment_count, row?.attachments, row?.anexos]) {
    const collection = collectionCount(value);
    if (collection != null) return collection;
    const numeric = numericCount(value);
    if (numeric != null) return numeric;
  }

  const fields = row?.fields;
  if (fields && typeof fields === "object") {
    for (const [name, value] of Object.entries(fields)) {
      const fieldName = normalizedKey(name);
      if (COUNT_FIELD_NAMES.has(fieldName)) {
        const collection = collectionCount(value);
        if (collection != null) return collection;
        const numeric = numericCount(value);
        if (numeric != null) return numeric;
      }
      if (fieldName === "ANEXOS" || fieldName === "ATTACHMENTS") {
        const collection = collectionCount(value);
        if (collection != null) return collection;
      }
    }
  }

  if (row?.hasAttachments === false) return 0;
  return null;
}

export function createGalleryAttachmentCounts({ loadAttachments, onChange, concurrency = 4 } = {}) {
  const states = new Map();
  let queue = [];
  let active = 0;
  let epoch = 0;
  let destroyed = false;

  function rowKey(row) {
    return String(row?.id ?? row?.ID ?? "");
  }

  function label(row) {
    const key = rowKey(row);
    const state = states.get(key);
    if (state?.status === "ready") return formattedCount(state.items.length);
    if (state?.status === "error") return "Quantidade indisponível";
    const known = knownGalleryAttachmentCount(row);
    if (known != null) return formattedCount(known);
    return typeof loadAttachments === "function" ? "Contando anexos…" : "Quantidade indisponível";
  }

  function pump() {
    while (!destroyed && active < Math.max(1, concurrency) && queue.length) {
      const task = queue.shift();
      active += 1;
      Promise.resolve().then(() => loadAttachments(task.row)).then(items => {
        const normalized = Array.isArray(items) ? items : [];
        const isCurrent = !destroyed && task.epoch === epoch && states.get(task.key) === task.state;
        if (isCurrent) {
          task.state.status = "ready";
          task.state.items = normalized;
          onChange?.(task.row);
        }
        task.resolve(isCurrent ? normalized : null);
      }).catch(error => {
        if (!destroyed && task.epoch === epoch && states.get(task.key) === task.state) {
          task.state.status = "error";
          task.state.error = error;
          onChange?.(task.row);
        }
        task.reject(error);
      }).finally(() => {
        active -= 1;
        pump();
      });
    }
  }

  function load(row, { force = false } = {}) {
    if (destroyed || typeof loadAttachments !== "function") return Promise.resolve(null);
    const key = rowKey(row);
    const current = states.get(key);
    if (current?.status === "ready") return Promise.resolve(current.items);
    if (current?.status === "loading") return current.promise;
    if (current?.status === "error" && !force) return Promise.resolve(null);
    if (knownGalleryAttachmentCount(row) != null && !force) return Promise.resolve(null);

    let resolve;
    let reject;
    const state = { status: "loading", items: null, promise: new Promise((done, fail) => { resolve = done; reject = fail; }) };
    states.set(key, state);
    queue.push({ row, key, state, epoch, resolve, reject });
    pump();
    return state.promise;
  }

  function request(rows) {
    if (!Array.isArray(rows)) return Promise.resolve([]);
    return Promise.all(rows.map(row => load(row).catch(() => null)));
  }

  function attachmentsFor(row) {
    const state = states.get(rowKey(row));
    return state?.status === "ready" ? state.items : null;
  }

  function reset() {
    epoch += 1;
    for (const task of queue) task.resolve(null);
    queue = [];
    states.clear();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    reset();
  }

  return Object.freeze({ label, load, request, attachmentsFor, reset, destroy });
}
