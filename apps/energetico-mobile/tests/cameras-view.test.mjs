import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createCamerasView } from '../src/ui/cameras-view.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t, { useGrid = false } = {}) {
  const dom = new JSDOM('<button>Menu</button>', { url: 'https://example.com' });
  t.after(() => dom.window.close());
  const { document, HTMLMediaElement, HTMLDialogElement } = dom.window;
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
  HTMLMediaElement.prototype.canPlayType = () => 'maybe';
  HTMLMediaElement.prototype.play = async () => {};
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  document.querySelector('button').focus();
  const starts = [], grids = [], moves = [], searches = [], archives = [];
  const start = async (id, { signal }) => { starts.push({ id, signal }); return 'https://video.example/index.m3u8'; };
  const view = createCamerasView(document);
  view.open({ list: async () => Array.from({ length: 10 }, (_, index) => ({
    id: `site-${index + 1}`, label: `Obra ${index + 1}`,
  })),
    start,
    prepareGrid: useGrid ? (ids, { signal }) => {
      grids.push({ ids, signal });
      return start;
    } : undefined,
    move: async (id, direction) => { moves.push({ id, direction }); },
    listRecordings: async (id, day, options) => { searches.push({ id, day, hour:options.hour }); return [{id:'record-1',start:'2026-11-23 10:00:00',end:'2026-11-23 10:05:00'}]; },
    playRecording: async (id, record, {signal}) => { archives.push({id,record,signal}); return 'https://video.example/archive.m3u8'; } });
  return { document, starts, grids, moves, searches, archives, view };
}
test('lista dispositivos e abre uma câmera em paisagem, retornando à lista', async t => {
  const { document, starts } = setup(t); await flush();
  assert.equal(document.querySelectorAll('[data-camera-open]').length, 10);
  document.querySelectorAll('[data-camera-open]')[1].click(); await flush();
  assert.equal(starts[0].id, 'site-2');
  const video = document.querySelector('.report-landscape-viewport video');
  assert.ok(video);
  Object.defineProperties(video, { videoWidth: { value: 640 }, videoHeight: { value: 360 } });
  document.defaultView.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  document.defaultView.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  video.dispatchEvent(new document.defaultView.Event('playing'));
  document.querySelector('[data-camera-player-back]').click();
  assert.equal(starts[0].signal.aborted, true);
  assert.equal(document.querySelectorAll('[data-camera-open]').length, 10);
  assert.equal(document.querySelectorAll('[data-camera-open]')[1].querySelector('img').src, 'data:image/jpeg;base64,AAAA');
  document.querySelector('[data-camera-back]').click();
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(document.activeElement.textContent, 'Menu');
});
test('movimenta a câmera ao vivo e abre gravação da data escolhida', async t => {
  const { document, moves, searches, archives } = setup(t); await flush();
  document.querySelector('[data-camera-open]').click(); await flush();
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
