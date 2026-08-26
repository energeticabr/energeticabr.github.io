const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "portal/app.js"), "utf8");
const configJs = fs.readFileSync(path.join(root, "portal/config.js"), "utf8");
const authJs = fs.readFileSync(path.join(root, "portal/auth/microsoft-auth.js"), "utf8");

assert(
  adminHtml.includes("@azure/msal-browser") || adminHtml.includes("msal-browser"),
  "admin.html deve carregar a biblioteca MSAL da Microsoft"
);

assert(
  adminHtml.includes("data-microsoft-login-action"),
  "admin.html deve ter o botão Entrar com Microsoft"
);

assert(
  adminHtml.includes('type="module" src="portal/config.js"')
    && adminHtml.includes('type="module" src="portal/app.js"'),
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
    && appJs.includes("isBootstrapAuthorized")
    && appJs.includes("showUnauthorized")
    && authJs.includes("PublicClientApplication"),
  "portal/app.js deve inicializar e acionar o login Microsoft"
);

assert(
  configJs.includes('scopes: Object.freeze(["openid", "profile", "email", "User.Read"])'),
  "o bootstrap deve solicitar somente os escopos iniciais"
);
assert(!configJs.includes("Sites.ReadWrite.All"), "o bootstrap nao deve solicitar escopos SharePoint amplos");

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
