import test from "node:test";
import assert from "node:assert/strict";
import { createMediaThumbnail } from "../src/web/media-thumbnail.js";

test("PDF com MIME genérico gera só a primeira página e carrega fontes locais", async () => {
  let options, requestedPage, destroyed = false;
  const canvas = { getContext: () => ({}), toBlob: callback => callback(new Blob(["thumbnail"], { type: "image/jpeg" })) };
  const url = await createMediaThumbnail(new Blob(["%PDF"], { type: "application/octet-stream" }), "NOTA.PDF", {
    documentRef: { baseURI: "https://example.test/energetico/", createElement: () => canvas },
    urlApi: { createObjectURL: blob => { assert.equal(blob.type, "image/jpeg"); return "blob:pdf-preview"; } },
    loadPdf: async () => ({ getDocument: input => {
      options = input;
      return {
        promise: Promise.resolve({ getPage: async number => {
          requestedPage = number;
          return { getViewport: ({ scale }) => ({ width: 600 * scale, height: 900 * scale }), render: () => ({ promise: Promise.resolve() }) };
        } }),
        destroy: async () => { destroyed = true; },
      };
    } }),
  });
  assert.equal(url, "blob:pdf-preview");
  assert.equal(requestedPage, 1);
  assert.ok(canvas.width <= 520 && canvas.height <= 520);
  assert.equal(options.standardFontDataUrl, "https://example.test/energetico/pdfjs/standard_fonts/");
  assert.equal(options.cMapPacked, true);
  assert.equal(options.enableXfa, false);
  assert.equal(destroyed, true);
});

test("PDF acima do limite não inicia renderização", async () => {
  const result = await createMediaThumbnail({ type: "application/pdf", size: 60_000_001 }, "grande.pdf", {
    loadPdf: () => { throw new Error("não deve carregar"); },
  });
  assert.equal(result, null);
});
