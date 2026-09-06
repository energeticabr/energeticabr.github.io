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

  async function request(action) {
    const microsoftToken = await tokenProvider(["User.Read"]);
    if (!microsoftToken) throw new Error("Entre novamente com a Microsoft.");
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
    });
    const payload = await parseJson(response);
    if (!response.ok) throw new Error(String(payload?.error || "A VM recusou a configuração do Atalho."));
    if (action === "status") {
      if (!["active", "inactive"].includes(payload?.status)) throw new Error("A VM não devolveu uma confirmação válida.");
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

  return Object.freeze({ status: () => request("status"), issue: () => request("issue"), revoke: () => request("revoke") });
}
