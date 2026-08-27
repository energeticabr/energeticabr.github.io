import { escapeHtml } from "../core/utils.js";
import { mapSharePointColumns, validateFormValues } from "../data/column-mapper.js";
import { createSearchableSelect } from "../forms/searchable-select.js";
import { applyPowerAppsDefaultValues } from "../forms/powerapps-defaults.js";
import { createFormAttachmentDraft, formAttachmentFieldMarkup, formAttachmentRowsMarkup } from "../forms/form-attachments.js";
import { attachmentViewerMarkup, createAttachmentPresenter, createAttachmentPreviewController } from "./attachments-panel.js";

function valueForInput(value, control) {
  if (value === null || value === undefined) return "";
  if (control === "datetime-local") return String(value).slice(0, 16);
  return String(value);
}

const RELATIONSHIP_UNRESOLVED = "__UNRESOLVED__";
const RELATIONSHIP_MIN_LENGTH = 2;
const RELATIONSHIP_LIMIT = 20;
const POWERAPPS_OPTION_MIN_LENGTH = 2;
const POWERAPPS_OPTION_LIMIT = 20;

function powerAppsFieldReference(value) {
  const field = String(value || "").trim();
  return field && field.length <= 128 && !/[\u0000-\u001f]/.test(field) ? field : "";
}

function powerAppsRemoteSource(column) {
  const sources = (column?.powerApps?.optionSources || []).filter(source => (
    source?.kind === "related" || source?.kind === "filtered-list" || source?.kind === "dependent"
  ));
  if (!sources.length) return null;
  const signatures = new Set();
  for (const source of sources) {
    const listName = String(source?.listName || "").trim();
    const valueField = powerAppsFieldReference(source?.valueField);
    const dependencies = source.kind === "dependent" ? source.dependsOn : [];
    if (!listName || !valueField || (source.kind === "dependent" && (!Array.isArray(dependencies) || !dependencies.length))) return null;
    if (source.kind !== "dependent" && Array.isArray(source.dependsOn) && source.dependsOn.length) return null;
    if (source.kind === "filtered-list"
      && (!Array.isArray(source.fixedFilters) || !source.fixedFilters.length)
      && (!Array.isArray(source.fixedFilterGroups) || !source.fixedFilterGroups.length)) return null;
    const normalizedDependencies = (dependencies || []).map(dependency => ({
      fieldName: powerAppsFieldReference(dependency?.fieldName),
      targetField: powerAppsFieldReference(dependency?.targetField),
      optional: dependency?.optional === true,
      transform: dependency?.transform || null,
    }));
    if (normalizedDependencies.some(dependency => !dependency.fieldName || !dependency.targetField)) return null;
    normalizedDependencies.sort((left, right) => `${left.fieldName}:${left.targetField}`.localeCompare(`${right.fieldName}:${right.targetField}`));
    signatures.add(JSON.stringify({
      kind: source.kind,
      entityId: String(source.entityId || ""),
      listName,
      valueField,
      dependencies: normalizedDependencies,
      fixedFilters: source.fixedFilters || [],
      fixedFilterGroups: source.fixedFilterGroups || [],
      displayFields: source.displayFields || [],
      searchFields: source.searchFields || [],
      additionalFields: source.additionalFields || [],
      computedFields: source.computedFields || [],
    }));
  }
  return signatures.size === 1 ? sources[0] : null;
}

function choiceValues(column, currentValue) {
  const values = [...(column?.choices || [])].map(value => String(value));
  if (column?.powerApps?.preserveCurrentValue === true) {
    const current = Array.isArray(currentValue) ? currentValue : [currentValue];
    for (const value of current.map(item => String(item ?? "")).filter(Boolean)) {
      if (!values.includes(value)) values.push(value);
    }
  }
  return values;
}

function multipleChoiceValues(value, column) {
  if (Array.isArray(value)) return value.map(item => String(item ?? "").trim()).filter(Boolean);
  const text = String(value ?? "").trim();
  if (!text) return [];
  const serialization = column?.powerApps?.multipleSerialization;
  const delimiter = serialization?.kind === "concat" ? String(serialization.delimiter ?? "") : "";
  if (!delimiter) return [text];
  return text.split(delimiter).map(item => item.trim()).filter(Boolean);
}

function serializeMultipleChoice(values, column) {
  const normalized = multipleChoiceValues(values, column);
  const serialization = column?.powerApps?.multipleSerialization;
  if (serialization?.kind !== "concat") return normalized;
  const specialValues = (serialization.specialValues || []).map(value => String(value));
  const special = normalized.find(value => specialValues.includes(value));
  return special || normalized.join(String(serialization.delimiter ?? ""));
}

function displayChoiceValue(value, column) {
  const transform = column?.powerApps?.valueTransform;
  if (transform?.kind !== "scale" || value === "" || value === null || value === undefined) return value;
  const number = Number(value);
  const multiplier = Number(transform.displayMultiplier);
  return Number.isFinite(number) && Number.isFinite(multiplier) ? String(number * multiplier) : value;
}

function serializeChoiceValue(value, column) {
  const transform = column?.powerApps?.valueTransform;
  if (transform?.kind !== "scale" || value === "" || value === null || value === undefined) return value;
  const number = Number(value);
  const divisor = Number(transform.submitDivisor);
  return Number.isFinite(number) && Number.isFinite(divisor) && divisor !== 0 ? number / divisor : value;
}

function powerAppsDependencyValues(form, source) {
  return Object.freeze(Object.fromEntries((source?.dependsOn || []).flatMap(dependency => {
    const fieldName = powerAppsFieldReference(dependency?.fieldName);
    const targetField = powerAppsFieldReference(dependency?.targetField);
    if (!fieldName || !targetField) throw new Error("A dependência Power Apps não foi comprovada pela fórmula Items.");
    const control = form?.elements?.namedItem?.(fieldName);
    const value = String(control?.value ?? "").trim();
    if (!control) throw new Error(`Selecione ${fieldName} antes de pesquisar este campo.`);
    if (!value && dependency?.optional === true) return [];
    if (!value) throw new Error(`Selecione ${fieldName} antes de pesquisar este campo.`);
    return [[fieldName, value]];
  })));
}

function relationshipSearchSeed(value) {
  const query = String(value || "").trim();
  const firstTerm = query.split(/\s+/)[0] || "";
  return firstTerm.length >= RELATIONSHIP_MIN_LENGTH ? firstTerm : query;
}

function formDescriptors(columns = [], entity = {}) {
  const descriptors = columns.every(column => Object.hasOwn(column, "control"))
    ? columns
    : mapSharePointColumns(columns, entity);
  const sources = new Map((columns || []).map(column => [column.name, column]));
  return descriptors.map(column => {
    const source = sources.get(column.name) || {};
    const allowMultipleValues = column.allowMultipleValues === true
      || source.allowMultipleValues === true
      || source.choice?.allowMultipleValues === true
      || source.lookup?.allowMultipleValues === true
      || source.personOrGroup?.allowMultipleSelection === true
      || column.relation?.multiple === true;
    const searchable = source.searchable ?? source.choice?.searchable ?? column.searchable;
    if (allowMultipleValues === (column.allowMultipleValues === true) && searchable === column.searchable) return column;
    return Object.freeze({ ...column, allowMultipleValues, ...(searchable === undefined ? {} : { searchable }) });
  });
}

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

function relationshipIsSelectable(column) {
  const relation = column?.relation;
  if (relation?.resolvable === true) return true;
  if (relation?.multiple !== true) return false;
  const displayField = String(relation.displayField || "Title");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(displayField)) return false;
  if (relation.kind === "lookup") return Boolean(String(relation.listId || "").trim());
  return relation.kind === "person"
    && String(relation.principalType || "peopleOnly").toLowerCase() === "peopleonly";
}

function multipleRelationshipOptions(column, values = {}, relationshipLabels = {}) {
  if (column?.relation?.multiple !== true) return [];
  const rawIds = values?.[`${column.name}LookupId`] ?? values?.[column.name] ?? [];
  const rawLabels = relationshipLabels?.[column.name]
    ?? values?.[`${column.name}LookupValue`]
    ?? values?.[`${column.name}DisplayName`]
    ?? [];
  const ids = Array.isArray(rawIds) ? rawIds : [];
  const labels = Array.isArray(rawLabels) ? rawLabels : [];
  return ids.map((id, index) => ({ value: Number(id), label: String(labels[index] || "").trim() }))
    .filter(option => Number.isInteger(option.value) && option.value > 0 && option.label);
}

function relationshipControlMarkup(column, values = {}, disabled = false, relationshipLabels = {}) {
  const name = escapeHtml(column.name);
  const label = escapeHtml(column.label);
  const domId = relationshipDomId(column.name);
  const multiple = column.relation?.multiple === true;
  const selectedOptions = multipleRelationshipOptions(column, values, relationshipLabels);
  const selectedId = multiple ? "" : values?.[`${column.name}LookupId`] ?? values?.[column.name] ?? "";
  const selectedLabel = multiple ? "" : relationshipLabel(column, values, relationshipLabels);
  const available = relationshipIsSelectable(column);
  const hiddenValue = available
    ? multiple ? JSON.stringify(selectedOptions.map(option => option.value)) : selectedId
    : RELATIONSHIP_UNRESOLVED;
  const disabledAttribute = disabled || !available ? " disabled" : "";
  const required = column.required ? " required" : "";
  const hint = available
    ? `Digite pelo menos ${RELATIONSHIP_MIN_LENGTH} caracteres e selecione ${multiple ? "uma ou mais opções" : "uma opção"} pelo nome.`
    : "Esta relação não pôde ser resolvida com segurança pelos metadados SharePoint.";
  return `<div class="dynamic-field dynamic-relationship" data-relation-field="${name}">
    <label for="${domId}-search">${label}${column.required ? " *" : ""}</label>
    <input type="search" id="${domId}-search" value="${escapeHtml(selectedLabel)}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${domId}-options" aria-describedby="${domId}-hint ${domId}-status" data-relation-search="${name}" autocomplete="off"${required}${disabledAttribute}>
    <span class="dynamic-relationship-searchable" data-relation-searchable-root="${name}"></span>
    <input type="hidden" name="${name}" value="${escapeHtml(hiddenValue)}" data-relation-value="${name}">
    ${multiple ? `<ul class="dynamic-selected-items" data-selected-items="${name}" role="list" aria-label="${label} selecionadas"></ul>` : ""}
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

function validatedPowerAppsOptions(options, limit) {
  if (!Array.isArray(options) || options.length > limit) {
    throw new TypeError("A origem Power Apps retornou um conjunto de opções inválido.");
  }
  const seen = new Set();
  return Object.freeze(options.map(option => {
    const value = String(option?.value ?? "");
    const label = String(option?.label ?? "").trim();
    if (!value || !label || seen.has(value)) {
      throw new TypeError("A origem Power Apps retornou uma opção inválida ou duplicada.");
    }
    const data = option?.data;
    const entries = data && typeof data === "object" && !Array.isArray(data) ? Object.entries(data) : [];
    if (data !== undefined && (!data || typeof data !== "object" || Array.isArray(data))) {
      throw new TypeError("A origem Power Apps retornou dados auxiliares inválidos.");
    }
    if (entries.length > 16 || entries.some(([field, fieldValue]) => (
      !powerAppsFieldReference(field)
      || !["string", "number", "boolean"].includes(typeof fieldValue)
    ))) {
      throw new TypeError("A origem Power Apps retornou dados auxiliares inválidos.");
    }
    seen.add(value);
    return Object.freeze({
      value,
      label,
      ...(entries.length ? { data: Object.freeze(Object.fromEntries(entries)) } : {}),
    });
  }));
}

export function createPowerAppsOptionSearchController(options = {}) {
  if (typeof options.search !== "function") throw new TypeError("O seletor Power Apps requer uma função de pesquisa.");
  const debounceMs = Math.max(0, Math.min(2000, Number(options.debounceMs ?? 300) || 0));
  const minLength = Math.max(2, Math.min(10, Number(options.minLength ?? POWERAPPS_OPTION_MIN_LENGTH) || POWERAPPS_OPTION_MIN_LENGTH));
  const limit = Math.max(1, Math.min(POWERAPPS_OPTION_LIMIT, Number(options.limit ?? POWERAPPS_OPTION_LIMIT) || POWERAPPS_OPTION_LIMIT));
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
        const results = validatedPowerAppsOptions(await options.search(term, { signal: controller.signal, limit }), limit);
        if (disposed || token !== generation || controller.signal.aborted) return;
        activeController = undefined;
        emit({
          status: results.length ? "ready" : "empty",
          options: results,
          message: results.length ? `${results.length} opção(ões) encontrada(s).` : "Nenhuma opção encontrada.",
        });
      } catch (error) {
        if (disposed || token !== generation || controller.signal.aborted || error?.name === "AbortError") return;
        activeController = undefined;
        emit({ status: "error", options: [], message: error?.message || "A origem Power Apps está indisponível." });
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
    const multiple = column.allowMultipleValues === true;
    const remoteSource = powerAppsRemoteSource(column);
    const normalizedValue = multiple ? multipleChoiceValues(value, column) : displayChoiceValue(value, column);
    const availableChoices = choiceValues(column, normalizedValue);
    const unresolvedClosedSource = column.powerApps?.closed === true
      && !(column.choices || []).length
      && !remoteSource;
    const selectedValues = new Set((multiple ? normalizedValue : [value]).map(item => String(item ?? "")));
    const selectDisabled = disabled || unresolvedClosedSource ? " disabled" : "";
    const select = `<select name="${name}"${multiple ? " multiple" : ""}${required}${readOnly}${selectDisabled}>${multiple ? "" : '<option value="">Selecione</option>'}${availableChoices.map(choice => `<option value="${escapeHtml(choice)}"${selectedValues.has(String(choice)) ? " selected" : ""}>${escapeHtml(choice)}</option>`).join("")}</select>`;
    if (column.searchable === false || (!(column.choices || []).length && !remoteSource)) {
      return `<label class="dynamic-field"><span>${label}${column.required ? " *" : ""}</span>${select}</label>`;
    }
    return `<label class="dynamic-field" data-searchable-field="${name}"><span>${label}${column.required ? " *" : ""}</span>${select}${multiple ? `<ul class="dynamic-selected-items" data-selected-items="${name}" role="list" aria-label="${label} selecionadas"></ul>` : ""}<span data-searchable-root="${name}"></span>${remoteSource ? `<small data-powerapps-option-status="${name}" aria-live="polite"></small>` : ""}</label>`;
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

export function formMarkup({ entity, columns = [], mode = "create", values = {}, defaultContext = {}, relationshipLabels = {}, error = "", conflict = null, submitting = false, submitLabel = "", attachments = {} } = {}) {
  const descriptors = formDescriptors(columns, entity);
  const visibleColumns = descriptors.filter(column => !column.hidden && column.editable);
  const resolvedValues = applyPowerAppsDefaultValues(descriptors, values, {
    mode,
    context: {
      ...defaultContext,
      record: { ...(defaultContext?.record || {}), ...(values || {}) },
      attachments,
    },
  });
  const action = submitLabel || (mode === "edit" ? "Salvar alterações" : "Salvar registro");
  const formHeading = mode === "create" && entity?.id === "notas-pendentes"
    ? "Novo Pedido Form42_7"
    : mode === "create" && entity?.id === "provisoes-de-pagamento"
      ? "Provisão de Pagamento Form9"
      : mode === "create" && entity?.id === "despesas-recorrentes"
        ? "Cadastro Despesa Recorrente Form1_36"
        : mode === "create" && entity?.id === "cadastro-de-grupos"
          ? "Cadastro Grupo Form1"
        : mode === "create" && entity?.id === "familias"
          ? "Cadastro Família Form1_1"
        : mode === "create" && entity?.id === "cadastro-de-subfamilias"
          ? "Cadastro Subfamília Form1_2"
      : (entity?.title || "Registro");
  return `<form class="dynamic-form" data-dynamic-form novalidate aria-busy="${submitting ? "true" : "false"}">
    <div class="dynamic-form-heading"><div><p class="page-eyebrow">${mode === "edit" ? "Editar registro" : "Novo registro"}</p><h2>${escapeHtml(formHeading)}</h2></div><button class="button-secondary" type="button" data-form-cancel${submitting ? " disabled" : ""}>Cancelar</button></div>
    <p class="dynamic-form-errors" data-form-errors role="alert"${error ? "" : " hidden"}>${escapeHtml(error)}</p>
    ${conflictMarkup(conflict, visibleColumns, submitting)}
    <div class="dynamic-form-grid">${visibleColumns.map(column => column.control === "lookup" || column.control === "person"
      ? relationshipControlMarkup(column, resolvedValues, submitting, relationshipLabels)
      : controlMarkup(
        column,
        resolvedValues[column.name],
        submitting,
      )).join("") || '<p class="entity-empty">Não há campos editáveis nesta lista.</p>'}</div>
    ${formAttachmentFieldMarkup({ ...attachments, disabled: submitting })}
    <div class="dynamic-form-actions"><button class="button-primary" type="submit" data-form-save${submitting ? " disabled" : ""}>${submitting ? "Salvando..." : action}</button><button class="button-secondary form-clear-button" type="reset" data-form-clear${submitting ? " disabled" : ""}>Limpar formulário</button></div>
  </form>`;
}

function readValues(form, columns, overrides = {}) {
  const values = {};
  for (const column of columns) {
    if (!column.editable || column.hidden) continue;
    if (Object.hasOwn(overrides, column.name)) {
      values[column.name] = overrides[column.name];
      continue;
    }
    const control = form.elements.namedItem(column.name);
    if (!control) continue;
    values[column.name] = column.control === "checkbox" ? control.checked : control.value;
  }
  return values;
}

function relationshipOptionsMarkup(name, options = {}) {
  return (options.options || []).map((option, index) => {
    const optionId = `${relationshipDomId(name)}-option-${index}`;
    return `<li id="${optionId}" role="option" aria-selected="false" data-relation-option="${index}"><strong>${escapeHtml(option.label)}</strong>${option.secondary ? `<small>${escapeHtml(option.secondary)}</small>` : ""}</li>`;
  }).join("");
}

function selectedItemsRenderer(mount, list, label, onRemove) {
  if (!list) return () => {};
  return options => {
    const elements = options.map(option => {
      const item = mount.ownerDocument.createElement("li");
      const text = mount.ownerDocument.createElement("span");
      const remove = mount.ownerDocument.createElement("button");
      text.textContent = option.label;
      remove.setAttribute("type", "button");
      remove.setAttribute("aria-label", `Remover ${option.label}`);
      remove.className = "dynamic-selected-item-remove";
      remove.textContent = "x";
      remove.addEventListener("click", () => onRemove(option));
      item.append(text, remove);
      return item;
    });
    list.replaceChildren(...elements);
    list.hidden = elements.length === 0;
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", `${label} selecionadas`);
  };
}

function bindChoiceSelectors(form, columns, options = {}) {
  const cleanups = [];
  const selectionChecks = [];
  const valueReaders = [];
  const fieldReaders = [];
  const sharedFieldReaders = [];
  const descriptors = new Map((columns || []).map(column => [column.name, column]));
  for (const field of form?.querySelectorAll?.("[data-searchable-field]") || []) {
    const native = field?.querySelector?.("select[name]");
    const mount = field?.querySelector?.("[data-searchable-root]");
    const column = descriptors.get(String(native?.name || ""));
    if (!native || !mount || !column || column.control !== "select" || column.searchable === false) continue;

    const remoteSource = powerAppsRemoteSource(column);
    const multiple = column.allowMultipleValues === true;
    const currentValue = options.values?.[column.name] ?? native.value;
    const normalizedCurrent = multiple ? multipleChoiceValues(currentValue, column) : displayChoiceValue(currentValue, column);
    if (!multiple) native.value = String(normalizedCurrent ?? "");
    const choices = choiceValues(column, normalizedCurrent).map(choice => Object.freeze({ value: String(choice), label: String(choice) }));
    const initialValues = multiple
      ? multipleChoiceValues(currentValue, column)
      : [String(normalizedCurrent ?? "")];
    let selectedOptions = choices.filter(option => initialValues.includes(option.value));
    let selectedOption = multiple ? null : selectedOptions[0] || null;
    const selectedItems = field?.querySelector?.("[data-selected-items]");
    let synchronizing = false;
    let refreshing = false;
    const originalRequired = native.required === true;
    const originalHidden = native.hidden === true;
    const originalDisabled = native.disabled === true;
    let control;
    const renderSelectedItems = selectedItemsRenderer(mount, selectedItems, column.label, option => {
      selectedOptions = selectedOptions.filter(selected => selected.value !== option.value);
      native.value = selectedOptions[0]?.value || "";
      renderSelectedItems(selectedOptions);
    });
    control = createSearchableSelect(mount, {
      id: `field-${column.name}`,
      label: column.label,
      options: choices,
      value: multiple ? undefined : selectedOption?.value,
      onChange(value, option) {
        if (multiple) {
          if (synchronizing) return;
          if (option && !selectedOptions.some(selected => selected.value === option.value)) {
            selectedOptions = [...selectedOptions, option];
            native.value = selectedOptions[0]?.value || "";
            renderSelectedItems(selectedOptions);
          }
          synchronizing = true;
          control.setValue("");
          synchronizing = false;
          return;
        }
        selectedOption = option;
        native.value = value === "" ? "" : String(value);
      },
    });
    native.hidden = true;
    native.required = false;
    control.input.required = column.required === true && !multiple;
    if (column.required) control.input.setAttribute("aria-required", "true");
    control.input.disabled = native.disabled === true;
    if (remoteSource) {
      const status = field?.querySelector?.("[data-powerapps-option-status]");
      const initialCurrent = !multiple && selectedOption ? selectedOption : null;
      if (typeof options.powerAppsOptionSearch !== "function") {
        control.input.disabled = true;
        native.disabled = true;
        if (status) status.textContent = "A origem Power Apps não está disponível para seleção segura.";
      } else {
        const mergedOptions = remoteOptions => {
          const retained = multiple ? selectedOptions : [selectedOption || initialCurrent].filter(Boolean);
          const byValue = new Map(retained.map(option => [option.value, option]));
          for (const option of remoteOptions || []) byValue.set(String(option.value), Object.freeze({
            ...option,
            value: String(option.value),
            label: String(option.label),
          }));
          return [...byValue.values()];
        };
        const searchController = createPowerAppsOptionSearchController({
          debounceMs: options.powerAppsOptionDebounceMs,
          minLength: POWERAPPS_OPTION_MIN_LENGTH,
          limit: POWERAPPS_OPTION_LIMIT,
          search: (term, requestOptions) => options.powerAppsOptionSearch(
            column,
            remoteSource,
            term,
            powerAppsDependencyValues(form, remoteSource),
            requestOptions,
          ),
          onState(state) {
            if (status) status.textContent = state.message || "";
            if (state.status !== "ready" && state.status !== "empty" && state.status !== "error") return;
            const query = control.input.value;
            refreshing = true;
            control.setOptions(mergedOptions(state.options));
            control.search(query);
            refreshing = false;
          },
        });
        const onRemoteInput = event => {
          if (!refreshing) searchController.input(event?.target?.value);
        };
        control.input.addEventListener("input", onRemoteInput);
        cleanups.push(() => {
          searchController.dispose();
          control.input.removeEventListener("input", onRemoteInput);
        });
      }
    }
    if (multiple) {
      control.listbox.setAttribute("aria-multiselectable", "true");
      control.input.value = "";
      renderSelectedItems(selectedOptions);
      const onKeyDown = event => {
        if (event?.key !== "Backspace" || control.input.value || !selectedOptions.length) return;
        event.preventDefault?.();
        selectedOptions = selectedOptions.slice(0, -1);
        native.value = selectedOptions[0]?.value || "";
        renderSelectedItems(selectedOptions);
      };
      control.input.addEventListener("keydown", onKeyDown);
      cleanups.push(() => control.input.removeEventListener("keydown", onKeyDown));
      valueReaders.push(Object.freeze({ name: column.name, read: () => selectedOptions.map(option => option.value) }));
      fieldReaders.push(Object.freeze({
        name: column.name,
        read: () => serializeMultipleChoice(selectedOptions.map(option => option.value), column),
      }));
    } else if (column?.powerApps?.valueTransform) {
      fieldReaders.push(Object.freeze({
        name: column.name,
        read: () => serializeChoiceValue(selectedOption?.value ?? native.value, column),
      }));
    }
    if (Array.isArray(column?.powerApps?.sharedOutputs) && column.powerApps.sharedOutputs.length) {
      sharedFieldReaders.push(() => {
        if (!selectedOption) return {};
        return Object.fromEntries(column.powerApps.sharedOutputs.flatMap(output => {
          const value = output.sourceField === remoteSource?.valueField
            ? selectedOption.value
            : selectedOption.data?.[output.sourceField];
          return value === undefined || value === null ? [] : [[output.fieldName, value]];
        }));
      });
    }
    selectionChecks.push(() => {
      if (multiple) {
        const valid = !String(control.input.value || "").trim();
        return Object.freeze({
          valid,
          name: column.name,
          error: valid ? "" : `Selecione uma opção válida para ${column.label}.`,
        });
      }
      const selectedValue = control.getValue();
      const inputValue = String(control.input.value || "");
      const nativeValue = String(native.value || "");
      if (!selectedOption && !selectedValue && !nativeValue && !inputValue) {
        return Object.freeze({ valid: true, name: column.name });
      }
      const valid = Boolean(selectedOption)
        && String(selectedValue) === selectedOption.value
        && nativeValue === selectedOption.value
        && inputValue === selectedOption.label;
      return Object.freeze({
        valid,
        name: column.name,
        error: valid ? "" : `Selecione uma opção válida para ${column.label}.`,
      });
    });
    cleanups.push(() => {
      control.destroy();
      native.hidden = originalHidden;
      native.required = originalRequired;
      native.disabled = originalDisabled;
    });
  }
  return Object.freeze({
    validate() {
      const errors = {};
      for (const check of selectionChecks) {
        const result = check();
        if (!result.valid) errors[result.name] = result.error;
      }
      return Object.freeze({ errors: Object.freeze(errors) });
    },
    values() {
      return Object.freeze(Object.fromEntries(valueReaders.map(reader => [reader.name, reader.read()])));
    },
    fields() {
      return Object.freeze({
        ...Object.fromEntries(fieldReaders.map(reader => [reader.name, reader.read()])),
        ...Object.assign({}, ...sharedFieldReaders.map(read => read())),
      });
    },
    cleanup() { cleanups.forEach(cleanup => cleanup()); },
  });
}

function bindRelationshipSelectors(form, columns, options = {}) {
  const cleanups = [];
  const selectionChecks = [];
  const valueReaders = [];
  const fieldReaders = [];
  const descriptors = new Map((columns || []).map(column => [column.name, column]));
  for (const container of form?.querySelectorAll?.("[data-relation-field]") || []) {
    const name = String(container?.dataset?.relationField || "");
    const column = descriptors.get(name);
    const input = container?.querySelector?.("[data-relation-search]");
    const hidden = container?.querySelector?.("[data-relation-value]");
    const status = container?.querySelector?.("[data-relation-status]");
    const listbox = container?.querySelector?.("[data-relation-options]");
    const mount = container?.querySelector?.("[data-relation-searchable-root]");
    const selectedItems = container?.querySelector?.("[data-selected-items]");
    if (!column || !input || !hidden || !status || !listbox) continue;
    if (!relationshipIsSelectable(column) || typeof options.relationshipSearch !== "function") {
      hidden.value = RELATIONSHIP_UNRESOLVED;
      input.disabled = true;
      status.textContent = "Esta relação não está disponível para seleção segura.";
      continue;
    }

    if (mount?.ownerDocument && typeof options.relationshipSearch === "function") {
      const multiple = column.relation?.multiple === true;
      const initialId = multiple ? "" : options.values?.[`${name}LookupId`] ?? options.values?.[name] ?? "";
      const initialLabel = multiple ? "" : relationshipLabel(column, options.values, options.relationshipLabels);
      const initialOption = !multiple && Number(initialId) > 0 && initialLabel
        ? Object.freeze({ value: Number(initialId), label: initialLabel })
        : null;
      let selectedOptions = multipleRelationshipOptions(column, options.values, options.relationshipLabels)
        .map(option => Object.freeze(option));
      let selectedProof = initialOption
        ? Object.freeze({ id: initialOption.value, label: initialOption.label })
        : null;
      let refreshing = false;
      let synchronizing = false;
      let control;
      const originalInputHidden = input.hidden === true;
      const originalInputDisabled = input.disabled === true;
      const originalListboxHidden = listbox.hidden === true;
      const dispatchInput = target => {
        if (typeof target?.dispatchEvent === "function") {
          const EventConstructor = target.ownerDocument?.defaultView?.Event || globalThis.Event;
          target.dispatchEvent(new EventConstructor("input", { bubbles: true }));
        } else {
          target?.dispatch?.("input");
        }
      };
      const syncMultipleValue = () => {
        if (!multiple) return;
        hidden.value = JSON.stringify(selectedOptions.map(option => option.value));
      };
      const renderSelectedItems = selectedItemsRenderer(mount, selectedItems, column.label, option => {
        selectedOptions = selectedOptions.filter(selected => selected.value !== option.value);
        syncMultipleValue();
        renderSelectedItems(selectedOptions);
      });
      control = createSearchableSelect(mount, {
        id: relationshipDomId(name),
        label: column.label,
        options: multiple ? [] : initialOption ? [initialOption] : [],
        value: multiple ? undefined : initialOption?.value,
        onChange(value, option) {
          if (multiple) {
            if (synchronizing) return;
            if (option && !selectedOptions.some(selected => selected.value === Number(option.value))) {
              selectedOptions = [...selectedOptions, Object.freeze({ value: Number(option.value), label: option.label })];
              syncMultipleValue();
              renderSelectedItems(selectedOptions);
            }
            synchronizing = true;
            control.setValue("");
            synchronizing = false;
            return;
          }
          if (option) {
            hidden.value = String(value);
            selectedProof = Object.freeze({ id: Number(value), label: option.label });
            status.textContent = `${option.label} selecionado.`;
          } else {
            selectedProof = null;
            hidden.value = String(control?.input?.value || "").trim() ? RELATIONSHIP_UNRESOLVED : "";
          }
        },
      });
      control.input.required = column.required === true && !multiple;
      if (column.required) control.input.setAttribute("aria-required", "true");
      control.input.disabled = input.disabled === true;
      control.input.setAttribute("aria-describedby", `${relationshipDomId(name)}-hint ${relationshipDomId(name)}-status`);
      if (multiple) {
        control.listbox.setAttribute("aria-multiselectable", "true");
        control.input.value = "";
        syncMultipleValue();
        renderSelectedItems(selectedOptions);
        valueReaders.push(Object.freeze({ name, read: () => selectedOptions.map(option => option.value) }));
        fieldReaders.push(Object.freeze({ name: `${name}LookupId`, read: () => selectedOptions.map(option => option.value) }));
      }
      input.hidden = true;
      input.disabled = true;
      listbox.hidden = true;

      const controller = createRelationshipSearchController({
        debounceMs: options.relationshipDebounceMs,
        minLength: RELATIONSHIP_MIN_LENGTH,
        limit: RELATIONSHIP_LIMIT,
        search: (term, requestOptions) => {
          const searchColumn = multiple
            ? Object.freeze({ ...column, relation: Object.freeze({ ...column.relation, multiple: false, resolvable: true }) })
            : column;
          return options.relationshipSearch(searchColumn, relationshipSearchSeed(term), requestOptions);
        },
        onState(state) {
          status.textContent = state.message || "";
          if (state.status !== "ready") {
            if (state.status === "empty" || state.status === "error") control.setOptions([]);
            return;
          }
          const query = control.input.value;
          refreshing = true;
          control.setOptions((state.options || []).map(option => ({ value: option.id, label: option.label })));
          control.input.value = query;
          dispatchInput(control.input);
          refreshing = false;
        },
      });
      const onInput = event => {
        if (!refreshing) controller.input(event?.target?.value);
      };
      const onKeyDown = event => {
        if (multiple && event?.key === "Backspace" && !control.input.value && selectedOptions.length) {
          event.preventDefault?.();
          selectedOptions = selectedOptions.slice(0, -1);
          syncMultipleValue();
          renderSelectedItems(selectedOptions);
          return;
        }
        if (!multiple && event?.key === "Escape" && !control.getValue()) hidden.value = "";
      };
      const onBlur = () => {
        if (multiple) syncMultipleValue();
        else if (!control.getValue()) hidden.value = "";
      };
      control.input.addEventListener("input", onInput);
      control.input.addEventListener("keydown", onKeyDown);
      control.input.addEventListener("blur", onBlur);
      selectionChecks.push(() => {
        if (multiple) {
          const expectedValue = JSON.stringify(selectedOptions.map(option => option.value));
          const valid = !String(control.input.value || "").trim()
            && String(hidden.value || "") === expectedValue
            && (!column.required || selectedOptions.length > 0);
          return Object.freeze({
            valid,
            name,
            label: valid ? selectedOptions.map(option => option.label) : [],
            error: valid ? "" : `Selecione uma ou mais opções válidas para ${column.label}.`,
          });
        }
        const hiddenValue = String(hidden.value || "");
        const inputValue = String(control.input.value || "");
        if (!hiddenValue && !inputValue) return Object.freeze({ valid: true, name, label: "" });
        const valid = Boolean(selectedProof)
          && Number(control.getValue()) === selectedProof.id
          && hiddenValue === String(selectedProof.id)
          && inputValue === selectedProof.label;
        return Object.freeze({
          valid,
          name,
          label: valid ? selectedProof.label : "",
          error: valid ? "" : `Selecione ${column.label} novamente: a seleção não corresponde a uma opção autorizada da pesquisa atual.`,
        });
      });
      cleanups.push(() => {
        controller.dispose();
        control.input.removeEventListener("input", onInput);
        control.input.removeEventListener("keydown", onKeyDown);
        control.input.removeEventListener("blur", onBlur);
        control.destroy();
        input.hidden = originalInputHidden;
        input.disabled = originalInputDisabled;
        listbox.hidden = originalListboxHidden;
      });
      continue;
    }

    let currentOptions = [];
    const initialId = options.values?.[`${name}LookupId`] ?? options.values?.[name] ?? "";
    const initialLabel = relationshipLabel(column, options.values, options.relationshipLabels);
    let selectedProof = String(initialId) && initialLabel
      && String(hidden.value) === String(initialId)
      && String(input.value) === initialLabel
      ? Object.freeze({ id: Number(initialId), label: initialLabel })
      : null;
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
      selectedProof = Object.freeze({ id: option.id, label: option.label });
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
      selectedProof = null;
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
    selectionChecks.push(() => {
      const hiddenValue = String(hidden.value || "");
      const inputValue = String(input.value || "");
      if (!hiddenValue && !inputValue) return Object.freeze({ valid: true, name, label: "" });
      const valid = Boolean(selectedProof)
        && hiddenValue === String(selectedProof.id)
        && inputValue === selectedProof.label;
      return Object.freeze({
        valid,
        name,
        label: valid ? selectedProof.label : "",
        error: valid ? "" : `Selecione ${column.label} novamente: a seleção não corresponde a uma opção autorizada da pesquisa atual.`,
      });
    });
    cleanups.push(() => {
      controller.dispose();
      input.removeEventListener?.("input", onInput);
      input.removeEventListener?.("keydown", onKeyDown);
      listbox.removeEventListener?.("click", onListClick);
    });
  }
  return Object.freeze({
    validate() {
      const errors = {};
      const labels = {};
      for (const check of selectionChecks) {
        const result = check();
        if (!result.valid) errors[result.name] = result.error;
        else if (result.label) labels[result.name] = result.label;
      }
      return Object.freeze({ errors: Object.freeze(errors), labels: Object.freeze(labels) });
    },
    values() {
      return Object.freeze(Object.fromEntries(valueReaders.map(reader => [reader.name, reader.read()])));
    },
    fields() {
      return Object.freeze(Object.fromEntries(fieldReaders.map(reader => [reader.name, reader.read()])));
    },
    cleanup() { cleanups.forEach(cleanup => cleanup()); },
  });
}

function showErrors(root, errors) {
  const message = Object.values(errors || {}).join(" ");
  const target = root.querySelector("[data-form-errors]");
  if (!target) return;
  target.textContent = message;
  target.hidden = !message;
}

export function bindFormAttachments(root, options = {}) {
  if (options.enabled !== true) return Object.freeze({ changes: () => Object.freeze({ uploads: Object.freeze([]), deletions: Object.freeze([]) }), cleanup() {} });
  const draft = createFormAttachmentDraft({ existingFiles: options.existingFiles || [], readExisting: options.readExisting });
  if (options.pendingFiles?.length) draft.addUploads(options.pendingFiles);
  const mount = root.querySelector?.("[data-form-attachments]");
  const input = mount?.querySelector?.("[data-form-attachment-input]");
  const status = mount?.querySelector?.("[data-form-attachment-status]");
  const list = mount?.querySelector?.("[data-form-attachment-list]");
  const viewerHost = mount?.querySelector?.("[data-form-attachment-viewer-host]");
  const setStatus = (message, isError = false) => {
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    status.classList?.toggle?.("is-error", isError);
  };
  let files = [...draft.visibleFiles()];
  const refreshList = () => {
    const changes = draft.changes();
    files.splice(0, files.length, ...draft.visibleFiles());
    if (list) list.innerHTML = formAttachmentRowsMarkup({
      canView: options.canView === true,
      canEdit: options.canEdit === true,
      existingFiles: options.existingFiles || [],
      pendingFiles: changes.uploads,
      removedNames: changes.deletions,
    });
  };
  const add = event => {
    try {
      draft.addUploads(event.currentTarget?.files || event.target?.files || []);
      refreshList();
      if (input) input.value = "";
      setStatus("Arquivo(s) preparado(s) para envio.");
    } catch (error) {
      setStatus(error?.message || "Não foi possível preparar os anexos.", true);
    }
  };
  const removeUpload = event => {
    if (draft.removeUpload(event.currentTarget?.dataset?.formAttachmentRemoveUpload)) refreshList();
  };
  const removeExisting = event => {
    if (draft.removeExisting(event.currentTarget?.dataset?.formAttachmentRemoveExisting)) refreshList();
  };
  const pendingButtons = [...(mount?.querySelectorAll?.("[data-form-attachment-remove-upload]") || [])];
  const existingButtons = [...(mount?.querySelectorAll?.("[data-form-attachment-remove-existing]") || [])];
  const openButtons = [...(mount?.querySelectorAll?.("[data-form-attachment-open]") || [])];
  const downloadButtons = [...(mount?.querySelectorAll?.("[data-form-attachment-download]") || [])];
  const fileActions = Object.freeze({
    canView: () => options.canView === true,
    async downloadAttachment(name) {
      const index = files.findIndex(file => file?.name === name);
      if (index < 0) throw new RangeError("O anexo selecionado não está disponível.");
      return draft.readFile(index);
    },
  });
  const presenter = createAttachmentPresenter({ urlApi: options.urlApi || globalThis.URL });
  const previewController = createAttachmentPreviewController({ files, actions: fileActions, urlApi: options.urlApi || globalThis.URL });
  const closeViewer = () => {
    previewController.close();
    if (viewerHost) viewerHost.innerHTML = "";
  };
  const downloadFile = async file => {
    try {
      const bytes = await fileActions.downloadAttachment(file?.name);
      presenter.present({ bytes, name: file?.name, type: file?.type, mode: "download" });
    } catch (error) {
      setStatus(error?.message || "Não foi possível baixar o anexo.", true);
    }
  };
  const renderViewer = () => {
    if (!viewerHost) return;
    const preview = previewController.getState();
    viewerHost.innerHTML = attachmentViewerMarkup({ files, activeIndex: preview.activeIndex, preview: preview.preview });
    const dialog = viewerHost.querySelector?.("[data-attachment-viewer]");
    dialog?.querySelector?.("[data-attachment-preview-close]")?.addEventListener?.("click", closeViewer);
    dialog?.querySelector?.("[data-attachment-previous]")?.addEventListener?.("click", async () => {
      try { await previewController.previous(); renderViewer(); } catch (error) { setStatus(error?.message || "Não foi possível abrir o anexo.", true); }
    });
    dialog?.querySelector?.("[data-attachment-next]")?.addEventListener?.("click", async () => {
      try { await previewController.next(); renderViewer(); } catch (error) { setStatus(error?.message || "Não foi possível abrir o anexo.", true); }
    });
    dialog?.querySelector?.("[data-attachment-preview-download]")?.addEventListener?.("click", () => {
      const file = files[previewController.getState().activeIndex];
      if (file) downloadFile(file);
    });
    try { dialog?.showModal?.(); } catch { dialog?.setAttribute?.("open", ""); }
  };
  const open = async event => {
    const index = files.findIndex(file => file?.name === event.currentTarget?.dataset?.formAttachmentOpen);
    try {
      await previewController.open(index);
      renderViewer();
    } catch (error) {
      setStatus(error?.message || "Não foi possível abrir o anexo.", true);
    }
  };
  const download = event => {
    const file = files.find(candidate => candidate?.name === event.currentTarget?.dataset?.formAttachmentDownload);
    if (file) return downloadFile(file);
    return undefined;
  };
  const delegatedClick = event => {
    const target = event.target?.closest?.("[data-form-attachment-remove-upload],[data-form-attachment-remove-existing],[data-form-attachment-open],[data-form-attachment-download]");
    if (!target || !list?.contains?.(target)) return;
    const delegatedEvent = { currentTarget: target, target };
    if (target.dataset?.formAttachmentRemoveUpload) removeUpload(delegatedEvent);
    else if (target.dataset?.formAttachmentRemoveExisting) removeExisting(delegatedEvent);
    else if (target.dataset?.formAttachmentOpen) open(delegatedEvent);
    else if (target.dataset?.formAttachmentDownload) download(delegatedEvent);
  };
  input?.addEventListener?.("change", add);
  list?.addEventListener?.("click", delegatedClick);
  pendingButtons.forEach(button => button.addEventListener?.("click", removeUpload));
  existingButtons.forEach(button => button.addEventListener?.("click", removeExisting));
  openButtons.forEach(button => button.addEventListener?.("click", open));
  downloadButtons.forEach(button => button.addEventListener?.("click", download));
  return Object.freeze({
    changes: draft.changes,
    draft,
    cleanup() {
      input?.removeEventListener?.("change", add);
      list?.removeEventListener?.("click", delegatedClick);
      pendingButtons.forEach(button => button.removeEventListener?.("click", removeUpload));
      existingButtons.forEach(button => button.removeEventListener?.("click", removeExisting));
      openButtons.forEach(button => button.removeEventListener?.("click", open));
      downloadButtons.forEach(button => button.removeEventListener?.("click", download));
      previewController.cleanup();
      presenter.cleanup();
    },
  });
}

export function renderDynamicForm(root, options = {}) {
  if (!root) throw new TypeError("O formulario requer um elemento raiz.");
  const descriptors = formDescriptors(options.columns || [], options.entity);
  root.innerHTML = formMarkup({ ...options, columns: descriptors });
  let disposed = false;
  const form = root.querySelector("[data-dynamic-form]");
  const save = root.querySelector("[data-form-save]");
  const cancel = root.querySelector("[data-form-cancel]");
  const clear = root.querySelector("[data-form-clear]");
  const reloadConflict = root.querySelector("[data-form-reload-conflict]");
  const choiceBindings = bindChoiceSelectors(form, descriptors, options);
  const relationshipBindings = bindRelationshipSelectors(form, descriptors, options);
  const attachmentBindings = bindFormAttachments(root, options.attachments);
  let submitting = false;
  const onCancel = () => { if (!disposed && !submitting) options.onCancel?.(); };
  const onClear = () => { if (!disposed && !submitting) showErrors(root, {}); };
  const onReloadConflict = () => { if (!disposed && !submitting) options.onReloadConflict?.(); };
  const onSubmit = async event => {
    event.preventDefault();
    if (disposed || submitting || !form?.reportValidity?.()) return;
    const relationshipValues = relationshipBindings.values();
    const rawValues = readValues(form, descriptors, { ...choiceBindings.values(), ...relationshipValues });
    const choiceProof = choiceBindings.validate();
    if (Object.keys(choiceProof.errors).length) {
      showErrors(root, choiceProof.errors);
      return;
    }
    const relationshipProof = relationshipBindings.validate();
    if (Object.keys(relationshipProof.errors).length) {
      showErrors(root, relationshipProof.errors);
      return;
    }
    const relationshipLabels = relationshipProof.labels;
    const valuesForValidation = { ...rawValues };
    Object.keys(relationshipValues).forEach(name => { delete valuesForValidation[name]; });
    const validation = validateFormValues(valuesForValidation, descriptors, options.entity, { mode: options.mode });
    if (Object.keys(validation.errors).length) {
      showErrors(root, validation.errors);
      return;
    }
    const fields = Object.freeze({ ...validation.fields, ...choiceBindings.fields(), ...relationshipBindings.fields() });
    showErrors(root, {});
    submitting = true;
    form?.setAttribute?.("aria-busy", "true");
    const controls = Array.from(form?.elements || []);
    const disabledStates = controls.map(control => control.disabled === true);
    controls.forEach(control => { control.disabled = true; });
    if (save) { save.disabled = true; save.textContent = "Salvando..."; }
    try {
      await options.onSubmit?.(fields, rawValues, relationshipLabels, attachmentBindings.changes());
    } finally {
      submitting = false;
      if (!disposed) {
        form?.setAttribute?.("aria-busy", "false");
        controls.forEach((control, index) => { control.disabled = disabledStates[index]; });
        if (save) { save.disabled = false; save.textContent = options.submitLabel || (options.mode === "edit" ? "Salvar alterações" : "Salvar registro"); }
      }
    }
  };
  cancel?.addEventListener("click", onCancel);
  clear?.addEventListener("click", onClear);
  reloadConflict?.addEventListener("click", onReloadConflict);
  form?.addEventListener("submit", onSubmit);
  return Object.freeze({
    cleanup() {
      disposed = true;
      cancel?.removeEventListener("click", onCancel);
      clear?.removeEventListener("click", onClear);
      reloadConflict?.removeEventListener("click", onReloadConflict);
      form?.removeEventListener("submit", onSubmit);
      choiceBindings.cleanup();
      relationshipBindings.cleanup();
      attachmentBindings.cleanup();
    },
  });
}
