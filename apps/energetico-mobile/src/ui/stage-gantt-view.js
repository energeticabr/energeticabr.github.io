import { buildStageGantt, canSuppressStage, STAGE_GANTT_HIDDEN, STAGE_GANTT_VISIBLE } from '../chat/stage-progress-model.js';
import { calendarDays, formatOperationsDate } from '../chat/operations-reports-model.js';
import { addReportCloseControl } from './report-close-control.js';
import { bindReportLandscape } from './report-landscape.js';
import { createStageGanttDetailView } from './stage-gantt-detail-view.js';
import { createStageGanttFinishView } from './stage-gantt-finish-view.js';

const DEFAULT_BRANCH = '004 - EDIFÍCIO XAVANTE';
const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const monthStart = day => `${day.slice(0, 7)}-01`;
const isoDay = date => date.toISOString().slice(0, 10);
const stageVisibility = stage => stage.source?.visibility ?? STAGE_GANTT_VISIBLE;

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
  const visibilityLabel = make('label', '', 'Exibição');
  const visibilityFilter = make('select', 'gantt-visibility-filter');
  visibilityFilter.append(...[STAGE_GANTT_VISIBLE, STAGE_GANTT_HIDDEN].map(value => new doc.defaultView.Option(value)));
  visibilityLabel.append(visibilityFilter);
  const todayButton = button('Hoje', 'Ir para hoje na linha do tempo');
  todayButton.hidden = true;
  const refresh = button('⟳', 'Atualizar GANTT');
  tools.append(title, branchLabel, visibilityLabel, todayButton, refresh);
  const legend = make('div', 'gantt-legend');
  legend.append(make('span', 'gantt-legend--ongoing', 'Em andamento'), make('span', 'gantt-legend--finished', 'Finalizada'),
    make('span', 'gantt-legend--activity', 'Trecho da etapa'));
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
  const finish = createStageGanttFinishView({ root, background: dialog, data, onSaved(saved, { stage, starting }) {
    const collection = stage ? 'launches' : 'activities';
    snapshot = { ...snapshot, [collection]: snapshot[collection].map(row => String(row.id) === String(saved.id) ? saved : row) };
    stages = buildStageGantt(snapshot, today);
    render();
    announce(`${stage ? 'Etapa' : 'Atividade'} ${starting ? 'iniciada' : 'finalizada'}.`);
    scroll.focus({ preventScroll: true });
  } });

  const confirmation = make('div', 'gantt-visibility-confirm');
  confirmation.hidden = true;
  confirmation.setAttribute('role', 'alertdialog');
  confirmation.setAttribute('aria-modal', 'true');
  const confirmationCard = make('div', 'gantt-visibility-confirm-card');
  const question = make('h2');
  const confirmationBranch = make('p');
  const confirmationActions = make('div', 'gantt-visibility-confirm-actions');
  const cancelVisibility = button('CANCELAR');
  cancelVisibility.className = 'gantt-finish-cancel';
  const confirmVisibility = button('SIM');
  confirmVisibility.className = 'gantt-visibility-confirm-yes';
  confirmationActions.append(cancelVisibility, confirmVisibility);
  confirmationCard.append(question, confirmationBranch, confirmationActions);
  confirmation.append(confirmationCard);
  root.append(confirmation);

  let request, previousFocus, previousOverflow, previousInert, app;
  let snapshot;
  let pendingVisibility;
  let savingVisibility = false;
  const expanded = new Set();
  let stages = [], today = '', todayRatio = null;
  const announce = message => { notice.textContent = message; notice.hidden = !message; };
  const durationObserver = doc.defaultView.ResizeObserver ? new doc.defaultView.ResizeObserver(layoutDurations) : null;
  doc.defaultView.addEventListener('resize', layoutDurations);
  doc.fonts?.ready.then(layoutDurations);

  function closeVisibilityConfirmation(restoreFocus = true) {
    if (!pendingVisibility) return;
    const { control } = pendingVisibility;
    pendingVisibility = null;
    confirmation.hidden = true;
    dialog.inert = false;
    if (restoreFocus && control.isConnected) control.focus({ preventScroll: true });
  }

  cancelVisibility.addEventListener('click', () => closeVisibilityConfirmation());
  confirmVisibility.addEventListener('click', () => {
    if (!pendingVisibility) return;
    const { item, control, target } = pendingVisibility;
    closeVisibilityConfirmation();
    void changeVisibility(item, control, target);
  });
  confirmation.addEventListener('click', event => {
    if (event.target === confirmation) closeVisibilityConfirmation();
  });
  confirmation.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeVisibilityConfirmation();
    }
    if (event.key === 'Tab' && doc.activeElement === (event.shiftKey ? cancelVisibility : confirmVisibility)) {
      event.preventDefault();
      (event.shiftKey ? confirmVisibility : cancelVisibility).focus();
    }
  });

  function setVisibilityBusy(busy) {
    savingVisibility = busy;
    refresh.disabled = busy;
    for (const control of scroll.querySelectorAll('.gantt-row button[aria-haspopup="dialog"]')) {
      if (busy) control.setAttribute('aria-disabled', 'true');
      else control.removeAttribute('aria-disabled');
    }
  }

  async function changeVisibility(item, control, target) {
    if (savingVisibility) return;
    const { signal } = request;
    setVisibilityBusy(true);
    announce('Salvando exibição da etapa…');
    let saved;
    try {
      saved = await data.setStageVisibility(item.source.id, target, { expectedStage: item.source, signal });
    } catch (error) {
      if (signal.aborted) return;
      announce(error?.code === 'stage_progress_changed' || error?.status === 412
        ? 'A etapa mudou. Use Atualizar para conferir.'
        : 'Não foi possível alterar a exibição da etapa. Use Atualizar para conferir ou tente novamente.');
      return;
    } finally {
      if (!signal.aborted) setVisibilityBusy(false);
    }
    if (signal.aborted) return;
    const keepFocus = doc.activeElement === control;
    const top = scroll.scrollTop;
    snapshot = { ...snapshot, launches: snapshot.launches.map(row => String(row.id) === String(saved.id) ? saved : row) };
    stages = buildStageGantt(snapshot, today);
    render();
    scroll.scrollTop = top;
    if (keepFocus) visibilityFilter.focus({ preventScroll: true });
    announce(target === STAGE_GANTT_HIDDEN ? 'Etapa movida para NÃO EXIBIR.' : 'Etapa movida para EXIBIR.');
  }

  function layoutDurations() {
    if (root.hidden) return;
    const measurements = [...scroll.querySelectorAll('.gantt-bar')].map(bar => {
      const start = bar.querySelector('.gantt-bar-date--start');
      const end = bar.querySelector('.gantt-bar-date--end');
      const separator = bar.querySelector('.gantt-bar-date-separator');
      return { bar, width: bar.clientWidth, height: bar.offsetHeight, left: bar.offsetLeft, textWidth: bar.firstElementChild.offsetWidth,
        trackWidth: bar.parentElement.clientWidth, separatorWidth: separator.offsetWidth, separatorHeight: separator.offsetHeight,
        startWidth: start.offsetWidth, endWidth: end.offsetWidth,
        startHeight: start.offsetHeight, endHeight: end.offsetHeight };
    });
    let trailingSpace = 0;
    for (const { bar, width, height, left, trackWidth, textWidth, startWidth, endWidth, startHeight, endHeight, separatorWidth, separatorHeight } of measurements) {
      const outside = textWidth + 8 > width;
      bar.classList.toggle('gantt-bar--outside', outside);
      // Keep the centered duration clear of both endpoint dates.
      const below = width < 2 * Math.max(startWidth, endWidth) + textWidth + 24;
      bar.classList.toggle('gantt-bar--dates-below', below);
      // Center the complete date range below short bars; keep it inside the timeline's left edge.
      const datesWidth = startWidth + separatorWidth + endWidth + 8;
      const startLeft = Math.max(-left, (width - datesWidth) / 2);
      const separatorLeft = startLeft + startWidth + 4;
      const endLeft = separatorLeft + separatorWidth + 4;
      bar.style.setProperty('--gantt-start-date-left', `${startLeft}px`);
      bar.style.setProperty('--gantt-date-separator-left', `${separatorLeft}px`);
      bar.style.setProperty('--gantt-end-date-left', `${endLeft}px`);
      const dateSpace = below ? 4 + Math.max(startHeight, endHeight, separatorHeight) : 0;
      bar.parentElement.style.setProperty('--gantt-date-space', `${dateSpace}px`);
      bar.parentElement.style.setProperty('--gantt-bar-height', `${height}px`);
      trailingSpace = Math.max(trailingSpace,
        outside ? left + width + 6 + textWidth - trackWidth : 0,
        below ? left + endLeft + endWidth - trackWidth : 0);
    }
    // Keep the last day's external labels reachable by horizontal scrolling.
    scroll.querySelector('.gantt-sheet')?.style.setProperty('--gantt-duration-space',
      `${Math.max(0, trailingSpace) + 12}px`);
  }

  function render() {
    closeVisibilityConfirmation(false);
    finish.close({ restoreFocus: false });
    detail.close({ restoreFocus: false });
    durationObserver?.disconnect();
    const visible = stages.filter(stage => stageVisibility(stage) === visibilityFilter.value
      && (!branches.value || stage.branch === branches.value));
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

    function renderRow(item, parent, parentStage = null) {
      const row = make('div', `gantt-row gantt-row--${parent ? 'stage' : 'activity'}`);
      const label = make('div', 'gantt-label');
      const card = make('div', 'gantt-row-text gantt-cluster gantt-cluster--description');
      card.dataset.tone = item.finished ? 'finished' : 'ongoing';
      const startText = formatOperationsDate(item.start);
      const endText = item.finished ? formatOperationsDate(item.end) : 'Em Andamento';
      const dates = `Início ${startText} · Fim ${endText}`;
      card.append(make('strong', 'gantt-name', item.name));
      const actions = make('div', 'gantt-row-actions');
      const subjectName = parent ? 'etapa' : 'atividade';
      const suppressed = visibilityFilter.value === STAGE_GANTT_HIDDEN;
      if (parent && item.source && (suppressed || canSuppressStage(item.source)) && typeof data.setStageVisibility === 'function') {
        const verb = suppressed ? 'exibir' : 'suprimir';
        const action = suppressed ? 'EXIBIR' : 'SUPRIMIR';
        const visibility = button(action, (suppressed ? 'Exibir' : 'Suprimir') + ' etapa ' + item.name);
        visibility.className = 'gantt-visibility-button';
        visibility.setAttribute('aria-haspopup', 'dialog');
        const target = suppressed ? STAGE_GANTT_VISIBLE : STAGE_GANTT_HIDDEN;
        visibility.addEventListener('click', () => {
          if (savingVisibility || dialog.inert) return;
          pendingVisibility = { item, control: visibility, target };
          question.textContent = 'Tem certeza de que deseja ' + verb + ' a etapa “' + item.name + '”?';
          confirmation.setAttribute('aria-label', item.branch ? question.textContent + ' Filial ' + item.branch : question.textContent);
          confirmationBranch.textContent = item.branch;
          dialog.inert = true;
          confirmation.hidden = false;
          cancelVisibility.focus({ preventScroll: true });
        });
        actions.append(visibility);
      }
      if (item.canStart && typeof data[parent ? 'startStage' : 'startActivity'] === 'function') {
        const start = button('INICIAR', `Iniciar ${subjectName} ${item.name}`);
        start.className = 'gantt-start-button';
        start.setAttribute('aria-haspopup', 'dialog');
        start.addEventListener('click', () => {
          if (!savingVisibility && !dialog.inert) void finish.open(item, start, { stage: parent, starting: true });
        });
        actions.append(start);
      }
      if (!item.finished && typeof data[parent ? 'finalizeStage' : 'finalizeActivity'] === 'function'
        && typeof data.loadAssignments === 'function') {
        const finalize = button('FINALIZAR', `Finalizar ${subjectName} ${item.name}`);
        finalize.className = 'gantt-finish-button';
        finalize.setAttribute('aria-haspopup', 'dialog');
        finalize.disabled = !item.canFinalize;
        if (item.canStart) finalize.title = `Inicie a ${subjectName} antes de finalizar.`;
        else if (parent && !item.canFinalize) finalize.title = 'Finalize todos os descritivos vinculados antes de finalizar a etapa.';
        finalize.addEventListener('click', () => {
          if (!savingVisibility && !dialog.inert) void finish.open(item, finalize, { stage: parent });
        });
        actions.append(finalize);
      }
      if (actions.childElementCount) card.append(actions);
      label.append(card);
      const track = make('div', 'gantt-track');
      if (item.range) {
        const { start: from, end: to, tone } = item.range;
        const days = calendarDays(from, to) + 1;
        const bar = button(days === 1 ? '1 dia' : `${days} dias`);
        bar.className = 'gantt-bar';
        const status = tone === 'finished' ? 'Finalizada' : 'Em andamento';
        const description = `${item.name}${parentStage ? ` · Parte de: ${parentStage.name}` : ''} · ${status} · ${dates} · ${bar.textContent}`;
        const duration = make('span', 'gantt-duration', bar.textContent);
        const startDate = make('span', 'gantt-bar-date gantt-bar-date--start', formatOperationsDate(from));
        const endDate = make('span', 'gantt-bar-date gantt-bar-date--end',
          tone === 'ongoing' ? 'Em andamento' : formatOperationsDate(to));
        const separator = make('span', 'gantt-bar-date-separator', '—');
        separator.setAttribute('aria-hidden', 'true');
        startDate.setAttribute('aria-label', `Início ${startDate.textContent}`);
        endDate.setAttribute('aria-label', tone === 'ongoing' ? 'Em andamento' : `Fim ${endDate.textContent}`);
        bar.replaceChildren(duration, startDate, separator, endDate);
        bar.dataset.tone = tone;
        bar.setAttribute('aria-label', description);
        bar.setAttribute('aria-haspopup', 'dialog');
        bar.addEventListener('click', () => {
          if (!savingVisibility && !dialog.inert) void detail.open(item, bar, { stage: parent });
        });
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
      const stageKey = String(stage.source?.id);
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
        if (expand) expanded.add(stageKey); else expanded.delete(stageKey);
        if (expand) {
          childRows = stage.children.map(child => renderRow(child, false, stage));
          row.after(...childRows);
          if (savingVisibility) setVisibilityBusy(true);
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
      if (expanded.has(stageKey)) toggle.click();
    }
    scroll.append(sheet);
    if (savingVisibility) setVisibilityBusy(true);
    layoutDurations();
    const firstStageStart = visible.find(stage => stage.range)?.range.start || first;
    if (firstStageStart) scroll.scrollLeft = axisLabels.clientWidth * calendarDays(start, monthStart(firstStageStart)) / span;
  }

  async function load(force = false) {
    closeVisibilityConfirmation(false);
    finish.close({ restoreFocus: false });
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
    branches.disabled = visibilityFilter.disabled = refresh.disabled = true;
    announce('Carregando etapas e atividades…');
    try {
      const loaded = await data.loadSnapshot({ signal: active.signal, refresh: force });
      if (active.signal.aborted) return;
      snapshot = loaded;
      today = localDay(now());
      stages = buildStageGantt(snapshot, today);
      const selected = branches.selectedIndex < 0 ? DEFAULT_BRANCH : branches.value;
      const options = [...new Set(stages.map(stage => stage.branch).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      branches.replaceChildren(new doc.defaultView.Option('Todas', ''), ...options.map(name => new doc.defaultView.Option(name, name)));
      branches.value = options.includes(selected) ? selected : '';
      branches.disabled = options.length === 0;
      visibilityFilter.disabled = false;
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
    closeVisibilityConfirmation(false);
    finish.close({ restoreFocus: false });
    detail.close({ restoreFocus: false });
    request?.abort();
    root.hidden = true;
    durationObserver?.disconnect();
    scroll.replaceChildren();
    stages = [];
    snapshot = null;
    savingVisibility = false;
    expanded.clear();
    doc.body.style.overflow = previousOverflow;
    if (app) app.inert = previousInert;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    else doc.querySelector('[data-action="open-stage-gantt"]:not(:disabled)')?.focus();
  }

  branches.addEventListener('change', render);
  visibilityFilter.addEventListener('change', render);
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
    async open({ finishDraft } = {}) {
      if (!root.hidden) return;
      previousFocus = doc.activeElement;
      previousOverflow = doc.body.style.overflow;
      app = doc.getElementById('app');
      previousInert = app?.inert || false;
      if (app) app.inert = true;
      doc.body.style.overflow = 'hidden';
      branches.replaceChildren();
      visibilityFilter.value = STAGE_GANTT_VISIBLE;
      root.hidden = false;
      landscape.update();
      dialog.focus();
      await load();
      if (root.hidden || !finishDraft) return;
      const stage = finishDraft.kind === 'stage';
      const starting = finishDraft.operation === 'start';
      const item = stages.flatMap(row => stage ? [row] : row.children).find(row => String(row.source?.id) === String(finishDraft.id));
      if (item) {
        const parent = stage ? item : stages.find(row => row.children.includes(item));
        branches.value = parent?.branch ?? item.branch;
        visibilityFilter.value = parent ? stageVisibility(parent) : STAGE_GANTT_VISIBLE;
        if (starting && !stage && parent) expanded.add(String(parent.source?.id));
        render();
        await finish.open(item, dialog, { stage, starting, draftDate: finishDraft.date });
      }
    },
    close,
    destroy() {
      close();
      durationObserver?.disconnect();
      doc.defaultView.removeEventListener('resize', layoutDurations);
      finish.destroy(); detail.destroy(); landscape.destroy(); root.remove();
    },
  };
}
