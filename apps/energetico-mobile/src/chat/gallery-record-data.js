import { ENTITIES } from "../../../../portal/catalog/entities.js";
import { resolvePowerAppsUiContract } from "../../../../portal/catalog/powerapps-ui-contract.js";
import { mapSharePointColumns, validateFormValues } from "../../../../portal/data/column-mapper.js";
import { createForm43StatusPolicy } from './orders-form43-locks.js';
import { payrollEditorColumns, createPayrollSourceReader, payrollFieldKey } from './payroll-editor-policy.js';
import { createPayrollSheetReader } from './payroll-sheet-options.js';
import { createPayrollLaunchReader } from './payroll-launch-options.js';
import { createPayrollSheetAttachments } from './payroll-sheet-attachments.js';

function key(value) {
  return String(value || "").replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function idValue(value) {
  const id = String(value ?? "").trim();
  if (!/^[1-9]\d{0,14}$/.test(id)) throw new RangeError("O ID do registro não é válido.");
  return id;
}

function version(value) {
  const eTag = String(value ?? "").trim();
  if (!eTag || eTag === "*") throw new Error("Recarregue o registro; a versão ETag não foi identificada.");
  return eTag;
}

function frozenCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (value && typeof value === "object") return Object.freeze(Object.fromEntries(Object.entries(value).map(([name, item]) => [name, frozenCopy(item)])));
  return value;
}

function abort(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("A consulta foi cancelada.", "AbortError");
}

function inputName(column) {
  return ["lookup", "person"].includes(column.control) ? `${column.name}LookupId` : column.name;
}

function relationshipSearchDescriptor(column) {
  const relation = column.relation;
  if (!relation) throw new Error("A origem relacional não está disponível.");
  if (relation.multiple !== true) return relation;
  const safeDisplayField = /^[A-Za-z_][A-Za-z0-9_]*$/.test(relation.displayField || "");
  const safeSource = relation.kind === "lookup" ? Boolean(relation.listId)
    : relation.kind === "person" && String(relation.principalType || "").toLowerCase() === "peopleonly";
  if (!safeDisplayField || !safeSource || column.powerApps?.ambiguous || column.powerApps?.sharedControlAnchor) {
    throw new Error(`A opção de ${column.label} não pôde ser comprovada.`);
  }
  // Search individual options of a multi-value field using its owned metadata.
  return Object.freeze({ ...relation, multiple: false, resolvable: true });
}

function comparable(value, column) {
  if (value == null || value === "") return "";
  if (column.control === "date") return String(value).slice(0, 10);
  if (column.control === "datetime-local") return String(value).slice(0, 16);
  if (["lookup", "person", "number", "currency"].includes(column.control) && !Array.isArray(value)) return String(Number(value));
  if (Array.isArray(value)) return JSON.stringify(value.map(String));
  return String(value);
}

function selections(value, column) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.map(String);
  const serialization = column.powerApps?.multipleSerialization;
  if (column.allowMultipleValues && serialization?.kind === "concat" && serialization.delimiter?.trim()) {
    return String(value).split(serialization.delimiter).map(v => v.trim()).filter(Boolean);
  }
  return [String(value)];
}

function concreteSources(source) {
  if (source?.kind === "conditional") return [...(source.branches || []).flatMap(branch => concreteSources(branch.source)), ...concreteSources(source.fallback)];
  return [source].filter(Boolean);
}

function sourceDependencies(source) {
  return [...(source?.dependsOn || []), ...(source?.selector ? [source.selector] : []),
    ...(source?.branches || []).flatMap(branch => sourceDependencies(branch.source)),
    ...(source?.fallback ? sourceDependencies(source.fallback) : [])];
}

function recordValue(columns, fields, reference) {
  const wanted = key(reference);
  const column = columns.find(c => key(c.name) === wanted || key(c.label) === wanted);
  return column ? fields[inputName(column)] ?? fields[column.name] : Object.entries(fields).find(([name]) => key(name) === wanted)?.[1];
}

function resolvedSource(source, columns, fields) {
  if (source.kind !== "conditional") return source;
  const value = String(recordValue(columns, fields, source.selector?.fieldName) ?? "").trim().toUpperCase();
  const branch = source.branches?.find(candidate => candidate.when?.operator === "else"
    || candidate.when?.values?.some(item => String(item).trim().toUpperCase() === value));
  return branch?.source || source.fallback;
}

function dependenciesFor(source, columns, fields) {
  return Object.fromEntries((source.dependsOn || []).flatMap(dependency => {
    const value = recordValue(columns, fields, dependency.fieldName);
    if ((value == null || value === "") && dependency.optional) return [];
    return [[dependency.fieldName, value ?? ""]];
  }));
}

function typedColumns(rawColumns, entity, metadataOnly) {
  const verified = metadataOnly ? rawColumns.filter(c => ["text", "multilineText", "number", "currency", "dateTime", "boolean", "choice", "lookup", "personOrGroup", "calculated"].some(type => c?.[type] != null)) : rawColumns;
  return mapSharePointColumns(verified, entity).map(column => {
    const raw = verified.find(c => c.name === column.name);
    return Object.freeze({ ...column, allowMultipleValues: raw?.choice?.allowMultipleValues === true
      || raw?.lookup?.allowMultipleValues === true || raw?.personOrGroup?.allowMultipleSelection === true });
  });
}

/** Edit contexts belong to one service instance; their loaded ETag is never refreshed on save. */
export function createGalleryRecordData({ repository, siteKey = "personal", listAliases = [], listName, resolveList, metadataOnly = false, entity: suppliedEntity, now=()=>new Date(), assertSession=()=>{} } = {}) {
  const aliases = new Set([listName, ...listAliases].map(key));
  const entity = suppliedEntity || ENTITIES.find(candidate => candidate.listNames.some(name => aliases.has(key(name))))
    || (metadataOnly ? Object.freeze({ id: `gallery-${key(listName).toLowerCase()}`, title: listName, siteKey, immutableFields: [], messageFields: [] }) : null);
  const contexts = new WeakMap();
  const isPayroll = key(listName) === 'FOLHAPGTO';
  const isPayrollSheet = key(listName) === 'IDFOLHA';
  const readPayrollSource = isPayroll ? createPayrollSourceReader(repository, siteKey) : null;
  const payrollSheets=isPayroll?createPayrollSheetReader(repository,siteKey,now):null;
  const payrollLaunches=isPayroll?createPayrollLaunchReader(repository,siteKey):null;

  async function currentItem(list, id, signal) {
    if (typeof repository.getItem !== "function") throw new Error("A consulta segura do registro não está disponível.");
    abort(signal);
    const item = await repository.getItem(siteKey, list.id, id, "$expand=fields", signal ? { signal } : {});
    abort(signal);
    if (!item || String(item.id) !== id) throw new Error("O SharePoint não devolveu o registro solicitado.");
    const eTag = version(item.eTag || item["@odata.etag"] || item["odata.etag"]);
    return frozenCopy({ ...item, id, eTag, fields: item.fields || {} });
  }

  async function loadEditor(rawId, { signal, formVariantId } = {}) {
    if (!entity) throw new Error("Não foi possível identificar o formulário seguro desta lista.");
    if (typeof repository.getColumns !== "function") throw new Error("Os metadados do formulário não estão disponíveis.");
    const id = idValue(rawId), list = frozenCopy(await resolveList(signal));
    let [item, rawColumns] = await Promise.all([currentItem(list, id, signal), repository.getColumns(siteKey, list.id, signal ? { signal } : {})]);
    const refreshDerivedValues = isPayroll ? async (draft = {}, options = {}) => {
      const derived = await readPayrollSource({ ...item.fields, ...draft }, options.signal);
      return Object.fromEntries(Object.entries(derived).map(([name, value]) => [
        rawColumns.find(c => payrollFieldKey(c.name) === name)?.name || name, value,
      ]));
    } : undefined;
    if (isPayroll) item = frozenCopy({ ...item, fields: { ...item.fields, ...await refreshDerivedValues({}, { signal }) } });
    abort(signal);
    const mapped = typedColumns(Array.isArray(rawColumns) ? rawColumns : [], entity, metadataOnly);
    let contract = resolvePowerAppsUiContract(entity, mapped, { mode: "edit", ...(formVariantId ? { formVariantId } : {}) });
    if (formVariantId && !contract.formVariants.some(variant => variant.id === formVariantId)) throw new Error("A variante de formulário solicitada não foi comprovada.");
    if (metadataOnly && !contract.hasForm) {
      const safeColumns = Object.freeze(mapped.filter(c => c.editable && !c.hidden));
      contract = Object.freeze({ ...contract, hasForm: safeColumns.length > 0, readOnly: safeColumns.length === 0,
        metadataOnly: true, formColumns: safeColumns });
    }
    const sheetColumn=isPayroll?rawColumns.find(c=>payrollFieldKey(c.name)==='IDFOLHA'):null;
    const sheetSupplier=isPayroll?Object.entries(item.fields).find(([name])=>payrollFieldKey(name)==='FORNECEDOR')?.[1]:null;
    const sheetOptions=sheetColumn?await payrollSheets.options(sheetSupplier,{signal}):[];
    const launchColumn=isPayroll?rawColumns.find(c=>payrollFieldKey(c.name)==='IDLANCAMENTO'):null;
    const launchOptions=launchColumn?await payrollLaunches.options({signal}):[];
    abort(signal);
    const formColumns = isPayrollSheet ? contract.formColumns.map(column =>
      (key(column.name) === 'STATUS' || key(column.label) === 'STATUS') && !column.allowMultipleValues
        && ['text', 'textarea', 'select'].includes(column.control)
        ? { ...column, control: 'select', allowMultipleValues: false, choices: ['ATIVO', 'INATIVO'],
          // Match the selector's trimmed label without changing the stored value.
          optionLabels: { ...column.optionLabels,
            ...(typeof item.fields[column.name] === 'string' && item.fields[column.name]
              ? { [item.fields[column.name]]: item.fields[column.name].trim() || 'Sem status' } : {}) },
          powerApps: { closed: true, preserveCurrentValue: true } }
        : column) : contract.formColumns;
    const columns = frozenCopy(isPayroll ? payrollEditorColumns(formColumns,sheetOptions,launchOptions) : formColumns);
    contract = frozenCopy({ ...contract, formColumns: columns });
    const descriptors = new Map(columns.map(column => [column.name, column]));
    const relationshipOptions = new Map();
    const allowedColumn = candidate => {
      const column = descriptors.get(candidate?.name);
      if (!column || !column.editable || column.readOnly || column.hidden) throw new Error("O campo solicitado não pertence ao formulário editável.");
      return column;
    };
    const relationshipSearch = async (candidate, term, options = {}) => {
      const column = allowedColumn(candidate);
      if (!column.relation || typeof repository.searchRelationshipOptions !== "function") throw new Error("A origem relacional não está disponível.");
      const results = await repository.searchRelationshipOptions(siteKey, list.id, relationshipSearchDescriptor(column), term, options);
      if (!relationshipOptions.has(column.name)) relationshipOptions.set(column.name, new Map());
      for (const option of results) relationshipOptions.get(column.name).set(String(option.id), frozenCopy(option));
      return results;
    };
    const powerAppsOptionSearch = async (candidate, source, term, dependencies = {}, options = {}) => {
      const column = allowedColumn(candidate);
      const sources = (column.powerApps?.optionSources || []).flatMap(concreteSources);
      if (!sources.some(proven => JSON.stringify(proven) === JSON.stringify(source))) throw new Error("A origem de opções do campo não foi comprovada.");
      if (typeof repository.searchPowerAppsOptions !== "function") throw new Error("A origem de opções não está disponível.");
      return repository.searchPowerAppsOptions(siteKey, source, term, dependencies, options);
    };
    const statusColumn = columns.find(column => key(column.name) === 'STATUS' || key(column.label) === 'STATUS');
    const form43 = entity.id === 'notas-pendentes' && contract.formVariant?.formName === 'Form43' && statusColumn
      ? createForm43StatusPolicy({ repository, siteKey, orderId: id, orderColumns: rawColumns, statusFieldName: inputName(statusColumn), orderListId: list.id }) : null;
    const evaluateFieldLocks = form43 ? (draft = {}, options = {}) => form43.evaluate({ ...item.fields, ...draft }, options) : undefined;
    const sheetAttachments = isPayrollSheet ? createPayrollSheetAttachments({ repository, siteKey, list, item, columns, currentItem, assertSession }) : null;
    const context = Object.freeze({ entity: frozenCopy({ ...entity, siteKey }), columns, item, contract, relationshipSearch, powerAppsOptionSearch,
      ...(sheetAttachments ? { sheetAttachments } : {}),
      ...(refreshDerivedValues ? { refreshDerivedValues } : {}),
      ...(evaluateFieldLocks ? { evaluateFieldLocks } : {}) });
    contexts.set(context, { list, item, columns, contract, relationshipOptions, form43, statusColumn,sheetColumn,sheetSupplier,launchColumn,sheetAttachments });
    return context;
  }

  async function validateClosed(column, value, baseline, columns, merged) {
    const values = selections(value, column);
    if (!values.length) return;
    if (["lookup", "person"].includes(column.control)) {
      const relation = relationshipSearchDescriptor(column);
      if (!relation.resolvable || typeof repository.searchRelationshipOptions !== "function") throw new Error(`A opção de ${column.label} não pôde ser comprovada.`);
      const retainedIds = new Set(selections(baseline.item.fields[inputName(column)], column));
      for (const selected of values) {
        if (retainedIds.has(selected)) continue;
        const proof = baseline.relationshipOptions.get(column.name)?.get(selected);
        if (!proof) throw new Error(`Selecione uma opção válida para ${column.label}.`);
        const options = await repository.searchRelationshipOptions(siteKey, baseline.list.id, relation, proof.label, { limit: 40 });
        if (!options.some(option => String(option.id) === selected)) throw new Error(`Selecione uma opção válida para ${column.label}.`);
      }
      return;
    }
    if (column.control !== "select") return;
    const sources = column.powerApps?.optionSources || [];
    const literal = (column.powerApps?.choices?.length ? column.powerApps.choices : column.choices) || [];
    const pending = values.filter(selected => !literal.map(String).includes(selected));
    if (!pending.length) return;
    const remote = sources.map(source => resolvedSource(source, columns, merged)).filter(source => ["related", "filtered-list", "dependent"].includes(source?.kind));
    if (remote.length !== 1 || typeof repository.searchPowerAppsOptions !== "function") throw new Error(`Selecione uma opção válida para ${column.label}.`);
    const source = remote[0], dependencies = dependenciesFor(source, columns, merged);
    for (const selected of pending) {
      const options = await repository.searchPowerAppsOptions(siteKey, source, selected, dependencies, { limit: 40 });
      if (!options.some(option => String(option.value) === selected)) throw new Error(`Selecione uma opção válida para ${column.label}.`);
    }
  }

  async function saveEditor(context, fields, options = {}) {
    const baseline = context && contexts.get(context);
    if (!baseline) throw new Error("O contexto de edição não pertence a esta galeria. Reabra o registro.");
    if (baseline.saving) throw new Error("A gravação desta folha já está em andamento.");
    baseline.saving = true;
    try { return await persistEditor(context, fields, options); }
    finally { baseline.saving = false; }
  }

  async function persistEditor(context, fields, options = {}) {
    const baseline = context && contexts.get(context);
    if (!baseline) throw new Error("O contexto de edição não pertence a esta galeria. Reabra o registro.");
    if (baseline.contract.requiresVariantSelection || baseline.contract.readOnly) throw new Error("Selecione uma variante de formulário editável comprovada.");
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new TypeError("Os campos precisam ser um objeto.");
    const { columns, item, list } = baseline;
    const allowed = new Map(columns.filter(c => c.editable && !c.readOnly && !c.hidden).map(c => [inputName(c), c]));
    for (const name of Object.keys(fields)) if (!allowed.has(name)) throw new Error(`O campo ${name} não é editável neste formulário.`);
    const raw = {}, direct = {};
    for (const [name, value] of Object.entries(fields)) {
      const column = allowed.get(name);
      if (value != null && (typeof value === "object" && !Array.isArray(value)
        || Array.isArray(value) && !column.allowMultipleValues
        || !["string", "number", "boolean", "object"].includes(typeof value))) throw new Error(`O valor do campo ${column.label} não é válido.`);
      if (Array.isArray(value) && value.some(item => !["string", "number"].includes(typeof item))) throw new Error(`O valor do campo ${column.label} não é válido.`);
      if (column.control === "checkbox" && value != null && value !== "" && typeof value !== "boolean") throw new Error(`O valor do campo ${column.label} não é válido.`);
      if (["lookup", "person"].includes(column.control) && Array.isArray(value)) {
        if (!column.allowMultipleValues || value.some(v => !Number.isInteger(Number(v)) || Number(v) <= 0)) throw new Error(`Selecione uma opção válida para ${column.label}.`);
        if (column.required && !value.length) throw new Error(`Informe o campo ${column.label}.`);
        direct[name] = value.map(Number);
      } else raw[column.name] = value;
      if (["date", "datetime-local"].includes(column.control) && value != null && value !== "") {
        const text = String(value), date = text.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text)
          || Number.isNaN(Date.parse(text)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`Informe uma data válida para o campo ${column.label}.`);
      }
    }
    const validation = validateFormValues(raw, columns, entity, { mode: "edit" });
    if (Object.keys(validation.errors).length) throw new Error(Object.values(validation.errors).join(" "));
    const normalized = { ...validation.fields, ...direct };
    const sheetStatus = isPayrollSheet ? baseline.statusColumn : null;
    if (sheetStatus?.control === 'select' && !sheetStatus.allowMultipleValues) {
      const name = sheetStatus.name, original = item.fields[name];
      // The renderer trims submitted strings; retaining the same selection must
      // not rewrite or reject a legacy status while another field is edited.
      if (Object.hasOwn(normalized, name) && typeof original === 'string'
        && String(normalized[name] ?? '') === original.trim()) normalized[name] = original;
    }
    if(baseline.sheetColumn&&Object.hasOwn(normalized,baseline.sheetColumn.name)) {
      idValue(normalized[baseline.sheetColumn.name]);
      if(baseline.sheetColumn.number)normalized[baseline.sheetColumn.name]=Number(normalized[baseline.sheetColumn.name]);
    }
    if(baseline.launchColumn&&Object.hasOwn(normalized,baseline.launchColumn.name)) {
      // Select controls serialize strings; preserve the actual SharePoint numeric type.
      const id=String(normalized[baseline.launchColumn.name]??'').trim();
      if(!/^[1-9]\d{0,14}$/.test(id))throw new Error('O vínculo IDLANCAMENTO é inválido.');
      if(baseline.launchColumn.number)normalized[baseline.launchColumn.name]=Number(id);
    }
    const merged = { ...item.fields, ...normalized }, changed = {};
    if(baseline.sheetColumn)await payrollSheets.assertSheet(merged[baseline.sheetColumn.name],baseline.sheetSupplier);
    if(baseline.launchColumn)await payrollLaunches.assertLaunch(merged[baseline.launchColumn.name]);
    if (isPayroll) await readPayrollSource(merged);
    for (const [name, value] of Object.entries(normalized)) {
      const column = allowed.get(name);
      if (comparable(value, column) !== comparable(item.fields[name], column)) changed[name] = value;
    }
    // A retained child selection must also be checked if its parent changed.
    for (const column of columns) {
      const name = inputName(column);
      const dependencies = (column.powerApps?.optionSources || []).flatMap(sourceDependencies);
      const dependencyChanged = dependencies.some(dependency => {
        const before = recordValue(columns, item.fields, dependency.fieldName), after = recordValue(columns, merged, dependency.fieldName);
        return JSON.stringify(before) !== JSON.stringify(after);
      });
      if (Object.hasOwn(changed, name) || dependencyChanged) await validateClosed(column, merged[name], baseline, columns, merged);
    }
    let eTag = version(item.eTag);
    if (baseline.sheetAttachments) {
      const status = merged[baseline.statusColumn?.name];
      const inactive = (Array.isArray(status) ? status : [status]).some(value => String(value ?? '').trim().toUpperCase() === 'INATIVO');
      eTag = await baseline.sheetAttachments.prepare(options.attachments ?? [], { inactive, signal: options.signal });
    }
    assertSession();
    abort(options.signal);
    if (!Object.keys(changed).length) return item;
    if (baseline.form43) {
      const statusName = inputName(baseline.statusColumn);
      const statusChanged = Object.hasOwn(changed, statusName);
      const approvedDraft = String(changed[statusName] ?? item.fields[statusName] ?? '').trim().toUpperCase() === 'APROVADO';
      if (statusChanged || approvedDraft) {
        const current = await currentItem(list, item.id);
        const outgoing = { ...current.fields, ...changed };
        baseline.form43.assertApprovalDate(outgoing);
        if (statusChanged) {
          const locks = await baseline.form43.evaluate(outgoing, { refresh: true });
          const status = locks[statusName];
          if (!status.editable) throw new Error(`STATUS bloqueado: ${status.reasons.join(' ')}`);
        } else await baseline.form43.assertSubmit(outgoing);
      }
    }
    if (typeof repository.updateItem !== "function") throw new Error("A gravação segura não está disponível.");
    assertSession();
    abort(options.signal);
    const saved = await repository.updateItem(siteKey, list.id, item.id, changed, { eTag });
    contexts.delete(context);
    return saved || { id: item.id, fields: merged };
  }

  async function deleteItem(rawId, options = {}) {
    const id = idValue(rawId), list = await resolveList();
    const eTag = Object.hasOwn(options, "eTag") ? version(options.eTag) : (await currentItem(list, id)).eTag;
    if (typeof repository.deleteItem !== "function") throw new Error("A exclusão segura do registro não está disponível.");
    await repository.deleteItem(siteKey, list.id, id, { eTag });
    return true;
  }

  return Object.freeze({ loadEditor, saveEditor, deleteItem });
}
