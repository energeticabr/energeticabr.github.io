import { buildStageGantt } from '../chat/stage-progress-model.js';
import { calendarDays, formatOperationsDate } from '../chat/operations-reports-model.js';
import { addReportCloseControl } from './report-close-control.js';
import { bindReportLandscape } from './report-landscape.js';
import { createStageGanttDetailView } from './stage-gantt-detail-view.js';

const DEFAULT_BRANCH = '004 - EDIFÍCIO XAVANTE';
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
  const landscape = bindReportLandscape(root);
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
  const detail = createStageGanttDetailView({ root, background: dialog, data });

  let request, previousFocus, previousOverflow, previousInert, app;
  let stages = [], today = '', todayRatio = null;
  const announce = message => { notice.textContent = message; notice.hidden = !message; };
  const durationObserver = doc.defaultView.ResizeObserver ? new doc.defaultView.ResizeObserver(layoutDurations) : null;
  doc.defaultView.addEventListener('resize', layoutDurations);
  doc.fonts?.ready.then(layoutDurations);

  function layoutDurations() {
    if (root.hidden) return;
    const measurements = [...scroll.querySelectorAll('.gantt-bar')].map(bar => {
      const start = bar.querySelector('.gantt-bar-date--start');
      const end = bar.querySelector('.gantt-bar-date--end');
      return { bar, width: bar.clientWidth, height: bar.offsetHeight, left: bar.offsetLeft, textWidth: bar.firstElementChild.offsetWidth,
        startWidth: start.offsetWidth, endWidth: end.offsetWidth,
        startHeight: start.offsetHeight, endHeight: end.offsetHeight };
    });
    for (const { bar, width, height, left, textWidth, startWidth, endWidth, startHeight, endHeight } of measurements) {
      bar.classList.toggle('gantt-bar--outside', textWidth + 8 > width);
      // Keep the centered duration clear of both endpoint dates.
      const below = width < 2 * Math.max(startWidth, endWidth) + textWidth + 24;
      const stacked = below && width < startWidth + endWidth + 8;
      bar.classList.toggle('gantt-bar--dates-below', below);
      bar.classList.toggle('gantt-bar--dates-stacked', stacked);
      bar.style.setProperty('--gantt-start-date-height', `${startHeight}px`);
      // A short bar at the beginning of the timeline must not put its end date under the sticky column.
      bar.style.setProperty('--gantt-end-date-left', `${Math.max(-left, width - endWidth)}px`);
      const dateSpace = below ? 4 + (stacked ? startHeight + 4 + endHeight : Math.max(startHeight, endHeight)) : 0;
      bar.parentElement.style.setProperty('--gantt-date-space', `${dateSpace}px`);
      bar.parentElement.style.setProperty('--gantt-bar-height', `${height}px`);
    }
    // Keep the last day's external labels reachable by horizontal scrolling.
    scroll.querySelector('.gantt-sheet')?.style.setProperty('--gantt-duration-space',
      `${Math.max(0, ...measurements.flatMap(item => [item.textWidth, item.startWidth, item.endWidth])) + 12}px`);
  }

  function render() {
    detail.close({ restoreFocus: false });
    durationObserver?.disconnect();
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
      const property = item.property?.trim() || '';
      const info = parent ? item.branch : property.toUpperCase() === 'TODOS' ? '' : property;
      const startText = formatOperationsDate(item.start);
      const endText = item.finished ? formatOperationsDate(item.end) : 'Em Andamento';
      const dates = `Início ${startText} · Fim ${endText}`;
      text.append(make('strong', 'gantt-name gantt-cluster gantt-cluster--description', item.name));
      if (info) text.append(make('small', '', info));
      if (item.supplier) {
        const responsible = make('span', 'gantt-cluster gantt-cluster--responsible', item.supplier);
        responsible.setAttribute('aria-label', `Responsável ${item.supplier}`);
        text.append(responsible);
      }
      const dateClusters = make('div', 'gantt-dates');
      const startCluster = make('span', 'gantt-cluster gantt-cluster--start', startText);
      const endCluster = make('span', 'gantt-cluster gantt-cluster--end', endText);
      startCluster.setAttribute('aria-label', `Início ${startText}`);
      endCluster.setAttribute('aria-label', `Fim ${endText}`);
      dateClusters.append(startCluster, endCluster);
      text.append(dateClusters);
      label.append(text);
      const track = make('div', 'gantt-track');
      if (item.range) {
        const { start: from, end: to, tone } = item.range;
        const days = calendarDays(from, to) + 1;
        const bar = button(days === 1 ? '1 dia' : `${days} dias`);
        bar.className = 'gantt-bar';
        const status = tone === 'finished' ? 'Finalizada' : 'Em andamento';
        const description = `${item.name} · ${status} · ${dates} · ${bar.textContent}`;
        const duration = make('span', 'gantt-duration', bar.textContent);
        const startDate = make('span', 'gantt-bar-date gantt-bar-date--start', formatOperationsDate(from));
        const endDate = make('span', 'gantt-bar-date gantt-bar-date--end',
          `${item.range.throughToday ? 'Até hoje ' : ''}${formatOperationsDate(to)}`);
        startDate.setAttribute('aria-label', `Início ${startDate.textContent}`);
        endDate.setAttribute('aria-label', item.range.throughToday ? endDate.textContent : `Fim ${endDate.textContent}`);
        bar.replaceChildren(duration, startDate, endDate);
        bar.dataset.tone = tone;
        bar.setAttribute('aria-label', description);
        bar.setAttribute('aria-haspopup', 'dialog');
        bar.addEventListener('click', () => { void detail.open(item, bar); });
        bar.title = description;
        bar.style.left = percent(calendarDays(start, from));
        bar.style.width = percent(days);
        track.append(bar);
        durationObserver?.observe(bar);
        for (const barLabel of bar.children) durationObserver?.observe(barLabel);
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
          for (const child of childRows) {
            const bar = child.querySelector('.gantt-bar');
            if (bar) {
              durationObserver?.unobserve(bar);
              for (const barLabel of bar.children) durationObserver?.unobserve(barLabel);
            }
            child.remove();
          }
          childRows = [];
        }
        layoutDurations();
      });
    }
    scroll.append(sheet);
    layoutDurations();
    const firstStageStart = visible.find(stage => stage.range)?.range.start || first;
    if (firstStageStart) scroll.scrollLeft = axisLabels.clientWidth * calendarDays(start, monthStart(firstStageStart)) / span;
  }

  async function load(force = false) {
    detail.close({ restoreFocus: false });
    durationObserver?.disconnect();
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
      const selected = branches.selectedIndex < 0 ? DEFAULT_BRANCH : branches.value;
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
    detail.close({ restoreFocus: false });
    request?.abort();
    root.hidden = true;
    durationObserver?.disconnect();
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
      branches.replaceChildren();
      root.hidden = false;
      landscape.update();
      dialog.focus();
      return load();
    },
    close,
    destroy() {
      close();
      durationObserver?.disconnect();
      doc.defaultView.removeEventListener('resize', layoutDurations);
      detail.destroy(); landscape.destroy(); root.remove();
    },
  };
}
