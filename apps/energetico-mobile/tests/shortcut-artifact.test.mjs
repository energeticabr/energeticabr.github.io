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

test("a compilação mantém distintos os grupos da condição e da repetição", async () => {
  const plist = await readFile(new URL("../shortcut/ENERGÉTICO.plist", import.meta.url), "utf8");
  const groups = [...plist.matchAll(/<key>GroupingIdentifier<\/key>\s*<string>([^<]+)<\/string>/g)].map(match => match[1]);
  assert.equal(groups.length, 4, "cada bloco precisa de início e fim");
  assert.equal(new Set(groups).size, 2, "condição e repetição não podem compartilhar identificador");
  assert.equal(groups[0], groups[3], "a condição envolve a repetição");
  assert.equal(groups[1], groups[2], "a repetição fecha antes da condição");
  const uuids = [...plist.matchAll(/<key>UUID<\/key>\s*<string>([^<]+)<\/string>/g)].map(match => match[1]);
  assert.ok(uuids.length > 0);
  assert.equal(new Set(uuids).size, uuids.length, "as ações não podem ter UUIDs duplicados");
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
