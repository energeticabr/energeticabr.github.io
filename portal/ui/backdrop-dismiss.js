const BACKDROP_TAP_TOLERANCE = 12;

export function bindBackdropDismiss(layer, dismiss, isBackdrop = event => event.target === layer
  && (event.detail === 0 || layer.ownerDocument.elementFromPoint(event.clientX, event.clientY) === layer)) {
  let start = null;
  layer.addEventListener('pointerdown', event => {
    start = isBackdrop(event) ? { x:event.clientX, y:event.clientY } : null;
  }, true);
  layer.addEventListener('pointercancel', () => { start = null; }, true);
  layer.addEventListener('click', event => {
    // Dragging can target a common ancestor or retain the pressed target through pointer capture.
    const tap = start && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= BACKDROP_TAP_TOLERANCE;
    const shouldDismiss = (event.detail === 0 || tap) && isBackdrop(event);
    start = null;
    if (!shouldDismiss) return;
    event.stopPropagation();
    dismiss();
  });
}
