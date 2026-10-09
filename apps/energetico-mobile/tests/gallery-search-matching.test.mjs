import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesGallerySearch } from '../src/chat/gallery-quick-search.js';

test('quick search combines words from fields without accents or case sensitivity', () => {
  assert.equal(matchesGallerySearch('81 JOSE central', [81, 'São José', 'Central']), true);
  assert.equal(matchesGallerySearch('jose norte', [81, 'São José', 'Central']), false);
  assert.equal(matchesGallerySearch('  ', [null]), true);
});
test('quick search recognizes displayed Brazilian currency and dates and lookup values', () => {
  assert.equal(matchesGallerySearch('1.250,50 08/10/2026 mauro', [1250.5, '2026-10-08', { LookupValue: 'Mauro' }]), true);
  assert.equal(matchesGallerySearch('R$ 1.250,50', [1250.5]), true);
  assert.equal(matchesGallerySearch('segredo', [{ internalToken: 'segredo' }]), false);
  assert.equal(matchesGallerySearch('jose', [['Mauro', { Value: 'José' }]]), true);
});

test('full timestamps use the gallery-provided civil date rather than inventing a UTC date alias', () => {
  const values = ['2026-10-09T02:00:00Z', '08/10/2026'];
  assert.equal(matchesGallerySearch('08/10/2026', values), true);
  assert.equal(matchesGallerySearch('09/10/2026', values), false);
  assert.equal(matchesGallerySearch('2026-10-09', values), true);
});
