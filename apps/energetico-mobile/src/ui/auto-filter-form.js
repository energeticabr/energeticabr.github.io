import { bindSearchableFilterSelects } from './searchable-filter-selects.js';

const FILTER_CONTROL = 'input:not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea';

export function bindAutoFilterForm(form, apply, { debounceMs = 180, externalControls = [], strictTextDebounce = false } = {}) {
  if (!form?.addEventListener || typeof apply !== 'function') {
    throw new TypeError('A filter form and its apply callback are required.');
  }

  const view = form.ownerDocument?.defaultView || globalThis;
  const delay = Number.isFinite(Number(debounceMs)) ? Math.max(0, Number(debounceMs)) : 180;
  let timer = null, pendingValues = null;
  const searchableSelects = bindSearchableFilterSelects(form);
  const external = new Set(externalControls.filter(control => !form.contains(control)));
  const composing = new Set();

  function values() {
    return JSON.stringify([...new Set([...form.elements, ...external])]
      .filter(control => control.name && control.matches?.(FILTER_CONTROL))
      .map(control => [control.name, control.type, control.type === 'checkbox' || control.type === 'radio'
        ? control.checked : control.value]));
  }

  let lastAppliedValues = values();

  function cancelPending() {
    searchableSelects.close();
    if (timer !== null) view.clearTimeout(timer);
    timer = null;
    pendingValues = null;
  }

  function sync() {
    cancelPending();
    composing.clear();
    lastAppliedValues = values();
    searchableSelects.sync();
  }

  function applyNow() {
    cancelPending();
    lastAppliedValues = values();
    apply();
    searchableSelects.sync();
  }

  function applyIfChanged() {
    cancelPending();
    if (composing.size) return;
    const nextValues = values();
    if (nextValues === lastAppliedValues) return;
    lastAppliedValues = nextValues;
    apply();
    searchableSelects.sync();
  }

  function isFilterEvent(event) {
    return event.target?.dataset?.filterOptionSearch !== 'true' && event.target?.matches?.(FILTER_CONTROL)
      && (form.contains(event.target) || external.has(event.target));
  }

  function onInput(event) {
    if (!isFilterEvent(event)) return;
    cancelPending();
    if (event.isComposing) composing.add(event.target);
    if (composing.size) return;
    pendingValues = values();
    timer = view.setTimeout(applyIfChanged, delay);
  }

  function onChange(event) {
    if (!isFilterEvent(event)) return;
    if (strictTextDebounce && event.target.matches('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="number"], input[type="tel"], input[type="email"], input[type="url"]')) {
      // Blur and the native search event must not shortcut the typing delay.
      if (timer === null || pendingValues !== values()) onInput(event);
      return;
    }
    applyIfChanged();
  }

  function onCompositionStart(event) {
    if (!isFilterEvent(event)) return;
    composing.add(event.target);
    cancelPending();
  }

  function onCompositionEnd(event) {
    if (!isFilterEvent(event)) return;
    composing.delete(event.target);
    onInput(event);
  }

  function onSubmit(event) {
    event.preventDefault();
    if (composing.size) return;
    applyNow();
  }

  form.addEventListener('input', onInput);
  form.addEventListener('change', onChange);
  form.addEventListener('submit', onSubmit);
  form.addEventListener('compositionstart', onCompositionStart);
  form.addEventListener('compositionend', onCompositionEnd);
  for (const control of external) {
    control.addEventListener('input', onInput);
    control.addEventListener('change', onChange);
    control.addEventListener('search', onChange);
    control.addEventListener('compositionstart', onCompositionStart);
    control.addEventListener('compositionend', onCompositionEnd);
  }

  return Object.freeze({
    apply: applyNow,
    cancelPending,
    sync,
    hasPendingApplication() { return timer !== null || composing.size > 0; },
    // A discarded async result must be fetched again even if typing returns to its query.
    invalidate() { lastAppliedValues = null; },
    destroy() {
      cancelPending();
      composing.clear();
      searchableSelects.destroy();
      form.removeEventListener('input', onInput);
      form.removeEventListener('change', onChange);
      form.removeEventListener('submit', onSubmit);
      form.removeEventListener('compositionstart', onCompositionStart);
      form.removeEventListener('compositionend', onCompositionEnd);
      for (const control of external) {
        control.removeEventListener('input', onInput);
        control.removeEventListener('change', onChange);
        control.removeEventListener('search', onChange);
        control.removeEventListener('compositionstart', onCompositionStart);
        control.removeEventListener('compositionend', onCompositionEnd);
      }
    },
  });
}
