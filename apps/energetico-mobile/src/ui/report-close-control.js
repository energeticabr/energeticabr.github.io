// Reserve toolbar space inside the report's existing (possibly rotated) dialog.
// The report continues to own backdrop/keyboard handling and close/destroy state.
export function addReportCloseControl({root, toolbar, onClose, button, inline = false}) {
  const doc = root.ownerDocument;
  const control = button || doc.createElement('button');
  const dialog = root.matches('[role="dialog"]') ? root : root.querySelector('[role="dialog"]');
  const label = control.getAttribute('aria-label') || `Fechar ${dialog?.getAttribute('aria-label') || 'relatório'}`;
  control.type = 'button'; control.classList.add('report-close-control');
  control.textContent = '❌'; control.setAttribute('aria-label', label); control.title = label;
  control.dataset.reportScreenOnly = '';
  if (inline) toolbar.append(control);
  else {
    const bar = doc.createElement('div'); bar.className = 'report-close-bar'; bar.dataset.reportScreenOnly = '';
    toolbar.before(bar); toolbar.classList.add('report-close-tools'); bar.append(toolbar, control);
  }
  control.addEventListener('click', onClose);
  return control;
}
