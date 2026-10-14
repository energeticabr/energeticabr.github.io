import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { galleryCases, galleryOptions } from './helpers/gallery-create-cases.mjs';

for (const entry of galleryCases) {
  test(`${entry.name}: title and sync action share the gallery header`, async t => {
    const dom = new JSDOM('<main id="previous"></main>', { url: 'https://example.test' });
    const gallery = entry.factory(galleryOptions(entry, dom.window.document));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    await gallery.open();
    const root = dom.window.document.querySelector(entry.root);
    const header = root.querySelector('header');
    const title = header.querySelector('h1');
    const sync = root.querySelector('[data-gallery-refresh]');
    assert.ok(title, 'gallery title must remain in the header');
    assert.equal(sync?.parentElement, header, 'sync control must be to the right of the title');
    assert.ok(header.classList.contains('gallery-refresh-header'));
    assert.match(sync.getAttribute('aria-label'), /sincronizar/i);
    assert.ok(sync.querySelector('svg[data-icon="refresh"]'), 'use the existing sync icon');
    assert.equal(root.querySelectorAll('[data-gallery-refresh]').length, 1);
  });
}

test('orders sync invalidates every linked report even with an empty gallery', async t => {
  const dom = new JSDOM('<main></main>', { url: 'https://example.test' });
  const calls = [];
  const gallery = galleryCases.find(entry => entry.name === 'orders').factory(galleryOptions(
    galleryCases.find(entry => entry.name === 'orders'), dom.window.document, {
      data: {
        loadSnapshot: async options => { calls.push(['orders', options?.refresh]); return { rows: [] }; },
        invalidateRelatedReports: () => calls.push(['invalidate-linked']),
        loadLinkedReport: async id => { calls.push(['linked', id]); return {}; },
      },
    }));
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  dom.window.document.querySelector('[data-gallery-refresh]').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(calls, [['orders', false], ['invalidate-linked'], ['orders', true]]);
});

test('IDFOLHA sync invalidates the FOLHAPGTO report source regardless of rows', async t => {
  const dom = new JSDOM('<main></main>', { url: 'https://example.test' });
  const calls = [];
  const entry = galleryCases.find(item => item.name === 'IDFOLHA');
  const gallery = entry.factory(galleryOptions(entry, dom.window.document, {
    request: async (name, page, pageSize, cursor, options) => {
      calls.push([name, options?.refresh]);
      return { gallery: name, page: 1, rows: [], count: 0, filterOptions: {}, hasMore: false };
    },
    invalidateRelatedReports: () => calls.push(['invalidate-payments']),
  }));
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  dom.window.document.querySelector('[data-gallery-refresh]').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(calls, [['IDFOLHA', true], ['invalidate-payments'], ['IDFOLHA', true]]);
});

test('FOLHAPGTO sync invalidates the standalone supplier payroll report', async t => {
  const dom = new JSDOM('<main></main>', { url: 'https://example.test' });
  const calls = [];
  const entry = galleryCases.find(item => item.name === 'FOLHAPGTO');
  const gallery = entry.factory(galleryOptions(entry, dom.window.document, {
    invalidateRelatedReports: () => calls.push('invalidate-supplier-report'),
  }));
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  dom.window.document.querySelector('[data-gallery-refresh]').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(calls, ['invalidate-supplier-report']);
});

test('launch sync invalidates linked order and launch report sources regardless of rows', async t => {
  const dom = new JSDOM('<main></main>', { url: 'https://example.test' });
  const calls = [];
  const entry = galleryCases.find(item => item.name === 'launch');
  const gallery = entry.factory(galleryOptions(entry, dom.window.document, {
    request: async () => { calls.push('launch'); return { rows: [], page: 1, pages: 1, totals: {} }; },
    invalidateRelatedReports: () => calls.push('invalidate-linked'),
  }));
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  dom.window.document.querySelector('[data-gallery-refresh]').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(calls, ['launch', 'invalidate-linked', 'launch']);
});
