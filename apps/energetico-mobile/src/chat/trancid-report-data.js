import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient, GraphRequestError } from '../../../../portal/data/graph-client.js';
import { validateTrancidSnapshot } from './trancid-report-model.js';

const site = SHAREPOINT_SITES.personal;
const abortError = () => new DOMException('Consulta Trancid substituída ou cancelada.', 'AbortError');
function checkAbort(signal) { if (signal?.aborted) throw signal.reason || abortError(); }

// Token providers and response parsers may ignore cancellation. Stop waiting and
// consume any late completion without allowing it to advance the old request.
function abortable(operation, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => finish(reject, signal.reason || abortError());
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { checkAbort(signal); return operation(); }).then(value => {
      try { checkAbort(signal); finish(resolve, value); } catch (error) { finish(reject, error); }
    }, error => finish(reject, error));
  });
}

function privateDownloadUrl(value) {
  if (typeof value !== 'string' || !value) throw new TypeError('Arquivo privado Trancid indisponível.');
  let url;
  try { url = new URL(value); } catch { throw new TypeError('URL privada Trancid inválida.'); }
  if (url.protocol !== 'https:' || url.hostname !== site.host || url.port || url.username || url.password
    || url.hash || !url.pathname.startsWith(`${site.path}/`)) throw new TypeError('URL Trancid fora do site SharePoint autorizado.');
  return url.href;
}

/** Read the private Documents library with the current Microsoft session only. */
export function createTrancidReportData({ tokenProvider, fetchImpl = globalThis.fetch } = {}) {
  if (typeof tokenProvider !== 'function') throw new TypeError('Sessão Microsoft ativa obrigatória.');
  if (typeof fetchImpl !== 'function') throw new TypeError('Fetch obrigatório para consultar a Trancid.');
  let active;

  async function loadSnapshot({ signal: externalSignal } = {}) {
    checkAbort(externalSignal);
    active?.abort(abortError());
    const controller = new AbortController(), { signal } = controller;
    active = controller;
    const abort = () => controller.abort(externalSignal.reason || abortError());
    externalSignal?.addEventListener('abort', abort, { once: true });
    let contentTimer;
    try {
      const graph = createGraphClient(async scopes => {
        const token = await abortable(() => tokenProvider(scopes, { signal }), signal);
        if (typeof token !== 'string' || !token.trim()) throw new GraphRequestError({ status: 401,
          code: 'token_unavailable', message: 'Sessão Microsoft indisponível para consultar a Trancid.' });
        return token;
      }, { fetch: (url, options) => {
        // The shared Graph client authenticates only this fixed origin. Never
        // forward its bearer to a file download or to an HTTP redirect.
        const parsed = new URL(url);
        if (parsed.origin !== 'https://graph.microsoft.com' || !parsed.pathname.startsWith('/v1.0/')) {
          throw new TypeError('Consulta autenticada fora do Microsoft Graph.');
        }
        return abortable(() => fetchImpl(url, { ...options, credentials: 'omit', redirect: 'error', cache: 'no-store' }), options.signal);
      } });
      const resolved = await abortable(() => graph.request(`/sites/${site.host}:${site.path}?$select=id`, { signal }), signal);
      if (typeof resolved?.id !== 'string' || !/^[a-z\d._,-]+$/i.test(resolved.id)) throw new TypeError('Site SharePoint Trancid inválido.');
      // Graph drive/root is already the Documents library root.
      const metadata = await abortable(() => graph.request(`/sites/${encodeURIComponent(resolved.id)}/drive/root:/TRANCID/report_snapshot.json`, { signal }), signal);
      if (metadata?.name !== 'report_snapshot.json' || !metadata.file || typeof metadata.file !== 'object'
        || Array.isArray(metadata.file) || metadata.folder || !Number.isSafeInteger(metadata.size) || metadata.size <= 0) {
        throw new TypeError('Metadados do arquivo Trancid inválidos.');
      }
      // This short-lived capability stays inside this load. It is not persisted,
      // returned to the UI, or sent a Microsoft Authorization header.
      const downloadUrl = privateDownloadUrl(metadata['@microsoft.graph.downloadUrl']);
      contentTimer = globalThis.setTimeout(() => controller.abort(new GraphRequestError({
        code: 'request_timeout', message: 'A leitura do arquivo Trancid excedeu o tempo limite.' })), 15_000);
      const response = await abortable(() => fetchImpl(downloadUrl, { method: 'GET', headers: { Accept: 'application/json' },
        signal, credentials: 'omit', redirect: 'error', cache: 'no-store' }), signal);
      if (response.redirected || response.url && privateDownloadUrl(response.url) !== downloadUrl) {
        throw new TypeError('Redirecionamento do arquivo privado Trancid recusado.');
      }
      if (!response.ok) throw new GraphRequestError({ status: response.status, code: 'snapshot_download_failed',
        message: 'Não foi possível ler o arquivo privado Trancid.' });
      let payload;
      try { payload = await abortable(() => response.json(), signal); }
      catch (error) { checkAbort(signal); throw new TypeError('O arquivo Trancid não contém JSON válido.', { cause: error }); }
      const result = validateTrancidSnapshot(payload);
      checkAbort(signal);
      if (active !== controller) throw abortError();
      return result;
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      globalThis.clearTimeout(contentTimer);
      externalSignal?.removeEventListener('abort', abort);
      if (active === controller) active = undefined;
    }
  }

  return Object.freeze({ loadSnapshot });
}
