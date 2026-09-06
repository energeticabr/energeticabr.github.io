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
  assert.match(admin, /portal\/app\.js\?v=20260906-create-entry-parity-v1/);
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
  assert.match(worker, /energetica-portal-shell-["`]?v8/);
  assert.match(worker, /async function staticResponse[\s\S]*?try\s*\{[\s\S]*?await fetch\(request\)[\s\S]*?catch/);
  assert.doesNotMatch(worker, /staticResponse[\s\S]*?caches\.match\(request,\s*\{\s*ignoreSearch/);
});

test("a publicação invalida toda a cadeia de catálogo e formulários", async () => {
  const [app, accessRepository, entityPage, itemDetail, uiContract, homePage] = await Promise.all([
    readFile(new URL("../portal/app.js", import.meta.url), "utf8"),
    readFile(new URL("../portal/access/access-repository.js", import.meta.url), "utf8"),
    readFile(new URL("../portal/ui/entity-page.js", import.meta.url), "utf8"),
    readFile(new URL("../portal/ui/item-detail.js", import.meta.url), "utf8"),
    readFile(new URL("../portal/catalog/powerapps-ui-contract.js", import.meta.url), "utf8"),
    readFile(new URL("../portal/ui/powerapps-home-page.js", import.meta.url), "utf8"),
  ]);

  assert.match(app, /access-repository\.js\?v=20260906-create-entry-parity-v1/);
  assert.match(app, /item-detail\.js\?v=20260906-create-entry-parity-v1/);
  assert.match(app, /entity-page\.js\?v=20260906-create-entry-parity-v1/);
  assert.match(app, /powerapps-home-page\.js\?v=20260906-create-entry-parity-v1/);
  assert.match(accessRepository, /entities\.js\?v=20260906-create-entry-parity-v1/);
  assert.match(entityPage, /powerapps-ui-contract\.js\?v=20260906-create-entry-parity-v1/);
  assert.match(itemDetail, /powerapps-ui-contract\.js\?v=20260906-create-entry-parity-v1/);
  assert.match(uiContract, /powerapps-form-controls\.generated\.js\?v=20260906-create-entry-parity-v1/);
  assert.match(homePage, /entity-page\.js\?v=20260906-create-entry-parity-v1/);
});

test("a publicação do Pages inclui o manifesto, o service worker e os ícones", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");

  assert.match(workflow, /manifest\.webmanifest/);
  assert.match(workflow, /portal-service-worker\.js/);
  assert.match(workflow, /assets\/icons/);
});
