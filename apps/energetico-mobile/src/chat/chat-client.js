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

function confirmedResult(result, { allowRecovery = false } = {}) {
  const acceptedStatuses = allowRecovery
    ? new Set(["processed", "processed_with_recovery"])
    : new Set(["processed"]);
  return Boolean(
    result
      && acceptedStatuses.has(result.status)
      && Array.isArray(result.messages),
  );
}

async function parsePortalResponse(response, failurePrefix, options = {}) {
  const result = await readJson(response);
  if (!response.ok) {
    const message = result?.error || `${failurePrefix} respondeu com erro ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    // A body that was interrupted while it was being streamed is safe to
    // resend. The server keys uploads by X-Portal-Message-Id, so the retry
    // cannot create a second attachment when the first request reached it.
    error.transient = response.status === 422 && /incompleto|não confirmou|temporariamente/i.test(String(message));
    throw error;
  }
  if (!confirmedResult(result, options)) {
    throw new Error("A VM não devolveu uma confirmação válida.");
  }
  return result;
}

export function createChatClient({
  apiBaseUrl,
  apiPrefix = "/api",
  tokenProvider,
  fetchImpl = globalThis.fetch,
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
  retryDelay = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (typeof tokenProvider !== "function" || typeof fetchImpl !== "function") {
    throw new TypeError("O Energético requer autenticação Microsoft e acesso de rede.");
  }

  const baseUrl = parseBaseUrl(apiBaseUrl);
  if (!["/api", "/api/demo"].includes(apiPrefix)) throw new TypeError("Prefixo de API inválido.");
  const chatUrl = new URL(`${apiPrefix}/portal-chat`, baseUrl);
  const uploadUrl = new URL(`${apiPrefix}/portal-upload`, baseUrl);

  async function request(url, options, read, readOnly = false, { retryTransient = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await read(await fetchImpl(url, apiPrefix === "/api/demo" ? { ...options, redirect: "error" } : options));
        if (apiPrefix === "/api/demo" && result?.status === "processed") {
          // Server preview URLs must not become direct <img> network requests.
          // The controller builds local previews from validated fetchMedia blobs.
          const withoutPreview = item => {
            if (!item || typeof item !== "object") return item;
            const { previewUrl, ...safe } = item;
            return safe;
          };
          return { ...result,
            ...(Array.isArray(result.messages) ? { messages: result.messages.map(withoutPreview) } : {}),
            ...(Array.isArray(result.attachments) ? { attachments: result.attachments.map(withoutPreview) } : {}),
          };
        }
        return result;
      } catch (error) {
        const networkFailure = error instanceof TypeError || ["NetworkError", "AbortError"].includes(error?.name);
        const transientHttpFailure = retryTransient && (
          error?.transient === true
          || [408, 425, 429, 500, 502, 503, 504].includes(Number(error?.status))
        );
        if (!networkFailure && !transientHttpFailure) throw error;
        if (retryTransient && (networkFailure || transientHttpFailure)
          && attempt < 2 && globalThis.navigator?.onLine !== false) {
          await retryDelay((attempt + 1) * 750);
          continue;
        }
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
    }, response => parsePortalResponse(response, "O canal do Energético", { allowRecovery: true }));
  }

  async function sendFile(file) {
    const fileName = validateAttachment(file);
    const token = await acquireToken(tokenProvider);
    // Keep the native inbox identifier across retries, without accepting arbitrary headers.
    const sourceId = typeof file.sourceId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(file.sourceId)
      ? file.sourceId : newMessageId();
    return request(uploadUrl.href, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": String(file.type || "application/octet-stream"),
        "X-Portal-File-Name": encodeURIComponent(fileName),
        "X-Portal-Message-Id": sourceId,
      },
      body: file,
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "O upload"), false, { retryTransient: true });
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

  async function deleteAttachment(attachmentId) {
    const id = String(attachmentId || "").trim();
    if (!id) throw new Error("O anexo a excluir não foi identificado.");
    const token = await acquireToken(tokenProvider);
    return request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "attachment_delete", attachmentId: id }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "A exclusão do anexo"));
  }

  async function attachmentAction(action, payload, failurePrefix) {
    const token = await acquireToken(tokenProvider);
    return request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, failurePrefix));
  }

  async function deleteAllAttachments() {
    return attachmentAction("attachment_delete_all", {}, "A exclusão dos anexos");
  }

  async function compressAttachment(attachmentId) {
    const id = String(attachmentId || "").trim();
    if (!id) throw new Error("O anexo a compactar não foi identificado.");
    return attachmentAction("attachment_compress", { attachmentId: id }, "A compactação do anexo");
  }

  async function chooseAttachmentCompression(choice) {
    const value = String(choice || "").trim();
    if (!value) throw new Error("A versão do anexo não foi escolhida.");
    return attachmentAction("attachment_compression_choice", { choice: value }, "A escolha da versão compactada");
  }

  async function getCompletionMenu(completionId) {
    const id = String(completionId || "").trim();
    if (!id) throw new Error("A conclusão do fluxo não foi identificada.");
    const token = await acquireToken(tokenProvider);
    return request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "completion_menu", completionId: id }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "A consulta do menu"), true);
  }

  async function fetchMedia(message = {}) {
    let mediaUrl;
    try {
      mediaUrl = new URL(String(message.mediaUrl || ""), baseUrl);
    } catch {
      throw new Error("Endereço de mídia inválido.");
    }
    if (mediaUrl.origin !== baseUrl.origin || !mediaUrl.pathname.startsWith(`${apiPrefix}/portal-media/`)) {
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

  return Object.freeze({ sendText, sendFile, fetchMedia, getAttachments, deleteAttachment, deleteAllAttachments, compressAttachment, chooseAttachmentCompression, getCompletionMenu });
}
