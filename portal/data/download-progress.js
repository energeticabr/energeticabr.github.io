/** Read a binary response without timers or guessed byte counts. */
export async function readDownloadBlob(response, { onProgress, signal, maxBytes, tooLarge = () => new Error('O arquivo excede o limite permitido.') } = {}) {
  const check = () => { if (signal?.aborted) throw new DOMException('Download cancelado.', 'AbortError'); };
  check();
  if (typeof onProgress !== 'function' && maxBytes === undefined) return response.blob();
  const length = response.headers?.get?.('Content-Length');
  const encoding = response.headers?.get?.('Content-Encoding');
  // Fetch yields decoded bytes; an encoded Content-Length is not their total.
  // CORS may hide Content-Encoding while exposing compressed Content-Length.
  // Its absent encoding is not evidence that streamed bytes are identity.
  const declared = encoding ? encoding.toLowerCase() === 'identity' : response.type !== 'cors';
  const total = declared && /^\d+$/.test(length || '') && Number.isSafeInteger(Number(length)) && Number(length) > 0 ? Number(length) : null;
  const emit = (loaded, complete = false) => {
    check();
    try { onProgress?.({ loaded, total, percent: complete ? 100 : total === null ? null : Math.min(99, Math.floor(loaded * 100 / total)) }); } catch (error) {
      if (signal?.aborted) throw error;
      // Progress rendering must never alter the original download.
    }
  };
  const validate = size => {
    check();
    if (maxBytes !== undefined && size > maxBytes) throw tooLarge();
  };
  if (maxBytes !== undefined && total > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw tooLarge();
  }
  emit(0);
  if (!response.body?.getReader) {
    const blob = await response.blob();
    validate(blob.size);
    if (total !== null && blob.size !== total) throw new TypeError('O download do arquivo está incompleto.');
    emit(blob.size, true);
    return blob;
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      check();
      const { done, value } = await reader.read();
      check();
      if (done) break;
      size += value.byteLength;
      validate(size);
      chunks.push(value);
      emit(size);
    }
    if (total !== null && size !== total) throw new TypeError('O download do arquivo está incompleto.');
    const blob = new Blob(chunks, { type: response.headers?.get?.('Content-Type') || '' });
    emit(size, true);
    return blob;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
