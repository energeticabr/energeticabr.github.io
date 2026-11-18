import { buildGanttProfessionDetail } from '../chat/stage-gantt-detail-model.js';
import { formatOperationsDate } from '../chat/operations-reports-model.js';
import { renderGanttCostDetail } from './stage-gantt-cost-view.js';

let sequence = 0;
const daysText = value => `${value} ${value === 1 ? 'dia' : 'dias'}`;

export function createStageGanttDetailView({ root, background, data }) {
  const doc = root.ownerDocument;
  const make = (tag, className = '', text = '') => {
    const node = doc.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const backdrop = make('div', 'gantt-detail-backdrop');
  backdrop.hidden = true;
  const dialog = make('section', 'gantt-detail-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Dias por profissão');
  const header = make('header', 'gantt-detail-header');
  const heading = make('div');
  const title = make('h2', '', 'Dias por profissão');
  const context = make('p');
  heading.append(title, context);
  const closeButton = make('button', 'gantt-detail-close', 'Fechar');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Fechar dias por profissão');
  const actions = make('div', 'gantt-detail-actions');
  const backButton = make('button', 'gantt-detail-back', 'Voltar');
  backButton.type = 'button'; backButton.hidden = true;
  actions.append(backButton, closeButton);
  header.append(heading, actions);
  const content = make('div', 'gantt-detail-content');
  content.tabIndex = 0;
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', 'Profissões e pessoas vinculadas');
  dialog.append(header, content);
  backdrop.append(dialog);
  root.append(backdrop);

  let request, trigger, selection, costSelection, isStage, mode, previousInert, destroyed = false;

  function setMode(next) {
    mode = next;
    const label = next === 'choice' ? 'Detalhar etapa' : next === 'cost' ? 'Custo por período' : 'Dias por profissão';
    title.textContent = label;
    dialog.setAttribute('aria-label', label);
    closeButton.setAttribute('aria-label', `Fechar ${label.toLocaleLowerCase('pt-BR')}`);
    content.setAttribute('aria-label', next === 'cost' ? 'Custos da etapa por período' : label);
    backButton.hidden = !isStage || next === 'choice';
  }

  function choices() {
    request?.abort(); request = null;
    setMode('choice');
    const options = make('div', 'gantt-detail-options');
    for (const [analysis, label] of [['professions', 'Dias por profissão'], ['cost', 'Custo por período']]) {
      const button = make('button', 'gantt-detail-option', label);
      button.type = 'button'; button.dataset.analysis = analysis;
      button.addEventListener('click', () => { setMode(analysis); closeButton.focus({ preventScroll: true }); void load(); });
      options.append(button);
    }
    content.replaceChildren(options);
  }
  backButton.addEventListener('click', () => { choices(); content.querySelector('button')?.focus({ preventScroll: true }); });

  function render(detail) {
    content.replaceChildren();
    if (!detail.professions.length) {
      content.append(make('p', '', 'Nenhuma presença vinculada a esta barra.'));
      return;
    }
    content.append(make('p', 'gantt-detail-total', `${daysText(detail.days)} de presença vinculados`));
    for (const profession of detail.professions) {
      const section = make('section', 'gantt-profession');
      const line = make('div', 'gantt-profession-header');
      const toggle = make('button', 'gantt-profession-toggle', '+');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', `Detalhar ${profession.name}`);
      const table = make('table', 'gantt-people');
      table.id = `gantt-people-${++sequence}`;
      table.hidden = true;
      toggle.setAttribute('aria-controls', table.id);
      const head = make('thead'), titles = make('tr');
      for (const label of ['Pessoa', 'Dias', 'Primeiro vínculo', 'Último vínculo']) {
        const cell = make('th', '', label);
        cell.scope = 'col';
        titles.append(cell);
      }
      head.append(titles);
      const body = make('tbody');
      for (const person of profession.people) {
        const row = make('tr');
        for (const value of [person.name, String(person.days), formatOperationsDate(person.firstDate), formatOperationsDate(person.lastDate)]) {
          row.append(make('td', '', value));
        }
        body.append(row);
      }
      table.append(head, body);
      toggle.addEventListener('click', () => {
        table.hidden = !table.hidden;
        toggle.textContent = table.hidden ? '+' : '−';
        toggle.setAttribute('aria-expanded', String(!table.hidden));
        toggle.setAttribute('aria-label', `${table.hidden ? 'Detalhar' : 'Recolher'} ${profession.name}`);
      });
      line.append(toggle, make('strong', '', profession.name), make('span', 'gantt-profession-days', daysText(profession.days)));
      section.append(line, table);
      content.append(section);
    }
  }

  async function load() {
    request?.abort();
    const active = new AbortController();
    request = active;
    const cost = mode === 'cost';
    const status = make('p', '', cost ? 'Carregando custos da etapa…' : 'Carregando presenças vinculadas…');
    status.setAttribute('role', 'status');
    content.replaceChildren(status);
    try {
      const snapshot = cost ? await data.loadCostSnapshot({ signal: active.signal })
        : await data.loadAssignments(selection, { signal: active.signal });
      if (active.signal.aborted || request !== active) return;
      if (cost) renderGanttCostDetail({ container: content, snapshot, selection: costSelection });
      else render(buildGanttProfessionDetail(snapshot));
    } catch {
      if (active.signal.aborted || request !== active) return;
      status.textContent = cost ? 'Não foi possível carregar os custos da etapa.' : 'Não foi possível carregar as presenças vinculadas.';
      const retry = make('button', 'gantt-detail-retry', 'Tentar novamente');
      retry.type = 'button';
      retry.addEventListener('click', () => { closeButton.focus({ preventScroll: true }); void load(); });
      content.replaceChildren(status, retry);
    }
  }

  function close({ restoreFocus = true } = {}) {
    if (backdrop.hidden) return;
    request?.abort();
    request = null;
    backdrop.hidden = true;
    content.replaceChildren();
    background.inert = previousInert;
    if (restoreFocus && !root.hidden && trigger?.isConnected) trigger.focus({ preventScroll: true });
    trigger = null;
  }
  closeButton.addEventListener('click', () => close());
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) close();
    event.stopPropagation();
  });
  backdrop.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const nodes = [...dialog.querySelectorAll('button,select,[tabindex="0"]')].filter(node => !node.disabled && !node.closest('[hidden]'));
    if (doc.activeElement === (event.shiftKey ? nodes[0] : nodes.at(-1))) {
      event.preventDefault();
      (event.shiftKey ? nodes.at(-1) : nodes[0]).focus();
    }
  });
  return {
    open(item, source, { stage = false } = {}) {
      if (destroyed || root.hidden) return;
      close({ restoreFocus: false });
      trigger = source;
      isStage = stage;
      selection = { branch: item.branch, activityIds: item.activityIds };
      costSelection = { branch: item.branch, stage: item.name };
      context.textContent = [item.name, item.branch,
        stage ? 'Etapa' : `Demonstrativo #${item.activityIds[0]}`].join(' · ');
      previousInert = Boolean(background.inert);
      background.inert = true;
      backdrop.hidden = false;
      content.scrollTop = 0;
      closeButton.focus({ preventScroll: true });
      if (stage) { choices(); return; }
      setMode('professions'); return load();
    },
    close,
    destroy() { close({ restoreFocus: false }); destroyed = true; backdrop.remove(); },
  };
}
