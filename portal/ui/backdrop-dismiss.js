export function bindBackdropDismiss(layer, dismiss, isBackdrop = event => event.target === layer) {
  let startedOnBackdrop = false;
  layer.addEventListener('pointerdown', event => {
    startedOnBackdrop = isBackdrop(event);
  }, true);
  layer.addEventListener('click', event => {
    // A drag from the panel to its backdrop can click their common ancestor.
    const shouldDismiss = (event.detail === 0 || startedOnBackdrop) && isBackdrop(event);
    startedOnBackdrop = false;
    if (!shouldDismiss) return;
    event.stopPropagation();
    dismiss();
  });
}
