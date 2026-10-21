import { filterContractorEmploymentRows } from '../chat/contractor-employment-data.js';
import { CONTRACTOR_EMPLOYMENT_CARGOS, contractorEmploymentDate, validateContractorEmploymentDraft } from '../../../../portal/forms/contractor-employment.js';
import { applyScreenNavigation } from './screen-navigation.js';

export function createContractorEmploymentView({ document: doc = globalThis.document, data, onHome } = {}) {
  if (!doc?.body || !data?.loadSnapshot || !data?.save) throw new TypeError('Documento e dados de funcionários são obrigatórios.');
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, action, handler) => {
    const node = el('button', 'rg-button', label); node.type = 'button'; node.dataset.action = action;
    node.addEventListener('click', handler); return node;
  };
  const root = el('section', 'rg-overlay ce-overlay');
  root.hidden = true; root.tabIndex = -1; root.dataset.galleryKind = 'contractorEmployment';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'GALERIA DE FUNCIONÁRIOS');
  const header = el('header', 'rg-header');
  const title = el('h1', 'rg-title', 'GALERIA DE FUNCIONÁRIOS');
  const back = button('Voltar', 'close', hide);
  const home = onHome ? button('Início', 'home', async () => { hide(); await onHome(); }) : null;
  applyScreenNavigation({ header, back, home, title });
  const toolbar = el('div', 'ce-toolbar');
  const searchLabel = el('label', '', 'Pesquisar em todos os campos');
  const search = el('input'); search.type = 'search'; search.placeholder = 'Pesquisar funcionário, cargo ou ID'; search.dataset.search = '';
  searchLabel.append(search); toolbar.append(searchLabel);
  const filters = {};
  for (const [name, label] of [['STATUS', 'Status'], ['FILIAL', 'Filial'], ['CARGO', 'Cargo']]) {
    const wrapper = el('label', '', label), select = el('select'); select.dataset.filter = name; select.setAttribute('aria-label', label);
    wrapper.append(select); toolbar.append(wrapper); filters[name] = select;
    select.addEventListener('change', renderRows);
  }
  const refresh = button('Atualizar', 'refresh', () => { if (!saving) { editor.replaceChildren(); load(); } });
  toolbar.append(refresh);
  const status = el('p', 'ce-status'); status.setAttribute('role', 'status');
  const alert = el('p', 'ce-error'); alert.setAttribute('role', 'alert');
  const list = el('div', 'ce-list'), editor = el('div', 'ce-editor');
  root.append(header, toolbar, status, alert, editor, list); doc.body.append(root);
  const unconfirmed = new Map();
  const unconfirmedMessage = () => [...new Set(unconfirmed.values())].join(' ');
  let rows = [], columns = [], destroyed = false, saving = false, loaded = false, generation = 0, controller, previousFocus;
  function setBusy(busy) {
    saving = busy; root.setAttribute('aria-busy', String(busy));
    for (const control of root.querySelectorAll('button, input, select')) control.disabled = busy || control.dataset.unavailable === 'true';
  }
  function hide() {
    if (saving) return;
    generation++; controller?.abort(); root.hidden = true; editor.replaceChildren(); previousFocus?.focus?.();
  }
  function display(value) {
    return value === '' || value == null ? 'Não informado' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  function renderRows() {
    list.replaceChildren();
    if (!loaded) return;
    const visible = filterContractorEmploymentRows(rows, { search: search.value, ...Object.fromEntries(Object.entries(filters).map(([name, control]) => [name, control.value])) });
    status.textContent = visible.length + ' de ' + rows.length + ' funcionários • inclui histórico inativo';
    const labels = new Map(columns.map(column => [column.name, column.displayName || column.name]));
    for (const row of visible) {
      const fields = row.fields || {}, card = el('article', 'ce-card'); card.dataset.employmentRow = row.id;
      card.append(el('h2', '', fields.Title || 'Funcionário #' + row.id));
      const highlights = el('dl', 'ce-highlights');
      for (const [name, label] of [['CARGO', 'Cargo'], ['DATAADMISSAO', 'Admissão'], ['DATADESLIGAMENTO', 'Desligamento'], ['STATUS', 'Status']]) {
        const pair = el('div'); pair.append(el('dt', '', label), el('dd', '', display(name.startsWith('DATA') ? contractorEmploymentDate(fields[name]) : fields[name]))); highlights.append(pair);
      }
      card.append(highlights);
      const missing = [];
      if (!CONTRACTOR_EMPLOYMENT_CARGOS.includes(fields.CARGO)) missing.push('cargo');
      if (!contractorEmploymentDate(fields.DATAADMISSAO)) missing.push('admissão');
      if (missing.length) card.append(el('p', 'ce-regularize', 'Regularizar ' + missing.join(' e ')));
      const detail = el('details'), summary = el('summary', '', 'Todos os campos e auditoria'), values = el('dl', 'ce-details');
      const all = new Map([['ID', row.id], ...columns.filter(column => !column.hidden).map(column => [column.name, fields[column.name]]), ...Object.entries(fields)]);
      for (const [name, value] of all) {
        if (name.startsWith('@odata.')) continue;
        const pair = el('div'); pair.append(el('dt', '', labels.get(name) || name), el('dd', '', display(value))); values.append(pair);
      }
      detail.append(summary, values); card.append(detail);
      const actions = el('div', 'ce-actions');
      actions.append(button('Editar / regularizar', 'edit', () => edit(row)));
      if (fields.STATUS !== 'INATIVO') actions.append(button('Inativar', 'inactivate', () => edit(row, true)));
      if (data.loadConflict && data.renewBaseline) actions.append(button('Conferir fonte e espelho', 'review-conflict', () => reviewConflict(row)));
      card.append(actions); list.append(card);
    }
    if (!visible.length) list.append(el('p', '', 'Nenhum funcionário encontrado.'));
  }
  async function reviewConflict(row) {
    if (saving) return;
    const current = generation, previousNodes = [...editor.childNodes];
    const panel = el('section', 'ce-conflict');
    panel.append(el('h2', '', 'Conferir fonte e espelho'), el('p', '', 'Consultando as versões atuais…'));
    editor.replaceChildren(panel); setBusy(true);
    try {
      const review = await data.loadConflict(row, { signal: controller?.signal });
      if (destroyed || generation !== current) return;
      panel.replaceChildren(el('h2', '', 'Conferir fonte e espelho'));
      const comparison = el('div', 'ce-conflict-comparison');
      for (const [name, label] of [['source', 'Fornecedor de origem'], ['target', 'Espelho RH']]) {
        const record = review[name], section = el('section');
        section.dataset[name === 'source' ? 'conflictSource' : 'conflictTarget'] = '';
        section.append(el('h3', '', label + ' #' + record.id), el('p', '', 'Versão: ' + (record.eTag || record['@odata.etag'])));
        const values = el('dl', 'ce-details');
        for (const [field, caption] of [['CARGO', 'Cargo'], ['DATAADMISSAO', 'Admissão'], ['DATADESLIGAMENTO', 'Desligamento'], ['STATUS', 'Status']]) {
          const pair = el('div');
          pair.append(el('dt', '', caption), el('dd', '', display(field.startsWith('DATA') ? contractorEmploymentDate(record.fields[field]) : record.fields[field])));
          values.append(pair);
        }
        section.append(values); comparison.append(section);
      }
      panel.append(comparison, el('p', '', review.canRenew
        ? 'Use os dados atuais da fonte para iniciar outra edição. Isso não confirma a tentativa anterior nem grava alterações.'
        : 'A gravação anterior permanece incerta. Volte e confirme a tentativa original; a pendência será preservada.'));
      const accept = button('Usar dados atuais e iniciar nova edição', 'renew-baseline', async () => {
        if (saving) return;
        setBusy(true);
        try {
          const baseline = await data.renewBaseline(review, { signal: controller?.signal });
          if (destroyed || generation !== current) return;
          setBusy(false);
          edit(baseline, false, 'Dados atuais da fonte conferidos. Isso não confirma a tentativa anterior; revise e salve para confirmar a nova edição.');
        } catch (cause) { if (!destroyed && generation === current) alert.textContent = cause.message; }
        finally { if (!destroyed && generation === current) setBusy(false); }
      });
      accept.dataset.unavailable = String(!review.canRenew);
      const cancel = button('Voltar sem alterar', 'cancel-conflict', () => editor.replaceChildren(...previousNodes));
      const actions = el('div', 'ce-actions'); actions.append(accept, cancel); panel.append(actions);
    } catch (cause) {
      if (!destroyed && generation === current) { editor.replaceChildren(...previousNodes); alert.textContent = cause.message; }
    } finally { if (!destroyed && generation === current) setBusy(false); }
  }
  function edit(row, inactivate = false, notice = '') {
    if (saving) return;
    alert.textContent = unconfirmedMessage(); editor.replaceChildren();
    const form = el('form'); form.noValidate = true;
    form.append(el('h2', '', (inactivate ? 'Inativar: ' : 'Editar: ') + (row.fields.Title || row.id)));
    if (notice) form.append(el('p', '', notice));
    const controls = {};
    function field(name, label, choices) {
      const wrapper = el('label', '', label), control = el(choices ? 'select' : 'input');
      control.name = name;
      if (choices) {
        for (const value of ['', ...choices]) { const option = el('option', '', value || 'Selecione'); option.value = value; control.append(option); }
      } else control.type = 'date';
      control.value = name.startsWith('DATA') ? contractorEmploymentDate(row.fields[name]) : row.fields[name] || '';
      wrapper.append(control); form.append(wrapper); controls[name] = control; return control;
    }
    field('CARGO', 'Cargo', CONTRACTOR_EMPLOYMENT_CARGOS).required = true;
    field('DATAADMISSAO', 'Data de admissão').required = true;
    const state = field('STATUS', 'Status', ['ATIVO', 'INATIVO']); state.required = true;
    if (inactivate) state.value = 'INATIVO';
    const termination = field('DATADESLIGAMENTO', 'Data de desligamento');
    const updateRequirement = () => { termination.required = state.value === 'INATIVO'; termination.min = controls.DATAADMISSAO.value; };
    state.addEventListener('change', updateRequirement); controls.DATAADMISSAO.addEventListener('change', updateRequirement); updateRequirement();
    const save = el('button', 'rg-button', 'Salvar'); save.type = 'submit';
    const cancel = button('Cancelar', 'cancel-edit', () => { editor.replaceChildren(); alert.textContent = unconfirmedMessage(); });
    const actions = el('div', 'ce-actions'); actions.append(save, cancel); form.append(actions);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving || destroyed) return;
      alert.textContent = unconfirmedMessage();
      try {
        const draft = validateContractorEmploymentDraft(Object.fromEntries(Object.entries(controls).map(([name, control]) => [name, control.value])));
        setBusy(true);
        status.textContent = 'Atualização em andamento…';
        const saved = await data.save(row, draft, { signal: controller?.signal });
        if (destroyed) return;
        unconfirmed.delete(row.id); alert.textContent = unconfirmedMessage();
        rows = rows.map(current => current.id === row.id ? saved : current);
        editor.replaceChildren(); populateFilters(); renderRows(); status.textContent += ' • Atualização confirmada';
      } catch (cause) {
        if (!destroyed) {
          const message = cause.message || 'Não foi possível confirmar a atualização.';
          if (cause.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL') unconfirmed.set(row.id, message);
          alert.textContent = [...new Set([message, ...unconfirmed.values()])].join(' ');
          status.textContent = 'Atualização não confirmada.';
        }
      }
      finally { if (!destroyed) setBusy(false); }
    });
    editor.append(form); controls.CARGO.focus();
  }
  function populateFilters() {
    for (const [name, control] of Object.entries(filters)) {
      const selected = control.value; control.replaceChildren();
      for (const value of ['', ...new Set(rows.map(row => row.fields?.[name]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
        const option = el('option', '', value || 'Todos'); option.value = value; control.append(option);
      }
      control.value = selected;
    }
  }
  async function load() {
    const current = ++generation; controller?.abort(); controller = new AbortController();
    alert.textContent = unconfirmedMessage(); status.textContent = 'Carregando todas as páginas…'; refresh.disabled = true;
    // Old rows cannot represent a failed or unfinished full search.
    loaded = false; rows = []; list.replaceChildren();
    try {
      const snapshot = await data.loadSnapshot({ signal: controller.signal });
      if (destroyed || generation !== current) return;
      rows = snapshot.rows; columns = snapshot.columns || []; loaded = true; populateFilters(); renderRows();
    } catch (cause) {
      if (!destroyed && generation === current) { alert.textContent = cause.message || 'Não foi possível carregar os funcionários.'; status.textContent = 'Consulta incompleta; tente atualizar.'; }
    } finally { if (!destroyed && generation === current) refresh.disabled = false; }
  }
  search.addEventListener('input', renderRows);
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); if (editor.childElementCount && !saving) editor.replaceChildren(); else hide(); }
    if (event.key === 'Tab') {
      const controls = [...root.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary')];
      if (event.shiftKey && doc.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && doc.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  });
  return Object.freeze({
    async open() { if (destroyed) return; previousFocus = doc.activeElement; root.hidden = false; root.focus(); await load(); },
    close: hide,
    destroy() { destroyed = true; generation++; controller?.abort(); root.remove(); },
  });
}
