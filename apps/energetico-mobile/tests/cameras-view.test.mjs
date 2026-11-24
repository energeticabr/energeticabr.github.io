import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createCamerasView } from '../src/ui/cameras-view.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t, { useGrid = false, accountKey, storage, supportsHevc = false, readinessError } = {}) {
  const dom = new JSDOM('<button>Menu</button>', { url: 'https://example.com' });
  t.after(() => dom.window.close());
  const { document, HTMLMediaElement, HTMLDialogElement } = dom.window;
  if (storage) Object.defineProperty(dom.window, 'localStorage', { value: storage });
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
  view.open({ accountKey, list: async () => Array.from({ length: 10 }, (_, index) => ({
    id: `site-${index + 1}`, label: `Obra ${index + 1}`,
  })),
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
function simulateFrame(document, video, image) {
  Object.defineProperties(video, {
    readyState: { value: 2, configurable: true },
    videoWidth: { value: 640, configurable: true },
    videoHeight: { value: 360, configurable: true },
  });
  document.defaultView.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  document.defaultView.HTMLCanvasElement.prototype.toDataURL = () => image;
}

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
  const video = document.querySelector('.report-landscape-viewport video');
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

  const other = setup(t, { accountKey: 'camera-viewer-b', storage: localStorage }); await flush();
  assert.equal(other.document.querySelector('.camera-card__image'), null);
  other.document.querySelector('[data-camera-open="site-2"]').click(); await flush();
  const otherVideo = other.document.querySelector('video');
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
  assert.equal(document.querySelector('[data-camera-move="up"]').disabled, true);
  simulateFrame(document, video, 'data:image/jpeg;base64,CCCC');
  video.dispatchEvent(new Event('playing'));
  document.defaultView.dispatchEvent(new Event('pagehide'));
  assert.equal(localStorage.length, 1);
  assert.equal(localStorage.getItem(localStorage.key(0)), livePreview);
  document.querySelector('[data-camera-live]').click(); await flush();
  assert.equal(document.querySelector('[data-camera-move="up"]').disabled, false);
});
test('grade seleciona até oito câmeras e abre todas simultaneamente', async t => {
  const { document, starts, grids } = setup(t, { useGrid: true }); await flush();
  document.querySelector('[data-camera-grid]').click();
  for (let i = 0; i < 8; i++) {
    document.querySelectorAll('[data-camera-select]')[i].click();
  }
  assert.equal(document.querySelectorAll('[data-camera-select]')[8].disabled, true);
  document.querySelectorAll('[data-camera-open]')[8].click();
  assert.equal(document.querySelector('[data-camera-count]').textContent, '8 de 8 selecionadas');
  document.querySelector('[data-camera-open-grid]').click(); await flush();
  const selected = Array.from({ length: 8 }, (_, index) => `site-${index + 1}`);
  assert.deepEqual(grids.map(grid => grid.ids), [selected]);
  assert.deepEqual(starts.map(item => item.id), selected);
  const videos = [...document.querySelectorAll('.report-landscape-viewport video')];
  assert.equal(videos.length, 8);
  assert.ok(videos.every(video => !video.controls && video.muted && video.playsInline));
  document.querySelector('[data-camera-player-back]').click();
  assert.ok(starts.every(item => item.signal.aborted));
  assert.equal(grids[0].signal.aborted, true);
});
