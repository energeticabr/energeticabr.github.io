import { escapeHtml } from "../core/utils.js";
import { mapSharePointColumns, validateFormValues } from "../data/column-mapper.js";

function valueForInput(value, control) {
  if (value === null || value === undefined) return "";
  if (control === "datetime-local") return String(value).slice(0, 16);
  return String(value);
}

const RELATIONSHIP_UNRESOLVED = "__UNRESOLVED__";
const RELATIONSHIP_MIN_LENGTH = 2;
const RELATIONSHIP_LIMIT = 20;

function relationshipDomId(name) {
  return `relation-${String(name || "field").replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function objectLabel(value) {
  if (!value || typeof value !== "object") return "";
  for (const key of ["lookupValue", "LookupValue", "displayName", "DisplayName", "name", "Name", "email", "Email"]) {
    if (String(value?.[key] || "").trim()) return String(value[key]).trim();
  }
  return "";
}

function relationshipLabel(column, values, relationshipLabels = {}) {
  const explicit = String(relationshipLabels?.[column.name] || "").trim();
  if (explicit) return explicit;
  const candidates = [
    values?.[`${column.name}LookupValue`],
    values?.[`${column.name}DisplayName`],
    values?.[`${column.name}Email`],
    values?.[column.name],
  ];
  for (const candidate of candidates) {
    const label = typeof candidate === "object" ? objectLabel(candidate) : String(candidate ?? "").trim();
    if (label && !/^\d+$/.test(label)) return label;
  }
  return "";
}

function relationshipControlMarkup(column, values = {}, disabled = false, relationshipLabels = {}) {
  const name = escapeHtml(column.name);
  const label = escapeHtml(column.label);
  const domId = relationshipDomId(column.name);
  const selectedId = values?.[`${column.name}LookupId`] ?? values?.[column.name] ?? "";
  const selectedLabel = relationshipLabel(column, values, relationshipLabels);
  const available = column.relation?.resolvable === true;
  const hiddenValue = available ? selectedId : RELATIONSHIP_UNRESOLVED;
  const disabledAttribute = disabled || !available ? " disabled" : "";
  const required = column.required ? " required" : "";
  const hint = available
    ? `Digite pelo menos ${RELATIONSHIP_MIN_LENGTH} caracteres e selecione uma opção pelo nome.`
    : "Esta relação não pôde ser resolvida com segurança pelos metadados SharePoint.";
  return `<div class="dynamic-field dynamic-relationship" data-relation-field="${name}">
    <label for="${domId}-search">${label}${column.required ? " *" : ""}</label>
    <input type="search" id="${domId}-search" value="${escapeHtml(selectedLabel)}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${domId}-options" aria-describedby="${domId}-hint ${domId}-status" data-relation-search="${name}" autocomplete="off"${required}${disabledAttribute}>
    <input type="hidden" name="${name}" value="${escapeHtml(hiddenValue)}" data-relation-value="${name}">
    <small id="${domId}-hint">${escapeHtml(hint)}</small>
    <p class="dynamic-relationship-status" id="${domId}-status" data-relation-status aria-live="polite"></p>
    <ul class="dynamic-relationship-options" id="${domId}-options" data-relation-options role="listbox" hidden></ul>
  </div>`;
}

function validatedRelationshipOptions(options, limit) {
  if (!Array.isArray(options) || options.length > limit) {
    throw new TypeError("A pesquisa relacional retornou um conjunto de opções inválido.");
  }
  const seen = new Set();
  return Object.freeze(options.map(option => {
    const id = Number(option?.id);
    const label = String(option?.label || "").trim();
    if (!Number.isInteger(id) || id < 1 || !label || seen.has(id)) {
      throw new TypeError("A pesquisa relacional retornou uma opção inválida ou duplicada.");
    }
    seen.add(id);
    return Object.freeze({ id, label, secondary: String(option?.secondary || "").trim() });
  }));
}

export function createRelationshipSearchController(options = {}) {
  if (typeof options.search !== "function") throw new TypeError("O seletor relacional requer uma função de pesquisa.");
  const debounceMs = Math.max(0, Math.min(2000, Number(options.debounceMs ?? 300) || 0));
  const minLength = Math.max(1, Math.min(10, Number(options.minLength ?? RELATIONSHIP_MIN_LENGTH) || RELATIONSHIP_MIN_LENGTH));
  const limit = Math.max(1, Math.min(RELATIONSHIP_LIMIT, Number(options.limit ?? RELATIONSHIP_LIMIT) || RELATIONSHIP_LIMIT));
  let timer;
  let activeController;
  let generation = 0;
  let disposed = false;

  const emit = state => {
    if (!disposed) options.onState?.(Object.freeze({ options: Object.freeze([]), message: "", ...state }));
  };
  const cancel = reason => {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    timer = undefined;
    activeController?.abort(reason || "Pesquisa substituída.");
    activeController = undefined;
  };

  function input(value) {
    if (disposed) return;
    const term = String(value || "").trim();
    const token = ++generation;
    cancel("Pesquisa substituída.");
    if (term.length < minLength) {
      emit({ status: term ? "too-short" : "idle", message: term ? `Digite pelo menos ${minLength} caracteres.` : "" });
      return;
    }
    emit({ status: "loading", message: "Pesquisando opções..." });
    timer = globalThis.setTimeout(async () => {
      timer = undefined;
      if (disposed || token !== generation) return;
      const controller = new AbortController();
      activeController = controller;
      try {
        const results = validatedRelationshipOptions(await options.search(term, { signal: controller.signal, limit }), limit);
        if (disposed || token !== generation || controller.signal.aborted) return;
        activeController = undefined;
        emit({ status: results.length ? "ready" : "empty", options: results, message: results.length ? `${results.length} opção(ões) encontrada(s).` : "Nenhuma opção encontrada." });
      } catch (error) {
        if (disposed || token !== generation || controller.signal.aborted || error?.name === "AbortError") return;
        activeController = undefined;
        emit({ status: "error", options: [], message: error?.message || "Não foi possível resolver esta relação." });
      }
    }, debounceMs);
  }

  return Object.freeze({
    input,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      cancel("Formulário fechado.");
    },
  });
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
  const type = ({ currency: "number", number: "number", date: "date", "datetime-local": "datetime-local" })[column.control] || "text";
  const step = column.control === "currency" || column.control === "number" ? ' step="any"' : "";
  const hint = "";
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

export function formMarkup({ entity, columns = [], mode = "create", values = {}, relationshipLabels = {}, error = "", conflict = null, submitting = false } = {}) {
  const descriptors = columns.every(column => Object.hasOwn(column, "control"))
    ? columns
    : mapSharePointColumns(columns, entity);
  const visibleColumns = descriptors.filter(column => !column.hidden && column.editable);
  const action = mode === "edit" ? "Salvar alterações" : "Salvar registro";
  return `<form class="dynamic-form" data-dynamic-form novalidate aria-busy="${submitting ? "true" : "false"}">
    <div class="dynamic-form-heading"><div><p class="page-eyebrow">${mode === "edit" ? "Editar registro" : "Novo registro"}</p><h2>${escapeHtml(entity?.title || "Registro")}</h2></div><button class="button-secondary" type="button" data-form-cancel${submitting ? " disabled" : ""}>Cancelar</button></div>
    <p class="dynamic-form-errors" data-form-errors role="alert"${error ? "" : " hidden"}>${escapeHtml(error)}</p>
    ${conflictMarkup(conflict, visibleColumns, submitting)}
    <div class="dynamic-form-grid">${visibleColumns.map(column => column.control === "lookup" || column.control === "person"
      ? relationshipControlMarkup(column, values, submitting, relationshipLabels)
      : controlMarkup(column, values[column.name], submitting)).join("") || '<p class="entity-empty">Não há campos editáveis nesta lista.</p>'}</div>
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

function readRelationshipLabels(form) {
  const labels = {};
  for (const container of form?.querySelectorAll?.("[data-relation-field]") || []) {
    const name = String(container?.dataset?.relationField || "");
    const input = container?.querySelector?.("[data-relation-search]");
    const hidden = container?.querySelector?.("[data-relation-value]");
    if (name && input && /^\d+$/.test(String(hidden?.value || ""))) labels[name] = String(input.value || "").trim();
  }
  return labels;
}

function relationshipOptionsMarkup(name, options = {}) {
  return (options.options || []).map((option, index) => {
    const optionId = `${relationshipDomId(name)}-option-${index}`;
    return `<li id="${optionId}" role="option" aria-selected="false" data-relation-option="${index}"><strong>${escapeHtml(option.label)}</strong>${option.secondary ? `<small>${escapeHtml(option.secondary)}</small>` : ""}</li>`;
  }).join("");
}

function bindRelationshipSelectors(form, columns, options = {}) {
  const cleanups = [];
  const descriptors = new Map((columns || []).map(column => [column.name, column]));
  for (const container of form?.querySelectorAll?.("[data-relation-field]") || []) {
    const name = String(container?.dataset?.relationField || "");
    const column = descriptors.get(name);
    const input = container?.querySelector?.("[data-relation-search]");
    const hidden = container?.querySelector?.("[data-relation-value]");
    const status = container?.querySelector?.("[data-relation-status]");
    const listbox = container?.querySelector?.("[data-relation-options]");
    if (!column || !input || !hidden || !status || !listbox) continue;
    if (column.relation?.resolvable !== true || typeof options.relationshipSearch !== "function") {
      hidden.value = RELATIONSHIP_UNRESOLVED;
      input.disabled = true;
      status.textContent = "Esta relação não está disponível para seleção segura.";
      continue;
    }

    let currentOptions = [];
    let activeIndex = -1;
    const setExpanded = expanded => {
      input.setAttribute?.("aria-expanded", expanded ? "true" : "false");
      listbox.hidden = !expanded;
    };
    const setActive = index => {
      const available = currentOptions.length;
      activeIndex = available ? Math.max(0, Math.min(available - 1, index)) : -1;
      if (activeIndex < 0) input.removeAttribute?.("aria-activedescendant");
      else input.setAttribute?.("aria-activedescendant", `${relationshipDomId(name)}-option-${activeIndex}`);
      listbox.querySelectorAll?.("[data-relation-option]").forEach((option, optionIndex) => option.setAttribute?.("aria-selected", optionIndex === activeIndex ? "true" : "false"));
    };
    const choose = index => {
      const option = currentOptions[Number(index)];
      if (!option) return;
      hidden.value = String(option.id);
      input.value = option.label;
      status.textContent = `${option.label} selecionado.`;
      currentOptions = [];
      listbox.innerHTML = "";
      setActive(-1);
      setExpanded(false);
    };
    const controller = createRelationshipSearchController({
      debounceMs: options.relationshipDebounceMs,
      minLength: RELATIONSHIP_MIN_LENGTH,
      limit: RELATIONSHIP_LIMIT,
      search: (term, requestOptions) => options.relationshipSearch(column, term, requestOptions),
      onState(state) {
        currentOptions = state.options || [];
        activeIndex = -1;
        status.textContent = state.message || "";
        listbox.innerHTML = relationshipOptionsMarkup(name, state);
        setExpanded(currentOptions.length > 0);
      },
    });
    const onInput = event => {
      const value = String(event?.target?.value || "");
      hidden.value = value.trim() ? RELATIONSHIP_UNRESOLVED : "";
      controller.input(value);
    };
    const onListClick = event => {
      const option = event?.target?.closest?.("[data-relation-option]");
      if (option) choose(option.dataset.relationOption);
    };
    const onKeyDown = event => {
      if (event?.key === "ArrowDown" && currentOptions.length) {
        event.preventDefault?.();
        setExpanded(true);
        setActive(activeIndex + 1);
      } else if (event?.key === "ArrowUp" && currentOptions.length) {
        event.preventDefault?.();
        setActive(activeIndex < 0 ? currentOptions.length - 1 : activeIndex - 1);
      } else if (event?.key === "Enter" && activeIndex >= 0) {
        event.preventDefault?.();
        choose(activeIndex);
      } else if (event?.key === "Escape") {
        setActive(-1);
        setExpanded(false);
      }
    };
    input.addEventListener?.("input", onInput);
    input.addEventListener?.("keydown", onKeyDown);
    listbox.addEventListener?.("click", onListClick);
    cleanups.push(() => {
      controller.dispose();
      input.removeEventListener?.("input", onInput);
      input.removeEventListener?.("keydown", onKeyDown);
      listbox.removeEventListener?.("click", onListClick);
    });
  }
  return () => cleanups.forEach(cleanup => cleanup());
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
  const cleanupRelationships = bindRelationshipSelectors(form, descriptors, options);
  let submitting = false;
  const onCancel = () => { if (!disposed && !submitting) options.onCancel?.(); };
  const onReloadConflict = () => { if (!disposed && !submitting) options.onReloadConflict?.(); };
  const onSubmit = async event => {
    event.preventDefault();
    if (disposed || submitting || !form?.reportValidity?.()) return;
    const rawValues = readValues(form, descriptors);
    const relationshipLabels = readRelationshipLabels(form);
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
      await options.onSubmit?.(validation.fields, rawValues, relationshipLabels);
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
      cleanupRelationships();
    },
  });
}
