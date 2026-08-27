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

function validatedOptions(options) {
  if (!Array.isArray(options)) {
    throw new TypeError("O seletor requer opções válidas e únicas.");
  }

  const seen = new Set();
  return Object.freeze(options.map(option => {
    const value = option?.value;
    const label = String(option?.label ?? "").trim();
    const validValue = (typeof value === "string" && value.length > 0)
      || (typeof value === "number" && Number.isFinite(value));
    const key = optionKey(value);
    if (!validValue || !label || seen.has(key)) {
      throw new TypeError("O seletor requer opções válidas e únicas.");
    }
    seen.add(key);
    return Object.freeze({ value, label });
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
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", `${id}-listbox`);
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-label", String(config.label || "Selecionar opção"));
  listbox.className = "searchable-select-options";
  listbox.setAttribute("id", `${id}-listbox`);
  listbox.setAttribute("role", "listbox");
  listbox.hidden = true;
  container.append(input, listbox);
  root.replaceChildren(container);

  let allOptions = validatedOptions(config.options || []);
  let filteredOptions = Object.freeze([]);
  let selectedOption = null;
  let activeIndex = -1;
  let open = false;
  let destroyed = false;

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
    input.value = option.label;
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
      element.addEventListener("click", () => choose(option));
      return element;
    });
    listbox.replaceChildren(...elements);
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    setExpanded(filteredOptions.length > 0);
  }

  function filterOptions(query) {
    const terms = normalizeText(query).split(/\s+/).filter(Boolean);
    filteredOptions = Object.freeze(allOptions.filter(option => {
      const searchable = normalizeText(`${option.label} ${String(option.value)}`);
      return terms.every(term => searchable.includes(term));
    }));
    return filteredOptions;
  }

  function clearSelection(notify = true) {
    if (!selectedOption) return;
    selectedOption = null;
    if (notify) emit();
  }

  function onInput() {
    clearSelection(true);
    filterOptions(input.value);
    renderOptions();
  }

  function onKeyDown(event) {
    if (event?.key === "ArrowDown") {
      if (!open) {
        filterOptions(input.value);
        renderOptions();
      }
      if (!filteredOptions.length) return;
      event.preventDefault?.();
      setExpanded(true);
      setActive(activeIndex < 0 ? 0 : activeIndex + 1);
    } else if (event?.key === "ArrowUp") {
      if (!open) {
        filterOptions(input.value);
        renderOptions();
      }
      if (!filteredOptions.length) return;
      event.preventDefault?.();
      setExpanded(true);
      setActive(activeIndex < 0 ? filteredOptions.length - 1 : activeIndex - 1);
    } else if (event?.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault?.();
      choose(filteredOptions[activeIndex]);
    } else if (event?.key === "Escape") {
      if (open) event.preventDefault?.();
      input.value = selectedOption?.label || "";
      setExpanded(false);
    }
  }

  function onBlur() {
    input.value = selectedOption?.label || "";
    setExpanded(false);
  }

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", onBlur);

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
        input.value = "";
        filteredOptions = Object.freeze([]);
        listbox.replaceChildren();
        setExpanded(false);
        if (changed) emit();
        return false;
      }
      return choose(option);
    },
    setOptions(options) {
      if (destroyed) return;
      const previous = selectedOption;
      allOptions = validatedOptions(options);
      const replacement = previous ? findOption(previous.value) : null;
      if (replacement) {
        selectedOption = replacement;
        input.value = replacement.label;
      } else {
        selectedOption = null;
        input.value = "";
        if (previous) emit();
      }
      filteredOptions = Object.freeze([]);
      listbox.replaceChildren();
      setExpanded(false);
    },
    visibleOptions() {
      return filteredOptions;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("blur", onBlur);
      root.replaceChildren();
    },
  });
}
