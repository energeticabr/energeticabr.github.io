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

test("trata consent_required como necessidade de autorização interativa do SharePoint", async () => {
  const account = { homeAccountId: "account-1", username: "pessoa@energeticabr.com" };
  const client = {
    async initialize() {},
    async handleRedirectPromise() { return null; },
    getAllAccounts() { return [account]; },
    async acquireTokenSilent() { throw { errorCode: "consent_required" }; },
  };
  const auth = createBrowserAuth({ client, config });
  await auth.initialize();

  await assert.rejects(auth.getToken(["https://energeticaltda-my.sharepoint.com/AllSites.Read"]), error => {
    assert.equal(error.code, "AUTH_REQUIRED");
    return true;
  });
});

test("autoriza interativamente o escopo solicitado e mantém a conta selecionada", async () => {
  const account = { homeAccountId: "account-1", username: "pessoa@energeticabr.com" };
  const calls = [];
  const client = {
    async initialize() {},
    async handleRedirectPromise() { return null; },
    getAllAccounts() { return [account]; },
    async acquireTokenRedirect(request) { calls.push(request); },
  };
  const auth = createBrowserAuth({ client, config });
  await auth.initialize();

  await auth.authorize(["https://energeticaltda-my.sharepoint.com/AllSites.Read"]);

  assert.deepEqual(calls, [{ account, scopes: ["https://energeticaltda-my.sharepoint.com/AllSites.Read"], redirectUri: config.webRedirectUri }]);
  assert.equal(auth.getAccount().username, "pessoa@energeticabr.com");
});

test("retoma a abertura da Galeria Pedidos após consentimento Microsoft por redirecionamento", async () => {
  const account = { homeAccountId: "account-1", username: "pessoa@energeticabr.com" };
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const firstClient = {
    async initialize() {},
    async handleRedirectPromise() { return null; },
    getAllAccounts() { return [account]; },
    async acquireTokenRedirect() {},
  };
  const scopes = ["Sites.Read.All"];
  const firstAuth = createBrowserAuth({ client: firstClient, config, storage });
  await firstAuth.initialize();
  await firstAuth.authorize(scopes, { resumeAction: "action_orders_gallery" });

  const resumedClient = {
    async initialize() {},
    async handleRedirectPromise() { return { account, accessToken: "gallery-token", scopes }; },
    getAllAccounts() { return [account]; },
  };
  const resumedAuth = createBrowserAuth({ client: resumedClient, config, storage });
  await resumedAuth.initialize();

  assert.equal(resumedAuth.consumePendingAction(), "action_orders_gallery");
  assert.equal(resumedAuth.consumePendingAction(), null, "a ação de retorno só pode ser consumida uma vez");
  assert.equal(values.size, 0, "o marcador de sessão deve ser removido após o retorno válido");
});

test("retoma a abertura da Galeria de Despesas Recorrentes após consentimento Microsoft", async () => {
  const account = { homeAccountId: "account-1", username: "pessoa@energeticabr.com" };
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const firstAuth = createBrowserAuth({
    storage,
    config,
    client: {
      async initialize() {},
      async handleRedirectPromise() { return null; },
      getAllAccounts() { return [account]; },
      async acquireTokenRedirect() {},
    },
  });
  await firstAuth.initialize();
  await firstAuth.authorize(["Sites.Read.All"], { resumeAction: "action_recurring_expenses_gallery" });

  const resumedAuth = createBrowserAuth({
    storage,
    config,
    client: {
      async initialize() {},
      async handleRedirectPromise() {
        return { account, accessToken: "gallery-token", scopes: ["Sites.Read.All"] };
      },
      getAllAccounts() { return [account]; },
    },
  });
  await resumedAuth.initialize();

  assert.equal(resumedAuth.consumePendingAction(), "action_recurring_expenses_gallery");
  assert.equal(resumedAuth.consumePendingAction(), null);
  assert.equal(values.size, 0);
});

test("usa mensagem genérica se não puder preservar a ação durante a autorização Microsoft", async () => {
  const account = { homeAccountId: "account-1", username: "pessoa@energeticabr.com" };
  const calls = [];
  const auth = createBrowserAuth({
    storage: {
      getItem() { return null; },
      setItem() { throw new Error("storage indisponível"); },
      removeItem() {},
    },
    config,
    client: {
      async initialize() {},
      async handleRedirectPromise() { return null; },
      getAllAccounts() { return [account]; },
      async acquireTokenRedirect(request) { calls.push(request); },
    },
  });
  await auth.initialize();

  await assert.rejects(
    auth.authorize(["Sites.Read.All"], { resumeAction: "action_recurring_expenses_gallery" }),
    error => {
      assert.equal(error.code, "AUTH_FAILED");
      assert.equal(error.message, "Não foi possível preservar a ação solicitada durante a autorização Microsoft.");
      return true;
    },
  );
  assert.deepEqual(calls, []);
});

test("não retoma pedidos usando conta em cache quando o retorno não identifica a conta", async () => {
  const account = { homeAccountId: "account-1", username: "pessoa@energeticabr.com" };
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const firstAuth = createBrowserAuth({
    storage,
    config,
    client: {
      async initialize() {},
      async handleRedirectPromise() { return null; },
      getAllAccounts() { return [account]; },
      async acquireTokenRedirect() {},
    },
  });
  await firstAuth.initialize();
  await firstAuth.authorize(["Sites.Read.All"], { resumeAction: "action_orders_gallery" });

  const resumedAuth = createBrowserAuth({
    storage,
    config,
    client: {
      async initialize() {},
      async handleRedirectPromise() { return { accessToken: "token", scopes: ["Sites.Read.All"] }; },
      getAllAccounts() { return [account]; },
    },
  });
  await resumedAuth.initialize();

  assert.equal(resumedAuth.consumePendingAction(), null);
});
