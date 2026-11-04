import test from 'node:test';
import assert from 'node:assert/strict';
import { readPdfTextContent } from '../src/web/pdf-text-content.js';

test('text chunks retain item order, font styles, language and extraction options without an async iterator', async () => {
  const options = { disableNormalization: true }, first = { str: 'Linha' }, second = { str: 'fictícia' };
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue({ items: [first], styles: { fontA: { ascent: .8 } } });
    controller.enqueue({ items: [second], styles: { fontB: { vertical: true } }, lang: 'pt-BR' });
    controller.enqueue({ items: [], styles: {}, lang: 'en-US' });
    controller.close();
  } });
  Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined });
  const result = await readPdfTextContent({ streamTextContent(params) { assert.equal(params, options); return stream; } }, options);
  assert.deepEqual(result.items, [first, second]);
  assert.deepEqual({ ...result.styles }, { fontA: { ascent: .8 }, fontB: { vertical: true } });
  assert.equal(Object.getPrototypeOf(result.styles), null);
  assert.equal(result.lang, 'pt-BR');
  assert.equal(stream.locked, false);
});

test('a rejected text stream keeps its original error and releases its reader', async () => {
  const failure = new Error('damaged PDF text');
  const stream = new ReadableStream({ pull(controller) { controller.error(failure); } });
  await assert.rejects(readPdfTextContent({ streamTextContent: () => stream }), error => error === failure);
  assert.equal(stream.locked, false);
});

test('pure XFA and older page adapters retain their existing text extraction path', async () => {
  const content = { items: [{ str: 'Texto fictício' }], styles: {}, lang: 'pt-BR' }, options = { includeMarkedContent: true };
  for (const isPureXfa of [false, true]) {
    const page = { isPureXfa, getTextContent(params) { assert.equal(params, options); return content; } };
    if (isPureXfa) page.streamTextContent = () => { throw new Error('XFA must use its own extractor'); };
    assert.equal(await readPdfTextContent(page, options), content);
  }
});
