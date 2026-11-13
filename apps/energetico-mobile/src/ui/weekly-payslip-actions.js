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
      const focusable = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled])')]
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

  async function uploadDialog(row, trigger) {
    const state = dialog('Via assinada do holerite', row, trigger);
    if (!state) return;
    const { body, message, signal } = state;
    const options = { signal };
    const choices = el('div', '', 'hr-payslip-dialog-options');
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
    const photos = el('div', '', 'hr-payslip-dialog-options');
    photos.hidden = true;
    for (const [source, label] of [['files', 'Enviar anexo'], ['scan', 'Escanear'], ['photo', 'Enviar foto']]) {
      const option = button(label, '', () => {
        if (source !== 'photo') { photos.hidden = true; void choose(source); }
        else { photos.hidden = !photos.hidden; option.setAttribute('aria-expanded', String(!photos.hidden)); }
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
    body.append(choices, preview, send, existing);
    setDisabled();
    try {
      const files = await list(row, options);
      if (!signal.aborted && !state.writing && !uploaded) showExisting(files);
    } catch (error) {
      if (!signal.aborted && !state.writing && !uploaded) message.textContent = errorMessage(error, 'Não foi possível consultar as vias assinadas.');
    }
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
      form.append(el('p', 'Ao salvar, o PDF será atualizado. Vias assinadas anteriores ficam disponíveis para consulta.'));
      const submit = el('button', 'Salvar alterações', 'hr-gallery-button');
      submit.type = 'submit';
      form.append(submit);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (signal.aborted || state.writing || !form.reportValidity()) return;
        state.writing = true;
        const draft = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
        for (const field of [...Object.values(fields), submit, state.dismiss]) field.disabled = true;
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
          if (!signal.aborted) for (const field of [...Object.values(fields), submit, state.dismiss]) field.disabled = false;
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
