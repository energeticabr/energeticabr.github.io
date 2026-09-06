import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const projectUrl = new URL("../", import.meta.url);

test("declara um aplicativo local e não uma URL remota", async () => {
  const config = JSON.parse(await readFile(new URL("capacitor.config.json", projectUrl), "utf8"));

  assert.equal(config.appId, "br.com.energetica.energetico");
  assert.equal(config.appName, "Energético");
  assert.equal(config.webDir, "dist");
  assert.equal(config.server?.url, undefined);
  assert.equal(config.server?.hostname, "localhost");
  assert.equal(config.server?.iosScheme, "capacitor");
});

test("mantém a interface do chatbot dentro do pacote", async () => {
  const html = await readFile(new URL("index.html", projectUrl), "utf8");

  assert.match(html, /id="app"/);
  assert.match(html, /src="\/src\/main\.js"/);
  assert.doesNotMatch(html, /admin\.html/);
});

test("fixa o compartilhamento nativo compatível com o Capacitor 8", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", projectUrl), "utf8"));

  assert.equal(packageJson.dependencies["@capacitor/share"], "8.0.1");
});
