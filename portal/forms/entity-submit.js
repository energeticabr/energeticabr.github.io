export async function persistEntityRecord(repository, entity, list, options = {}) {
  if (!repository || !list?.id) throw new TypeError("A gravação requer o repositório e a lista SharePoint resolvida.");
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
