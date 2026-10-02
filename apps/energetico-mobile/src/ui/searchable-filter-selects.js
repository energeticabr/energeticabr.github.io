const enhanced = new WeakMap();
let nextId = 0;

function searchableText(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

function createPicker(select, closeOthers) {
  const doc = select.ownerDocument;
  const view = doc.defaultView;
  const original = { hidden: select.hidden, ariaHidden: select.getAttribute('aria-hidden'), tabIndex: select.getAttribute('tabindex') };
  const enclosingLabel = select.closest('label');
  const labelText = select.getAttribute('aria-label') || [...(select.labels || [])]
    .map(label => [...label.childNodes].filter(node => node !== select).map(node => node.textContent).join(' ').trim())
    .join(' ') || select.name || 'Filtro';
  // A label may contain one labelable control only. Keep the field's layout,
  // but replace its implicit label before inserting the trigger and search.
  let field = null;
  if (enclosingLabel) {
    field = doc.createElement('div');
    for (const attribute of enclosingLabel.attributes) field.setAttribute(attribute.name, attribute.value);
    field.removeAttribute('for');
    field.append(...enclosingLabel.childNodes);
    enclosingLabel.replaceWith(field);
  }

  const id = `searchable-filter-${++nextId}`;
  const wrapper = doc.createElement('div'); wrapper.className = 'sfs';
  const trigger = doc.createElement('button'); trigger.type = 'button'; trigger.className = 'sfs-trigger';
  trigger.setAttribute('aria-label', labelText);
  trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${id}-list`);
  const valueLabel = doc.createElement('span'); valueLabel.className = 'sfs-value';
  const arrow = doc.createElement('span'); arrow.className = 'sfs-arrow'; arrow.textContent = '▾'; arrow.setAttribute('aria-hidden', 'true');
  trigger.append(valueLabel, arrow);
  const popup = doc.createElement('div'); popup.className = 'sfs-popup'; popup.hidden = true;
  const search = doc.createElement('input'); search.type = 'search'; search.className = 'sfs-search';
  search.dataset.filterOptionSearch = 'true'; search.placeholder = 'Pesquisar opções…'; search.autocomplete = 'off';
  search.setAttribute('role', 'combobox'); search.setAttribute('aria-label', `Pesquisar opções de ${labelText}`);
  search.setAttribute('aria-autocomplete', 'list'); search.setAttribute('aria-expanded', 'false');
  search.setAttribute('aria-controls', `${id}-list`);
  const list = doc.createElement('div'); list.className = 'sfs-list'; list.id = `${id}-list`;
  list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', labelText);
  const empty = doc.createElement('p'); empty.className = 'sfs-empty'; empty.textContent = 'Nenhuma opção encontrada.';
  empty.setAttribute('role', 'status'); empty.hidden = true;
  popup.append(search, list, empty); wrapper.append(trigger, popup); select.after(wrapper);
  select.hidden = true; select.setAttribute('aria-hidden', 'true'); select.tabIndex = -1;
  let candidates = [];
  let active = -1;
  let destroyed = false;
  let observedViewport = null;
  let selectingOption = false;
  let pressedOption = null;
  let pressedAt = null;
  let selectionReset = null;

  function disabled(option) {
    return select.matches(':disabled') || option.disabled || option.parentElement?.tagName === 'OPTGROUP' && option.parentElement.disabled;
  }
  function highlight(index) {
    active = index;
    [...list.children].forEach((item, position) => item.classList.toggle('sfs-option--active', position === active));
    if (active < 0) search.removeAttribute('aria-activedescendant');
    else search.setAttribute('aria-activedescendant', list.children[active].id);
  }
  function positionPopup() {
    if (popup.hidden || destroyed) return;
    const viewport = view.visualViewport;
    let top = viewport?.offsetTop || 0;
    let bottom = top + (viewport?.height || view.innerHeight || doc.documentElement.clientHeight);
    // Keep the dropdown inside scrollable gallery content as well as the
    // viewport. Its DOM stays in the dialog so the existing focus trap works.
    for (let ancestor = wrapper.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (!/(auto|scroll|hidden|clip)/.test(view.getComputedStyle(ancestor).overflowY)) continue;
      const bounds = ancestor.getBoundingClientRect();
      if (bounds.height > 0) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
    }
    const bounds = trigger.getBoundingClientRect();
    const below = Math.max(0, bottom - bounds.bottom - 13);
    const above = Math.max(0, bounds.top - top - 13);
    const placement = below < 180 && above > below ? 'above' : 'below';
    const height = Math.max(0, Math.min(320, placement === 'above' ? above : below));
    popup.dataset.placement = placement;
    popup.style.top = placement === 'below' ? 'calc(100% + 5px)' : 'auto';
    popup.style.bottom = placement === 'above' ? 'calc(100% + 5px)' : 'auto';
    popup.style.maxHeight = `${height}px`;
    const searchHeight = search.getBoundingClientRect().height || 44;
    list.style.maxHeight = `${Math.max(0, Math.min(240, height - searchHeight - 19))}px`;
  }
  function render() {
    const query = searchableText(search.value);
    candidates = [...select.options].filter(option => !option.hidden && (!query || searchableText(option.label).includes(query)));
    list.replaceChildren(...candidates.map((option, index) => {
      const item = doc.createElement('div'); item.className = 'sfs-option'; item.id = `${id}-option-${index}`;
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected));
      item.setAttribute('aria-disabled', String(disabled(option))); item.textContent = option.label;
      item.addEventListener('click', () => choose(option));
      return item;
    }));
    const hasOptions = candidates.length > 0;
    if (empty.hidden !== hasOptions) empty.hidden = hasOptions;
    let index = candidates.findIndex(option => option.selected && !disabled(option));
    if (index < 0) index = candidates.findIndex(option => !disabled(option));
    highlight(index);
    positionPopup();
  }
  function close({ focus = false } = {}) {
    selectingOption = false;
    pressedOption = null;
    pressedAt = null;
    if (selectionReset !== null) view.clearTimeout(selectionReset);
    selectionReset = null;
    if (!popup.hidden) popup.hidden = true;
    trigger.setAttribute('aria-expanded', 'false'); search.setAttribute('aria-expanded', 'false');
    search.value = ''; highlight(-1);
    if (focus && !trigger.disabled) trigger.focus({ preventScroll: true });
  }
  function sync() {
    if (destroyed) return;
    const selection = [...select.options].filter(option => option.selected).map(option => option.label).join(', ');
    valueLabel.textContent = selection || 'Todos';
    trigger.setAttribute('aria-label', `${labelText}: ${selection || 'Todos'}`);
    const isDisabled = select.matches(':disabled');
    if (trigger.disabled !== isDisabled) trigger.disabled = isDisabled;
    if (search.disabled !== isDisabled) search.disabled = isDisabled;
    if (trigger.disabled) close();
    else if (!popup.hidden) render();
  }
  function open() {
    sync();
    if (trigger.disabled) return;
    closeOthers();
    search.value = ''; popup.hidden = false;
    trigger.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-expanded', 'true');
    if (observedViewport !== view.visualViewport) {
      observedViewport?.removeEventListener('resize', positionPopup);
      observedViewport?.removeEventListener('scroll', positionPopup);
      observedViewport = view.visualViewport;
      observedViewport?.addEventListener('resize', positionPopup);
      observedViewport?.addEventListener('scroll', positionPopup);
    }
    render(); search.focus({ preventScroll: true });
    positionPopup();
  }
  function choose(option) {
    if (destroyed || disabled(option) || ![...select.options].includes(option)) return;
    const changed = select.value !== option.value;
    select.value = option.value;
    close({ focus: true }); sync();
    if (changed) select.dispatchEvent(new view.Event('change', { bubbles: true }));
  }
  function onTriggerClick() { if (popup.hidden) open(); else close(); }
  function onTriggerKey(event) {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); open();
  }
  function onSearchInput(event) { event.stopPropagation(); render(); }
  function onSearchChange(event) { event.stopPropagation(); }
  function onKey(event) {
    if (event.key === 'Escape' && !popup.hidden) {
      event.preventDefault(); event.stopPropagation(); close({ focus: true }); return;
    }
    if (event.target !== search) return;
    if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      if (candidates[active]) choose(candidates[active]);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      let index = active;
      for (let count = 0; count < candidates.length; count += 1) {
        index = (index + direction + candidates.length) % candidates.length;
        if (!disabled(candidates[index])) { highlight(index); list.children[index].scrollIntoView?.({ block: 'nearest' }); break; }
      }
    }
  }
  function onOutside(event) { if (!wrapper.contains(event.target)) close(); }
  function onOptionPointerDown(event) {
    const target = event.target.closest?.('.sfs-option');
    pressedOption = event.button === 0 && event.isPrimary !== false && target && list.contains(target) ? target : null;
    pressedAt = pressedOption ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
    selectingOption = Boolean(pressedOption);
    if (selectionReset !== null) view.clearTimeout(selectionReset);
    selectionReset = null;
  }
  function onOptionPointerUp(event) {
    if (!selectingOption) return;
    const target = event.target.closest?.('.sfs-option');
    const travel = Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y);
    const hit = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(event.clientX, event.clientY) : null;
    // Touch pointer capture can keep event.target on the pressed option after
    // a drag. A stationary tap may still be valid while the keyboard reflows.
    const landed = typeof doc.elementFromPoint !== 'function' || pressedOption.contains(hit)
      || event.pointerType === 'touch' && travel <= 4;
    if (event.button === 0 && event.isPrimary !== false && event.pointerId === pressedAt.id
      && travel <= 12 && landed && target === pressedOption && list.contains(target)) {
      const index = [...list.children].indexOf(target);
      if (candidates[index]) { choose(candidates[index]); return; }
    }
    selectionReset = view.setTimeout(() => { selectingOption = false; pressedOption = null; selectionReset = null; }, 0);
  }
  function onOptionPointerCancel() {
    selectingOption = false;
    pressedOption = null;
    pressedAt = null;
    if (selectionReset !== null) view.clearTimeout(selectionReset);
    selectionReset = null;
  }
  function onAncestorScroll(event) {
    if (!selectingOption && (event.target === doc || event.target?.contains?.(wrapper) && !wrapper.contains(event.target))) close();
  }
  function onFocusOut(event) { if (!selectingOption && !wrapper.contains(event.relatedTarget)) close(); }
  function onReset() { view.queueMicrotask(() => { if (!destroyed) { close(); sync(); } }); }
  function closeIfHidden() {
    if (wrapper.closest('[hidden], [aria-hidden="true"], details:not([open])')) close();
    // Fieldset disabling affects the native select without changing its own attributes.
    sync();
  }
  trigger.addEventListener('click', onTriggerClick);
  trigger.addEventListener('keydown', onTriggerKey);
  search.addEventListener('input', onSearchInput); search.addEventListener('change', onSearchChange);
  wrapper.addEventListener('keydown', onKey); wrapper.addEventListener('focusout', onFocusOut);
  list.addEventListener('pointerdown', onOptionPointerDown);
  doc.addEventListener('pointerup', onOptionPointerUp);
  doc.addEventListener('pointercancel', onOptionPointerCancel);
  select.addEventListener('change', sync); select.form?.addEventListener('reset', onReset);
  doc.addEventListener('pointerdown', onOutside); doc.addEventListener('click', onOutside);
  doc.addEventListener('scroll', onAncestorScroll, true);
  view.addEventListener('resize', positionPopup);
  const optionObserver = new view.MutationObserver(sync);
  optionObserver.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'label', 'value', 'selected', 'hidden'] });
  const visibilityObserver = new view.MutationObserver(closeIfHidden);
  visibilityObserver.observe(doc.documentElement, { subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'disabled', 'aria-hidden'] });
  sync();

  return {
    sync, close,
    destroy() {
      if (destroyed) return;
      destroyed = true; optionObserver.disconnect(); visibilityObserver.disconnect();
      if (selectionReset !== null) view.clearTimeout(selectionReset);
      trigger.removeEventListener('click', onTriggerClick); trigger.removeEventListener('keydown', onTriggerKey);
      search.removeEventListener('input', onSearchInput); search.removeEventListener('change', onSearchChange);
      wrapper.removeEventListener('keydown', onKey); wrapper.removeEventListener('focusout', onFocusOut);
      list.removeEventListener('pointerdown', onOptionPointerDown);
      doc.removeEventListener('pointerup', onOptionPointerUp);
      doc.removeEventListener('pointercancel', onOptionPointerCancel);
      select.removeEventListener('change', sync); select.form?.removeEventListener('reset', onReset);
      doc.removeEventListener('pointerdown', onOutside); doc.removeEventListener('click', onOutside);
      doc.removeEventListener('scroll', onAncestorScroll, true); view.removeEventListener('resize', positionPopup);
      observedViewport?.removeEventListener('resize', positionPopup); observedViewport?.removeEventListener('scroll', positionPopup);
      wrapper.remove(); select.hidden = original.hidden;
      for (const [name, value] of [['aria-hidden', original.ariaHidden], ['tabindex', original.tabIndex]]) {
        if (value === null) select.removeAttribute(name); else select.setAttribute(name, value);
      }
      if (field) { enclosingLabel.append(...field.childNodes); field.replaceWith(enclosingLabel); }
      enhanced.delete(select);
    },
  };
}

export function bindSearchableFilterSelects(container) {
  const pickers = [];
  function close() { for (const picker of pickers) picker.close(); }
  for (const select of container.querySelectorAll('select:not([multiple])')) {
    if (enhanced.has(select)) continue;
    const picker = createPicker(select, close);
    enhanced.set(select, picker); pickers.push(picker);
  }
  return Object.freeze({ sync() { for (const picker of pickers) picker.sync(); }, close, destroy() { for (const picker of pickers) picker.destroy(); } });
}
