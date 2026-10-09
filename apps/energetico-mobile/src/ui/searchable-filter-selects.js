const enhanced = new WeakMap();
let nextId = 0;

function searchableText(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

function createPicker(select, closeOthers, options = {}) {
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
  const reportPicker = options.report === true;
  const wrapper = doc.createElement('div'); wrapper.className = reportPicker ? 'sfs sfs--report' : 'sfs';
  const fieldBox = doc.createElement('div'); fieldBox.className = 'sfs-field';
  const arrow = doc.createElement('button'); arrow.type = 'button'; arrow.className = 'sfs-arrow'; arrow.textContent = '▾';
  arrow.tabIndex = -1; arrow.setAttribute('aria-label', `Abrir opções de ${labelText}`);
  const popup = doc.createElement('div'); popup.className = 'sfs-popup'; popup.hidden = true;
  const search = doc.createElement('input'); search.type = 'search'; search.className = 'sfs-trigger sfs-search sfs-value';
  const trigger = reportPicker ? doc.createElement('input') : search;
  if (reportPicker) { trigger.type = 'text'; trigger.className = 'sfs-trigger sfs-value'; trigger.readOnly = true; }
  const selectionOnly = options.selectionOnly === true;
  if (selectionOnly) { search.type = 'text'; search.readOnly = true; search.setAttribute('data-select-only',''); }
  search.dataset.filterOptionSearch = 'true'; search.autocomplete = 'off';
  search.setAttribute('role', 'combobox'); search.setAttribute('aria-label', reportPicker ? `Localizar itens de ${labelText}` : labelText);
  search.setAttribute('aria-haspopup', 'listbox');
  search.setAttribute('aria-autocomplete', selectionOnly ? 'none' : 'list'); search.setAttribute('aria-expanded', 'false');
  search.setAttribute('aria-controls', `${id}-list`);
  if (reportPicker) {
    trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-label', labelText);
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${id}-list`); trigger.setAttribute('aria-autocomplete', 'none');
  }
  const list = doc.createElement('div'); list.className = 'sfs-list'; list.id = `${id}-list`;
  list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', labelText);
  if (select.multiple) list.setAttribute('aria-multiselectable', 'true');
  const empty = doc.createElement('p'); empty.className = 'sfs-empty'; empty.textContent = 'Nenhuma opção encontrada.';
  empty.setAttribute('role', 'status'); empty.hidden = true;
  fieldBox.append(trigger, arrow);
  let backdrop = null, dismiss = null;
  if (reportPicker) {
    search.className = 'sfs-search sfs-report-search'; search.placeholder = 'Localizar itens';
    const header = doc.createElement('div'); header.className = 'sfs-picker-header';
    dismiss = doc.createElement('button'); dismiss.type = 'button'; dismiss.className = 'sfs-dismiss'; dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', `Fechar opções de ${labelText}`);
    header.append(search, dismiss); popup.append(header);
    backdrop = doc.createElement('div'); backdrop.className = 'sfs-backdrop'; backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true'); wrapper.append(backdrop);
  }
  popup.append(list, empty); wrapper.append(fieldBox, popup); select.after(wrapper);
  select.hidden = true; select.setAttribute('aria-hidden', 'true'); select.tabIndex = -1;
  let candidates = [];
  let active = -1;
  let destroyed = false;
  let observedViewport = null;
  let reportViewport = null;
  let selectingOption = false;
  let pressedOption = null;
  let pressedAt = null;
  let pointerSeen = false;
  let selectionReset = null;
  let restoringFocus = false;

  function selectionLabel() {
    return [...select.options].filter(option => option.selected).map(option => option.label).join(', ') || 'Todos';
  }

  function disabled(option) {
    return select.matches(':disabled') || option.disabled || option.parentElement?.tagName === 'OPTGROUP' && option.parentElement.disabled;
  }
  function highlight(index) {
    active = index;
    [...list.children].forEach((item, position) => item.classList.toggle('sfs-option--active', position === active));
    for (const control of new Set([trigger, search])) {
      if (active < 0) control.removeAttribute('aria-activedescendant');
      else control.setAttribute('aria-activedescendant', list.children[active].id);
    }
  }
  function positionPopup() {
    if (popup.hidden || destroyed) return;
    const viewport = view.visualViewport;
    let top = viewport?.offsetTop || 0;
    let bottom = top + (viewport?.height || view.innerHeight || doc.documentElement.clientHeight);
    let left = viewport?.offsetLeft || 0;
    let right = left + (viewport?.width || view.innerWidth || doc.documentElement.clientWidth);
    if (reportPicker) {
      // Retain the unobstructed height while searching: mobile keyboards shrink
      // both visualViewport and (on Android) the layout viewport. Like PowerApps,
      // let the keyboard cover the list bottom instead of flattening the list.
      // A width change is a new orientation/window size, not a keyboard resize.
      const viewportWidth = right - left, viewportHeight = bottom - top;
      if (reportViewport?.width === viewportWidth && viewportHeight < reportViewport.height
        && (doc.activeElement === search || reportViewport.keyboardOpen)) {
        // Keep this through keyboard dismissal/reopening too. A resize while
        // search is not being edited is an ordinary window resize and may fit.
        reportViewport.keyboardOpen = true;
      } else {
        reportViewport = { width: viewportWidth, height: viewportHeight, keyboardOpen: false };
      }
      const width = Math.max(0, Math.min(480, right - left - 24));
      const height = Math.max(0, Math.min(640, reportViewport.height - 24));
      popup.dataset.placement = 'expanded';
      popup.style.width = `${width}px`;
      popup.style.left = `${left + (right - left - width) / 2}px`;
      // Keep Localizar itens at the visible top even when iOS pans the viewport.
      popup.style.top = `${top + 12}px`;
      popup.style.right = 'auto'; popup.style.bottom = 'auto';
      popup.style.height = `${height}px`; popup.style.maxHeight = `${height}px`;
      list.style.maxHeight = `${Math.max(0, height - 54)}px`;
      return;
    }
    // Keep the dropdown inside scrollable gallery content as well as the
    // viewport. Its DOM stays in the dialog so the existing focus trap works.
    for (let ancestor = wrapper.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = view.getComputedStyle(ancestor);
      const bounds = ancestor.getBoundingClientRect();
      if (bounds.height > 0 && /(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
      }
    }
    const bounds = trigger.getBoundingClientRect();
    const below = Math.max(0, bottom - bounds.bottom - 13);
    const above = Math.max(0, bounds.top - top - 13);
    const placement = options.placement === 'below' ? 'below' : below < 180 && above > below ? 'above' : 'below';
    const height = Math.max(0, Math.min(320, placement === 'above' ? above : below));
    popup.dataset.placement = placement;
    popup.style.top = placement === 'below' ? 'calc(100% + 5px)' : 'auto';
    popup.style.bottom = placement === 'above' ? 'calc(100% + 5px)' : 'auto';
    popup.style.maxHeight = `${height}px`;
    list.style.maxHeight = `${Math.max(0, Math.min(240, height - 14))}px`;
  }
  function render() {
    const query = selectionOnly ? '' : searchableText(search.value);
    candidates = [...select.options].filter(option => !option.hidden && (!selectionOnly || option.value !== '') && (!query || searchableText(option.label).includes(query)));
    list.replaceChildren(...candidates.map((option, index) => {
      const item = doc.createElement('div'); item.className = 'sfs-option'; item.id = `${id}-option-${index}`;
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected));
      item.setAttribute('aria-disabled', String(disabled(option))); item.textContent = option.label;
      item.addEventListener('click', event => {
        // Pointerup already accepted or rejected this gesture. A later click
        // must not revive it, even if another option was pressed meanwhile.
        if (pointerSeen && event.detail > 0) return;
        choose(option);
      });
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
    if (backdrop && !backdrop.hidden) backdrop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false'); search.setAttribute('aria-expanded', 'false');
    trigger.value = selectionLabel();
    if (reportPicker) search.value = '';
    highlight(-1);
    if (focus && !trigger.disabled) {
      restoringFocus = true;
      trigger.focus({ preventScroll: true });
      restoringFocus = false;
    }
  }
  function sync() {
    if (destroyed) return;
    const selection = selectionLabel();
    search.placeholder = reportPicker ? 'Localizar itens' : selection;
    if (reportPicker || popup.hidden) trigger.value = selection;
    const isDisabled = select.matches(':disabled');
    if (trigger.disabled !== isDisabled) trigger.disabled = isDisabled;
    if (search.disabled !== isDisabled) search.disabled = isDisabled;
    if (arrow.disabled !== isDisabled) arrow.disabled = isDisabled;
    if (trigger.disabled) close();
    else if (!popup.hidden) render();
  }
  function open() {
    if (destroyed || restoringFocus || !popup.hidden) return;
    sync();
    if (trigger.disabled) return;
    closeOthers();
    search.value = selectionOnly ? selectionLabel() : ''; popup.hidden = false;
    if (backdrop) backdrop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-expanded', 'true');
    if (observedViewport !== view.visualViewport) {
      observedViewport?.removeEventListener('resize', positionPopup);
      observedViewport?.removeEventListener('scroll', positionPopup);
      observedViewport = view.visualViewport;
      observedViewport?.addEventListener('resize', positionPopup);
      observedViewport?.addEventListener('scroll', positionPopup);
    }
    render(); (reportPicker ? trigger : search).focus({ preventScroll: true });
    positionPopup();
  }
  function choose(option) {
    if (destroyed || disabled(option) || ![...select.options].includes(option)) return;
    const changed = select.multiple || select.value !== option.value;
    if (select.multiple) {
      onOptionPointerCancel();
      if (!option.value) { for (const candidate of select.options) candidate.selected = candidate === option; }
      else {
        option.selected = !option.selected;
        for (const candidate of select.options) if (!candidate.value) candidate.selected = false;
      }
    } else { select.value = option.value; close({ focus: true }); }
    sync();
    if (changed) select.dispatchEvent(new view.Event('change', { bubbles: true }));
  }
  function onTriggerClick() { if (popup.hidden) open(); }
  function onArrowClick() { if (popup.hidden) open(); else close({ focus: true }); }
  function onSearchEditStart() {
    // Choosing restores the label and focus. Start the next edit before the
    // browser inserts text so it cannot append to that committed label.
    if (!reportPicker && !selectionOnly && popup.hidden) open();
  }
  function onSearchInput(event) {
    event.stopPropagation();
    if (selectionOnly) { search.value = selectionLabel(); return; }
    if (popup.hidden) {
      const query = search.value;
      open(); search.value = query;
    }
    render();
  }
  function onSearchChange(event) { event.stopPropagation(); }
  function onKey(event) {
    if (selectionOnly && event.target === search && (event.key?.length === 1 || ['Backspace','Delete'].includes(event.key))) { event.preventDefault(); if(event.key===' ')open(); return; }
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && !popup.hidden) {
      event.preventDefault(); event.stopPropagation(); close({ focus: true }); return;
    }
    if (event.target !== search && event.target !== trigger) return;
    if (reportPicker && popup.hidden && ['Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); open(); return;
    }
    if (popup.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); open(); return;
    }
    if (event.key === 'Enter' && !popup.hidden) {
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
  function onOutside(event) { if (!wrapper.contains(event.target) && !event.composedPath?.().includes(wrapper)) close(); }
  function onOptionPointerDown(event) {
    pointerSeen = true;
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
    // A touch tap is identified by its short travel, not hit testing: closing
    // the iOS keyboard can move the option before pointerup. Mouse/pen use the
    // real hit target because pointer capture can retain the pressed element.
    const landed = event.pointerType === 'touch' || typeof doc.elementFromPoint !== 'function'
      || pressedOption.contains(hit);
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
  function onDismiss() { close({ focus: true }); }
  function closeIfHidden() {
    if (wrapper.closest('[hidden], [aria-hidden="true"], details:not([open])')) close();
    // Fieldset disabling affects the native select without changing its own attributes.
    sync();
  }
  trigger.addEventListener('click', onTriggerClick);
  trigger.addEventListener('focus', open);
  arrow.addEventListener('click', onArrowClick);
  dismiss?.addEventListener('click', onDismiss); backdrop?.addEventListener('click', onDismiss);
  search.addEventListener('input', onSearchInput); search.addEventListener('change', onSearchChange);
  search.addEventListener('beforeinput', onSearchEditStart); search.addEventListener('compositionstart', onSearchEditStart);
  const blockEditing = event => event.preventDefault();
  const editEvents = ['beforeinput','paste','cut','drop'];
  if (selectionOnly) editEvents.forEach(name=>search.addEventListener(name,blockEditing));
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
      trigger.removeEventListener('click', onTriggerClick); trigger.removeEventListener('focus', open);
      arrow.removeEventListener('click', onArrowClick);
      dismiss?.removeEventListener('click', onDismiss); backdrop?.removeEventListener('click', onDismiss);
      search.removeEventListener('input', onSearchInput); search.removeEventListener('change', onSearchChange);
      search.removeEventListener('beforeinput', onSearchEditStart); search.removeEventListener('compositionstart', onSearchEditStart);
      if (selectionOnly) editEvents.forEach(name=>search.removeEventListener(name,blockEditing));
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

export function bindSearchableFilterSelects(container, options = {}) {
  const pickers = [];
  function close() { for (const picker of pickers) picker.close(); }
  for (const select of container.querySelectorAll('select')) {
    if (enhanced.has(select)) continue;
    const picker = createPicker(select, close, options);
    enhanced.set(select, picker); pickers.push(picker);
  }
  return Object.freeze({ sync() { for (const picker of pickers) picker.sync(); }, close, destroy() { for (const picker of pickers) picker.destroy(); } });
}
