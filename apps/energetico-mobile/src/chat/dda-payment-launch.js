import { validateAttachment } from './file-policy.js';

/** Match public-ID renewals with the same unambiguous metadata rule as submit verification. */
export function reconcileDdaLaunchAttachments(previous, received = []) {
  const remote = [...new Map((Array.isArray(received) ? received : [])
    .filter(item => item?.id && item?.mediaUrl).map(item => [String(item.id), item])).values()];
  const remoteIds = new Set(remote.map(item => String(item.id)));
  const previousIds = new Set(previous.map(item => String(item.id)));
  const used = new Set(remote.filter(item => previousIds.has(String(item.id))).map(item => String(item.id)));
  const unmatched = previous.filter(item => !remoteIds.has(String(item.id)));
  const sameFile = (left, right) => Boolean(left?.fileName)
    && left.fileName === right.fileName && left.mimeType === right.mimeType
    && Number(left.size) === Number(right.size)
    && (left.existing === true) === (right.existing === true)
    && (left.readOnly === true) === (right.readOnly === true);
  const renewals = new Map();
  for (const item of unmatched) {
    const matches = remote.filter(candidate => !used.has(String(candidate.id)) && sameFile(item, candidate));
    if (matches.length !== 1 || unmatched.filter(candidate => sameFile(item, candidate)).length !== 1) continue;
    used.add(String(matches[0].id));
    renewals.set(String(item.id), matches[0]);
  }
  const attachments = [...previous.filter(item => !remoteIds.has(String(item.id)) && !renewals.has(String(item.id))), ...remote];
  return { attachments, renewals, added: remote.filter(item => !used.has(String(item.id))) };
}

/** Detach promptly even when a transport does not settle after abort. */
export function waitForDdaPaymentLaunch(promise, signal) {
  if (!signal) return promise;
  let cancel;
  const cancelled = new Promise((_, reject) => {
    cancel = () => reject(new DOMException('Transferência cancelada.', 'AbortError'));
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
  return Promise.race([promise, cancelled]).finally(() => signal.removeEventListener('abort', cancel));
}

/** Acquire the complete, exact row before any navigation or upload. */
export async function loadDdaPaymentLaunchFiles(data, { itemId, key, signal, cancellationSignal = signal, assertCurrent }) {
  if (!Number.isSafeInteger(Number(itemId)) || Number(itemId) <= 0
    || !/^[a-f0-9]{64}$/i.test(String(key || ''))) throw new Error('O DDA confirmado não foi identificado.');
  const check = () => {
    assertCurrent();
    if (signal?.aborted) throw new DOMException('Transferência cancelada.', 'AbortError');
  };
  check();
  const attachments = await waitForDdaPaymentLaunch(data.listAttachments(itemId, { refresh: true, signal }), cancellationSignal);
  check();
  if (!Array.isArray(attachments)) throw new Error('A consulta não confirmou os anexos do DDA.');
  const names = new Set(), files = [];
  for (const attachment of attachments) {
    const name = String(attachment?.fileName || '');
    if (!name || /[\\/\u0000-\u001f]/.test(name)) throw new Error('O nome do anexo do DDA é inválido.');
    if (names.has(name)) continue;
    names.add(name);
    check();
    const blob = await waitForDdaPaymentLaunch(data.downloadAttachment(itemId, name, { signal }), cancellationSignal);
    check();
    if (!blob || typeof blob.arrayBuffer !== 'function' || typeof blob.slice !== 'function') {
      throw new Error(`O download de ${name} não foi confirmado.`);
    }
    const type = blob.type || attachment.mimeType || 'application/octet-stream';
    const file = typeof globalThis.File === 'function'
      ? new File([blob], name, { type }) : Object.assign(new Blob([blob], { type }), { name });
    validateAttachment(file);
    // Stable upload identity also protects a retry after an uncertain response.
    file.uploadMessageId = globalThis.crypto.randomUUID();
    files.push(file);
  }
  check();
  return files;
}
