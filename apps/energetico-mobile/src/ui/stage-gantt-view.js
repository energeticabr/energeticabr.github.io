import { buildStageGantt } from '../chat/stage-progress-model.js';
import { calendarDays, formatOperationsDate } from '../chat/operations-reports-model.js';
import { addReportCloseControl } from './report-close-control.js';

const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const monthStart = day => `${day.slice(0, 7)}-01`;
const isoDay = date => date.toISOString().slice(0, 10);

export function createStageGanttView({ document: doc = globalThis.document, data, now = () => new Date() } = {}) {
  const make = (tag, className = '', text = '') => {
    const node = doc.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const button = (text, label = text) => {
    const node = make('button', '', text);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    return node;
  };

  const root = make('div', 'gantt-overlay');
  root.hidden = true;
  const dialog = make('section', 'gantt-dialog');
  dialog.tabIndex = -1;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'GANTT');
  const title = make('h2', '', 'GANTT');
  const tools = make('div', 'gantt-tools');
  const branchLabel = make('label', '', 'Filial');
  const branches = make('select');
  branches.disabled = true;
  branchLabel.append(branches);
  const todayButton = button('Hoje', 'Ir para hoje na linha do tempo');
  todayButton.hidden = true;
  const refresh = button('⟳', 'Atualizar GANTT');
  tools.append(title, branchLabel, todayButton, refresh);
  const legend = make('div', 'gantt-legend');
  legend.append(make('span', 'gantt-legend--ongoing', 'Em andamento'), make('span', 'gantt-legend--finished', 'Finalizada'));
  const notice = make('p', 'gantt-notice');
  notice.setAttribute('role', 'status');
  const scroll = make('div', 'gantt-scroll');
  scroll.tabIndex = 0;
  scroll.hidden = true;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Linha do tempo de etapas e atividades');
  dialog.append(tools, legend, notice, scroll);
  root.append(dialog);
  doc.body.append(root);
  addReportCloseControl({ root, toolbar: tools, onClose: close });

  let request, previousFocus, previousOverflow, previousInert, app;
  let stages = [], today = '', todayRatio = null;
  const announce = message => { notice.textContent = message; notice.hidden = !message; };

  function render() {
    const visible = stages.filter(stage => !branches.value || stage.branch === branches.value);
    scroll.replaceChildren();
    scroll.scrollLeft = scroll.scrollTop = 0;
    scroll.hidden = !visible.length;
    announce(visible.length ? '' : 'Nenhuma etapa disponível.');
    todayButton.hidden = true;
    if (!visible.length) return;

    let first = '', last = '';
    const include = row => {
      if (!row.range) return;
      if (!first || row.range.start < first) first = row.range.start;
      if (row.range.end > last) last = row.range.end;
    };
    for (const stage of visible) {
      include(stage);
      stage.children.forEach(include);
    }
    const start = monthStart(first || today);
    const end = monthStart(last || today);
    const months = [];
    const cursor = new Date(`${start}T00:00:00Z`);
    while (isoDay(cursor) <= end) {
      const from = isoDay(cursor);
      const label = monthLabel.format(cursor).replace('. de ', ' ');
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      months.push({ label, days: calendarDays(from, isoDay(cursor)) });
    }
    const span = calendarDays(start, isoDay(cursor));
    const percent = days => `${(100 * days / span).toFixed(6)}%`;
    const sheet = make('div', 'gantt-sheet');
    sheet.style.setProperty('--gantt-width', `${span * 3}px`);
    const monthGrid = make('div', 'gantt-month-grid');
    monthGrid.setAttribute('aria-hidden', 'true');
    const axis = make('div', 'gantt-row gantt-axis');
    const axisLabels = make('div', 'gantt-axis-months');
    for (const { label, days } of months) {
      const gridLine = make('span');
      const month = make('span', '', label);
      gridLine.style.width = month.style.width = percent(days);
      monthGrid.append(gridLine);
      axisLabels.append(month);
    }
    todayRatio = today >= start && today < isoDay(cursor) ? (calendarDays(start, today) + .5) / span : null;
    if (todayRatio !== null) {
      const line = make('span', 'gantt-today-line');
      line.style.left = `${todayRatio * 100}%`;
      monthGrid.append(line);
      todayButton.hidden = false;
    }
    axis.append(make('div', 'gantt-label', 'Etapa / atividade'), axisLabels);
    sheet.append(monthGrid, axis);

    function renderRow(item, parent) {
      const row = make('div', `gantt-row gantt-row--${parent ? 'stage' : 'activity'}`);
      const label = make('div', 'gantt-label');
      const text = make('div', 'gantt-row-text');
      const info = parent ? item.branch : [item.property, item.supplier].filter(Boolean).join(' · ');
      const startText = formatOperationsDate(item.start);
      const endText = item.range?.throughToday ? `Hoje (${formatOperationsDate(today)})` : formatOperationsDate(item.end);
      const dates = `Início ${startText} · Fim ${endText}`;
      text.append(make(parent ? 'strong' : 'span', 'gantt-name', item.name));
      if (info) text.append(make('small', '', info));
      text.append(make('small', '', dates));
      label.append(text);
      const track = make('div', 'gantt-track');
      if (item.range) {
        const { start: from, end: to, tone } = item.range;
        const days = calendarDays(from, to) + 1;
        const bar = make('div', 'gantt-bar', days === 1 ? '1 dia' : `${days} dias`);
        const status = tone === 'finished' ? 'Finalizada' : 'Em andamento';
        const description = `${item.name} · ${status} · ${dates} · ${bar.textContent}`;
        bar.dataset.tone = tone;
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', description);
        bar.title = description;
        bar.style.left = percent(calendarDays(start, from));
        bar.style.width = percent(days);
        track.append(bar);
      }
      row.append(label, track);
      return row;
    }

    for (const stage of visible) {
      const row = renderRow(stage, true);
      sheet.append(row);
      if (!stage.children.length) continue;
      const toggleLabel = `${stage.name}${stage.branch ? ` · ${stage.branch}` : ''}`;
      const toggle = button('+', `Expandir ${toggleLabel}`);
      toggle.className = 'gantt-toggle';
      toggle.setAttribute('aria-expanded', 'false');
      row.firstElementChild.prepend(toggle);
      let childRows = [];
      toggle.addEventListener('click', () => {
        const expand = toggle.getAttribute('aria-expanded') === 'false';
        toggle.setAttribute('aria-expanded', String(expand));
        toggle.setAttribute('aria-label', `${expand ? 'Recolher' : 'Expandir'} ${toggleLabel}`);
        toggle.textContent = expand ? '−' : '+';
        if (expand) {
          childRows = stage.children.map(child => renderRow(child, false));
          row.after(...childRows);
        } else {
          for (const child of childRows) child.remove();
          childRows = [];
        }
      });
    }
    scroll.append(sheet);
    const firstStageStart = visible.find(stage => stage.range)?.range.start || first;
    if (firstStageStart) scroll.scrollLeft = axisLabels.clientWidth * calendarDays(start, monthStart(firstStageStart)) / span;
  }

  async function load(force = false) {
    request?.abort();
    const active = new AbortController();
    request = active;
    scroll.hidden = true;
    scroll.replaceChildren();
    todayButton.hidden = true;
    const refreshWasFocused = doc.activeElement === refresh;
    if (refreshWasFocused) dialog.focus({ preventScroll: true });
    branches.disabled = refresh.disabled = true;
    announce('Carregando etapas e atividades…');
    try {
      const snapshot = await data.loadSnapshot({ signal: active.signal, refresh: force });
      if (active.signal.aborted) return;
      today = localDay(now());
      stages = buildStageGantt(snapshot, today);
      const selected = branches.value;
      const options = [...new Set(stages.map(stage => stage.branch).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      branches.replaceChildren(new doc.defaultView.Option('Todas', ''), ...options.map(name => new doc.defaultView.Option(name, name)));
      branches.value = options.includes(selected) ? selected : '';
      branches.disabled = options.length === 0;
      render();
    } catch {
      if (!active.signal.aborted) announce('Não foi possível carregar as etapas e atividades. Use Atualizar para tentar novamente.');
    } finally {
      if (!active.signal.aborted) {
        refresh.disabled = false;
        if (refreshWasFocused && doc.activeElement === dialog) refresh.focus({ preventScroll: true });
      }
    }
  }

  function close() {
    if (root.hidden) return;
    request?.abort();
    root.hidden = true;
    scroll.replaceChildren();
    stages = [];
    doc.body.style.overflow = previousOverflow;
    if (app) app.inert = previousInert;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    else doc.querySelector('[data-action="open-stage-gantt"]:not(:disabled)')?.focus();
  }

  branches.addEventListener('change', render);
  refresh.addEventListener('click', () => { void load(true); });
  todayButton.addEventListener('click', () => {
    const axis = scroll.querySelector('.gantt-axis-months');
    if (!axis || todayRatio === null) return;
    const timelineViewport = scroll.clientWidth - scroll.querySelector('.gantt-label').offsetWidth;
    scroll.scrollLeft = axis.clientWidth * todayRatio - timelineViewport / 2;
  });
  root.addEventListener('click', event => { if (event.target === root) close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const nodes = [...dialog.querySelectorAll('button,select,[tabindex="0"]')].filter(node => !node.disabled && !node.closest('[hidden]'));
    const edge = event.shiftKey ? nodes[0] : nodes.at(-1);
    if (doc.activeElement === edge || doc.activeElement === dialog) {
      event.preventDefault();
      (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
    }
  });

  return {
    element: root,
    open() {
      if (!root.hidden) return;
      previousFocus = doc.activeElement;
      previousOverflow = doc.body.style.overflow;
      app = doc.getElementById('app');
      previousInert = app?.inert || false;
      if (app) app.inert = true;
      doc.body.style.overflow = 'hidden';
      root.hidden = false;
      dialog.focus();
      return load();
    },
    close,
    destroy() { close(); root.remove(); },
  };
}
