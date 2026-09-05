export function createPortalChatClient(config = {}) {
  const endpoint = String(config.endpoint || "").trim();
  const tokenProvider = config.tokenProvider;
  const fetchRequest = config.fetch || globalThis.fetch;
  const randomUUID = config.randomUUID || globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (!/^https:\/\//i.test(endpoint)) throw new TypeError("O canal do Energético requer um endpoint HTTPS.");
  if (typeof tokenProvider !== "function" || typeof fetchRequest !== "function") {
    throw new TypeError("O canal do Energético requer autenticação Microsoft e acesso de rede.");
  }

  async function send({ text = "", replyId } = {}) {
    const token = await tokenProvider(["User.Read"]);
    if (!token) throw new Error("A sessão Microsoft precisa ser renovada.");
    const payload = {
      messageId: typeof randomUUID === "function" ? randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text: String(text || "").trim(),
      ...(replyId ? { replyId: String(replyId) } : {}),
    };
    const response = await fetchRequest(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "omit",
    });
    let result;
    try {
      result = await response.json();
    } catch {
      result = undefined;
    }
    if (!response.ok) throw new Error(result?.error || `O canal do Energético respondeu com erro ${response.status}.`);
    return result || { status: "processed", messages: [] };
  }

  return Object.freeze({ send });
}

