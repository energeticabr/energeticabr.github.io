import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPdfPreview } from '../src/web/pdf-preview.js';
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(t, { content = async () => ({ items: [{ str: 'Linha digitável' }], styles: {} }), render = () => Promise.resolve(), numPages = 1 } = {}) {
  const dom = new JSDOM('<div id="pdf"></div>', { url: 'https://example.test/' });
  const documentRef = dom.window.document, container = documentRef.querySelector('#pdf');
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  let cancelled = 0, started = 0;
  class TextLayer {
    constructor({ container }) { this.container = container; started++; }
    render() { return render(this); }
    cancel() { cancelled++; this.reject?.(new Error('cancelled')); }
  }
  const pdf = { numPages, async getPage() { return {
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 900 * scale, scale }),
    render: () => ({ promise: Promise.resolve(), cancel() {} }),
    getTextContent: content, cleanup() {},
  }; } };
  const viewer = createPdfPreview({ blob: new Blob(['PDF']), container, documentRef,
    fit: 'page', navigation: 'paged',
    loadPdfJs: async () => ({ TextLayer, getDocument: () => ({ promise: Promise.resolve(pdf), destroy() {} }) }),
  });
  t.after(() => { viewer.destroy(); dom.window.close(); });
  return { viewer, container, documentRef, cancelled: () => cancelled, started: () => started };
}

test('scanned pages remain visible without an empty text selection overlay', async t => {
  const { viewer, container } = setup(t, { content: async () => ({ items: [], styles: {} }) });
  await viewer.ready;
  assert.equal(viewer.hasRenderedPages(), true);
  assert.equal(container.querySelector('.attachment-preview-pdf-text'), null);
});

test('a broken text stream preserves the readable PDF canvas', async t => {
  const { viewer, container } = setup(t, { content: async () => { throw new Error('damaged text stream'); } });
  await viewer.ready;
  assert.equal(viewer.hasRenderedPages(), true);
  assert.equal(viewer.hasRenderingErrors(), false);
  assert.equal(container.querySelector('.attachment-preview-pdf-text'), null);
});

test('closing during text extraction cannot attach a late text layer', async t => {
  let resolveContent;
  const { viewer, container, started } = setup(t, { content: () => new Promise(resolve => { resolveContent = resolve; }) });
  await tick(); viewer.destroy();
  resolveContent({ items: [{ str: 'late text' }], styles: {} });
  await viewer.ready;
  assert.equal(container.children.length, 0);
  assert.equal(started(), 0);
});

test('closing while the text renderer is pending cancels it and releases its nodes', async t => {
  const { viewer, container, cancelled } = setup(t, { render: layer => new Promise((resolve, reject) => { layer.reject = reject; }) });
  await tick();
  viewer.destroy(); await viewer.ready;
  assert.equal(cancelled(), 1);
  assert.equal(container.children.length, 0);
});

test('long PDF page eviction cancels the previous text layer and creates only the current page', async t => {
  const { viewer, container, documentRef, cancelled } = setup(t, { numPages: 30 });
  await viewer.ready;
  assert.equal(container.querySelectorAll('.attachment-preview-pdf-text').length, 1);
  const previous = container.querySelector('.attachment-preview-pdf-text');
  container.querySelector('[data-pdf-action="next-page"]').click();
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(previous.isConnected, false);
  assert.equal(cancelled(), 1);
  const current = container.querySelector('.attachment-preview-pdf-text');
  assert.equal(current.parentElement.dataset.pageNumber, '2');
  assert.equal(documentRef.querySelectorAll('.attachment-preview-pdf-text').length, 1);
});
