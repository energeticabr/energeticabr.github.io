import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { galleryCases, galleryOptions } from './helpers/gallery-create-cases.mjs';
import { loadingRow } from './helpers/gallery-loading-cases.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
function visibleIds(root, entry) {
  if (entry.options?.gallery) return [...root.querySelectorAll('.hr-gallery-id')]
    .map(node => node.textContent.replace(/^ID /, '')).sort();
  return [...root.querySelectorAll('.lg-cards > [data-item-id], .og-cards > [data-item-id], [data-registration-row]')]
    .map(node => node.dataset.itemId || node.dataset.registrationRow).sort();
}

for (const entry of galleryCases) {
  test(entry.name + ': search updates between keystrokes without interrupting the active field', async t => {
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
    for (const [text, expected] of [
      ['9', ['901', '902', '991']], ['90', ['901', '902']], ['901', ['901']], ['', ['901', '902', '991']],
    ]) {
      input.value = text;
      input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
      input.setSelectionRange(0, Math.min(1, text.length));
      t.mock.timers.tick(0);
      await settle();
      assert.deepEqual(visibleIds(root, entry), expected, 'results adopt ' + JSON.stringify(text) + ' without waiting for a typing pause');
      assert.equal(root.querySelector('[data-gallery-quick-search]'), input);
      assert.equal(doc.activeElement, input);
      assert.equal(input.value, text);
      assert.deepEqual([input.selectionStart, input.selectionEnd], [0, Math.min(1, text.length)]);
      assert.equal(input.disabled, false);
      for (let node = input; node && node !== root; node = node.parentElement) {
        assert.notEqual(node.inert, true);
        assert.notEqual(node.getAttribute('aria-hidden'), 'true');
      }
      if (entry.name === 'launch' || entry.options?.gallery) assert.equal(requests.at(-1).search, text);
    }
  });
}
