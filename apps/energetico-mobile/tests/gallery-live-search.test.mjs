import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { galleryCases, galleryOptions } from './helpers/gallery-create-cases.mjs';
import { loadingRow } from './helpers/gallery-loading-cases.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));

for (const name of ['IDFOLHA', 'FOLHAPGTO']) for (const completion of ['success', 'error']) {
  test(name + ': returning to a discarded query reloads it after ' + completion, async t => {
    const entry = galleryCases.find(item => item.name === name);
    const dom = new JSDOM('<body></body>'), pending = [];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dom.window.setTimeout = globalThis.setTimeout; dom.window.clearTimeout = globalThis.clearTimeout;
    const result = id => ({ gallery: name, rows: [loadingRow(entry, id)], page: 1, hasMore: false, nextCursor: null });
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, {
      request: (...args) => new Promise((resolve, reject) => pending.push({ resolve, reject, filters: args[4].filters })),
    }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    const opening = gallery.open(); pending[0].resolve(result('901')); await opening;
    const root = dom.window.document.querySelector(entry.root), input = root.querySelector('[data-gallery-quick-search]');
    const type = value => { input.value = value; input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true })); };
    type('ab'); t.mock.timers.tick(1000); await settle();
    type('abc');
    if (completion === 'error') pending[1].reject(new Error('OBSOLETE_QA'));
    else pending[1].resolve(result('902'));
    await settle();
    type('ab'); t.mock.timers.tick(1000); await settle();
    assert.equal(pending.length, 3, 'discarding a query cannot count as displaying its results');
    assert.equal(pending[2].filters.search, 'ab');
    pending[2].resolve(result('991')); await settle();
    assert.deepEqual(visibleIds(root, entry), ['991']);
  });
}

for (const name of ['IDFOLHA', 'FOLHAPGTO']) {
  test(name + ': reopening adopts the current text before deduplicating the next search', async t => {
    const entry = galleryCases.find(item => item.name === name);
    const dom = new JSDOM('<body></body>'), pending = [];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dom.window.setTimeout = globalThis.setTimeout; dom.window.clearTimeout = globalThis.clearTimeout;
    const result = id => ({ gallery: name, rows: [loadingRow(entry, id)], page: 1, hasMore: false, nextCursor: null });
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, {
      request: (...args) => new Promise((resolve, reject) => pending.push({ resolve, reject, filters: args[4].filters })),
    }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    const opening = gallery.open(); pending[0].resolve(result('901')); await opening;
    const root = dom.window.document.querySelector(entry.root), input = root.querySelector('[data-gallery-quick-search]');
    const type = value => { input.value = value; input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true })); };
    type('a'); t.mock.timers.tick(1000); await settle(); pending[1].resolve(result('902')); await settle();
    type('b'); gallery.close();
    const reopening = gallery.open();
    assert.equal(pending[2].filters.search, 'b');
    pending[2].resolve(result('991')); await reopening;
    input.focus(); type('a'); t.mock.timers.tick(1000); await settle();
    assert.equal(pending.length, 4, 'the pre-close query cannot suppress a new search after reopening');
    assert.equal(pending[3].filters.search, 'a');
    pending[3].resolve(result('901')); await settle();
    assert.deepEqual(visibleIds(root, entry), ['901']);
    assert.equal(dom.window.document.activeElement, input);
  });
}

for (const startEvent of [false, true]) {
  test('registration search commits composition only at its end (start event=' + startEvent + ')', async t => {
    const entry = galleryCases.find(item => item.name === 'group');
    const dom = new JSDOM('<body></body>');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dom.window.setTimeout = globalThis.setTimeout; dom.window.clearTimeout = globalThis.clearTimeout;
    const rows = ['901', '902', '991'].map(id => loadingRow(entry, id));
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, { snapshot: { rows } }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    await gallery.open();
    const doc = dom.window.document, root = doc.querySelector(entry.root), input = root.querySelector('[data-gallery-quick-search]');
    input.focus();
    if (startEvent) input.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    input.value = '90';
    input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, isComposing: true }));
    assert.deepEqual(visibleIds(root, entry), ['901', '902', '991'], 'unfinished input cannot change results');
    const status = root.querySelector('[data-filter-field="STATUS"]');
    status.value = ''; status.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await settle();
    assert.deepEqual(visibleIds(root, entry), ['901', '902', '991'], 'other redraws must use the committed search');
    input.setSelectionRange(1, 2);
    input.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
    t.mock.timers.tick(999);
    assert.deepEqual(visibleIds(root, entry), ['901', '902', '991']);
    t.mock.timers.tick(1);
    assert.deepEqual(visibleIds(root, entry), ['901', '902']);
    assert.equal(doc.activeElement, input);
    assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 2]);
  });
}

function visibleIds(root, entry) {
  if (entry.options?.gallery) return [...root.querySelectorAll('.hr-gallery-id')]
    .map(node => node.textContent.replace(/^ID /, '')).sort();
  return [...root.querySelectorAll('.lg-cards > [data-item-id], .og-cards > [data-item-id], [data-registration-row]')]
    .map(node => node.dataset.itemId || node.dataset.registrationRow).sort();
}

for (const entry of galleryCases) {
  test(entry.name + ': search waits one second from the last input and Enter applies immediately', async t => {
    const dom = new JSDOM('<body></body>', { url: 'https://example.test' });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dom.window.setTimeout = globalThis.setTimeout;
    dom.window.clearTimeout = globalThis.clearTimeout;
    const rows = ['901', '902', '991'].map(id => {
      const row = loadingRow(entry, id);
      if (entry.name === 'provisionDescription') row.fields.STATUS = row.STATUS = 'PAGAMENTO PREVISTO';
      return row;
    });
    const requests = [];
    const serverRows = { '': rows, '9': rows, '90': rows.slice(0, 2), '901': rows.slice(0, 1) };
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, {
      snapshot: { rows },
      request: async (...args) => {
        const filters = args[4]?.filters || args[1]?.filters || {};
        requests.push({ ...filters });
        const resultRows = serverRows[filters.search || ''] || [];
        return { rows: resultRows, count: resultRows.length, page: 1, pages: 1,
          gallery: entry.options?.gallery, hasMore: false, nextCursor: null, filterOptions: {}, totals: {} };
      },
    }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    await gallery.open();
    const doc = dom.window.document, root = doc.querySelector(entry.root);
    const input = root.querySelector('[data-gallery-quick-search]');
    assert.deepEqual(visibleIds(root, entry), ['901', '902', '991'], 'fixture starts with three visible records');
    input.focus();
    const type = text => {
      input.value = text;
      input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
    };
    const baselineRequests = requests.length;
    type('9');
    t.mock.timers.tick(700);
    type('90');
    t.mock.timers.tick(700);
    type('901');
    input.setSelectionRange(0, 1);
    t.mock.timers.tick(500);
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    input.dispatchEvent(new dom.window.Event('search', { bubbles: true }));
    t.mock.timers.tick(499);
    await settle();
    assert.deepEqual(visibleIds(root, entry), ['901', '902', '991']);
    assert.equal(requests.length, baselineRequests, 'partial text must not request a snapshot');
    t.mock.timers.tick(1);
    await settle();
    assert.deepEqual(visibleIds(root, entry), ['901']);
    assert.equal(root.querySelector('[data-gallery-quick-search]'), input);
    assert.equal(doc.activeElement, input);
    assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 1]);
    assert.equal(input.disabled, false);
    for (let node = input; node && node !== root; node = node.parentElement) {
      assert.notEqual(node.inert, true);
      assert.notEqual(node.getAttribute('aria-hidden'), 'true');
    }
    const remoteSearch = entry.name === 'launch' || entry.options?.gallery;
    if (remoteSearch) assert.deepEqual(requests.slice(baselineRequests).map(filters => filters.search), ['901']);

    type('');
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    assert.deepEqual(visibleIds(root, entry), ['901', '902', '991']);
    const requestsAfterEnter = requests.length;
    if (remoteSearch) assert.deepEqual(requests.slice(baselineRequests).map(filters => filters.search), ['901', '']);
    t.mock.timers.tick(1000);
    await settle();
    assert.equal(requests.length, requestsAfterEnter);
  });
}

for (const name of ['IDFOLHA', 'FOLHAPGTO']) for (const completion of ['success', 'error']) {
  test(name + ': obsolete ' + completion + ' cannot replace rows between input and the next search task', async t => {
    const entry = galleryCases.find(item => item.name === name);
    const dom = new JSDOM('<body></body>'), pending = [];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dom.window.setTimeout = globalThis.setTimeout;
    dom.window.clearTimeout = globalThis.clearTimeout;
    const result = id => ({ gallery: name, rows: [loadingRow(entry, id)], page: 1, hasMore: false, nextCursor: null });
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, {
      request: (...args) => new Promise((resolve, reject) => pending.push({ resolve, reject, filters: args[4].filters })),
    }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    const opening = gallery.open(); pending[0].resolve(result('901')); await opening;
    const doc = dom.window.document, root = doc.querySelector(entry.root);
    const input = root.querySelector('[data-gallery-quick-search]');
    input.focus(); input.value = 'anterior';
    input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
    t.mock.timers.tick(1000); await settle();
    input.value = 'nova';
    input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
    input.setSelectionRange(1, 2);
    if (completion === 'error') pending[1].reject(new Error('OBSOLETE_QA'));
    else pending[1].resolve(result('902'));
    await settle();
    assert.deepEqual(visibleIds(root, entry), ['901'], 'obsolete completion preserves the displayed rows');
    assert.doesNotMatch(root.querySelector('.hr-gallery-status').textContent, /OBSOLETE_QA/);
    assert.equal(doc.activeElement, input);
    assert.equal(input.value, 'nova');
    assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 2]);
    t.mock.timers.tick(1000); await settle();
    assert.equal(pending[2].filters.search, 'nova');
    pending[2].resolve(result('991')); await settle();
    assert.deepEqual(visibleIds(root, entry), ['991']);
    assert.doesNotMatch(root.querySelector('.hr-gallery-status').textContent, /OBSOLETE_QA/);
  });
}

for (const name of ['orders', 'tasks', 'recurring', 'payments']) {
  test(name + ': reopening consumes a pending query and clearing it restores all results', async t => {
    const entry = galleryCases.find(item => item.name === name);
    const dom = new JSDOM('<body></body>');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    dom.window.setTimeout = globalThis.setTimeout; dom.window.clearTimeout = globalThis.clearTimeout;
    const rows = ['901', '902', '991'].map(id => loadingRow(entry, id));
    const gallery = entry.factory(galleryOptions(entry, dom.window.document, { snapshot: { rows } }));
    t.after(() => { gallery.destroy(); dom.window.close(); });
    await gallery.open();
    const root = dom.window.document.querySelector(entry.root);
    const input = root.querySelector('[data-gallery-quick-search]');
    const type = value => {
      input.value = value;
      input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
    };
    type('901');
    gallery.close();
    await gallery.open();
    assert.deepEqual(visibleIds(root, entry), ['901']);
    type('');
    t.mock.timers.tick(1000);
    assert.deepEqual(visibleIds(root, entry), ['901', '902', '991']);
  });
}
