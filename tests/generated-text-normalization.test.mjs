import assert from "node:assert/strict";
import test from "node:test";

import { generatedTextMatches } from "../scripts/generated-text-normalization.mjs";

test("arquivos gerados equivalentes nao divergem apenas por LF ou CRLF", () => {
  assert.equal(generatedTextMatches("linha 1\r\nlinha 2\r\n", "linha 1\nlinha 2\n"), true);
});

test("arquivos gerados com conteudo diferente continuam divergentes", () => {
  assert.equal(generatedTextMatches("linha 1\r\nlinha 2\r\n", "linha 1\nlinha 3\n"), false);
});
