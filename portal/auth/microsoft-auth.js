function authRequest(scopes) {
  return { scopes: [...scopes] };
}

const INTERACTIVE_ERROR_CODES = new Set([
  "interaction_required",
  "consent_required",
  "login_required",
  "account_selection_required",
]);

export function createMicrosoftAuth(config, msal = globalThis.msal) {
  const PublicClientApplication = msal?.PublicClientApplication;
  const InteractionRequiredAuthError = msal?.InteractionRequiredAuthError;
  if (!PublicClientApplication) {
    throw new Error("A biblioteca de autenticacao Microsoft nao foi carregada.");
  }

  let client;
  let account = null;

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
      return getClient().logoutRedirect({ account });
    },

    getAccount() {
      return account;
    },

    clearAccount() {
      account = null;
      getClient().setActiveAccount?.(null);
    },

    async switchAccount() {
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
