// XMLHttpRequest exposes bytes actually sent by the browser/WebView. Keep
// this adapter scoped to uploads; authentication and retry policy stay in
// chat-client, and a sent body is not yet a confirmed server receipt.
export function uploadWithProgress(url, options, { xhrFactory, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory(), signal = options.signal;
    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      xhr.upload.onprogress = xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
      error ? reject(error) : resolve(response);
    };
    const cancel = () => {
      finish(new DOMException('Envio cancelado.', 'AbortError'));
      xhr.abort();
    };
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      xhr.open(options.method, url, true);
      xhr.withCredentials = false;
      for (const [name, value] of Object.entries(options.headers)) xhr.setRequestHeader(name, value);
      let percent = 0;
      onProgress(0);
      if (settled || signal?.aborted) return;
      xhr.upload.onprogress = event => {
        if (settled || signal?.aborted || !event.lengthComputable
            || !Number.isFinite(event.loaded) || !Number.isFinite(event.total)
            || event.total <= 0 || event.loaded < 0 || event.loaded > event.total) return;
        const next = Math.min(99, Math.floor(event.loaded / event.total * 100));
        if (next > percent) { percent = next; onProgress(percent); }
      };
      xhr.onload = () => finish(null, {
        ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status,
        json: async () => JSON.parse(xhr.responseText),
      });
      xhr.onerror = xhr.ontimeout = () => finish(new TypeError('A conexão do envio foi interrompida.'));
      xhr.onabort = () => finish(new DOMException('Envio cancelado.', 'AbortError'));
      xhr.send(options.body);
    } catch (error) { finish(error); }
  });
}
