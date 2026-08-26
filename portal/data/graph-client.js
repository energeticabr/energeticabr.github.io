const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const DEFAULT_SCOPES = Object.freeze(["Sites.ReadWrite.All"]);

export class GraphRequestError extends Error {
  constructor({ status = 0, code = "graph_request_failed", message = "Falha ao consultar o Microsoft Graph.", retryAfter } = {}) {
    super(message);
    this.name = "GraphRequestError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function graphUrl(path) {
  const value = String(path);
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    const url = new URL(value);
    const isGraphV1 = url.protocol === "https:"
      && url.hostname === "graph.microsoft.com"
      && !url.port
      && !url.username
      && !url.password
      && url.pathname.startsWith("/v1.0/");
    if (!isGraphV1) {
      throw new TypeError("O caminho absoluto deve permanecer no Microsoft Graph v1.0.");
    }
    return url.toString();
  }
  return `${GRAPH_ROOT}${value.startsWith("/") ? value : `/${value}`}`;
}

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
}

async function readJson(response) {
  if (response.status === 204 || response.status === 202) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function toGraphError(response, payload) {
  const graphError = payload?.error || {};
  return new GraphRequestError({
    status: response.status,
    code: graphError.code || `http_${response.status}`,
    message: graphError.message || response.statusText || `A requisicao Microsoft Graph falhou (${response.status}).`,
    retryAfter: parseRetryAfter(response.headers?.get?.("retry-after")),
  });
}

function normalizeRequest(options) {
  const method = options.method || "GET";
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  let body = options.body;
  if (body !== undefined && body !== null && typeof body !== "string") {
    headers["Content-Type"] ||= "application/json";
    body = JSON.stringify(body);
  }
  return { method, headers, body };
}

function wait(milliseconds) {
  return new Promise(resolve => globalThis.setTimeout(resolve, milliseconds));
}

export function createGraphClient(tokenProvider, environment = {}) {
  const fetchRequest = environment.fetch || globalThis.fetch;
  const sleep = environment.sleep || wait;
  const timeoutMs = environment.timeoutMs || 15000;

  if (typeof tokenProvider !== "function") {
    throw new TypeError("O provedor de token Microsoft Graph deve ser uma funcao.");
  }
  if (typeof fetchRequest !== "function") {
    throw new TypeError("Fetch nao esta disponivel para o cliente Microsoft Graph.");
  }

  async function request(path, options = {}) {
    const url = graphUrl(path);
    const scopes = options.scopes || DEFAULT_SCOPES;
    const token = await tokenProvider(scopes);
    if (!token) {
      throw new GraphRequestError({
        status: 401,
        code: "token_unavailable",
        message: "Nao foi possivel obter um token Microsoft Graph para o usuario conectado.",
      });
    }

    const { method, headers, body } = normalizeRequest(options);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
      let removeAbortListener;

      if (options.signal) {
        const abort = () => controller.abort(options.signal.reason);
        if (options.signal.aborted) abort();
        else {
          options.signal.addEventListener("abort", abort, { once: true });
          removeAbortListener = () => options.signal.removeEventListener("abort", abort);
        }
      }

      try {
        const response = await fetchRequest(url, {
          method,
          headers: { ...headers, Authorization: `Bearer ${token}` },
          body,
          signal: controller.signal,
        });
        const payload = await readJson(response);
        if (response.ok) return payload;

        const error = toGraphError(response, payload);
        if (error.status === 429 && attempt === 0) {
          await sleep((error.retryAfter || 0) * 1000);
          continue;
        }
        throw error;
      } catch (error) {
        if (error instanceof GraphRequestError) throw error;
        throw new GraphRequestError({
          code: controller.signal.aborted ? "request_timeout" : "network_error",
          message: controller.signal.aborted
            ? "A requisicao Microsoft Graph excedeu o tempo limite."
            : error?.message || "Falha de rede ao consultar o Microsoft Graph.",
        });
      } finally {
        globalThis.clearTimeout(timeout);
        removeAbortListener?.();
      }
    }
  }

  return Object.freeze({ request });
}
