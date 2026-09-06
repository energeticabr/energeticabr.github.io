import { persistLancamentoRecord } from "./lancamentos-workflow.js";
import { normalizeF21RecurringExpenseRules } from "./despesas-recorrentes-powerapps-rules.js";
import { buildF20SecondaryCadastroProdutoPayload, getF18NextMonthDepreciationDate } from "./imobilizados-powerapps-rules.js";

function canonicalField(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLocaleUpperCase("pt-BR");
}

function emptyValue(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function normalizedEntityFields(entity, fields = {}, mode = "create") {
  const entityId = String(entity?.id || "");
  if (entityId === "despesas-recorrentes") {
    const recurrence = normalizeF21RecurringExpenseRules(fields);
    return {
      ...fields,
      RECORRENCIA: recurrence.RECORRENCIA,
      RECORRENCIADIAS: recurrence.RECORRENCIADIAS,
    };
  }
  if (entityId === "imobilizados" && mode !== "edit") {
    return {
      ...fields,
      DATADEPRECIA_x00c7__x00c3_O: emptyValue(fields.DATADEPRECIA_x00c7__x00c3_O)
        ? getF18NextMonthDepreciationDate(fields.DATACADASTRO)
        : fields.DATADEPRECIA_x00c7__x00c3_O,
      VALORRESIDUAL: emptyValue(fields.VALORRESIDUAL) ? fields.VALORESTIMADO : fields.VALORRESIDUAL,
    };
  }
  return fields;
}

function sharePointFieldName(columns, logicalName) {
  const expected = canonicalField(logicalName);
  return (columns || []).find(column => canonicalField(column.displayName) === expected
    || canonicalField(column.name) === expected)?.name || "";
}

async function createMissingF20Product(repository, entity, fields) {
  if (String(entity?.id || "") !== "cadastro-de-imobilizados") return null;
  const product = fields.IMOBILIZADO;
  if (emptyValue(product)) return null;
  const list = await repository.resolveList(entity.siteKey, ["CADASTROPRODUTO"]);
  if (list.status !== "resolved") throw new Error("A lista CADASTROPRODUTO não foi localizada no SharePoint.");
  const columns = await repository.getColumns(entity.siteKey, list.id);
  const productField = sharePointFieldName(columns, "PRODUTO");
  const subfamilyField = sharePointFieldName(columns, "SUBFAMÍLIA");
  if (!productField || !subfamilyField) throw new Error("Os campos PRODUTO e SUBFAMÍLIA não foram localizados em CADASTROPRODUTO.");
  const items = await repository.getItems(
    entity.siteKey,
    list.id,
    `$select=id&$expand=fields($select=${productField})`,
  );
  const logicalPayload = buildF20SecondaryCadastroProdutoPayload({
    product,
    existingProducts: (items || []).map(item => item.fields || item),
  });
  if (!logicalPayload) return null;
  return repository.createItem(entity.siteKey, list.id, {
    [productField]: logicalPayload.PRODUTO,
    [subfamilyField]: logicalPayload.SUBFAMÍLIA,
  });
}

export async function persistEntityRecord(repository, entity, list, options = {}) {
  if (!repository || !list?.id) throw new TypeError("A gravação requer o repositório e a lista SharePoint resolvida.");
  const lancamento = await persistLancamentoRecord(repository, entity, list, options);
  if (lancamento) return lancamento;
  const fields = normalizedEntityFields(entity, options.fields || {}, options.mode);
  if (options.mode === "edit") {
    const item = options.item;
    const eTag = String(item?.eTag || item?.["@odata.etag"] || "").trim();
    if (!item?.id || !eTag) throw new Error("A edição requer o item atual e seu ETag do SharePoint.");
    if (typeof repository.updateItem !== "function") throw new TypeError("O repositório não oferece edição de registros.");
    return repository.updateItem(entity.siteKey, list.id, item.id, fields, { eTag });
  }
  if (typeof repository.createItem !== "function") throw new TypeError("O repositório não oferece criação de registros.");
  await createMissingF20Product(repository, entity, fields);
  return repository.createItem(entity.siteKey, list.id, fields);
}

function isAttachmentTechnicalField(name) {
  return ["ATTACHMENTS", "ANEXOS"].includes(String(name || "").replace(/[{}\s_-]/g, "").toUpperCase());
}

function recordFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields || {}).filter(([name]) => !isAttachmentTechnicalField(name)));
}

function attachmentName(file) {
  return String(file?.name || "").trim();
}

function attachmentKey(value) {
  return String(value || "").trim().toLocaleLowerCase("pt-BR");
}

function frozenCopy(values = []) {
  return Object.freeze([...(values || [])]);
}

function normalizedRetryItem(value) {
  if (!value) return null;
  const retryItem = value.retryItem || value;
  if (!retryItem.savedItem || !String(retryItem.itemId || "").trim()) {
    throw new TypeError("A retentativa requer o retryItem retornado pela falha anterior.");
  }
  return retryItem;
}

function attachmentFailureMessage(stage, name, itemId) {
  if (stage === "upload") {
    return `O registro ${itemId} foi salvo, mas não foi possível enviar o anexo ${name}. A retentativa continuará no mesmo item.`;
  }
  return `Os novos anexos do registro ${itemId} foram enviados, mas não foi possível excluir o anexo ${name}. A retentativa continuará do ponto da falha.`;
}

function retrySnapshot({ mode, savedItem, itemId, completedUploads, completedDeletions, pendingUploads, pendingDeletions }) {
  return Object.freeze({
    mode,
    savedItem,
    itemId,
    completedUploads: frozenCopy(completedUploads),
    completedDeletions: frozenCopy(completedDeletions),
    pendingUploads: frozenCopy(pendingUploads),
    pendingDeletions: frozenCopy(pendingDeletions),
  });
}

export class EntityAttachmentPersistenceError extends Error {
  constructor({ stage, operation, cause, retryItem }) {
    super(attachmentFailureMessage(stage, operation, retryItem.itemId));
    this.name = "EntityAttachmentPersistenceError";
    this.code = "ENTITY_ATTACHMENT_PERSISTENCE_FAILED";
    this.stage = stage;
    this.operation = operation;
    this.cause = cause;
    this.savedItem = retryItem.savedItem;
    this.itemId = retryItem.itemId;
    this.completedUploads = retryItem.completedUploads;
    this.completedDeletions = retryItem.completedDeletions;
    this.pendingUploads = retryItem.pendingUploads;
    this.pendingDeletions = retryItem.pendingDeletions;
    this.retryItem = retryItem;
  }
}

export function formPersistenceRetryItem(retryState) {
  return retryState?.persistenceRetryItem || null;
}

export function formRetryAttachmentChanges(retryState) {
  const value = retryState?.attachmentChanges;
  return Object.freeze({
    uploads: frozenCopy(value?.uploads),
    deletions: frozenCopy(value?.deletions),
  });
}

export function mergeFailedFormRetryState(uiRetryState, error, previousRetryState = null, attachmentChanges = null) {
  const persistenceRetryItem = error?.retryItem || formPersistenceRetryItem(previousRetryState);
  const previousChanges = formRetryAttachmentChanges(previousRetryState);
  const uploads = persistenceRetryItem?.pendingUploads
    ?? attachmentChanges?.uploads
    ?? previousChanges.uploads;
  const deletions = persistenceRetryItem?.pendingDeletions
    ?? attachmentChanges?.deletions
    ?? previousChanges.deletions;
  return Object.freeze({
    ...(uiRetryState || {}),
    ...(persistenceRetryItem ? { persistenceRetryItem } : {}),
    attachmentChanges: Object.freeze({ uploads: frozenCopy(uploads), deletions: frozenCopy(deletions) }),
  });
}

export async function persistEntityRecordWithAttachments(repository, entity, list, options = {}) {
  const mode = options.mode === "edit" ? "edit" : "create";
  const retryItem = normalizedRetryItem(options.retryItem);
  if (retryItem?.mode && retryItem.mode !== mode) throw new Error("A retentativa deve usar o mesmo modo da gravação original.");
  if (retryItem && mode === "edit" && options.item?.id && String(options.item.id) !== String(retryItem.itemId)) {
    throw new Error("A retentativa de edição não corresponde ao item original.");
  }

  const suppliedAttachments = options.attachments;
  const uploads = [...(suppliedAttachments?.uploads ?? retryItem?.pendingUploads ?? [])];
  const deletions = [...(suppliedAttachments?.deletions ?? retryItem?.pendingDeletions ?? [])];
  if (mode !== "edit" && deletions.length) throw new Error("Uma criação não pode excluir anexos existentes.");

  const completedUploads = [...(retryItem?.completedUploads || [])];
  const completedDeletions = [...(retryItem?.completedDeletions || [])];
  const uploadedKeys = new Set(completedUploads.map(attachmentKey));
  const deletedKeys = new Set(completedDeletions.map(attachmentKey));
  const pendingUploads = uploads.filter(file => !uploadedKeys.has(attachmentKey(attachmentName(file))));
  const pendingDeletions = deletions.filter(name => !deletedKeys.has(attachmentKey(name)));

  const savedItem = retryItem?.savedItem || await persistEntityRecord(repository, entity, list, {
    ...options,
    mode,
    fields: recordFields(options.fields),
  });
  const itemId = String(retryItem?.itemId || savedItem?.id || savedItem?.item?.id || (mode === "edit" ? options.item?.id : "") || "").trim();
  if ((uploads.length || deletions.length) && !itemId) throw new Error("O SharePoint não retornou o ID necessário para gravar os anexos.");

  for (let index = 0; index < pendingUploads.length; index += 1) {
    const file = pendingUploads[index];
    const name = attachmentName(file);
    try {
      if (typeof repository.uploadAttachment !== "function") throw new TypeError("O repositório não oferece envio de anexos.");
      await repository.uploadAttachment(entity.siteKey, list.id, itemId, file, name);
      completedUploads.push(name);
    } catch (cause) {
      throw new EntityAttachmentPersistenceError({
        stage: "upload",
        operation: name,
        cause,
        retryItem: retrySnapshot({
          mode,
          savedItem,
          itemId,
          completedUploads,
          completedDeletions,
          pendingUploads: pendingUploads.slice(index),
          pendingDeletions,
        }),
      });
    }
  }

  for (let index = 0; index < pendingDeletions.length; index += 1) {
    const name = pendingDeletions[index];
    try {
      if (typeof repository.deleteAttachment !== "function") throw new TypeError("O repositório não oferece exclusão de anexos.");
      await repository.deleteAttachment(entity.siteKey, list.id, itemId, name);
      completedDeletions.push(name);
    } catch (cause) {
      throw new EntityAttachmentPersistenceError({
        stage: "delete",
        operation: name,
        cause,
        retryItem: retrySnapshot({
          mode,
          savedItem,
          itemId,
          completedUploads,
          completedDeletions,
          pendingUploads: [],
          pendingDeletions: pendingDeletions.slice(index),
        }),
      });
    }
  }
  return savedItem;
}
