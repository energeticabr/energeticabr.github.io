import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const shortcutUrl = new URL("../pwa/downloads/ENERGÉTICO.shortcut", import.meta.url);
const sourceUrl = new URL("../shortcut/ENERGÉTICO.cherri", import.meta.url);

test("distribui um Atalho assinado que o iPhone pode importar", async () => {
  assert.equal(existsSync(shortcutUrl), true, "o arquivo instalável precisa existir");
  const shortcut = await readFile(shortcutUrl);

  assert.equal(shortcut.subarray(0, 4).toString("ascii"), "AEA1");
  assert.ok(shortcut.length > 1_000);
});

test("o arquivo entregue ao iPhone usa somente o nome ENERGÉTICO", () => {
  assert.equal(decodeURIComponent(shortcutUrl.pathname).endsWith("/ENERGÉTICO.shortcut"), true);
});

test("o Atalho envia individualmente todos os itens compartilhados", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /for sharedItem in ShortcutInput/);
  assert.match(source, /\"WFRequestVariable\": \"\$\{@sharedItem\}\"/);
});

test("o Atalho abre o chatbot mesmo quando não recebe anexos", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /^#define name ENERGÉTICO$/m);
  assert.doesNotMatch(source, /#define noinput stopwith/);
  assert.match(source, /if ShortcutInput\s*{\s*for sharedItem in ShortcutInput/s);
  assert.match(source, /openURL\("https:\/\/www\.energeticabr\.com\/energetico\/"\)/);
});
