import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createMicrosoftAuth } from "../portal/auth/microsoft-auth.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminHtml = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const initialScopes = ["openid", "profile", "email", "User.Read"];

test("a pagina administrativa oferece somente uma acao de login Microsoft institucional", () => {
  assert.match(adminHtml, /data-login-root/);
  assert.equal((adminHtml.match(/data-microsoft-login-action/g) || []).length, 1);
  assert.equal((adminHtml.match(/type=["']password["']/gi) || []).length, 0);
  assert.match(adminHtml, /assets\/logo-energetica-oficial\.png/);
  assert.match(adminHtml, /assets\/mascote-energetica-transparente\.png/);
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
