function authRequest(scopes) {
  return { scopes: [...scopes] };
}

const INTERACTIVE_ERROR_CODES = new Set([
  "interaction_required",
  "consent_required",
  "login_required",
  "account_selection_required",
]);

const AUTOMATIC_LOGIN_GUARD_KEY = "portal.microsoft-login.automatic-attempt";

function createAutomaticLoginGuard(storage) {
  return Object.freeze({
    claim() {
      if (!storage?.getItem || !storage?.setItem) return false;
      try {
        if (storage.getItem(AUTOMATIC_LOGIN_GUARD_KEY) !== null) return false;
        storage.setItem(AUTOMATIC_LOGIN_GUARD_KEY, "1");
        return true;
      } catch {
        return false;
      }
    },

    clear() {
      try {
        storage?.removeItem?.(AUTOMATIC_LOGIN_GUARD_KEY);
      } catch {
        // Storage can be unavailable under restrictive browser policies.
      }
    },
  });
}

export function createMicrosoftAuth(config, msal = globalThis.msal, storage = globalThis.sessionStorage) {
  const PublicClientApplication = msal?.PublicClientApplication;
  const InteractionRequiredAuthError = msal?.InteractionRequiredAuthError;
  if (!PublicClientApplication) {
    throw new Error("A biblioteca de autenticacao Microsoft nao foi carregada.");
  }

  let client;
  let account = null;
  const automaticLoginGuard = createAutomaticLoginGuard(storage);

  function getClient() {
    if (!client) {
      client = new PublicClientApplication({
        auth: {
          clientId: config.clientId,
          authority: config.authority,
          redirectUri: config.redirectUri,
        },
        cache: {
          cacheLocation: "sessionStorage",
          storeAuthStateInCookie: false,
        },
      });
    }

    return client;
  }

  return Object.freeze({
    async initialize() {
      const msalClient = getClient();
      await msalClient.initialize?.();
      const redirectResult = await msalClient.handleRedirectPromise?.();
      account = redirectResult?.account
        || msalClient.getActiveAccount?.()
        || msalClient.getAllAccounts?.()[0]
        || null;

      if (account) msalClient.setActiveAccount?.(account);
      return account;
    },

    async signIn() {
      return getClient().loginRedirect(authRequest(config.scopes));
    },

    async signOut() {
      automaticLoginGuard.clear();
      return getClient().logoutRedirect({ account });
    },

    claimAutomaticLogin() {
      return automaticLoginGuard.claim();
    },

    clearAutomaticLoginGuard() {
      automaticLoginGuard.clear();
    },

    getAccount() {
      return account;
    },

    clearAccount() {
      account = null;
      getClient().setActiveAccount?.(null);
    },

    async switchAccount() {
      automaticLoginGuard.clear();
      this.clearAccount();
      return getClient().loginRedirect({ ...authRequest(config.scopes), prompt: "select_account" });
    },

    async getToken(scopes = config.scopes) {
      if (!account) return undefined;

      const request = { account, ...authRequest(scopes) };
      try {
        return (await getClient().acquireTokenSilent(request))?.accessToken;
      } catch (error) {
        const officialInteractionError = typeof InteractionRequiredAuthError === "function"
          && error instanceof InteractionRequiredAuthError;
        const documentedInteractiveCode = INTERACTIVE_ERROR_CODES.has(String(error?.errorCode || "").toLowerCase());
        if (!officialInteractionError && !documentedInteractiveCode) throw error;
        await getClient().acquireTokenRedirect(request);
        return undefined;
      }
    },
  });
}
