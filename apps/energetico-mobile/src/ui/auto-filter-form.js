const FILTER_CONTROL = 'input:not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea';

export function bindAutoFilterForm(form, apply, { debounceMs = 180 } = {}) {
  if (!form?.addEventListener || typeof apply !== 'function') {
    throw new TypeError('A filter form and its apply callback are required.');
  }

  const view = form.ownerDocument?.defaultView || globalThis;
  const delay = Number.isFinite(Number(debounceMs)) ? Math.max(0, Number(debounceMs)) : 180;
  let timer = null;

  function values() {
    return JSON.stringify([...form.elements]
      .filter(control => control.name && control.matches?.(FILTER_CONTROL))
      .map(control => [control.name, control.type, control.type === 'checkbox' || control.type === 'radio'
        ? control.checked : control.value]));
  }

  let lastAppliedValues = values();

  function cancelPending() {
    if (timer !== null) view.clearTimeout(timer);
    timer = null;
  }

  function sync() {
    cancelPending();
    lastAppliedValues = values();
  }

  function applyNow() {
    cancelPending();
    lastAppliedValues = values();
    apply();
  }

  function applyIfChanged() {
    cancelPending();
    const nextValues = values();
    if (nextValues === lastAppliedValues) return;
    lastAppliedValues = nextValues;
    apply();
  }

  function onInput(event) {
    if (!event.target?.matches?.(FILTER_CONTROL) || !form.contains(event.target)) return;
    cancelPending();
    timer = view.setTimeout(applyIfChanged, delay);
  }

  function onChange(event) {
    if (!event.target?.matches?.(FILTER_CONTROL) || !form.contains(event.target)) return;
    applyIfChanged();
  }

  function onSubmit(event) {
    event.preventDefault();
    applyNow();
  }

  form.addEventListener('input', onInput);
  form.addEventListener('change', onChange);
  form.addEventListener('submit', onSubmit);

  return Object.freeze({
    apply: applyNow,
    cancelPending,
    sync,
    destroy() {
      cancelPending();
      form.removeEventListener('input', onInput);
      form.removeEventListener('change', onChange);
      form.removeEventListener('submit', onSubmit);
    },
  });
}
