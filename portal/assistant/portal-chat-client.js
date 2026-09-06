export function createPortalChatClient(config = {}) {
  const endpoint = String(config.endpoint || "").trim();
  const tokenProvider = config.tokenProvider;
  const fetchRequest = config.fetch || globalThis.fetch;
  const randomUUID = config.randomUUID || globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (!/^https:\/\//i.test(endpoint)) throw new TypeError("O canal do Energético requer um endpoint HTTPS.");
  if (typeof tokenProvider !== "function" || typeof fetchRequest !== "function") {
    throw new TypeError("O canal do Energético requer autenticação Microsoft e acesso de rede.");
  }
  const endpointUrl = new URL(endpoint);
  const uploadEndpoint = new URL(config.uploadEndpoint || "/api/portal-upload", endpointUrl);
  if (uploadEndpoint.protocol !== "https:" || uploadEndpoint.origin !== endpointUrl.origin) {
    throw new TypeError("O upload do Energético precisa usar a mesma origem HTTPS do chat.");
  }
  const maxUploadBytes = Number(config.maxUploadBytes || 60_000_000);
  const blockedExtensions = new Set([
    "apk", "bat", "cmd", "com", "cpl", "dll", "dmg", "exe", "hta", "jar", "js",
    "lnk", "msi", "pkg", "pl", "ps1", "py", "pyw", "rb", "reg", "scr", "sh",
    "vbe", "vbs", "wsf", "wsh",
  ]);
  const blockedMimeTypes = new Set([
    "application/x-dosexec", "application/x-executable", "application/x-msdownload",
    "application/x-msdos-program", "application/x-sh", "text/x-python", "text/x-shellscript",
  ]);

  function validateFile(file) {
    if (!file || typeof file.size !== "number" || file.size <= 0) {
      throw new Error("O arquivo selecionado está vazio.");
    }
    if (file.size > maxUploadBytes) {
      throw new Error("O arquivo ultrapassa o limite de 60 MB.");
    }
    const fileName = String(file.name || "arquivo").trim();
    const extension = fileName.includes(".") ? fileName.split(".").at(-1).toLowerCase() : "";
    if (blockedExtensions.has(extension)) {
      throw new Error("Tipo de arquivo não permitido.");
    }
    if (blockedMimeTypes.has(String(file.type || "").toLowerCase())) {
      throw new Error("Tipo de arquivo não permitido.");
    }
    return fileName;
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

  async function fetchMedia(message = {}) {
    const mediaUrl = new URL(String(message.mediaUrl || ""), endpointUrl);
    if (mediaUrl.origin !== endpointUrl.origin || !mediaUrl.pathname.startsWith("/api/portal-media/")) {
      throw new Error("Endereço de mídia inválido.");
    }
    const token = await tokenProvider(["User.Read"]);
    if (!token) throw new Error("A sessão Microsoft precisa ser renovada.");
    const response = await fetchRequest(mediaUrl.href, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) throw new Error(`Não foi possível carregar o resumo (${response.status}).`);
    return response.blob();
  }

  async function sendFile(file) {
    const fileName = validateFile(file);
    const token = await tokenProvider(["User.Read"]);
    if (!token) throw new Error("A sessão Microsoft precisa ser renovada.");
    const messageId = typeof randomUUID === "function" ? randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const response = await fetchRequest(uploadEndpoint.href, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": String(file.type || "application/octet-stream"),
        "X-Portal-File-Name": encodeURIComponent(fileName),
        "X-Portal-Message-Id": messageId,
      },
      body: file,
      cache: "no-store",
      credentials: "omit",
    });
    let result;
    try {
      result = await response.json();
    } catch {
      if (response.ok) throw new Error("A VM não devolveu uma confirmação válida para o arquivo.");
      result = undefined;
    }
    if (!response.ok) throw new Error(result?.error || `O upload respondeu com erro ${response.status}.`);
    if (!result || result.status !== "processed" || !Array.isArray(result.messages)) {
      throw new Error("A VM não devolveu uma confirmação válida para o arquivo.");
    }
    return result;
  }

  return Object.freeze({ send, sendFile, fetchMedia });
}
