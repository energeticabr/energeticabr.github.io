import test from "node:test";
import assert from "node:assert/strict";

import { createBrowserAuth } from "../src/web/browser-auth.js";

const config = Object.freeze({
  tenantId: "tenant-id",
  clientId: "client-id",
  scopes: ["openid", "profile", "User.Read"],
  webRedirectUri: "https://www.energeticabr.com/energetico/",
});

test("restaura a conta do retorno Microsoft e obtém token silenciosamente", async () => {
  const calls = [];
  const account = {
    homeAccountId: "account-1",
    localAccountId: "local-1",
    tenantId: "tenant-id",
    environment: "login.windows.net",
    username: "pessoa@energeticabr.com",
    name: "Pessoa",
  };
  const client = {
    async initialize() { calls.push(["initialize"]); },
    async handleRedirectPromise() { calls.push(["redirect"]); return { account }; },
    getAllAccounts() { throw new Error("não deve consultar o cache após retorno válido"); },
    async acquireTokenSilent(request) {
      calls.push(["token", request]);
      return { accessToken: "segredo" };
    },
  };

  const auth = createBrowserAuth({ client, config });

  assert.deepEqual(await auth.initialize(), {
    homeAccountId: "account-1",
    username: "pessoa@energeticabr.com",
    name: "Pessoa",
  });
  assert.equal(await auth.getToken(["User.Read"]), "segredo");
  assert.deepEqual(calls, [
    ["initialize"],
    ["redirect"],
    ["token", { account, scopes: ["User.Read"] }],
  ]);
  assert.doesNotMatch(JSON.stringify(auth), /segredo/);
});

test("saída entrega ao MSAL a conta completa preservada internamente", async () => {
  const account = {
    homeAccountId: "account-1",
    localAccountId: "local-1",
    tenantId: "tenant-id",
    environment: "login.windows.net",
    username: "pessoa@energeticabr.com",
    name: "Pessoa",
  };
  const calls = [];
  const client = {
    async initialize() {},
    async handleRedirectPromise() { return { account }; },
    getAllAccounts() { return []; },
    async logoutRedirect(request) { calls.push(request); },
  };
  const auth = createBrowserAuth({ client, config });
  await auth.initialize();

  await auth.signOut();

  assert.deepEqual(calls, [{
    account,
    postLogoutRedirectUri: "https://www.energeticabr.com/energetico/",
  }]);
  assert.equal(auth.getAccount(), null);
});

test("inicia login por redirecionamento na URL exclusiva da PWA", async () => {
  const calls = [];
  const client = {
    async initialize() {},
    async handleRedirectPromise() { return null; },
    getAllAccounts() { return []; },
    async loginRedirect(request) { calls.push(request); },
  };
  const auth = createBrowserAuth({ client, config });
  await auth.initialize();

  await auth.signIn();

  assert.deepEqual(calls, [{
    scopes: ["openid", "profile", "User.Read"],
    redirectUri: "https://www.energeticabr.com/energetico/",
  }]);
});

test("falha fechada quando token silencioso exige interação", async () => {
  const account = { homeAccountId: "account-1", username: "pessoa@energeticabr.com" };
  const client = {
    async initialize() {},
    async handleRedirectPromise() { return null; },
    getAllAccounts() { return [account]; },
    async acquireTokenSilent() { throw { errorCode: "interaction_required", message: "segredo interno" }; },
  };
  const auth = createBrowserAuth({ client, config });
  await auth.initialize();

  await assert.rejects(auth.getToken(["User.Read"]), error => {
    assert.equal(error.code, "AUTH_REQUIRED");
    assert.equal(error.message, "Entre novamente com a Microsoft.");
    assert.doesNotMatch(error.message, /segredo/);
    return true;
  });
});
