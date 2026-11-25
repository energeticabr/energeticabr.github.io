import { reportOrientation } from '../native/report-orientation.js';

const GRID_LIMIT = 8;
const THUMBNAIL_PREFIX = 'energetico:camera-preview:v1:';
const CAMERA_NAME_PREFIX = 'energetico:camera-name:v1:';
const CAMERA_VISUAL_PREFIX = 'energetico:camera-visual:v1:';
const HLS_MIME = 'application/vnd.apple.mpegurl';
const HEVC_MIME = 'video/mp4; codecs="hvc1.1.6.L120.B0"';
const GRID_RECONNECT_DELAY_MS = 12000;
const CAMERA_STATUS_REFRESH_MS = 60_000;
const LIVE_WAIT_NOTICE_MS = 2_000;
const LIVE_STALL_MS = 20_000;
const LIVE_STABLE_MS = 30_000;
const LIVE_RETRY_DELAY_MS = 4_000;
const LIVE_NETWORK_RETRIES = 2;
const LIVE_BACKGROUND_GRACE_MS = 8_000;

function thumbnailStoragePrefix(accountKey) {
  return accountKey ? `${THUMBNAIL_PREFIX}${encodeURIComponent(accountKey)}:` : '';
}

function cameraNameStoragePrefix(accountKey) {
  return accountKey ? `${CAMERA_NAME_PREFIX}${encodeURIComponent(accountKey)}:` : '';
}

function cameraVisualStorageKey(accountKey) {
  return accountKey ? `${CAMERA_VISUAL_PREFIX}${encodeURIComponent(accountKey)}` : '';
}

function isThumbnail(value) {
  return typeof value === 'string' && value.length <= 128_000
    && /^data:image\/jpeg;base64,[a-z0-9+/]+=*$/i.test(value);
}

function canPlayHevc(video) {
  if (video.canPlayType(HLS_MIME)) return Boolean(video.canPlayType(HEVC_MIME));
  const window = video.ownerDocument.defaultView;
  const mediaSource = window?.ManagedMediaSource ?? window?.MediaSource ?? window?.WebKitMediaSource;
  return mediaSource?.isTypeSupported(HEVC_MIME) === true;
}

function groupCameraChannels(channels) {
  const groups = new Map();
  for (const channel of channels) {
    const key = typeof channel.cameraGroup === 'string' && channel.cameraGroup ? channel.cameraGroup : channel;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(channel);
  }
  return [...groups.values()];
}

function formatCameraLastOnline(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function createCamerasView(documentRef) {
  let dialog, closeCurrent, suspendCurrent, resumeCurrent;

  function clearPreviews(accountKey) {
    const prefix = thumbnailStoragePrefix(accountKey);
    if (!prefix) return;
    try {
      const storage = documentRef.defaultView?.localStorage;
      for (let index = (storage?.length ?? 0) - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) storage.removeItem(key);
      }
    } catch { /* Preview storage is optional. */ }
  }

  function open({ accountKey, list, start, prepareGrid, move, listRecordings, playRecording }) {
    if (dialog) return true;
    const previousFocus = documentRef.activeElement;
    const page = new AbortController();
    let player, gridRequest, playback = [], playerChannels = [], channels = [], choosing = false;
    let refreshTimer = null, refreshing = false;
    let cameraGroups = [];
    let activeTab = 'cameras', creatingVisual = false, camerasLoaded = false, visuals = [];
    let cameraOrientationBinding = null;
    let nameEditor = null, nameEditorReturnFocus = null, nameEditorChannelId = null;
    let visualNameEditor = null, visualNameEditorReturnFocus = null;
    let playerReturnFocus = null, playerReturnChannelId = null;
    let playerSuspended = false;
    let backgroundTimer = null, backgroundSince = null;
    let thumbnailsChanged = false;
    const selected = new Set();
    const thumbnails = new Map();
    const windowRef = documentRef.defaultView;
    const storagePrefix = thumbnailStoragePrefix(accountKey);
    const nameStoragePrefix = cameraNameStoragePrefix(accountKey);
    const visualStorageKey = cameraVisualStorageKey(accountKey);

    function loadCameraNames(source = channels) {
      if (!nameStoragePrefix) return source;
      try {
        const storage = windowRef?.localStorage;
        return source.map(channel => {
          const saved = storage?.getItem(nameStoragePrefix + channel.id);
          return typeof saved === 'string' && saved.trim() && saved.trim().length <= 120
            ? { ...channel, label: saved.trim() } : channel;
        });
      } catch { return source; /* Camera names remain usable when storage is unavailable. */ }
    }

    function loadVisuals() {
      if (!visualStorageKey) return [];
      try {
        const saved = JSON.parse(windowRef?.localStorage?.getItem(visualStorageKey) ?? '[]');
        if (!Array.isArray(saved)) return [];
        const valid = [];
        for (const item of saved) {
          if (!item || typeof item !== 'object' || typeof item.name !== 'string'
              || !Array.isArray(item.cameraIds)) continue;
          const name = item.name.trim();
          if (!name || name.length > 120) continue;
          const cameraIds = [];
          for (const value of item.cameraIds) {
            if (typeof value !== 'string' && typeof value !== 'number') continue;
            const id = String(value).trim();
            if (id && !cameraIds.includes(id)) cameraIds.push(id);
            if (cameraIds.length >= GRID_LIMIT) break;
          }
          if (cameraIds.length) valid.push({ name, cameraIds });
        }
        return valid;
      } catch { return []; }
    }

    function loadThumbnails() {
      if (!storagePrefix) return;
      try {
        const storage = windowRef?.localStorage;
        for (const channel of channels) {
          const image = storage?.getItem(storagePrefix + channel.id);
          if (isThumbnail(image)) thumbnails.set(channel.id, image);
        }
      } catch { /* Preview storage is optional. */ }
    }

    function saveThumbnail(item) {
      const { video, channelId } = item;
      if (!item.connected || item.mode !== 'live' || item.controller.signal.aborted
          || video.readyState < 2 || !video.videoWidth || !video.videoHeight
          || item.thumbnailTime === video.currentTime) return;
      try {
        const canvas = documentRef.createElement('canvas');
        const scale = Math.min(1, 384 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/jpeg', 0.65);
        if (!isThumbnail(image)) return;
        thumbnails.set(channelId, image);
        item.thumbnailTime = video.currentTime;
        thumbnailsChanged = true;
        if (storagePrefix) windowRef?.localStorage?.setItem(storagePrefix + channelId, image);
      } catch { /* Canvas or storage access may be unavailable while video can still play. */ }
    }

    function saveCurrentThumbnails() {
      playback.forEach(saveThumbnail);
    }

    function updateSavedFrame(item) {
      const image = item.mode === 'live' ? thumbnails.get(item.channelId) : null;
      item.savedFrame.hidden = !image;
      if (image && item.savedFrameImage.getAttribute('src') !== image) item.savedFrameImage.src = image;
    }

    dialog = documentRef.createElement("dialog");
    dialog.className = "cameras-view";
    dialog.setAttribute("aria-label", "Câmeras");
    dialog.innerHTML = `
      <header class="cameras-header">
        <div class="cameras-header__bar"><button type="button" data-camera-back aria-label="Voltar">‹</button>
        <h1 data-camera-heading>Câmeras</h1><button type="button" data-camera-grid aria-label="Selecionar várias câmeras" title="Selecionar várias câmeras">▦</button></div>
        <nav class="cameras-header__tabs" data-camera-tabs role="tablist" aria-label="Câmeras e visuais">
          <button type="button" id="camera-tab-cameras" role="tab" aria-selected="true" data-camera-tab="cameras">Câmeras</button>
          <button type="button" id="camera-tab-visuals" role="tab" aria-selected="false" data-camera-tab="visuals">Visuais</button>
        </nav>
      </header>
      <main class="cameras-list" id="camera-panel" role="tabpanel" aria-labelledby="camera-tab-cameras">
        <p role="status" aria-live="polite"></p>
        <button class="camera-visuals__create" type="button" data-camera-create-visual hidden>＋ Criar visual</button>
        <div data-camera-cards></div>
      </main>
      <footer class="cameras-selection" hidden><span data-camera-count></span>
        <div class="cameras-selection__actions"><button type="button" data-camera-create-cancel hidden>Cancelar</button>
          <button type="button" data-camera-open-grid disabled>Abrir câmeras</button></div></footer>`;
    const status = dialog.querySelector('[role=status]');
    const cards = dialog.querySelector('[data-camera-cards]');
    const selection = dialog.querySelector('.cameras-selection');
    const background = Array.from(dialog.children);
    const gridButton = dialog.querySelector('[data-camera-grid]');
    const gridOpen = dialog.querySelector('[data-camera-open-grid]');
    const gridCancel = dialog.querySelector('[data-camera-create-cancel]');
    const count = dialog.querySelector('[data-camera-count]');
    const heading = dialog.querySelector('[data-camera-heading]');
    const tabs = dialog.querySelector('[data-camera-tabs]');
    const cameraTab = dialog.querySelector('[data-camera-tab="cameras"]');
    const visualsTab = dialog.querySelector('[data-camera-tab="visuals"]');
    const createVisualButton = dialog.querySelector('[data-camera-create-visual]');
    const cameraPanel = dialog.querySelector('#camera-panel');
    const make = (tag, className, text) => {
      const node = documentRef.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    function closeNameEditor({ restoreFocus = true } = {}) {
      if (!nameEditor) return;
      const editor = nameEditor;
      const channelId = nameEditorChannelId;
      nameEditor = null;
      nameEditorChannelId = null;
      if (editor.open && typeof editor.close === 'function') editor.close();
      editor.remove();
      if (restoreFocus) {
        const target = nameEditorReturnFocus?.isConnected ? nameEditorReturnFocus
          : dialog.querySelector(`[data-camera-rename="${channelId}"]`);
        target?.focus?.({ preventScroll: true });
      }
      nameEditorReturnFocus = null;
    }

    function editCameraName(channel, trigger) {
      if (nameEditor) return;
      const editor = documentRef.createElement('dialog');
      editor.className = 'camera-name-editor';
      editor.dataset.cameraNameEditor = '';
      editor.setAttribute('aria-labelledby', 'camera-name-editor-title');
      editor.innerHTML = `
        <form class="camera-name-editor__form" data-camera-name-form>
          <h2 id="camera-name-editor-title">Editar nome da câmera</h2>
          <label for="camera-name-editor-input">Nome da câmera</label>
          <input id="camera-name-editor-input" data-camera-name-input type="text" maxlength="120" autocomplete="off">
          <p class="camera-name-editor__error" role="alert" aria-live="polite"></p>
          <div class="camera-name-editor__actions">
            <button type="button" data-camera-name-cancel>Cancelar</button>
            <button type="submit">Salvar</button>
          </div>
        </form>`;
      const form = editor.querySelector('[data-camera-name-form]');
      const input = editor.querySelector('[data-camera-name-input]');
      const error = editor.querySelector('[role="alert"]');
      input.value = channel.label;
      nameEditor = editor;
      nameEditorReturnFocus = trigger;
      nameEditorChannelId = channel.id;
      editor.addEventListener('cancel', event => {
        event.preventDefault();
        closeNameEditor();
      });
      editor.querySelector('[data-camera-name-cancel]').addEventListener('click', () => closeNameEditor());
      form.addEventListener('submit', event => {
        event.preventDefault();
        error.textContent = '';
        const label = input.value.trim();
        if (!label || label.length > 120) {
          error.textContent = 'Digite um nome para a câmera com até 120 caracteres.';
          input.focus();
          return;
        }
        try {
          if (!nameStoragePrefix || !windowRef?.localStorage) throw new Error('Camera name storage is unavailable.');
          windowRef.localStorage.setItem(nameStoragePrefix + channel.id, label);
        } catch {
          error.textContent = 'Não foi possível salvar o nome da câmera neste dispositivo.';
          input.focus();
          return;
        }
        channel.label = label;
        render();
        closeNameEditor();
      });
      documentRef.body.append(editor);
      editor.showModal();
      input.focus({ preventScroll: true });
      input.select();
    }

    function closeVisualNameEditor({ restoreFocus = true } = {}) {
      if (!visualNameEditor) return;
      const editor = visualNameEditor;
      visualNameEditor = null;
      if (editor.open && typeof editor.close === 'function') editor.close();
      editor.remove();
      if (restoreFocus) visualNameEditorReturnFocus?.focus?.({ preventScroll: true });
      visualNameEditorReturnFocus = null;
    }

    function requestVisualName(cameraIds, trigger) {
      if (visualNameEditor || !cameraIds.length) return;
      const editor = documentRef.createElement('dialog');
      editor.className = 'camera-visual-editor';
      editor.dataset.cameraVisualEditor = '';
      editor.setAttribute('aria-labelledby', 'camera-visual-editor-title');
      editor.innerHTML = `
        <form class="camera-name-editor__form" data-camera-visual-form>
          <h2 id="camera-visual-editor-title">Nomeie seu visual</h2>
          <label for="camera-visual-editor-input">Nome do visual</label>
          <input id="camera-visual-editor-input" data-camera-visual-name type="text" maxlength="120" autocomplete="off">
          <p class="camera-name-editor__error" role="alert" aria-live="polite"></p>
          <div class="camera-name-editor__actions">
            <button type="button" data-camera-visual-cancel>Cancelar</button>
            <button type="submit">Salvar visual</button>
          </div>
        </form>`;
      const form = editor.querySelector('[data-camera-visual-form]');
      const input = editor.querySelector('[data-camera-visual-name]');
      const error = editor.querySelector('[role="alert"]');
      visualNameEditor = editor;
      visualNameEditorReturnFocus = trigger;
      editor.addEventListener('cancel', event => {
        event.preventDefault();
        event.stopPropagation();
        closeVisualNameEditor();
      });
      editor.querySelector('[data-camera-visual-cancel]').addEventListener('click', () => closeVisualNameEditor());
      form.addEventListener('submit', event => {
        event.preventDefault();
        error.textContent = '';
        const name = input.value.trim();
        if (!name || name.length > 120) {
          error.textContent = 'Digite um nome para o visual com até 120 caracteres.';
          input.focus();
          return;
        }
        const next = [...visuals, { name, cameraIds }];
        try {
          const storage = windowRef?.localStorage;
          if (!visualStorageKey || !storage) throw new Error('Visual storage is unavailable.');
          storage.setItem(visualStorageKey, JSON.stringify(next));
        } catch {
          error.textContent = 'Não foi possível salvar este visual neste dispositivo.';
          input.focus();
          return;
        }
        visuals = next;
        closeVisualNameEditor({ restoreFocus: false });
        creatingVisual = false;
        choosing = false;
        activeTab = 'visuals';
        selected.clear();
        status.textContent = 'Visual salvo.';
        render();
        dialog.querySelector(`[data-camera-visual-open="${visuals.length - 1}"]`)?.focus?.({ preventScroll: true });
      });
      documentRef.body.append(editor);
      editor.showModal();
      input.focus({ preventScroll: true });
    }

    function openVisual(visual, trigger) {
      const available = new Map(channels.map(channel => [String(channel.id), channel]));
      const chosen = visual.cameraIds.map(id => available.get(String(id))).filter(Boolean);
      const missing = visual.cameraIds.length - chosen.length;
      if (!chosen.length) {
        status.textContent = 'Nenhuma câmera deste visual está disponível agora.';
        return;
      }
      let notice = '';
      if (missing) {
        const noun = missing === 1 ? 'câmera' : 'câmeras';
        const verb = missing === 1 ? 'não está' : 'não estão';
        notice = `${missing} ${noun} deste visual ${verb} disponível${missing === 1 ? '' : 'is'} agora.`;
        status.textContent = notice;
      } else status.textContent = '';
      openPlayer(groupCameraChannels(chosen).flat(), trigger, { visualName: visual.name, notice });
    }

    function render() {
      cards.replaceChildren();
      tabs.hidden = creatingVisual;
      heading.textContent = creatingVisual ? 'Selecione câmeras' : 'Câmeras';
      cameraTab.setAttribute('aria-selected', String(activeTab === 'cameras'));
      visualsTab.setAttribute('aria-selected', String(activeTab === 'visuals'));
      cameraPanel.setAttribute('aria-labelledby', activeTab === 'visuals' ? 'camera-tab-visuals' : 'camera-tab-cameras');
      createVisualButton.hidden = activeTab !== 'visuals' || creatingVisual;
      createVisualButton.disabled = channels.length === 0;
      gridButton.hidden = creatingVisual || activeTab !== 'cameras';
      selection.hidden = !choosing;
      gridCancel.hidden = !creatingVisual;
      gridButton.setAttribute('aria-pressed', String(choosing));
      count.textContent = `${selected.size} de ${GRID_LIMIT} selecionadas`;
      gridOpen.textContent = creatingVisual ? 'Criar visual' : 'Abrir câmeras';
      gridOpen.disabled = selected.size === 0;

      if (activeTab === 'visuals' && !creatingVisual) {
        visuals.forEach((visual, index) => {
          const card = make('article', 'camera-visual-card');
          card.dataset.cameraVisualCard = String(index);
          const details = make('div', 'camera-visual-card__details');
          details.append(make('strong', 'camera-visual-card__name', visual.name));
          details.append(make('span', 'camera-visual-card__count', `${visual.cameraIds.length} ${visual.cameraIds.length === 1 ? 'câmera' : 'câmeras'}`));
          const openButton = make('button', 'camera-visual-card__open', 'Abrir visual');
          openButton.type = 'button'; openButton.dataset.cameraVisualOpen = String(index);
          openButton.setAttribute('aria-label', `Abrir visual ${visual.name}`);
          openButton.addEventListener('click', () => openVisual(visual, openButton));
          card.append(details, openButton);
          cards.append(card);
        });
        if (!visuals.length && camerasLoaded && !status.textContent) status.textContent = 'Nenhum visual salvo.';
        return;
      }

      for (const group of cameraGroups) {
        if (group.length === 1) {
          cards.append(createCameraCard(group[0]));
          continue;
        }
        const cluster = make('section', 'camera-group');
        const title = make('h2', 'camera-group__title', group[0].cameraLabel || 'Câmera');
        title.id = `camera-group-${group[0].id}`;
        cluster.setAttribute('aria-labelledby', title.id);
        const groupCards = make('div', 'camera-group__cards');
        groupCards.append(...group.map(createCameraCard));
        cluster.append(title, groupCards);
        cards.append(cluster);
      }
    }

    function createCameraCard(channel) {
      const card = make('article', 'camera-card');
      const heading = make('div', 'camera-card__heading');
      const cameraStatus = channel.status === 'online' || channel.status === 'offline' ? channel.status : 'unknown';
      const symbol = make('span', `camera-card__wifi camera-card__wifi--${cameraStatus}`, '◉');
      symbol.setAttribute('aria-label', cameraStatus === 'online' ? 'On-line'
        : cameraStatus === 'offline' ? 'Off-line' : 'Status desconhecido');
      const title = make('strong', '', channel.label);
      const rename = make('button', 'camera-card__rename');
      rename.type = 'button'; rename.dataset.cameraRename = channel.id;
      rename.setAttribute('aria-label', `Editar nome da câmera ${channel.label}`);
      rename.title = 'Editar nome da câmera';
      rename.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 16.5V20h3.5L18.7 8.8l-3.5-3.5L4 16.5Zm17-10.1a1 1 0 0 0 0-1.4l-2-2a1 1 0 0 0-1.4 0l-1.7 1.7 3.5 3.5L21 6.4Z"/></svg>';
      rename.addEventListener('click', () => editCameraName(channel, rename));
      heading.append(symbol, title, rename);
      if (choosing) {
        const checkbox = documentRef.createElement('input');
        checkbox.type = 'checkbox'; checkbox.dataset.cameraSelect = channel.id;
        checkbox.setAttribute('aria-label', `Selecionar ${channel.label}`);
        checkbox.checked = selected.has(channel.id);
        checkbox.disabled = !checkbox.checked && selected.size >= GRID_LIMIT;
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(channel.id); else selected.delete(channel.id);
          render();
        });
        heading.append(checkbox);
      }
      const openButton = make('button', 'camera-card__preview');
      openButton.type = 'button'; openButton.dataset.cameraOpen = channel.id;
      const lastOnline = cameraStatus === 'offline' ? formatCameraLastOnline(channel.lastOnlineAt) : null;
      openButton.setAttribute('aria-label', `Abrir ${channel.label}${cameraStatus === 'offline'
        ? `, câmera off-line. ${lastOnline ? `Última vez on-line: ${lastOnline}` : 'Sem registro de conexão'}` : ''}`);
      if (thumbnails.has(channel.id)) {
        const image = documentRef.createElement('img');
        image.className = 'camera-card__image'; image.src = thumbnails.get(channel.id); image.alt = '';
        openButton.append(image);
      }
      if (cameraStatus === 'offline') {
        const ribbon = make('span', 'camera-card__status-ribbon', 'OFF-LINE');
        ribbon.dataset.cameraStatus = '';
        ribbon.setAttribute('role', 'status');
        openButton.append(ribbon, make('span', 'camera-card__last-online', lastOnline
          ? `Última vez on-line: ${lastOnline}` : 'Sem registro de conexão'));
      }
      const play = make('span', 'camera-card__play', '▶'); play.setAttribute('aria-hidden', 'true');
      const caption = make('span', 'camera-card__caption', 'Toque para ver ao vivo');
      openButton.append(play, caption);
      openButton.addEventListener('click', () => {
        if (choosing) {
          if (selected.has(channel.id)) selected.delete(channel.id);
          else if (selected.size < GRID_LIMIT) selected.add(channel.id);
          render();
        } else openPlayer([channel], openButton);
      });
      card.append(heading, openButton);
      return card;
    }

    function sameChannels(next) {
      return channels.length === next.length && channels.every((channel, index) => {
        const current = next[index];
        return channel.id === current.id && channel.label === current.label
          && channel.status === current.status && channel.lastOnlineAt === current.lastOnlineAt
          && channel.cameraGroup === current.cameraGroup && channel.cameraLabel === current.cameraLabel;
      });
    }

    async function refreshChannels({ initial = false } = {}) {
      if (page.signal.aborted || player || (!initial && documentRef.hidden) || refreshing) return;
      refreshing = true;
      try {
        const result = await list({ signal: page.signal });
        if (page.signal.aborted) return;
        const nextChannels = loadCameraNames(result.map(channel => ({ ...channel })));
        const nextGroups = groupCameraChannels(nextChannels);
        const flatNextChannels = nextGroups.flat();
        const initial = !camerasLoaded;
        const changed = initial || !sameChannels(flatNextChannels);
        if (initial) visuals = loadVisuals();
        camerasLoaded = true;
        if (changed) {
          const focused = documentRef.activeElement;
          const focusedOpenId = focused?.dataset?.cameraOpen;
          const focusedSelectId = focused?.dataset?.cameraSelect;
          const focusGrid = focused === gridButton;
          cameraGroups = nextGroups;
          channels = flatNextChannels;
          for (const id of selected) if (!channels.some(channel => channel.id === id)) selected.delete(id);
          loadThumbnails();
          status.textContent = creatingVisual ? 'Selecione até 8 câmeras para este visual.'
            : activeTab === 'visuals' ? visuals.length ? '' : 'Nenhum visual salvo.'
              : channels.length ? '' : 'Nenhuma câmera está disponível para sua conta.';
          render();
          if (focusGrid && !gridButton.hidden) gridButton.focus({ preventScroll: true });
          else if (focusedOpenId && activeTab === 'cameras' && !creatingVisual) Array.from(dialog.querySelectorAll('[data-camera-open]'))
            .find(button => button.dataset.cameraOpen === focusedOpenId)?.focus({ preventScroll: true });
          else if (focusedSelectId && activeTab === 'cameras' && choosing) Array.from(dialog.querySelectorAll('[data-camera-select]'))
            .find(input => input.dataset.cameraSelect === focusedSelectId)?.focus({ preventScroll: true });
        }
      } catch (error) {
        if (initial && !page.signal.aborted) status.textContent = error.message || 'Não foi possível carregar as câmeras.';
      } finally {
        refreshing = false;
      }
    }

    function detachVideo(item) {
      item.hls?.destroy();
      item.hls = null;
      item.video.pause();
      item.video.removeAttribute('src');
      item.video.load();
    }

    function stopPlayer({ restoreFocus = true, preserveReturnFocus = false } = {}) {
      const hadPlayer = Boolean(player);
      clearBackgroundTimer();
      saveCurrentThumbnails();
      gridRequest?.abort(); gridRequest = null;
      for (const item of playback) {
        item.controller.abort();
        item.searchController?.abort();
        detachVideo(item);
      }
      playback = [];
      playerChannels = [];
      playerSuspended = false;
      player?.remove(); player = null;
      for (const node of background) node.inert = false;
      if (thumbnailsChanged) {
        thumbnailsChanged = false;
        render();
      }
      if (hadPlayer && restoreFocus) {
        const target = playerReturnFocus?.isConnected ? playerReturnFocus
          : playerReturnChannelId
            ? Array.from(dialog.querySelectorAll('[data-camera-open]')).find(button => button.dataset.cameraOpen === playerReturnChannelId)
            : dialog.querySelector('[data-camera-back]');
        target?.focus?.({ preventScroll: true });
      }
      if (hadPlayer && !preserveReturnFocus) { playerReturnFocus = null; playerReturnChannelId = null; }
    }
    function suspendPlayer() {
      clearBackgroundTimer();
      if (!player || playerSuspended) return;
      saveCurrentThumbnails();
      playerSuspended = true;
      gridRequest?.abort(); gridRequest = null;
      for (const item of playback) {
        item.controller.abort();
        if (item.searchController) {
          item.searchController.abort(); item.searchController = null;
          if (item.searchButton) item.searchButton.disabled = false;
          if (item.searchResults?.textContent === 'Consultando gravações…') {
            item.searchResults.textContent = 'Busca interrompida. Toque em Buscar para tentar novamente.';
          }
        }
        item.connected = false;
        item.networkRetries = 0;
        item.connectionState = 'connecting'; item.failureLabel = '';
        item.liveBadge.hidden = true;
        item.status.dataset.loading = 'true';
        item.status.textContent = 'Retomando transmissão…';
        item.updateControls?.(); item.updateHeader?.();
        detachVideo(item);
        updateSavedFrame(item);
      }
    }
    function connectPlayer() {
      let startPlayback = start;
      if (playerChannels.length > 1 && prepareGrid) {
        gridRequest = new AbortController();
        startPlayback = prepareGrid(playerChannels.map(channel => channel.id), {
          signal: gridRequest.signal, codecs: playback[0]?.codecs ?? [],
        });
      }
      playerChannels.forEach((channel, index) => {
        void connect(playback[index], channel, playback[index].recordingId ?? null, startPlayback,
          { preserveViewState: true });
      });
    }
    function clearBackgroundTimer() {
      if (backgroundTimer !== null) windowRef.clearTimeout(backgroundTimer);
      backgroundTimer = null;
      const since = backgroundSince;
      backgroundSince = null;
      return since;
    }
    function scheduleSuspension() {
      if (!player || playerSuspended || backgroundTimer !== null) return;
      if (!playback.some(item => item.mode === 'live' && item.connected)) {
        suspendPlayer();
        return;
      }
      backgroundSince = windowRef.Date.now();
      backgroundTimer = windowRef.setTimeout(suspendPlayer, LIVE_BACKGROUND_GRACE_MS);
    }
    function resumePlayer() {
      if (!player || documentRef.hidden) return;
      const since = clearBackgroundTimer();
      if (!playerSuspended) {
        if (since === null) return;
        if (windowRef.Date.now() - since < LIVE_BACKGROUND_GRACE_MS) {
          for (const item of playback) {
            if (item.played && item.connectionState !== 'error' && !item.cancelRecovery && item.video.paused) {
              void item.video.play().catch(() => {});
            }
          }
          return;
        }
        suspendPlayer();
      }
      playerSuspended = false;
      connectPlayer();
    }
    function close() {
      page.abort();
      if (refreshTimer !== null) windowRef?.clearInterval(refreshTimer);
      refreshTimer = null;
      closeNameEditor({ restoreFocus: false });
      closeVisualNameEditor({ restoreFocus: false });
      stopPlayer({ restoreFocus: false });
      cameraOrientationBinding?.destroy(); cameraOrientationBinding = null;
      documentRef.removeEventListener('visibilitychange', visibilityChanged);
      windowRef?.removeEventListener('pagehide', pageHidden);
      windowRef?.removeEventListener('pageshow', pageShown);
      dialog.remove(); dialog = null; closeCurrent = null;
      suspendCurrent = null; resumeCurrent = null;
      previousFocus?.focus?.();
    }
    function visibilityChanged() {
      if (documentRef.hidden) scheduleSuspension();
      else resumePlayer();
    }
    function pageHidden() { saveCurrentThumbnails(); suspendPlayer(); }
    function pageShown() { resumePlayer(); }
    function clearWaiting(item) {
      if (item.waitingTimer === null) return;
      windowRef.clearTimeout(item.waitingTimer);
      item.waitingTimer = null;
    }
    function showWaiting(item, reconnecting) {
      item.connected = false;
      item.connectionState = reconnecting ? 'waiting' : 'connecting';
      item.failureLabel = '';
      item.liveBadge.hidden = true;
      item.status.textContent = reconnecting ? 'Reconectando…'
        : item.mode === 'playback' ? 'Abrindo gravação…' : 'Conectando…';
      item.status.dataset.loading = 'true';
      item.updateControls?.(); item.updateHeader?.();
    }
    async function connect(item, channel, recordingId = null, startPlayback = start, { preserveViewState = false } = {}) {
      saveThumbnail(item);
      item.controller.abort();
      item.onPlaybackError = null;
      detachVideo(item);
      item.controller = new AbortController();
      if (Boolean(item.recordingId) !== Boolean(recordingId)) item.networkRetries = 0;
      item.recordingId = recordingId;
      item.mode = recordingId ? 'playback' : 'live';
      updateSavedFrame(item);
      item.thumbnailTime = null;
      item.played = false;
      item.playingSince = null;
      item.waitStartedAt = null;
      const reconnecting = !recordingId && item.networkRetries > 0;
      item.connected = false; item.connectionState = reconnecting ? 'waiting' : 'connecting'; item.failureLabel = '';
      item.playAttempted = false; item.retry.hidden = true; item.updateControls?.();
      item.retry.textContent = 'Tentar reproduzir';
      item.reconnect = null;
      if (!preserveViewState) {
        item.video.muted = true; item.video.defaultMuted = true;
        item.collapseDrawer?.();
      }
      item.liveBadge.hidden = true;
      if (item.audioButton && !preserveViewState) {
        item.audioButton.setAttribute('aria-pressed', 'false');
        item.audioButton.querySelector('.cameras-player__action-label').textContent = 'Áudio';
      }
      item.status.dataset.loading = 'true';
      item.updateHeader?.();
      const { signal } = item.controller;
      signal.addEventListener('abort', () => {
        clearWaiting(item);
        item.cancelRecovery?.();
      }, { once: true });
      item.status.textContent = recordingId ? 'Abrindo gravação…'
        : reconnecting ? 'Reconectando…' : 'Conectando…';
      function tryAutoplay() {
        if (signal.aborted || item.playAttempted || item.connectionState === 'error') return;
        item.playAttempted = true;
        item.connectionState = reconnecting ? 'waiting' : 'connecting'; item.failureLabel = '';
        item.retry.hidden = true;
        item.status.textContent = recordingId ? 'Abrindo gravação…' : reconnecting ? 'Reconectando…' : 'Conectando…';
        item.status.dataset.loading = 'true';
        let attempt;
        try { attempt = item.video.play(); }
        catch (error) { playbackRejected(error); return; }
        Promise.resolve(attempt).catch(playbackRejected);
      }
      function playbackRejected(error) {
        if (signal.aborted) return;
        item.connected = false; item.connectionState = 'error';
        item.failureLabel = error?.name === 'NotAllowedError' ? 'Autoplay bloqueado' : 'Falha na reprodução';
        item.liveBadge.hidden = true;
        item.status.dataset.loading = 'false';
        item.status.textContent = error?.name === 'NotAllowedError'
          ? 'A reprodução automática foi bloqueada pelo navegador.' : 'Não foi possível iniciar o vídeo.';
        item.retry.hidden = false;
        item.updateControls?.(); item.updateHeader?.();
      }
      item.retry.onclick = () => {
        if (signal.aborted) return;
        item.playAttempted = false; item.connectionState = 'connecting'; item.failureLabel = '';
        item.status.dataset.loading = 'true'; item.status.textContent = 'Conectando…';
        item.retry.hidden = true; item.updateHeader?.();
        tryAutoplay();
      };
      item.video.addEventListener('canplay', tryAutoplay, { once: true });
      const reopenLive = previousUrl => {
        const open = item.preview && prepareGrid
          ? (id, options) => prepareGrid([id], { ...options, previousUrl })(id, options)
          : start;
        void connect(item, channel, null, open, { preserveViewState: true });
      };
      const retryCompatible = previousUrl => {
        item.codecs = [];
        reopenLive(previousUrl);
      };
      function retryNetwork(resumeOfflineAttempt = false) {
        if (item.cancelRecovery) return true;
        const pauseStarted = item.waitStartedAt ?? windowRef.Date.now();
        if (item.playingSince !== null && pauseStarted - item.playingSince >= LIVE_STABLE_MS) {
          item.networkRetries = 0;
        }
        if (!resumeOfflineAttempt) {
          if (item.networkRetries >= LIVE_NETWORK_RETRIES) return false;
          item.networkRetries += 1;
        }
        item.playingSince = null;
        showWaiting(item, true);
        function recoverWhenOnline() {
          item.cancelRecovery?.();
          if (signal.aborted) return;
          if (windowRef.navigator.onLine === false) {
            windowRef.addEventListener('online', recoverWhenOnline, { once: true });
            item.cancelRecovery = () => {
              windowRef.removeEventListener('online', recoverWhenOnline);
              item.cancelRecovery = null;
            };
            return;
          }
          reopenLive();
        }
        if (item.networkRetries > 1 && windowRef.navigator.onLine !== false) {
          const timer = windowRef.setTimeout(recoverWhenOnline, LIVE_RETRY_DELAY_MS);
          item.cancelRecovery = () => {
            windowRef.clearTimeout(timer);
            item.cancelRecovery = null;
          };
        } else recoverWhenOnline();
        return true;
      }
      function offerLiveRetry() {
        item.reconnect = () => {
          item.networkRetries = 0;
          reopenLive();
        };
        item.retry.textContent = 'Tentar novamente';
        item.retry.onclick = item.reconnect;
        if (item.preview) item.status.textContent += ' Toque no vídeo para tentar novamente.';
        else item.retry.hidden = false;
      }
      const showDisconnected = message => {
        item.cancelRecovery?.();
        saveThumbnail(item);
        item.connected = false;
        item.connectionState = 'error'; item.failureLabel = 'Transmissão interrompida';
        item.onPlaybackError = null;
        detachVideo(item);
        updateSavedFrame(item);
        item.liveBadge.hidden = true;
        item.status.dataset.loading = 'false'; item.retry.hidden = true;
        item.updateControls?.();
        item.updateHeader?.();
        item.status.textContent = message;
        if (!recordingId) offerLiveRetry();
      };
      try {
        const nativeHls = item.video.canPlayType(HLS_MIME);
        const [url, playerModule] = await Promise.all([
          recordingId ? playRecording(channel.id, recordingId, { signal })
            : startPlayback(channel.id, { signal, codecs: item.codecs }),
          nativeHls ? null : import('hls.js'),
        ]);
        if (signal.aborted) return;
        const failed = (network = false) => {
          if (signal.aborted) return;
          clearWaiting(item);
          if (!recordingId && network && (item.played || item.networkRetries) && retryNetwork()) return;
          if (!recordingId && !network && item.codecs.length && /\/(?:h264|hevc)\.m3u8$/.test(new URL(url).pathname)) {
            retryCompatible(url);
            return;
          }
          showDisconnected('Transmissão interrompida.');
        };
        item.onPlaybackError = failed;
        if (nativeHls) {
          item.video.src = url;
          item.video.load();
          if (item.video.readyState >= 3) tryAutoplay();
        }
        else {
          const { default: Hls } = playerModule;
          if (!Hls.isSupported()) throw new Error('Reprodução não disponível neste dispositivo.');
          item.hls = new Hls(recordingId ? { maxBufferLength: 8 }
            : { maxBufferLength: 12, maxMaxBufferLength: 16, backBufferLength: 8 });
          item.hls.on(Hls.Events.ERROR, (_event, details) => {
            if (details.fatal) failed(details.type === Hls.ErrorTypes.NETWORK_ERROR);
          });
          item.hls.on(Hls.Events.MANIFEST_PARSED, tryAutoplay);
          item.hls.loadSource(url); item.hls.attachMedia(item.video);
        }
      } catch (error) {
        if (signal.aborted) return;
        const directUnavailable = error?.status === 404 || error?.status === 503;
        const networkUnavailable = error?.code === 'NETWORK_UNAVAILABLE' || error instanceof TypeError;
        const recoverable = directUnavailable || error?.status === 429 || networkUnavailable;
        const offline = networkUnavailable && windowRef.navigator.onLine === false;
        if (!recordingId && item.networkRetries && recoverable && retryNetwork(offline)) return;
        if (!recordingId && item.codecs.length && directUnavailable) {
          retryCompatible();
          return;
        }
        item.connected = false; item.connectionState = 'error'; item.failureLabel = 'Falha ao conectar';
        item.liveBadge.hidden = true; item.status.dataset.loading = 'false';
        item.retry.hidden = true; item.updateControls?.(); item.updateHeader?.();
        item.status.textContent = error?.message || 'Não foi possível abrir esta câmera.';
        if (!recordingId) offerLiveRetry();
      }
    }
    function openPlayer(chosen, trigger = documentRef.activeElement, { visualName = '', notice = '' } = {}) {
      const preview = chosen.length > 1;
      const replacingPlayer = Boolean(player);
      if (!replacingPlayer) {
        playerReturnFocus = trigger;
        playerReturnChannelId = playerReturnFocus?.dataset?.cameraOpen || null;
      }
      stopPlayer({ restoreFocus: false, preserveReturnFocus: replacingPlayer });
      playerChannels = chosen;
      for (const node of background) node.inert = true;
      player = make('div', 'cameras-player');
      player.dataset.count = String(chosen.length);
      if (chosen.length > 4) player.classList.add('cameras-player--wall');
      player.setAttribute('role', 'group'); player.setAttribute('aria-label', 'Visualizador de câmeras');
      const panel = make('section', 'cameras-player__panel');
      const header = make('header', 'cameras-player__header');
      const back = make('button', 'cameras-player__back', '‹'); back.type = 'button'; back.dataset.cameraPlayerBack = '';
      back.setAttribute('aria-label', 'Voltar para a lista de câmeras');
      back.addEventListener('click', stopPlayer);
      const title = make('strong', 'cameras-player__title', visualName || (chosen.length === 1 ? chosen[0].label : `${chosen.length} câmeras`));
      const liveState = make('span', 'cameras-player__live-state', 'Conectando…');
      liveState.setAttribute('role', 'status');
      const expand = make('button', 'cameras-player__expand', '⛶'); expand.type = 'button';
      expand.dataset.cameraExpand = ''; expand.setAttribute('aria-label', 'Expandir vídeo'); expand.setAttribute('aria-pressed', 'false');
      expand.addEventListener('click', () => {
        const expanded = player.dataset.expanded !== 'true';
        player.dataset.expanded = String(expanded);
        expand.setAttribute('aria-pressed', String(expanded));
        expand.setAttribute('aria-label', expanded ? 'Restaurar controles' : 'Expandir vídeo');
      });
      header.append(back, title, liveState, expand);
      const visualNotice = notice ? make('p', 'cameras-player__visual-notice', notice) : null;
      visualNotice?.setAttribute('role', 'status');
      const stage = make('main', 'cameras-player__stage');
      stage.dataset.count = String(chosen.length);
      const tileItems = [];
      let focusedCameraId = null;
      let pendingCameraTap = null;
      function toggleCameraFocus(channel) {
        focusedCameraId = focusedCameraId === String(channel.id) ? null : String(channel.id);
        stage.dataset.focused = String(Boolean(focusedCameraId));
        for (const { tile, channel: tileChannel } of tileItems) {
          tile.hidden = Boolean(focusedCameraId && String(tileChannel.id) !== focusedCameraId);
        }
      }
      for (const channel of chosen) {
        const tile = make('div', 'cameras-player__tile');
        const video = documentRef.createElement('video');
        video.autoplay = true; video.muted = true; video.defaultMuted = true; video.controls = false;
        video.playsInline = true; video.preload = 'auto';
        video.setAttribute('autoplay', ''); video.setAttribute('muted', ''); video.setAttribute('playsinline', '');
        video.crossOrigin = 'anonymous'; video.setAttribute('aria-label', channel.label);
        video.dataset.cameraVideo = channel.id;
        if (preview && chosen.length > 1) {
          video.classList.add('cameras-player__video--focusable');
          video.title = 'Toque duas vezes para ampliar; toque duas vezes novamente para ver todas as câmeras.';
          video.tabIndex = 0;
        }
        const label = make('span', 'cameras-player__label', channel.label);
        const savedFrame = make('div', 'cameras-player__saved-frame');
        savedFrame.hidden = true;
        const savedFrameImage = make('img', 'cameras-player__saved-image');
        savedFrameImage.alt = '';
        savedFrame.append(savedFrameImage);
        const footer = make('div', 'cameras-player__tile-footer');
        footer.append(make('span', 'cameras-player__saved-label', 'Última imagem'));
        const liveBadge = make('span', 'cameras-player__tile-live', '● AO VIVO');
        liveBadge.hidden = true;
        const notice = make('span', 'cameras-player__status', 'Conectando…'); notice.setAttribute('role', 'status'); notice.dataset.loading = 'true';
        const retry = make('button', 'cameras-player__retry', 'Tentar reproduzir'); retry.type = 'button';
        retry.dataset.cameraPlayRetry = ''; retry.hidden = true;
        const item = { controller: new AbortController(), video, status: notice, retry, liveBadge,
          savedFrame, savedFrameImage, hls: null,
          mode: 'live', connected: false, connectionState: 'connecting', failureLabel: '', playAttempted: false,
          preview, channelId: channel.id, recordingId: null, searchButton: null, searchResults: null,
          thumbnailTime: null, played: false, networkRetries: 0, playingSince: null, waitStartedAt: null,
          waitingTimer: null, cancelRecovery: null, reconnect: null,
          codecs: canPlayHevc(video) ? ['h264', 'hevc'] : ['h264'] };
        video.addEventListener('playing', () => {
          if (item.controller.signal.aborted || item.connectionState === 'error') return;
          clearWaiting(item);
          item.cancelRecovery?.();
          if (item.playingSince === null || item.connectionState === 'waiting') item.playingSince = windowRef.Date.now();
          item.waitStartedAt = null;
          item.played = true; item.connected = true; item.connectionState = 'playing'; item.failureLabel = '';
          item.status.textContent = ''; item.status.dataset.loading = 'false'; item.retry.hidden = true;
          item.savedFrame.hidden = true;
          item.liveBadge.hidden = item.mode !== 'live';
          if (item.thumbnailTime === null) saveThumbnail(item);
          item.updateControls?.(); item.updateHeader?.();
        });
        video.addEventListener('waiting', () => {
          if (item.controller.signal.aborted || item.connectionState === 'error') return;
          if (item.mode !== 'live' || !item.played) {
            showWaiting(item, item.played || (item.mode === 'live' && item.networkRetries > 0));
            return;
          }
          if (item.waitingTimer !== null || item.cancelRecovery) return;
          item.waitStartedAt = windowRef.Date.now();
          item.waitingTimer = windowRef.setTimeout(() => {
            showWaiting(item, true);
            item.waitingTimer = windowRef.setTimeout(() => {
              item.waitingTimer = null;
              item.onPlaybackError?.(true);
            }, LIVE_STALL_MS - LIVE_WAIT_NOTICE_MS);
          }, LIVE_WAIT_NOTICE_MS);
        });
        video.addEventListener('error', () => {
          const code = video.error?.code;
          if (!item.controller.signal.aborted) item.onPlaybackError?.(code === 2 || (code === 4 && item.played));
        });
        if (preview) {
          const resume = () => {
            if (item.reconnect) { item.reconnect(); return; }
            if (item.connected && video.paused) void video.play().catch(() => {});
          };
          video.addEventListener('click', event => {
            resume();
            if (chosen.length < 2) return;
            const now = Date.now();
            const isDoubleTap = pendingCameraTap?.channelId === channel.id
              && now - pendingCameraTap.time <= 400
              && Math.hypot(event.clientX - pendingCameraTap.x, event.clientY - pendingCameraTap.y) <= 32;
            if (isDoubleTap) {
              pendingCameraTap = null;
              toggleCameraFocus(channel);
            } else pendingCameraTap = { channelId: channel.id, time: now, x: event.clientX, y: event.clientY };
          });
          video.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); resume();
            }
          });
        }
        playback.push(item); tileItems.push({ tile, video, item, channel });
        tile.append(video, savedFrame, label, liveBadge, notice, retry, footer);
        if (chosen.length > 1 && (move || listRecordings)) {
          tile.classList.add('cameras-player__tile--focusable');
          const focus = make('button', 'cameras-player__focus', '1 tela');
          focus.type = 'button'; focus.setAttribute('aria-label', `Abrir ${channel.label} em tela individual`);
          focus.addEventListener('click', () => openPlayer([channel], focus));
          footer.append(focus);
        }
        stage.append(tile);
      }
      function updateHeader() {
        const connected = playback.filter(item => item.connectionState === 'playing' && item.mode === 'live').length;
        liveState.textContent = chosen.length === 1
          ? (playback[0].connectionState === 'playing'
            ? (playback[0].mode === 'live' ? 'AO VIVO' : 'GRAVAÇÃO')
            : playback[0].connectionState === 'error' ? (playback[0].failureLabel || 'Falha ao reproduzir')
              : playback[0].connectionState === 'waiting' ? 'Reconectando…'
                : playback[0].mode === 'playback' ? 'Abrindo gravação…' : 'Conectando…')
          : (connected === chosen.length ? 'AO VIVO' : connected ? `${connected}/${chosen.length} ao vivo`
            : playback.every(item => item.connectionState === 'error') ? 'Falha ao conectar'
              : playback.some(item => item.connectionState === 'waiting') ? 'Reconectando…' : 'Conectando…');
        liveState.dataset.mode = chosen.length === 1 && playback[0]?.mode === 'playback' ? 'playback' : 'live';
        liveState.dataset.connected = String(chosen.length > 0 && playback.every(item => item.connectionState === 'playing'));
        liveState.dataset.state = chosen.length === 1 ? playback[0]?.connectionState || 'connecting' : 'group';
      }
      playback.forEach(item => { item.updateHeader = updateHeader; });

      const actions = make('nav', 'cameras-player__actions'); actions.setAttribute('aria-label', 'Controles da câmera');
      const controlStatus = make('p', 'cameras-player__control-status'); controlStatus.setAttribute('role', 'status');
      let drawer, ptzPanel;
      if (chosen.length === 1) {
        const { channel } = tileItems[0]; const item = playback[0];
        const actionButton = (key, glyph, label) => {
          const button = make('button', 'cameras-player__action'); button.type = 'button'; button.dataset[key] = '';
          const icon = make('span', 'cameras-player__action-icon', glyph); icon.setAttribute('aria-hidden', 'true');
          const caption = make('span', 'cameras-player__action-label', label); button.append(icon, caption);
          return button;
        };
        if (move) {
          const ptzToggle = actionButton('cameraPtz', '⊙', 'PTZ'); ptzToggle.setAttribute('aria-expanded', 'false');
          ptzPanel = make('aside', 'cameras-player__ptz'); ptzPanel.hidden = true;
          ptzPanel.setAttribute('aria-label', 'Direções da câmera');
          const arrows = make('div', 'cameras-player__arrows'); const buttons = [];
          for (const [direction, label, symbol] of [['up','Mover para cima','↑'],['left','Mover para a esquerda','←'],['down','Mover para baixo','↓'],['right','Mover para a direita','→']]) {
            const button = make('button', 'cameras-player__arrow', symbol); button.type = 'button'; button.dataset.cameraMove = direction;
            button.setAttribute('aria-label', label); button.disabled = true;
            button.addEventListener('click', async () => {
              button.disabled = true;
              try { await move(channel.id, direction, { signal: item.controller.signal }); controlStatus.textContent = 'Comando enviado.'; }
              catch (error) { if (!item.controller.signal.aborted) controlStatus.textContent = error.message || 'Não foi possível mover a câmera.'; }
              finally { item.updateControls(); }
            });
            arrows.append(button); buttons.push(button);
          }
          item.updateControls = () => { for (const button of buttons) button.disabled = !item.connected || item.mode !== 'live'; };
          ptzToggle.addEventListener('click', () => {
            const expanded = ptzPanel.hidden; ptzPanel.hidden = !expanded;
            ptzToggle.setAttribute('aria-expanded', String(expanded));
          });
          ptzPanel.append(arrows); actions.append(ptzToggle);
        }
        const audioButton = actionButton('cameraAudio', '◖', 'Áudio'); audioButton.setAttribute('aria-pressed', 'false');
        item.audioButton = audioButton;
        audioButton.addEventListener('click', () => {
          item.video.muted = !item.video.muted;
          audioButton.setAttribute('aria-pressed', String(!item.video.muted));
          audioButton.querySelector('.cameras-player__action-label').textContent = item.video.muted ? 'Áudio' : 'Som ligado';
        });
        const snapshotButton = actionButton('cameraSnapshot', '▣', 'Foto');
        snapshotButton.addEventListener('click', () => {
          if (!item.video.videoWidth || !item.video.videoHeight) { controlStatus.textContent = 'A imagem ainda está carregando.'; return; }
          try {
            const canvas = documentRef.createElement('canvas');
            canvas.width = item.video.videoWidth; canvas.height = item.video.videoHeight;
            canvas.getContext('2d').drawImage(item.video, 0, 0, canvas.width, canvas.height);
            const anchor = make('a', '');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const safeName = channel.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'camera';
            anchor.href = canvas.toDataURL('image/jpeg', 0.9); anchor.download = `energetico-${safeName}-${stamp}.jpg`;
            documentRef.body.append(anchor); anchor.click(); anchor.remove();
            controlStatus.textContent = 'Imagem capturada.';
          } catch { controlStatus.textContent = 'Não foi possível capturar a imagem desta transmissão.'; }
        });
        actions.append(audioButton, snapshotButton);

        if (listRecordings && playRecording) {
          const recordingsButton = actionButton('cameraRecordings', '▤', 'Gravações'); recordingsButton.setAttribute('aria-expanded', 'false');
          const liveButton = make('button', 'cameras-player__mode-button', 'Ao vivo'); liveButton.type = 'button'; liveButton.dataset.cameraLive = '';
          const liveDot = make('span', 'cameras-player__mode-dot', '●'); liveDot.setAttribute('aria-hidden', 'true'); liveButton.prepend(liveDot);
          const history = make('section', 'cameras-player__drawer'); history.dataset.open = 'false'; history.setAttribute('aria-label', 'Gravações da câmera');
          const handle = make('button', 'cameras-player__drawer-handle', '⌃'); handle.type = 'button';
          handle.dataset.cameraDrawerToggle = ''; handle.setAttribute('aria-label', 'Abrir gravações'); handle.setAttribute('aria-expanded', 'false');
          const drawerTitle = make('strong', 'cameras-player__drawer-title', 'Gravações');
          const filters = make('div', 'cameras-player__filters');
          const day = documentRef.createElement('input'); day.type = 'date'; day.dataset.cameraDay = ''; day.setAttribute('aria-label', 'Data das gravações');
          const now = new Date(); day.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
          const hour = documentRef.createElement('select'); hour.dataset.cameraHour = ''; hour.setAttribute('aria-label', 'Hora das gravações');
          const allHours = documentRef.createElement('option'); allHours.value = ''; allHours.textContent = 'Dia inteiro'; hour.append(allHours);
          for (let n=0; n<24; n++) {
            const option = documentRef.createElement('option'); option.value = String(n).padStart(2,'0');
            option.textContent = `${option.value}:00 – ${option.value}:59`; hour.append(option);
          }
          hour.value = String(now.getHours()).padStart(2, '0');
          const search = make('button', 'cameras-player__search', 'Buscar'); search.type = 'button'; search.dataset.cameraSearch = '';
          const results = make('div', 'cameras-player__recordings'); results.setAttribute('aria-live', 'polite');
          item.searchButton = search; item.searchResults = results;
          results.textContent = 'Escolha a data e a hora para localizar gravações.';
          function setDrawerOpen(expanded) {
            history.dataset.open = String(expanded);
            handle.setAttribute('aria-expanded', String(expanded));
            handle.setAttribute('aria-label', expanded ? 'Recolher gravações' : 'Abrir gravações');
            recordingsButton.setAttribute('aria-expanded', String(expanded));
          }
          function toggleDrawer() { setDrawerOpen(history.dataset.open !== 'true'); }
          item.collapseDrawer = () => {
            if (history.dataset.open !== 'true') return;
            setDrawerOpen(false);
            back.focus({ preventScroll: true });
          };
          recordingsButton.addEventListener('click', toggleDrawer);
          handle.addEventListener('click', toggleDrawer);
          liveButton.addEventListener('click', () => { void connect(item, channel); });
          search.addEventListener('click', async () => {
            item.searchController?.abort(); item.searchController = new AbortController();
            const { signal } = item.searchController;
            search.disabled = true; results.textContent = 'Consultando gravações…';
            try {
              const rows = await listRecordings(channel.id, day.value, { signal, hour:hour.value || undefined });
              if (signal.aborted) return;
              results.replaceChildren();
              if (!rows.length) results.textContent = 'Nenhuma gravação neste horário.';
              if (rows.length === 512) results.append(make('p', 'cameras-player__recordings-note', 'Exibindo até 512 trechos. Escolha uma hora para buscar outro período.'));
              for (const record of rows) {
                const open = make('button', 'cameras-player__recording', ''); open.type = 'button'; open.dataset.cameraRecording = record.id;
                const thumbnail = make('span', 'cameras-player__recording-preview', '▶'); thumbnail.setAttribute('aria-hidden', 'true');
                const times = make('span', 'cameras-player__recording-times');
                times.append(make('strong', '', record.start.slice(11,16)), make('small', '', record.end.slice(11,16)));
                open.setAttribute('aria-label', `Reproduzir gravação das ${record.start.slice(11,16)} às ${record.end.slice(11,16)}`);
                open.append(thumbnail, times);
                open.addEventListener('click', () => { void connect(item, channel, record.id); });
                results.append(open);
              }
            } catch (error) { if (!signal.aborted) results.textContent = error.message || 'Não foi possível consultar as gravações.'; }
            finally { if (!signal.aborted) search.disabled = false; }
          });
          filters.append(day, hour, search);
          history.append(handle, drawerTitle, liveButton, filters, results);
          drawer = history;
          actions.append(recordingsButton);
        }
      } else {
        const audioButton = make('button', 'cameras-player__action'); audioButton.type = 'button'; audioButton.dataset.cameraAudio = '';
        audioButton.setAttribute('aria-pressed', 'false'); audioButton.append(make('span', 'cameras-player__action-icon', '◖'), make('span', 'cameras-player__action-label', 'Áudio'));
        audioButton.addEventListener('click', () => {
          const muted = tileItems.some(({ video }) => !video.muted);
          for (const { video } of tileItems) video.muted = muted;
          audioButton.setAttribute('aria-pressed', String(!muted));
          audioButton.querySelector('.cameras-player__action-label').textContent = muted ? 'Áudio' : 'Som ligado';
        });
        actions.append(audioButton);
      }
      const modeNote = chosen.length > 1 ? make('p', 'cameras-player__multi-note', 'Toque em “1 tela” para controlar essa câmera.') : null;
      panel.append(header);
      if (visualNotice) panel.append(visualNotice);
      panel.append(stage);
      if (ptzPanel) panel.append(ptzPanel);
      if (modeNote) panel.append(modeNote);
      panel.append(actions, controlStatus);
      if (drawer) panel.append(drawer);
      player.append(panel); dialog.append(player);
      back.focus({ preventScroll: true });
      let startPlayback = start;
      if (preview && prepareGrid) {
        gridRequest = new AbortController();
        startPlayback = prepareGrid(chosen.map(channel => channel.id), {
          signal: gridRequest.signal, codecs: playback[0].codecs,
        });
      }
      chosen.forEach((channel, index) => { void connect(playback[index], channel, null, startPlayback); });
    }
    closeCurrent = close;
    suspendCurrent = scheduleSuspension;
    resumeCurrent = resumePlayer;
    documentRef.addEventListener('visibilitychange', visibilityChanged);
    windowRef?.addEventListener('pagehide', pageHidden);
    windowRef?.addEventListener('pageshow', pageShown);
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      if (nameEditor) closeNameEditor();
      else if (visualNameEditor) closeVisualNameEditor();
      else if (player) stopPlayer();
      else close();
    });
    dialog.querySelector('[data-camera-back]').addEventListener('click', close);
    cameraTab.addEventListener('click', () => {
      activeTab = 'cameras'; creatingVisual = false; choosing = false; selected.clear();
      status.textContent = camerasLoaded ? channels.length ? '' : 'Nenhuma câmera está disponível para sua conta.' : 'Carregando câmeras…';
      render();
    });
    visualsTab.addEventListener('click', () => {
      activeTab = 'visuals'; creatingVisual = false; choosing = false; selected.clear();
      status.textContent = camerasLoaded ? visuals.length ? '' : 'Nenhum visual salvo.' : 'Carregando câmeras…';
      render();
    });
    createVisualButton.addEventListener('click', () => {
      if (!channels.length) return;
      activeTab = 'cameras'; creatingVisual = true; choosing = true; selected.clear();
      status.textContent = 'Selecione até 8 câmeras para este visual.';
      render();
      dialog.querySelector('[data-camera-select]')?.focus({ preventScroll: true });
    });
    gridCancel.addEventListener('click', () => {
      activeTab = 'visuals'; creatingVisual = false; choosing = false; selected.clear();
      status.textContent = visuals.length ? '' : 'Nenhum visual salvo.';
      render();
      createVisualButton.focus({ preventScroll: true });
    });
    gridButton.addEventListener('click', () => { choosing = !choosing; selected.clear(); render(); });
    gridOpen.addEventListener('click', () => {
      const chosen = channels.filter(channel => selected.has(channel.id));
      if (creatingVisual) requestVisualName(chosen.map(channel => String(channel.id)), gridOpen);
      else openPlayer(chosen, gridOpen);
    });
    documentRef.body.append(dialog); dialog.showModal();
    cameraOrientationBinding = reportOrientation.bindCameraPlayer(dialog);
    status.textContent = 'Carregando câmeras…';
    Promise.resolve().then(() => refreshChannels({ initial: true }));
    if (windowRef?.setInterval) refreshTimer = windowRef.setInterval(() => { void refreshChannels(); }, CAMERA_STATUS_REFRESH_MS);
    return true;
  }
  return {
    open,
    close: () => closeCurrent?.(),
    suspend: () => suspendCurrent?.(),
    resume: () => resumeCurrent?.(),
    clearPreviews,
  };
}
