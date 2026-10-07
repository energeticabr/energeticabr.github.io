import {buildPendingWorkDiariesReport} from '../chat/pending-work-diaries-report-model.js';
import {provisionDateKey} from '../chat/pending-provision-dates.js';

const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const COLUMNS = [['ID', 10], ['DATA', 20], ['FILIAL', 50], ['STATUS', 20]];
const displayDate = value => {
  const key = provisionDateKey(value);
  return key ? `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}` : value || '—';
};

export function createPendingWorkDiariesReportView({document:doc = globalThis.document, data, onClose = () => {}} = {}) {
  if (!doc?.body || typeof data?.loadSnapshot !== 'function' || typeof onClose !== 'function') {
    throw new TypeError('O relatório requer documento e sessão SharePoint.');
  }
  const win = doc.defaultView;
  const make = (tag, className = '', text) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, className, text) => {
    const node = make('button', className, text);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    return node;
  };
  const root = make('div', 'pwdr-overlay');
  root.hidden = true;
  root.setAttribute('aria-busy', 'false');
  const panel = make('section', 'pwdr-dialog');
  panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Diários de obras pendentes');
  const warning = make('p', 'pwdr-orientation', 'PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');
  warning.setAttribute('role', 'status');
  const report = make('div', 'pwdr-report');
  const toolbar = make('div', 'pwdr-toolbar');
  const refresh = button('Atualizar diários de obras pendentes', 'pwdr-refresh', '⟳');
  const dismiss = button('Fechar relatório', 'pwdr-close', '×');
  const content = make('div', 'pwdr-content');
  content.tabIndex = 0;
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', 'Diários de obras pendentes e contagem');
  toolbar.append(refresh);
  report.append(toolbar, content);
  panel.append(warning, report, dismiss);
  root.append(panel);
  doc.body.append(root);

  let loaded = null, controller = null, revision = 0, destroyed = false;
  let returnFocus = null, oldOverflow = '', app = null, oldInert = false;
  const portrait = () => win?.matchMedia ? win.matchMedia('(orientation: portrait)').matches : win?.innerHeight > win?.innerWidth;
  function cancel() {
    controller?.abort();
    controller = null;
    revision++;
  }
  function clearContent() {
    if (content.contains(doc.activeElement)) panel.focus({preventScroll:true});
    content.replaceChildren();
  }
  function render() {
    clearContent();
    const brand = make('div', 'pwdr-brand'), logo = make('img');
    logo.src = LOGO;
    logo.alt = 'Energética Construtora';
    brand.append(logo);
    const table = make('table', 'pwdr-table');
    table.setAttribute('aria-label', 'Diários de obras pendentes');
    const cols = make('colgroup'), head = make('thead'), header = make('tr'), body = make('tbody'), foot = make('tfoot');
    for (const [label, width] of COLUMNS) {
      const col = make('col');
      col.style.width = `${width}%`;
      cols.append(col);
      const th = make('th', '', label);
      th.scope = 'col';
      header.append(th);
    }
    head.append(header);
    for (const row of loaded.rows) {
      const tr = make('tr');
      tr.dataset.diaryId = String(row.id);
      tr.append(make('td', 'pwdr-id', String(row.id)), make('td', 'pwdr-date', displayDate(row.date)),
        make('td', 'pwdr-branch', row.branch || '—'), make('td', 'pwdr-status', row.status));
      body.append(tr);
    }
    const footerRow = make('tr'), label = make('td', 'pwdr-count-label', 'CONTAGEM DE PENDENTES:');
    label.colSpan = 3;
    const total = make('td', 'pwdr-count');
    total.append(make('strong', '', loaded.countLabel));
    footerRow.append(label, total);
    foot.append(footerRow);
    table.append(cols, head, body, foot);
    content.append(brand, table);
  }
  async function load() {
    if (root.hidden || portrait() || destroyed) return;
    cancel();
    const current = revision, active = new AbortController();
    controller = active;
    loaded = null;
    clearContent();
    content.append(make('p', 'pwdr-notice', 'Carregando diários do SharePoint…'));
    root.setAttribute('aria-busy', 'true');
    refresh.disabled = true;
    const stale = () => active.signal.aborted || current !== revision || root.hidden || destroyed;
    try {
      const snapshot = await data.loadSnapshot({signal:active.signal});
      if (stale()) return;
      loaded = buildPendingWorkDiariesReport(snapshot);
      render();
    } catch {
      if (stale()) return;
      loaded = null;
      clearContent();
      const message = make('p', 'pwdr-notice', 'Não foi possível carregar os diários de obras pendentes.');
      message.setAttribute('role', 'alert');
      const retry = button('Tentar novamente', 'pwdr-retry', 'Tentar novamente');
      retry.addEventListener('click', () => void load());
      content.append(message, retry);
    } finally {
      if (!stale()) {
        controller = null;
        refresh.disabled = false;
        root.setAttribute('aria-busy', 'false');
      }
    }
  }
  function orientationChanged() {
    if (root.hidden || destroyed) return;
    const vertical = portrait(), wasHidden = report.hidden;
    warning.hidden = !vertical;
    panel.classList.toggle('pwdr-portrait', vertical);
    if (vertical) {
      if (report.contains(doc.activeElement)) panel.focus({preventScroll:true});
      cancel();
      if (!loaded) clearContent();
      report.hidden = true;
      root.setAttribute('aria-busy', 'true');
      refresh.disabled = false;
    } else if (wasHidden) {
      report.hidden = false;
      if (loaded) root.setAttribute('aria-busy', 'false');
      else void load();
    }
  }
  function close() {
    if (root.hidden) return;
    cancel();
    loaded = null;
    root.hidden = true;
    root.setAttribute('aria-busy', 'false');
    refresh.disabled = false;
    content.replaceChildren();
    doc.body.style.overflow = oldOverflow;
    if (app) app.inert = oldInert;
    const target = returnFocus?.isConnected ? returnFocus : doc.querySelector('[data-action="open-pending-work-diaries-report"]:not(:disabled)') || app;
    returnFocus = null;
    target?.focus?.();
    onClose();
  }
  root.addEventListener('click', event => {if (event.target === root) close();});
  root.addEventListener('keydown', event => {
    if (root.hidden) return;
    if (event.key === 'Escape') {event.preventDefault(); close(); return;}
    if (event.key !== 'Tab') return;
    const nodes = [...panel.querySelectorAll('button,input,select,[tabindex="0"]')]
      .filter(node => !node.disabled && !node.closest('[hidden]') && node.tabIndex >= 0);
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && (doc.activeElement === first || doc.activeElement === panel)) {event.preventDefault(); last?.focus();}
    else if (!event.shiftKey && (doc.activeElement === last || doc.activeElement === panel)) {event.preventDefault(); first?.focus();}
  });
  refresh.addEventListener('click', () => void load());
  dismiss.addEventListener('click', close);
  win?.addEventListener('resize', orientationChanged);
  win?.addEventListener('orientationchange', orientationChanged);

  return Object.freeze({
    element:root,
    async open() {
      if (destroyed) throw new Error('O relatório foi encerrado.');
      if (!root.hidden) return;
      returnFocus = doc.activeElement;
      oldOverflow = doc.body.style.overflow;
      app = doc.getElementById('app');
      oldInert = app?.inert || false;
      doc.body.style.overflow = 'hidden';
      if (app) app.inert = true;
      root.hidden = false;
      const vertical = portrait();
      warning.hidden = !vertical;
      report.hidden = vertical;
      panel.classList.toggle('pwdr-portrait', vertical);
      root.setAttribute('aria-busy', String(vertical));
      panel.focus();
      content.scrollTop = 0;
      if (!vertical) await load();
    },
    close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      close();
      win?.removeEventListener('resize', orientationChanged);
      win?.removeEventListener('orientationchange', orientationChanged);
      root.remove();
    },
  });
}
