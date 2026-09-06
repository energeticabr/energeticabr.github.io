import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MODULES } from "../portal/catalog/modules.js";
import { PORTAL_ROUTES, createRouter } from "../portal/core/router.js";

function browser(hash = "") {
  return {
    location: { hash },
    addEventListener() {},
    removeEventListener() {},
  };
}

test("o portal elimina o painel inicial e abre diretamente Detalhamento/Auditoria", async () => {
  assert.equal(MODULES.some(module => module.id === "dashboard"), false);
  assert.equal(PORTAL_ROUTES.some(route => route.name === "dashboard"), false);

  const emptyRoute = createRouter(PORTAL_ROUTES, { window: browser() }).parse();
  assert.deepEqual(emptyRoute, { name: "audit", params: {}, hash: "#/audit" });

  const legacyRoute = createRouter(PORTAL_ROUTES, { window: browser("#/dashboard") }).parse();
  assert.deepEqual(legacyRoute, { name: "audit", params: {}, hash: "#/audit", fallback: true });

  const [app, manifest] = await Promise.all([
    readFile(new URL("../portal/app.js", import.meta.url), "utf8"),
    readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.doesNotMatch(app, /powerapps-home-page\.js|route\.name === ["']dashboard["']/);
  assert.equal(manifest.start_url, "/admin.html#/audit");

  assert.equal(existsSync(new URL("../portal/ui/powerapps-home-page.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../portal/ui/dashboard-page.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../portal/catalog/powerapps-home-contract.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../portal/analytics/home-report-views.js", import.meta.url)), false);
  assert.equal(existsSync(new URL("../portal/assets/powerapps-home", import.meta.url)), false);
});
