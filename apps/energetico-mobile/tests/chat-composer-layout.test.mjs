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
  assert.match(composer, /padding:\s*4px\s+10px\s+max\(4px,\s*env\(safe-area-inset-bottom\)\)/);
  assert.match(composer, /background:\s*var\(--surface-soft\)/);
  assert.doesNotMatch(composer, /border-top:\s*1px/);
});

test("o shell ocupa a viewport e o cabeçalho não revela faixas ao rolar", async () => {
  const css = await readFile(stylesPath, "utf8");
  const shell = css.match(/\.chat-shell\s*\{[^}]*\}/)?.[0] || "";
  const header = css.match(/\.chat-header\s*\{[^}]*\}/)?.[0] || "";

  assert.match(css, /html\s*\{[^}]*overscroll-behavior-y:\s*none/);
  assert.match(css, /body\s*\{[^}]*overflow:\s*hidden/);
  assert.match(shell, /position:\s*fixed/);
  assert.match(shell, /inset:\s*0/);
  assert.match(css, /\.chat-transcript\s*\{[^}]*overscroll-behavior:\s*contain/);
  assert.match(header, /padding:\s*max\(4px,\s*env\(safe-area-inset-top\)\)/);
});
