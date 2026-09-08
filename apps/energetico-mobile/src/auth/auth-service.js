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
    const result = await invoke("initialize", {
      clientId: String(config.clientId),
      tenantId: String(config.tenantId),
      redirectUri: `msauth.${config.bundleId}://auth`,
    });
    account = normalizeAccount(result?.account);
    return account;
  }

  async function signIn() {
    const result = await invoke("signIn", { scopes: normalizeScopes(config.scopes) });
    account = normalizeAccount(result?.account);
    if (!account) throw new AuthError("AUTH_FAILED", "O login Microsoft não devolveu uma conta válida.");
    return account;
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
    if (account) {
      await invoke("signOut", { homeAccountId: account.homeAccountId });
    }
    account = null;
  }

  return Object.freeze({
    initialize,
    signIn,
    getToken,
    signOut,
    getAccount: () => account,
  });
}
