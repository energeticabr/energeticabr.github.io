import assert from "node:assert/strict";
import test from "node:test";

const ACCOUNT_MODULE_PATH = new URL("../assets/public-account.js", import.meta.url);

function createAccountFixture() {
  const listeners = new Map();
  const name = { textContent: "" };
  const email = { textContent: "" };
  const signOut = {
    disabled: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  const elements = new Map([
    ["[data-public-account-name]", name],
    ["[data-public-account-email]", email],
    ["[data-public-account-signout]", signOut],
  ]);
  const root = {
    hidden: true,
    querySelector(selector) { return elements.get(selector) || null; },
  };

  return {
    root,
    name,
    email,
    signOut,
    clickSignOut() { return listeners.get("click")?.({ preventDefault() {} }); },
  };
}

function createMsalDouble({ account = null, initializeError = null } = {}) {
  const state = {
    configurations: [],
    loginCalls: 0,
    permissionCalls: 0,
    logoutCalls: [],
  };

  class PublicClientApplication {
    constructor(configuration) {
      state.configurations.push(configuration);
    }

    async initialize() {
      if (initializeError) throw initializeError;
    }

    getActiveAccount() { return account; }
    getAllAccounts() { return account ? [account] : []; }
    setActiveAccount() {}
    loginRedirect() { state.loginCalls += 1; }
    acquireTokenSilent() { state.permissionCalls += 1; }
    async logoutRedirect(request) { state.logoutCalls.push(request); }
  }

  return { msal: { PublicClientApplication }, state };
}

const microsoftConfig = Object.freeze({
  clientId: "94018e25-f756-4aa6-974e-27b8b43d7fe9",
  authority: "https://login.microsoftonline.com/0c10f511-7ede-4702-a2d9-bedb26937e0e",
});

test("sessao Microsoft existente aparece sem iniciar login ou solicitar permissao", async () => {
  const { createPublicAccountController } = await import(ACCOUNT_MODULE_PATH);
  const fixture = createAccountFixture();
  const account = {
    name: "Bernardo Notini",
    username: "bernardonotini@energeticabr.com",
  };
  const { msal, state } = createMsalDouble({ account });
  const controller = createPublicAccountController({
    root: fixture.root,
    msal,
    microsoftConfig,
    locationHref: "https://www.energeticabr.com/",
  });

  const result = await controller.initialize();

  assert.equal(result, account);
  assert.equal(fixture.root.hidden, false);
  assert.equal(fixture.name.textContent, "Bernardo Notini");
  assert.equal(fixture.email.textContent, "bernardonotini@energeticabr.com");
  assert.equal(state.loginCalls, 0);
  assert.equal(state.permissionCalls, 0);
  assert.equal(state.configurations[0].cache.cacheLocation, "sessionStorage");
  assert.equal(state.configurations[0].auth.clientId, microsoftConfig.clientId);
});

test("ausencia de sessao e falha do MSAL permanecem invisiveis e silenciosas", async () => {
  const { createPublicAccountController } = await import(ACCOUNT_MODULE_PATH);

  for (const setup of [{}, { initializeError: new Error("cache indisponivel") }]) {
    const fixture = createAccountFixture();
    const { msal, state } = createMsalDouble(setup);
    const controller = createPublicAccountController({
      root: fixture.root,
      msal,
      microsoftConfig,
      locationHref: "https://www.energeticabr.com/trabalhe-conosco.html",
    });

    const result = await controller.initialize();

    assert.equal(result, null);
    assert.equal(fixture.root.hidden, true);
    assert.equal(state.loginCalls, 0);
    assert.equal(state.permissionCalls, 0);
  }

});

test("Sair encerra a sessao somente depois da acao explicita do usuario", async () => {
  const { createPublicAccountController } = await import(ACCOUNT_MODULE_PATH);
  const fixture = createAccountFixture();
  const account = { name: "Bernardo", username: "bernardonotini@energeticabr.com" };
  const { msal, state } = createMsalDouble({ account });
  const controller = createPublicAccountController({
    root: fixture.root,
    msal,
    microsoftConfig,
    locationHref: "https://www.energeticabr.com/trabalhe-conosco.html#oportunidades",
  });

  await controller.initialize();
  assert.equal(state.logoutCalls.length, 0);

  await fixture.clickSignOut();

  assert.equal(state.logoutCalls.length, 1);
  assert.equal(state.logoutCalls[0].account, account);
  assert.equal(state.logoutCalls[0].postLogoutRedirectUri, "https://www.energeticabr.com/trabalhe-conosco.html");
});
