import { bindReportLandscape } from "./report-landscape.js";

const GRID_LIMIT = 3;
export function createCamerasView(documentRef) {
  let dialog, closeCurrent;

  function open({ list, start }) {
    if (dialog) return true;
    const previousFocus = documentRef.activeElement;
    const page = new AbortController();
    let player, landscape, playback = [], channels = [], choosing = false;
    const selected = new Set();
    const thumbnails = new Map();

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
      for (const item of playback) {
        item.controller.abort();
        item.hls?.destroy();
        item.video.pause(); item.video.removeAttribute('src'); item.video.load();
      }
      playback = [];
      player?.remove(); player = null;
      landscape?.destroy(); landscape = null;
    }
    function close() {
      page.abort(); stopPlayer();
      documentRef.removeEventListener('visibilitychange', visibilityChanged);
      dialog.remove(); dialog = null; closeCurrent = null;
      previousFocus?.focus?.();
    }
    function visibilityChanged() {
      if (documentRef.hidden && player) {
        stopPlayer();
        status.textContent = 'Transmissão pausada. Selecione uma câmera para retomar.';
      }
    }
    async function connect(item, channel) {
      const { signal } = item.controller;
      item.status.textContent = 'Conectando…';
      try {
        const url = await start(channel.id, { signal });
        if (signal.aborted) return;
        if (item.video.canPlayType('application/vnd.apple.mpegurl')) item.video.src = url;
        else {
          const { default: Hls } = await import('hls.js');
          if (signal.aborted) return;
          if (!Hls.isSupported()) throw new Error('Reprodução não disponível neste dispositivo.');
          item.hls = new Hls({ maxBufferLength: 8 });
          item.hls.on(Hls.Events.ERROR, (_event, details) => {
            if (details.fatal && !signal.aborted) item.status.textContent = 'Transmissão interrompida. Volte e tente novamente.';
          });
          item.hls.loadSource(url); item.hls.attachMedia(item.video);
        }
        item.status.textContent = '';
        void item.video.play().catch(() => { item.status.textContent = 'Toque no vídeo para reproduzir.'; });
      } catch (error) {
        if (!signal.aborted) item.status.textContent = error.message || 'Não foi possível abrir esta câmera.';
      }
    }
    function openPlayer(chosen) {
      stopPlayer();
      player = make('div', 'cameras-player');
      const panel = make('section', 'cameras-player__panel');
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Câmeras ao vivo');
      const header = make('header', 'cameras-player__header');
      const back = make('button', '', '‹ Voltar'); back.type = 'button'; back.dataset.cameraPlayerBack = '';
      back.addEventListener('click', stopPlayer);
      header.append(back, make('strong', '', chosen.length === 1 ? chosen[0].label : 'Câmeras ao vivo'));
      const tiles = make('div', 'cameras-player__tiles');
      tiles.dataset.count = String(chosen.length);
      for (const channel of chosen) {
        const tile = make('div', 'cameras-player__tile');
        const video = documentRef.createElement('video'); video.playsInline = true; video.controls = true; video.muted = true;
        video.crossOrigin = 'anonymous'; video.setAttribute('aria-label', channel.label);
        const label = make('span', 'cameras-player__label', channel.label);
        const notice = make('span', 'cameras-player__status'); notice.setAttribute('role', 'status');
        video.addEventListener('error', () => { if (!item.controller.signal.aborted) notice.textContent = 'Transmissão interrompida. Volte e tente novamente.'; });
        const item = { controller: new AbortController(), video, status: notice, hls: null };
        video.addEventListener('playing', () => {
          if (thumbnails.has(channel.id) || !video.videoWidth || !video.videoHeight) return;
          try {
            const canvas = documentRef.createElement('canvas');
            canvas.width = Math.min(video.videoWidth, 480);
            canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            thumbnails.set(channel.id, canvas.toDataURL('image/jpeg', 0.7));
            render();
          } catch { /* A source without canvas access still plays normally. */ }
        });
        playback.push(item); tile.append(video, label, notice); tiles.append(tile);
      }
      panel.append(header, tiles); player.append(panel); dialog.append(player);
      landscape = bindReportLandscape(player);
      chosen.forEach((channel, index) => { void connect(playback[index], channel); });
    }
    closeCurrent = close;
    documentRef.addEventListener('visibilitychange', visibilityChanged);
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (player) stopPlayer(); else close(); });
    dialog.querySelector('[data-camera-back]').addEventListener('click', close);
    gridButton.addEventListener('click', () => { choosing = !choosing; selected.clear(); render(); });
    gridOpen.addEventListener('click', () => openPlayer(channels.filter(channel => selected.has(channel.id))));
    documentRef.body.append(dialog); dialog.showModal();
    status.textContent = 'Carregando câmeras…';
    Promise.resolve().then(() => list({ signal: page.signal })).then(result => {
      if (page.signal.aborted) return;
      channels = result;
      status.textContent = channels.length ? '' : 'Nenhuma câmera está disponível para sua conta.';
      render();
    }).catch(error => { if (!page.signal.aborted) status.textContent = error.message || 'Não foi possível carregar as câmeras.'; });
    return true;
  }
  return { open, close: () => closeCurrent?.() };
}
