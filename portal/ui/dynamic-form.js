import { escapeHtml } from "../core/utils.js";
import { mapSharePointColumns, normalizeFormValues } from "../data/column-mapper.js";

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
  const step = column.control === "currency" || column.control === "number" ? ' step="any"' : "";
  const hint = column.control === "lookup" || column.control === "person" ? '<small>Informe o identificador do registro no SharePoint.</small>' : "";
  return `<label class="dynamic-field"><span>${label}${column.required ? " *" : ""}</span><input type="${type}" name="${name}" value="${escapeHtml(valueForInput(value, column.control))}"${required}${readOnly}${step}>${hint}</label>`;
}

export function formMarkup({ entity, columns = [], mode = "create", values = {} } = {}) {
  const descriptors = columns.every(column => Object.hasOwn(column, "control"))
    ? columns
    : mapSharePointColumns(columns, entity);
  const visibleColumns = descriptors.filter(column => !column.hidden && column.editable);
  const action = mode === "edit" ? "Salvar alterações" : "Salvar registro";
  return `<form class="dynamic-form" data-dynamic-form novalidate>
    <div class="dynamic-form-heading"><div><p class="page-eyebrow">${mode === "edit" ? "Editar registro" : "Novo registro"}</p><h2>${escapeHtml(entity?.title || "Registro")}</h2></div><button class="button-secondary" type="button" data-form-cancel>Cancelar</button></div>
    <div class="dynamic-form-grid">${visibleColumns.map(column => controlMarkup(column, values[column.name])).join("") || '<p class="entity-empty">Não há campos editáveis nesta lista.</p>'}</div>
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

export function renderDynamicForm(root, options = {}) {
  if (!root) throw new TypeError("O formulario requer um elemento raiz.");
  root.innerHTML = formMarkup(options);
  let disposed = false;
  const form = root.querySelector("[data-dynamic-form]");
  const cancel = root.querySelector("[data-form-cancel]");
  const onCancel = () => { if (!disposed) options.onCancel?.(); };
  const onSubmit = async event => {
    event.preventDefault();
    if (disposed || !form?.reportValidity?.()) return;
    const values = normalizeFormValues(readValues(form, options.columns || []), options.columns || [], options.entity);
    await options.onSubmit?.(values);
  };
  cancel?.addEventListener("click", onCancel);
  form?.addEventListener("submit", onSubmit);
  return Object.freeze({
    cleanup() {
      disposed = true;
      cancel?.removeEventListener("click", onCancel);
      form?.removeEventListener("submit", onSubmit);
    },
  });
}
