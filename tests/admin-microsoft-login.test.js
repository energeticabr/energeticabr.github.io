const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "portal/app.js"), "utf8");
const configJs = fs.readFileSync(path.join(root, "portal/config.js"), "utf8");
const authJs = fs.readFileSync(path.join(root, "portal/auth/microsoft-auth.js"), "utf8");
const bootstrapAccess = fs.readFileSync(path.join(root, "portal/core/bootstrap-access.js"), "utf8");

assert(
  adminHtml.includes('src="portal/vendor/msal-browser-5.19.0.min.js"')
    && !/<script[^>]+src=["']https?:\/\//i.test(adminHtml),
  "admin.html deve carregar somente a versao local exata do MSAL"
);

assert(
  adminHtml.includes("data-microsoft-login-action"),
  "admin.html deve ter o botão Entrar com Microsoft"
);

assert(
  /type="module" src="portal\/config\.js(?:\?[^\"]+)?"/.test(adminHtml)
    && /type="module" src="portal\/app\.js(?:\?[^\"]+)?"/.test(adminHtml),
  "admin.html deve carregar a configuração e o app como módulos"
);

assert(
  adminHtml.includes("assets/logo-energetica-oficial.png")
    && adminHtml.includes("assets/mascote-energetica-transparente.png"),
  "admin.html deve usar a identidade visual oficial"
);

assert(!/<input[^>]+type=["']password/i.test(adminHtml), "admin.html nao deve conter campos de senha");
assert(!/supabase/i.test(adminHtml), "admin.html nao deve carregar ou mencionar Supabase");

assert(
  appJs.includes("handleMicrosoftLogin")
    && appJs.includes("createMicrosoftAuth")
    && appJs.includes("createAccessRepository")
    && appJs.includes("getCurrentAccess")
    && appJs.includes('getToken(["Sites.Read.All"])')
    && appJs.includes("showUnauthorized")
    && authJs.includes("PublicClientApplication"),
  "portal/app.js deve inicializar e acionar o login Microsoft"
);

assert(
  appJs.includes("createEntityPage")
    && appJs.includes("createItemDetailPage")
    && !appJs.includes("renderEntityPlaceholder"),
  "portal/app.js deve ligar as rotas de entidade e detalhe as paginas genericas"
);

assert(
  bootstrapAccess.includes("portalConfig.superAdminEmail")
    && !bootstrapAccess.includes("bernardonotini@energeticabr.com"),
  "o bootstrap deve delegar o superadministrador somente para a configuracao"
);

assert(
  configJs.includes('scopes: Object.freeze(["openid", "profile", "email", "User.Read", "Sites.Read.All"])'),
  "o bootstrap deve solicitar a leitura necessária para as listas SharePoint"
);
assert(!configJs.includes("Sites.ReadWrite.All"), "o bootstrap nao deve solicitar escopos SharePoint amplos");
assert(
  authJs.includes('cacheLocation: "sessionStorage"')
    && authJs.includes("storeAuthStateInCookie: false"),
  "o redirect Microsoft deve usar o cache temporario de sessao do MSAL e ficar fora de cookies"
);

for (const value of [
  "0c10f511-7ede-4702-a2d9-bedb26937e0e",
  "94018e25-f756-4aa6-974e-27b8b43d7fe9",
  "bernardonotini@energeticabr.com",
  "energeticaltda-my.sharepoint.com",
  "/personal/bernardonotini_energeticabr_com",
  "energeticaltda.sharepoint.com",
  "/sites/energetica",
]) {
  assert(configJs.includes(value), `portal/config.js deve conter ${value}`);
}

console.log("admin Microsoft login markup/config OK");
