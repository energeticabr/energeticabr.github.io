import test from "node:test";
import assert from "node:assert/strict";

import { MAX_UPLOAD_BYTES, validateAttachment } from "../src/chat/file-policy.js";

test("aceita foto válida e devolve o nome preservado", () => {
  assert.equal(
    validateAttachment({ name: "Foto 1.jpg", size: 128, type: "image/jpeg" }),
    "Foto 1.jpg",
  );
});

test("bloqueia executáveis por extensão e MIME", () => {
  assert.throws(
    () => validateAttachment({ name: "ata.exe", size: 10, type: "application/octet-stream" }),
    /não permitido/,
  );
  assert.throws(
    () => validateAttachment({ name: "ata.bin", size: 10, type: "application\/x-msdownload" }),
    /não permitido/,
  );
});

test("bloqueia arquivo vazio ou acima de 60 MB", () => {
  assert.throws(
    () => validateAttachment({ name: "vazio.pdf", size: 0, type: "application/pdf" }),
    /vazio/,
  );
  assert.throws(
    () => validateAttachment({ name: "grande.pdf", size: MAX_UPLOAD_BYTES + 1, type: "application/pdf" }),
    /60 MB/,
  );
});

test("bloqueia nome longo ou com quebra de linha", () => {
  assert.throws(
    () => validateAttachment({ name: "foto\r\ninjetada.jpg", size: 10, type: "image/jpeg" }),
    /nome/,
  );
  assert.throws(
    () => validateAttachment({ name: `${"a".repeat(181)}.jpg`, size: 10, type: "image/jpeg" }),
    /nome/,
  );
});
