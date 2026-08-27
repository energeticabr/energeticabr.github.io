import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createMicrosoftAuth } from "../portal/auth/microsoft-auth.js";

test("redirect Microsoft usa apenas destinos exatos da allowlist", async () => {
  const { MICROSOFT_REDIRECT_URIS, resolveMicrosoftRedirectUri } = await import("../portal/config.js");

  assert.equal(resolveMicrosoftRedirectUri({ href: "https://www.energeticabr.com/admin.html?retorno=1#/access" }), "https://www.energeticabr.com/admin.html");
  assert.equal(resolveMicrosoftRedirectUri({ href: "https://energeticabr.github.io/admin.html#/dashboard" }), "https://energeticabr.github.io/admin.html");
  assert.equal(resolveMicrosoftRedirectUri({ href: "http://localhost:4173/admin.html#/dashboard" }), "http://localhost:4173/admin.html");
  assert.equal(resolveMicrosoftRedirectUri({ href: "http://127.0.0.1:4173/admin.html" }), "http://127.0.0.1:4173/admin.html");
  assert.equal(resolveMicrosoftRedirectUri({ href: "https://invasor.example/admin.html" }), MICROSOFT_REDIRECT_URIS.production);
  assert.equal(resolveMicrosoftRedirectUri({ href: "http://localhost:9999/admin.html" }), MICROSOFT_REDIRECT_URIS.production);
  assert.equal(resolveMicrosoftRedirectUri({ href: "http://localhost:4173/outra-pagina.html" }), MICROSOFT_REDIRECT_URIS.production);
  assert.ok(Object.isFrozen(MICROSOFT_REDIRECT_URIS));
});
import { renderLoginView } from "../portal/ui/login-view.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const adminCss = fs.readFileSync(path.join(root, "portal/styles/admin.css"), "utf8");
const initialScopes = ["openid", "profile", "email", "User.Read"];

function createFakeLoginRoot() {
  const listeners = new Map();
  const nodes = new Map();
  const makeNode = () => ({
    dataset: {},
    disabled: false,
    hidden: false,
    textContent: "",
    addEventListener(event, handler) {
      listeners.set(this, handler);
    },
    querySelector() {
      return makeNode();
    },
  });
  const selectors = [
    "[data-microsoft-login-action]",
    "[data-switch-account-action]",
    "[data-login-actions]",
    "[data-login-loading]",
    "[data-login-status]",
    "[data-login-session]",
    "[data-login-unauthorized]",
  ];
  for (const selector of selectors) nodes.set(selector, makeNode());

  return {
    dataset: {},
    innerHTML: "",
    setAttribute() {},
    querySelector(selector) {
      return nodes.get(selector);
    },
    node(selector) {
      return nodes.get(selector);
    },
    async click(selector) {
      await listeners.get(nodes.get(selector))?.();
    },
  };
}

function relativeLuminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map(value => Number.parseInt(value, 16) / 255);
  const linear = channels.map(value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test("a pagina administrativa oferece somente uma acao de login Microsoft institucional", () => {
  assert.match(adminHtml, /data-login-root/);
  assert.equal((adminHtml.match(/data-microsoft-login-action/g) || []).length, 1);
  assert.equal((adminHtml.match(/type=["']password["']/gi) || []).length, 0);
  assert.match(adminHtml, /assets\/logo-energetica-oficial\.png/);
  assert.match(adminHtml, /assets\/mascote-energetica-transparente\.png/);
  assert.match(adminHtml, /<link\s+rel="icon"\s+href="assets\/logo-energetica-oficial\.png"/i);
});

test("o kicker do painel de login tem contraste minimo AA", () => {
  const match = adminCss.match(/\.portal-kicker\s*\{[^}]*color:\s*(#[a-f\d]{6})/i);
  assert.ok(match, "o estilo do kicker deve declarar uma cor hexadecimal");
  assert.ok(contrastRatio(match[1], "#edf2f3") >= 4.5, "o kicker deve ter contraste minimo de 4,5:1");
});

test("o texto institucional e o mascote ocupam colunas separadas", () => {
  const root = createFakeLoginRoot();
  renderLoginView(root);
  assert.match(root.innerHTML, /class="portal-identity-bottom"/);
  assert.match(adminCss, /\.portal-identity-bottom\s*\{[^}]*display:\s*grid/i);
  assert.match(adminCss, /\.portal-identity-bottom\s*\{[^}]*grid-template-columns:/i);
  assert.doesNotMatch(adminCss, /\.portal-mascot\s*\{[^}]*position:\s*absolute/i);
});

test("a logo oficial azul fica sobre uma placa clara e discreta", () => {
  const root = createFakeLoginRoot();
  renderLoginView(root);
  assert.match(root.innerHTML, /class="portal-logo-plate"/);
  const plate = adminCss.match(/\.portal-logo-plate\s*\{([^}]*)\}/i)?.[1] || "";
  assert.match(plate, /background:\s*#fff(?:fff)?/i);
  assert.match(plate, /padding:/i);
  const radius = Number.parseFloat(plate.match(/border-radius:\s*([\d.]+)px/i)?.[1]);
  assert.ok(Number.isFinite(radius) && radius <= 8, "a placa da logo deve ter raio de no maximo 8px");
});

test("a placa clara acompanha a largura visual da logo sem faixa vazia", () => {
  const logo = adminCss.match(/\.portal-logo\s*\{([^}]*)\}/i)?.[1] || "";
  assert.match(logo, /width:\s*214px/i);
  assert.match(logo, /max-width:\s*100%/i);
});

test("a faixa dourada mobile fica abaixo do texto institucional", () => {
  assert.match(adminCss, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.portal-identity::before\s*\{[^}]*bottom:\s*16px/i);
});

test("o redirecionamento Microsoft sobrevive a recriacao do adaptador na mesma aba", async () => {
  const account = { username: "bernardonotini@energeticabr.com" };

  class PublicClientApplication {
    static pendingRedirect = false;

    constructor(configuration) {
      this.configuration = configuration;
    }

    async loginRedirect() {
      PublicClientApplication.pendingRedirect = this.configuration.cache.cacheLocation === "sessionStorage";
    }

    async handleRedirectPromise() {
      if (!PublicClientApplication.pendingRedirect) return null;
      PublicClientApplication.pendingRedirect = false;
      return { account };
    }

    setActiveAccount(value) {
      this.account = value;
    }
  }

  const config = {
    clientId: "public-client-id",
    authority: "https://login.microsoftonline.com/tenant-id",
    redirectUri: "https://www.energeticabr.com/admin.html",
    scopes: initialScopes,
  };
  await createMicrosoftAuth(config, { PublicClientApplication }).signIn();
  const returnedAuth = createMicrosoftAuth(config, { PublicClientApplication });
  assert.deepEqual(await returnedAuth.initialize(), account);
});

test("o adaptador Microsoft recupera a sessao e pede somente os escopos iniciais", async () => {
  const account = { username: "bernardonotini@energeticabr.com" };
  const calls = [];

  class PublicClientApplication {
    async initialize() {
      calls.push("initialize");
    }

    async handleRedirectPromise() {
      calls.push("handleRedirectPromise");
      return { account };
    }

    setActiveAccount(value) {
      calls.push(["setActiveAccount", value]);
    }
  }

  const auth = createMicrosoftAuth({
    clientId: "public-client-id",
    authority: "https://login.microsoftonline.com/tenant-id",
    redirectUri: "https://www.energeticabr.com/admin.html",
    scopes: initialScopes,
  }, { PublicClientApplication });

  assert.deepEqual(await auth.initialize(), account);
  assert.deepEqual(auth.getAccount(), account);
  assert.deepEqual(calls, [
    "initialize",
    "handleRedirectPromise",
    ["setActiveAccount", account],
  ]);
});

test("o adaptador Microsoft limpa uma conta recusada pelo bootstrap", async () => {
  const account = { username: "outro@energeticabr.com" };
  const activeAccounts = [];

  class PublicClientApplication {
    async handleRedirectPromise() {
      return { account };
    }

    setActiveAccount(value) {
      activeAccounts.push(value);
    }
  }

  const auth = createMicrosoftAuth({
    clientId: "public-client-id",
    authority: "https://login.microsoftonline.com/tenant-id",
    redirectUri: "https://www.energeticabr.com/admin.html",
    scopes: initialScopes,
  }, { PublicClientApplication });

  await auth.initialize();
  auth.clearAccount();
  assert.equal(auth.getAccount(), null);
  assert.deepEqual(activeAccounts, [account, null]);
});

test("o adaptador Microsoft abre o seletor de contas apos negar o bootstrap", async () => {
  const account = { username: "outro@energeticabr.com" };
  const activeAccounts = [];
  const redirects = [];

  class PublicClientApplication {
    async handleRedirectPromise() {
      return { account };
    }

    setActiveAccount(value) {
      activeAccounts.push(value);
    }

    async loginRedirect(request) {
      redirects.push(request);
    }
  }

  const auth = createMicrosoftAuth({
    clientId: "public-client-id",
    authority: "https://login.microsoftonline.com/tenant-id",
    redirectUri: "https://www.energeticabr.com/admin.html",
    scopes: initialScopes,
  }, { PublicClientApplication });

  await auth.initialize();
  await auth.switchAccount();
  assert.equal(auth.getAccount(), null);
  assert.deepEqual(activeAccounts, [account, null]);
  assert.deepEqual(redirects, [{ scopes: initialScopes, prompt: "select_account" }]);
});

test("a tela de acesso negado oferece troca de conta", async () => {
  const root = createFakeLoginRoot();
  let switchCount = 0;
  const view = renderLoginView(root, {
    async onSwitchAccount() {
      switchCount += 1;
    },
  });

  view.showUnauthorized({ username: "outro@energeticabr.com" });
  assert.match(root.innerHTML, /data-switch-account-action/);
  assert.equal(root.node("[data-login-unauthorized]").hidden, false);
  await root.click("[data-switch-account-action]");
  assert.equal(switchCount, 1);
});

test("o adaptador Microsoft inicia o login com os escopos iniciais", async () => {
  const calls = [];

  class PublicClientApplication {
    async loginRedirect(request) {
      calls.push(request);
    }
  }

  const auth = createMicrosoftAuth({
    clientId: "public-client-id",
    authority: "https://login.microsoftonline.com/tenant-id",
    redirectUri: "https://www.energeticabr.com/admin.html",
    scopes: initialScopes,
  }, { PublicClientApplication });

  await auth.signIn();
  assert.deepEqual(calls, [{ scopes: initialScopes }]);
});

test("o adaptador Microsoft usa redirect somente quando o token silencioso exige interacao", async () => {
  const account = { username: "bernardonotini@energeticabr.com" };
  const calls = [];

  class PublicClientApplication {
    async initialize() {}

    async handleRedirectPromise() {
      return { account };
    }

    setActiveAccount() {}

    async acquireTokenSilent(request) {
      calls.push(["silent", request]);
      const error = new Error("interaction_required");
      error.errorCode = "interaction_required";
      throw error;
    }

    async acquireTokenRedirect(request) {
      calls.push(["redirect", request]);
    }
  }

  const auth = createMicrosoftAuth({
    clientId: "public-client-id",
    authority: "https://login.microsoftonline.com/tenant-id",
    redirectUri: "https://www.energeticabr.com/admin.html",
    scopes: initialScopes,
  }, { PublicClientApplication });

  await auth.initialize();
  assert.equal(await auth.getToken(["User.Read"]), undefined);
  assert.deepEqual(calls, [
    ["silent", { account, scopes: ["User.Read"] }],
    ["redirect", { account, scopes: ["User.Read"] }],
  ]);
});

test("o adaptador Microsoft nao redireciona quando a falha silenciosa nao exige interacao", async () => {
  const account = { username: "bernardonotini@energeticabr.com" };
  let redirected = false;

  class PublicClientApplication {
    async handleRedirectPromise() {
      return { account };
    }

    setActiveAccount() {}

    async acquireTokenSilent() {
      const error = new Error("network_error");
      error.errorCode = "network_error";
      throw error;
    }

    async acquireTokenRedirect() {
      redirected = true;
    }
  }

  const auth = createMicrosoftAuth({
    clientId: "public-client-id",
    authority: "https://login.microsoftonline.com/tenant-id",
    redirectUri: "https://www.energeticabr.com/admin.html",
    scopes: initialScopes,
  }, { PublicClientApplication });

  await auth.initialize();
  await assert.rejects(auth.getToken(["User.Read"]), /network_error/);
  assert.equal(redirected, false);
});
