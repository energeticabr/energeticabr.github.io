const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const GROUPS = [
  ['finance', 'FINANCEIRO / COMPRAS', [['dueToday', 'VENCIMENTOS HOJE'], ['overdue', 'PGTOS VENCIDOS'],
    ['auditOrders', 'PEDIDOS PEND. AUDITORIA'], ['quotes', 'ORÇAMENTOS PENDENTES']]],
  ['documents', 'DOCUMENTOS', [['documents', 'DOCUMENTOS PENDENTES']]],
  ['tasks', 'TAREFAS', [['pendingTasks', 'TAREFAS PENDENTES'], ['delegatedTasks', 'DELEGADAS PENDENTES']]],
  ['works', 'OBRAS / RH', [['activeContracts', 'CONTRATOS ATIVOS'], ['pendingPayments', 'VALOR TOTAL PEND. PGTO'],
    ['pendingDiaries', 'DIÁRIOS DE OBRA PENDENTES']]],
  ['commercial', 'COMERCIAL', [['commercialDocuments', 'DOCUMENTOS PENDENTES'], ['activePathologies', 'PATOLOGIAS ATIVAS']]],
];
const COUNTS = new Intl.NumberFormat('pt-BR', {maximumFractionDigits:0});
const MONEY = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
const dateText = date => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const cancelled = () => new DOMException('Consulta cancelada.', 'AbortError');

function captureSnapshot(value) {
  if (!value?.metrics || !Array.isArray(value.warnings) ||
      value.warnings.some(warning => typeof warning !== 'string' || !warning.trim()) ||
      typeof value.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.today) ||
      !Number.isFinite(Date.parse(value.today)) || new Date(value.today).toISOString().slice(0, 10) !== value.today ||
      typeof value.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.updatedAt) ||
      !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Resumo incompleto.');
  const metrics = {};
  for (const [, , cards] of GROUPS) for (const [name] of cards) {
    const raw = value.metrics[name];
    const metric = name === 'pendingPayments' && typeof raw === 'string' && /^-?\d+(?:\.\d+)?$/.test(raw)
      ? Number(raw) : raw;
    if (!Object.hasOwn(value.metrics, name) || (metric === null ? !value.warnings.length
      : typeof metric !== 'number' || !Number.isFinite(metric) ||
        (name !== 'pendingPayments' && (metric < 0 || !Number.isSafeInteger(metric))))) throw new Error('Métrica indisponível sem aviso ou inválida.');
    metrics[name] = metric;
  }
  return {metrics, today:value.today, updatedAt:value.updatedAt, warnings:[...value.warnings]};
}

// Closing must settle our wait even when a provider ignores AbortSignal.
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(cancelled());
  let abort;
  const cancellation = new Promise((_, reject) => {
    abort = () => reject(cancelled()); signal.addEventListener('abort', abort, {once:true});
  });
  return Promise.race([promise, cancellation]).finally(() => signal.removeEventListener('abort', abort));
}

export function createGeneralSummaryReportView({document:doc = globalThis.document, data, onHome = () => {}, onClose = () => {}} = {}) {
  if (!doc?.body || typeof data?.loadReport !== 'function' || typeof onHome !== 'function' || typeof onClose !== 'function') {
    throw new TypeError('O resumo geral requer documento e fonte de dados.');
  }
  const make = (tag, className = '', text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const button = (className, label, text = label) => {
    const node = make('button', className, text); node.type = 'button'; node.setAttribute('aria-label', label); return node;
  };
  const root = make('div', 'pl-overlay gsr-overlay'); root.hidden = true; root.setAttribute('aria-busy', 'false');
  const panel = make('section', 'pl-dialog gsr-dialog'); panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Resumo geral');
  const report = make('div', 'pl-report gsr-report'), toolbar = make('div', 'gsr-toolbar');
  const home = button('gsr-home', 'Voltar ao menu inicial', 'Início');
  const refresh = button('pl-refresh gsr-refresh', 'Atualizar resumo geral', 'Atualizar');
  const dismiss = button('gsr-close', 'Fechar relatório', 'Fechar'); toolbar.append(home, refresh, dismiss);
  const notice = make('div', 'gsr-notice'); notice.hidden = true;
  const content = make('div', 'gsr-content'); content.tabIndex = 0;
  content.setAttribute('role', 'region'); content.setAttribute('aria-label', 'Indicadores do resumo geral');
  const brand = make('div', 'gsr-brand'), logo = make('img'); logo.src = LOGO; logo.alt = 'Logo Energética Construtora'; brand.append(logo);
  const title = make('h1', 'gsr-title', 'Resumo geral'), meta = make('p', 'gsr-meta'); meta.hidden = true;
  const warnings = make('div', 'gsr-warnings'); warnings.hidden = true; warnings.setAttribute('role', 'status');
  const dashboard = make('div', 'gsr-dashboard');
  const secondRow = make('div', 'gsr-row gsr-row--documents-tasks'), thirdRow = make('div', 'gsr-row gsr-row--works-commercial');
  const metrics = new Map();
  for (const [name, label, cards] of GROUPS) {
    const group = make('section', `gsr-group gsr-group--${name}`); group.setAttribute('aria-label', label);
    const list = make('dl', 'gsr-cards'); group.append(make('h2', 'gsr-group-title', label), list);
    for (const [key, caption] of cards) {
      const card = make('div', `gsr-card gsr-card--${key}`), value = make('dd', 'gsr-value', '—'); value.dataset.metric = key;
      const unavailable = make('p', 'gsr-unavailable', 'Indisponível'); unavailable.hidden = true;
      card.append(make('dt', 'gsr-label', caption), value, unavailable); list.append(card);
      metrics.set(key, {card, value, unavailable, caption});
    }
    if (name === 'finance') dashboard.append(group);
    else if (name === 'documents' || name === 'tasks') secondRow.append(group);
    else thirdRow.append(group);
  }
  dashboard.append(secondRow, thirdRow); content.append(brand, title, meta, warnings, dashboard);
  report.append(toolbar, notice, content); panel.append(report); root.append(panel); doc.body.append(root);

  let snapshot = null, controller = null, loadPromise = null, revision = 0, destroyed = false, printRestore = null;
  let returnFocus = null, oldOverflow = '', app = null, oldInert = false;
  function render() {
    for (const [name, {card, value, unavailable, caption}] of metrics) {
      const metric = snapshot?.metrics[name];
      value.textContent = metric == null ? '—' : name === 'pendingPayments' ? MONEY.format(metric) : COUNTS.format(metric);
      value.setAttribute('aria-label', `${caption}: ${snapshot ? metric === null ? 'indisponível' : value.textContent : 'não carregado'}`);
      unavailable.hidden = !snapshot || metric !== null;
      card.dataset.state = !snapshot ? 'loading' : metric === null ? 'unavailable' : metric > 0 ? 'positive' : 'zero';
    }
    meta.replaceChildren(); meta.hidden = !snapshot;
    warnings.replaceChildren(); warnings.hidden = !snapshot?.warnings.length;
    if (snapshot) {
      const time = make('time', '', new Date(snapshot.updatedAt).toLocaleString('pt-BR')); time.dateTime = snapshot.updatedAt;
      meta.append(doc.createTextNode(`Referência: ${dateText(snapshot.today)} · Atualizado em `), time);
      for (const warning of snapshot.warnings) warnings.append(make('p', '', warning));
    }
  }
  function showNotice(message = '', failed = false) {
    if (notice.contains(doc.activeElement)) panel.focus({preventScroll:true});
    notice.replaceChildren(); notice.hidden = !message; notice.setAttribute('role', failed ? 'alert' : 'status');
    if (!message) return;
    notice.append(make('p', '', message));
    if (failed) {
      const retry = button('gsr-retry', 'Tentar novamente'); retry.addEventListener('click', () => void load()); notice.append(retry);
    }
  }
  function invalidate() {printRestore?.(); revision++;}
  function cancel() {controller?.abort(); controller = null; loadPromise = null;}
  function load() {
    if (destroyed || root.hidden) return Promise.resolve();
    if (loadPromise) return loadPromise;
    invalidate(); const current = revision, active = new AbortController(); controller = active;
    const top = content.scrollTop, left = content.scrollLeft;
    snapshot = null; render(); showNotice('Carregando resumo geral…'); root.setAttribute('aria-busy', 'true');
    const stale = () => destroyed || root.hidden || active.signal.aborted || current !== revision;
    const pending = (async () => {
      try {
        const loaded = await abortable(Promise.resolve().then(() => {
          if (active.signal.aborted) throw cancelled();
          return data.loadReport({signal:active.signal});
        }), active.signal);
        if (stale()) return;
        snapshot = captureSnapshot(loaded); render(); showNotice(); content.scrollTop = top; content.scrollLeft = left;
      } catch {
        if (!stale()) {snapshot = null; render(); showNotice('Não foi possível carregar o resumo geral. Use Atualizar para tentar novamente.', true);}
      } finally {
        if (!stale()) {controller = null; loadPromise = null; root.setAttribute('aria-busy', 'false');}
      }
    })();
    loadPromise = pending; return pending;
  }
  function close() {
    if (root.hidden) return;
    invalidate(); cancel(); root.hidden = true; snapshot = null; render(); showNotice(); root.setAttribute('aria-busy', 'false');
    doc.body.style.overflow = oldOverflow; if (app) app.inert = oldInert;
    const target = returnFocus?.isConnected ? returnFocus : doc.querySelector('[data-action="open-general-summary-report"]:not(:disabled)') || app;
    returnFocus = null; target?.focus?.({preventScroll:true}); onClose();
  }
  function containFocus(event) {
    if (root.hidden || destroyed || root.contains(event.target)) return;
    if (event.target.closest?.('dialog[open],[role="dialog"][aria-modal="true"]')) return;
    panel.focus({preventScroll:true});
  }
  async function preparePrint() {
    printRestore?.();
    const current = revision, pending = loadPromise;
    if (pending) {
      await pending;
      // Let open()'s callers finish any queued session changes before capture.
      await Promise.resolve();
    }
    if (destroyed || root.hidden || !root.isConnected || current !== revision || !snapshot || controller || loadPromise) {
      throw new Error('O resumo geral ainda não está pronto para impressão.');
    }
    const top = content.scrollTop, left = content.scrollLeft, focus = doc.activeElement;
    let restored = false;
    const restore = () => {
      if (restored) return; restored = true; if (printRestore === restore) printRestore = null;
      if (destroyed || root.hidden || current !== revision) return;
      content.scrollTop = top; content.scrollLeft = left;
      if (focus?.isConnected && root.contains(focus) && !focus.closest('[hidden]')) focus.focus({preventScroll:true});
    };
    printRestore = restore; return restore;
  }
  refresh.addEventListener('click', () => void load()); dismiss.addEventListener('click', close);
  home.addEventListener('click', () => {if (!root.hidden) {close(); onHome();}});
  root.addEventListener('click', event => {if (event.target === root) close();});
  root.addEventListener('keydown', event => {
    if (root.hidden || event.defaultPrevented) return;
    if (event.key === 'Escape') {event.preventDefault(); close(); return;}
    if (event.key !== 'Tab') return;
    const nodes = [...panel.querySelectorAll('button,input,select,[tabindex="0"]')]
      .filter(node => !node.disabled && !node.closest('[hidden]') && node.tabIndex >= 0);
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && (doc.activeElement === first || doc.activeElement === panel)) {event.preventDefault(); last?.focus({preventScroll:true});}
    else if (!event.shiftKey && (doc.activeElement === last || doc.activeElement === panel)) {event.preventDefault(); first?.focus({preventScroll:true});}
  });
  doc.addEventListener('focusin', containFocus); render();
  return Object.freeze({element:root, async open() {
    if (destroyed) throw new Error('O relatório foi encerrado.');
    if (!root.hidden) {await loadPromise; return;}
    returnFocus = doc.activeElement; oldOverflow = doc.body.style.overflow; app = doc.getElementById('app'); oldInert = app?.inert || false;
    doc.body.style.overflow = 'hidden'; if (app) app.inert = true;
    root.hidden = false; content.scrollTop = 0; content.scrollLeft = 0; panel.focus({preventScroll:true}); await load();
  }, close, preparePrint, destroy() {
    if (destroyed) return;
    close(); destroyed = true; invalidate(); cancel(); doc.removeEventListener('focusin', containFocus); root.remove();
  }});
}
