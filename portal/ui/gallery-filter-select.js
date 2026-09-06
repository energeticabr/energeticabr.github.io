import { createSearchableSelect } from "../forms/searchable-select.js?v=20260906-gallery-filter-v5";

function isSimpleSelect(element) {
  return String(element?.tagName || "").toUpperCase() === "SELECT"
    && element.multiple !== true
    && element.getAttribute?.("multiple") === null;
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

export function createGalleryFilterSelect(nativeSelect, mount, config = {}) {
  if (!isSimpleSelect(nativeSelect)) return null;

  const hadAriaHidden = nativeSelect.hasAttribute?.("aria-hidden") === true;
  const previousAriaHidden = nativeSelect.getAttribute?.("aria-hidden");
  const previousHidden = nativeSelect.hidden === true;
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
