// These files already belong to the fiscal item. Preserve every file type,
// including XML, while checking names, size, PDF integrity and exact bytes.
export function nfeAttachmentNames(names, fiscalPdfName) {
  if (!Array.isArray(names) || !names.length) throw new Error('A consulta de anexos da nota está incompleta.');
  const seen = new Set();
  for (const name of names) {
    if (typeof name !== 'string' || !name.trim() || name.length > 400
      || /^[.]{1,2}$/.test(name) || /[/\\\u0000-\u001f]/.test(name) || seen.has(name.toLowerCase())) {
      throw new Error('Os anexos da nota contêm um nome inválido ou repetido.');
    }
    seen.add(name.toLowerCase());
  }
  if (!names.includes(fiscalPdfName)) throw new Error('O PDF fiscal original não foi encontrado nos anexos da nota.');
  return [...names].sort();
}

export async function nfeAttachmentFingerprint(value, name) {
  const source = typeof value?.arrayBuffer === 'function' ? await value.arrayBuffer() : value;
  const bytes = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : Object.prototype.toString.call(source) === '[object ArrayBuffer]' ? new Uint8Array(source) : null;
  if (!bytes?.byteLength || bytes.byteLength > 25 * 1024 * 1024) throw new Error(`O anexo ${name} está vazio, ilegível ou excede 25 MB.`);
  if (/\.pdf$/i.test(name)) {
    const decoder = new TextDecoder();
    if (!/^%PDF-\d\.\d/.test(decoder.decode(bytes.subarray(0,8)))
      || !/%%EOF\s*$/.test(decoder.decode(bytes.subarray(-2048)))) throw new Error('O PDF fiscal está inválido ou incompleto.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
}
