import test from "node:test";
import assert from "node:assert/strict";

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
    ["signIn", { scopes: ["openid", "User.Read"] }],
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
