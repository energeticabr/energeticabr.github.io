import { validateAttachment } from "./file-policy.js";

const TOKEN_SCOPES = Object.freeze(["User.Read"]);

function parseBaseUrl(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") {
    throw new TypeError("O Energético requer uma API HTTPS.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

async function acquireToken(tokenProvider) {
  const token = await tokenProvider([...TOKEN_SCOPES]);
  if (!token) throw new Error("A sessão Microsoft precisa ser renovada.");
  return token;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function confirmedResult(result) {
  return Boolean(result && result.status === "processed" && Array.isArray(result.messages));
}

async function parsePortalResponse(response, failurePrefix) {
  const result = await readJson(response);
  if (!response.ok) {
    throw new Error(result?.error || `${failurePrefix} respondeu com erro ${response.status}.`);
  }
  if (!confirmedResult(result)) {
    throw new Error("A VM não devolveu uma confirmação válida.");
  }
  return result;
}

export function createChatClient({
  apiBaseUrl,
  tokenProvider,
  fetchImpl = globalThis.fetch,
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
} = {}) {
  if (typeof tokenProvider !== "function" || typeof fetchImpl !== "function") {
    throw new TypeError("O Energético requer autenticação Microsoft e acesso de rede.");
  }

  const baseUrl = parseBaseUrl(apiBaseUrl);
  const chatUrl = new URL("api/portal-chat", baseUrl);
  const uploadUrl = new URL("api/portal-upload", baseUrl);

  const newMessageId = () => (
    typeof randomUUID === "function"
      ? randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  async function sendText({ text = "", replyId } = {}) {
    const token = await acquireToken(tokenProvider);
    const payload = {
      messageId: newMessageId(),
      text: String(text || "").trim(),
      ...(replyId ? { replyId: String(replyId) } : {}),
    };
    const response = await fetchImpl(chatUrl.href, {
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
    return parsePortalResponse(response, "O canal do Energético");
  }

  async function sendFile(file) {
    const fileName = validateAttachment(file);
    const token = await acquireToken(tokenProvider);
    const response = await fetchImpl(uploadUrl.href, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": String(file.type || "application/octet-stream"),
        "X-Portal-File-Name": encodeURIComponent(fileName),
        "X-Portal-Message-Id": newMessageId(),
      },
      body: file,
      cache: "no-store",
      credentials: "omit",
    });
    return parsePortalResponse(response, "O upload");
  }

  async function fetchMedia(message = {}) {
    let mediaUrl;
    try {
      mediaUrl = new URL(String(message.mediaUrl || ""), baseUrl);
    } catch {
      throw new Error("Endereço de mídia inválido.");
    }
    if (mediaUrl.origin !== baseUrl.origin || !mediaUrl.pathname.startsWith("/api/portal-media/")) {
      throw new Error("Endereço de mídia inválido.");
    }

    const token = await acquireToken(tokenProvider);
    const response = await fetchImpl(mediaUrl.href, {
      headers: {
        Accept: "*/*",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) {
      throw new Error(`Não foi possível carregar o arquivo (${response.status}).`);
    }
    return response.blob();
  }

  return Object.freeze({ sendText, sendFile, fetchMedia });
}
