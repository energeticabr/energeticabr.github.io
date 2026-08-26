import { escapeHtml } from "../core/utils.js";
import { mapSharePointColumns, validateFormValues } from "../data/column-mapper.js";

function valueForInput(value, control) {
  if (value === null || value === undefined) return "";
  if (control === "datetime-local") return String(value).slice(0, 16);
  return String(value);
}

function controlMarkup(column, value) {
  const name = escapeHtml(column.name);
  const label = escapeHtml(column.label);
  const required = column.required ? " required" : "";
  const readOnly = column.readOnly ? " readonly" : "";
  if (column.control === "textarea") {
    return `<label class="dynamic-field"><span>${label}${column.required ? " *" : ""}</span><textarea name="${name}"${required}${readOnly}>${escapeHtml(valueForInput(value, column.control))}</textarea></label>`;
  }
  if (column.control === "select") {
    return `<label class="dynamic-field"><span>${label}${column.required ? " *" : ""}</span><select name="${name}"${required}${readOnly}><option value="">Selecione</option>${column.choices.map(choice => `<option value="${escapeHtml(choice)}"${String(choice) === String(value ?? "") ? " selected" : ""}>${escapeHtml(choice)}</option>`).join("")}</select></label>`;
  }
  if (column.control === "checkbox") {
    return `<label class="dynamic-check"><input type="checkbox" name="${name}"${value === true ? " checked" : ""}${readOnly ? " disabled" : ""}><span>${label}</span></label>`;
  }
  const type = ({ currency: "number", number: "number", date: "date", "datetime-local": "datetime-local", lookup: "number", person: "number" })[column.control] || "text";
  const relationship = column.control === "lookup" || column.control === "person";
  const step = relationship ? ' min="1" step="1" inputmode="numeric"' : column.control === "currency" || column.control === "number" ? ' step="any"' : "";
  const hint = column.control === "lookup" || column.control === "person" ? '<small>Informe o identificador do registro no SharePoint.</small>' : "";
  return `<label class="dynamic-field"><span>${label}${column.required ? " *" : ""}</span><input type="${type}" name="${name}" value="${escapeHtml(valueForInput(value, column.control))}"${required}${readOnly}${step}>${hint}</label>`;
}

function conflictMarkup(conflict, columns) {
  if (!conflict) return "";
  const serverFields = conflict.serverFields || {};
  return `<section class="dynamic-form-conflict" data-form-conflict role="alert">
    <div><strong>Conflito de edição</strong><p>${escapeHtml(conflict.message || "O registro foi alterado no SharePoint enquanto você editava. Seus valores continuam no formulário.")}</p></div>
    <dl>${columns.map(column => `<div><dt>${escapeHtml(column.label)}</dt><dd>${escapeHtml(valueForInput(serverFields[column.name] ?? serverFields[`${column.name}LookupId`], column.control) || "Não informado")}</dd></div>`).join("")}</dl>
    <button class="button-secondary" type="button" data-form-reload-conflict>Recarregar versão do SharePoint</button>
  </section>`;
}

export function formMarkup({ entity, columns = [], mode = "create", values = {}, error = "", conflict = null } = {}) {
  const descriptors = columns.every(column => Object.hasOwn(column, "control"))
    ? columns
    : mapSharePointColumns(columns, entity);
  const visibleColumns = descriptors.filter(column => !column.hidden && column.editable);
  const action = mode === "edit" ? "Salvar alterações" : "Salvar registro";
  return `<form class="dynamic-form" data-dynamic-form novalidate>
    <div class="dynamic-form-heading"><div><p class="page-eyebrow">${mode === "edit" ? "Editar registro" : "Novo registro"}</p><h2>${escapeHtml(entity?.title || "Registro")}</h2></div><button class="button-secondary" type="button" data-form-cancel>Cancelar</button></div>
    <p class="dynamic-form-errors" data-form-errors role="alert"${error ? "" : " hidden"}>${escapeHtml(error)}</p>
    ${conflictMarkup(conflict, visibleColumns)}
    <div class="dynamic-form-grid">${visibleColumns.map(column => controlMarkup(column, values[column.name] ?? values[`${column.name}LookupId`])).join("") || '<p class="entity-empty">Não há campos editáveis nesta lista.</p>'}</div>
    <div class="dynamic-form-actions"><button class="button-primary" type="submit" data-form-save>${action}</button></div>
  </form>`;
}

function readValues(form, columns) {
  const values = {};
  for (const column of columns) {
    if (!column.editable || column.hidden) continue;
    const control = form.elements.namedItem(column.name);
    if (!control) continue;
    values[column.name] = column.control === "checkbox" ? control.checked : control.value;
  }
  return values;
}

function showErrors(root, errors) {
  const message = Object.values(errors || {}).join(" ");
  const target = root.querySelector("[data-form-errors]");
  if (!target) return;
  target.textContent = message;
  target.hidden = !message;
}

export function renderDynamicForm(root, options = {}) {
  if (!root) throw new TypeError("O formulario requer um elemento raiz.");
  const descriptors = (options.columns || []).every(column => Object.hasOwn(column, "control"))
    ? options.columns || []
    : mapSharePointColumns(options.columns || [], options.entity);
  root.innerHTML = formMarkup({ ...options, columns: descriptors });
  let disposed = false;
  const form = root.querySelector("[data-dynamic-form]");
  const cancel = root.querySelector("[data-form-cancel]");
  const reloadConflict = root.querySelector("[data-form-reload-conflict]");
  const onCancel = () => { if (!disposed) options.onCancel?.(); };
  const onReloadConflict = () => { if (!disposed) options.onReloadConflict?.(); };
  const onSubmit = async event => {
    event.preventDefault();
    if (disposed || !form?.reportValidity?.()) return;
    const rawValues = readValues(form, descriptors);
    const validation = validateFormValues(rawValues, descriptors, options.entity, { mode: options.mode });
    if (Object.keys(validation.errors).length) {
      showErrors(root, validation.errors);
      return;
    }
    showErrors(root, {});
    await options.onSubmit?.(validation.fields, rawValues);
  };
  cancel?.addEventListener("click", onCancel);
  reloadConflict?.addEventListener("click", onReloadConflict);
  form?.addEventListener("submit", onSubmit);
  return Object.freeze({
    cleanup() {
      disposed = true;
      cancel?.removeEventListener("click", onCancel);
      reloadConflict?.removeEventListener("click", onReloadConflict);
      form?.removeEventListener("submit", onSubmit);
    },
  });
}
