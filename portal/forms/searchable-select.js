let nextSearchableSelectId = 1;

function optionKey(value) {
  return `${typeof value}:${String(value)}`;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function validatedOptions(options, { allowEmpty = false } = {}) {
  if (!Array.isArray(options)) {
    throw new TypeError("O seletor requer opções válidas e únicas.");
  }

  const seen = new Set();
  return Object.freeze(options.map(option => {
    const value = option?.value;
    const label = String(option?.label ?? "").trim();
    const validValue = (typeof value === "string" && (value.length > 0 || allowEmpty))
      || (typeof value === "number" && Number.isFinite(value));
    const key = optionKey(value);
    if (!validValue || !label || seen.has(key)) {
      throw new TypeError("O seletor requer opções válidas e únicas.");
    }
    seen.add(key);
    const data = option?.data;
    if (data !== undefined && (!data || typeof data !== "object" || Array.isArray(data))) {
      throw new TypeError("O seletor requer dados auxiliares válidos.");
    }
    const entries = Object.entries(data || {});
    if (entries.length > 16 || entries.some(([field, fieldValue]) => (
      !String(field).trim()
      || !["string", "number", "boolean"].includes(typeof fieldValue)
    ))) {
      throw new TypeError("O seletor requer dados auxiliares escalares e limitados.");
    }
    return Object.freeze({
      value,
      label,
      ...(entries.length ? { data: Object.freeze(Object.fromEntries(entries)) } : {}),
    });
  }));
}

function safeId(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || `searchable-select-${nextSearchableSelectId++}`;
}

export function createSearchableSelect(root, config = {}) {
  const documentRef = root?.ownerDocument;
  if (!root || typeof root.replaceChildren !== "function" || typeof documentRef?.createElement !== "function") {
    throw new TypeError("O seletor pesquisável requer um elemento raiz válido.");
  }

  const id = safeId(config.id);
  const container = documentRef.createElement("div");
  const input = documentRef.createElement("input");
  const listbox = documentRef.createElement("ul");
  container.className = "searchable-select";
  input.className = "searchable-select-input";
  input.setAttribute("type", "search");
  const selectionOnly = config.selectionOnly === true;
  input.readOnly = selectionOnly;
  if (selectionOnly) {
    input.setAttribute('type', 'text');
    input.readOnly = true;
    input.setAttribute('data-select-only', '');
  }
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", selectionOnly ? "none" : "list");
  input.setAttribute("aria-controls", `${id}-listbox`);
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-label", String(config.label || "Selecionar opção"));
  input.setAttribute("placeholder", String(config.placeholder || (selectionOnly ? 'Selecione uma opção' : 'Pesquisar e selecionar')));
  listbox.className = "searchable-select-options";
  listbox.setAttribute("id", `${id}-listbox`);
  listbox.setAttribute("role", "listbox");
  listbox.hidden = true;
  container.append(input, listbox);
  root.replaceChildren(container);

  const optionValidation = Object.freeze({ allowEmpty: config.allowEmpty === true });
  let allOptions = validatedOptions(config.options || [], optionValidation);
  let filteredOptions = Object.freeze([]);
  let selectedOption = null;
  let activeIndex = -1;
  let open = false;
  let wantsOptions = false;
  let providerQuery = "";
  let providerMatches = new Set();
  let destroyed = false;
  const clearButton = config.clearable === true && !selectionOnly ? documentRef.createElement("button") : null;
  if (clearButton) {
    clearButton.type = "button";
    clearButton.className = "button-link searchable-select-clear";
    clearButton.textContent = "Limpar";
    clearButton.setAttribute("data-searchable-clear", "");
    clearButton.setAttribute("aria-label", `Limpar ${String(config.label || "seleção")}`);
    clearButton.hidden = true;
    container.append(clearButton);
  }
  const syncClearButton = () => { if (clearButton) clearButton.hidden = !selectedOption; };

  const findOption = value => allOptions.find(option => optionKey(option.value) === optionKey(value)) || null;
  const emit = () => config.onChange?.(selectedOption?.value ?? "", selectedOption);

  function setExpanded(expanded) {
    open = Boolean(expanded && filteredOptions.length);
    input.setAttribute("aria-expanded", open ? "true" : "false");
    listbox.hidden = !open;
    if (!open) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
    }
  }

  function setActive(index) {
    if (!filteredOptions.length) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
    } else {
      activeIndex = Math.max(0, Math.min(filteredOptions.length - 1, Number(index) || 0));
      input.setAttribute("aria-activedescendant", `${id}-option-${activeIndex}`);
    }
    Array.from(listbox.children).forEach((option, optionIndex) => {
      option.setAttribute("aria-selected", optionIndex === activeIndex ? "true" : "false");
    });
  }

  function choose(option, notify = true) {
    if (!option || !findOption(option.value)) return false;
    const changed = !selectedOption || optionKey(selectedOption.value) !== optionKey(option.value);
    selectedOption = option;
    syncClearButton();
    input.value = option.label;
    wantsOptions = false;
    filteredOptions = Object.freeze([]);
    listbox.replaceChildren();
    setExpanded(false);
    if (notify && changed) emit();
    return true;
  }

  function renderOptions() {
    const elements = filteredOptions.map((option, index) => {
      const element = documentRef.createElement("li");
      element.setAttribute("id", `${id}-option-${index}`);
      element.setAttribute("role", "option");
      element.setAttribute("aria-selected", "false");
      element.textContent = option.label;
      element.addEventListener("mousedown", event => event.preventDefault());
      element.addEventListener("click", () => choose(option));
      return element;
    });
    listbox.replaceChildren(...elements);
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    setExpanded(filteredOptions.length > 0);
  }

  function filterOptions(query) {
    const normalized = normalizeText(query);
    const terms = normalized.split(/\s+/).filter(Boolean);
    filteredOptions = Object.freeze(allOptions.filter(option => {
      if (normalized === providerQuery && providerMatches.has(optionKey(option.value))) return true;
      const searchable = normalizeText(`${option.label} ${String(option.value)}`);
      return terms.every(term => searchable.includes(term));
    }));
    return filteredOptions;
  }

  function onInput() {
    if (selectionOnly) { input.value = selectedOption?.label || ''; return; }
    providerMatches = new Set();
    if (!input.value && selectedOption) {
      selectedOption = null;
      syncClearButton();
      emit();
    }
    wantsOptions = true;
    filterOptions(input.value);
    renderOptions();
  }

  function openOptions() {
    wantsOptions = true;
    const clearEmptyLabel = !selectionOnly && config.clearEmptyLabelOnOpen === true
      && selectedOption
      && String(selectedOption.value ?? "") === ""
      && input.value === selectedOption.label;
    if (clearEmptyLabel) input.value = "";
    const query = selectionOnly || selectedOption && (clearEmptyLabel || input.value === selectedOption.label) ? "" : input.value;
    filterOptions(query);
    renderOptions();
  }

  function onKeyDown(event) {
    if (selectionOnly && (event?.key?.length === 1 || ['Backspace', 'Delete'].includes(event?.key))) {
      event.preventDefault?.();
      if (event.key === ' ') openOptions();
      return;
    }
    if (selectionOnly && event?.key === 'Enter' && !open) { event.preventDefault?.(); openOptions(); return; }
    if (event?.isComposing || event?.keyCode === 229) return;
    if (event?.key === "ArrowDown") {
      if (!open) {
        openOptions();
      }
      if (!filteredOptions.length) return;
      event.preventDefault?.();
      setExpanded(true);
      setActive(activeIndex < 0 ? 0 : activeIndex + 1);
    } else if (event?.key === "ArrowUp") {
      if (!open) {
        openOptions();
      }
      if (!filteredOptions.length) return;
      event.preventDefault?.();
      setExpanded(true);
      setActive(activeIndex < 0 ? filteredOptions.length - 1 : activeIndex - 1);
    } else if (event?.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault?.();
      choose(filteredOptions[activeIndex]);
    } else if (event?.key === "Escape") {
      if (open || wantsOptions) event.preventDefault?.();
      input.value = selectedOption?.label || "";
      wantsOptions = false;
      setExpanded(false);
    }
  }

  function onBlur() {
    wantsOptions = false;
    input.value = selectedOption?.label || "";
    setExpanded(false);
  }

  input.addEventListener("input", onInput);
  input.addEventListener("focus", openOptions);
  input.addEventListener("click", openOptions);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", onBlur);
  const blockEditing = event => event.preventDefault?.();
  const editEvents = ['beforeinput', 'paste', 'cut', 'drop'];
  if (selectionOnly) editEvents.forEach(name => input.addEventListener(name, blockEditing));
  const onClear = () => {
    if (input.disabled || input.readOnly) return;
    selectedOption = null;
    input.value = "";
    syncClearButton();
    emit();
    input.focus();
    openOptions();
    if (typeof input.dispatchEvent === "function") {
      const EventConstructor = documentRef.defaultView?.Event || globalThis.Event;
      input.dispatchEvent(new EventConstructor("input", { bubbles: true }));
    } else input.dispatch?.("input");
  };
  // Keep the list open until click: blur would collapse it and move this button
  // between pointer-down and pointer-up, losing the click on mouse and touch.
  const keepClearTarget = event => { if (!input.disabled && !input.readOnly) event.preventDefault(); };
  clearButton?.addEventListener("pointerdown", keepClearTarget);
  clearButton?.addEventListener("mousedown", keepClearTarget);
  clearButton?.addEventListener("click", onClear);

  const initial = findOption(config.value);
  if (initial) choose(initial, false);

  return Object.freeze({
    element: container,
    input,
    listbox,
    getValue() {
      return selectedOption?.value ?? "";
    },
    setValue(value) {
      if (destroyed) return false;
      const option = findOption(value);
      if (!option) {
        const changed = Boolean(selectedOption);
        selectedOption = null;
        syncClearButton();
        input.value = "";
        wantsOptions = false;
        filteredOptions = Object.freeze([]);
        listbox.replaceChildren();
        setExpanded(false);
        if (changed) emit();
        return false;
      }
      return choose(option);
    },
    setOptions(options, { preserveInput = false, matchingValues = [] } = {}) {
      if (destroyed) return;
      const previous = selectedOption;
      const query = input.value;
      providerQuery = normalizeText(query);
      providerMatches = new Set(matchingValues.map(optionKey));
      const reopen = preserveInput && wantsOptions;
      allOptions = validatedOptions(options, optionValidation);
      const replacement = previous ? findOption(previous.value) : null;
      if (replacement) {
        selectedOption = replacement;
        input.value = replacement.label;
      } else {
        selectedOption = null;
        input.value = "";
        if (previous) emit();
      }
      syncClearButton();
      filteredOptions = Object.freeze([]);
      listbox.replaceChildren();
      setExpanded(false);
      if (preserveInput) {
        input.value = previous && query === previous.label && replacement ? replacement.label : query;
        if (reopen) openOptions();
      } else wantsOptions = false;
    },
    search(query) {
      if (destroyed) return Object.freeze([]);
      wantsOptions = true;
      if (!selectionOnly) input.value = String(query ?? "");
      const matches = filterOptions(selectionOnly ? '' : input.value);
      renderOptions();
      return matches;
    },
    visibleOptions() {
      return filteredOptions;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      input.removeEventListener("input", onInput);
      input.removeEventListener("focus", openOptions);
      input.removeEventListener("click", openOptions);
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("blur", onBlur);
      if (selectionOnly) editEvents.forEach(name => input.removeEventListener(name, blockEditing));
      clearButton?.removeEventListener("click", onClear);
      clearButton?.removeEventListener("pointerdown", keepClearTarget);
      clearButton?.removeEventListener("mousedown", keepClearTarget);
      root.replaceChildren();
    },
  });
}
