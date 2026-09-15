class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export class AuthInteractionRequiredError extends AuthError {
  constructor() {
    super("AUTH_REQUIRED", "Entre novamente com sua conta Microsoft.");
    this.name = "AuthInteractionRequiredError";
  }
}

export class AuthCancelledError extends AuthError {
  constructor() {
    super("AUTH_CANCELLED", "Login cancelado.");
    this.name = "AuthCancelledError";
  }
}

export class AuthNetworkError extends AuthError {
  constructor() {
    super("AUTH_NETWORK", "Não foi possível acessar o login Microsoft. Verifique sua conexão.");
    this.name = "AuthNetworkError";
  }
}

function normalizeScopes(scopes) {
  // MSAL iOS adds these OIDC scopes itself and rejects an explicit overlap.
  // Keep the shared browser configuration unchanged; filter only at this native boundary.
  const sdkManagedScopes = new Set(["openid", "profile", "offline_access"]);
  return [...new Set((scopes || []).map(String).map(scope => scope.trim())
    .filter(scope => scope && !sdkManagedScopes.has(scope)))];
}

function normalizeAccount(value) {
  if (!value || typeof value !== "object") return null;
  const homeAccountId = String(value.homeAccountId || "").trim();
  if (!homeAccountId) return null;
  return Object.freeze({
    homeAccountId,
    username: String(value.username || ""),
    name: String(value.name || value.username || ""),
  });
}

function normalizeError(error) {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("interactionrequired") || code.includes("interaction_required") || code === "auth_required") {
    return new AuthInteractionRequiredError();
  }
  if (code.includes("usercanceled") || code.includes("usercancelled") || code.includes("cancel") || code === "auth_cancelled") {
    return new AuthCancelledError();
  }
  if (code.includes("network") || code.includes("internet") || code.includes("notconnected")) {
    return new AuthNetworkError();
  }
  return new AuthError("AUTH_FAILED", "O login Microsoft não pôde ser concluído.");
}

export function createAuthService(plugin, config) {
  if (!plugin || typeof plugin.initialize !== "function") {
    throw new TypeError("A ponte de autenticação Microsoft não está disponível.");
  }

  let account = null;
  let pendingSignIn = null;
  let pendingInitialization = null;
  let initialized = false;
  let initializationGeneration = 0;

  async function acceptAccount(value) {
    const candidate = normalizeAccount(value);
    const domain = String(config.allowedEmailDomain || "").trim().toLowerCase();
    if (candidate && domain) {
      const username = candidate.username.trim().toLowerCase();
      const parts = username.split("@");
      if (parts.length !== 2 || !parts[0] || parts[1] !== domain || username.includes("#ext#")) {
        account = null;
        try { await invoke("signOut", { homeAccountId: candidate.homeAccountId }); } catch { /* Remain signed out even if SDK cleanup fails. */ }
        throw new AuthError("AUTH_DOMAIN_DENIED", `Acesso permitido apenas para contas @${domain}.`);
      }
    }
    account = candidate;
    return account;
  }

  async function invoke(method, options) {
    if (typeof plugin[method] !== "function") {
      throw new AuthError("AUTH_FAILED", "O login Microsoft não está disponível neste dispositivo.");
    }
    try {
      return await plugin[method](options);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function initialize() {
    if (!pendingInitialization) {
      const generation = initializationGeneration;
      const operation = invoke("initialize", {
        clientId: String(config.clientId),
        tenantId: String(config.tenantId),
        redirectUri: `msauth.${config.bundleId}://auth`,
        authenticationMode: "systemBrowser",
      }).then(result => {
        if (generation !== initializationGeneration) return account;
        initialized = true;
        return acceptAccount(result?.account);
      }).catch(error => {
        if (generation === initializationGeneration) initialized = false;
        throw error;
      });
      operation.catch(() => {});
      pendingInitialization = operation;
      operation.finally(() => {
        if (pendingInitialization === operation) pendingInitialization = null;
      }).catch(() => {});
    }
    return pendingInitialization;
  }

  function abandonPendingInitialization() {
    if (!pendingInitialization) return false;
    initializationGeneration += 1;
    pendingInitialization.catch(() => {});
    pendingInitialization = null;
    initialized = false;
    return true;
  }

  async function signIn() {
    if (!pendingSignIn) {
      const operation = (async () => {
        // An explicit user action has priority over silent restoration. Some
        // Android WebViews can lose the first bridge response during startup;
        // waiting for that call here prevents the browser from ever opening.
        if (!initialized && pendingInitialization) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (account) return account;
        if (!initialized) abandonPendingInitialization();
        // Interactive login is self-contained. It must not depend on a
        // startup initialize response that the Android WebView may have lost.
        const result = await invoke("signIn", {
          clientId: String(config.clientId),
          tenantId: String(config.tenantId),
          redirectUri: `msauth.${config.bundleId}://auth`,
          scopes: normalizeScopes(config.scopes),
        });
        await acceptAccount(result?.account);
        if (!account) throw new AuthError("AUTH_FAILED", "O login Microsoft não devolveu uma conta válida.");
        return account;
      })().finally(() => { pendingSignIn = null; });
      // A controller timeout can detach from this operation while the native
      // bridge is still finishing. Keep that late rejection from becoming an
      // unhandled promise, while allowing the next sign-in to start cleanly.
      operation.catch(() => {});
      pendingSignIn = operation;
    }
    return pendingSignIn;
  }

  async function cancelSignIn() {
    const operation = pendingSignIn;
    pendingSignIn = null;
    operation?.catch(() => {});
    abandonPendingInitialization();
    if (typeof plugin.cancelSignIn !== "function") return Boolean(operation);
    try {
      await plugin.cancelSignIn();
    } catch {
      // The local state is cleared even if an older native bridge does not
      // implement cancellation completely.
    }
    return Boolean(operation);
  }

  async function getToken(scopes) {
    if (!account) throw new AuthInteractionRequiredError();
    const result = await invoke("getToken", {
      scopes: normalizeScopes(scopes),
      homeAccountId: account.homeAccountId,
    });
    const accessToken = String(result?.accessToken || "");
    if (!accessToken) throw new AuthInteractionRequiredError();
    return accessToken;
  }

  async function signOut() {
    await cancelSignIn();
    if (account) {
      await invoke("signOut", { homeAccountId: account.homeAccountId });
    }
    account = null;
  }

  return Object.freeze({
    initialize,
    signIn,
    cancelSignIn,
    getToken,
    signOut,
    getAccount: () => account,
  });
}
