import { WEEKLY_PAYSLIP_RUBRICS, weeklyPayslipLines, weeklyPayslipTotal } from '../chat/weekly-payslip-lines.js';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function createWeeklyPayslipActions({ doc, host, pick, list, upload, open, loadEditor, saveEditor, onSaved }) {
  let active;
  const el = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function button(text, action, activate, className = 'hr-gallery-button') {
    const node = el('button', text, className);
    node.type = 'button';
    if (action) node.dataset.action = action;
    node.addEventListener('click', activate);
    return node;
  }
  function close(force = false) {
    if (!active || (!force && active.writing)) return;
    const { trigger, overlay, controller } = active;
    active = null;
    controller.abort();
    overlay.remove();
    if (trigger.isConnected) trigger.focus();
  }
  function dialog(title, row, trigger) {
    if (active) return null;
    const overlay = el('div', '', 'gallery-record-overlay');
    const panel = el('section', '', 'gallery-record-dialog hr-payslip-dialog');
    panel.dataset.payslipDialog = '';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', `${title} de ${row.FORNECEDOR || `ID ${row.id}`}`);
    const dismiss = button('Fechar', 'close-payslip-dialog', () => close());
    const heading = el('header', '', 'hr-payslip-dialog-header');
    heading.append(el('h2', title), dismiss);
    const message = el('p', '', 'hr-payslip-dialog-message');
    message.setAttribute('role', 'status');
    const body = el('div', '', 'hr-payslip-dialog-body');
    panel.append(heading, el('p', `${row.FORNECEDOR || 'Funcionário'} · ID ${row.id}`), body, message);
    overlay.append(panel);
    const controller = new AbortController();
    const state = active = { overlay, body, message, dismiss, trigger, controller, signal: controller.signal };
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const focusable = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')]
        .filter(node => !node.closest('[hidden]'));
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    host.append(overlay);
    dismiss.focus();
    return state;
  }
  function errorMessage(error, fallback) { return error?.message || fallback; }

  function attachmentChoices(choose, isEditor = false) {
    const choices = el('div', '', 'hr-payslip-dialog-options');
    const photos = el('div', '', 'hr-payslip-dialog-options');
    photos.hidden = true;
    for (const [source, label] of [['files', isEditor ? 'Adicionar arquivo' : 'Enviar anexo'], ['scan', 'Escanear'], ['photo', isEditor ? 'Adicionar foto' : 'Enviar foto']]) {
      const option = button(label, '', () => {
        if (source === 'photo') {
          photos.hidden = !photos.hidden;
          option.setAttribute('aria-expanded', String(!photos.hidden));
        } else {
          photos.hidden = true;
          choices.querySelector('[data-payslip-source=photo]').setAttribute('aria-expanded', 'false');
          void choose(source);
        }
      });
      if (source === 'photo') option.setAttribute('aria-expanded', 'false');
      option.dataset.payslipSource = source;
      choices.append(option);
    }
    for (const [source, label] of [['photos', 'Escolher foto'], ['camera', 'Tirar foto']]) {
      const option = button(label, '', () => { void choose(source); });
      option.dataset.payslipSource = source;
      photos.append(option);
    }
    choices.append(photos);
    return choices;
  }

  async function uploadDialog(row, trigger) {
    const state = dialog('Via assinada do holerite', row, trigger);
    if (!state) return;
    const { body, message, signal } = state;
    const options = { signal };
    const choices = attachmentChoices(choose);
    const preview = el('div', '', 'hr-payslip-dialog-files');
    const existing = el('div', '', 'hr-payslip-dialog-files');
    let selected = [];
    let picking = false;
    let previewing = false;
    let viewing = null;
    let uploaded = false;
    const setDisabled = () => {
      for (const node of choices.querySelectorAll('button')) node.disabled = picking || !!state.writing || previewing;
      send.disabled = !selected.length || picking || !!state.writing || previewing;
      state.dismiss.disabled = !!state.writing;
      for (const node of existing.querySelectorAll('button')) node.disabled = picking || !!state.writing || previewing;
    };
    async function choose(source) {
      if (signal.aborted || picking || state.writing || previewing) return;
      picking = true;
      message.textContent = '';
      setDisabled();
      try {
        const files = Array.from(await pick(source, options) || []);
        if (signal.aborted || !files.length) return;
        selected = files;
        preview.replaceChildren(...files.map(file => el('span', file.name)));
      } catch (error) {
        if (!signal.aborted) message.textContent = errorMessage(error, 'Não foi possível selecionar a via assinada.');
      } finally { picking = false; if (!signal.aborted) setDisabled(); }
    }
    function showExisting(files) {
      existing.replaceChildren();
      files.forEach((file, index) => {
        const date = file.uploadedAt ? new Date(file.uploadedAt) : null;
        const stamp = date && Number.isFinite(date.getTime()) ? ` · ${date.toLocaleString('pt-BR')}` : '';
        const kind = file.name.endsWith('.pdf') ? 'PDF' : 'Foto';
        existing.append(button(`Abrir via assinada ${index + 1} (${kind})${stamp}`, 'open-signed-payslip', async () => {
          if (signal.aborted || state.writing || picking || previewing) return;
          previewing = true;
          const lifetime = viewing = new AbortController();
          const abort = () => lifetime.abort(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          const release = () => {
            if (viewing !== lifetime) return;
            viewing = null;
            previewing = false;
            signal.removeEventListener('abort', abort);
            if (!signal.aborted) setDisabled();
          };
          setDisabled();
          try { await open(row, file, { signal: lifetime.signal, onClose: release }); }
          catch (error) { if (!signal.aborted) message.textContent = errorMessage(error, 'Não foi possível abrir a via assinada.'); release(); }
        }));
      });
      setDisabled();
    }
    const send = button('Salvar via assinada', 'confirm-signed-payslip', async () => {
      if (!selected.length || signal.aborted || picking || state.writing || previewing) return;
      state.writing = true;
      message.textContent = 'Enviando via assinada…';
      setDisabled();
      try {
        const files = await upload(row, selected, options);
        if (signal.aborted) return;
        uploaded = true;
        selected = [];
        preview.replaceChildren();
        showExisting(files);
        message.textContent = 'Via assinada salva.';
      } catch (error) {
        if (!signal.aborted) message.textContent = errorMessage(error, 'Não foi possível salvar a via assinada.');
      } finally { state.writing = false; if (!signal.aborted) setDisabled(); }
    });
    body.append(choices, preview, send, existing);
    setDisabled();
    try {
      const files = await list(row, options);
      if (!signal.aborted && !state.writing && !uploaded) showExisting(files);
    } catch (error) {
      if (!signal.aborted && !state.writing && !uploaded) message.textContent = errorMessage(error, 'Não foi possível consultar as vias assinadas.');
    }
  }

  function editRubrics(form, lines) {
    const section = el('section', '', 'hr-payslip-dialog-body');
    const list = el('div', '', 'hr-payslip-dialog-body');
    const total = el('strong');
    total.dataset.payslipTotal = '';
    total.setAttribute('aria-live', 'polite');
    const readLines = () => [...list.children].map(fieldset => Object.fromEntries(
      [...fieldset.querySelectorAll('[data-payslip-line]')].map(input => [input.dataset.payslipLine, input.value])));
    const refresh = () => {
      const rows = readLines();
      add.disabled = rows.length >= WEEKLY_PAYSLIP_RUBRICS.length;
      [...list.children].forEach((fieldset, index) => {
        const row = rows[index];
        for (const option of fieldset.querySelector('select').options)
          option.disabled = option.value !== row.rubrica && rows.some(other => other.rubrica === option.value);
        const subtotal = fieldset.querySelector('[data-payslip-subtotal]');
        try { subtotal.textContent = `Subtotal ${currency.format(weeklyPayslipLines([row])[0].total)}`; }
        catch { subtotal.textContent = 'Subtotal —'; }
      });
      try { total.textContent = `Total ${currency.format(weeklyPayslipTotal(weeklyPayslipLines(rows)))}`; }
      catch { total.textContent = 'Total —'; }
    };
    function addLine(line) {
      const row = el('fieldset', '', 'hr-payslip-edit-rubric');
      row.append(el('legend', 'Rubrica'));
      const select = el('select', '', 'hr-gallery-filter-input');
      select.dataset.payslipLine = 'rubrica';
      select.setAttribute('aria-label', 'Tipo da rubrica');
      for (const { id, label } of WEEKLY_PAYSLIP_RUBRICS) {
        const option = el('option', label);
        option.value = id;
        select.append(option);
      }
      select.value = line.rubrica;
      row.append(select);
      for (const [key, label] of [['quantity', 'Quantidade'], ['unitValue', 'Valor unitário (R$)'], ['formaPgto', 'Forma de pagamento']]) {
        const field = el('label', label, 'hr-gallery-filter-field');
        const input = el('input', '', 'hr-gallery-filter-input');
        input.dataset.payslipLine = key;
        input.value = line[key] ?? '';
        input.required = key !== 'formaPgto';
        input.inputMode = key === 'formaPgto' ? 'text' : 'decimal';
        input.maxLength = key === 'formaPgto' ? 255 : 32;
        field.append(input);
        row.append(field);
      }
      const subtotal = el('span');
      subtotal.dataset.payslipSubtotal = '';
      row.append(subtotal, button('Retirar rubrica', 'remove-payslip-rubric', () => {
        row.remove();
        refresh();
        add.focus();
      }));
      list.append(row);
      return select;
    }
    const add = button('Adicionar rubrica', 'add-payslip-rubric', () => {
      const used = new Set(readLines().map(row => row.rubrica));
      const rubric = WEEKLY_PAYSLIP_RUBRICS.find(({ id }) => !used.has(id));
      if (!rubric) return;
      const select = addLine({ rubrica: rubric.id, quantity: 1 });
      refresh();
      select.focus();
    });
    lines.forEach(addLine);
    list.addEventListener('input', refresh);
    list.addEventListener('change', refresh);
    section.append(el('h3', 'Rubricas e valores'), list, add, total);
    form.append(section);
    refresh();
    return readLines;
  }

  function editAttachments(form, row, initial, archived, state) {
    const section = el('section', '', 'hr-payslip-dialog-body');
    const files = el('div', '', 'hr-payslip-dialog-files');
    const removed = new Set();
    const restored = new Set();
    const uploads = [];
    const { signal, message } = state;
    let busy = false;
    function renderFiles() {
      files.replaceChildren();
      for (const attachment of initial) {
        const removedHere = removed.has(attachment.name);
        const item = el('div', '', 'hr-payslip-edit-file');
        const label = attachment.signed ? `Via assinada (${attachment.name.endsWith('.pdf') ? 'PDF' : 'foto'})` : attachment.label || attachment.name;
        item.append(el('span', removedHere ? `${label} · será retirado` : label));
        if (!removedHere && open) item.append(button('Abrir', 'open-payslip-attachment', async () => {
          if (busy || signal.aborted) return;
          try { await open(row, attachment, { signal, editorAttachment: true, returnLabel: 'Voltar à edição do holerite' }); }
          catch (error) { if (!signal.aborted) message.textContent = errorMessage(error, 'Não foi possível abrir o anexo.'); }
        }));
        item.append(button(removedHere ? 'Desfazer' : 'Retirar', 'remove-payslip-attachment', () => {
          if (removedHere) removed.delete(attachment.name); else removed.add(attachment.name);
          renderFiles();
          files.querySelectorAll('[data-action=remove-payslip-attachment]')[initial.indexOf(attachment)]?.focus();
        }));
        files.append(item);
      }
      for (const attachment of archived) {
        const restore = restored.has(attachment.name);
        const item = el('div', '', 'hr-payslip-edit-file');
        const label = attachment.signed ? `Via assinada (${attachment.name.endsWith('.pdf') ? 'PDF' : 'foto'})` : attachment.label;
        item.append(el('span', `${label} · ${restore ? 'será restaurado' : 'retirado'}`),
          button(restore ? 'Desfazer' : 'Restaurar', 'restore-payslip-attachment', () => {
            if (restore) restored.delete(attachment.name); else restored.add(attachment.name);
            renderFiles();
            files.querySelectorAll('[data-action=restore-payslip-attachment]')[archived.indexOf(attachment)]?.focus();
          }));
        files.append(item);
      }
      for (const file of uploads) {
        const item = el('div', '', 'hr-payslip-edit-file');
        item.append(el('span', `${file.name} · novo`), button('Retirar', 'discard-payslip-attachment', () => {
          uploads.splice(uploads.indexOf(file), 1);
          renderFiles();
          choices.querySelector('button')?.focus();
        }));
        files.append(item);
      }
      if (!files.childElementCount) files.append(el('p', 'Nenhum anexo.'));
    }
    const choices = pick ? attachmentChoices(async source => {
      if (busy || signal.aborted) return;
      busy = true;
      message.textContent = '';
      choices.querySelectorAll('button').forEach(node => { node.disabled = true; });
      try {
        const selected = Array.from(await pick(source, { signal }) || []);
        if (signal.aborted || !selected.length) return;
        if (uploads.length + selected.length > 20) throw new Error('Selecione até 20 arquivos por envio.');
        uploads.push(...selected);
        renderFiles();
      } catch (error) {
        if (!signal.aborted) message.textContent = errorMessage(error, 'Não foi possível selecionar o anexo.');
      } finally {
        busy = false;
        choices.querySelectorAll('button').forEach(node => { node.disabled = false; });
      }
    }, true) : el('div');
    section.append(el('h3', 'Anexos'), files, choices);
    form.append(section);
    renderFiles();
    return { uploads, removed, restored, isBusy: () => busy };
  }

  async function editDialog(row, trigger) {
    const state = dialog('Editar holerite semanal', row, trigger);
    if (!state) return;
    const { body, message, signal } = state;
    message.textContent = 'Carregando dados do holerite…';
    try {
      const context = await loadEditor(row, { signal });
      if (signal.aborted) return;
      const form = el('form', '', 'hr-payslip-dialog-body');
      const fields = {};
      for (const [key, label, type] of [['supplier', 'Nome exibido', 'text'], ['branch', 'Filial', 'text'], ['date', 'Data da folha', 'date']]) {
        const field = el('label', label, 'hr-gallery-filter-field');
        const input = fields[key] = el('input', '', 'hr-gallery-filter-input');
        input.type = type;
        input.name = key;
        input.value = context[key];
        input.required = true;
        if (type === 'text') input.maxLength = 255;
        field.append(input);
        form.append(field);
      }
      const readLines = Array.isArray(context.lines) ? editRubrics(form, context.lines) : null;
      const attachments = Array.isArray(context.attachments) ? editAttachments(form, row, context.attachments, context.removedAttachments || [], state) : null;
      form.append(el('p', 'As correções atualizam o PDF do holerite. Os lançamentos financeiros da folha ficam com os dados já postados.'));
      const submit = el('button', 'Salvar alterações', 'hr-gallery-button');
      submit.type = 'submit';
      form.append(submit);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (signal.aborted || state.writing || attachments?.isBusy() || !form.reportValidity()) return;
        const draft = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
        if (readLines) {
          draft.lines = readLines();
          try { weeklyPayslipTotal(weeklyPayslipLines(draft.lines)); }
          catch (error) { message.textContent = error.message; return; }
        }
        if (attachments) {
          draft.uploads = [...attachments.uploads];
          draft.removed = [...attachments.removed];
          draft.restored = [...attachments.restored];
        }
        state.writing = true;
        const controls = [...form.querySelectorAll('input:not([disabled]), select:not([disabled]), button:not([disabled])'), state.dismiss];
        for (const field of controls) field.disabled = true;
        message.textContent = 'Salvando holerite…';
        try {
          await saveEditor(row, context, draft, { signal });
          if (signal.aborted) return;
          close(true);
          await onSaved(row, draft);
        } catch (error) {
          if (!signal.aborted) message.textContent = errorMessage(error, 'Não foi possível salvar o holerite.');
        } finally {
          state.writing = false;
          if (!signal.aborted) for (const field of controls) field.disabled = false;
        }
      });
      body.append(form);
      message.textContent = '';
    } catch (error) {
      if (!signal.aborted) message.textContent = errorMessage(error, 'Não foi possível carregar os dados do holerite.');
    }
  }

  return {
    close,
    isWriting: () => Boolean(active?.writing),
    render(row, actions) {
      const label = row.FORNECEDOR || `ID ${row.id}`;
      if ([pick, list, upload, open].every(handler => typeof handler === 'function')) {
        const uploadButton = button('📤', 'upload-payslip', () => { void uploadDialog(row, uploadButton); }, 'hr-gallery-button hr-payslip-upload');
        uploadButton.title = `Enviar ou abrir via assinada de ${label}`;
        uploadButton.setAttribute('aria-label', uploadButton.title);
        uploadButton.disabled = !row.pdfFileName;
        actions.append(uploadButton);
      }
      if ([loadEditor, saveEditor].every(handler => typeof handler === 'function')) {
        const edit = button('✏️', 'edit-payslip', () => { void editDialog(row, edit); }, 'gallery-record-action gallery-record-action--edit');
        edit.title = `Editar holerite de ${label}`;
        edit.setAttribute('aria-label', edit.title);
        edit.disabled = !row.pdfFileName;
        actions.append(edit);
      }
    },
  };
}
