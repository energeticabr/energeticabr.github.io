const viewportContents = new WeakMap();

/** Local viewers zoom their contents; only the embedded report needs page zoom. */
export function setAppPageZoomEnabled(documentRef, enabled) {
  const viewport = documentRef?.querySelector?.('meta[name="viewport"]');
  if (!viewport) return;
  if (!viewportContents.has(viewport)) viewportContents.set(viewport, viewport.content);
  const original = viewportContents.get(viewport);
  viewport.content = [
    ...original.split(',').map(value => value.trim()).filter(value => value && !/^(initial-scale|minimum-scale|maximum-scale|user-scalable)\s*=/i.test(value)),
    'initial-scale=1', 'minimum-scale=1', enabled ? 'maximum-scale=5' : 'maximum-scale=1',
  ].join(', ');
}

/** Prevent page magnification without consuming clicks, one-finger scrolling,
 * or the PDF/photo/signature viewers' own pointer/touch zoom controllers. */
export function installAppZoomGuard(documentRef = globalThis.document) {
  if (!documentRef?.addEventListener) return () => {};
  setAppPageZoomEnabled(documentRef, false);
  const view = documentRef.defaultView;
  const raisedFonts = new WeakMap();
  const inputSelector = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea, [contenteditable="true"]';
  const mobileInput = () => view?.matchMedia?.('(pointer: coarse), (hover: none), (max-width: 1024px)').matches
    ?? (view?.innerWidth <= 1024);
  const ensureReadableInput = input => {
    if (!input?.matches?.(inputSelector)) return;
    if (raisedFonts.has(input)) {
      const { value, priority } = raisedFonts.get(input);
      if (input.style.getPropertyValue('font-size') === '16px' && input.style.getPropertyPriority('font-size') === 'important') {
        if (value) input.style.setProperty('font-size', value, priority);
        else input.style.removeProperty('font-size');
      }
      raisedFonts.delete(input);
    }
    if (!mobileInput()) return;
    // Only raise small fields. A global 16px rule would shrink the larger
    // existing form text. Repair before focus to avoid iPhone focus zoom.
    if (parseFloat(view?.getComputedStyle?.(input).fontSize) < 16) {
      raisedFonts.set(input, { value: input.style.getPropertyValue('font-size'), priority: input.style.getPropertyPriority('font-size') });
      input.style.setProperty('font-size', '16px', 'important');
    }
  };
  const scanInputs = root => {
    ensureReadableInput(root);
    root?.querySelectorAll?.(inputSelector).forEach(ensureReadableInput);
  };
  const beforeInputFocus = event => ensureReadableInput(event.target);
  const onResize = () => scanInputs(documentRef);
  scanInputs(documentRef);
  const observer = view?.MutationObserver ? new view.MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) scanInputs(node);
  }) : null;
  observer?.observe(documentRef, { childList: true, subtree: true });
  documentRef.addEventListener('pointerdown', beforeInputFocus, true);
  documentRef.addEventListener('focus', beforeInputFocus, true);
  view?.addEventListener?.('resize', onResize);
  const options = { passive: false };
  const inReport = event => Boolean(event.target?.closest?.('.powerbi-dashboard__frame-wrap'));
  const preventPageGesture = event => {
    if (!inReport(event)) event.preventDefault();
  };
  const preventPagePinch = event => {
    if (event.touches?.length > 1) preventPageGesture(event);
  };
  documentRef.addEventListener('gesturestart', preventPageGesture, options);
  documentRef.addEventListener('gesturechange', preventPageGesture, options);
  documentRef.addEventListener('touchstart', preventPagePinch, options);
  documentRef.addEventListener('touchmove', preventPagePinch, options);
  return () => {
    observer?.disconnect();
    documentRef.removeEventListener('pointerdown', beforeInputFocus, true);
    documentRef.removeEventListener('focus', beforeInputFocus, true);
    view?.removeEventListener?.('resize', onResize);
    documentRef.removeEventListener('gesturestart', preventPageGesture);
    documentRef.removeEventListener('gesturechange', preventPageGesture);
    documentRef.removeEventListener('touchstart', preventPagePinch);
    documentRef.removeEventListener('touchmove', preventPagePinch);
  };
}
