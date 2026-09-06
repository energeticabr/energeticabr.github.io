import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("o portal publica um aplicativo instalável com ícones para iPhone", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
  const admin = await readFile(new URL("../admin.html", import.meta.url), "utf8");

  assert.equal(manifest.name, "Energética Administrativo");
  assert.equal(manifest.short_name, "Energética");
  assert.equal(manifest.start_url, "/admin.html");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some(icon => icon.sizes === "192x192" && icon.type === "image/png"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "512x512" && /maskable/.test(icon.purpose || "")));
  assert.match(admin, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(admin, /rel="apple-touch-icon"[^>]*portal-192\.png/);
  assert.match(admin, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(admin, /data-pwa-install/);
  assert.match(admin, /data-pwa-ios-help/);
  assert.match(admin, /portal\/pwa-register\.js/);
});

test("o service worker não coloca autenticação, APIs nem SharePoint no cache", async () => {
  const worker = await readFile(new URL("../portal-service-worker.js", import.meta.url), "utf8");

  assert.match(worker, /\/api\//);
  assert.match(worker, /request\.method\s*!==\s*["']GET["']/);
  assert.match(worker, /url\.origin\s*!==\s*self\.location\.origin/);
  assert.match(worker, /fetch\(request\)/);
  assert.doesNotMatch(worker, /graph\.microsoft\.com/);
  assert.doesNotMatch(worker, /sharepoint\.com/);
  assert.match(worker, /caches\.delete/);
  assert.match(worker, /energetica-portal-shell-["`]?v3/);
  assert.match(worker, /async function staticResponse[\s\S]*?try\s*\{[\s\S]*?await fetch\(request\)[\s\S]*?catch/);
  assert.doesNotMatch(worker, /staticResponse[\s\S]*?caches\.match\(request,\s*\{\s*ignoreSearch/);
});

test("a publicação do Pages inclui o manifesto, o service worker e os ícones", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");

  assert.match(workflow, /manifest\.webmanifest/);
  assert.match(workflow, /portal-service-worker\.js/);
  assert.match(workflow, /assets\/icons/);
});
