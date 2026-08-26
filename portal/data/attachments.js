const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Map([
  ["pdf", new Set(["application/pdf"])],
  ["jpg", new Set(["image/jpeg"])],
  ["jpeg", new Set(["image/jpeg"])],
  ["png", new Set(["image/png"])],
  ["webp", new Set(["image/webp"])],
  ["doc", new Set(["application/msword"])],
  ["docx", new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"])],
  ["xls", new Set(["application/vnd.ms-excel"])],
  ["xlsx", new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"])],
]);
const ALLOWED_TYPES = new Set([...ALLOWED_FILE_TYPES.values()].flatMap(types => [...types]));

export class AttachmentRequestError extends Error {
  constructor({ status = 0, code = "attachment_request_failed", message = "Não foi possível acessar os anexos do SharePoint." } = {}) {
    super(message);
    this.name = "AttachmentRequestError";
    this.status = status;
    this.code = code;
  }
}

function isForbidden(error) {
  return error?.status === 401 || error?.status === 403 || ["accessDenied", "forbidden", "token_unavailable"].includes(error?.code);
}

async function readAttachmentResponse(response, responseType) {
  if (response.status === 204) return Promise.resolve(undefined);
  if (responseType === "arrayBuffer") return response.arrayBuffer();
  if (responseType === "blob") return response.blob();
  return response.json().catch(() => undefined);
}

function safeFileName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 128 || /[\\/\u0000-\u001f]/.test(name) || name === "." || name === "..") return undefined;
  return name;
}

function extensionOf(name) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/i);
  return match?.[1];
}

function genericAttachmentFailure(operation) {
  return `Não foi possível ${operation}. Verifique sua conexão e tente novamente.`;
}

function attachmentAuthorization(entity, access, can) {
  return entity?.capabilities?.edit === true && can?.(access, entity.moduleId, "edit") === true;
}

function attachmentReadAuthorization(entity, access, can) {
  return entity?.capabilities?.view === true && can?.(access, entity.moduleId, "view") === true;
}

export function classifyEntityAvailability(source) {
  if (source?.status === "resolved" || source?.status === "available") return "available";
  if (source?.status === "missing") return "missing";
  if (source?.status === "forbidden" || isForbidden(source?.error || source)) return "forbidden";
  return "error";
}

export function validateAttachment(file, rules = {}) {
  rules ||= {};
  const maxBytes = Number.isFinite(rules.maxBytes) ? rules.maxBytes : MAX_ATTACHMENT_BYTES;
  const name = safeFileName(file?.name);
  if (!name) return Object.freeze({ valid: false, message: "O nome do arquivo não é permitido." });
  if (!Number.isFinite(file?.size) || file.size <= 0 || file.size > maxBytes) {
    return Object.freeze({ valid: false, message: "O tamanho do arquivo não é permitido." });
  }
  const extension = extensionOf(name);
  const allowedTypes = rules.allowedPairs?.[extension] || ALLOWED_FILE_TYPES.get(extension);
  const type = String(file?.type || "").split(";", 1)[0].toLowerCase();
  if (!allowedTypes || (type && !allowedTypes.has(type))) {
    return Object.freeze({ valid: false, message: "O tipo deste arquivo não é permitido." });
  }
  if (typeof file.arrayBuffer !== "function") {
    return Object.freeze({ valid: false, message: "O arquivo selecionado não pode ser lido." });
  }
  return Object.freeze({ valid: true, name });
}

export function createAttachmentActions({ repository, entity, access, can, listId, itemId, rules, isSuperAdmin = false } = {}) {
  if (!repository) throw new TypeError("Os anexos requerem um repositório SharePoint.");
  const state = { message: "", error: "", diagnostic: "", status: undefined, code: "" };
  const recordFailure = (operation, error) => {
    state.message = "";
    state.error = genericAttachmentFailure(operation);
    state.diagnostic = error?.message || "";
    state.status = error?.status;
    state.code = error?.code || "attachment_request_failed";
  };
  const assertWritable = () => {
    if (!attachmentAuthorization(entity, access, can)) {
      throw new AttachmentRequestError({ status: 403, code: "attachment_forbidden", message: "Você não tem permissão para alterar anexos deste registro." });
    }
  };
  const assertReadable = () => {
    if (!attachmentReadAuthorization(entity, access, can)) {
      throw new AttachmentRequestError({ status: 403, code: "attachment_forbidden", message: "Você não tem permissão para consultar anexos deste registro." });
    }
  };

  async function listAttachments() {
    assertReadable();
    try {
      return await repository.listAttachments(entity.siteKey, listId, itemId);
    } catch (error) {
      recordFailure("consultar os anexos", error);
      throw error;
    }
  }

  async function uploadAttachment(file) {
    assertWritable();
    const validation = validateAttachment(file, rules);
    if (!validation.valid) {
      state.error = validation.message;
      state.message = "";
      state.diagnostic = "";
      throw new AttachmentRequestError({ status: 400, code: "invalid_attachment", message: validation.message });
    }
    assertWritable();
    try {
      const result = await repository.uploadAttachment(entity.siteKey, listId, itemId, file, validation.name);
      state.error = "";
      state.message = "Anexo enviado para o registro atual.";
      state.diagnostic = "";
      return result;
    } catch (error) {
      recordFailure("enviar o anexo", error);
      throw error;
    }
  }

  async function deleteAttachment(fileName) {
    assertWritable();
    const name = safeFileName(fileName);
    if (!name) {
      throw new AttachmentRequestError({ status: 400, code: "invalid_attachment_name", message: "O nome do arquivo não é permitido." });
    }
    assertWritable();
    try {
      const result = await repository.deleteAttachment(entity.siteKey, listId, itemId, name);
      state.error = "";
      state.message = "Anexo excluído do registro atual.";
      state.diagnostic = "";
      return result;
    } catch (error) {
      recordFailure("excluir o anexo", error);
      throw error;
    }
  }

  async function downloadAttachment(fileName) {
    assertReadable();
    const name = safeFileName(fileName);
    if (!name) throw new AttachmentRequestError({ status: 400, code: "invalid_attachment_name", message: "O nome do arquivo não é permitido." });
    assertReadable();
    try {
      const result = await repository.downloadAttachment(entity.siteKey, listId, itemId, name);
      state.error = "";
      state.message = "Anexo preparado para abertura.";
      state.diagnostic = "";
      return result;
    } catch (error) {
      recordFailure("abrir o anexo", error);
      throw error;
    }
  }

  return Object.freeze({
    canEdit: () => attachmentAuthorization(entity, access, can),
    canView: () => attachmentReadAuthorization(entity, access, can),
    listAttachments,
    uploadAttachment,
    deleteAttachment,
    downloadAttachment,
    getState: () => Object.freeze({ ...state, diagnostic: isSuperAdmin ? state.diagnostic : "" }),
  });
}

function normalizeSitePath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path === "/" || path.endsWith("/") || path.includes("\\") || path.includes("..") || /[?#]/.test(path)) {
    return undefined;
  }
  return path;
}

function allowedSiteKey(site) {
  const host = String(site?.host || "").trim().toLowerCase();
  const path = normalizeSitePath(site?.path);
  return host && path ? `${host}${path}` : undefined;
}

function rawPath(value) {
  const raw = String(value || "");
  if (/^[a-z][a-z\d+.-]*:/i.test(raw)) {
    const schemeEnd = raw.indexOf("://");
    if (schemeEnd < 0) return "";
    const pathStart = raw.indexOf("/", schemeEnd + 3);
    return pathStart < 0 ? "/" : raw.slice(pathStart).split(/[?#]/, 1)[0];
  }
  return raw.split(/[?#]/, 1)[0];
}

function hasUnsafePathEncoding(value) {
  let candidate = rawPath(value);
  for (let depth = 0; depth < 3; depth += 1) {
    if (/%(?:2e|2f|5c)/i.test(candidate) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(candidate) || /[\\．｡。／＼]/u.test(candidate)) return true;
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return false;
      candidate = decoded;
    } catch {
      return true;
    }
  }
  return /%(?:2e|2f|5c)/i.test(candidate) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(candidate);
}

function canonicalRestTarget(site, path) {
  const host = String(site?.host || "").trim().toLowerCase();
  const sitePath = normalizeSitePath(site?.path);
  const raw = String(path || "").trim();
  if (!sitePath || !raw || host.includes(":") || hasUnsafePathEncoding(raw)) return undefined;

  const origin = `https://${host}`;
  let url;
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(raw)) url = new URL(raw);
    else {
      if (!raw.startsWith("/_api/")) return undefined;
      url = new URL(`${sitePath}${raw}`, origin);
    }
  } catch {
    return undefined;
  }

  const apiRoot = `${sitePath}/_api/`;
  if (url.origin !== origin || url.protocol !== "https:" || url.username || url.password || url.port || !url.pathname.startsWith(apiRoot)) return undefined;
  return url.toString();
}

export function createSharePointRestTransport({ tokenProvider, allowedSites, fetch = globalThis.fetch } = {}) {
  if (typeof tokenProvider !== "function" || typeof fetch !== "function") {
    throw new TypeError("O transporte SharePoint REST requer token Microsoft e fetch.");
  }
  const targets = new Set((allowedSites || []).map(allowedSiteKey).filter(Boolean));
  if (!targets.size) throw new TypeError("O transporte SharePoint REST requer sites permitidos com host e caminho.");

  return Object.freeze({
    async request(site, path, options = {}) {
      const host = String(site?.host || "").toLowerCase();
      const sitePath = normalizeSitePath(site?.path);
      const target = canonicalRestTarget(site, path);
      if (!sitePath || !targets.has(`${host}${sitePath}`) || !target) {
        throw new AttachmentRequestError({ status: 400, code: "invalid_attachment_target", message: "O destino SharePoint do anexo é inválido." });
      }
      const token = await tokenProvider([`https://${host}/.default`]);
      if (!token) throw new AttachmentRequestError({ status: 401, code: "token_unavailable", message: "Não foi possível obter autorização Microsoft para anexos." });
      const response = await fetch(target, {
        method: options.method || "GET",
        headers: { Accept: "application/json;odata=nometadata", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
        body: options.body,
        signal: options.signal,
      });
      const payload = await readAttachmentResponse(response, options.responseType);
      if (!response.ok) {
        throw new AttachmentRequestError({
          status: response.status,
          code: payload?.error?.code || `http_${response.status}`,
          message: payload?.error?.message?.value || payload?.error?.message || response.statusText || "O SharePoint recusou a operação de anexo.",
        });
      }
      return payload;
    },
  });
}

export const createSharePointAttachmentTransport = createSharePointRestTransport;

export { MAX_ATTACHMENT_BYTES, ALLOWED_TYPES };
