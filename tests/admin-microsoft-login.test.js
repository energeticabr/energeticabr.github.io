const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const configJs = fs.readFileSync(path.join(root, "supabase-config.js"), "utf8");

assert(
  adminHtml.includes("@azure/msal-browser") || adminHtml.includes("msal-browser"),
  "admin.html deve carregar a biblioteca MSAL da Microsoft"
);

assert(
  adminHtml.includes('id="microsoftLoginBtn"'),
  "admin.html deve ter o botão Entrar com Microsoft"
);

assert(
  adminHtml.includes("handleMicrosoftLogin") && adminHtml.includes("PublicClientApplication"),
  "admin.html deve inicializar e acionar o login Microsoft"
);

assert(
  configJs.includes("ENERGETICA_MICROSOFT_AUTH"),
  "supabase-config.js deve expor a configuração pública do login Microsoft"
);

console.log("admin Microsoft login markup/config OK");
