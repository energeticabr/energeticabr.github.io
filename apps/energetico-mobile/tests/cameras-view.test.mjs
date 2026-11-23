import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createCamerasView } from '../src/ui/cameras-view.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t) {
  const dom = new JSDOM('<button>Menu</button>', { url: 'https://example.com' });
  t.after(() => dom.window.close());
  const { document, HTMLMediaElement, HTMLDialogElement } = dom.window;
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
  HTMLMediaElement.prototype.canPlayType = () => 'maybe';
  HTMLMediaElement.prototype.play = async () => {};
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  document.querySelector('button').focus();
  const starts = [];
  const view = createCamerasView(document);
  view.open({ list: async () => [1, 2, 3, 4, 5].map(n => ({ id: `site-${n}`, label: `Obra ${n}` })),
    start: async (id, { signal }) => { starts.push({ id, signal }); return 'https://video.example/index.m3u8'; } });
  return { document, starts, view };
}
test('lista dispositivos e abre uma câmera em paisagem, retornando à lista', async t => {
  const { document, starts } = setup(t); await flush();
  assert.equal(document.querySelectorAll('[data-camera-open]').length, 5);
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
  assert.equal(document.querySelectorAll('[data-camera-open]').length, 5);
  assert.equal(document.querySelectorAll('[data-camera-open]')[1].querySelector('img').src, 'data:image/jpeg;base64,AAAA');
  document.querySelector('[data-camera-back]').click();
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(document.activeElement.textContent, 'Menu');
});
test('grade seleciona até três câmeras e abre todas simultaneamente', async t => {
  const { document, starts } = setup(t); await flush();
  document.querySelector('[data-camera-grid]').click();
  for (let i = 0; i < 3; i++) {
    const check = document.querySelectorAll('[data-camera-select]')[i];
    check.checked = true; check.dispatchEvent(new document.defaultView.Event('change'));
  }
  assert.equal(document.querySelectorAll('[data-camera-select]')[3].disabled, true);
  document.querySelector('[data-camera-open-grid]').click(); await flush();
  assert.deepEqual(starts.map(item => item.id), ['site-1', 'site-2', 'site-3']);
  assert.equal(document.querySelectorAll('.report-landscape-viewport video').length, 3);
  document.querySelector('[data-camera-player-back]').click();
  assert.ok(starts.every(item => item.signal.aborted));
});
