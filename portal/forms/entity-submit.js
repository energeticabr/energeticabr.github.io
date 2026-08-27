import { persistLancamentoRecord } from "./lancamentos-workflow.js";

export async function persistEntityRecord(repository, entity, list, options = {}) {
  if (!repository || !list?.id) throw new TypeError("A gravação requer o repositório e a lista SharePoint resolvida.");
  const lancamento = await persistLancamentoRecord(repository, entity, list, options);
  if (lancamento) return lancamento;
  const fields = options.fields || {};
  if (options.mode === "edit") {
    const item = options.item;
    const eTag = String(item?.eTag || item?.["@odata.etag"] || "").trim();
    if (!item?.id || !eTag) throw new Error("A edição requer o item atual e seu ETag do SharePoint.");
    if (typeof repository.updateItem !== "function") throw new TypeError("O repositório não oferece edição de registros.");
    return repository.updateItem(entity.siteKey, list.id, item.id, fields, { eTag });
  }
  if (typeof repository.createItem !== "function") throw new TypeError("O repositório não oferece criação de registros.");
  return repository.createItem(entity.siteKey, list.id, fields);
}

function isAttachmentTechnicalField(name) {
  return ["ATTACHMENTS", "ANEXOS"].includes(String(name || "").replace(/[{}\s_-]/g, "").toUpperCase());
}

function recordFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields || {}).filter(([name]) => !isAttachmentTechnicalField(name)));
}

export async function persistEntityRecordWithAttachments(repository, entity, list, options = {}) {
  const attachments = options.attachments || {};
  const uploads = [...(attachments.uploads || [])];
  const deletions = [...(attachments.deletions || [])];
  if (options.mode !== "edit" && deletions.length) throw new Error("Uma criação não pode excluir anexos existentes.");

  const savedItem = await persistEntityRecord(repository, entity, list, {
    ...options,
    fields: recordFields(options.fields),
  });
  const itemId = String(savedItem?.id || savedItem?.item?.id || (options.mode === "edit" ? options.item?.id : "") || "").trim();
  if ((uploads.length || deletions.length) && !itemId) throw new Error("O SharePoint não retornou o ID necessário para gravar os anexos.");

  for (const name of deletions) {
    if (typeof repository.deleteAttachment !== "function") throw new TypeError("O repositório não oferece exclusão de anexos.");
    await repository.deleteAttachment(entity.siteKey, list.id, itemId, name);
  }
  for (const file of uploads) {
    if (typeof repository.uploadAttachment !== "function") throw new TypeError("O repositório não oferece envio de anexos.");
    await repository.uploadAttachment(entity.siteKey, list.id, itemId, file, file?.name);
  }
  return savedItem;
}
