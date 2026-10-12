import { canReselectQueuedProvisionParent } from "./multi-entry.js";

const PAYMENT_MARKERS = ["DATAPGTOEFETUADO", "PGTOAGENDADO", "DATAPGTOAGENDADO", "DATAEXECUCAOAGENDAMENTO"];
const PARENT_TEXT = ["Title", "FILIAL", "FORNECEDOR", "FORMAPGTO", "OBS", "VALORTOTAL"];
const PARENT_DATES = ["DATAPREVISTOPGTO", ...PAYMENT_MARKERS];
const CHILD_ALIASES = ["PROVISÃO PGTOS", "PROVISAO PGTOS", "PROVISAO PAGAMENTOS"];
const blank = value => value == null || (typeof value === "string" && !value.trim());
const canonical = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toUpperCase();

function positiveId(value) {
  const id = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(id)) throw new Error("O descritivo/provisão requer ID textual positivo.");
  return id;
}

function etag(item) {
  const value = String(item?.eTag || item?.["@odata.etag"] || "").trim();
  if (!value || value === "*") throw new Error("O descritivo requer ETag autoritativo do SharePoint.");
  return value;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function resolveField(columns, logicalName, type) {
  const types = Array.isArray(type) ? type : [type];
  const available = columns.filter(column => !column.readOnly && !column.hidden && !column.computed);
  const internal = available.filter(column => canonical(column.name) === canonical(logicalName));
  const candidates = internal.length ? internal : available.filter(column => canonical(column.displayName) === canonical(logicalName));
  if (candidates.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidates[0].name) || !types.some(kind => candidates[0][kind])) {
    throw new Error(`O campo ${logicalName} requer metadados SharePoint únicos do tipo ${type}.`);
  }
  return candidates[0].name;
}

async function childContract(repository, entity, suppliedList) {
  const list = await repository.resolveList(entity.siteKey, entity.listNames?.length ? entity.listNames : CHILD_ALIASES);
  if (list?.status !== "resolved" || !list.id || suppliedList && list.id !== suppliedList.id) throw new Error("A lista de provisões resolvida não corresponde à lista do formulário.");
  const columns = await repository.getColumns(entity.siteKey, list.id);
  const fields = Object.fromEntries(["Title", "QTD", "VALORTOTAL", "FRETE", "DESCRITIVOPROVISAO"].map(name => [name, resolveField(columns, name, "text")]));
  for (const name of ["STATUS", "PGTOAGENDADO"]) fields[name] = resolveField(columns, name, ["text", "choice"]);
  fields.DATAPGTOEFETUADO = resolveField(columns, "DATAPGTOEFETUADO", "dateTime");
  return { list, columns, fields };
}

function hasPendingChild(items, child, parentId) {
  return items.some(item => String(item.fields?.[child.fields.DESCRITIVOPROVISAO] ?? "") === parentId
    && canonical(item.fields?.[child.fields.STATUS]) === "PAGAMENTOPREVISTO"
    && blank(item.fields?.[child.fields.DATAPGTOEFETUADO])
    && canonical(item.fields?.[child.fields.PGTOAGENDADO]) !== "PAGO");
}

async function requirePendingChildren(repository, entity, child, parentId) {
  const children = await matchingItems(repository, entity.siteKey, child.list, child.columns, child.fields.DESCRITIVOPROVISAO, parentId);
  if (!hasPendingChild(children, child, parentId)) throw new Error("O descritivo está encerrado ou não possui provisão filha pendente. Selecione outro descritivo ou crie um novo.");
}

async function parentContract(repository, entity) {
  const list = await repository.resolveList(entity.siteKey, ["DESCRITIVOPROVISAO"]);
  if (list?.status !== "resolved" || !list.id) throw new Error("A lista DESCRITIVOPROVISAO não foi localizada.");
  const columns = await repository.getColumns(entity.siteKey, list.id);
  const fields = Object.fromEntries([...PARENT_TEXT.map(name => [name, resolveField(columns, name, "text")]), ...PARENT_DATES.map(name => [name, resolveField(columns, name, "dateTime")])]);
  return { list, fields, columns };
}

function requirePending(item, fields, id, expectedEtag = "") {
  if (!item || positiveId(item.id) !== positiveId(id)) throw new Error("A identidade do descritivo mudou no SharePoint.");
  const currentEtag = etag(item);
  if (PAYMENT_MARKERS.some(name => !blank(item.fields?.[fields[name]]))) throw new Error("O descritivo não está pendente: há pagamento ou agendamento registrado.");
  if (expectedEtag && currentEtag !== expectedEtag) throw new Error("O descritivo mudou desde a seleção. Selecione novamente após revisar os dados.");
  return currentEtag;
}

export async function loadPendingProvisionParents(repository, entity) {
  const { list, fields } = await parentContract(repository, entity);
  const child = await childContract(repository, entity);
  // getItems is the repository's complete, bounded, paginated collection API.
  const items = await repository.getItems(entity.siteKey, list.id, "$expand=fields");
  if (!Array.isArray(items)) throw new Error("A consulta paginada de descritivos retornou dados inválidos.");
  const children = await repository.getItems(entity.siteKey, child.list.id, "$expand=fields");
  if (!Array.isArray(children)) throw new Error("A consulta paginada de provisões retornou dados inválidos.");
  return Object.freeze(items.flatMap(item => {
    try {
      const id = positiveId(item.id);
      const eTag = requirePending(item, fields, id);
      if (!hasPendingChild(children, child, id)) return [];
      const value = name => String(item.fields?.[fields[name]] ?? "").trim() || "—";
      return [Object.freeze({ id, eTag, label: `ID ${id} · ${value("FORNECEDOR")} · Filial ${value("FILIAL")} · Vencimento ${value("DATAPREVISTOPGTO")} · Total ${value("VALORTOTAL")}` })];
    } catch { return []; }
  }));
}

export async function reselectQueuedProvisionParent(repository, entity, queue, rowId, option) {
  const row = queue.snapshot().find(candidate => candidate.id === rowId);
  if (!canReselectQueuedProvisionParent(row)) throw new Error("Uma gravação iniciada ou retentativa parcial não permite trocar o descritivo.");
  const selected = selection({ ...option, mode: "existing" });
  const parent = await parentContract(repository, entity);
  const child = await childContract(repository, entity);
  await requirePendingChildren(repository, entity, child, selected.id);
  const current = await repository.getItem(entity.siteKey, parent.list.id, selected.id, "$expand=fields");
  requirePending(current, parent.fields, selected.id, selected.eTag);
  // The queue checks again after these reads in case submission started meanwhile.
  return queue.reselectProvisionParent(rowId, selected);
}

// Fixed decimal arithmetic: never round quantity, unit price or freight through Number.
function decimal(value, name, optional = false) {
  if (optional && blank(value)) return { units: 0n, scale: 0 };
  let text = String(value ?? "").trim().replace(/^R\$\s*/, "");
  if (text.includes(",")) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(text)) throw new Error(`Valor decimal inválido em ${name}.`);
    text = text.replaceAll(".", "").replace(",", ".");
  }
  if (!/^\d+(?:\.\d+)?$/.test(text) || text.length > 100) throw new Error(`Valor decimal inválido em ${name}.`);
  const [whole, fraction = ""] = text.split(".");
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

function add(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return { units: left.units * 10n ** BigInt(scale - left.scale) + right.units * 10n ** BigInt(scale - right.scale), scale };
}

function total(fields, names) {
  const quantity = decimal(fields[names.QTD], "QTD");
  const price = decimal(fields[names.VALORTOTAL], "VALORTOTAL");
  return add({ units: quantity.units * price.units, scale: quantity.scale + price.scale }, decimal(fields[names.FRETE], "FRETE", true));
}

function decimalText(value) {
  const digits = value.units.toString().padStart(value.scale + 1, "0");
  if (!value.scale) return digits;
  return `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`.replace(/0+$/, "").replace(/\.$/, "");
}

function selection(value = { mode: "new" }) {
  if (value.mode === "new") return Object.freeze({ mode: "new" });
  if (value.mode !== "existing") throw new Error("Selecione novo descritivo ou descritivo pendente.");
  return Object.freeze({ mode: "existing", id: positiveId(value.id), eTag: etag(value) });
}

function queryFor(field, value) {
  return new URLSearchParams({ $expand: "fields", $filter: `fields/${field} eq '${String(value).replaceAll("'", "''")}'` }).toString();
}

async function matchingItems(repository, siteKey, list, columns, field, value) {
  // Graph cannot safely filter an unindexed text field through getItems. Its
  // complete collection API still paginates; select the exact matches locally.
  const indexed = columns.find(column => column.name === field)?.indexed === true;
  const items = await repository.getItems(siteKey, list.id, indexed ? queryFor(field, value) : "$expand=fields");
  if (!Array.isArray(items)) throw new Error("A consulta paginada retornou dados inválidos.");
  return items.filter(item => String(item.fields?.[field] ?? "") === String(value));
}

function verifyPayload(item, payload, dateNames = []) {
  for (const [name, expected] of Object.entries(payload)) {
    const actual = item.fields?.[name];
    const equal = blank(actual) && blank(expected)
      || String(actual) === String(expected)
      || dateNames.includes(name) && !blank(actual) && !blank(expected) && Number.isFinite(Date.parse(expected)) && Date.parse(actual) === Date.parse(expected);
    if (!equal) throw new Error(`O registro recuperado tem dados/vínculo conflitantes em ${name}; nenhuma relincagem foi realizada.`);
  }
}

async function recoverOrCreate(repository, siteKey, contract, payload, titleField, state, kind, dateNames = [], beforeCreate) {
  const listId = contract.list.id;
  const idKey = `${kind}Id`;
  const attemptKey = `${kind}Attempted`;
  if (!state[idKey]) {
    const matches = await matchingItems(repository, siteKey, contract.list, contract.columns, titleField, payload[titleField]);
    if (!Array.isArray(matches) || matches.length > 1) throw new Error("A recuperação por título estável não é única.");
    if (matches.length) {
      if (!state[attemptKey]) throw new Error("Já existe um registro com este título. Revise-o antes de criar outra provisão.");
      verifyPayload(matches[0], payload, dateNames);
      state[idKey] = positiveId(matches[0].id);
    } else {
      // An ambiguous POST cannot be repeated: eventual consistency is not proof of absence.
      if (state[attemptKey]) throw new Error("A resposta da gravação está pendente de recuperação pelo título estável. Tente novamente sem criar outro registro.");
      await beforeCreate?.();
      state.createStarted = true;
      state[attemptKey] = true;
      let response;
      let postError;
      try { response = await repository.createItem(siteKey, listId, payload); } catch (error) {
        // Normalized repository HTTP validation/authentication/permission failures
        // reject this POST without committing it. Keep the token and frozen state,
        // but permit another POST on explicit retry. Conflicts, throttling, server
        // errors and transport/lost responses remain ambiguous and recovery-only.
        if ([400, 401, 403].includes(error?.status)) {
          state[attemptKey] = false;
          throw error;
        }
        postError = error;
      }
      if (response?.id) state[idKey] = positiveId(response.id);
      else {
        const recovered = await matchingItems(repository, siteKey, contract.list, contract.columns, titleField, payload[titleField]);
        if (!Array.isArray(recovered) || recovered.length !== 1) throw postError || new Error("O SharePoint não retornou ID e a gravação não pôde ser recuperada.");
        verifyPayload(recovered[0], payload, dateNames);
        state[idKey] = positiveId(recovered[0].id);
      }
    }
  }
  const item = await repository.getItem(siteKey, listId, state[idKey], "$expand=fields");
  if (positiveId(item?.id) !== state[idKey]) throw new Error("O SharePoint retornou identidade conflitante na recuperação.");
  verifyPayload(item, payload, dateNames);
  return item;
}

async function updateTotal(repository, entity, parent, child, state) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await repository.getItem(entity.siteKey, parent.list.id, state.parentId, "$expand=fields");
    const eTag = requirePending(current, parent.fields, state.parentId);
    const children = await matchingItems(repository, entity.siteKey, child.list, child.columns, child.fields.DESCRITIVOPROVISAO, state.parentId);
    if (!Array.isArray(children) || !children.some(item => String(item.id) === state.childId)) throw new Error("A consulta completa ainda não confirmou a provisão salva para recalcular o total.");
    let amount = { units: 0n, scale: 0 };
    const seen = new Set();
    for (const item of children) {
      const id = positiveId(item.id);
      if (seen.has(id) || String(item.fields?.[child.fields.DESCRITIVOPROVISAO]) !== state.parentId) throw new Error("A consulta paginada retornou vínculo/identidade conflitante.");
      seen.add(id);
      amount = add(amount, total(item.fields || {}, child.fields));
    }
    const value = decimalText(amount);
    try {
      await repository.updateItem(entity.siteKey, parent.list.id, state.parentId, { [parent.fields.VALORTOTAL]: value }, { eTag });
      const readback = await repository.getItem(entity.siteKey, parent.list.id, state.parentId, "$expand=fields");
      requirePending(readback, parent.fields, state.parentId);
      if (decimalText(decimal(readback.fields?.[parent.fields.VALORTOTAL], "VALORTOTAL")) !== value) throw new Error("O total do descritivo não foi confirmado na releitura.");
      return;
    } catch (error) {
      if (error?.status !== 412 || attempt === 2) throw error;
      // Retry the entire read/compute/conditional-write, never the stale patch alone.
    }
  }
}

export async function persistProvisionParentWorkflow(repository, entity, suppliedList, options = {}) {
  const previous = options.retryItem?.provisionRetryState || options.retryState?.persistenceRetryItem?.provisionRetryState || options.retryState?.provisionRetryState;
  let state = previous ? { ...previous } : null;
  try {
    const parent = await parentContract(repository, entity);
    const child = await childContract(repository, entity, suppliedList);
    const columns = child.columns;
    const childDateNames = columns.filter(column => column.dateTime).map(column => column.name);
    if (!state) {
      const selected = selection(options.provisionParentChoice || options.retryState?.provisionParentChoice);
      const fields = structuredClone(options.fields || {});
      const link = fields[child.fields.DESCRITIVOPROVISAO];
      if (!blank(link) && (selected.mode !== "existing" || String(link) !== selected.id)) throw new Error("A provisão já contém vínculo conflitante com outro descritivo.");
      const initialTotal = decimalText(total(fields, child.fields));
      const token = globalThis.crypto.randomUUID();
      if (blank(fields[child.fields.Title])) fields[child.fields.Title] = `provisao:${token}`;
      const parentPayload = { [parent.fields.Title]: `descritivo:${token}`, [parent.fields.VALORTOTAL]: initialTotal };
      for (const name of ["FILIAL", "FORNECEDOR", "FORMAPGTO", "OBS", "DATAPREVISTOPGTO"]) {
        const source = columns.find(column => canonical(column.name) === canonical(name)) || columns.find(column => canonical(column.displayName) === canonical(name));
        parentPayload[parent.fields[name]] = source ? fields[source.name] ?? null : null;
      }
      PAYMENT_MARKERS.forEach(name => { parentPayload[parent.fields[name]] = null; });
      state = { siteKey: entity.siteKey, parentListId: parent.list.id, childListId: child.list.id, choice: selected, fields: freeze(fields), parentPayload: freeze(parentPayload), parentId: selected.mode === "existing" ? selected.id : "", parentAttempted: false, childAttempted: false, childId: "" };
    }
    if (state.siteKey !== entity.siteKey || state.parentListId !== parent.list.id || state.childListId !== child.list.id) throw new Error("A retentativa deve manter as mesmas listas e site da gravação original.");
    if (!state.parentAttempted && !state.childAttempted) {
      const matches = await matchingItems(repository, entity.siteKey, child.list, child.columns, child.fields.Title, state.fields[child.fields.Title]);
      if (!Array.isArray(matches) || matches.length) throw new Error("Já existe um registro com este título; revise o vínculo antes de criar um descritivo.");
    }
    if (!state.childId) {
      if (state.choice.mode === "new") {
        // Only the total may legitimately differ after a previous total update.
        const parentPayload = { ...state.parentPayload };
        if (state.parentId && state.childAttempted) delete parentPayload[parent.fields.VALORTOTAL];
        const created = await recoverOrCreate(repository, entity.siteKey, parent, parentPayload, parent.fields.Title, state, "parent", PARENT_DATES.map(name => parent.fields[name]));
        state.parentEtag = requirePending(created, parent.fields, state.parentId);
      }
      const childPayload = { ...state.fields, [child.fields.DESCRITIVOPROVISAO]: positiveId(state.parentId) };
      // Validate after token lookup, immediately before POST. An attempted POST only recovers.
      const validateParent = async () => {
        if (state.choice.mode === "existing") await requirePendingChildren(repository, entity, child, state.parentId);
        const current = await repository.getItem(entity.siteKey, parent.list.id, state.parentId, "$expand=fields");
        requirePending(current, parent.fields, state.parentId, state.choice.mode === "existing" ? state.choice.eTag : state.parentEtag);
      };
      await recoverOrCreate(repository, entity.siteKey, child, childPayload, child.fields.Title, state, "child", childDateNames, validateParent);
    }
    const saved = await repository.getItem(entity.siteKey, child.list.id, state.childId, "$expand=fields");
    if (positiveId(saved?.id) !== state.childId) throw new Error("A provisão recuperada tem identidade conflitante.");
    verifyPayload(saved, { ...state.fields, [child.fields.DESCRITIVOPROVISAO]: state.parentId }, childDateNames);
    await updateTotal(repository, entity, parent, child, state);
    return { ...saved, provisionRetryState: freeze({ ...state }) };
  } catch (error) {
    if (state && (state.createStarted || state.parentAttempted || state.childAttempted || state.childId)) error.provisionRetryState = freeze({ ...state });
    throw error;
  }
}
