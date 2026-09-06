import { createSearchableSelect } from "../forms/searchable-select.js?v=20260906-gallery-filter-v5";

function isSelect(element) {
  return String(element?.tagName || "").toUpperCase() === "SELECT";
}

function nativeOptions(select) {
  return Array.from(select.options || []).map(option => ({
    value: String(option.value ?? ""),
    label: String(option.label || option.textContent || option.value || "").trim(),
  }));
}

function dispatchNativeChange(select) {
  if (typeof select.dispatchEvent !== "function") return;
  const EventConstructor = select.ownerDocument?.defaultView?.Event || globalThis.Event;
  select.dispatchEvent(new EventConstructor("change", { bubbles: true }));
}

function createMultipleGalleryFilterSelect(nativeSelect, mount, config, visualState) {
  const documentRef = mount.ownerDocument;
  const selectorMount = documentRef.createElement("div");
  const selectionList = documentRef.createElement("div");
  selectionList.className = "searchable-select-selected";
  selectionList.setAttribute("aria-label", "Opções selecionadas");
  mount.replaceChildren(selectorMount, selectionList);
  let syncingFromNative = false;
  let destroyed = false;
  let control;

  const selectedOptions = () => Array.from(nativeSelect.options || []).filter(option => option.selected === true);

  function renderSelections() {
    const chips = selectedOptions().map(option => {
      const chip = documentRef.createElement("span");
      const label = documentRef.createElement("span");
      const remove = documentRef.createElement("button");
      chip.className = "searchable-select-chip";
      label.textContent = String(option.label || option.textContent || option.value || "").trim();
      remove.type = "button";
      remove.className = "searchable-select-chip-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remover ${label.textContent}`);
      remove.addEventListener("click", () => {
        if (destroyed) return;
        option.selected = false;
        renderSelections();
        dispatchNativeChange(nativeSelect);
      });
      chip.append(label, remove);
      return chip;
    });
    selectionList.replaceChildren(...chips);
  }

  control = createSearchableSelect(selectorMount, {
    id: config.id || nativeSelect.getAttribute?.("id") || nativeSelect.getAttribute?.("name"),
    label: config.label || nativeSelect.getAttribute?.("aria-label") || "Filtrar opções",
    placeholder: config.placeholder || "Pesquisar e selecionar",
    options: nativeOptions(nativeSelect).filter(option => option.value),
    value: "",
    onChange(value) {
      if (destroyed || syncingFromNative || value === "") return;
      const option = Array.from(nativeSelect.options || []).find(candidate => String(candidate.value ?? "") === String(value));
      if (!option || option.selected === true) return;
      option.selected = true;
      syncingFromNative = true;
      try {
        control.setValue("");
      } finally {
        syncingFromNative = false;
      }
      renderSelections();
      dispatchNativeChange(nativeSelect);
    },
  });

  function onNativeChange() {
    if (destroyed) return;
    syncingFromNative = true;
    try {
      control.setValue("");
      renderSelections();
    } finally {
      syncingFromNative = false;
    }
  }

  nativeSelect.addEventListener?.("change", onNativeChange);
  nativeSelect.hidden = true;
  nativeSelect.setAttribute?.("aria-hidden", "true");
  renderSelections();

  return Object.freeze({
    control,
    selectionList,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      nativeSelect.removeEventListener?.("change", onNativeChange);
      control.destroy();
      mount.replaceChildren();
      nativeSelect.hidden = visualState.previousHidden;
      if (visualState.hadAriaHidden) nativeSelect.setAttribute?.("aria-hidden", visualState.previousAriaHidden);
      else nativeSelect.removeAttribute?.("aria-hidden");
    },
  });
}

export function createGalleryFilterSelect(nativeSelect, mount, config = {}) {
  if (!isSelect(nativeSelect)) return null;

  const hadAriaHidden = nativeSelect.hasAttribute?.("aria-hidden") === true;
  const previousAriaHidden = nativeSelect.getAttribute?.("aria-hidden");
  const previousHidden = nativeSelect.hidden === true;
  if (nativeSelect.multiple === true || nativeSelect.getAttribute?.("multiple") !== null) {
    return createMultipleGalleryFilterSelect(nativeSelect, mount, config, {
      hadAriaHidden,
      previousAriaHidden,
      previousHidden,
    });
  }
  let syncingFromNative = false;
  let destroyed = false;

  const control = createSearchableSelect(mount, {
    id: config.id || nativeSelect.getAttribute?.("id") || nativeSelect.getAttribute?.("name"),
    label: config.label || nativeSelect.getAttribute?.("aria-label") || "Filtrar opções",
    placeholder: config.placeholder || "Pesquisar e selecionar",
    options: nativeOptions(nativeSelect),
    value: String(nativeSelect.value ?? ""),
    allowEmpty: true,
    onChange(value) {
      if (destroyed || syncingFromNative) return;
      nativeSelect.value = String(value ?? "");
      dispatchNativeChange(nativeSelect);
    },
  });

  function onNativeChange() {
    if (destroyed) return;
    syncingFromNative = true;
    try {
      control.setValue(String(nativeSelect.value ?? ""));
    } finally {
      syncingFromNative = false;
    }
  }

  nativeSelect.addEventListener?.("change", onNativeChange);
  nativeSelect.hidden = true;
  nativeSelect.setAttribute?.("aria-hidden", "true");

  return Object.freeze({
    control,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      nativeSelect.removeEventListener?.("change", onNativeChange);
      control.destroy();
      nativeSelect.hidden = previousHidden;
      if (hadAriaHidden) {
        nativeSelect.setAttribute?.("aria-hidden", previousAriaHidden);
      } else {
        nativeSelect.removeAttribute?.("aria-hidden");
      }
    },
  });
}
