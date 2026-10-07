import {normalizeDelegatedDeadlineSnapshot, buildDelegatedDeadlineOverview} from '../chat/delegated-deadline-report-model.js';
import {provisionDateKey} from '../chat/pending-provision-dates.js';
import {bindSearchableFilterSelects} from './searchable-filter-selects.js';

const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const DEFAULT_STATUSES = ['ATIVIDADE CRIADA', 'EM ATENDIMENTO'];
const SELECTS = [
  ['association', 'ETAPA OBRA', 'associations'],
  ['difficulty', 'DIFICULDADE', 'difficulties'],
  ['priority', 'PRIORITÁRIA', 'priorities'],
  ['statuses', 'STATUS', 'statuses'],
];
const COLUMNS = [['👤 RESPONSÁVEL', 17], ['🆔 ID', 7], ['📅 DATA', 13], ['🏢 ASSOCIAÇÃO', 15], ['📝 TAREFA', 33], ['🚨 PRIORIDADE', 15]];
const date = value => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : '—';
const count = value => value.toLocaleString('pt-BR');

export function createDelegatedDeadlineReportView({document:doc = globalThis.document, data, now = () => new Date()} = {}) {
  if (!doc?.body || typeof data?.loadSnapshot !== 'function' || typeof now !== 'function') {
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
  const root = make('div', 'tdr-overlay');
  root.hidden = true;
  const panel = make('section', 'tdr-dialog');
  panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Atividades delegadas por prazo');
  const warning = make('p', 'tdr-orientation', 'PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');
  warning.setAttribute('role', 'status');
  const report = make('div', 'tdr-report');
  const toolbar = make('div', 'tdr-toolbar');
  const refresh = button('Atualizar atividades delegadas por prazo', 'tdr-refresh', '⟳');
  toolbar.append(refresh);
  const descriptionField = make('label', 'tdr-filter tdr-description');
  const description = make('input');
  description.type = 'search';
  description.name = 'description';
  description.setAttribute('aria-label', 'DESCRIÇÃO');
  descriptionField.append(make('span', 'tdr-filter-label', 'DESCRIÇÃO'), description);
  toolbar.append(descriptionField);
  const controls = new Map();
  for (const [name, label] of SELECTS) {
    const field = make('label', 'tdr-filter');
    const select = make('select');
    select.name = name;
    select.multiple = name === 'statuses';
    select.setAttribute('aria-label', label);
    field.append(make('span', 'tdr-filter-label', label), select);
    toolbar.append(field);
    controls.set(name, select);
  }
  const content = make('div', 'tdr-content');
  content.tabIndex = 0;
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', 'Indicadores e atividades delegadas por prazo');
  report.append(toolbar, content);
  panel.append(warning, report);
  root.append(panel);
  doc.body.append(root);

  let snapshot = null, controller = null, revision = 0, pickers = null, destroyed = false;
  let returnFocus = null, oldOverflow = '', app = null, oldInert = false;
  const portrait = () => win?.matchMedia ? win.matchMedia('(orientation: portrait)').matches : win?.innerHeight > win?.innerWidth;
  const today = () => provisionDateKey(now());
  const selected = () => ({
    description:description.value,
    association:controls.get('association').value,
    difficulty:controls.get('difficulty').value,
    priority:controls.get('priority').value,
    statuses:[...controls.get('statuses').selectedOptions].map(option => option.value).filter(Boolean),
  });

  function render() {
    if (content.contains(doc.activeElement)) panel.focus();
    content.replaceChildren();
    if (!snapshot) return;
    const result = buildDelegatedDeadlineOverview(snapshot, selected(), today());
    const brand = make('div', 'tdr-brand'), logo = make('img');
    logo.src = LOGO;
    logo.alt = 'Energética Construtora';
    brand.append(logo);
    content.append(brand);
    const cards = make('div', 'tdr-cards');
    for (const [name, label] of [['pending', '⏳ ATIVIDADES PENDENTES'], ['completed', '✅ ATIVIDADES CONCLUÍDAS'], ['total', '📊 TOTAL DE ATIVIDADES']]) {
      const card = make('div', `tdr-card tdr-metric-${name}`);
      card.dataset.metric = name;
      card.append(make('span', '', label), make('strong', '', String(result.metrics[name])));
      cards.append(card);
    }
    content.append(cards);
    if (result.limited) {
      const notice = make('p', 'tdr-limit', `Exibindo ${count(result.displayedCount)} de ${count(result.filteredCount)} atividades filtradas, da mais recente para a mais antiga. Os indicadores consideram todas as atividades.`);
      notice.setAttribute('role', 'status');
      content.append(notice);
    }
    if (!result.groups.length) {
      content.append(make('p', 'tdr-empty', 'Nenhuma atividade encontrada para os filtros selecionados.'));
      return;
    }
    for (const group of result.groups) {
      const article = make('article', 'tdr-group');
      const aside = make('div', 'tdr-deadline');
      aside.style.backgroundColor = group.color;
      const heading = make('span', '', '📅 DATA FATAL'), value = make('h2', '', group.dueDate ? date(group.dueDate) : 'SEM DATA');
      heading.style.color = group.borderColor;
      value.style.color = group.borderColor;
      const label = make('strong', 'tdr-due-label', group.dueLabel);
      label.style.color = group.borderColor;
      label.style.borderColor = group.borderColor;
      aside.append(heading, value, label);
      aside.append(make('strong', 'tdr-deadline-total', `TOTAL: ${group.total}`), make('span', '', `PENDENTES: ${group.pending}`));
      const wrap = make('div', 'tdr-table-wrap'), table = make('table', 'tdr-table');
      const cols = make('colgroup'), head = make('thead'), header = make('tr'), body = make('tbody'), foot = make('tfoot');
      table.setAttribute('aria-label', `Atividades com prazo ${group.dueDate ? date(group.dueDate) : 'não definido'}`);
      for (const [label, width] of COLUMNS) {
        const col = make('col');
        col.style.width = `${width}%`;
        cols.append(col);
        const th = make('th', '', label);
        th.scope = 'col';
        header.append(th);
      }
      head.append(header);
      for (const responsible of group.responsibles) {
        responsible.tasks.forEach((row, index) => {
          const tr = make('tr');
          tr.dataset.taskId = String(row.id);
          tr.style.backgroundColor = row.rowColor;
          if (index === 0) {
            const person = make('td', 'tdr-responsible', responsible.responsible || 'SEM RESPONSÁVEL');
            person.rowSpan = responsible.tasks.length;
            person.style.backgroundColor = responsible.color;
            tr.append(person);
          }
          tr.append(make('td', 'tdr-id', String(row.id)), make('td', 'tdr-created', date(row.createdDate)),
            make('td', 'tdr-association', row.association || '—'), make('td', 'tdr-task', row.description || '—'),
            make('td', 'tdr-priority', row.priority || '—'));
          body.append(tr);
        });
      }
      const footerRow = make('tr'), footer = make('td', '', `TOTAL DE ATIVIDADES NESTA DATA: ${group.total}`);
      footer.colSpan = COLUMNS.length;
      footerRow.append(footer);
      foot.append(footerRow);
      table.append(cols, head, body, foot);
      wrap.append(table);
      article.append(aside, wrap);
      content.append(article);
    }
  }

  function populate(reset = false) {
    const focusedSelect = [...controls.values()].find(node => node.nextElementSibling?.contains(doc.activeElement));
    if (focusedSelect) panel.focus();
    pickers?.destroy();
    pickers = null;
    const options = buildDelegatedDeadlineOverview(snapshot || {tasks:[]}, {statuses:[]}, today()).filterOptions;
    for (const [name, , optionField] of SELECTS) {
      const node = controls.get(name);
      const current = reset ? (name === 'statuses' ? DEFAULT_STATUSES : []) : [...node.selectedOptions].map(option => option.value).filter(Boolean);
      const values = [...new Set([...(options[optionField] || []), ...(name === 'statuses' ? [...DEFAULT_STATUSES, 'CONCLUÍDO'] : []), ...current])];
      node.replaceChildren(Object.assign(make('option', '', 'Todos'), {value:'', selected:!current.length}));
      for (const value of values) node.append(Object.assign(make('option', '', value), {value, selected:current.includes(value)}));
    }
    pickers = bindSearchableFilterSelects(toolbar, {placement:'below', report:true});
    if (focusedSelect && !root.hidden) {
      focusedSelect.nextElementSibling?.querySelector('.sfs-trigger')?.focus();
      pickers.close();
    }
  }

  async function load() {
    if (root.hidden || portrait() || destroyed) return;
    if (content.contains(doc.activeElement)) panel.focus();
    pickers?.close();
    controller?.abort();
    const current = ++revision, active = new AbortController();
    controller = active;
    snapshot = null;
    refresh.disabled = true;
    content.replaceChildren(make('p', 'tdr-notice', 'Carregando atividades do SharePoint…'));
    report.setAttribute('aria-busy', 'true');
    try {
      const result = await data.loadSnapshot({signal:active.signal});
      if (active.signal.aborted || current !== revision || root.hidden || destroyed) return;
      snapshot = normalizeDelegatedDeadlineSnapshot(result);
      populate();
      render();
    } catch {
      if (active.signal.aborted || current !== revision || root.hidden || destroyed) return;
      snapshot = null;
      const message = make('p', 'tdr-notice', 'Não foi possível carregar as atividades delegadas por prazo.');
      message.setAttribute('role', 'status');
      const retry = button('Tentar novamente', 'tdr-retry', 'Tentar novamente');
      retry.addEventListener('click', () => void load());
      content.replaceChildren(message, retry);
    } finally {
      if (current === revision) {
        refresh.disabled = false;
        report.setAttribute('aria-busy', 'false');
      }
    }
  }

  function orientationChanged() {
    if (root.hidden) return;
    const vertical = portrait();
    warning.hidden = !vertical;
    panel.classList.toggle('tdr-portrait', vertical);
    if (vertical) {
      pickers?.close();
      if (panel.contains(doc.activeElement)) panel.focus();
      controller?.abort();
      revision++;
      snapshot = null;
      content.replaceChildren();
      report.hidden = true;
      report.setAttribute('aria-busy', 'false');
      refresh.disabled = false;
    } else if (report.hidden) {
      report.hidden = false;
      void load();
    }
  }

  function close() {
    if (root.hidden) return;
    controller?.abort();
    revision++;
    snapshot = null;
    pickers?.close();
    content.replaceChildren();
    root.hidden = true;
    doc.body.style.overflow = oldOverflow;
    if (app) app.inert = oldInert;
    const target = returnFocus?.isConnected ? returnFocus : doc.querySelector('[data-action="open-delegated-deadline-report"]:not(:disabled)') || app;
    target?.focus?.();
    returnFocus = null;
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
  const filterChanged = () => {render(); content.scrollTop = 0;};
  for (const node of controls.values()) node.addEventListener('change', filterChanged);
  description.addEventListener('input', filterChanged);
  refresh.addEventListener('click', () => void load());
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
      description.value = '';
      populate(true);
      root.hidden = false;
      const vertical = portrait();
      warning.hidden = !vertical;
      report.hidden = vertical;
      panel.classList.toggle('tdr-portrait', vertical);
      panel.focus();
      content.scrollTop = 0;
      if (!vertical) await load();
    },
    close,
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      pickers?.destroy();
      win?.removeEventListener('resize', orientationChanged);
      win?.removeEventListener('orientationchange', orientationChanged);
      root.remove();
    },
  });
}
