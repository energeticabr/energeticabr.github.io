export class BrowserAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BrowserAuthError";
    this.code = code;
  }
}

function normalizedAccount(account) {
  if (!account) return null;
  return Object.freeze({
    homeAccountId: String(account.homeAccountId || ""),
    username: String(account.username || ""),
    name: String(account.name || account.username || "Usuário"),
  });
}

function normalizeError(error) {
  const code = String(error?.errorCode || error?.code || "").toLowerCase();
  if (code.includes("interaction") || code.includes("login_required") || code.includes("no_account")) {
    return new BrowserAuthError("AUTH_REQUIRED", "Entre novamente com a Microsoft.");
  }
  if (code.includes("cancel") || code.includes("user_cancel")) {
    return new BrowserAuthError("AUTH_CANCELLED", "Login cancelado.");
  }
  return new BrowserAuthError("AUTH_FAILED", "A autenticação Microsoft não foi concluída.");
}

export function createBrowserAuth({ client, config }) {
  if (!client || !config?.webRedirectUri) {
    throw new TypeError("A autenticação Web requer cliente Microsoft e URL de retorno.");
  }
  let account = null;

  async function initialize() {
    try {
      await client.initialize();
      const redirect = await client.handleRedirectPromise();
      account = normalizedAccount(redirect?.account || client.getAllAccounts()?.[0]);
      return account;
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function signIn() {
    if (account) return account;
    try {
      const result = await client.loginRedirect({
        scopes: [...config.scopes],
        redirectUri: config.webRedirectUri,
      });
      account = normalizedAccount(result?.account);
      return account;
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function getToken(scopes = ["User.Read"]) {
    if (!account) throw new BrowserAuthError("AUTH_REQUIRED", "Entre novamente com a Microsoft.");
    try {
      const result = await client.acquireTokenSilent({ account, scopes: [...scopes] });
      if (!result?.accessToken) throw { errorCode: "interaction_required" };
      return result.accessToken;
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function signOut() {
    const signedInAccount = account;
    account = null;
    await client.logoutRedirect({
      account: signedInAccount,
      postLogoutRedirectUri: config.webRedirectUri,
    });
  }

  return Object.freeze({ initialize, signIn, getToken, signOut, getAccount: () => account });
}
