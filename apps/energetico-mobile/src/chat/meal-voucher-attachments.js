import { validateAttachment } from '../../../../portal/data/attachments.js';

const fileKey = name => String(name).normalize('NFC').toLocaleLowerCase('pt-BR');
const digest = async bytes => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');

/** Files are reconciled against SharePoint, never against a local success flag. */
export function createMealVoucherAttachments({ repository, assertSession = () => {}, siteKey = 'personal' }) {
  async function call(method,...args) {
    assertSession();
    if (typeof repository[method] !== 'function') throw new Error('A conferência de anexos não está disponível.');
    const result = await repository[method](siteKey,...args); assertSession(); return result;
  }
  async function prepare(files, previous) {
    assertSession(); const seen = new Set(), entries = [];
    for (const file of files) {
      const valid = validateAttachment(file);
      if (!valid.valid) throw new Error(valid.message);
      if (seen.has(fileKey(valid.name))) throw new Error('Há arquivos com o mesmo nome na bandeja. Renomeie um deles.');
      seen.add(fileKey(valid.name));
      const bytes = await file.arrayBuffer(); assertSession();
      if (bytes.byteLength !== file.size) throw new Error('O tamanho do anexo mudou. Confira a bandeja.');
      const sha256 = await digest(bytes); assertSession();
      entries.push({manifest:{name:valid.name,size:bytes.byteLength,sha256},
        file:{name:valid.name,size:bytes.byteLength,type:file.type,arrayBuffer:async()=>bytes.slice(0)}});
    }
    entries.sort((a,b)=>a.manifest.name.localeCompare(b.manifest.name));
    if (previous && JSON.stringify(previous) !== JSON.stringify(entries.map(e=>e.manifest)))
      throw new Error('Para retomar, mantenha os mesmos anexos, com o mesmo conteúdo, na bandeja.');
    return entries;
  }
  async function exists(target, entry) {
    const rows = await call('listAttachments',target.listId,target.id);
    if (!Array.isArray(rows) || rows.some(row=>!String(row?.name || '').trim())) throw new Error('Não foi possível conferir os anexos no SharePoint.');
    const matches = rows.filter(row=>fileKey(row.name)===fileKey(entry.manifest.name));
    if (matches.length > 1) throw new Error('O destino possui nomes de anexos ambíguos.');
    if (!matches.length) return false;
    const raw = await call('downloadAttachment',target.listId,target.id,matches[0].name);
    const bytes = raw instanceof ArrayBuffer ? raw : ArrayBuffer.isView(raw) ? raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength) : await raw.arrayBuffer();
    const hash = await digest(bytes); assertSession();
    if (bytes.byteLength !== entry.manifest.size || hash !== entry.manifest.sha256)
      throw new Error(`O anexo ${entry.manifest.name} já existe com conteúdo diferente. Renomeie o novo arquivo; nada será sobrescrito.`);
    return true;
  }
  async function check(target, entries) { for (const entry of entries) await exists(target,entry); }
  async function submit(targets, entries, onProgress = () => {}) {
    for (const target of targets) await check(target,entries);
    for (const target of targets) for (const entry of entries) {
      if (!await exists(target,entry)) {
        try { await call('uploadAttachment',target.listId,target.id,entry.file,entry.manifest.name); }
        catch (cause) { assertSession(); if (!await exists(target,entry)) throw cause; }
        if (!await exists(target,entry)) throw new Error(`O anexo ${entry.manifest.name} ainda não foi confirmado. Retome o envio; não é necessário reenviar os registros já gravados.`);
      }
      onProgress(target,entry.manifest);
    }
  }
  return Object.freeze({prepare,check,submit});
}
