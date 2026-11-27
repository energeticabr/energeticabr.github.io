import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createChatClient } from '../src/chat/chat-client.js';
import { createCamerasView } from '../src/ui/cameras-view.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t, { useGrid = false, accountKey, storage, supportsHevc = false, android = false,
  cameraList, timerControl, catalog, startError, visualService, renewLive, playbackIsGone } = {}) {
  const dom = new JSDOM('<button>Menu</button>', { url: 'https://example.com' });
  t.after(() => dom.window.close());
  const { document, HTMLMediaElement, HTMLDialogElement } = dom.window;
  if (android) Object.defineProperty(dom.window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0' });
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
    const failure = startError?.({ id, attempt: starts.length, codecs, window: dom.window });
    if (failure) throw failure;
    return codecs.includes('hevc') ? 'https://video.example/hevc.m3u8' : 'https://video.example/index.m3u8';
  };
  const view = createCamerasView(document);
  view.open({ accountKey, list: cameraList ?? (async () => catalog ?? Array.from({ length: 10 }, (_, index) => ({
    id: `site-${index + 1}`, label: `Obra ${index + 1}`,
  }))),
    ...visualService,
    start, renewLive, playbackIsGone,
    prepareGrid: useGrid ? (ids, { signal, previousUrl, codecs }) => {
      grids.push({ ids, signal, previousUrl, codecs });
      return start;
    } : undefined,
    move: async (id, direction) => { moves.push({ id, direction }); },
    listRecordings: async (id, day, options) => { searches.push({ id, day, hour:options.hour }); return [{id:'record-1',start:'2026-11-23 10:00:00',end:'2026-11-23 10:05:00'}]; },
    playRecording: async (id, record, {signal}) => { archives.push({id,record,signal}); return 'https://video.example/archive.m3u8'; } });
  return { document, starts, grids, moves, searches, archives, view };
}

test('importa o visual do aparelho de origem e o exibe em outro sem armazenamento compartilhado', async t => {
  const key = 'energetico:camera-visual:v1:conta';
  const localVisual = { name: 'Portão e pátio', cameraIds: ['site-4', 'site-2'] };
  const imported = { ...localVisual, id: 'a'.repeat(64) };
  const alreadyShared = { id: 'b'.repeat(32), name: 'Obra', cameraIds: ['site-1'] };
  let online = false;
  let saved = [];
  let imports = 0;
  const visualService = {
    listVisuals: async () => [...saved, alreadyShared],
    importVisual: async (visual, options) => {
      imports++;
      assert.deepEqual(visual, { ...localVisual, occurrence: 0 });
      assert.ok(options.signal);
      if (!online) throw new Error('Sem conexão');
      saved = [imported];
      return imported;
    },
  };
  const origin = setup(t, { accountKey: 'conta', visualService });
  const storage = origin.document.defaultView.localStorage;
  storage.setItem(key, JSON.stringify([localVisual]));
  await flush();
  assert.equal(imports, 1);
  assert.ok(storage.getItem(key), 'preserva o visual se a importação falhar');
  online = true;
  origin.document.querySelector('[data-camera-tab="visuals"]').click();
  assert.deepEqual([...origin.document.querySelectorAll('[data-camera-visual-card] strong')].map(node => node.textContent),
    [alreadyShared.name, localVisual.name]);
  await flush();
  assert.equal(imports, 2);
  assert.equal(storage.getItem(key), null);
  const destination = setup(t, { accountKey: 'conta', visualService, useGrid: true });
  await flush();
  destination.document.querySelector('[data-camera-tab="visuals"]').click();
  await flush();
  assert.equal(destination.document.querySelector('[data-camera-visual-card] strong')?.textContent, localVisual.name);
  destination.document.querySelector('[data-camera-visual-open]').click();
  assert.deepEqual(destination.grids[0].ids, localVisual.cameraIds);
  assert.equal(imports, 2);
});

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

test('identifica um canal sem sinal quando outro canal da câmera está on-line, mesmo fora do visual', async t => {
  const { document } = setup(t, { accountKey: 'conta',
    catalog: [
      { id: 'cam-1', label: 'Portão', cameraGroup: 'cam-1', status: 'offline' },
      { id: 'cam-2', label: 'Pátio', cameraGroup: 'cam-1', status: 'online' },
      { id: 'cam-3', label: 'Outra câmera', status: 'offline' },
    ],
    startError: ({ id }) => id === 'cam-1' ? new Error('Não foi possível abrir o canal') : null,
  });
  document.defaultView.localStorage.setItem('energetico:camera-visual:v1:conta',
    JSON.stringify([{ name: 'Visual 1', cameraIds: ['cam-1', 'cam-3'] }]));
  await flush();

  const open = document.querySelector('[data-camera-open="cam-1"]');
  assert.equal(open.querySelector('[data-camera-status]').textContent, 'Canal sem sinal');
  assert.match(open.getAttribute('aria-label'), /canal sem sinal/i);
  open.click();
  await flush();
  const header = document.querySelector('.cameras-player__live-state');
  assert.equal(header.textContent, 'Canal sem sinal');
  assert.equal(header.dataset.state, 'group');
  document.querySelector('[data-camera-player-back]').click();

  document.querySelector('[data-camera-tab="visuals"]').click();
  document.querySelector('[data-camera-visual-open]').click();
  const statuses = [...document.querySelectorAll('.cameras-player__status')];
  assert.deepEqual(statuses.map(status => status.textContent), ['Canal sem sinal', 'OFF-LINE']);
  assert.deepEqual(statuses.map(status => status.hasAttribute('data-offline')), [false, true]);
  assert.equal(statuses[0].closest('.cameras-player__tile').querySelector('[data-camera-dismiss]').hidden, false);
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'Falha ao conectar');
});

test('reclassifica a queda da câmera física na grade conforme seus canais falham e voltam ao vivo', async t => {
  const { document } = setup(t, { accountKey: 'conta', catalog: [
    { id: 'cam-1', label: 'Portão', cameraGroup: 'cam-1', status: 'offline' },
    { id: 'cam-2', label: 'Pátio', cameraGroup: 'cam-1', status: 'offline' },
    { id: 'cam-3', label: 'Outra câmera', status: 'online' },
  ] });
  const { defaultView: window } = document;
  window.localStorage.setItem('energetico:camera-visual:v1:conta',
    JSON.stringify([{ name: 'Visual 1', cameraIds: ['cam-1', 'cam-2', 'cam-3'] }]));
  await flush();
  const timers = new Map();
  let nextTimer = 0;
  window.setTimeout = (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; };
  window.clearTimeout = id => timers.delete(id);
  document.querySelector('[data-camera-tab="visuals"]').click();
  document.querySelector('[data-camera-visual-open]').click();
  await flush();

  const [first, second, other] = document.querySelectorAll('[data-camera-video]');
  const firstStatus = first.closest('.cameras-player__tile').querySelector('.cameras-player__status');
  assert.equal(firstStatus.textContent, 'OFF-LINE');
  other.dispatchEvent(new window.Event('playing'));
  assert.equal(firstStatus.textContent, 'OFF-LINE');
  second.dispatchEvent(new window.Event('playing'));
  assert.equal(firstStatus.textContent, 'Canal sem sinal');
  assert.equal(firstStatus.hasAttribute('data-offline'), false);
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, '2/3 ao vivo');

  second.dispatchEvent(new window.Event('waiting'));
  const elapse = duration => {
    const [id, timer] = [...timers].find(([, { delay }]) => delay === duration);
    timers.delete(id);
    timer.callback();
  };
  elapse(2_000);
  assert.equal(firstStatus.textContent, 'Canal sem sinal');
  elapse(45_000);
  assert.equal(firstStatus.textContent, 'OFF-LINE');
  second.dispatchEvent(new window.Event('playing'));
  assert.equal(firstStatus.textContent, 'Canal sem sinal');

  first.closest('.cameras-player__tile').querySelector('.cameras-player__focus').click();
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'Canal sem sinal');
});

test('atualiza a lista e o visual quando vence a evidência de um canal fora da tela', async t => {
  const timerControl = { cleared: [] };
  const { document } = setup(t, { timerControl, catalog: [
    { id: 'cam-1', label: 'Portão', cameraGroup: 'cam-1', status: 'offline' },
    { id: 'cam-2', label: 'Pátio', cameraGroup: 'cam-1', status: 'offline' },
  ] });
  const { defaultView: window } = document;
  Object.defineProperty(document, 'hidden', { value: false });
  let now = 120_000;
  window.Date.now = () => now;
  await flush();
  document.querySelector('[data-camera-open="cam-2"]').click();
  document.querySelector('[data-camera-video="cam-2"]').dispatchEvent(new window.Event('playing'));
  document.querySelector('[data-camera-player-back]').click();

  const cardStatus = () => document.querySelector('[data-camera-open="cam-1"] [data-camera-status]').textContent;
  assert.equal(cardStatus(), 'Canal sem sinal');
  now += 60_001;
  timerControl.callback();
  await flush();
  assert.equal(cardStatus(), 'OFF-LINE');
  assert.equal(document.activeElement.dataset.cameraOpen, 'cam-2');

  document.querySelector('[data-camera-grid]').click();
  document.querySelector('[data-camera-select="cam-1"]').click();
  document.querySelector('[data-camera-select="cam-2"]').click();
  document.querySelector('[data-camera-open-grid]').click();
  const second = document.querySelector('[data-camera-video="cam-2"]');
  second.dispatchEvent(new window.Event('playing'));
  const header = document.querySelector('.cameras-player__live-state');
  now += 60_001;
  timerControl.callback();
  assert.equal(header.textContent, '1/2 ao vivo');
  assert.equal(document.querySelector('.cameras-player__status').textContent, 'Canal sem sinal');
  second.closest('.cameras-player__tile').querySelector('[data-camera-dismiss]').click();
  assert.equal(header.textContent, 'Canal sem sinal');
  now += 60_001;
  timerControl.callback();
  assert.equal(header.textContent, 'OFF-LINE');
});

test('oculta câmeras off-line e ao vivo sem reabrir os outros vídeos ou editar o visual salvo', async t => {
  const ids = ['site-1', 'site-2', 'site-3'];
  const { document, starts, grids, view } = setup(t, { useGrid: true, accountKey: 'conta',
    catalog: ids.map((id, index) => ({ id, label: `Obra ${index + 1}`, status: index === 0 ? 'offline' : 'online' })),
  });
  const { defaultView: window } = document;
  window.localStorage.setItem('energetico:camera-visual:v1:conta', JSON.stringify([{ name: 'Visual 1', cameraIds: ids }]));
  await flush();
  document.querySelector('[data-camera-tab="visuals"]').click();
  document.querySelector('[data-camera-visual-open]').click();
  await flush();
  const [offline, ...remaining] = document.querySelectorAll('[data-camera-video]');
  assert.equal(document.querySelectorAll('[data-camera-dismiss]:not([hidden])').length, 3);
  for (const video of remaining) video.dispatchEvent(new window.Event('playing'));
  const tile = offline.closest('.cameras-player__tile');
  const status = tile.querySelector('.cameras-player__status');
  assert.equal(status.textContent, 'OFF-LINE');
  assert.equal(status.dataset.loading, 'false');
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, '2/3 ao vivo');

  offline.click(); offline.click();
  const dismiss = tile.querySelector('[data-camera-dismiss]');
  assert.equal(dismiss.hidden, false);
  assert.equal(dismiss.getAttribute('aria-label'), 'Ocultar Obra 1 desta visualização');
  dismiss.click();
  assert.equal(starts[0].signal.aborted, true);
  assert.ok(starts.slice(1).every(({ signal }) => !signal.aborted));
  assert.equal(grids.length, 1);
  assert.deepEqual([...document.querySelectorAll('[data-camera-video]')], remaining);
  assert.equal(document.querySelector('.cameras-player__grid').dataset.count, '2');
  assert.equal(document.querySelector('.cameras-player__stage').dataset.focused, 'false');
  assert.equal(document.querySelector('.cameras-player__title').textContent, 'Visual 1');
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'AO VIVO');

  const [live, stillPlaying] = remaining;
  live.click(); live.click();
  const dismissLive = live.closest('.cameras-player__tile').querySelector('[data-camera-dismiss]');
  assert.equal(dismissLive.hidden, false);
  dismissLive.click();
  assert.equal(starts[1].signal.aborted, true);
  assert.equal(starts[2].signal.aborted, false);
  assert.equal(starts.length, 3);
  assert.deepEqual([...document.querySelectorAll('[data-camera-video]')], [stillPlaying]);
  assert.equal(document.querySelector('.cameras-player__grid').dataset.count, '1');
  assert.equal(document.querySelector('.cameras-player__stage').dataset.focused, 'false');
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'AO VIVO');

  Object.defineProperty(document, 'hidden', { value: false });
  window.dispatchEvent(new window.Event('pagehide'));
  view.resume();
  assert.deepEqual(starts.slice(3).map(({ id }) => id), ['site-3']);
  document.querySelector('[data-camera-player-back]').click();
  document.querySelector('[data-camera-visual-open]').click();
  assert.deepEqual([...document.querySelectorAll('[data-camera-video]')].map(video => video.dataset.cameraVideo), ids);
});

test('exibe off-line quando a abertura não entrega vídeo e retira a tarja se recuperar', async t => {
  const { document } = setup(t);
  await flush();
  const { defaultView: window } = document;
  const timers = new Map();
  let nextTimer = 0;
  window.setTimeout = (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; };
  window.clearTimeout = id => timers.delete(id);
  const open = document.querySelector('[data-camera-open]');
  open.click();
  await flush();
  const video = document.querySelector('[data-camera-video]');
  const status = document.querySelector('.cameras-player__status');
  const dismiss = document.querySelector('[data-camera-dismiss]');
  const elapseDeadline = () => {
    const [id, timer] = [...timers].find(([, { delay }]) => delay === 45_000);
    timers.delete(id);
    timer.callback();
  };
  assert.equal(status.dataset.loading, 'true');
  elapseDeadline();
  assert.equal(status.textContent, 'OFF-LINE');
  assert.equal(status.dataset.loading, 'false');
  assert.equal(dismiss.hidden, false);
  dismiss.focus();
  video.dispatchEvent(new window.Event('playing'));
  assert.equal(status.textContent, '');
  assert.equal(dismiss.hidden, false);
  assert.equal(document.activeElement, dismiss);
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'AO VIVO');

  dismiss.click();
  assert.equal(document.querySelector('.cameras-player'), null);
  assert.equal(document.activeElement, open);
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

test('mantém o foco no lápis de um visual ao atualizar o status das câmeras', async t => {
  const timerControl = { cleared: [] };
  let reads = 0;
  const { document } = setup(t, { accountKey: 'conta', timerControl, cameraList: async () => [
    { id: 'cam-1', label: 'Obra', status: ++reads === 1 ? 'online' : 'offline' },
  ] });
  document.defaultView.localStorage.setItem('energetico:camera-visual:v1:conta', JSON.stringify([
    { name: 'Obra', cameraIds: ['cam-1'] },
  ]));
  await flush();
  Object.defineProperty(document, 'hidden', { value: false });
  document.querySelector('[data-camera-tab="visuals"]').click();
  document.querySelector('[data-camera-visual-rename]').focus();
  await timerControl.callback();
  await flush();
  assert.equal(reads, 2);
  assert.equal(document.activeElement, document.querySelector('[data-camera-visual-rename]'));
  document.querySelector('[data-camera-tab="cameras"]').click();
  assert.equal(document.querySelector('[data-camera-status]').textContent, 'OFF-LINE');
});

const mixedCatalog = [
  { id: 'patio-1', label: 'Pátio · canal 1', cameraGroup: 'patio-1', cameraLabel: 'Pátio' },
  { id: 'other', label: 'Pátio · canal 2' },
  { id: 'patio-2', label: 'Pátio · canal 2', cameraGroup: 'patio-1', cameraLabel: 'Pátio' },
  { id: 'patio-3', label: 'Pátio · canal 3', cameraGroup: 'patio-1', cameraLabel: 'Pátio' },
];

test('reúne os canais da mesma câmera recebidos da API, inclusive o primeiro canal renomeado', async t => {
  const client = createChatClient({
    apiBaseUrl: 'https://example.com',
    tokenProvider: async () => 'test-session',
    fetchImpl: async () => Response.json({ channels: mixedCatalog }),
  });
  const { document, grids } = setup(t, { cameraList: client.listCameraChannels, useGrid: true, accountKey: 'conta' });
  document.defaultView.localStorage.setItem('energetico:camera-name:v1:conta:patio-1', 'Portão');
  await flush();

  const group = document.querySelector('.camera-group');
  assert.equal(group?.querySelector('h2')?.textContent, 'Pátio');
  assert.deepEqual([...group.querySelectorAll('[data-camera-open]')].map(button => button.dataset.cameraOpen),
    ['patio-1', 'patio-2', 'patio-3']);
  assert.equal(group.querySelector('[data-camera-open="patio-1"]').getAttribute('aria-label'), 'Abrir Portão');
  assert.deepEqual([...document.querySelectorAll('[data-camera-open]')].map(button => button.dataset.cameraOpen),
    ['patio-1', 'patio-2', 'patio-3', 'other']);

  document.querySelector('[data-camera-grid]').click();
  for (const id of ['other', 'patio-3', 'patio-2', 'patio-1']) {
    document.querySelector(`[data-camera-select="${id}"]`).click();
  }
  document.querySelector('[data-camera-open-grid]').click();
  assert.deepEqual(grids[0].ids, ['patio-1', 'patio-2', 'patio-3', 'other']);
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
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'AO VIVO');
  video.dispatchEvent(new Event('error'));
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'Transmissão interrompida');
  video.dispatchEvent(new Event('waiting'));
  video.dispatchEvent(new Event('playing'));
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'Transmissão interrompida');
});

test('retoma uma câmera individual quando a rede volta e preserva o áudio escolhido', async t => {
  const { document, starts } = setup(t); await flush();
  document.querySelector('[data-camera-open]').click(); await flush();
  const window = document.defaultView;
  const video = document.querySelector('video');
  video.dispatchEvent(new window.Event('playing'));
  document.querySelector('[data-camera-audio]').click();
  assert.equal(video.muted, false);
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
  Object.defineProperty(video, 'error', { configurable: true, value: { code: 2 } });
  video.dispatchEvent(new window.Event('error'));
  await flush();
  assert.equal(starts.length, 1);
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'Reconectando…');
  Object.defineProperty(window.navigator, 'onLine', { value: true });
  window.dispatchEvent(new window.Event('online'));
  await flush();
  assert.equal(starts.length, 2);
  assert.equal(video.muted, false);
  video.dispatchEvent(new window.Event('playing'));
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'AO VIVO');
});

test('mantém a sessão ao voltar rapidamente e a suspende se o app ficar em segundo plano', async t => {
  const { document, starts, view } = setup(t); await flush();
  document.querySelector('[data-camera-open]').click(); await flush();
  const window = document.defaultView;
  Object.defineProperty(document, 'hidden', { value: false });
  const video = document.querySelector('video');
  let suspend;
  window.setTimeout = callback => { suspend = callback; return 1; };
  window.clearTimeout = () => { suspend = null; };
  video.dispatchEvent(new window.Event('playing'));
  view.suspend();
  assert.equal(starts[0].signal.aborted, false);
  assert.equal(typeof suspend, 'function');
  view.resume();
  assert.equal(suspend, null);
  await flush();
  assert.equal(starts.length, 1);
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'AO VIVO');

  view.suspend();
  suspend();
  assert.equal(starts[0].signal.aborted, true);
  view.resume();
  await flush();
  assert.equal(starts.length, 2);
});

test('aguarda a rede se a chamada de recuperação falhar enquanto o aparelho fica offline', async t => {
  const { document, starts } = setup(t, { startError: ({ attempt, window }) => {
    if (attempt === 2) return Object.assign(new Error('Serviço ocupado'), { status: 429 });
    if (attempt !== 3) return null;
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    return Object.assign(new Error('Rede indisponível'), { code: 'NETWORK_UNAVAILABLE' });
  } });
  await flush();
  document.querySelector('[data-camera-open]').click(); await flush();
  const window = document.defaultView;
  const video = document.querySelector('video');
  let retry;
  window.setTimeout = (callback, delay) => {
    if (delay === 4_000) { retry = callback; return 1; }
    return 2;
  };
  window.clearTimeout = id => { if (id === 1) retry = null; };
  video.dispatchEvent(new window.Event('playing'));
  Object.defineProperty(video, 'error', { configurable: true, value: { code: 2 } });
  video.dispatchEvent(new window.Event('error'));
  await flush();
  assert.equal(starts.length, 2);
  retry();
  await flush();
  assert.equal(starts.length, 3);
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'Reconectando…');
  Object.defineProperty(window.navigator, 'onLine', { value: true });
  window.dispatchEvent(new window.Event('online'));
  await flush();
  assert.equal(starts.length, 4);
  video.dispatchEvent(new window.Event('playing'));
  assert.equal(document.querySelector('.cameras-player__live-state').textContent, 'AO VIVO');
});

test('preserva o codec direto quando o serviço fica indisponível durante a recuperação', async t => {
  const { document, starts } = setup(t, { supportsHevc: true,
    startError: ({ attempt }) => attempt === 2 || attempt === 3
      ? Object.assign(new Error('Fonte indisponível'), { status: 503 }) : null,
  });
  await flush();
  document.querySelector('[data-camera-open]').click(); await flush();
  const window = document.defaultView;
  const video = document.querySelector('video');
  let retry;
  window.setTimeout = (callback, delay) => {
    if (delay === 4_000) { retry = callback; return 1; }
    return 2;
  };
  window.clearTimeout = id => { if (id === 1) retry = null; };
  Object.defineProperty(video, 'error', { configurable: true, value: { code: 2 } });
  video.dispatchEvent(new window.Event('error'));
  await flush();
  retry();
  await flush();
  assert.deepEqual(starts.map(item => item.codecs), [['h264', 'hevc'], ['h264', 'hevc'], ['h264', 'hevc']]);
  assert.equal(document.querySelector('.cameras-player__status').textContent, 'OFF-LINE');
  assert.equal(document.querySelector('[data-camera-play-retry]').hidden, false);
});

test('distingue falta de capacidade e falta de acesso de câmera off-line', async t => {
  const { document } = setup(t, {
    catalog: [{ id: 'site-1', label: 'Obra 1', status: 'online' }, { id: 'site-2', label: 'Obra 2', status: 'offline' }],
    startError: ({ id }) => id === 'site-1'
      ? Object.assign(new Error('Serviço ocupado'), { status: 429 })
      : Object.assign(new Error('Acesso negado'), { status: 403 }),
  });
  await flush();
  const window = document.defaultView;
  let retry;
  window.setTimeout = (callback, delay) => {
    if (delay === 4_000) { retry = callback; return 1; }
    return 2;
  };
  window.clearTimeout = () => {};
  document.querySelector('[data-camera-open="site-1"]').click();
  await flush();
  retry();
  await flush();
  assert.equal(document.querySelector('.cameras-player__status').textContent, 'Serviço ocupado');
  assert.equal(document.querySelector('.cameras-player__status').hasAttribute('data-offline'), false);
  document.querySelector('[data-camera-player-back]').click();
  document.querySelector('[data-camera-open="site-2"]').click();
  await flush();
  assert.equal(document.querySelector('.cameras-player__status').textContent, 'Acesso negado');
  assert.equal(document.querySelector('.cameras-player__status').hasAttribute('data-offline'), false);
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
    useGrid: true, startError: ({ id, attempt }) => id === 'site-1' && attempt === 1
      ? Object.assign(new Error('Sem segmentos'), { status: 503 }) : null,
  });
  await flush();
  document.querySelector('[data-camera-grid]').click();
  for (let index = 0; index < 2; index++) document.querySelectorAll('[data-camera-select]')[index].click();
  document.querySelector('[data-camera-open-grid]').click();
  await flush();
  assert.deepEqual(grids.map(grid => grid.ids), [['site-1', 'site-2'], ['site-1']]);
  assert.deepEqual(starts.filter(item => item.id === 'site-1').map(item => item.codecs), [['h264'], ['h264']]);
});

test('reabre um canal da grade que perde a playlist antes do primeiro quadro', async t => {
  const { document, grids, starts } = setup(t, { useGrid: true });
  await flush();
  document.querySelector('[data-camera-grid]').click();
  for (let index = 0; index < 8; index++) document.querySelectorAll('[data-camera-select]')[index].click();
  document.querySelector('[data-camera-open-grid]').click();
  await flush();
  const [interrupted, ...otherVideos] = document.querySelectorAll('video');
  const { Event } = document.defaultView;
  for (const video of otherVideos) video.dispatchEvent(new Event('playing'));
  Object.defineProperty(interrupted, 'error', { value: { code: 2 } });
  interrupted.dispatchEvent(new Event('error'));
  await flush();

  assert.deepEqual(grids.map(grid => grid.ids.length), [8, 1]);
  assert.equal(starts.at(-1).id, 'site-1');
  assert.equal(starts.filter(start => start.id !== 'site-1' && start.signal.aborted).length, 0);
  interrupted.dispatchEvent(new Event('playing'));
  assert.equal(document.querySelectorAll('.cameras-player__tile-live:not([hidden])').length, 8);
});

test('recupera a grade de um erro 502 na abertura sem repetir canais saudáveis', async t => {
  const { document, grids, starts } = setup(t, { useGrid: true,
    startError: ({ id, attempt }) => id === 'site-1' && attempt === 1
      ? Object.assign(new Error('Gateway indisponível'), { status: 502 }) : null,
  });
  await flush();
  document.querySelector('[data-camera-grid]').click();
  for (let index = 0; index < 2; index++) document.querySelectorAll('[data-camera-select]')[index].click();
  document.querySelector('[data-camera-open-grid]').click();
  await flush();

  assert.deepEqual(grids.map(grid => grid.ids), [['site-1', 'site-2'], ['site-1']]);
  assert.deepEqual(starts.map(item => item.id), ['site-1', 'site-2', 'site-1']);
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
  const timers = new Map();
  let timerId = 0;
  document.defaultView.setTimeout = (callback, delay) => {
    timers.set(++timerId, { callback, delay });
    return timerId;
  };
  document.defaultView.clearTimeout = id => timers.delete(id);
  const elapse = (select = () => true) => {
    const [id, timer] = [...timers].sort((left, right) => left[1].delay - right[1].delay)
      .find(([, { delay }]) => select(delay));
    timers.delete(id);
    timer.callback();
    return timer.delay;
  };
  video.dispatchEvent(new Event('playing'));
  video.dispatchEvent(new Event('waiting'));
  assert.equal(notice.textContent, '');
  video.dispatchEvent(new Event('playing'));
  assert.equal(timers.size, 0);
  video.dispatchEvent(new Event('waiting'));
  assert.equal(elapse(), 2000);
  assert.equal(notice.textContent, 'Reconectando…');
  assert.equal(elapse(), 18000);
  await flush();
  assert.deepEqual(grids.map(grid => grid.ids), [['site-1', 'site-2'], ['site-1']]);
  assert.deepEqual(starts.at(-1).codecs, ['h264', 'hevc']);
  assert.match(grids.at(-1).previousUrl, /hevc\.m3u8$/);
  video.dispatchEvent(new Event('playing'));
  video.dispatchEvent(new Event('waiting'));
  elapse();
  elapse();
  assert.equal(elapse(), 4000);
  await flush();
  assert.equal(grids.length, 3);
  video.dispatchEvent(new Event('playing'));
  video.dispatchEvent(new Event('waiting'));
  elapse();
  elapse();
  await flush();
  assert.equal(grids.length, 3);
  assert.equal(notice.textContent, 'Reconectando…');
  const delay = elapse();
  assert.ok(delay >= 30000 && delay < 35000);
  await flush();
  assert.equal(grids.length, 4);
  assert.equal(starts.filter(item => item.id === 'site-2').length, 1);
  Object.defineProperty(video, 'error', { value: { code: 2 } });
  video.dispatchEvent(new Event('error'));
  assert.equal(elapse(delay => delay === 45_000), 45_000);
  assert.equal(notice.textContent, 'OFF-LINE');
  assert.equal(notice.dataset.loading, 'false');
  elapse();
  await flush();
  assert.equal(notice.textContent, 'OFF-LINE');
  video.dispatchEvent(new Event('playing'));
  assert.equal(notice.textContent, '');
  video.dispatchEvent(new Event('error'));
  assert.equal(timers.size, 2);
  document.querySelector('[data-camera-player-back]').click();
  assert.equal(timers.size, 0);
});

test('renova a transmissão em exibição sem reabrir o vídeo e interrompe a renovação ao sair', async t => {
  const timerControl = { cleared: [] };
  const renewals = [];
  const { document, starts } = setup(t, { timerControl, renewLive: async (urls, { signal }) => renewals.push({ urls, signal }) });
  Object.defineProperty(document, 'hidden', { value: false });
  await flush();
  await timerControl.callback();
  assert.equal(renewals.length, 0);
  document.querySelector('[data-camera-open]').click();
  await flush();
  const video = document.querySelector('video');
  video.dispatchEvent(new document.defaultView.Event('playing'));
  await timerControl.callback();
  await flush();
  await timerControl.callback();
  assert.deepEqual(renewals.map(item => item.urls), [[video.src]]);
  assert.equal(starts.length, 1);
  document.querySelector('[data-camera-player-back]').click();
  await timerControl.callback();
  assert.equal(renewals.length, 1);
});

test('reabre apenas a playlist perdida assim que o serviço confirma o 404', async t => {
  const { document, grids, starts } = setup(t, { useGrid: true, playbackIsGone: async () => true });
  await flush();
  document.querySelector('[data-camera-grid]').click();
  for (let index = 0; index < 2; index++) document.querySelectorAll('[data-camera-select]')[index].click();
  document.querySelector('[data-camera-open-grid]').click();
  await flush();
  const [stalled, healthy] = document.querySelectorAll('video');
  const window = document.defaultView;
  for (const video of [stalled, healthy]) video.dispatchEvent(new window.Event('playing'));
  let timeout;
  window.setTimeout = (callback, delay) => { timeout = { callback, delay }; return 1; };
  window.clearTimeout = () => { timeout = null; };
  stalled.dispatchEvent(new window.Event('waiting'));
  assert.equal(timeout.delay, 2000);
  timeout.callback();
  await flush();
  assert.deepEqual(grids.map(grid => grid.ids), [['site-1', 'site-2'], ['site-1']]);
  assert.equal(starts.find(item => item.id === 'site-2').signal.aborted, false);
  assert.equal(timeout, null);
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

for (const buffered of [false, true]) {
  test(`recupera no Android um canal sem primeiro quadro ${buffered ? 'com vídeo no buffer' : 'com o buffer vazio'}`, async t => {
    const { document, grids, starts } = setup(t, { android: true, useGrid: true, supportsHevc: true });
    await flush();
    const window = document.defaultView;
    const timers = new Map();
    let timerId = 0;
    window.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
    window.clearTimeout = id => timers.delete(id);
    document.querySelector('[data-camera-grid]').click();
    for (let index = 0; index < 4; index++) document.querySelectorAll('[data-camera-select]')[index].click();
    document.querySelector('[data-camera-open-grid]').click();
    await flush();
    const [stalled, ...healthy] = document.querySelectorAll('video');
    const previousUrl = stalled.src;
    for (const video of healthy) video.dispatchEvent(new window.Event('playing'));
    if (buffered) {
      Object.defineProperty(stalled, 'buffered', { value: { length: 1, start: () => 0, end: () => 5 } });
      stalled.dispatchEvent(new window.Event('waiting'));
    }
    const deadlines = [...timers];
    assert.deepEqual(deadlines.map(([, { delay }]) => delay).sort((a, b) => a - b), [20_000, 45_000]);
    const [id, deadline] = deadlines.find(([, { delay }]) => delay === 20_000);
    timers.delete(id);
    deadline.callback();
    await flush();
    assert.deepEqual(grids.map(grid => grid.ids), [['site-1', 'site-2', 'site-3', 'site-4'], ['site-1']]);
    assert.deepEqual(starts.at(-1).codecs, buffered ? [] : ['h264', 'hevc']);
    assert.equal(grids.at(-1).previousUrl, previousUrl);
    assert.ok(starts.filter(start => start.id !== 'site-1').every(start => !start.signal.aborted));
    stalled.dispatchEvent(new window.Event('playing'));
    assert.equal(document.querySelectorAll('.cameras-player__tile-live:not([hidden])').length, 4);
    assert.equal(timers.size, 0);
  });
}

test('ao retomar a grade restringe a conversão à câmera que precisou de compatibilidade', async t => {
  const { document, grids, view } = setup(t, { useGrid: true, supportsHevc: true });
  await flush();
  document.querySelector('[data-camera-grid]').click();
  for (let index = 0; index < 2; index++) document.querySelectorAll('[data-camera-select]')[index].click();
  document.querySelector('[data-camera-open-grid]').click();
  await flush();
  const [first] = document.querySelectorAll('video');
  const { Event } = document.defaultView;
  first.dispatchEvent(new Event('error'));
  await flush();
  Object.defineProperty(document, 'hidden', { value: false });
  view.suspend();
  view.resume();
  await flush();

  assert.deepEqual(grids.slice(2).map(({ ids, codecs }) => [ids, codecs]), [
    [['site-1'], []], [['site-2'], ['h264', 'hevc']],
  ]);
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
  const { Event, MouseEvent } = document.defaultView;
  const resumed = [];
  const paused = new Set();
  for (const video of videos) {
    Object.defineProperty(video, 'paused', { get: () => paused.has(video) });
    video.play = async () => {
      paused.delete(video);
      resumed.push(video);
    };
    video.dispatchEvent(new Event('playing'));
  }
  const stage = document.querySelector('.cameras-player__stage');
  const tiles = [...stage.querySelectorAll('.cameras-player__tile')];
  const doubleTap = video => {
    for (let tap = 0; tap < 2; tap++) {
      video.dispatchEvent(new MouseEvent('click', { clientX: 12, clientY: 18 }));
    }
  };
  for (const index of [4, 2, 4]) {
    const focusedVideo = videos[index];
    doubleTap(focusedVideo);
    assert.equal(stage.dataset.focused, 'true');
    assert.deepEqual(tiles.filter(tile => !tile.hasAttribute('inert')), [tiles[index]]);
    assert.ok(tiles.every(tile => !tile.hidden));
    paused.add(videos[0]);
    doubleTap(focusedVideo);
    assert.equal(stage.dataset.focused, 'false');
    assert.ok(tiles.every(tile => !tile.hidden && !tile.hasAttribute('inert')));
    assert.deepEqual([...stage.querySelectorAll('video')], videos);
  }
  assert.deepEqual(resumed, [videos[0], videos[0], videos[0]]);
  assert.deepEqual(starts.map(item => item.id), selected);
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
  const accountKey = 'bernardo@example.com';
  const saved = [];
  const visualService = {
    listVisuals: async () => [...saved],
    createVisual: async visual => {
      saved.push(visual);
      return visual;
    },
  };
  const first = setup(t, { accountKey, visualService, useGrid: true });
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
  await flush();

  const key = 'energetico:camera-visual:v1:bernardo%40example.com';
  assert.equal(first.document.defaultView.localStorage.getItem(key), null);
  assert.match(saved[0]?.id ?? '', /^[a-f0-9]{32}$/);
  assert.deepEqual(saved, [{ id: saved[0].id, name: 'Portão e pátio', cameraIds: ['site-2', 'site-4'] }]);
  assert.equal(first.document.querySelector('[data-camera-tab="visuals"]').getAttribute('aria-selected'), 'true');
  assert.equal(first.document.querySelector('[data-camera-visual-card] strong').textContent, 'Portão e pátio');
  assert.equal(first.document.querySelector('.cameras-player'), null, 'salvar o visual não deve abrir uma câmera');
  first.view.close();

  const reopened = setup(t, { accountKey, visualService });
  await flush();
  reopened.document.querySelector('[data-camera-tab="visuals"]').click();
  await flush();
  assert.equal(reopened.document.querySelector('[data-camera-visual-card] strong').textContent, 'Portão e pátio');
  reopened.view.close();

  const otherAccount = setup(t, { accountKey: 'outra-conta@example.com', visualService: { listVisuals: async () => [] } });
  await flush();
  otherAccount.document.querySelector('[data-camera-tab="visuals"]').click();
  await flush();
  assert.equal(otherAccount.document.querySelectorAll('[data-camera-visual-card]').length, 0);
  assert.match(otherAccount.document.querySelector('[role="status"]').textContent, /nenhum visual/i);
});

test('renomeia o visual escolhido pelo lápis e preserva as câmeras e os demais visuais', async t => {
  const saved = [
    { id: 'a'.repeat(32), name: 'VISUAL 1', cameraIds: ['site-1'] },
    { id: 'b'.repeat(32), name: 'VISUAL 1', cameraIds: ['site-3', 'site-2'] },
  ];
  let server = [...saved];
  let failWrite = false;
  const visualService = {
    listVisuals: async () => [...server],
    renameVisual: async ({ id, name, previousName }) => {
      assert.equal(id, saved[1].id);
      assert.equal(previousName, saved[1].name);
      if (failWrite) throw new Error('Serviço indisponível');
      const next = { ...server.find(visual => visual.id === id), name };
      server = server.map(visual => visual.id === id ? next : visual);
      return next;
    },
  };
  const { document, grids, starts } = setup(t, { visualService, accountKey: 'conta', useGrid: true });
  await flush();
  document.querySelector('[data-camera-tab="visuals"]').click();
  await flush();
  const pencil = () => document.querySelector('[data-camera-visual-rename="1"]');
  const title = () => document.querySelector('[data-camera-visual-card="1"] strong').textContent;
  const editor = () => document.querySelector('[data-camera-visual-editor]');
  const input = () => editor().querySelector('[data-camera-visual-name]');
  const submit = () => editor().querySelector('[data-camera-visual-form]').dispatchEvent(
    new document.defaultView.Event('submit', { bubbles: true, cancelable: true }),
  );

  assert.equal(pencil()?.getAttribute('aria-label'), 'Editar nome do visual VISUAL 1');
  pencil().click();
  assert.equal(editor().querySelector('h2').textContent, 'Editar nome do visual');
  assert.equal(input().value, 'VISUAL 1');
  input().value = 'Rascunho';
  editor().querySelector('[data-camera-visual-cancel]').click();
  assert.equal(editor(), null);
  assert.equal(document.activeElement, pencil());
  assert.deepEqual(server, saved);

  pencil().click();
  input().value = '  ';
  submit();
  assert.match(editor().querySelector('[role="alert"]').textContent, /digite um nome para o visual/i);
  assert.equal(title(), 'VISUAL 1');
  input().value = '  Portão e pátio  ';
  failWrite = true;
  submit();
  await flush();
  assert.match(editor().querySelector('[role="alert"]').textContent, /não foi possível salvar/i);
  assert.equal(title(), 'VISUAL 1');
  assert.deepEqual(server, saved);

  failWrite = false;
  const addedElsewhere = { id: 'c'.repeat(32), name: 'Entrada', cameraIds: ['site-4'] };
  server = [...saved, addedElsewhere];
  submit();
  await flush();
  assert.equal(editor(), null);
  assert.equal(document.activeElement, pencil());
  assert.equal(title(), 'Portão e pátio');
  assert.deepEqual(server, [saved[0], { ...saved[1], name: 'Portão e pátio' }, addedElsewhere]);
  assert.equal(starts.length, 0);

  const reopened = setup(t, { visualService, accountKey: 'conta', useGrid: true });
  await flush();
  reopened.document.querySelector('[data-camera-tab="visuals"]').click();
  await flush();
  const open = reopened.document.querySelector('[data-camera-visual-open="1"]');
  assert.equal(open.getAttribute('aria-label'), 'Abrir visual Portão e pátio');
  open.click();
  assert.equal(reopened.document.querySelector('.cameras-player__title').textContent, 'Portão e pátio');
  assert.deepEqual(reopened.grids[0].ids, ['site-3', 'site-2']);
  assert.equal(grids.length, 0);
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

test('não salva nome vazio nem confirma quando o servidor rejeita o visual', async t => {
  const attempts = [];
  const visualService = {
    listVisuals: async () => [],
    createVisual: async visual => {
      attempts.push(visual);
      throw new Error('Serviço indisponível');
    },
  };
  const { document } = setup(t, { accountKey: 'conta', visualService });
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
  assert.equal(attempts.length, 0);

  input.value = 'Entrada';
  editor.querySelector('[data-camera-visual-form]').dispatchEvent(new document.defaultView.Event('submit', {
    bubbles: true, cancelable: true,
  }));
  await flush();
  assert.equal(editor.open, true);
  assert.equal(attempts.length, 1);
  assert.match(editor.querySelector('[role="alert"]').textContent, /não foi possível salvar/i);
  assert.equal(document.querySelectorAll('[data-camera-visual-card]').length, 0);
});

test('retoma a criação sem duplicar se a resposta se perder e o nome for corrigido', async t => {
  let saved;
  const visualService = {
    listVisuals: async () => saved ? [saved] : [],
    createVisual: async visual => {
      if (saved) {
        assert.deepEqual(visual, saved);
        return saved;
      }
      saved = visual;
      throw new Error('Resposta perdida');
    },
    renameVisual: async ({ id, name, previousName }) => {
      assert.equal(id, saved.id);
      assert.equal(previousName, saved.name);
      saved = { ...saved, name };
      return saved;
    },
  };
  const { document } = setup(t, { accountKey: 'conta', visualService });
  await flush();
  document.querySelector('[data-camera-tab="visuals"]').click();
  document.querySelector('[data-camera-create-visual]').click();
  document.querySelector('[data-camera-select="site-1"]').click();
  document.querySelector('[data-camera-open-grid]').click();
  const editor = document.querySelector('[data-camera-visual-editor]');
  const input = editor.querySelector('[data-camera-visual-name]');
  const submit = () => editor.querySelector('[data-camera-visual-form]').dispatchEvent(
    new document.defaultView.Event('submit', { bubbles: true, cancelable: true }),
  );
  input.value = 'Entrada';
  submit();
  await flush();
  assert.match(editor.querySelector('[role="alert"]').textContent, /não foi possível salvar/i);
  input.value = 'Entrada da obra';
  submit();
  await flush();
  assert.equal(document.querySelector('[data-camera-visual-editor]'), null);
  assert.equal(document.querySelector('[data-camera-visual-card] strong').textContent, 'Entrada da obra');
  assert.equal(document.querySelectorAll('[data-camera-visual-card]').length, 1);
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
