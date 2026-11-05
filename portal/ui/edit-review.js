import { escapeHtml, normalizeCadastroValue } from '../core/utils.js';

const reviews = new WeakMap();
let reviewId = 0;

// Injected per document: portal, app and standalone consumers need no CSS import.
export function ensureEditReviewStyles(document) {
  if (!document || document.querySelector('[data-edit-review-styles]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-edit-review-styles', '');
  style.textContent = `
    [data-edit-changed], [data-edit-changed] input, [data-edit-changed] textarea,
    [data-edit-changed] select, [data-edit-changed] .searchable-select-input {
      background: #ffcc80 !important; border-color: #c66a00 !important; color: #332000 !important;
    }
    [data-edit-changed] { border: 1px solid #c66a00; border-radius: .5rem; }
    .edit-review { box-sizing: border-box; width: min(54rem, calc(100vw - 1.5rem));
      max-width: calc(100vw - 1.5rem); max-height: calc(100dvh - 2rem); overflow: auto;
      margin: auto; padding: 1rem; border: 1px solid #c66a00; border-radius: .75rem;
      background: #fff; color: #251b10; box-shadow: 0 1rem 4rem #0005; }
    .edit-review::backdrop { background: #0008; }
    .edit-review h2 { margin: 0 0 1rem; font-size: 1.25rem; }
    .edit-review table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .edit-review th, .edit-review td { padding: .6rem; text-align: left; vertical-align: top;
      border-bottom: 1px solid #ddd; overflow-wrap: anywhere; white-space: pre-wrap; }
    .edit-review th { background: #fff1dc; }
    .edit-review-actions { display: flex; flex-wrap: wrap; gap: .75rem; justify-content: flex-end; margin-top: 1rem; }
    .edit-review-actions button { min-height: 44px; padding: .6rem 1rem; cursor: pointer;
      border: 1px solid #795020; border-radius: .4rem; background: #fff; color: #332000; font: inherit; }
    .edit-review-actions [data-edit-review-confirm] { background: #167044; border-color: #167044; color: #fff; font-weight: 700; }
    .edit-review-actions [data-edit-review-cancel] { background: #b51f24; border-color: #b51f24; color: #fff; }
    .edit-review :focus-visible { outline: 3px solid #784000; outline-offset: 2px; }
    @media(max-width: 400px) { .edit-review { padding: .6rem; } .edit-review th, .edit-review td { padding: .4rem; } }
    /* Modal dialogs enter the browser top layer, outside the report's rotated
       containing block. Apply the same orientation to the dialog itself. */
    @media (orientation: portrait) {
      .edit-review--landscape { position: fixed; inset: auto; top: 50%; left: 50%; margin: 0;
        width: min(54rem, calc(100dvh - 2rem)); max-width: calc(100dvh - 2rem);
        max-height: calc(100vw - 2rem); transform: translate(-50%, -50%) rotate(90deg); }
    }
  `;
  (document.head || document.documentElement).append(style);
}

const relation = column => ['lookup', 'person'].includes(column.control);
const editable = column => column.editable !== false && !column.hidden && !column.readOnly && !column.disabled;
const fieldName = column => relation(column) ? `${column.name}LookupId` : column.name;
const text = value => {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.map(text).join(', ') || '—';
  if (typeof value === 'object') return text(value.results ?? value.LookupValue ?? value.DisplayName ?? value.Title ?? value.label ?? value.LookupId);
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  return String(value);
};

function canonical(value, column) {
  if (value == null || value === '') return column.control === 'checkbox' ? 'false' : '';
  if (Array.isArray(value) || Array.isArray(value?.results)) {
    return JSON.stringify((value.results ?? value).map(item => canonical(item, { ...column, allowMultipleValues: false, powerApps: undefined })).sort());
  }
  const serialization = column.powerApps?.multipleSerialization;
  if (column.allowMultipleValues && serialization?.kind === 'concat' && serialization.delimiter?.trim()) {
    return canonical(String(value).split(serialization.delimiter).map(item => item.trim()).filter(Boolean), { ...column, powerApps: undefined });
  }
  if (column.control === 'date') return String(value).slice(0, 10);
  if (column.control === 'datetime-local') return String(value).slice(0, 16);
  if ((['number', 'currency'].includes(column.control) || relation(column)) && Number.isFinite(Number(value))) return String(Number(value));
  if (column.control === 'checkbox') return /^(true|1)$/i.test(String(value)) ? 'true' : 'false';
  if (['text', 'textarea'].includes(column.control)) {
    return column.isMessage ? String(value).trim() : normalizeCadastroValue(String(value).trim());
  }
  return String(value);
}

function display(value, column) {
  if (value == null || value === '') return '—';
  if (['date', 'datetime-local'].includes(column.control)) {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}${column.control === 'datetime-local' && match[4] ? ` ${match[4]}` : ''}`;
  }
  if (column.control === 'checkbox') return canonical(value, column) === 'true' ? 'Sim' : 'Não';
  if (column.control === 'currency' && Number.isFinite(Number(value))) return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (column.control === 'number' && Number.isFinite(Number(value))) return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 10 });
  if (column.control === 'select' && column.optionLabels) {
    if (Array.isArray(value)) return value.map(item => column.optionLabels[item] ?? text(item)).join(', ') || '—';
    return column.optionLabels[value] ?? text(value);
  }
  return text(value);
}

/** Compare the loaded record with normalized outgoing fields, preserving original display text. */
export function buildEditChanges(columns, baseline = {}, fields = {}, labels = {}, attachments = {}) {
  const changes = [];
  for (const column of columns) {
    if (!editable(column)) continue;
    const name = relation(column) && Object.hasOwn(fields, fieldName(column)) ? fieldName(column) : column.name;
    if (!Object.hasOwn(fields, name)) continue;
    const before = baseline[name] ?? (relation(column) ? baseline[column.name] : undefined);
    const after = fields[name];
    if (canonical(before, column) === canonical(after, column)) continue;
    const relationshipDisplay = (value, label) => label && text(label) !== '—' ? `${text(label)} (ID: ${text(value)})` : text(value);
    changes.push({ name: column.name, label: column.label || column.name,
      before: relation(column) ? relationshipDisplay(before, baseline[`${column.name}LookupValue`] ?? baseline[`${column.name}DisplayName`] ?? baseline[column.name]) : display(before, column),
      after: relation(column) ? relationshipDisplay(after, labels[column.name]) : display(after, column) });
  }
  for (const file of attachments?.uploads || []) changes.push({ label: 'Anexo adicionado', before: '—', after: text(file.name) });
  for (const name of attachments?.deletions || []) changes.push({ label: 'Anexo removido', before: text(name), after: 'Removido' });
  return changes;
}

/** readFields returns normalized, selected values only; omit unconfirmed search input. */
export function bindEditHighlights({ form, columns, baseline = {}, readFields, readAttachmentChanges }) {
  ensureEditReviewStyles(form?.ownerDocument);
  let disposed = false;
  let lastFields = {};
  const marked = new Set();
  const mark = (element, changed) => {
    if (!element) return;
    if (changed) { element.setAttribute('data-edit-changed', ''); marked.add(element); }
    else { element.removeAttribute('data-edit-changed'); marked.delete(element); }
  };
  const update = () => {
    if (disposed) return;
    // Invalid search text does not replace the last actual selection.
    lastFields = { ...lastFields, ...readFields() };
    const changed = new Set(buildEditChanges(columns, baseline, lastFields).map(change => change.name));
    for (const column of columns) {
      const input = form.elements?.namedItem?.(column.name);
      const surface = input?.closest?.('.dynamic-field, .dynamic-check, [data-relation-field], [data-searchable-field], [data-combobox-field]') || input;
      mark(surface, editable(column) && changed.has(column.name));
    }
    const attachments = readAttachmentChanges?.();
    mark(form.querySelector?.('[data-form-attachments]'), Boolean(attachments?.uploads?.length || attachments?.deletions?.length));
  };
  const schedule = () => queueMicrotask(update);
  for (const type of ['input', 'change', 'click', 'keydown', 'reset']) form.addEventListener(type, schedule);
  update();
  return Object.freeze({ update, cleanup() {
    disposed = true;
    for (const type of ['input', 'change', 'click', 'keydown', 'reset']) form.removeEventListener(type, schedule);
    for (const element of marked) element.removeAttribute('data-edit-changed');
    marked.clear();
  } });
}

/** Settle a pending confirmation with false before disposing its owning editor. */
export function cancelEditReview(form) { reviews.get(form)?.cancel(); }

/** A local modal only: persistence remains the caller's responsibility. */
export function confirmEditChanges({ form, changes, title = 'Confirma as alterações?', signal }) {
  if (signal?.aborted) return Promise.resolve(false);
  if (reviews.has(form)) return reviews.get(form).promise;
  const document = form?.ownerDocument;
  // Missing/detached UI must fail closed, never grant a headless confirmation.
  if (!document?.body || !form.isConnected) return Promise.resolve(false);
  ensureEditReviewStyles(document);
  const previousFocus = document.activeElement;
  const previousInert = form.inert;
  const dialog = document.createElement('dialog');
  dialog.className = 'edit-review';
  dialog.classList.toggle('edit-review--landscape', Boolean(form.closest('.report-landscape-viewport')));
  dialog.setAttribute('data-edit-review', '');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', `edit-review-title-${++reviewId}`);
  dialog.innerHTML = `<h2 id="edit-review-title-${reviewId}">${escapeHtml(title)}</h2>
    <table><thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Depois</th></tr></thead>
    <tbody>${changes.map(change => `<tr><td>${escapeHtml(change.label)}</td><td>${escapeHtml(change.before)}</td><td>${escapeHtml(change.after)}</td></tr>`).join('')}</tbody></table>
    ${changes.length ? '' : '<p>Nenhuma alteração identificada.</p>'}
    <div class="edit-review-actions"><button type="button" data-edit-review-cancel>CANCELAR</button><button type="button" data-edit-review-confirm data-edit-review-submit>SUBMETER</button></div>`;
  const confirm = dialog.querySelector('[data-edit-review-confirm]');
  const cancel = dialog.querySelector('[data-edit-review-cancel]');
  let resolve;
  let settled = false;
  const promise = new Promise(done => { resolve = done; });
  const finish = accepted => {
    if (settled) return;
    settled = true;
    observer?.disconnect();
    signal?.removeEventListener('abort', onAbort);
    document.removeEventListener('keydown', keydown, true);
    dialog.removeEventListener('cancel', onCancel);
    dialog.removeEventListener('close', onClose);
    confirm.removeEventListener('click', onConfirm);
    cancel.removeEventListener('click', onCancel);
    form.inert = previousInert;
    reviews.delete(form);
    dialog.remove();
    if (form.isConnected) previousFocus?.focus?.();
    resolve(accepted === true && form.isConnected);
  };
  const onConfirm = () => finish(true);
  const onCancel = event => { event?.preventDefault(); finish(false); };
  const onClose = () => finish(false);
  const onAbort = () => finish(false);
  const keydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
    else if (event.key === 'Tab') {
      const target = event.shiftKey ? confirm : cancel;
      if (document.activeElement === (event.shiftKey ? cancel : confirm) || !dialog.contains(document.activeElement)) {
        event.preventDefault(); target.focus();
      }
    }
  };
  const Observer = document.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(() => {
    if (!form.isConnected || !dialog.isConnected || !dialog.hasAttribute('open')) finish(false);
  }) : null;
  reviews.set(form, { promise, cancel: () => finish(false) });
  signal?.addEventListener('abort', onAbort, { once: true });
  form.inert = true;
  document.body.append(dialog);
  confirm.addEventListener('click', onConfirm);
  cancel.addEventListener('click', onCancel);
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('close', onClose);
  document.addEventListener('keydown', keydown, true);
  try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
  observer?.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  cancel.focus();
  return promise;
}
