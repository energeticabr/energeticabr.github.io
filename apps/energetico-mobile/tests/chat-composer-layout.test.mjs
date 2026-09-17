import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const stylesPath = fileURLToPath(new URL("../src/styles.css", import.meta.url));
const chatViewPath = fileURLToPath(new URL("../src/ui/chat-view.js", import.meta.url));

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

test("seletor de data fica centralizado com recuo igual dentro do pop-up", async () => {
  const css = await readFile(stylesPath, "utf8");
  const input = css.match(/\.chat-date-picker__input\s*\{[^}]*\}/)?.[0] || "";

  assert.match(input, /width:\s*calc\(100%\s*-\s*16px\)/);
  assert.match(input, /margin:\s*0\s+auto\s+18px/);
  assert.match(input, /min-width:\s*0/);
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

test("tablet horizontal usa a largura da tela e distribui melhor os menus", async () => {
  const css = await readFile(stylesPath, "utf8");

  assert.match(css, /@media\s*\(min-width:\s*760px\)\s+and\s+\(orientation:\s*landscape\)/);
  assert.match(css, /\.chat-shell\s*\{[^}]*width:\s*min\(100%,\s*1280px\)/);
  assert.match(css, /\.chat-message--assistant\s+\.chat-bubble\s*\{[^}]*max-width:\s*none/);
  assert.match(css, /\.chat-choice-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test("a área de assinatura cresce no tablet sem alterar o tamanho interno enviado", async () => {
  const css = await readFile(stylesPath, "utf8");
  const chatView = await readFile(chatViewPath, "utf8");

  assert.match(css, /\.chat-signature-pad\s*\{[^}]*width:\s*min\(100%,\s*1160px\)/);
  assert.match(css, /\.chat-signature-pad__surface\s+canvas\s*\{[^}]*width:\s*100%/);
  assert.match(chatView, /data-role="signature-pad"\s+width="900"\s+height="360"/);
});
