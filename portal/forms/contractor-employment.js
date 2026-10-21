export const CONTRACTOR_EMPLOYMENT_CARGOS = Object.freeze([
  'SERVENTE DE PEDREIRO I', 'SERVENTE DE PEDREIRO II', 'SERVENTE DE PEDREIRO III',
  'PEDREIRO I', 'PEDREIRO II', 'PEDREIRO III', 'MESTRE DE OBRAS', 'SUPERVISOR DE OBRAS',
]);

// SharePoint date-only values can arrive with a midnight timestamp. Never shift the day by timezone.
export function contractorEmploymentDate(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(text)) return '';
  const day = text.slice(0, 10);
  const date = new Date(day + 'T12:00:00Z');
  return Number(day.slice(0, 4)) > 0 && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : '';
}

export function validateContractorTermination(fields) {
  const admission = contractorEmploymentDate(fields.DATAADMISSAO);
  const termination = contractorEmploymentDate(fields.DATADESLIGAMENTO);
  if (fields.DATAADMISSAO && !admission) throw new Error('Informe uma data de admissão válida.');
  if (!termination) throw new Error('Informe uma data de desligamento válida.');
  if (admission && termination < admission) throw new Error('A data de desligamento não pode ser anterior à admissão.');
  return termination;
}

export function validateContractorEmploymentDraft(draft = {}) {
  if (!CONTRACTOR_EMPLOYMENT_CARGOS.includes(draft.CARGO)) throw new Error('Selecione um cargo válido.');
  const admission = contractorEmploymentDate(draft.DATAADMISSAO);
  if (!admission) throw new Error('Informe uma data de admissão válida.');
  if (!['ATIVO', 'INATIVO'].includes(draft.STATUS)) throw new Error('Selecione um status válido.');
  const termination = draft.STATUS === 'INATIVO' || draft.DATADESLIGAMENTO
    ? validateContractorTermination(draft) : '';
  return { CARGO: draft.CARGO, DATAADMISSAO: admission, STATUS: draft.STATUS, DATADESLIGAMENTO: termination || null };
}

/** Date request used by the existing supplier edit form, before its persistence boundary. */
export function requestContractorTerminationDate({ document: doc = globalThis.document, admission } = {}) {
  if (!doc?.body) throw new Error('Informe uma data de desligamento válida.');
  return new Promise((resolve, reject) => {
    const previousFocus = doc.activeElement;
    const dialog = doc.createElement('dialog');
    dialog.setAttribute('aria-label', 'Data de desligamento');
    const form = doc.createElement('form');
    form.noValidate = true;
    const label = doc.createElement('label');
    label.textContent = 'Data de desligamento';
    const input = doc.createElement('input');
    input.type = 'date'; input.name = 'DATADESLIGAMENTO'; input.required = true;
    input.min = contractorEmploymentDate(admission);
    const error = doc.createElement('p'); error.setAttribute('role', 'alert');
    const save = doc.createElement('button'); save.type = 'submit'; save.textContent = 'Confirmar desligamento';
    const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancelar';
    cancel.dataset.action = 'cancel-termination';
    function finish(value) { dialog.remove(); previousFocus?.focus?.(); resolve(value); }
    function abort() {
      dialog.remove(); previousFocus?.focus?.();
      reject(new DOMException('Desligamento cancelado; nenhuma alteração foi gravada.', 'AbortError'));
    }
    cancel.addEventListener('click', abort);
    dialog.addEventListener('cancel', event => { event.preventDefault(); abort(); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      try { finish(validateContractorTermination({ DATAADMISSAO: admission, DATADESLIGAMENTO: input.value })); }
      catch (cause) { error.textContent = cause.message; input.focus(); }
    });
    label.append(input); form.append(label, error, save, cancel); dialog.append(form); doc.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    input.focus();
  });
}

export async function prepareContractorSupplierEdit(entity, item, fields, options = {}) {
  if (entity?.id !== 'fornecedores' || options.mode !== 'edit') return fields;
  const current = { ...item?.fields, ...fields };
  const contractor = String(current.EMPREITEIRO ?? '').trim().toUpperCase() === 'SIM';
  if (!contractor || String(current.STATUS ?? '').trim().toUpperCase() !== 'INATIVO') return fields;
  if (!current.DATADESLIGAMENTO) {
    current.DATADESLIGAMENTO = await requestContractorTerminationDate({
      document: options.document ?? globalThis.document, admission: current.DATAADMISSAO,
    });
  }
  return { ...fields, DATADESLIGAMENTO: validateContractorTermination(current) };
}
