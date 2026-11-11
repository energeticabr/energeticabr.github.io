export function placeGalleryQuickSearch({ input, toolbar, placeholder, container }) {
  const wrapper = input.parentElement;
  input.type = 'search';
  input.name = 'search';
  input.maxLength = 500;
  input.dataset.galleryQuickSearch = '';
  input.classList.add('gallery-quick-search');
  input.placeholder = placeholder || 'Pesquisar em todos os campos (ID, nome, descrição…)';
  input.setAttribute('aria-label', 'Pesquisar em todos os campos da galeria');
  toolbar.classList.add('gallery-quick-search-toolbar');
  if (container) container.append(input);
  toolbar.prepend(container || input);
  if (wrapper?.matches('label')) wrapper.remove();
  return input;
}

const SEARCH_DELAY_MS = 1_000;

export function bindGallerySearchInput(input, apply) {
  const view = input.ownerDocument.defaultView || globalThis;
  let timer = null, composing = false, scheduledValue = input.value;

  function clearTimer() {
    if (timer !== null) view.clearTimeout(timer);
    timer = null;
  }
  function cancel() {
    clearTimer();
    composing = false;
    scheduledValue = input.value;
  }
  function schedule() {
    clearTimer();
    scheduledValue = input.value;
    timer = view.setTimeout(() => {
      timer = null;
      apply();
    }, SEARCH_DELAY_MS);
  }
  function startComposition() {
    composing = true;
    clearTimer();
  }
  const handlers = {
    input(event) {
      if (event.isComposing) startComposition();
      if (!composing && input.value !== scheduledValue) schedule();
    },
    compositionstart: startComposition,
    compositionend() {
      composing = false;
      schedule();
    },
    keydown(event) {
      if (event.key !== 'Enter' || event.isComposing || composing) return;
      event.preventDefault();
      cancel();
      apply();
    },
  };
  // Browsers may follow input with change/search when the field blurs or is cleared.
  handlers.change = handlers.search = handlers.input;
  for (const [type, handler] of Object.entries(handlers)) input.addEventListener(type, handler);
  return {
    cancel,
    isComposing: () => composing,
    hasPending: () => timer !== null || composing,
    destroy() {
      cancel();
      for (const [type, handler] of Object.entries(handlers)) input.removeEventListener(type, handler);
    },
  };
}
