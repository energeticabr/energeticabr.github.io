import { validateAttachment } from "../../../../portal/data/attachments.js";

export const INACTIVE_SHEET_RECEIPT_ERROR = "Para STATUS INATIVO, adicione pelo menos um anexo: o recibo de pagamento de salário da contabilidade assinado.";
const nameKey = name => String(name || "").trim().toLocaleLowerCase("pt-BR");
const conflict = () => new Error("A folha foi alterada durante a edição. Reabra o registro para conferir os dados e anexos.");

/** Attachments belong to this loaded item, never to a caller-supplied list or ID. */
export function createPayrollSheetAttachments({ repository, siteKey, list, item, columns, currentItem, assertSession }) {
  const successfulUploads = new Map();
  let expectedETag = item.eTag;
  const guard = signal => {
    assertSession();
    if (signal?.aborted) throw signal.reason || new DOMException("A edição foi cancelada.", "AbortError");
  };
  const sameFields = current => columns.every(column => {
    const name = ["lookup", "person"].includes(column.control) ? column.name + "LookupId" : column.name;
    return JSON.stringify(current.fields[name] ?? null) === JSON.stringify(item.fields[name] ?? null);
  });
  async function listFiles(signal) {
    guard(signal);
    if (typeof repository.listAttachments !== "function") throw new Error("Não foi possível confirmar os anexos desta folha. Tente novamente.");
    const files = await repository.listAttachments(siteKey, list.id, item.id);
    guard(signal);
    if (!Array.isArray(files) || files.some(file => !file || typeof file.name !== "string" || !file.name.trim()
      || /[\\/\u0000-\u001f]/.test(file.name))) throw new Error("Não foi possível confirmar os anexos desta folha. Tente novamente.");
    return files;
  }
  async function read(file, { signal } = {}) {
    guard(signal);
    const files = await listFiles(signal), current = files.find(candidate => candidate.name === file?.name);
    if (!current || typeof repository.downloadAttachment !== "function") throw new Error("O anexo não está mais disponível nesta folha.");
    const bytes = await repository.downloadAttachment(siteKey, list.id, item.id, current.name);
    guard(signal);
    return bytes;
  }
  async function prepare(uploads, { inactive = false, signal } = {}) {
    guard(signal);
    if (!Array.isArray(uploads)) throw new TypeError("Os anexos precisam ser uma lista de arquivos.");
    const names = new Set();
    const selected = uploads.map(file => {
      const validation = validateAttachment(file);
      if (!validation.valid) throw new Error(validation.message);
      const key = nameKey(validation.name);
      if (names.has(key)) throw new Error("Já existe um anexo selecionado com esse nome.");
      names.add(key);
      return { file, name: validation.name, key };
    });
    if (!selected.length && !inactive) return expectedETag;
    let current = await currentItem(list, item.id, signal);
    guard(signal);
    // Own successful uploads may advance ETag, but never authorize field changes.
    if (!sameFields(current) || (current.eTag !== expectedETag && !successfulUploads.size)) throw conflict();
    let files = await listFiles(signal);
    for (const entry of selected) {
      const existing = files.find(file => nameKey(file.name) === entry.key);
      if (existing && successfulUploads.get(entry.key) !== entry.file) throw new Error("O arquivo " + entry.name + " já existe nesta folha. Reabra o registro para conferir os anexos.");
    }
    if (inactive && !selected.length && !files.length) throw new Error(INACTIVE_SHEET_RECEIPT_ERROR);
    if (selected.length && typeof repository.uploadAttachment !== "function") throw new Error("O envio de anexos não está disponível.");
    for (const entry of selected) {
      const existing = files.find(file => nameKey(file.name) === entry.key);
      if (existing && successfulUploads.get(entry.key) === entry.file) continue;
      guard(signal);
      await repository.uploadAttachment(siteKey, list.id, item.id, entry.file, entry.name, { signal });
      successfulUploads.set(entry.key, entry.file);
      guard(signal);
      files = await listFiles(signal);
      if (!files.some(file => nameKey(file.name) === entry.key)) throw new Error("O envio do anexo não foi confirmado. Confira a folha antes de tentar novamente.");
      current = await currentItem(list, item.id, signal);
      guard(signal);
      if (!sameFields(current)) throw conflict();
      expectedETag = current.eTag;
    }
    current = await currentItem(list, item.id, signal);
    guard(signal);
    if (!sameFields(current) || (current.eTag !== expectedETag && !successfulUploads.size)) throw conflict();
    expectedETag = current.eTag;
    // Keep this ETag: deletion after the confirmation must cause a conditional
    // update conflict, not be adopted by a later refreshed item read.
    files = await listFiles(signal);
    if (inactive && !files.length) throw new Error(INACTIVE_SHEET_RECEIPT_ERROR);
    if (selected.some(entry => !files.some(file => nameKey(file.name) === entry.key))) throw new Error("Um anexo enviado não está mais na folha. Reabra o registro para conferir.");
    return expectedETag;
  }
  return Object.freeze({ list: ({ signal } = {}) => listFiles(signal), read, prepare });
}
