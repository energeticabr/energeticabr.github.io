import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import portalConfig from "../portal/config.js";
import { isSuperAdmin } from "../portal/access/access-model.js";
import { createRouter, PORTAL_ROUTES } from "../portal/core/router.js";
import { entityGalleryMarkup } from "../portal/ui/entity-page.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const adminHtml = read("admin.html");
const appJs = read("portal/app.js");
const authJs = read("portal/auth/microsoft-auth.js");
const entityPageJs = read("portal/ui/entity-page.js");
const itemDetailJs = read("portal/ui/item-detail.js");
const accessPageJs = read("portal/ui/access-page.js");
const readme = read("README.md");
const portalSources = fs.readdirSync(path.join(root, "portal"), { recursive: true })
  .filter(relativePath => /\.(?:html|js|css)$/i.test(relativePath) && !/^vendor[\\/]/i.test(relativePath))
  .map(relativePath => read(path.join("portal", relativePath)))
  .join("\n");

test("o admin oferece somente login Microsoft e nenhuma credencial local", () => {
  assert.equal((adminHtml.match(/data-microsoft-login-action/g) || []).length, 1);
  assert.match(adminHtml, /portal\/vendor\/msal-browser-5\.19\.0\.min\.js/);
  assert.doesNotMatch(adminHtml, /<script[^>]+src=["']https?:\/\//i);
  assert.doesNotMatch(adminHtml, /<input[^>]+type=["']password/i);
  assert.doesNotMatch(adminHtml, /supabase/i);
  assert.doesNotMatch(portalSources, /(?:service[_-]?role|sb_secret_|SUPABASE_(?:KEY|URL))/i);
});

test("o MSAL local tem versao exata e acompanha a licenca oficial", () => {
  const vendorFiles = [
    "portal/vendor/msal-browser-5.19.0.min.js",
    "portal/vendor/msal-browser-5.19.0.LICENSE.txt",
    "portal/vendor/msal-browser-5.19.0.VERSION.txt",
  ];
  for (const file of vendorFiles) assert.equal(fs.existsSync(path.join(root, file)), true, `${file} deve existir`);
  assert.match(read(vendorFiles[0]), /@azure\/msal-browser v5\.19\.0/);
  assert.match(read(vendorFiles[1]), /MIT License/);
  assert.match(read(vendorFiles[2]), /@azure\/msal-browser\s+5\.19\.0/);
});

test("a pagina aplica CSP restritiva compativel com Microsoft e SharePoint", () => {
  const csp = adminHtml.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]+)"/i)?.[1] || "";
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com https://energeticaltda.sharepoint.com https://energeticaltda-my.sharepoint.com",
    "frame-src https://login.microsoftonline.com",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ]) assert.match(csp, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(csp, /unsafe-(?:inline|eval)/);
});

test("o portal nao depende de estilos inline sob a CSP", () => {
  assert.doesNotMatch(adminHtml, /\sstyle\s*=/i);
  assert.doesNotMatch(accessPageJs, /\sstyle\s*=/i);
});

test("somente o cache temporario gerenciado pelo MSAL usa a sessao", () => {
  assert.match(authJs, /cacheLocation\s*:\s*["']sessionStorage["']/);
  assert.doesNotMatch(portalSources, /(?:localStorage|sessionStorage|indexedDB)\s*\.(?:setItem|put|add)\s*\(/);
  assert.match(readme, /cache tempor[aá]rio gerenciado pelo MSAL/i);
  assert.match(readme, /fechar a aba|aba for fechada/i);
  assert.match(readme, /logout|sair/i);
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

test("acoes e formularios revalidam permissao antes de aparecer ou gravar", () => {
  const entity = { id: "clientes", title: "Clientes", searchFields: ["Title"], statusFields: [] };
  const data = {
    columns: [{ name: "Title", label: "Nome", control: "text", hidden: false, editable: true }],
    rawItems: [{ id: "1", fields: { Title: "ANA" } }],
    items: { items: [{ id: "1", fields: { Title: "ANA" } }], page: 1, pageSize: 20, batchCount: 1, loadedCount: 1, rangeStart: 1, rangeEnd: 1, hasMore: false },
    query: { limitations: [], notices: [] },
  };
  const state = { search: "", page: 1, pageSize: 20, filters: {}, sort: { field: "Title", direction: "asc" }, message: "", error: "" };
  const denied = entityGalleryMarkup(entity, data, state, { create: false, edit: false, approve: false });
  const allowed = entityGalleryMarkup(entity, data, state, { create: true, edit: true, approve: false });

  assert.doesNotMatch(denied, /data-entity-form/);
  assert.doesNotMatch(denied, /data-entity-edit/);
  assert.doesNotMatch(denied, /access-grid/);
  assert.doesNotMatch(allowed, /data-entity-form/);
  assert.match(allowed, /data-entity-create/);
  assert.match(allowed, /data-entity-edit="1"/);
  assert.match(entityPageJs, /!entityActions\(\)\.create/);
  assert.match(entityPageJs, /!entityActions\(\)\.edit/);
  assert.match(itemDetailJs, /if\s*\(!actions\(\)\.edit\s*\|\|/);
  assert.match(itemDetailJs, /if\s*\(!actions\(\)\.delete\s*\|\|/);
});
