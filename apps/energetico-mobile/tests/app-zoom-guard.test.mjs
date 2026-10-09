import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { installAppZoomGuard } from '../src/web/app-zoom-guard.js';
import { createPowerBiDashboardView } from '../src/ui/powerbi-dashboard-view.js';

function setup(t) {
  const dom = new JSDOM('<button id="menu">Menu</button><section class="powerbi-dashboard"><button id="back">Back</button><div class="powerbi-dashboard__frame-wrap"></div></section><div class="attachment-preview-pdf-viewport"></div>');
  const stop = installAppZoomGuard(dom.window.document);
  t.after(() => { stop(); dom.window.close(); });
  return { dom, doc: dom.window.document, stop };
}

function touch(dom, type, count) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: Array.from({ length: count }, (_, identifier) => ({ identifier })) });
  return event;
}

test('two fingers cannot magnify menu buttons; one finger and clicks remain usable', t => {
  const { dom, doc } = setup(t);
  const menu = doc.querySelector('#menu');
  for (const type of ['touchstart', 'touchmove']) {
    const pinch = touch(dom, type, 2); menu.dispatchEvent(pinch);
    assert.equal(pinch.defaultPrevented, true);
    const scroll = touch(dom, type, 1); menu.dispatchEvent(scroll);
    assert.equal(scroll.defaultPrevented, false);
  }
  let clicks = 0; menu.addEventListener('click', () => clicks++); menu.click(); menu.click();
  assert.equal(clicks, 2);
});

test('Safari native page gestures are cancelled outside Power BI, including viewer chrome', t => {
  const { dom, doc } = setup(t);
  for (const selector of ['#menu', '#back', '.attachment-preview-pdf-viewport']) {
    for (const type of ['gesturestart', 'gesturechange']) {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      doc.querySelector(selector).dispatchEvent(event);
      assert.equal(event.defaultPrevented, true, `${selector}: ${type}`);
    }
  }
});

test('Power BI report keeps native pinch while its navigation buttons do not', t => {
  const { dom, doc } = setup(t);
  const frame = doc.querySelector('.powerbi-dashboard__frame-wrap');
  const pinch = touch(dom, 'touchstart', 2); frame.dispatchEvent(pinch);
  assert.equal(pinch.defaultPrevented, false);
  const gesture = new dom.window.Event('gesturestart', { bubbles: true, cancelable: true }); frame.dispatchEvent(gesture);
  assert.equal(gesture.defaultPrevented, false);
  const back = touch(dom, 'touchstart', 2); doc.querySelector('#back').dispatchEvent(back);
  assert.equal(back.defaultPrevented, true);
});

test('guard cleanup removes listeners rather than leaving a cancelled touch after disposal', t => {
  const { dom, doc, stop } = setup(t); stop(); stop();
  const pinch = touch(dom, 'touchstart', 2); doc.querySelector('#menu').dispatchEvent(pinch);
  assert.equal(pinch.defaultPrevented, false);
});

test('new mobile fields gain readable focus text without shrinking existing larger typography', async t => {
  const { dom, doc } = setup(t);
  doc.body.insertAdjacentHTML('beforeend', '<input id="small" style="font-size:12px"><input id="large" style="font-size:22px">');
  await new Promise(resolve => dom.window.queueMicrotask(resolve));
  assert.equal(dom.window.getComputedStyle(doc.querySelector('#small')).fontSize, '16px');
  assert.equal(dom.window.getComputedStyle(doc.querySelector('#large')).fontSize, '22px');
  const small = doc.querySelector('#small'); small.style.fontSize = '11px'; small.focus();
  assert.equal(dom.window.getComputedStyle(small).fontSize, '16px');
});

test('Power BI close resets page viewport before returning to protected app menus', async t => {
  const dom = new JSDOM('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><button>Menu</button>');
  const doc = dom.window.document;
  const stop = installAppZoomGuard(doc);
  const viewport = doc.querySelector('meta[name="viewport"]');
  const report = createPowerBiDashboardView({ documentRef: doc, powerBiClient: { models: { TokenType: { Aad: 0 } }, embed: () => ({ on() {}, off() {} }), reset() {} } });
  t.after(() => { report.destroy(); stop(); dom.window.close(); });
  assert.match(viewport.content, /maximum-scale=1/);
  await report.open({ accessToken: 'test', getAccessToken: async () => 'test' });
  assert.match(viewport.content, /viewport-fit=cover/);
  assert.match(viewport.content, /maximum-scale=5/);
  report.close();
  assert.match(viewport.content, /initial-scale=1/);
  assert.match(viewport.content, /maximum-scale=1/);
  assert.equal(doc.querySelector('.powerbi-dashboard'), null);
});

test('a raised field can grow with subsequent typography instead of retaining a permanent 16px cap', async t => {
  const { dom, doc } = setup(t);
  doc.head.insertAdjacentHTML('beforeend', '<style>input { font-size:12px } input.larger { font-size:22px }</style>');
  doc.body.insertAdjacentHTML('beforeend', '<input id="adaptive">');
  await new Promise(resolve => dom.window.queueMicrotask(resolve));
  const field = doc.querySelector('#adaptive');
  assert.equal(dom.window.getComputedStyle(field).fontSize, '16px');
  field.className = 'larger'; field.focus();
  assert.equal(dom.window.getComputedStyle(field).fontSize, '22px');
  field.blur(); field.style.setProperty('font-size', '24px'); field.focus();
  assert.equal(dom.window.getComputedStyle(field).fontSize, '24px');
});
