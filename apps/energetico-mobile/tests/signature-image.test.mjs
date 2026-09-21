import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSignaturePixels,
  signatureOutputSize,
} from "../src/web/signature-image.js";

test("converte a tinta da assinatura para preto sem perder a suavização do traço", () => {
  const pixels = new Uint8ClampedArray([
    255, 255, 255, 255,
    16, 47, 59, 255,
    16, 47, 59, 96,
    255, 255, 255, 0,
  ]);

  const bounds = normalizeSignaturePixels(pixels, 4, 1);

  assert.deepEqual(bounds, { left: 1, top: 0, right: 2, bottom: 0 });
  assert.deepEqual(Array.from(pixels.slice(0, 4)), [255, 255, 255, 0]);
  assert.deepEqual(Array.from(pixels.slice(4, 8)), [0, 0, 0, 255]);
  assert.deepEqual(Array.from(pixels.slice(8, 12)), [0, 0, 0, 96]);
});

test("exporta recortes pequenos com resolução suficiente para o PDF", () => {
  assert.deepEqual(signatureOutputSize(120, 40), { width: 1200, height: 400, scale: 10 });
  assert.deepEqual(signatureOutputSize(1800, 600), { width: 1800, height: 600, scale: 1 });
  assert.deepEqual(signatureOutputSize(4800, 1600), { width: 2400, height: 800, scale: 0.5 });
});
