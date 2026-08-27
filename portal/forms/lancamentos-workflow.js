const REQUIRED_GROUPS = Object.freeze([
  ["FILIAL", "Title"],
  ["ETAPA", "field_6"],
  ["CONTA", "field_14"],
  ["TIPO TRANSAÇÃO", "TIPOTRANSACAO", "field_1"],
  ["QUANTIDADE", "field_8"],
  ["FORNECEDOR", "field_5"],
  ["VALOR UNITÁRIO", "VALORUNITARIO", "field_9"],
]);

function valueFrom(fields = {}, names = []) {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const number = Number(String(value || "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function missingRequiredFields(fields = {}) {
  return REQUIRED_GROUPS
    .filter(group => String(valueFrom(fields, group)).trim() === "")
    .map(group => group[0]);
}

function totalValue(fields = {}) {
  return (numericValue(valueFrom(fields, ["VALOR UNITÁRIO", "VALORUNITARIO", "field_9"])) * numericValue(valueFrom(fields, ["QUANTIDADE", "field_8"])))
    + numericValue(valueFrom(fields, ["FRETE", "field_10"]));
}

function isLancamentos(entity = {}) {
  return String(entity.id || "") === "lancamentos";
}

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function warningMessages(fields = {}) {
  const warnings = [];
  const tipo = normalizeText(valueFrom(fields, ["TIPO DESPESA", "TIPODESPESA"]));
  const fornecedor = normalizeText(valueFrom(fields, ["FORNECEDOR", "field_5"]));
  const comprovante = normalizeText(valueFrom(fields, ["ENVIARCOMPROVANTE"]));
  const medicao = normalizeText(valueFrom(fields, ["MEDICAOPARCIAL"]));
  if ((fornecedor.includes("EMPREITEIRO") || tipo.includes("MAO DE OBRA") || tipo.includes("MÃO DE OBRA")) && !comprovante) {
    warnings.push("Pagamento de empreiteiro lançado sem indicação de comprovante.");
  }
  if (medicao) warnings.push("Fornecedor pago por medição: lançamento vinculado ao fluxo de medição.");
  return warnings;
}

async function resolveOptionalList(repository, siteKey, aliases) {
  if (typeof repository.resolveList !== "function") return null;
  const list = await repository.resolveList(siteKey, aliases);
  return list?.status === "resolved" ? list : null;
}

async function itemExists(repository, siteKey, listId, id) {
  if (!id) return false;
  if (typeof repository.getItem === "function") {
    try {
      await repository.getItem(siteKey, listId, id);
      return true;
    } catch {
      return false;
    }
  }
  if (typeof repository.getItemsPage !== "function") return true;
  const page = await repository.getItemsPage(siteKey, listId, `$expand=fields&$filter=id eq ${encodeURIComponent(id)}&$top=1`);
  return Array.isArray(page?.items) && page.items.length > 0;
}

async function hasProvision(repository, entity, fields = {}) {
  const list = await resolveOptionalList(repository, entity.siteKey, ["PROVISÃO PGTOS", "PROVISAO PGTOS", "PROVISAO PAGAMENTOS"]);
  if (!list || typeof repository.getItemsPage !== "function") return false;
  const fornecedor = String(valueFrom(fields, ["FORNECEDOR", "field_5"])).replace(/'/g, "''");
  if (!fornecedor) return false;
  const page = await repository.getItemsPage(entity.siteKey, list.id, `$expand=fields&$filter=fields/FORNECEDOR eq '${fornecedor}'&$top=1`);
  return Array.isArray(page?.items) && page.items.length > 0;
}

function noteFields(fields = {}) {
  const fornecedor = valueFrom(fields, ["FORNECEDOR", "field_5"]);
  const filial = valueFrom(fields, ["FILIAL", "Title"]);
  const etapa = valueFrom(fields, ["ETAPA", "field_6"]);
  const descricao = valueFrom(fields, ["DESCRIÇÃO", "DESCRICAO", "field_16"]);
  return {
    Title: fornecedor || "LANÇAMENTO",
    FILIAL: filial,
    ETAPA: etapa,
    FORNECEDOR: fornecedor,
    DESCRICAO: descricao,
    DESCRIÇÃO: descricao,
    STATUS: "PENDENTE",
    VALORTOTAL: totalValue(fields),
  };
}

async function safeNoteFields(repository, entity, list, fields = {}) {
  const desired = noteFields(fields);
  if (typeof repository.getColumns !== "function") return desired;
  const columns = await repository.getColumns(entity.siteKey, list.id);
  const available = new Set((columns || []).map(column => column.name));
  return Object.fromEntries(Object.entries(desired).filter(([name]) => available.has(name)));
}

export async function persistLancamentoRecord(repository, entity, list, options = {}) {
  if (!isLancamentos(entity) || options.mode === "edit") return null;
  const missing = missingRequiredFields(options.fields);
  if (missing.length) throw new Error(`Preencha antes de enviar: ${missing.join(", ")}.`);

  const notasList = await resolveOptionalList(repository, entity.siteKey, ["NOTASPENDENTES", "NOTAS PENDENTES"]);
  let preventiveNote = null;
  const fields = { ...(options.fields || {}) };
  const groupingId = String(valueFrom(fields, ["AGRUPAR"])).trim();
  if (groupingId) {
    if (notasList && !(await itemExists(repository, entity.siteKey, notasList.id, groupingId))) {
      throw new Error(`O agrupamento ${groupingId} não existe em NOTASPENDENTES.`);
    }
  } else if (notasList) {
    preventiveNote = await repository.createItem(entity.siteKey, notasList.id, await safeNoteFields(repository, entity, notasList, fields));
    if (preventiveNote?.id) fields.AGRUPAR = String(preventiveNote.id);
  }

  try {
    const item = await repository.createItem(entity.siteKey, list.id, fields);
    const warnings = warningMessages(fields);
    try {
      if (await hasProvision(repository, entity, fields)) warnings.push("Já existe provisão de pagamento relacionada a este fornecedor.");
    } catch {
      warnings.push("Não foi possível verificar automaticamente se já existe provisão de pagamento.");
    }
    return Object.freeze({ item, preventiveNote, warnings: Object.freeze(warnings) });
  } catch (error) {
    if (preventiveNote?.id && typeof repository.deleteItem === "function") {
      await repository.deleteItem(entity.siteKey, notasList.id, preventiveNote.id, { eTag: preventiveNote.eTag || preventiveNote["@odata.etag"] || "*" });
    }
    throw error;
  }
}
