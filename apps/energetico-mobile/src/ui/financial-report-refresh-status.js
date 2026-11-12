const states = {
  pending: { text:'ATUALIZAÇÃO EM ANDAMENTO', path:'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-2l3 4M18 17a7 7 0 0 1-11 2l-3-4' },
  success: { text:'SUCESSO EM ATUALIZAR', path:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM8 12l3 3 5-6' },
  error: { text:'ERRO AO ATUALIZAR', path:'M12 3 2 21h20L12 3Zm0 7v4m0 3h.01' },
};
const svgNamespace = 'http://www.w3.org/2000/svg';

export function createFinancialReportRefreshStatus(doc, { fiscal = false } = {}) {
  const element = doc.createElement('div');
  element.className = fiscal ? 'nfe-pair' : 'ddr-metric';
  element.dataset.reportRefreshStatus = '';
  element.dataset.reportScreenOnly = '';
  element.hidden = true;
  if (fiscal) {
    const term = doc.createElement('dt');
    term.className = 'financial-refresh-term';
    term.textContent = 'Status da atualização';
    element.append(term);
  }
  const value = doc.createElement(fiscal ? 'dd' : 'span');
  value.setAttribute('role', 'status');
  value.setAttribute('aria-atomic', 'true');
  const icon = doc.createElementNS(svgNamespace, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(svgNamespace, 'path');
  const label = doc.createElement('span');
  label.dataset.refreshStatusLabel = '';
  icon.append(path);
  value.append(icon, label);
  element.append(value);
  let sourceStatus, awaitingRead = false;

  function set(status) {
    if (!status || element.dataset.reportRefreshStatus === status) return;
    const { text, path:d } = states[status];
    element.dataset.reportRefreshStatus = status;
    element.hidden = false;
    path.setAttribute('d', d);
    label.textContent = text;
  }
  return {
    element, set,
    beginRead() { awaitingRead = true; set('pending'); },
    observe(state) {
      let next = state.refreshStatus;
      if (!('refreshStatus' in state)) {
        if (state.sourceRunning ?? state.running) next = 'pending';
        else if (sourceStatus === 'pending') {
          if (state.latest?.status === 'succeeded') next = 'success';
          else if (['failed', 'partial'].includes(state.latest?.status)) next = 'error';
        }
      }
      if (!next || next === sourceStatus) return;
      const wasPending = sourceStatus === 'pending';
      sourceStatus = next;
      awaitingRead = next === 'success' && wasPending;
      if (!awaitingRead) set(next);
    },
    finishRead(ok) {
      if (!awaitingRead) return;
      awaitingRead = false;
      set(ok ? 'success' : 'error');
    },
  };
}
