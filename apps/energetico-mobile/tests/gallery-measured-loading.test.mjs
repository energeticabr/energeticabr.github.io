import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { galleryCases, galleryOptions } from './helpers/gallery-create-cases.mjs';
import { loadingRow } from './helpers/gallery-loading-cases.mjs';
import { createGalleryLoadingScreen } from '../src/ui/gallery-loading-screen.js';
import { createLoadingIndicator } from '../src/ui/loading-indicator.js';
import { createOrdersGalleryData } from '../src/chat/orders-gallery-data.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const result = entry => ({ rows: [loadingRow(entry)], gallery: entry.options?.gallery,
  count: 1, page: 1, pages: 1, hasMore: false, nextCursor: null });
const value = node => Number(node.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'));

for (const entry of galleryCases) {
  // Break caught: losing a scoped data callback leaves the visible mask at its initial value.
  test(`${entry.name}: mask measures acquisition while pending and completes only on accepted rows`, async t => {
    const dom = new JSDOM('<main>Chat</main>'), pending = deferred();
    let options;
    const read = (...args) => { options = args.at(-1); return pending.promise; };
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, { data: { loadSnapshot: read }, request: read }));
    t.after(() => { pending.resolve(result(entry)); gallery.destroy(); dom.window.close(); });
    const opening = gallery.open(), screen = dom.window.document.querySelector(`${entry.root} > .gallery-loading-screen`);
    assert.equal(value(screen), 33, 'request preparation is finished before the service is awaited');
    assert.equal(typeof options.onProgress, 'function');
    options.onProgress({ percent: 50 });
    assert.equal(value(screen), 50, 'completed acquisition work reaches the actual mask');
    options.onProgress({ percent: null, loaded: 1024, total: null });
    assert.equal(value(screen), 50, 'unknown byte totals do not manufacture a percentage');
    options.onProgress({ percent: 100 });
    assert.equal(value(screen), 66, 'a fully received response is not yet accepted presentation');
    pending.resolve(result(entry)); await opening; await settle();
    assert.equal(value(screen), 100);
    assert.equal(screen.hidden, true);
    assert.match(dom.window.document.querySelector(entry.root).textContent, /901/);
  });
}

for (const name of ['orders', 'tasks', 'payments', 'launch', 'group', 'IDFOLHA']) {
  const entry = galleryCases.find(item => item.name === name);
  // Break caught: an old request callback advances a new loader or an error reports successful completion.
  test(`${name}: closed requests and failed requests never complete a newer mask`, async t => {
    const dom = new JSDOM('<main></main>'), requests = [];
    const read = (...args) => { const request = { ...deferred(), options: args.at(-1) }; requests.push(request); return request.promise; };
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, { data: { loadSnapshot: read }, request: read }));
    t.after(() => { for (const request of requests) request.resolve(result(entry)); gallery.destroy(); dom.window.close(); });
    const opening = gallery.open(), old = requests[0];
    gallery.close();
    const reopening = gallery.open(), next = requests[1];
    const screen = dom.window.document.querySelector(`${entry.root} > .gallery-loading-screen`);
    assert.equal(typeof old.options.onProgress, 'function');
    next.options.onProgress({ percent: 25 }); assert.equal(value(screen), 41);
    old.options.onProgress({ percent: 100 }); old.resolve(result(entry)); await opening; await settle();
    assert.equal(value(screen), 41);
    next.reject(new Error('offline')); await reopening; await settle();
    next.options.onProgress({ percent: 100 });
    assert.equal(value(screen), 41, 'failure stops the task rather than completing it');
    assert.equal(screen.hidden, true);
  });
}

for (const name of ['recurring', 'group']) {
  const entry = galleryCases.find(item => item.name === name);
  test(`${name}: a malformed response cannot complete as a successful empty gallery`, async t => {
    const dom = new JSDOM('<main></main>'), pending = deferred(); let options;
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, { data: {
      loadSnapshot: input => { options = input; return pending.promise; },
    } }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    const opening = gallery.open(), screen = dom.window.document.querySelector(`${entry.root} > .gallery-loading-screen`);
    options.onProgress({ percent: 100 });
    pending.resolve({ rows: null }); await opening; await settle();
    assert.equal(value(screen), 66, 'receiving an invalid response must not confirm success');
    assert.equal(screen.hidden, true);
    assert.match(dom.window.document.querySelector(entry.root).textContent, /Não foi possível/);
  });
}

test('gallery screen task uses its own mascot and stops when hidden or destroyed', t => {
  const dom = new JSDOM('<section><header></header><main></main></section>');
  const root = dom.window.document.querySelector('section');
  const nested = createLoadingIndicator(dom.window.document, 'Carregador independente');
  root.querySelector('main').append(nested);
  const screen = createGalleryLoadingScreen({ root, header: root.querySelector('header'), label: 'Carregando' });
  t.after(() => { screen.destroy(); dom.window.close(); });
  assert.equal(typeof screen.beginTask, 'function');
  screen.sync(true); const old = screen.beginTask(); old.prepared(); old.report({ percent: 50 });
  assert.equal(value(screen.element), 50);
  assert.equal(value(nested), 0, 'a nested operation never receives its parent mask progress');
  screen.sync(false); old.acquired(); old.complete();
  assert.equal(value(screen.element), 50);
  screen.sync(true); const current = screen.beginTask(); current.prepared();
  old.report({ percent: 100 }); assert.equal(value(screen.element), 33);
  screen.destroy(); current.acquired(); current.complete();
  assert.equal(value(screen.element), 33);
});

test('real orders data stages reach the mask before its paginated read has finished', async t => {
  const entry = galleryCases.find(item => item.name === 'orders');
  const dom = new JSDOM('<main></main>'), firstPage = deferred(), secondPage = deferred();
  const data = createOrdersGalleryData({ repository: {
    resolveList: async () => ({ id: 'orders', status: 'resolved' }),
    getItemsPage: (_site, _list, _query, options) => options.cursor ? secondPage.promise : firstPage.promise,
  } });
  const gallery = entry.factory({ document: dom.window.document, data });
  t.after(() => { firstPage.resolve({ items: [] }); secondPage.resolve({ items: [] }); gallery.destroy(); dom.window.close(); });
  const opening = gallery.open(), screen = dom.window.document.querySelector('.gallery-loading-screen');
  assert.equal(value(screen), 33);
  await settle();
  assert.equal(value(screen), 44, 'resolved SharePoint list is one of three real acquisition stages');
  firstPage.resolve({ items: [loadingRow(entry)], hasMore: true, nextLink: 'next-page' }); await settle();
  assert.equal(value(screen), 44, 'an unknown page count cannot use a safety ceiling as its denominator');
  assert.equal(screen.hidden, false);
  secondPage.resolve({ items: [], hasMore: false }); await opening;
  assert.equal(value(screen), 100);
  assert.equal(screen.hidden, true);
});
