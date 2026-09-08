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
    ["signIn", { scopes: ["User.Read"] }],
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

test("login com configuração real não envia escopos reservados ao MSAL iOS", async () => {
  const account = { homeAccountId: "iphone-account", username: "teste@empresa.com" };
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
  assert.deepEqual(requests, [{ scopes: ["email", "User.Read"] }]);
  assert.deepEqual(APP_CONFIG.scopes, ["openid", "profile", "email", "User.Read"], "shared web configuration is not mutated");
});

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
