import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { shouldCacheRequest } from "../src/web/cache-policy.js";

function pngDimensions(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("manifesto instala somente o Energético com o mascote", async () => {
  const manifest = JSON.parse(await readFile(new URL("../pwa/manifest.webmanifest", import.meta.url), "utf8"));

  assert.equal(manifest.name, "ENERGÉTICO");
  assert.equal(manifest.short_name, "ENERGÉTICO");
  assert.equal(manifest.start_url, "/energetico/");
  assert.equal(manifest.scope, "/energetico/");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ["192x192", "512x512"]);
});

test("ícones instaláveis têm as dimensões declaradas", async () => {
  for (const size of [192, 512]) {
    const image = await readFile(new URL(`../pwa/icons/mascote-${size}.png`, import.meta.url));
    assert.deepEqual(pngDimensions(image), { width: size, height: size });
  }
});

test("shell tem metadados standalone e não contém navegação do portal", async () => {
  const html = await readFile(new URL("../pwa/index.html", import.meta.url), "utf8");

  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-title" content="ENERGÉTICO"/);
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /apple-touch-icon/);
  assert.doesNotMatch(html, /Painel inicial|Detalhamento\/Auditoria|admin\.html/);
});

test("cache recusa API, Microsoft e métodos de escrita", () => {
  assert.equal(shouldCacheRequest(new Request("https://www.energeticabr.com/energetico/assets/app.js")), true);
  assert.equal(shouldCacheRequest(new Request("https://163-176-171-217.sslip.io/api/portal-chat")), false);
  assert.equal(shouldCacheRequest(new Request("https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize")), false);
  assert.equal(shouldCacheRequest(new Request("https://www.energeticabr.com/energetico/", { method: "POST" })), false);
});

test("web ativa somente a etapa atual sem mudar o histórico do aplicativo nativo", async () => {
  const webEntry = await readFile(new URL("../src/web/main.js", import.meta.url), "utf8");
  const nativeEntry = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(webEntry, /createConversationStore\(\{\s*historyMode:\s*"current-step"\s*\}\)/);
  assert.match(nativeEntry, /createConversationStore\(\)/);
});
