const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

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

function readAttachmentResponse(response) {
  if (response.status === 204) return Promise.resolve(undefined);
  return response.json().catch(() => undefined);
}

function safeFileName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 128 || /[\\/\u0000-\u001f]/.test(name) || name === "." || name === "..") return undefined;
  return name;
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
  const allowedTypes = rules.allowedTypes || ALLOWED_TYPES;
  const name = safeFileName(file?.name);
  if (!name) return Object.freeze({ valid: false, message: "O nome do arquivo não é permitido." });
  if (!Number.isFinite(file?.size) || file.size <= 0 || file.size > maxBytes) {
    return Object.freeze({ valid: false, message: "O tamanho do arquivo não é permitido." });
  }
  if (!allowedTypes.has(String(file?.type || "").toLowerCase())) {
    return Object.freeze({ valid: false, message: "O tipo deste arquivo não é permitido." });
  }
  if (typeof file.arrayBuffer !== "function") {
    return Object.freeze({ valid: false, message: "O arquivo selecionado não pode ser lido." });
  }
  return Object.freeze({ valid: true, name });
}

export function createAttachmentActions({ repository, entity, access, can, listId, itemId, rules } = {}) {
  if (!repository) throw new TypeError("Os anexos requerem um repositório SharePoint.");
  const state = { message: "", error: "" };
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
      state.error = `${error?.message || "Não foi possível consultar os anexos."} Tente novamente.`;
      state.message = "";
      throw error;
    }
  }

  async function uploadAttachment(file) {
    assertWritable();
    const validation = validateAttachment(file, rules);
    if (!validation.valid) {
      state.error = validation.message;
      state.message = "";
      throw new AttachmentRequestError({ status: 400, code: "invalid_attachment", message: validation.message });
    }
    assertWritable();
    try {
      const result = await repository.uploadAttachment(entity.siteKey, listId, itemId, file, validation.name);
      state.error = "";
      state.message = "Anexo enviado para o registro atual.";
      return result;
    } catch (error) {
      state.error = `${error?.message || "Não foi possível enviar o anexo."} Tente novamente.`;
      state.message = "";
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
      return result;
    } catch (error) {
      state.error = `${error?.message || "Não foi possível excluir o anexo."} Tente novamente.`;
      state.message = "";
      throw error;
    }
  }

  return Object.freeze({
    canEdit: () => attachmentAuthorization(entity, access, can),
    canView: () => attachmentReadAuthorization(entity, access, can),
    listAttachments,
    uploadAttachment,
    deleteAttachment,
    getState: () => Object.freeze({ ...state }),
  });
}

export function createSharePointAttachmentTransport({ tokenProvider, fetch = globalThis.fetch } = {}) {
  if (typeof tokenProvider !== "function" || typeof fetch !== "function") {
    throw new TypeError("O transporte de anexos requer token Microsoft e fetch.");
  }

  return Object.freeze({
    async request(site, path, options = {}) {
      const host = String(site?.host || "").toLowerCase();
      if (!/^[a-z0-9.-]+\.sharepoint\.com$/.test(host) || !String(path || "").startsWith("/_api/")) {
        throw new AttachmentRequestError({ status: 400, code: "invalid_attachment_target", message: "O destino SharePoint do anexo é inválido." });
      }
      const token = await tokenProvider([`https://${host}/.default`]);
      if (!token) throw new AttachmentRequestError({ status: 401, code: "token_unavailable", message: "Não foi possível obter autorização Microsoft para anexos." });
      const response = await fetch(`https://${host}${path}`, {
        method: options.method || "GET",
        headers: { Accept: "application/json;odata=nometadata", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
        body: options.body,
        signal: options.signal,
      });
      const payload = await readAttachmentResponse(response);
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

export { MAX_ATTACHMENT_BYTES, ALLOWED_TYPES };
