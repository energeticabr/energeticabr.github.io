import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const stylesPath = fileURLToPath(new URL("../src/styles.css", import.meta.url));

test("a barra de digitação fica no fluxo do shell e não cria espaço vazio no rodapé", async () => {
  const css = await readFile(stylesPath, "utf8");
  const composer = css.match(/\.chat-composer\s*\{[^}]*\}/)?.[0] || "";

  assert.match(css, /\.chat-shell\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.chat-transcript\s*\{[^}]*flex:\s*1/);
  assert.match(composer, /position:\s*relative/);
  assert.match(composer, /flex:\s*0\s+0\s+auto/);
  assert.doesNotMatch(composer, /position:\s*fixed/);
});
