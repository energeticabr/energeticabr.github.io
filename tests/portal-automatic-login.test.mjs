import assert from "node:assert/strict";
import test from "node:test";
import { createMicrosoftAuth } from "../portal/auth/microsoft-auth.js";

const microsoftConfig = {
  clientId: "public-client-id",
  authority: "https://login.microsoftonline.com/tenant-id",
  redirectUri: "https://www.energeticabr.com/admin.html",
  scopes: ["openid", "profile", "email", "User.Read", "Sites.Read.All"],
};

function createSessionStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createLoginViewSpy() {
  const calls = [];
  return {
    calls,
    setLoading(message) {
      calls.push(["loading", message]);
    },
    setReady(message) {
      calls.push(["ready", message]);
    },
    setError(message) {
      calls.push(["error", message]);
    },
  };
}

function createLoginRoot() {
  const nodes = new Map();
  const makeNode = () => ({
    dataset: {},
    disabled: false,
    hidden: false,
    textContent: "",
    addEventListener() {},
    querySelector() {
      return makeNode();
    },
  });
  for (const selector of [
    "[data-microsoft-login-action]",
    "[data-switch-account-action]",
    "[data-login-actions]",
    "[data-login-loading]",
    "[data-login-status]",
    "[data-login-session]",
    "[data-login-unauthorized]",
  ]) nodes.set(selector, makeNode());

  return {
    dataset: {},
    innerHTML: "",
    setAttribute() {},
    querySelector(selector) {
      return nodes.get(selector);
    },
  };
}

function restoreGlobal(name, previousValue) {
  if (previousValue === undefined) delete globalThis[name];
  else globalThis[name] = previousValue;
}

test("app.js pode ser importado sem um navegador real", async () => {
  const previousDocument = globalThis.document;
  delete globalThis.document;

  try {
    const app = await import("../portal/app.js?automatic-login-no-browser");
    assert.equal(typeof app.isRouteAllowed, "function");
  } finally {
    if (previousDocument !== undefined) globalThis.document = previousDocument;
  }
});

test("abrir o admin sem sessao aciona o redirect Microsoft automaticamente", async () => {
  const previousDocument = globalThis.document;
  const previousMsal = globalThis.msal;
  const previousSessionStorage = globalThis.sessionStorage;
  const redirects = [];
  let notifyRedirect;
  let redirectTimeout;
  const redirectStarted = new Promise(resolve => {
    notifyRedirect = resolve;
  });

  class PublicClientApplication {
    async initialize() {}

    async handleRedirectPromise() {
      return null;
    }

    async loginRedirect(request) {
      redirects.push(request);
      notifyRedirect();
    }
  }

  globalThis.document = { getElementById: () => createLoginRoot() };
  globalThis.msal = { PublicClientApplication };
  globalThis.sessionStorage = createSessionStorage();

  try {
    await import("../portal/app.js?automatic-login-browser-open");
    await Promise.race([
      redirectStarted,
      new Promise((_, reject) => {
        redirectTimeout = setTimeout(() => reject(new Error("loginRedirect nao foi iniciado")), 100);
      }),
    ]);
    assert.deepEqual(redirects, [{ scopes: microsoftConfig.scopes }]);
  } finally {
    clearTimeout(redirectTimeout);
    restoreGlobal("document", previousDocument);
    restoreGlobal("msal", previousMsal);
    restoreGlobal("sessionStorage", previousSessionStorage);
  }
});

test("sem conta inicia login Microsoft uma vez e depois oferece recuperacao manual", async () => {
  const app = await import("../portal/app.js?automatic-login-flow");
  const storage = createSessionStorage();
  const redirects = [];

  class PublicClientApplication {
    async handleRedirectPromise() {
      return null;
    }

    async loginRedirect(request) {
      redirects.push(request);
    }
  }

  const firstView = createLoginViewSpy();
  const firstAuth = createMicrosoftAuth(microsoftConfig, { PublicClientApplication }, storage);
  const firstAccount = await firstAuth.initialize();
  await app.resolveMicrosoftLogin(firstAccount, firstAuth, firstView);

  const recoveryView = createLoginViewSpy();
  const returnedAuth = createMicrosoftAuth(microsoftConfig, { PublicClientApplication }, storage);
  const returnedAccount = await returnedAuth.initialize();
  await app.resolveMicrosoftLogin(returnedAccount, returnedAuth, recoveryView);

  assert.deepEqual(redirects, [{ scopes: microsoftConfig.scopes }]);
  assert.match(firstView.calls[0][1], /login Microsoft/i);
  assert.equal(recoveryView.calls[0][0], "ready");
  assert.match(recoveryView.calls[0][1], /tente novamente/i);
});

test("falha ao abrir o redirect preserva a recuperacao manual", async () => {
  const app = await import("../portal/app.js?automatic-login-error");
  const storage = createSessionStorage();
  let redirects = 0;

  class PublicClientApplication {
    async loginRedirect() {
      redirects += 1;
      throw new Error("user_cancelled");
    }
  }

  const failedView = createLoginViewSpy();
  const auth = createMicrosoftAuth(microsoftConfig, { PublicClientApplication }, storage);
  const previousConsoleError = console.error;
  console.error = () => {};
  try {
    await app.resolveMicrosoftLogin(null, auth, failedView);
  } finally {
    console.error = previousConsoleError;
  }

  const recoveryView = createLoginViewSpy();
  const returnedAuth = createMicrosoftAuth(microsoftConfig, { PublicClientApplication }, storage);
  await app.resolveMicrosoftLogin(null, returnedAuth, recoveryView);

  assert.equal(redirects, 1);
  assert.equal(failedView.calls.at(-1)[0], "error");
  assert.match(failedView.calls.at(-1)[1], /tente novamente/i);
  assert.equal(recoveryView.calls[0][0], "ready");
});

test("autenticacao bem-sucedida libera uma futura tentativa automatica", async () => {
  const app = await import("../portal/app.js?automatic-login-success");
  const storage = createSessionStorage();

  class PublicClientApplication {}

  const auth = createMicrosoftAuth(microsoftConfig, { PublicClientApplication }, storage);
  assert.equal(auth.claimAutomaticLogin(), true);

  const account = { username: "admin@energeticabr.com" };
  assert.equal(await app.resolveMicrosoftLogin(account, auth, createLoginViewSpy()), account);

  const nextAuth = createMicrosoftAuth(microsoftConfig, { PublicClientApplication }, storage);
  assert.equal(nextAuth.claimAutomaticLogin(), true);
});

test("logout limpa a guarda da tentativa automatica", async () => {
  const storage = createSessionStorage();
  let logoutCalls = 0;

  class PublicClientApplication {
    async logoutRedirect() {
      logoutCalls += 1;
    }
  }

  const auth = createMicrosoftAuth(microsoftConfig, { PublicClientApplication }, storage);
  assert.equal(auth.claimAutomaticLogin(), true);
  await auth.signOut();

  const nextAuth = createMicrosoftAuth(microsoftConfig, { PublicClientApplication }, storage);
  assert.equal(nextAuth.claimAutomaticLogin(), true);
  assert.equal(logoutCalls, 1);
});

test("troca de conta limpa a guarda da tentativa automatica", async () => {
  const storage = createSessionStorage();
  const redirects = [];

  class PublicClientApplication {
    setActiveAccount() {}

    async loginRedirect(request) {
      redirects.push(request);
    }
  }

  const auth = createMicrosoftAuth(microsoftConfig, { PublicClientApplication }, storage);
  assert.equal(auth.claimAutomaticLogin(), true);
  await auth.switchAccount();

  const nextAuth = createMicrosoftAuth(microsoftConfig, { PublicClientApplication }, storage);
  assert.equal(nextAuth.claimAutomaticLogin(), true);
  assert.deepEqual(redirects, [{ scopes: microsoftConfig.scopes, prompt: "select_account" }]);
});
