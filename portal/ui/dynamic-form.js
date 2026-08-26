import { escapeHtml } from "../core/utils.js";
import { mapSharePointColumns, validateFormValues } from "../data/column-mapper.js";

function valueForInput(value, control) {
  if (value === null || value === undefined) return "";
  if (control === "datetime-local") return String(value).slice(0, 16);
  return String(value);
}

function controlMarkup(column, value, disabled = false) {
  const name = escapeHtml(column.name);
  const label = escapeHtml(column.label);
  const required = column.required ? " required" : "";
  const readOnly = column.readOnly ? " readonly" : "";
  const disabledAttribute = disabled ? " disabled" : "";
  if (column.control === "textarea") {
    return `<label class="dynamic-field"><span>${label}${column.required ? " *" : ""}</span><textarea name="${name}"${required}${readOnly}${disabledAttribute}>${escapeHtml(valueForInput(value, column.control))}</textarea></label>`;
  }
  if (column.control === "select") {
    return `<label class="dynamic-field"><span>${label}${column.required ? " *" : ""}</span><select name="${name}"${required}${readOnly}${disabledAttribute}><option value="">Selecione</option>${column.choices.map(choice => `<option value="${escapeHtml(choice)}"${String(choice) === String(value ?? "") ? " selected" : ""}>${escapeHtml(choice)}</option>`).join("")}</select></label>`;
  }
  if (column.control === "checkbox") {
    return `<label class="dynamic-check"><input type="checkbox" name="${name}"${value === true ? " checked" : ""}${readOnly || disabled ? " disabled" : ""}><span>${label}</span></label>`;
  }
  const type = ({ currency: "number", number: "number", date: "date", "datetime-local": "datetime-local", lookup: "number", person: "number" })[column.control] || "text";
  const relationship = column.control === "lookup" || column.control === "person";
  const step = relationship ? ' min="1" step="1" inputmode="numeric"' : column.control === "currency" || column.control === "number" ? ' step="any"' : "";
  const hint = column.control === "lookup" || column.control === "person" ? '<small>Informe o identificador do registro no SharePoint.</small>' : "";
  return `<label class="dynamic-field"><span>${label}${column.required ? " *" : ""}</span><input type="${type}" name="${name}" value="${escapeHtml(valueForInput(value, column.control))}"${required}${readOnly}${step}${disabledAttribute}>${hint}</label>`;
}

function conflictMarkup(conflict, columns, disabled = false) {
  if (!conflict) return "";
  const serverFields = conflict.serverFields || {};
  return `<section class="dynamic-form-conflict" data-form-conflict role="alert">
    <div><strong>Conflito de edição</strong><p>${escapeHtml(conflict.message || "O registro foi alterado no SharePoint enquanto você editava. Seus valores continuam no formulário.")}</p></div>
    <dl>${columns.map(column => `<div><dt>${escapeHtml(column.label)}</dt><dd>${escapeHtml(valueForInput(serverFields[column.name] ?? serverFields[`${column.name}LookupId`], column.control) || "Não informado")}</dd></div>`).join("")}</dl>
    <button class="button-secondary" type="button" data-form-reload-conflict${disabled ? " disabled" : ""}>Recarregar versão do SharePoint</button>
  </section>`;
}

export function formMarkup({ entity, columns = [], mode = "create", values = {}, error = "", conflict = null, submitting = false } = {}) {
  const descriptors = columns.every(column => Object.hasOwn(column, "control"))
    ? columns
    : mapSharePointColumns(columns, entity);
  const visibleColumns = descriptors.filter(column => !column.hidden && column.editable);
  const action = mode === "edit" ? "Salvar alterações" : "Salvar registro";
  return `<form class="dynamic-form" data-dynamic-form novalidate aria-busy="${submitting ? "true" : "false"}">
    <div class="dynamic-form-heading"><div><p class="page-eyebrow">${mode === "edit" ? "Editar registro" : "Novo registro"}</p><h2>${escapeHtml(entity?.title || "Registro")}</h2></div><button class="button-secondary" type="button" data-form-cancel${submitting ? " disabled" : ""}>Cancelar</button></div>
    <p class="dynamic-form-errors" data-form-errors role="alert"${error ? "" : " hidden"}>${escapeHtml(error)}</p>
    ${conflictMarkup(conflict, visibleColumns, submitting)}
    <div class="dynamic-form-grid">${visibleColumns.map(column => controlMarkup(column, values[column.name] ?? values[`${column.name}LookupId`], submitting)).join("") || '<p class="entity-empty">Não há campos editáveis nesta lista.</p>'}</div>
    <div class="dynamic-form-actions"><button class="button-primary" type="submit" data-form-save${submitting ? " disabled" : ""}>${submitting ? "Salvando..." : action}</button></div>
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
  const save = root.querySelector("[data-form-save]");
  const cancel = root.querySelector("[data-form-cancel]");
  const reloadConflict = root.querySelector("[data-form-reload-conflict]");
  let submitting = false;
  const onCancel = () => { if (!disposed && !submitting) options.onCancel?.(); };
  const onReloadConflict = () => { if (!disposed && !submitting) options.onReloadConflict?.(); };
  const onSubmit = async event => {
    event.preventDefault();
    if (disposed || submitting || !form?.reportValidity?.()) return;
    const rawValues = readValues(form, descriptors);
    const validation = validateFormValues(rawValues, descriptors, options.entity, { mode: options.mode });
    if (Object.keys(validation.errors).length) {
      showErrors(root, validation.errors);
      return;
    }
    showErrors(root, {});
    submitting = true;
    form?.setAttribute?.("aria-busy", "true");
    const controls = Array.from(form?.elements || []);
    const disabledStates = controls.map(control => control.disabled === true);
    controls.forEach(control => { control.disabled = true; });
    if (save) { save.disabled = true; save.textContent = "Salvando..."; }
    try {
      await options.onSubmit?.(validation.fields, rawValues);
    } finally {
      submitting = false;
      if (!disposed) {
        form?.setAttribute?.("aria-busy", "false");
        controls.forEach((control, index) => { control.disabled = disabledStates[index]; });
        if (save) { save.disabled = false; save.textContent = options.mode === "edit" ? "Salvar alterações" : "Salvar registro"; }
      }
    }
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
