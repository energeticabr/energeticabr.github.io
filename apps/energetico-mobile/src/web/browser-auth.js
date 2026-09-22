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
  if (code.includes("interaction") || code.includes("consent_required")
    || code.includes("account_selection_required") || code.includes("login_required") || code.includes("no_account")) {
    return new BrowserAuthError("AUTH_REQUIRED", "Entre novamente com a Microsoft.");
  }
  if (code.includes("cancel") || code.includes("user_cancel")) {
    return new BrowserAuthError("AUTH_CANCELLED", "Login cancelado.");
  }
  return new BrowserAuthError("AUTH_FAILED", "A autenticação Microsoft não foi concluída.");
}

export function createBrowserAuth({ client, config, storage }) {
  if (!client || !config?.webRedirectUri) {
    throw new TypeError("A autenticação Web requer cliente Microsoft e URL de retorno.");
  }
  let account = null;
  let msalAccount = null;
  let pendingAction = null;

  async function initialize() {
    try {
      await client.initialize();
      const redirect = await client.handleRedirectPromise();
      msalAccount = redirect?.account || client.getAllAccounts()?.[0] || null;
      account = normalizedAccount(msalAccount);
      pendingAction = null;
      const targetStorage = browserStorage(storage);
      let pending = null;
      try {
        const serialized = targetStorage?.getItem(PENDING_ACTION_KEY);
        if (serialized) pending = JSON.parse(serialized);
        targetStorage?.removeItem(PENDING_ACTION_KEY);
      } catch {
        removePendingAction(storage);
      }
      if (redirect?.accessToken && account && pending?.version === 1
        && RESUMABLE_ACTIONS.has(pending.action)
        && pending.accountId === account.homeAccountId
        && Array.isArray(pending.scopes)
        && grantedRequestedScopes(redirect, pending.scopes)) {
        pendingAction = pending.action;
      }
      return account;
    } catch (error) {
      removePendingAction(storage);
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
      msalAccount = result?.account || null;
      account = normalizedAccount(msalAccount);
      return account;
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function getToken(scopes = ["User.Read"]) {
    if (!account || !msalAccount) throw new BrowserAuthError("AUTH_REQUIRED", "Entre novamente com a Microsoft.");
    try {
      const result = await client.acquireTokenSilent({ account: msalAccount, scopes: [...scopes] });
      if (!result?.accessToken) throw { errorCode: "interaction_required" };
      return result.accessToken;
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function authorize(scopes = ["User.Read"], { resumeAction } = {}) {
    if (!account || !msalAccount) throw new BrowserAuthError("AUTH_REQUIRED", "Entre novamente com a Microsoft.");
    const requestedScopes = [...scopes];
    if (RESUMABLE_ACTIONS.has(resumeAction)) {
      try {
        const targetStorage = browserStorage(storage);
        if (!targetStorage) throw new Error("sessionStorage unavailable");
        targetStorage.setItem(PENDING_ACTION_KEY, JSON.stringify({
          version: 1,
          action: resumeAction,
          accountId: account.homeAccountId,
          scopes: requestedScopes,
        }));
      } catch {
        throw new BrowserAuthError("AUTH_FAILED", "Não foi possível preservar a tela de pedidos durante a autorização Microsoft.");
      }
    }
    try {
      await client.acquireTokenRedirect({
        account: msalAccount,
        scopes: requestedScopes,
        redirectUri: config.webRedirectUri,
      });
    } catch (error) {
      removePendingAction(storage);
      throw normalizeError(error);
    }
  }

  async function signOut() {
    const signedInAccount = msalAccount;
    account = null;
    msalAccount = null;
    pendingAction = null;
    removePendingAction(storage);
    await client.logoutRedirect({
      account: signedInAccount,
      postLogoutRedirectUri: config.webRedirectUri,
    });
  }

  return Object.freeze({ initialize, signIn, getToken, authorize, signOut, getAccount: () => account,
    consumePendingAction() { const action = pendingAction; pendingAction = null; return action; },
  });
}

const PENDING_ACTION_KEY = "energetico:msal-pending-action:v1";
const RESUMABLE_ACTIONS = new Set(["action_orders_gallery"]);

function browserStorage(storage) {
  try { return storage || globalThis.sessionStorage || null; }
  catch { return null; }
}

function removePendingAction(storage) {
  try { browserStorage(storage)?.removeItem(PENDING_ACTION_KEY); }
  catch { /* Storage may be unavailable in restricted browser contexts. */ }
}

function grantedRequestedScopes(result, requestedScopes) {
  const granted = new Set((Array.isArray(result?.scopes) ? result.scopes : []).map(scope => String(scope).trim().toLowerCase()));
  return requestedScopes.every(scope => granted.has(String(scope).trim().toLowerCase()));
}
