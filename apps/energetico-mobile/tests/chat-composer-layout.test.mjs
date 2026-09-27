import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const stylesPath = fileURLToPath(new URL("../src/styles.css", import.meta.url));
const chatViewPath = fileURLToPath(new URL("../src/ui/chat-view.js", import.meta.url));
const capacitorConfigPath = fileURLToPath(new URL("../capacitor.config.json", import.meta.url));
const iosBridgePath = fileURLToPath(new URL("../ios/App/App/EnergeticoBridgeViewController.swift", import.meta.url));

test("o azul-claro do compositor também pinta o fundo e a área segura do app", async () => {
  const [css, configText, iosBridge] = await Promise.all([
    readFile(stylesPath, "utf8"),
    readFile(capacitorConfigPath, "utf8"),
    readFile(iosBridgePath, "utf8"),
  ]);
  const config = JSON.parse(configText);
  const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body><div id="app"></div></body></html>`);
  const { document } = dom.window;
  const background = "var(--surface-soft)";
  const softColor = dom.window.getComputedStyle(document.documentElement).getPropertyValue("--surface-soft");

  assert.equal(softColor, "#e4f0f3");
  assert.equal(dom.window.getComputedStyle(document.documentElement).background, background);
  assert.equal(dom.window.getComputedStyle(document.body).background, background);
  assert.equal(dom.window.getComputedStyle(document.querySelector("#app")).background, background);
  assert.equal(Object.hasOwn(config, "backgroundColor"), false);
  assert.equal(config.ios.contentInset, "never");
  assert.match(iosBridge, /let composerBackgroundColor = UIColor \{\s*traits in/);
  assert.match(iosBridge, /traits\.userInterfaceStyle == \.dark/);
  assert.match(iosBridge, /view\.backgroundColor = composerBackgroundColor/);
  assert.match(iosBridge, /webView\.backgroundColor = composerBackgroundColor/);
  assert.match(iosBridge, /webView\.scrollView\.backgroundColor = composerBackgroundColor/);
  assert.match(iosBridge, /traits\.userInterfaceStyle == \.dark \? 23 : 228/);
  assert.match(iosBridge, /traits\.userInterfaceStyle == \.dark \? 56 : 240/);
  assert.match(iosBridge, /traits\.userInterfaceStyle == \.dark \? 68 : 243/);
  dom.window.close();
});

test("tema escuro mantém a safe area no azul do compositor, separada do histórico", async () => {
  const css = await readFile(stylesPath, "utf8");
  const darkRules = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(darkRules, "regras do tema escuro devem existir");
  const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body><div id="app"><main class="chat-transcript"></main><footer class="chat-composer"></footer></div></body></html>`);
  const darkStyle = dom.window.document.createElement("style");
  darkStyle.textContent = darkRules;
  dom.window.document.head.append(darkStyle);

  assert.equal(dom.window.getComputedStyle(dom.window.document.documentElement).getPropertyValue("--surface-soft"), "#173844");
  assert.equal(dom.window.getComputedStyle(dom.window.document.body).background, "var(--surface-soft)");
  assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector(".chat-composer")).background, "var(--surface-soft)");
  assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector(".chat-transcript")).background, "rgb(9, 30, 38)");
  dom.window.close();
});

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

test("popups crescem com a viewport, mas mantêm limites máximos", async () => {
  const css = await readFile(stylesPath, "utf8");

  assert.match(css, /\.chat-confirmation\s*\{[^}]*width:\s*min\(100%,\s*560px\)/);
  assert.match(css, /\.chat-attachment-source\s*\{[^}]*width:\s*min\(100%,\s*520px\)/);
  assert.match(css, /\.chat-date-picker\s*\{[^}]*width:\s*min\(100%,\s*600px\)/);
  assert.match(css, /\.chat-confirmation__stack\s+button\s*\{[^}]*min-height:\s*clamp\(50px/);
  assert.match(css, /\.setup-panel\s*\{[^}]*max-height:\s*min\(90dvh,\s*900px\)/);
  assert.match(css, /\.setup-panel\s*\{[^}]*width:\s*min\(760px,\s*calc\(100%\s-\s40px\)\)/);
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
  assert.match(header, /padding:\s*4px\s+12px/);
});

test("cabeçalho mantém os dados centralizados e não duplica espaço vertical da área segura", async () => {
  const css = await readFile(stylesPath, "utf8");
  const header = css.match(/\.chat-header\s*\{[^}]*\}/)?.[0] || "";

  assert.match(header, /align-items:\s*center/);
  assert.match(header, /padding:\s*4px\s+12px/);
  assert.doesNotMatch(header, /safe-area-inset-top/);
});

test("PWA standalone reserva área segura fora da faixa azul compacta", async () => {
  const css = await readFile(stylesPath, "utf8");

  assert.match(css, /@media\s*\(display-mode:\s*standalone\)\s*\{\s*\.chat-shell\s*\{[^}]*padding-top:\s*env\(safe-area-inset-top\)/);
});

test("tablet horizontal usa a largura da tela e distribui melhor os menus", async () => {
  const css = await readFile(stylesPath, "utf8");

  assert.match(css, /@media\s*\(min-width:\s*760px\)\s+and\s+\(orientation:\s*landscape\)/);
  assert.match(css, /\.chat-shell\s*\{[^}]*width:\s*min\(100%,\s*1280px\)/);
  assert.match(css, /\.chat-message--assistant\s+\.chat-bubble\s*\{[^}]*max-width:\s*none/);
  assert.match(css, /\.chat-choice-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test("assinatura e posicionamento usam quase toda a tela do tablet horizontal", async () => {
  const css = await readFile(stylesPath, "utf8");
  const chatView = await readFile(chatViewPath, "utf8");

  assert.match(css, /\.chat-confirmation-backdrop\[data-signature-pad-dialog\]\s*\{[^}]*padding:\s*max\(8px,\s*env\(safe-area-inset-top\)\)\s+8px/);
  assert.match(css, /\.chat-signature-pad\s*\{[^}]*width:\s*100%[^}]*height:\s*calc\(100dvh\s*-\s*16px\)/);
  assert.match(css, /\.chat-signature-pad__surface\s*\{[^}]*flex:\s*1\s+1\s+auto/);
  assert.match(css, /\.chat-signature-pad__surface\s+canvas\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/);
  assert.match(css, /\.signature-placement-dialog\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*max-height:\s*none/);
  assert.match(chatView, /data-role="signature-pad"\s+width="900"\s+height="360"/);
});

test("mantém a perspectiva das assinaturas proporcional à página no tablet", async () => {
  const css = await readFile(stylesPath, "utf8");

  assert.match(css, /\.signature-placement-marker\s*\{[^}]*width:\s*64%[^}]*\}/);
  assert.match(css, /\.signature-placement-stamp-marker\s*\{[^}]*width:\s*38%[^}]*\}/);
  assert.match(css, /data-signature-document-layout="payment"[^}]*\.signature-placement-marker\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*72%\)\s+minmax\(0,\s*28%\)[^}]*gap:\s*0[^}]*padding:\s*0/);
  assert.match(css, /data-signature-document-layout="epi"[^}]*\.signature-placement-marker\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*68%\)\s+minmax\(0,\s*32%\)[^}]*gap:\s*0[^}]*padding:\s*0/);
});
