import assert from 'node:assert/strict';
import { afterEach } from 'node:test';
import { createRequire } from 'node:module';

const { JSDOM } = createRequire(new URL('../../apps/energetico-mobile/package.json', import.meta.url))('jsdom');
const documents = new Set();
afterEach(() => {
  for (const dom of documents) dom.window.close();
  documents.clear();
});

// Retain existing selector/provider doubles while giving the shared modal a
// connected DOM owner, focus, attributes and lifecycle instead of faking consent.
export function createReviewForm(properties = {}) {
  const dom = new JSDOM('<body><form></form></body>', { pretendToBeVisual: true });
  documents.add(dom);
  const form = dom.window.document.querySelector('form');
  for (const [name, value] of Object.entries(properties)) {
    Object.defineProperty(form, name, { configurable: true, writable: true, value });
  }
  return form;
}

export function submitAndConfirm(form, submit) {
  const pending = submit();
  const review = form.ownerDocument.querySelector('[data-edit-review]');
  if (review) {
    assert.deepEqual([...review.querySelectorAll('th')].map(th => th.textContent), ['Campo', 'Antes', 'Depois']);
    review.querySelector('[data-edit-review-confirm]').click();
  }
  return pending;
}
