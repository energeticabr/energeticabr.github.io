import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createCamerasView } from '../src/ui/cameras-view.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t, { useGrid = false, accountKey, storage, supportsHevc = false, readinessError,
  cameraList, timerControl, catalog } = {}) {
  const dom = new JSDOM('<button>Menu</button>', { url: 'https://example.com' });
  t.after(() => dom.window.close());
  const { document, HTMLMediaElement, HTMLDialogElement } = dom.window;
  if (storage) Object.defineProperty(dom.window, 'localStorage', { value: storage });
  if (timerControl) {
    dom.window.setInterval = (callback, delay) => { timerControl.callback = callback; timerControl.delay = delay; return 41; };
    dom.window.clearInterval = id => { timerControl.cleared.push(id); };
  }
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
  HTMLMediaElement.prototype.canPlayType = type => type.startsWith('video/mp4') && !supportsHevc ? '' : 'maybe';
  HTMLMediaElement.prototype.play = async () => {};
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  document.querySelector('button').focus();
  const starts = [], grids = [], moves = [], searches = [], archives = [];
  const start = async (id, { signal, codecs }) => {
    starts.push({ id, signal, codecs });
    if (id === 'site-1' && codecs.length && readinessError) throw readinessError;
    return codecs.includes('hevc') ? 'https://video.example/hevc.m3u8' : 'https://video.example/index.m3u8';
  };
  const view = createCamerasView(document);
  view.open({ accountKey, list: cameraList ?? (async () => catalog ?? Array.from({ length: 10 }, (_, index) => ({
    id: `site-${index + 1}`, label: `Obra ${index + 1}`,
  }))),
    start,
    prepareGrid: useGrid ? (ids, { signal, previousUrl }) => {
      grids.push({ ids, signal, previousUrl });
      return start;
    } : undefined,
    move: async (id, direction) => { moves.push({ id, direction }); },
    listRecordings: async (id, day, options) => { searches.push({ id, day, hour:options.hour }); return [{id:'record-1',start:'2026-11-23 10:00:00',end:'2026-11-23 10:05:00'}]; },
    playRecording: async (id, record, {signal}) => { archives.push({id,record,signal}); return 'https://video.example/archive.m3u8'; } });
  return { document, starts, grids, moves, searches, archives, view };
}

test('exibe tarja off-line e a data local da última conexão', async t => {
  const { document } = setup(t, { cameraList: async () => [{ id: 'cam-1', label: 'Obra', status: 'offline',
    lastOnlineAt: '2026-11-24T12:00:00Z' }] });
  await flush();
  const ribbon = document.querySelector('[data-camera-status]');
  assert.equal(ribbon.textContent, 'OFF-LINE');
  assert.match(document.querySelector('.camera-card__last-online').textContent, /Última vez on-line:/i);
  assert.match(document.querySelector('.camera-card__last-online').textContent, /24\/11\/2026/);
  assert.match(document.querySelector('[data-camera-open="cam-1"]').getAttribute('aria-label'), /Última vez on-line:.*24\/11\/2026/i);
});

test('status desconhecido sem histórico não mostra uma última conexão inventada', async t => {
  const { document } = setup(t, { cameraList: async () => [{ id: 'cam-1', label: 'Obra', status: 'unknown',
    lastOnlineAt: null }] });
  await flush();
  assert.equal(document.querySelector('[data-camera-status]'), null);
  assert.equal(document.querySelector('.camera-card__last-online'), null);
  assert.equal(document.querySelector('.camera-card__wifi').getAttribute('aria-label'), 'Status desconhecido');
});

test('câmera off-line sem horário conhecido informa que ainda não há histórico', async t => {
  const { document } = setup(t, { cameraList: async () => [{ id: 'cam-1', label: 'Obra', status: 'offline',
    lastOnlineAt: null }] });
  await flush();
  assert.equal(document.querySelector('[data-camera-status]').textContent, 'OFF-LINE');
  assert.equal(document.querySelector('.camera-card__last-online').textContent, 'Sem registro de conexão');
  assert.match(document.querySelector('[data-camera-open="cam-1"]').getAttribute('aria-label'), /Sem registro de conexão/i);
});

test('atualiza status a cada minuto enquanto a lista está aberta e cancela ao fechar', async t => {
  const timerControl = { cleared: [] };
  let reads = 0;
  const { document, view } = setup(t, { timerControl, cameraList: async () => {
    reads++;
    return [{ id: 'cam-1', label: 'Obra', status: reads === 1 ? 'online' : 'offline',
      lastOnlineAt: '2026-11-24T12:00:00Z' }];
  } });
  await flush();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  assert.equal(timerControl.delay, 60_000);
  await timerControl.callback();
  await flush();
  assert.equal(reads, 2);
  assert.equal(document.querySelector('[data-camera-status]').textContent, 'OFF-LINE');
  view.close();
  assert.deepEqual(timerControl.cleared, [41]);
  await timerControl.callback();
  assert.equal(reads, 2);
});

const mixedCatalog = [
  { id: 'patio-1', label: 'Pátio · canal 1', cameraGroup: 'patio-1', cameraLabel: 'Pátio' },
  { id: 'other', label: 'Pátio · canal 2' },
  { id: 'patio-2', label: 'Pátio · canal 2', cameraGroup: 'patio-1', cameraLabel: 'Pátio' },
];

test('reúne canais intercalados da mesma câmera na lista e na seleção da grade', async t => {
  const { document, grids } = setup(t, { catalog: mixedCatalog, useGrid: true, accountKey: 'conta' });
  document.defaultView.localStorage.setItem('energetico:camera-name:v1:conta:patio-2', 'Portão');
  await flush();

  const group = document.querySelector('.camera-group');
  assert.equal(group?.querySelector('h2')?.textContent, 'Pátio');
  assert.deepEqual([...group.querySelectorAll('[data-camera-open]')].map(button => button.dataset.cameraOpen),
    ['patio-1', 'patio-2']);
  assert.equal(group.querySelector('[data-camera-open="patio-2"]').getAttribute('aria-label'), 'Abrir Portão');
  assert.deepEqual([...document.querySelectorAll('[data-camera-open]')].map(button => button.dataset.cameraOpen),
    ['patio-1', 'patio-2', 'other']);

  document.querySelector('[data-camera-grid]').click();
  for (const id of ['other', 'patio-2', 'patio-1']) {
    document.querySelector(`[data-camera-select="${id}"]`).click();
  }
  document.querySelector('[data-camera-open-grid]').click();
  assert.deepEqual(grids[0].ids, ['patio-1', 'patio-2', 'other']);
});

test('reúne canais da mesma câmera ao abrir um visual salvo com a ordem antiga', async t => {
  const { document, grids } = setup(t, { catalog: mixedCatalog, useGrid: true, accountKey: 'conta' });
  document.defaultView.localStorage.setItem('energetico:camera-visual:v1:conta', JSON.stringify([{
    name: 'Entrada', cameraIds: ['patio-2', 'other', 'patio-1'],
  }]));
  await flush();
  document.querySelector('[data-camera-tab="visuals"]').click();
  document.querySelector('[data-camera-visual-open="0"]').click();
  assert.deepEqual(grids[0].ids, ['patio-2', 'patio-1', 'other']);
});
function simulateFrame(document, video, image) {
  Object.defineProperties(video, {
    readyState: { value: 2, configurable: true },
    videoWidth: { value: 640, configurable: true },
    videoHeight: { value: 360, configurable: true },
  });
  document.defaultView.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  document.defaultView.HTMLCanvasElement.prototype.toDataURL = () => image;
}

test('abre o vídeo automaticamente em orientação natural e retorna à lista', async t => {
  const { document, starts } = setup(t); await flush();
  document.querySelector('[data-camera-open="site-2"]').click(); await flush();
  const video = document.querySelector('.cameras-player__stage video');
  const plays = [];
  video.play = () => { plays.push(video); return Promise.resolve(); };
  assert.equal(starts[0].id, 'site-2');
  assert.equal(video.autoplay, true);
  assert.equal(video.muted, true);
  assert.equal(video.playsInline, true);
  assert.equal(video.controls, false);
  assert.equal(document.querySelector('.cameras-player__tile-live').hidden, true);
  assert.equal(document.querySelector('.cameras-player__live-state').dataset.connected, 'false');
  assert.equal(document.querySelector('.cameras-list').inert, true);
  assert.equal(document.activeElement, document.querySelector('[data-camera-player-back]'));
  assert.equal(plays.length, 0);
  video.dispatchEvent(new document.defaultView.Event('canplay'));
  await flush();
  assert.deepEqual(plays, [video]);
  assert.equal(document.querySelector('.cameras-player__live-state').dataset.connected, 'false');
  video.dispatchEvent(new document.defaultView.Event('playing'));
  assert.equal(document.querySelector('.cameras-player__tile-live').hidden, false);
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'AO VIVO');
  simulateFrame(document, video, 'data:image/jpeg;base64,AAAA');
  video.dispatchEvent(new document.defaultView.Event('playing'));
  document.querySelector('[data-camera-player-back]').click();
  assert.equal(starts[0].signal.aborted, true);
  assert.equal(document.querySelector('.cameras-list').inert, false);
  assert.equal(document.activeElement, document.querySelector('[data-camera-open="site-2"]'));
  assert.equal(document.querySelector('[data-camera-open="site-2"] img').src, 'data:image/jpeg;base64,AAAA');
});

test('oferece nova tentativa quando o navegador bloqueia a reprodução automática', async t => {
  const { document } = setup(t); await flush();
  document.querySelector('[data-camera-open]').click(); await flush();
  const video = document.querySelector('.cameras-player__stage video');
  let attempts = 0;
  video.play = () => {
    attempts++;
    if (attempts === 1) {
      const error = new Error('blocked'); error.name = 'NotAllowedError';
      return Promise.reject(error);
    }
    return Promise.resolve();
  };
  video.dispatchEvent(new document.defaultView.Event('canplay'));
  await flush();
  assert.equal(attempts, 1);
  assert.match(document.querySelector('.cameras-player__status').textContent, /reprodução automática/i);
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'Autoplay bloqueado');
  assert.equal(document.querySelector('.cameras-player__live-state').dataset.state, 'error');
  document.querySelector('[data-camera-play-retry]').click();
  await flush();
  assert.equal(attempts, 2);
  assert.equal(document.querySelector('.cameras-player__live-state').dataset.state, 'connecting');
  video.dispatchEvent(new document.defaultView.Event('playing'));
  assert.equal(document.querySelector('.cameras-player__status').textContent, '');
  assert.equal(document.querySelector('[data-camera-play-retry]').hidden, true);
});

test('preserva o erro terminal e atualiza o cabeçalho durante reconexão', async t => {
  const { document } = setup(t); await flush();
  document.querySelector('[data-camera-open]').click(); await flush();
  const video = document.querySelector('.cameras-player__stage video');
  const Event = document.defaultView.Event;
  video.dispatchEvent(new Event('playing'));
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'AO VIVO');
  video.dispatchEvent(new Event('waiting'));
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'Reconectando…');
  video.dispatchEvent(new Event('error'));
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'Transmissão interrompida');
  video.dispatchEvent(new Event('waiting'));
  video.dispatchEvent(new Event('playing'));
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'Transmissão interrompida');
});

test('pede HEVC apenas quando o aparelho suporta e retorna a H.264 se a mídia falhar', async t => {
  const { document, starts } = setup(t, { supportsHevc: true });
  await flush();
  document.querySelector('[data-camera-open]').click();
  await flush();
  const video = document.querySelector('video');
  assert.equal(video.src, 'https://video.example/hevc.m3u8');
  video.dispatchEvent(new document.defaultView.Event('error'));
  await flush();
  assert.equal(video.src, 'https://video.example/index.m3u8');
  assert.deepEqual(starts.map(({ id, codecs }) => [id, codecs]), [['site-1', ['h264', 'hevc']], ['site-1', []]]);
  assert.equal(starts[0].signal.aborted, true);
});

test('recupera somente a câmera que falhou antes de receber a playlist e mantém a fila da grade', async t => {
  const { document, grids, starts } = setup(t, {
    useGrid: true, readinessError: Object.assign(new Error('Sem segmentos'), { status: 503 }),
  });
  await flush();
  document.querySelector('[data-camera-grid]').click();
  for (let index = 0; index < 2; index++) document.querySelectorAll('[data-camera-select]')[index].click();
  document.querySelector('[data-camera-open-grid]').click();
  await flush();
  assert.deepEqual(grids.map(grid => grid.ids), [['site-1', 'site-2'], ['site-1']]);
  assert.deepEqual(starts.filter(item => item.id === 'site-1').map(item => item.codecs), [['h264'], []]);
});

test('a grade reconecta uma transmissão interrompida sem reabrir os demais canais', async t => {
  const { document, grids, starts } = setup(t, { useGrid: true, supportsHevc: true });
  await flush();
  document.querySelector('[data-camera-grid]').click();
  for (let index = 0; index < 2; index++) document.querySelectorAll('[data-camera-select]')[index].click();
  document.querySelector('[data-camera-open-grid]').click();
  await flush();
  const video = document.querySelector('video');
  const notice = video.parentElement.querySelector('[role="status"]');
  const { Event } = document.defaultView;
  let reconnectTimer;
  document.defaultView.setTimeout = (callback, delay) => {
    assert.equal(delay, 12000);
    reconnectTimer = callback;
    return 1;
  };
  document.defaultView.clearTimeout = () => { reconnectTimer = null; };
  video.dispatchEvent(new Event('playing'));
  video.dispatchEvent(new Event('waiting'));
  assert.equal(notice.textContent, 'Reconectando…');
  video.dispatchEvent(new Event('playing'));
  assert.equal(reconnectTimer, null);
  video.dispatchEvent(new Event('waiting'));
  reconnectTimer();
  await flush();
  assert.deepEqual(grids.map(grid => grid.ids), [['site-1', 'site-2'], ['site-1']]);
  assert.deepEqual(starts.at(-1).codecs, ['h264', 'hevc']);
  video.dispatchEvent(new Event('playing'));
  video.dispatchEvent(new Event('waiting'));
  reconnectTimer();
  await flush();
  assert.equal(grids.length, 2);
  assert.match(notice.textContent, /Toque no vídeo para tentar novamente/);
  video.click();
  await flush();
  assert.equal(grids.length, 3);
  assert.equal(starts.filter(item => item.id === 'site-2').length, 1);
});

test('a troca de codec envia a playlist antiga somente para a câmera afetada', async t => {
  const { document, grids } = setup(t, { useGrid: true, supportsHevc: true });
  await flush();
  document.querySelector('[data-camera-grid]').click();
  for (let index = 0; index < 2; index++) document.querySelectorAll('[data-camera-select]')[index].click();
  document.querySelector('[data-camera-open-grid]').click();
  await flush();
  const video = document.querySelector('video');
  const oldUrl = video.src;
  video.dispatchEvent(new document.defaultView.Event('error'));
  await flush();
  assert.deepEqual(grids.map(({ ids, previousUrl }) => [ids, previousUrl]),
    [[['site-1', 'site-2'], undefined], [['site-1'], oldUrl]]);
  assert.match(video.src, /index\.m3u8$/);
});

test('lista dispositivos e abre uma câmera em paisagem, retornando à lista', async t => {
  const { document, starts } = setup(t); await flush();
  assert.equal(document.querySelectorAll('[data-camera-open]').length, 10);
  document.querySelectorAll('[data-camera-open]')[1].click(); await flush();
  assert.equal(starts[0].id, 'site-2');
  const video = document.querySelector('.cameras-player__stage video');
  assert.ok(video);
  simulateFrame(document, video, 'data:image/jpeg;base64,AAAA');
  video.dispatchEvent(new document.defaultView.Event('playing'));
  document.querySelector('[data-camera-player-back]').click();
  assert.equal(starts[0].signal.aborted, true);
  assert.equal(document.querySelectorAll('[data-camera-open]').length, 10);
  assert.equal(document.querySelectorAll('[data-camera-open]')[1].querySelector('img').src, 'data:image/jpeg;base64,AAAA');
  document.querySelector('[data-camera-back]').click();
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(document.activeElement.textContent, 'Menu');
});

test('restaura o último quadro ao vivo depois de reabrir o app, pela conta e câmera', async t => {
  const accountKey = 'camera-viewer-a';
  const original = setup(t, { accountKey }); await flush();
  const { document } = original;
  const { localStorage, Event } = document.defaultView;
  document.querySelector('[data-camera-open="site-2"]').click(); await flush();
  const video = document.querySelector('video');
  simulateFrame(document, video, 'data:image/jpeg;base64,AAAA');
  video.dispatchEvent(new Event('playing'));
  video.currentTime = 4;
  const latest = 'data:image/jpeg;base64,BBBB';
  simulateFrame(document, video, latest);
  document.defaultView.dispatchEvent(new Event('pagehide'));

  const reopened = setup(t, { accountKey, storage: localStorage }); await flush();
  assert.equal(reopened.document.querySelector('[data-camera-open="site-2"] img')?.src, latest);
  assert.equal(reopened.document.querySelector('[data-camera-open="site-1"] img'), null);
  assert.equal(reopened.starts.length, 0);

  reopened.document.querySelector('[data-camera-open="site-2"]').click();
  const singleTile = reopened.document.querySelector('.cameras-player__tile');
  assert.equal(singleTile.querySelector('.cameras-player__saved-frame').hidden, false);
  assert.equal(singleTile.querySelector('.cameras-player__saved-frame img').src, latest);
  assert.equal(singleTile.querySelector('.cameras-player__tile-live').hidden, true);
  singleTile.querySelector('video').dispatchEvent(new reopened.document.defaultView.Event('playing'));
  assert.equal(singleTile.querySelector('.cameras-player__saved-frame').hidden, true);

  const other = setup(t, { accountKey: 'camera-viewer-b', storage: localStorage }); await flush();
  assert.equal(other.document.querySelector('.camera-card__image'), null);
  other.document.querySelector('[data-camera-open="site-2"]').click(); await flush();
  const otherVideo = other.document.querySelector('video');
  assert.equal(other.document.querySelector('.cameras-player__saved-frame').hidden, true);
  const otherImage = 'data:image/jpeg;base64,CCCC';
  simulateFrame(other.document, otherVideo, otherImage);
  otherVideo.dispatchEvent(new other.document.defaultView.Event('playing'));

  original.view.close();
  original.view.clearPreviews(accountKey);
  const signedBackIn = setup(t, { accountKey, storage: localStorage }); await flush();
  assert.equal(signedBackIn.document.querySelector('.camera-card__image'), null);
  const otherReopened = setup(t, { accountKey: 'camera-viewer-b', storage: localStorage }); await flush();
  assert.equal(otherReopened.document.querySelector('[data-camera-open="site-2"] img')?.src, otherImage);
});

test('movimenta a câmera ao vivo e abre gravação da data escolhida', async t => {
  const { document, moves, searches, archives } = setup(t, { accountKey: 'camera-viewer-a' }); await flush();
  document.querySelector('[data-camera-open]').click(); await flush();
  const { Event, localStorage } = document.defaultView;
  const video = document.querySelector('video');
  const livePreview = 'data:image/jpeg;base64,AAAA';
  simulateFrame(document, video, livePreview);
  video.dispatchEvent(new Event('playing'));
  document.querySelector('[data-camera-move="up"]').click(); await flush();
  assert.deepEqual(moves, [{id:'site-1', direction:'up'}]);
  document.querySelector('[data-camera-recordings]').click();
  const day = document.querySelector('[data-camera-day]'); day.value='2026-11-23';
  document.querySelector('[data-camera-hour]').value='10';
  document.querySelector('[data-camera-search]').click(); await flush();
  assert.deepEqual(searches, [{id:'site-1',day:'2026-11-23',hour:'10'}]);
  document.querySelector('[data-camera-recording]').click(); await flush();
  assert.equal(archives[0].record,'record-1');
  assert.equal(document.querySelector('.cameras-player__saved-frame').hidden, true);
  assert.equal(document.querySelector('.cameras-player__drawer').dataset.open, 'false');
  assert.equal(document.activeElement, document.querySelector('[data-camera-player-back]'));
  assert.equal(document.querySelector('[data-camera-move="up"]').disabled, true);
  simulateFrame(document, video, 'data:image/jpeg;base64,CCCC');
  video.dispatchEvent(new Event('playing'));
  document.defaultView.dispatchEvent(new Event('pagehide'));
  assert.equal(localStorage.length, 1);
  assert.equal(localStorage.getItem(localStorage.key(0)), livePreview);
  document.querySelector('[data-camera-live]').click(); await flush();
  video.dispatchEvent(new Event('canplay')); await flush();
  video.dispatchEvent(new Event('playing'));
  assert.equal(document.querySelector('[data-camera-move="up"]').disabled, false);
});
test('grade seleciona até oito câmeras e abre todas simultaneamente', async t => {
  const lastImage = 'data:image/jpeg;base64,AAAA';
  const storage = new Map([['energetico:camera-preview:v1:owner:site-2', lastImage]]);
  const { document, starts, grids } = setup(t, {
    useGrid: true, accountKey: 'owner', storage: { getItem: key => storage.get(key) },
  }); await flush();
  document.querySelector('[data-camera-grid]').click();
  for (let i = 0; i < 8; i++) {
    document.querySelectorAll('[data-camera-select]')[i].click();
  }
  assert.equal(document.querySelectorAll('[data-camera-select]')[8].disabled, true);
  assert.equal(document.querySelector('[data-camera-count]').textContent, '8 de 8 selecionadas');
  document.querySelector('[data-camera-open-grid]').click();
  const savedFrames = [...document.querySelectorAll('.cameras-player__saved-frame:not([hidden])')];
  assert.deepEqual(savedFrames.map(frame => frame.querySelector('img').src), [lastImage]);
  await flush();
  const selected = Array.from({ length: 8 }, (_, index) => `site-${index + 1}`);
  assert.deepEqual(grids.map(grid => grid.ids), [selected]);
  assert.deepEqual(starts.map(item => item.id), selected);
  const videos = [...document.querySelectorAll('.cameras-player__stage video')];
  assert.equal(videos.length, 8);
  assert.ok(videos.every(video => !video.controls && video.muted && video.playsInline));
  const focusedVideo = videos[0];
  const tap = () => focusedVideo.dispatchEvent(new document.defaultView.MouseEvent('click', { clientX: 12, clientY: 18 }));
  tap(); tap();
  assert.equal(document.querySelector('.cameras-player__stage').dataset.focused, 'true');
  assert.equal(document.querySelectorAll('.cameras-player__tile:not([hidden])').length, 1);
  tap(); tap();
  assert.equal(document.querySelector('.cameras-player__stage').dataset.focused, 'false');
  assert.equal(document.querySelectorAll('.cameras-player__tile:not([hidden])').length, 8);
  document.querySelector('[data-camera-player-back]').click();
  assert.ok(starts.every(item => item.signal.aborted));
  assert.equal(grids[0].signal.aborted, true);
});

test('edita o nome pelo lápis, persiste por câmera e isola a conta', async t => {
  const storageWindow = new JSDOM('', { url: 'https://storage.example.com' });
  t.after(() => storageWindow.window.close());
  const accountKey = 'bernardo@example.com';
  const storage = storageWindow.window.localStorage;
  const first = setup(t, { accountKey, storage, useGrid: true });
  await flush();
  first.document.querySelector('[data-camera-grid]').click();

  const pencil = first.document.querySelector('[data-camera-rename="site-2"]');
  assert.ok(pencil, 'cada cartão deve ter um lápis para editar o nome');
  const heading = pencil.closest('.camera-card__heading');
  const title = heading.querySelector('strong');
  assert.equal(title.nextElementSibling, pencil, 'o lápis deve ficar à direita do nome');
  assert.equal(pencil.getAttribute('aria-label'), 'Editar nome da câmera Obra 2');
  pencil.click();
  const editor = first.document.querySelector('[data-camera-name-editor]');
  const input = editor?.querySelector('[data-camera-name-input]');
  assert.ok(editor?.open);
  assert.equal(input.value, 'Obra 2');
  assert.equal(input.maxLength, 120);
  assert.equal(first.document.querySelector('.cameras-player'), null, 'editar não deve abrir o vídeo');

  input.value = 'Portão principal';
  editor.querySelector('[data-camera-name-form]').dispatchEvent(new first.document.defaultView.Event('submit', {
    bubbles: true, cancelable: true,
  }));
  await flush();

  assert.equal(first.document.querySelector('[data-camera-open="site-2"]')?.getAttribute('aria-label'), 'Abrir Portão principal');
  assert.equal(storage.getItem('energetico:camera-name:v1:bernardo%40example.com:site-2'), 'Portão principal');
  assert.equal(first.document.activeElement, first.document.querySelector('[data-camera-rename="site-2"]'));
  assert.equal(first.document.querySelector('[data-camera-count]').textContent, '0 de 8 selecionadas');
  first.document.querySelector('[data-camera-grid]').click();
  first.document.querySelector('[data-camera-open="site-2"]').click(); await flush();
  assert.equal(first.document.querySelector('.cameras-player__title').textContent, 'Portão principal');
  first.view.close();

  const reopened = setup(t, { accountKey, storage });
  await flush();
  assert.equal(reopened.document.querySelector('[data-camera-rename="site-2"]')?.previousElementSibling?.textContent, 'Portão principal');
  reopened.view.close();

  const otherAccount = setup(t, { accountKey: 'outra-conta@example.com', storage });
  await flush();
  assert.equal(otherAccount.document.querySelector('[data-camera-rename="site-2"]')?.previousElementSibling?.textContent, 'Obra 2');
  otherAccount.view.close();
});

test('recusa nome vazio, cancela e informa erro quando o armazenamento falha', async t => {
  const key = 'energetico:camera-name:v1:conta:site-1';
  const values = new Map();
  const storage = {
    getItem: name => values.get(name) ?? null,
    setItem(name, value) { throw new Error('storage denied'); },
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(name) { values.delete(name); },
  };
  const { document } = setup(t, { accountKey: 'conta', storage });
  await flush();

  const pencil = document.querySelector('[data-camera-rename="site-1"]');
  pencil.click();
  let editor = document.querySelector('[data-camera-name-editor]');
  let input = editor.querySelector('[data-camera-name-input]');
  input.value = '   ';
  editor.querySelector('[data-camera-name-form]').dispatchEvent(new document.defaultView.Event('submit', {
    bubbles: true, cancelable: true,
  }));
  assert.equal(editor.open, true);
  assert.match(editor.querySelector('[role="alert"]').textContent, /digite um nome/i);
  assert.equal(document.querySelector('.camera-card__heading strong').textContent, 'Obra 1');
  assert.equal(storage.getItem(key), null);

  editor.querySelector('[data-camera-name-cancel]').click();
  assert.equal(document.querySelector('[data-camera-name-editor]'), null);
  assert.equal(document.activeElement, pencil);

  pencil.click();
  editor = document.querySelector('[data-camera-name-editor]');
  input = editor.querySelector('[data-camera-name-input]');

  input.value = 'Portão';
  editor.querySelector('[data-camera-name-form]').dispatchEvent(new document.defaultView.Event('submit', {
    bubbles: true, cancelable: true,
  }));
  assert.equal(editor.open, true);
  assert.match(editor.querySelector('[role="alert"]').textContent, /não foi possível salvar/i);
  assert.equal(document.querySelector('.camera-card__heading strong').textContent, 'Obra 1');
  assert.equal(storage.getItem(key), null);

  editor.dispatchEvent(new document.defaultView.Event('cancel', { cancelable: true }));
  assert.equal(document.querySelector('[data-camera-name-editor]'), null);
  assert.equal(document.activeElement, pencil);
});

test('cria visual a partir das câmeras escolhidas, pede o nome e persiste por conta', async t => {
  const storageWindow = new JSDOM('', { url: 'https://storage.example.com' });
  t.after(() => storageWindow.window.close());
  const storage = storageWindow.window.localStorage;
  const accountKey = 'bernardo@example.com';
  const first = setup(t, { accountKey, storage, useGrid: true });
  await flush();

  const visualsTab = first.document.querySelector('[data-camera-tab="visuals"]');
  assert.ok(visualsTab, 'a tela deve oferecer a aba Visuais');
  visualsTab.click();
  const create = first.document.querySelector('[data-camera-create-visual]');
  assert.ok(create);
  create.click();
  first.document.querySelector('[data-camera-select="site-4"]').click();
  first.document.querySelector('[data-camera-select="site-2"]').click();
  assert.equal(first.document.querySelector('[data-camera-count]').textContent, '2 de 8 selecionadas');
  first.document.querySelector('[data-camera-open-grid]').click();

  const editor = first.document.querySelector('[data-camera-visual-editor]');
  const input = editor?.querySelector('[data-camera-visual-name]');
  assert.ok(editor?.open);
  assert.equal(input.maxLength, 120);
  input.value = 'Portão e pátio';
  editor.querySelector('[data-camera-visual-form]').dispatchEvent(new first.document.defaultView.Event('submit', {
    bubbles: true, cancelable: true,
  }));

  const key = 'energetico:camera-visual:v1:bernardo%40example.com';
  assert.deepEqual(JSON.parse(storage.getItem(key)), [{
    name: 'Portão e pátio', cameraIds: ['site-2', 'site-4'],
  }], 'deve salvar os IDs estáveis das câmeras na ordem da lista');
  assert.equal(first.document.querySelector('[data-camera-tab="visuals"]').getAttribute('aria-selected'), 'true');
  assert.equal(first.document.querySelector('[data-camera-visual-card] strong').textContent, 'Portão e pátio');
  assert.equal(first.document.querySelector('.cameras-player'), null, 'salvar o visual não deve abrir uma câmera');
  first.view.close();

  const reopened = setup(t, { accountKey, storage });
  await flush();
  reopened.document.querySelector('[data-camera-tab="visuals"]').click();
  assert.equal(reopened.document.querySelector('[data-camera-visual-card] strong').textContent, 'Portão e pátio');
  reopened.view.close();

  const otherAccount = setup(t, { accountKey: 'outra-conta@example.com', storage });
  await flush();
  otherAccount.document.querySelector('[data-camera-tab="visuals"]').click();
  assert.equal(otherAccount.document.querySelectorAll('[data-camera-visual-card]').length, 0);
  assert.match(otherAccount.document.querySelector('[role="status"]').textContent, /nenhum visual/i);
});

test('abre as câmeras de um visual pela grade na ordem salva', async t => {
  const storageWindow = new JSDOM('', { url: 'https://storage.example.com' });
  t.after(() => storageWindow.window.close());
  const storage = storageWindow.window.localStorage;
  storage.setItem('energetico:camera-visual:v1:conta', JSON.stringify([{
    name: 'Fundos', cameraIds: ['site-4', 'site-2'],
  }]));
  const image = 'data:image/jpeg;base64,AAAA';
  storage.setItem('energetico:camera-preview:v1:conta:site-4', image);
  const { document, grids, starts } = setup(t, { accountKey: 'conta', storage, useGrid: true });
  await flush();
  document.querySelector('[data-camera-tab="visuals"]').click();
  document.querySelector('[data-camera-visual-open="0"]').click();
  assert.equal(document.querySelector('.cameras-player__saved-frame:not([hidden]) img')?.src, image);
  await flush();

  assert.deepEqual(grids.map(grid => grid.ids), [['site-4', 'site-2']]);
  assert.deepEqual(starts.map(item => item.id), ['site-4', 'site-2']);
  assert.equal(document.querySelector('.cameras-player__title').textContent, 'Fundos');
  assert.equal(document.querySelectorAll('.cameras-player__stage video').length, 2);
});

test('não salva nome vazio nem confirma quando o armazenamento do visual falha', async t => {
  const values = new Map();
  const storage = {
    getItem: name => values.get(name) ?? null,
    setItem() { throw new Error('storage denied'); },
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(name) { values.delete(name); },
  };
  const { document } = setup(t, { accountKey: 'conta', storage });
  await flush();
  document.querySelector('[data-camera-tab="visuals"]').click();
  document.querySelector('[data-camera-create-visual]').click();
  document.querySelector('[data-camera-select="site-1"]').click();
  document.querySelector('[data-camera-open-grid]').click();
  const editor = document.querySelector('[data-camera-visual-editor]');
  const input = editor.querySelector('[data-camera-visual-name]');

  input.value = '  ';
  editor.querySelector('[data-camera-visual-form]').dispatchEvent(new document.defaultView.Event('submit', {
    bubbles: true, cancelable: true,
  }));
  assert.equal(editor.open, true);
  assert.match(editor.querySelector('[role="alert"]').textContent, /digite um nome para o visual/i);
  assert.equal(values.size, 0);

  input.value = 'Entrada';
  editor.querySelector('[data-camera-visual-form]').dispatchEvent(new document.defaultView.Event('submit', {
    bubbles: true, cancelable: true,
  }));
  assert.equal(editor.open, true);
  assert.match(editor.querySelector('[role="alert"]').textContent, /não foi possível salvar/i);
  assert.equal(document.querySelectorAll('[data-camera-visual-card]').length, 0);
});

test('informa quando membros do visual estão indisponíveis e abre os demais', async t => {
  const storageWindow = new JSDOM('', { url: 'https://storage.example.com' });
  t.after(() => storageWindow.window.close());
  const storage = storageWindow.window.localStorage;
  storage.setItem('energetico:camera-visual:v1:conta', JSON.stringify([{
    name: 'Entrada', cameraIds: ['missing-camera', 'site-2', 'site-4'],
  }]));
  const { document, grids, starts } = setup(t, { accountKey: 'conta', storage, useGrid: true });
  await flush();
  document.querySelector('[data-camera-tab="visuals"]').click();
  document.querySelector('[data-camera-visual-open="0"]').click();
  await flush();
  assert.match(document.querySelector('[role="status"]').textContent, /1 câmera.*não está disponível/i);
  assert.deepEqual(grids.map(grid => grid.ids), [['site-2', 'site-4']]);
  assert.deepEqual(starts.map(item => item.id), ['site-2', 'site-4']);
  assert.equal(document.querySelector('.cameras-player__title').textContent, 'Entrada');
  assert.match(document.querySelector('.cameras-player__visual-notice').textContent, /1 câmera.*não está disponível/i);
  document.querySelector('[data-camera-player-back]').click();
  await flush();

  storage.setItem('energetico:camera-visual:v1:conta', JSON.stringify([{
    name: 'Sem câmeras', cameraIds: ['missing-camera'],
  }]));
  const { document: emptyDocument, grids: emptyGrids } = setup(t, {
    accountKey: 'conta', storage, useGrid: true,
  });
  await flush();
  emptyDocument.querySelector('[data-camera-tab="visuals"]').click();
  emptyDocument.querySelector('[data-camera-visual-open="0"]').click();
  assert.equal(emptyDocument.querySelector('.cameras-player'), null);
  assert.match(emptyDocument.querySelector('[role="status"]').textContent, /nenhuma câmera deste visual/i);
  assert.deepEqual(emptyGrids, []);
});

test('ignora entradas inválidas do armazenamento sem perder visuais válidos', async t => {
  const storageWindow = new JSDOM('', { url: 'https://storage.example.com' });
  t.after(() => storageWindow.window.close());
  const storage = storageWindow.window.localStorage;
  storage.setItem('energetico:camera-visual:v1:conta', JSON.stringify([
    null,
    { name: '   ', cameraIds: ['site-1'] },
    { name: 'Sem câmeras', cameraIds: [] },
    { name: 'Pátio', cameraIds: ['site-4', 'site-4', null, 'site-2'] },
  ]));
  const { document, grids } = setup(t, { accountKey: 'conta', storage, useGrid: true });
  await flush();
  document.querySelector('[data-camera-tab="visuals"]').click();

  assert.equal(document.querySelectorAll('[data-camera-visual-card]').length, 1);
  assert.equal(document.querySelector('[data-camera-visual-card] strong').textContent, 'Pátio');
  assert.equal(document.querySelector('.camera-visual-card__count').textContent, '2 câmeras');
  document.querySelector('[data-camera-visual-open="0"]').click();
  await flush();
  assert.deepEqual(grids.map(grid => grid.ids), [['site-4', 'site-2']]);
});
