import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import portalConfig from "../portal/config.js";
import { isSuperAdmin } from "../portal/access/access-model.js";
import { createRouter, PORTAL_ROUTES } from "../portal/core/router.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const adminHtml = read("admin.html");
const appJs = read("portal/app.js");
const authJs = read("portal/auth/microsoft-auth.js");
const entityPageJs = read("portal/ui/entity-page.js");
const itemDetailJs = read("portal/ui/item-detail.js");
const portalSources = fs.readdirSync(path.join(root, "portal"), { recursive: true })
  .filter(relativePath => /\.(?:html|js|css)$/i.test(relativePath))
  .map(relativePath => read(path.join("portal", relativePath)))
  .join("\n");

test("o admin oferece somente login Microsoft e nenhuma credencial local", () => {
  assert.equal((adminHtml.match(/data-microsoft-login-action/g) || []).length, 1);
  assert.match(adminHtml, /@azure\/msal-browser/);
  assert.doesNotMatch(adminHtml, /<input[^>]+type=["']password/i);
  assert.doesNotMatch(adminHtml, /supabase/i);
  assert.doesNotMatch(portalSources, /(?:service[_-]?role|sb_secret_|SUPABASE_(?:KEY|URL))/i);
});

test("tokens delegados permanecem em memoria e nao ha armazenamento operacional no portal", () => {
  assert.match(authJs, /cacheLocation\s*:\s*["']memoryStorage["']/);
  assert.doesNotMatch(portalSources, /(?:localStorage|sessionStorage|indexedDB)\s*\.(?:setItem|put|add)\s*\(/);
});

test("o superadministrador configurado e normalizado e o acesso e negado por padrao", () => {
  assert.equal(portalConfig.superAdminEmail, "bernardonotini@energeticabr.com");
  assert.equal(isSuperAdmin(" BERNARDONOTINI@ENERGETICABR.COM ", portalConfig.superAdminEmail), true);
  assert.equal(isSuperAdmin("outro@energeticabr.com", portalConfig.superAdminEmail), false);
});

test("rotas administrativas negadas retornam ao painel antes de renderizar", () => {
  const denied = new Set(["module", "entity", "item", "access"]);
  const router = createRouter(PORTAL_ROUTES, {
    window: { location: { hash: "" }, addEventListener() {}, removeEventListener() {} },
    canRoute: route => !denied.has(route.name),
  });

  for (const hash of [
    "#/module/suprimentos",
    "#/entity/fornecedores",
    "#/entity/fornecedores/item/1",
    "#/access",
  ]) {
    const route = router.parse(hash);
    assert.equal(route.name, "dashboard");
    assert.equal(route.denied, true);
  }

  assert.match(appJs, /canRoute:\s*route\s*=>\s*isRouteAllowed\(route, session\)/);
});

test("acoes e formularios revalidam permissao e ficam fechados por padrao", () => {
  assert.match(entityPageJs, /formOpen:\s*false/);
  assert.match(entityPageJs, /if\s*\(!entityActions\(\)\.create\s*\|\|/);
  assert.match(itemDetailJs, /if\s*\(!actions\(\)\.edit\s*\|\|/);
  assert.match(itemDetailJs, /if\s*\(!actions\(\)\.delete\s*\|\|/);
});
