import { buildGanttProfessionDetail } from '../chat/stage-gantt-detail-model.js';

export function createStageGanttFinishView({ root, background, data, onSaved }) {
  const doc = root.ownerDocument;
  const make = (tag, className = '', text = '') => {
    const node = doc.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const overlay = make('div', 'gantt-finish-overlay');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const form = make('form', 'gantt-finish-form');
  form.tabIndex = -1;
  const heading = make('h2');
  const subject = make('p', 'gantt-finish-subject');
  const label = make('label', '', 'Data fim');
  const date = make('input');
  date.type = 'date';
  date.required = true;
  label.append(date);
  const notice = make('p');
  notice.setAttribute('role', 'status');
  const actions = make('div', 'gantt-finish-actions');
  const cancel = make('button', 'gantt-finish-cancel', 'CANCELAR');
  cancel.type = 'button';
  const submit = make('button', 'gantt-finish-button', 'SUBMETER');
  submit.type = 'submit';
  actions.append(cancel, submit);
  form.append(heading, subject, label, notice, actions);
  overlay.append(form);
  root.append(overlay);
  let active;
  const message = text => { notice.textContent = text; notice.hidden = !text; };

  function close({ restoreFocus = true } = {}) {
    if (!active) return;
    const previous = active;
    active = null;
    previous.controller.abort();
    overlay.hidden = true;
    background.inert = previous.inert;
    if (restoreFocus && previous.trigger?.isConnected) previous.trigger.focus({ preventScroll: true });
  }

  async function open(item, trigger, { stage = false, starting = false, draftDate = '' } = {}) {
    if (active || !(starting ? item.canStart : item.canFinalize)) return;
    const current = { item, trigger, stage, starting, controller: new AbortController(), saving: false, inert: background.inert };
    active = current;
    background.inert = true;
    heading.textContent = `${starting ? 'Iniciar' : 'Finalizar'} ${stage ? 'etapa' : 'atividade'}`;
    overlay.setAttribute('aria-label', heading.textContent);
    subject.textContent = `${item.name} · ${item.branch}`;
    overlay.hidden = false;
    label.firstChild.textContent = starting ? 'Data de início' : 'Data fim';
    date.value = draftDate;
    const suggestDate = !starting && !draftDate;
    date.disabled = submit.disabled = suggestDate;
    cancel.disabled = false;
    message(suggestDate ? 'Buscando a última data de presença…' : '');
    form.focus();
    if (!suggestDate) return;
    try {
      const snapshot = await data.loadAssignments({ branch: item.branch, activityIds: item.activityIds }, { signal: current.controller.signal });
      if (active !== current) return;
      const detail = buildGanttProfessionDetail(snapshot);
      date.value = detail.professions.flatMap(group => group.people).reduce((last, person) => person.lastDate > last ? person.lastDate : last, '');
      message(date.value ? '' : 'Nenhuma presença vinculada encontrada. Informe a data fim.');
    } catch {
      if (active !== current) return;
      date.value = '';
      message('Não foi possível consultar as presenças. Informe a data fim.');
    }
    date.disabled = submit.disabled = false;
  }

  cancel.addEventListener('click', () => close());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const current = active;
    if (!current || current.saving || date.disabled || !form.reportValidity()) return;
    current.saving = true;
    const selectedDate = date.value;
    date.disabled = submit.disabled = cancel.disabled = true;
    const { stage, starting } = current;
    const subjectName = stage ? 'etapa' : 'atividade';
    message(`${starting ? 'Iniciando' : 'Finalizando'} ${subjectName}…`);
    form.focus();
    try {
      const method = `${starting ? 'start' : 'finalize'}${stage ? 'Stage' : 'Activity'}`;
      const saved = await data[method](current.item.source.id, selectedDate, {
        signal: current.controller.signal,
        [stage ? 'expectedStage' : 'expectedActivity']: current.item.source,
      });
      if (active !== current) return;
      close({ restoreFocus: false });
      onSaved(saved, { stage, starting });
    } catch (error) {
      if (active !== current) return;
      current.saving = false;
      date.disabled = submit.disabled = cancel.disabled = false;
      if (error?.code === 'stage_progress_incomplete') message('Finalize todos os descritivos vinculados antes de finalizar a etapa.');
      else if (error?.status === 412 || error?.code === 'stage_progress_changed') message('O registro mudou no SharePoint. Cancele e atualize o Gantt para conferir.');
      else message(starting ? 'Não foi possível confirmar o início. Confira a data e tente novamente.'
        : 'Não foi possível confirmar a finalização. Confira a data e tente novamente.');
      submit.focus();
    }
  });
  overlay.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (!active.saving) close();
    }
    if (event.key !== 'Tab') return;
    const nodes = [date, cancel, submit].filter(node => !node.disabled);
    const edge = event.shiftKey ? nodes[0] : nodes.at(-1);
    if (doc.activeElement === edge || doc.activeElement === form) {
      event.preventDefault(); (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
    }
  });
  return { open, close, destroy() { close({ restoreFocus: false }); overlay.remove(); } };
}
