import test from "node:test";
import assert from "node:assert/strict";
import { APP_CONFIG } from "../src/config.js";

import {
  AuthInteractionRequiredError,
  createAuthService,
} from "../src/auth/auth-service.js";

const config = Object.freeze({
  clientId: "client-id",
  tenantId: "tenant-id",
  bundleId: "br.com.energetica.energetico",
  scopes: ["openid", "User.Read"],
});

test("inicializa sem conta armazenada", async () => {
  const calls = [];
  const plugin = {
    async initialize(options) {
      calls.push(options);
      return { account: null };
    },
  };

  const auth = createAuthService(plugin, config);
  assert.equal(await auth.initialize(), null);
  assert.deepEqual(calls, [{
    clientId: "client-id",
    tenantId: "tenant-id",
    redirectUri: "msauth.br.com.energetica.energetico://auth",
    authenticationMode: "systemBrowser",
  }]);
});

test("obtém token silenciosamente para os escopos pedidos", async () => {
  const calls = [];
  const account = { homeAccountId: "account-1", username: "pessoa@empresa.com", name: "Pessoa" };
  const plugin = {
    async initialize() { return { account }; },
    async getToken(options) {
      calls.push(options);
      return { accessToken: "token-secreto", expiresOn: "2026-09-06T10:00:00Z" };
    },
  };
  const auth = createAuthService(plugin, config);
  await auth.initialize();

  assert.equal(await auth.getToken(["User.Read"]), "token-secreto");
  assert.deepEqual(calls, [{ scopes: ["User.Read"], homeAccountId: "account-1" }]);
  assert.doesNotMatch(JSON.stringify(auth), /token-secreto/);
});

test("expõe necessidade de interação sem vazar o erro nativo", async () => {
  const secret = "eyJ-token-que-nao-pode-vazar";
  const plugin = {
    async initialize() {
      return { account: { homeAccountId: "account-1", username: "pessoa@empresa.com" } };
    },
    async getToken() {
      throw { code: "MSALErrorInteractionRequired", message: `renove ${secret}` };
    },
  };
  const auth = createAuthService(plugin, config);
  await auth.initialize();

  await assert.rejects(
    auth.getToken(["User.Read"]),
    error => {
      assert.ok(error instanceof AuthInteractionRequiredError);
      assert.equal(error.code, "AUTH_REQUIRED");
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("autoriza interativamente um escopo adicional sem descartar a conta Microsoft", async () => {
  const calls = [];
  const account = { homeAccountId: "account-1", username: "pessoa@energeticabr.com", name: "Pessoa" };
  const plugin = {
    async initialize() { return { account }; },
    async signIn(options) { calls.push(options); return { account }; },
  };
  const auth = createAuthService(plugin, config);
  await auth.initialize();

  assert.equal((await auth.authorize(["https://energeticaltda-my.sharepoint.com/AllSites.Read"])).homeAccountId, "account-1");
  assert.equal(auth.getAccount().username, "pessoa@energeticabr.com");
  assert.deepEqual(calls, [{
    clientId: "client-id",
    tenantId: "tenant-id",
    redirectUri: "msauth.br.com.energetica.energetico://auth",
    scopes: ["https://energeticaltda-my.sharepoint.com/AllSites.Read"],
    authorizationMode: "incremental",
    expectedHomeAccountId: "account-1",
    loginHint: "pessoa@energeticabr.com",
  }]);
});

test("não troca a conta ativa se a autorização adicional retornar outra identidade", async () => {
  const account = { homeAccountId: "account-1", username: "pessoa@energeticabr.com" };
  const plugin = {
    async initialize() { return { account }; },
    async signIn() { return { account: { homeAccountId: "account-2", username: "outra@energeticabr.com" } }; },
  };
  const auth = createAuthService(plugin, config);
  await auth.initialize();

  await assert.rejects(auth.authorize(["https://energeticaltda-my.sharepoint.com/AllSites.Read"]), error => {
    assert.equal(error.code, "AUTH_ACCOUNT_MISMATCH");
    return true;
  });
  assert.equal(auth.getAccount().homeAccountId, "account-1");
});

test("login e saída mantêm somente a conta normalizada", async () => {
  const calls = [];
  const plugin = {
    async initialize() { return { account: null }; },
    async signIn(options) {
      calls.push(["signIn", options]);
      return {
        account: {
          homeAccountId: "account-2",
          username: "alguem@empresa.com",
          name: "Alguém",
          accessToken: "não-guardar",
          extra: "não-guardar",
        },
      };
    },
    async signOut(options) {
      calls.push(["signOut", options]);
      return {};
    },
  };
  const auth = createAuthService(plugin, config);
  await auth.initialize();

  assert.deepEqual(await auth.signIn(), {
    homeAccountId: "account-2",
    username: "alguem@empresa.com",
    name: "Alguém",
  });
  assert.equal(auth.getAccount().homeAccountId, "account-2");
  assert.equal(JSON.stringify(auth.getAccount()).includes("não-guardar"), false);
  await auth.signOut();
  assert.equal(auth.getAccount(), null);
  assert.deepEqual(calls, [
    ["signIn", {
      clientId: "client-id",
      tenantId: "tenant-id",
      redirectUri: "msauth.br.com.energetica.energetico://auth",
      scopes: ["User.Read"],
    }],
    ["signOut", { homeAccountId: "account-2" }],
  ]);
});

test("cancelamento interativo recebe código estável", async () => {
  const plugin = {
    async initialize() { return { account: null }; },
    async signIn() { throw { code: "MSALErrorUserCanceled", message: "native details" }; },
  };
  const auth = createAuthService(plugin, config);
  await auth.initialize();

  await assert.rejects(auth.signIn(), error => {
    assert.equal(error.code, "AUTH_CANCELLED");
    assert.equal(error.message, "Login cancelado.");
    return true;
  });
});

test("login inicial não pede permissão SharePoint e não envia escopos reservados ao MSAL iOS", async () => {
  const account = { homeAccountId: "iphone-account", username: "teste@energeticabr.com" };
  const requests = [];
  const plugin = {
    async initialize() { return { account: null }; },
    async signIn(options) {
      requests.push(options);
      // MSIDRequestParameters rejects any overlap with SDK-managed OIDC scopes.
      if (options.scopes.some(scope => ["openid", "profile", "offline_access"].includes(scope))) {
        throw { code: "AUTH_FAILED" };
      }
      return { account };
    },
  };
  const auth = createAuthService(plugin, APP_CONFIG);
  await auth.initialize();
  assert.equal((await auth.signIn()).homeAccountId, "iphone-account");
  assert.deepEqual(requests, [{
    clientId: APP_CONFIG.clientId,
    tenantId: APP_CONFIG.tenantId,
    redirectUri: `msauth.${APP_CONFIG.bundleId}://auth`,
    scopes: ["email", "User.Read"],
  }]);
  assert.deepEqual(APP_CONFIG.scopes, ["openid", "profile", "email", "User.Read"], "SharePoint permission must be requested only when the orders gallery is opened");
});

test("não repete o login nativo enquanto a autenticação anterior está pendente", async () => {
  let complete;
  let calls = 0;
  const auth = createAuthService({
    initialize: async () => ({ account: null }),
    signIn: () => { calls++; return new Promise(resolve => { complete = resolve; }); },
  }, config);
  await auth.initialize();
  const first = auth.signIn();
  const second = auth.signIn();
  assert.equal(calls, 1);
  complete({ account: { homeAccountId: "one", username: "teste@energeticabr.com" } });
  assert.equal((await first).homeAccountId, "one");
  assert.equal((await second).homeAccountId, "one");
});

test("cancela a tentativa nativa pendente para permitir uma nova tentativa", async () => {
  let complete;
  let calls = 0;
  let cancellations = 0;
  const auth = createAuthService({
    initialize: async () => ({ account: null }),
    signIn: () => { calls++; return new Promise(resolve => { complete = resolve; }); },
    cancelSignIn: async () => { cancellations++; },
  }, config);
  await auth.initialize();
  const first = auth.signIn();
  assert.equal(typeof auth.cancelSignIn, "function");
  await auth.cancelSignIn();
  assert.equal(cancellations, 1);
  complete({ account: null });
  await assert.rejects(first);
  const second = auth.signIn();
  assert.equal(calls, 2, "a nova tentativa não pode reutilizar a promessa anterior");
  complete({ account: { homeAccountId: "new", username: "teste@energeticabr.com" } });
  assert.equal((await second).homeAccountId, "new");
});

test("login continua após cancelar uma inicialização nativa expirada", async () => {
  let initializeCalls = 0;
  let signInCalls = 0;
  const plugin = {
    initialize() {
      initializeCalls++;
      if (initializeCalls === 1) return new Promise(() => {});
      return Promise.resolve({ account: null });
    },
    async signIn() {
      signInCalls++;
      return { account: { homeAccountId: "retry", username: "teste@energeticabr.com" } };
    },
    async cancelSignIn() {},
  };
  const auth = createAuthService(plugin, config);
  void auth.initialize();
  await new Promise(resolve => setImmediate(resolve));

  await auth.cancelSignIn();
  const completed = await Promise.race([
    auth.signIn(),
    new Promise(resolve => setTimeout(() => resolve(null), 50)),
  ]);

  assert.equal(completed?.homeAccountId, "retry", "o novo toque não pode reutilizar a inicialização que expirou");
  assert.equal(initializeCalls, 1, "o login explícito leva a própria configuração e não repete a inicialização");
  assert.equal(signInCalls, 1);
});

test("login interativo não fica preso à restauração nativa que não respondeu", async () => {
  let initializeCalls = 0;
  let signInCalls = 0;
  const auth = createAuthService({
    initialize() {
      initializeCalls++;
      if (initializeCalls === 1) return new Promise(() => {});
      return Promise.resolve({ account: null });
    },
    signIn: async () => { signInCalls++; return { account: { homeAccountId: "after-init", username: "teste@energeticabr.com" } }; },
  }, config);
  void auth.initialize();
  await new Promise(resolve => setImmediate(resolve));

  const entering = auth.signIn();
  const completed = await Promise.race([
    entering,
    new Promise(resolve => setTimeout(() => resolve(null), 50)),
  ]);

  assert.equal(completed?.homeAccountId, "after-init", "o primeiro toque deve chegar ao login nativo");
  assert.equal(initializeCalls, 1, "o login manual não deve repetir nem aguardar a restauração travada");
  assert.equal(signInCalls, 1);
});

test("login usa a sessão restaurada quando a tela ficou disponível antes do fim da inicialização", async () => {
  const account = { homeAccountId: "restored", username: "teste@energeticabr.com" };
  let signInCalls = 0;
  const auth = createAuthService({
    initialize: async () => ({ account }),
    signIn: async () => { signInCalls++; return { account }; },
  }, config);
  const restoring = auth.initialize();
  const entering = auth.signIn();
  assert.equal((await restoring).homeAccountId, "restored");
  assert.equal((await entering).homeAccountId, "restored");
  assert.equal(signInCalls, 0, "não deve abrir o navegador de novo para uma sessão já restaurada");
});

for (const username of ["pessoa@gmail.com", "pessoa@energeticabr.com.evil.test", "pessoa@sub.energeticabr.com", "", "pessoa#EXT#@energeticabr.com"]) {
  test(`recusa conta fora do domínio corporativo na entrada e na restauração: ${username}`, async () => {
    const account = { homeAccountId: "foreign", username };
    let removals = 0;
    const auth = createAuthService({
      initialize: async () => ({ account }), signIn: async () => ({ account }),
      signOut: async () => { removals++; },
      getToken: async () => { throw new Error("não deve solicitar token"); },
    }, APP_CONFIG);
    await assert.rejects(auth.initialize(), error => error.code === "AUTH_DOMAIN_DENIED");
    assert.equal(auth.getAccount(), null);
    await assert.rejects(auth.signIn(), error => error.code === "AUTH_DOMAIN_DENIED");
    assert.equal(auth.getAccount(), null);
    assert.equal(removals, 2);
    await assert.rejects(auth.getToken(["User.Read"]), error => error.code === "AUTH_REQUIRED");
  });
}

test("renovação nativa remove escopos OIDC reservados e mantém permissões da API", async () => {
  const requests = [];
  const plugin = {
    async initialize() { return { account: { homeAccountId: "iphone-account" } }; },
    async getToken(options) { requests.push(options); return { accessToken: "test-access-token" }; },
  };
  const auth = createAuthService(plugin, config);
  await auth.initialize();
  await auth.getToken(["openid", " profile ", "offline_access", "User.Read", "User.Read", "email"]);
  assert.deepEqual(requests, [{ scopes: ["User.Read", "email"], homeAccountId: "iphone-account" }]);
});
