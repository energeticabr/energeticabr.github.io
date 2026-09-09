import { createRecoveryStorage } from "../web/recovery-storage.js";

export const DEMO_API_ORIGIN = "https://163-176-171-217.sslip.io";
const SESSION_URL = `${DEMO_API_ORIGIN}/api/demo/session`;

// Deliberately independent of MSAL and persistent browser/native storage.
export function createDemoSession({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let session = null;

  async function signIn({ username, password } = {}) {
    if (!String(username || "").trim() || !String(password || "")) {
      throw new Error("Informe o usuário e a senha de demonstração.");
    }
    const response = await fetchImpl(SESSION_URL, {
      method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ username: String(username).trim(), password: String(password) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || "Não foi possível entrar na demonstração.");
    const expiry = Date.parse(result?.expiresAt);
    if (typeof result?.accessToken !== "string" || !result.accessToken
      || typeof result?.account?.homeAccountId !== "string" || !result.account.homeAccountId.startsWith("demo:")
      || !result.account.username || !result.account.name || !Number.isFinite(expiry) || expiry <= now()) {
      throw new Error("A sessão de demonstração recebida é inválida.");
    }
    session = { accessToken: result.accessToken, expiry, account: Object.freeze({
      homeAccountId: result.account.homeAccountId, username: String(result.account.username), name: String(result.account.name),
    }) };
    return session.account;
  }

  async function getToken() {
    if (!session) throw new Error("Entre novamente no acesso de demonstração.");
    if (session.expiry <= now()) throw new Error("A sessão de demonstração expirou. Saia e entre novamente.");
    return session.accessToken;
  }

  async function signOut() {
    const token = session?.accessToken;
    session = null;
    if (!token) return;
    const response = await fetchImpl(SESSION_URL, {
      method: "DELETE", credentials: "omit", cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("A sessão foi encerrada neste aparelho; não foi possível revogá-la no servidor.");
  }

  return Object.freeze({ signIn, getToken, signOut,
    async initialize() { return session && session.expiry > now() ? session.account : null; },
  });
}

// Expose only manually requested native operations. Never forward inbox APIs or
// native resume events, which would import staged production share-extension files.
export function createDemoPorts(native) {
  return Object.freeze({
    capturePhoto: () => native.capturePhoto(),
    pickPhotos: () => typeof native.pickPhotos === "function" ? native.pickPhotos() : native.pickDocuments(),
    pickDocuments: () => native.pickDocuments(),
    exportMedia: (...args) => native.exportMedia(...args),
    async importSharedItems() { return []; },
    async discardSharedItem() {},
  });
}

// Session-local namespace: no localStorage reads and no surviving demo previews.
export function createDemoRecovery() {
  const values = new Map();
  const prefix = "energetico:demo-session:";
  return createRecoveryStorage({ storage: {
    getItem: key => values.get(prefix + key) ?? null,
    setItem: (key, value) => values.set(prefix + key, value),
    removeItem: key => values.delete(prefix + key),
  } });
}
