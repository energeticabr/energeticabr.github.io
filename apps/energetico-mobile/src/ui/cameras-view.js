import { bindReportLandscape } from "./report-landscape.js";

const GRID_LIMIT = 8;
const THUMBNAIL_PREFIX = 'energetico:camera-preview:v1:';

function thumbnailStoragePrefix(accountKey) {
  return accountKey ? `${THUMBNAIL_PREFIX}${encodeURIComponent(accountKey)}:` : '';
}

function isThumbnail(value) {
  return typeof value === 'string' && value.length <= 128_000
    && /^data:image\/jpeg;base64,[a-z0-9+/]+=*$/i.test(value);
}

export function createCamerasView(documentRef) {
  let dialog, closeCurrent;

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
    let player, landscape, gridRequest, playback = [], channels = [], choosing = false;
    let thumbnailsChanged = false;
    const selected = new Set();
    const thumbnails = new Map();
    const windowRef = documentRef.defaultView;
    const storagePrefix = thumbnailStoragePrefix(accountKey);

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

    dialog = documentRef.createElement("dialog");
    dialog.className = "cameras-view";
    dialog.setAttribute("aria-label", "Câmeras");
    dialog.innerHTML = `
      <header class="cameras-header">
        <div class="cameras-header__bar"><button type="button" data-camera-back aria-label="Voltar">‹</button>
        <h1>Dispositivos</h1><button type="button" data-camera-grid aria-label="Selecionar várias câmeras" title="Selecionar várias câmeras">▦</button></div>
      </header>
      <main class="cameras-list"><p role="status" aria-live="polite"></p><div data-camera-cards></div></main>
      <footer class="cameras-selection" hidden><span data-camera-count></span><button type="button" data-camera-open-grid disabled>Abrir câmeras</button></footer>`;
    const status = dialog.querySelector('[role=status]');
    const cards = dialog.querySelector('[data-camera-cards]');
    const selection = dialog.querySelector('.cameras-selection');
    const gridButton = dialog.querySelector('[data-camera-grid]');
    const gridOpen = dialog.querySelector('[data-camera-open-grid]');
    const count = dialog.querySelector('[data-camera-count]');
    const make = (tag, className, text) => {
      const node = documentRef.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    function render() {
      cards.replaceChildren();
      selection.hidden = !choosing;
      gridButton.setAttribute('aria-pressed', String(choosing));
      count.textContent = `${selected.size} de ${GRID_LIMIT} selecionadas`;
      gridOpen.disabled = selected.size === 0;
      for (const channel of channels) {
        const card = make('article', 'camera-card');
        const heading = make('div', 'camera-card__heading');
        const symbol = make('span', 'camera-card__wifi', '◉'); symbol.setAttribute('aria-hidden', 'true');
        const title = make('strong', '', channel.label);
        heading.append(symbol, title);
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
        openButton.setAttribute('aria-label', `Abrir ${channel.label}`);
        if (thumbnails.has(channel.id)) {
          const image = documentRef.createElement('img');
          image.className = 'camera-card__image'; image.src = thumbnails.get(channel.id); image.alt = '';
          openButton.append(image);
        }
        const play = make('span', 'camera-card__play', '▶'); play.setAttribute('aria-hidden', 'true');
        const caption = make('span', 'camera-card__caption', 'Toque para ver ao vivo');
        openButton.append(play, caption);
        openButton.addEventListener('click', () => {
          if (choosing) {
            if (selected.has(channel.id)) selected.delete(channel.id);
            else if (selected.size < GRID_LIMIT) selected.add(channel.id);
            render();
          } else openPlayer([channel]);
        });
        card.append(heading, openButton);
        cards.append(card);
      }
    }

    function stopPlayer() {
      saveCurrentThumbnails();
      gridRequest?.abort(); gridRequest = null;
      for (const item of playback) {
        item.controller.abort();
        item.searchController?.abort();
        item.hls?.destroy();
        item.video.pause(); item.video.removeAttribute('src'); item.video.load();
      }
      playback = [];
      player?.remove(); player = null;
      landscape?.destroy(); landscape = null;
      if (thumbnailsChanged) {
        thumbnailsChanged = false;
        render();
      }
    }
    function close() {
      page.abort(); stopPlayer();
      documentRef.removeEventListener('visibilitychange', visibilityChanged);
      windowRef?.removeEventListener('pagehide', saveCurrentThumbnails);
      dialog.remove(); dialog = null; closeCurrent = null;
      previousFocus?.focus?.();
    }
    function visibilityChanged() {
      if (documentRef.hidden && player) {
        stopPlayer();
        status.textContent = 'Transmissão pausada. Selecione uma câmera para retomar.';
      }
    }
    async function connect(item, channel, recordingId = null, startPlayback = start) {
      saveThumbnail(item);
      item.controller.abort();
      item.hls?.destroy(); item.hls = null;
      item.video.pause(); item.video.removeAttribute('src'); item.video.load();
      item.controller = new AbortController();
      item.mode = recordingId ? 'playback' : 'live';
      item.thumbnailTime = null;
      item.connected = false; item.updateControls?.();
      const { signal } = item.controller;
      item.status.textContent = recordingId ? 'Abrindo gravação…' : 'Conectando…';
      try {
        const url = recordingId ? await playRecording(channel.id, recordingId, { signal }) : await startPlayback(channel.id, { signal });
        if (signal.aborted) return;
        if (item.video.canPlayType('application/vnd.apple.mpegurl')) item.video.src = url;
        else {
          const { default: Hls } = await import('hls.js');
          if (signal.aborted) return;
          if (!Hls.isSupported()) throw new Error('Reprodução não disponível neste dispositivo.');
          item.hls = new Hls(item.preview
            ? { maxBufferLength: 6, maxMaxBufferLength: 8, backBufferLength: 4 }
            : { maxBufferLength: 8 });
          item.hls.on(Hls.Events.ERROR, (_event, details) => {
            if (details.fatal && !signal.aborted) item.status.textContent = 'Transmissão interrompida. Volte e tente novamente.';
          });
          item.hls.loadSource(url); item.hls.attachMedia(item.video);
        }
        item.status.textContent = '';
        item.connected = true; item.updateControls?.();
        void item.video.play().catch(() => { item.status.textContent = 'Toque no vídeo para reproduzir.'; });
      } catch (error) {
        if (!signal.aborted) { item.status.textContent = error.message || 'Não foi possível abrir esta câmera.'; item.updateControls?.(); }
      }
    }
    function openPlayer(chosen) {
      stopPlayer();
      const preview = chosen.length > 1;
      player = make('div', 'cameras-player');
      const panel = make('section', 'cameras-player__panel');
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Câmeras ao vivo');
      const header = make('header', 'cameras-player__header');
      const back = make('button', '', '‹ Voltar'); back.type = 'button'; back.dataset.cameraPlayerBack = '';
      back.addEventListener('click', stopPlayer);
      header.append(back, make('strong', '', chosen.length === 1 ? chosen[0].label : 'Câmeras ao vivo'));
      const tiles = make('div', 'cameras-player__tiles');
      tiles.dataset.count = String(chosen.length);
      const workspace = make('div', 'cameras-player__workspace');
      let controls;
      for (const channel of chosen) {
        const tile = make('div', 'cameras-player__tile');
        const video = documentRef.createElement('video');
        video.playsInline = true; video.controls = !preview; video.defaultMuted = true; video.muted = true;
        video.crossOrigin = 'anonymous'; video.setAttribute('aria-label', channel.label);
        const label = make('span', 'cameras-player__label', channel.label);
        const notice = make('span', 'cameras-player__status'); notice.setAttribute('role', 'status');
        video.addEventListener('error', () => { if (!item.controller.signal.aborted) notice.textContent = 'Transmissão interrompida. Volte e tente novamente.'; });
        const item = { controller: new AbortController(), video, channelId: channel.id, status: notice,
          hls: null, mode: 'live', connected: false, preview, thumbnailTime: null };
        if (preview) {
          const resume = () => {
            if (item.connected && video.paused) void video.play().then(() => { notice.textContent = ''; }).catch(() => {});
          };
          video.tabIndex = 0;
          video.addEventListener('click', resume);
          video.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              resume();
            }
          });
        }
        video.addEventListener('playing', () => {
          if (item.thumbnailTime === null) saveThumbnail(item);
        });
        playback.push(item); tile.append(video, label, notice);
        if (chosen.length > 1 && (move || listRecordings)) {
          const focus = make('button', 'cameras-player__focus', 'Controlar');
          focus.type = 'button'; focus.addEventListener('click', () => openPlayer([channel]));
          tile.append(focus);
        }
        tiles.append(tile);
        if (chosen.length === 1 && (move || listRecordings)) {
          controls = make('aside', 'cameras-player__controls');
          const controlStatus = make('p', 'cameras-player__control-status'); controlStatus.setAttribute('role', 'status');
          const arrows = make('div', 'cameras-player__arrows');
          const buttons = [];
          if (move) for (const [direction, label, symbol] of [['up','Mover para cima','↑'],['left','Mover para a esquerda','←'],['down','Mover para baixo','↓'],['right','Mover para a direita','→']]) {
            const button = make('button', '', symbol); button.type = 'button'; button.dataset.cameraMove = direction;
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
          controls.append(arrows, controlStatus);
          if (listRecordings && playRecording) {
            const show = make('button', 'cameras-player__action', 'Gravações'); show.type = 'button'; show.dataset.cameraRecordings = '';
            const live = make('button', 'cameras-player__action', 'Ao vivo'); live.type = 'button'; live.dataset.cameraLive = '';
            const history = make('div', 'cameras-player__history'); history.hidden = true;
            const day = documentRef.createElement('input'); day.type = 'date'; day.dataset.cameraDay = ''; day.setAttribute('aria-label', 'Data das gravações');
            const now = new Date(); day.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
            const hour = documentRef.createElement('select'); hour.dataset.cameraHour = ''; hour.setAttribute('aria-label', 'Hora das gravações');
            const allHours = documentRef.createElement('option'); allHours.value = ''; allHours.textContent = 'Dia inteiro'; hour.append(allHours);
            for (let n=0; n<24; n++) {
              const option = documentRef.createElement('option'); option.value = String(n).padStart(2,'0');
              option.textContent = `${option.value}:00 – ${option.value}:59`; hour.append(option);
            }
            const search = make('button', 'cameras-player__action', 'Buscar'); search.type = 'button'; search.dataset.cameraSearch = '';
            const results = make('div', 'cameras-player__recordings'); results.setAttribute('aria-live', 'polite');
            show.addEventListener('click', () => { history.hidden = !history.hidden; });
            live.addEventListener('click', () => { void connect(item, channel); });
            search.addEventListener('click', async () => {
              item.searchController?.abort(); item.searchController = new AbortController();
              const { signal } = item.searchController;
              search.disabled = true; results.textContent = 'Consultando…';
              try {
                const rows = await listRecordings(channel.id, day.value, { signal, hour:hour.value || undefined });
                if (signal.aborted) return;
                results.replaceChildren();
                if (!rows.length) results.textContent = 'Nenhuma gravação nesta data.';
                if (rows.length === 512) results.append(make('p', '', 'Exibindo até 512 trechos. Escolha uma hora para buscar outro período.'));
                for (const record of rows) {
                  const open = make('button', 'cameras-player__recording', `${record.start.slice(11,16)} – ${record.end.slice(11,16)}`);
                  open.type = 'button'; open.dataset.cameraRecording = record.id;
                  open.addEventListener('click', () => { void connect(item, channel, record.id); });
                  results.append(open);
                }
              } catch (error) { if (!signal.aborted) results.textContent = error.message || 'Não foi possível consultar as gravações.'; }
              finally { if (!signal.aborted) search.disabled = false; }
            });
            history.append(day, hour, search, results); controls.append(show, live, history);
          }
        }
      }
      workspace.append(tiles); if (controls) workspace.append(controls);
      panel.append(header, workspace); player.append(panel); dialog.append(player);
      landscape = bindReportLandscape(player);
      let startPlayback = start;
      if (preview && prepareGrid) {
        gridRequest = new AbortController();
        startPlayback = prepareGrid(chosen.map(channel => channel.id), { signal: gridRequest.signal });
      }
      chosen.forEach((channel, index) => { void connect(playback[index], channel, null, startPlayback); });
    }
    closeCurrent = close;
    documentRef.addEventListener('visibilitychange', visibilityChanged);
    windowRef?.addEventListener('pagehide', saveCurrentThumbnails);
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (player) stopPlayer(); else close(); });
    dialog.querySelector('[data-camera-back]').addEventListener('click', close);
    gridButton.addEventListener('click', () => { choosing = !choosing; selected.clear(); render(); });
    gridOpen.addEventListener('click', () => openPlayer(channels.filter(channel => selected.has(channel.id))));
    documentRef.body.append(dialog); dialog.showModal();
    status.textContent = 'Carregando câmeras…';
    Promise.resolve().then(() => list({ signal: page.signal })).then(result => {
      if (page.signal.aborted) return;
      channels = result;
      loadThumbnails();
      status.textContent = channels.length ? '' : 'Nenhuma câmera está disponível para sua conta.';
      render();
    }).catch(error => { if (!page.signal.aborted) status.textContent = error.message || 'Não foi possível carregar as câmeras.'; });
    return true;
  }
  return { open, close: () => closeCurrent?.(), clearPreviews };
}
