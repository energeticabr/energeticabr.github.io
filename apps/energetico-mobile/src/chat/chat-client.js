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
  } catch (error) {
    if (error?.name !== "SyntaxError") throw error;
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
  retryDelay = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (typeof tokenProvider !== "function" || typeof fetchImpl !== "function") {
    throw new TypeError("O Energético requer autenticação Microsoft e acesso de rede.");
  }

  const baseUrl = parseBaseUrl(apiBaseUrl);
  const chatUrl = new URL("api/portal-chat", baseUrl);
  const uploadUrl = new URL("api/portal-upload", baseUrl);

  async function request(url, options, read, readOnly = false) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await read(await fetchImpl(url, options));
      } catch (error) {
        const networkFailure = error instanceof TypeError || ["NetworkError", "AbortError"].includes(error?.name);
        if (!networkFailure) throw error;
        if (readOnly && attempt === 0 && globalThis.navigator?.onLine !== false) {
          await retryDelay(300);
          continue;
        }
        const translated = new Error(readOnly
          ? "A conexão foi interrompida. Verifique a internet e tente abrir novamente."
          : "A conexão foi interrompida antes da confirmação. Sua resposta pode ter chegado à VM. Use Retomar conversa antes de enviar novamente.");
        translated.code = readOnly ? "NETWORK_UNAVAILABLE" : "NETWORK_UNCERTAIN";
        throw translated;
      }
    }
  }

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
    return request(chatUrl.href, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "O canal do Energético"));
  }

  async function sendFile(file) {
    const fileName = validateAttachment(file);
    const token = await acquireToken(tokenProvider);
    return request(uploadUrl.href, {
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
    }, response => parsePortalResponse(response, "O upload"));
  }

  async function getAttachments() {
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "attachment_snapshot" }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "A consulta de anexos"), true);
    if (!Array.isArray(result.attachments)) throw new Error("A VM não devolveu a lista de anexos.");
    return result.attachments;
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
    return request(mediaUrl.href, {
      headers: {
        Accept: "*/*",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      credentials: "omit",
    }, response => {
      if (!response.ok) {
        const error = new Error(`Não foi possível carregar o arquivo (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      return response.blob();
    }, true);
  }

  return Object.freeze({ sendText, sendFile, fetchMedia, getAttachments });
}
