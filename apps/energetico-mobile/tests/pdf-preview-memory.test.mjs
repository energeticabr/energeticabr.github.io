import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPdfPreview } from '../src/web/pdf-preview.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function settled() { for (let i = 0; i < 8; i++) await tick(); }

function setup(t, { initialPage = 1, numPages = 120, renderPage, navigation = 'scroll', clampScroll = false, getPageError } = {}) {
  const dom = new JSDOM('<div id="pdf"></div>', { url: 'https://example.test/energetico/' });
  const documentRef = dom.window.document, container = documentRef.querySelector('#pdf');
  dom.window.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  let width = 1100, height = 800, destroyed = 0, peakPixels = 0;
  const canvases = [], requested = [], changes = [];
  const pdf = { numPages, async getPage(number) {
    requested.push(number);
    if (getPageError?.(number)) throw new Error(`damaged metadata ${number}`);
    return {
      getViewport: ({ scale }) => ({ width: 841.89 * scale, height: 595.28 * scale }),
      render(context) {
        canvases.push(context.canvasContext.canvas);
        peakPixels = Math.max(peakPixels, canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0));
        return renderPage?.(number, context) || { promise: Promise.resolve(), cancel() {} };
      }, cleanup() {},
    };
  } };
  const viewer = createPdfPreview({ blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }), container, documentRef,
    fit: 'page', navigation, initialPage, pixelRatio: 3, onPageChange: value => changes.push(value),
    loadPdfJs: async () => ({ getDocument: () => ({ promise: Promise.resolve(pdf), destroy() { destroyed++; return Promise.resolve(); } }) }),
  });
  const viewport = container.querySelector('.attachment-preview-pdf-viewport');
  Object.defineProperties(viewport, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
  viewport.getBoundingClientRect = () => ({ top: 0, bottom: height, left: 0, right: width, height, width });
  const original = dom.window.HTMLElement.prototype.getBoundingClientRect;
  const nodeHeight = node => parseFloat(node.style.height || node.style.minHeight || node.querySelector('canvas')?.style.height) || height - 8;
  if (clampScroll) {
    let top = 0;
    Object.defineProperty(viewport, 'scrollTop', { get: () => top, set: value => {
      const nodes = [...container.querySelectorAll('[data-page-number]')];
      const total = nodes.reduce((sum, node) => sum + nodeHeight(node) + 32, 0) - 32;
      top = Math.min(Math.max(0, value), Math.max(0, total - height));
    } });
  }
  const offset = node => [...node.parentElement.children].slice(0, [...node.parentElement.children].indexOf(node)).reduce((sum, sibling) => sum + nodeHeight(sibling) + 32, 0);
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (!this.matches('.attachment-preview-pdf-page')) return original.call(this);
    const top = offset(this) - viewport.scrollTop;
    return { top, bottom: top + nodeHeight(this), left: 0, right: width, height: nodeHeight(this), width };
  };
  const scrollTo = number => {
    const node = container.querySelector(`[data-page-number="${number}"]`);
    assert.ok(node, 'every page remains reachable in the scroll layout');
    viewport.scrollTop = offset(node);
    viewport.dispatchEvent(new dom.window.Event('scroll'));
  };
  t.after(() => { viewer.destroy(); dom.window.close(); });
  return { viewer, container, documentRef, viewport, canvases, requested, changes, scrollTo,
    peakPixels: () => peakPixels, destroyed: () => destroyed,
    resize(w, h) { width = w; height = h; dom.window.dispatchEvent(new dom.window.Event('resize')); },
  };
}

test('large report opens the requested page without allocating every page bitmap', async t => {
  const { viewer, container, peakPixels } = setup(t, { initialPage: 70 });
  await viewer.ready;
  assert.equal(viewer.getCurrentPage(), 70);
  assert.equal(container.querySelectorAll('[data-page-number]').length, 120, 'no report pages are truncated');
  assert.ok(container.querySelectorAll('canvas').length <= 3, 'at most current and adjacent pages stay rasterized');
  assert.ok(peakPixels() <= 6_000_000, 'the whole preview, not each page, has a bounded pixel budget');
  assert.match(viewer.getSummary(), /120 páginas/);
});

test('scrolling a large report releases old bitmaps before loading any distant pages', async t => {
  const { viewer, container, scrollTo, canvases, peakPixels } = setup(t);
  await viewer.ready;
  const first = container.querySelector('canvas');
  scrollTo(120); await settled();
  assert.equal(viewer.getCurrentPage(), 120);
  assert.equal(first.width * first.height, 0, 'offscreen backing storage is explicitly released');
  assert.ok(container.querySelectorAll('canvas').length <= 3);
  scrollTo(1); await settled();
  assert.equal(viewer.getCurrentPage(), 1);
  assert.ok(peakPixels() <= 6_000_000);
  viewer.destroy();
  assert.ok(canvases.every(canvas => canvas.width * canvas.height === 0));
});

test('an unloaded employee cannot be signed and rapid scrolling finishes on the last requested employee', async t => {
  let finish, cancelled = 0, arm = false;
  const { viewer, scrollTo, changes, container, peakPixels } = setup(t, { renderPage: number => {
    if (arm && number === 50) return { promise: new Promise(resolve => { finish = resolve; }), cancel() { cancelled++; finish(); } };
  } });
  await viewer.ready;
  arm = true;
  scrollTo(50); await tick();
  assert.equal(viewer.getCurrentPage(), null, 'pending page is never replaced with a healthy neighbour');
  assert.equal(changes.at(-1), null);
  scrollTo(100); finish(); await settled();
  assert.equal(viewer.getCurrentPage(), 100);
  assert.equal(cancelled, 0, 'page render tasks remain serialized');
  assert.ok(container.querySelectorAll('canvas').length <= 3);
  assert.ok(peakPixels() <= 6_000_000);
});

test('large report rotation refits a bounded window without changing the employee', async t => {
  const { viewer, container, resize, peakPixels } = setup(t, { initialPage: 70 });
  await viewer.ready;
  resize(760, 350);
  assert.equal(viewer.getCurrentPage(), null, 'stale geometry is unsafe for signing');
  await settled();
  assert.equal(viewer.getCurrentPage(), 70);
  assert.ok(container.querySelectorAll('canvas').length <= 3);
  assert.ok([...container.querySelectorAll('canvas')].every(canvas => parseFloat(canvas.style.height) <= 342));
  assert.ok(peakPixels() <= 6_000_000);
});

test('a tall phone viewport renders all intersecting report pages within the shared pixel budget', async t => {
  const { viewer, container, viewport, resize, scrollTo, peakPixels } = setup(t);
  await viewer.ready; resize(390, 844); await settled();
  for (const number of [1, 70, 120]) {
    scrollTo(number); await settled();
    const bounds = viewport.getBoundingClientRect();
    const visible = [...container.querySelectorAll('[data-page-number]')].filter(node => {
      const rect = node.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    assert.ok(visible.every(node => node.querySelector('canvas')), 'visible pages must not be empty placeholders');
    assert.ok(peakPixels() <= 6_000_000);
  }
});

test('a failed last page of a large report stays reachable but cannot be signed', async t => {
  const { viewer, container, scrollTo } = setup(t, { renderPage: number => number === 120
    ? { promise: Promise.reject(new Error('damaged page')), cancel() {} } : undefined });
  await viewer.ready; scrollTo(120); await settled();
  assert.equal(viewer.getCurrentPage(), null);
  assert.match(container.querySelector('[data-page-number="120"]').textContent, /página 120/);
  assert.match(viewer.getSummary(), /1 página não pôde ser exibida/);
  scrollTo(1); await settled();
  assert.equal(viewer.getCurrentPage(), 1);
});

test('a failed last employee on a tall phone cannot borrow a healthy neighbour through browser scroll clamping', async t => {
  const { viewer, resize, scrollTo, changes } = setup(t, { clampScroll: true, renderPage: number => number === 120
    ? { promise: Promise.reject(new Error('damaged last employee')), cancel() {} } : undefined });
  await viewer.ready; resize(390, 844); await settled(); scrollTo(120); await settled();
  assert.equal(viewer.getCurrentPage(), null);
  assert.equal(changes.at(-1), null);
});

test('failed page metadata does not abort the healthy pages of a large PDF', async t => {
  const { viewer, container, scrollTo } = setup(t, { numPages: 13, getPageError: number => number === 12 });
  await viewer.ready;
  assert.equal(viewer.getCurrentPage(), 1);
  assert.equal(container.querySelectorAll('[data-page-number]').length, 13);
  assert.equal(container.querySelector('.attachment-preview-pdf').getAttribute('aria-busy'), 'false');
  assert.match(viewer.getSummary(), /1 página não pôde ser exibida/);
  scrollTo(12); await settled(); assert.equal(viewer.getCurrentPage(), null);
  scrollTo(13); await settled(); assert.equal(viewer.getCurrentPage(), 13);
});

test('synchronous page.render failures release their backing stores before replacing the slot', async t => {
  const { viewer, scrollTo, canvases, peakPixels } = setup(t, { renderPage: number => {
    if ([50, 60, 70].includes(number)) throw new Error('synchronous render failure');
  } });
  await viewer.ready;
  for (const number of [50, 60, 70]) {
    scrollTo(number); await settled();
    assert.equal(viewer.getCurrentPage(), null);
    assert.ok(peakPixels() <= 6_000_000, 'detached failed canvases still count against graphics memory');
  }
  viewer.destroy();
  assert.ok(canvases.every(canvas => canvas.width * canvas.height === 0));
});

test('closing a large report while a distant page renders cancels and releases all canvas storage', async t => {
  let cancelCount = 0, arm = false;
  const { viewer, scrollTo, canvases, destroyed, container } = setup(t, { renderPage: number => {
    if (!arm || number !== 90) return;
    let reject;
    return { promise: new Promise((resolve, fail) => { reject = fail; }), cancel() {
      cancelCount++; reject(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' }));
    } };
  } });
  await viewer.ready; arm = true; scrollTo(90); await tick(); viewer.destroy();
  assert.ok(canvases.every(canvas => canvas.width * canvas.height === 0), 'close frees in-flight canvas storage synchronously');
  await settled();
  assert.equal(cancelCount, 1);
  assert.equal(destroyed(), 1);
  assert.equal(container.children.length, 0);
  assert.ok(canvases.every(canvas => canvas.width * canvas.height === 0));
});
