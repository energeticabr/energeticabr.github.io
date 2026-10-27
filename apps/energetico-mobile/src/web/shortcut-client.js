import { createAcquisitionProgress } from '../chat/acquisition-progress.js';

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("A VM não devolveu uma confirmação válida.");
  }
}

export function createShortcutClient({ apiBaseUrl, tokenProvider, fetchImpl = globalThis.fetch }) {
  const base = new URL(apiBaseUrl);
  const endpoint = new URL("/api/portal-shortcut-token", base).href;
  const expectedUploadUrl = new URL("/api/shortcut-upload", base).href;

  async function request(action, options = {}) {
    const progress = createAcquisitionProgress(options, ['authentication', 'response', 'validated']);
    const microsoftToken = await tokenProvider(["User.Read"]);
    if (!microsoftToken) throw new Error("Entre novamente com a Microsoft.");
    progress.step('authentication');
    const response = await fetchImpl(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${microsoftToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
      ...(action === 'status' && options.signal ? { signal: options.signal } : {}),
    });
    progress.step('response');
    const payload = await parseJson(response);
    if (!response.ok) throw new Error(String(payload?.error || "A VM recusou a configuração do Atalho."));
    if (action === "status") {
      if (!["active", "inactive"].includes(payload?.status)) throw new Error("A VM não devolveu uma confirmação válida.");
      progress.step('validated');
      return Object.freeze({ status: payload.status });
    }
    if (action === "revoke") {
      if (payload?.status !== "revoked") throw new Error("A VM não devolveu uma confirmação válida.");
      return Object.freeze({ status: "revoked" });
    }
    if (payload?.status !== "issued" || !String(payload?.token || "").trim()) {
      throw new Error("A VM não devolveu uma confirmação válida.");
    }
    if (String(payload.uploadUrl || "") !== expectedUploadUrl) {
      throw new Error("A VM não devolveu um endereço seguro para o upload.");
    }
    return Object.freeze({
      status: "issued",
      token: String(payload.token),
      uploadUrl: expectedUploadUrl,
    });
  }

  return Object.freeze({ status: options => request("status", options), issue: () => request("issue"), revoke: () => request("revoke") });
}
