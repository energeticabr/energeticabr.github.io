export function createCameraTags({ view, listTags, createTag, assignTag, signal, onChange }) {
  if (!listTags || !createTag || !assignTag) return null;
  const document = view.ownerDocument;
  const create = view.querySelector('[data-camera-create-tag]');
  const toolbar = view.querySelector('[data-camera-tag-toolbar]');
  const select = view.querySelector('[data-camera-tag-filter]');
  const clear = view.querySelector('[data-camera-tag-clear]');
  const retry = view.querySelector('[data-camera-tag-retry]');
  const status = view.querySelector('[data-camera-tag-status]');
  let tags = [];
  let loaded = false;
  let loadError = false;
  let refreshing = false;
  let writeGeneration = 0;
  let filter = '';
  let editor = null;
  let busy = false;
  const tagCameraId = camera => camera.cameraGroup || camera.id;
  const belongsTo = (tag, camera) => tag.cameraIds.includes(tagCameraId(camera));

  function render(visible) {
    toolbar.hidden = create.hidden = !visible;
    create.disabled = !loaded;
    select.disabled = !tags.length;
    select.value = filter;
    clear.hidden = !filter;
    select.toggleAttribute('data-filtered', Boolean(filter));
    retry.hidden = !loadError;
    retry.disabled = refreshing;
    status.textContent = loadError ? 'Não foi possível carregar as tarjas.' : '';
  }

  function setTags(next) {
    tags = next;
    if (!tags.some(tag => String(tag.id) === filter)) filter = '';
    select.length = 1;
    for (const tag of tags) {
      const option = document.createElement('option');
      option.value = String(tag.id);
      option.textContent = tag.name;
      select.append(option);
    }
    editor?.updateChoices?.();
    onChange();
  }

  async function refresh() {
    if (signal.aborted || refreshing || busy) return;
    const hadError = loadError;
    const generation = writeGeneration;
    refreshing = true;
    retry.disabled = true;
    try {
      const next = await listTags({ signal });
      if (signal.aborted || generation !== writeGeneration) return;
      const changed = !loaded || hadError || JSON.stringify(next) !== JSON.stringify(tags);
      loaded = true;
      loadError = false;
      if (changed) setTags(next);
    } catch {
      if (!signal.aborted && !loaded) {
        loadError = true;
        onChange();
      }
    } finally {
      refreshing = false;
      retry.disabled = false;
    }
  }

  function close() {
    if (!editor) return;
    const { dialog, returnFocus } = editor;
    editor = null;
    if (dialog.open) dialog.close?.();
    dialog.remove();
    if (!signal.aborted) returnFocus()?.focus({ preventScroll: true });
  }

  function openEditor(title, returnFocus, { creating = false } = {}) {
    const dialog = document.createElement('dialog');
    dialog.className = 'camera-name-editor camera-tag-editor';
    dialog.dataset.cameraTagEditor = '';
    dialog.setAttribute('aria-labelledby', 'camera-tag-editor-title');
    dialog.innerHTML = `
      <form class="camera-name-editor__form">
        <h2 id="camera-tag-editor-title"></h2>
        ${creating ? '<label for="camera-tag-name">Nome da tarja</label><input id="camera-tag-name" type="text" maxlength="60" autocomplete="off">'
          : '<fieldset class="camera-tag-editor__choices" aria-labelledby="camera-tag-editor-title"></fieldset>'}
        <p class="camera-name-editor__error" role="alert"></p>
        <div class="camera-name-editor__actions">
          <button type="button" data-camera-tag-close>${creating ? 'Cancelar' : 'Concluir'}</button>
          ${creating ? '<button type="submit">Criar</button>' : ''}
        </div>
      </form>`;
    dialog.querySelector('h2').textContent = title;
    const closeButton = dialog.querySelector('[data-camera-tag-close]');
    closeButton.addEventListener('click', close);
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      if (!busy) close();
    });
    editor = { dialog, returnFocus };
    document.body.append(dialog);
    dialog.showModal();
    return { dialog, closeButton, error: dialog.querySelector('[role="alert"]') };
  }

  create.addEventListener('click', () => {
    if (editor) return;
    const { dialog, closeButton, error } = openEditor('Criar tarja', () => create, { creating: true });
    const input = dialog.querySelector('input');
    const submit = dialog.querySelector('[type="submit"]');
    input.focus();
    dialog.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      const name = input.value.trim();
      if (!name || name.length > 60) {
        error.textContent = 'Digite um nome para a tarja com até 60 caracteres.';
        input.focus();
        return;
      }
      busy = closeButton.disabled = submit.disabled = input.readOnly = true;
      writeGeneration++;
      error.textContent = '';
      try {
        const next = await createTag(name, { signal });
        if (signal.aborted) return;
        setTags(next);
        close();
      } catch {
        if (signal.aborted) return;
        error.textContent = 'Não foi possível criar a tarja. Tente novamente.';
        input.focus();
      } finally {
        busy = closeButton.disabled = submit.disabled = input.readOnly = false;
      }
    });
  });

  function edit(camera) {
    if (editor) return;
    const { dialog, closeButton, error } = openEditor(`Tarjas de ${camera.cameraName}`, () =>
      view.querySelector(`[data-camera-tags="${camera.cameraNameId}"]`) ?? select);
    const choices = dialog.querySelector('fieldset');
    const empty = document.createElement('div');
    empty.textContent = 'Crie uma tarja para aplicá-la a esta câmera.';
    choices.append(empty);
    const inputs = new Map();
    function addChoice(tag) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      inputs.set(tag.id, checkbox);
      label.append(checkbox, tag.name);
      choices.append(label);
      checkbox.addEventListener('change', async () => {
        const assigned = checkbox.checked;
        busy = closeButton.disabled = choices.disabled = true;
        writeGeneration++;
        error.textContent = '';
        try {
          const next = await assignTag({ tagId: tag.id, cameraId: tagCameraId(camera), assigned }, { signal });
          if (signal.aborted) return;
          setTags(next);
        } catch {
          if (signal.aborted) return;
          checkbox.checked = !assigned;
          error.textContent = 'Não foi possível alterar a tarja. Tente novamente.';
        } finally {
          busy = closeButton.disabled = choices.disabled = false;
          if (!signal.aborted) checkbox.focus({ preventScroll: true });
        }
      });
      return checkbox;
    }
    editor.updateChoices = () => {
      empty.hidden = tags.length > 0;
      for (const tag of tags) {
        const checkbox = inputs.get(tag.id) ?? addChoice(tag);
        checkbox.checked = belongsTo(tag, camera);
      }
      const ids = new Set(tags.map(tag => tag.id));
      for (const [id, checkbox] of inputs) {
        if (ids.has(id)) continue;
        checkbox.parentElement.remove();
        inputs.delete(id);
      }
    };
    editor.updateChoices();
    (inputs.values().next().value ?? closeButton).focus({ preventScroll: true });
  }

  select.addEventListener('change', () => { filter = select.value; onChange(); });
  clear.addEventListener('click', () => { filter = ''; onChange(); select.focus(); });
  retry.addEventListener('click', () => { void refresh(); });

  return {
    render, refresh, close,
    get open() { return Boolean(editor); },
    get filtering() { return Boolean(filter); },
    cancel() { if (!busy) close(); },
    matches: camera => tags.some(tag => String(tag.id) === filter && belongsTo(tag, camera)),
    appendControls(heading, cluster, camera) {
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'camera-group__tags';
      plus.dataset.cameraTags = camera.cameraNameId;
      plus.disabled = !loaded;
      plus.setAttribute('aria-label', `Adicionar ou retirar tarjas de ${camera.cameraName}`);
      plus.title = 'Adicionar ou retirar tarjas';
      plus.textContent = '+';
      plus.addEventListener('click', () => edit(camera));
      heading.append(plus);

      const assigned = tags.filter(tag => belongsTo(tag, camera));
      if (!assigned.length) return;
      const chips = document.createElement('ul');
      chips.className = 'camera-group__tag-list';
      chips.setAttribute('aria-label', 'Tarjas da câmera');
      for (const tag of assigned) {
        const chip = document.createElement('li');
        chip.dataset.cameraTagChip = '';
        chip.textContent = tag.name;
        chips.append(chip);
      }
      cluster.append(chips);
    },
  };
}
