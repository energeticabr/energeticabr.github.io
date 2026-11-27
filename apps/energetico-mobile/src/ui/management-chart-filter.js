export function bindSvgChartOption(node, { key, label, selected, activate }) {
  node.dataset.chartOption = key;
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.setAttribute('aria-label', label);
  node.setAttribute('aria-pressed', String(selected));
  node.addEventListener('click', activate);
  node.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!event.repeat) activate();
  });
}

export function restoreChartOption(container, key) {
  const option = [...container.querySelectorAll('[data-chart-option]')]
    .find(node => node.dataset.chartOption === key);
  (option || container).focus({ preventScroll: true });
}
