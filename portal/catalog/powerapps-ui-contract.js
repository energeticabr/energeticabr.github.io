import POWERAPPS_FORM_FIELDS from "./powerapps-form-contracts.generated.js";
import POWERAPPS_FORM_CONTROLS, { POWERAPPS_FORM_VARIANTS } from "./powerapps-form-controls.generated.js";
import {
  POWERAPPS_GALLERY_UI_CONTRACTS,
  galleryUiContractsForEntity,
} from "./powerapps-gallery-ui-contract.js";

const TECHNICAL_FIELDS = Object.freeze(new Set([
  "ID",
  "CONTENTTYPE",
  "ATTACHMENTS",
  "CREATED",
  "MODIFIED",
  "AUTHOR",
  "EDITOR",
  "COMPLIANCEASSETID",
  "UIVERSIONSTRING",
  "GUID",
]));

const DEFAULT_CONTRACT = Object.freeze({
  formFields: Object.freeze([]),
  galleryColumns: Object.freeze(["*"]),
  filterFields: Object.freeze([]),
  searchFields: Object.freeze([]),
  hasForm: false,
  readOnly: true,
  multiple: false,
  dateFormat: "shortDate",
});

const CONTRACTS = Object.freeze({
  lancamentos: Object.freeze({
    galleryColumns: Object.freeze(["FILIAL", "DATA", "FORNECEDOR", "PRODUTO", "DESCRICAO", "DESCRIÇÃO", "CONCLUIDO", "CONCLUÍDO"]),
    filterFields: Object.freeze(["FILIAL", "CONCLUIDO", "CONCLUÍDO"]),
    searchFields: Object.freeze(["FILIAL", "FORNECEDOR", "PRODUTO", "DESCRICAO", "DESCRIÇÃO"]),
    multiple: true,
    dateFormat: "shortDate",
  }),
  produtos: Object.freeze({
    galleryColumns: Object.freeze(["Title", "field_1", "SATUS", "TIPO", "GERADESEMBOLSO", "TIPODESPESA"]),
  }),
  compras: Object.freeze({ ...DEFAULT_CONTRACT, multiple: true }),
  "linhas-de-contrato": Object.freeze({ ...DEFAULT_CONTRACT, multiple: true }),
  "linhas-de-medicao": Object.freeze({ ...DEFAULT_CONTRACT, multiple: true }),
});

const GALLERY_FIELD_ALIASES = Object.freeze({
  lancamentos: Object.freeze({
    FILIAL: Object.freeze(["FILIAL", "Title"]),
  }),
});

const FALLBACK_FORM_MODES = Object.freeze({
  "homologacoes-de-fornecedor": Object.freeze(["create"]),
});

function canonicalFieldName(value) {
  return String(value || "")
    .replace(/_x([0-9a-f]{4})_/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^_+|_+$/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLocaleUpperCase("pt-BR");
}

export function isTechnicalPowerAppsField(name) {
  return TECHNICAL_FIELDS.has(canonicalFieldName(name));
}

function freezeContract(contract = {}) {
  return Object.freeze({
    formFields: Object.freeze([...(contract.formFields ?? DEFAULT_CONTRACT.formFields)]),
    galleryColumns: Object.freeze([...(contract.galleryColumns || DEFAULT_CONTRACT.galleryColumns)]),
    filterFields: Object.freeze([...(contract.filterFields || [])]),
    searchFields: Object.freeze([...(contract.searchFields || [])]),
    hasForm: contract.hasForm === true,
    readOnly: contract.readOnly !== false,
    multiple: contract.multiple === true,
    dateFormat: contract.dateFormat === "shortDate" ? "shortDate" : DEFAULT_CONTRACT.dateFormat,
    mode: contract.mode === "edit" ? "edit" : "create",
    formVariant: contract.formVariant || null,
    formVariants: Object.freeze([...(contract.formVariants || [])]),
    formVariantConflict: contract.formVariantConflict === true,
    requiresVariantSelection: contract.requiresVariantSelection === true,
    galleryVariant: contract.galleryVariant || null,
    galleryVariants: Object.freeze([...(contract.galleryVariants || [])]),
    galleryVariantConflict: contract.galleryVariantConflict === true,
    requiresGallerySelection: contract.requiresGallerySelection === true,
  });
}

function variantsForMode(entityId, mode) {
  const variants = POWERAPPS_FORM_VARIANTS[entityId] || [];
  return variants.filter(variant => (
    (variant.modes || [variant.mode]).includes(mode)
    && variant.submitEvidence?.entityId === entityId
    && variant.submitEvidence?.actions?.includes(mode)
  ));
}

function selectedVariant(entityId, mode, formVariantId) {
  const candidates = variantsForMode(entityId, mode);
  if (!candidates.length) return { candidates, selected: null, conflict: false };
  const requested = candidates.find(variant => variant.id === formVariantId);
  if (requested) return { candidates, selected: requested, conflict: false };
  const conflict = candidates.length > 1;
  return {
    candidates,
    selected: conflict ? null : candidates[0],
    conflict,
  };
}

export function powerAppsFormVariantLabel(variant = {}) {
  const artifact = String(variant.fileName || variant.submitEvidence?.artifact || "")
    .replace(/\.pa\.yaml$/i, "")
    .trim();
  const formName = String(variant.formName || variant.submitEvidence?.formName || "").trim();
  return [artifact, formName].filter(Boolean).join(" · ");
}

function galleryVariantId(contract = {}) {
  const identity = contract.identity || {};
  return [identity.fileName, identity.screenName, identity.galleryName]
    .map(value => String(value || "").trim())
    .join("::");
}

function readablePowerAppsName(value) {
  return String(value || "")
    .replace(/\.pa\.yaml$/iu, "")
    .replace(/^[A-Z]+\d+(?:_\d+)?\s*-\s*/iu, "")
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|\s)(\p{L})/gu, (_match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("pt-BR")}`);
}

export function powerAppsGalleryVariantLabel(variant = {}) {
  const identity = variant.identity || variant.contract?.identity || {};
  const screen = readablePowerAppsName(identity.screenName || identity.fileName);
  const gallery = String(identity.galleryName || "").trim();
  return screen || gallery || "Galeria do Power Apps";
}

function galleryVariantsForEntity(entityId, catalog) {
  const contracts = galleryUiContractsForEntity(entityId, catalog)
    .filter(contract => contract?.status === "resolved" && contract.visibleFields?.status === "resolved");
  const labels = contracts.map(powerAppsGalleryVariantLabel);
  const labelCounts = new Map(labels.map(label => [label, labels.filter(candidate => candidate === label).length]));
  return contracts.map((contract, index) => {
    const baseLabel = labels[index];
    const galleryName = String(contract.identity?.galleryName || "").trim();
    return Object.freeze({
      ...contract,
      id: galleryVariantId(contract),
      label: labelCounts.get(baseLabel) > 1 && galleryName ? `${baseLabel} · ${galleryName}` : baseLabel,
    });
  });
}

function selectedGalleryVariant(entityId, galleryVariantIdValue, catalog) {
  const candidates = galleryVariantsForEntity(entityId, catalog);
  const requested = candidates.find(variant => variant.id === galleryVariantIdValue);
  if (requested) return { candidates, selected: requested, conflict: false };
  const conflict = candidates.length > 1;
  return {
    candidates,
    selected: candidates.length === 1 ? candidates[0] : null,
    conflict,
  };
}

export function getPowerAppsUiContract(entityId, options = {}) {
  const id = String(entityId || "");
  const mode = options.mode === "edit" ? "edit" : "create";
  const variant = selectedVariant(id, mode, String(options.formVariantId || ""));
  const galleryVariant = selectedGalleryVariant(
    id,
    String(options.galleryVariantId || ""),
    options.galleryCatalog || POWERAPPS_GALLERY_UI_CONTRACTS,
  );
  const generatedFields = variant.selected
    ? variant.selected.formFields
    : variant.candidates.length
      ? []
      : POWERAPPS_FORM_VARIANTS[id]?.length
        ? []
        : (FALLBACK_FORM_MODES[id] || ["create", "edit"]).includes(mode) ? [
          ...(POWERAPPS_FORM_FIELDS[id] || []),
          ...Object.keys(POWERAPPS_FORM_CONTROLS[id] || {}),
        ] : [];
  const formFields = [...new Set(generatedFields)].filter(fieldName => !isTechnicalPowerAppsField(fieldName));
  const hasForm = variant.candidates.length > 0 || formFields.length > 0;
  const requiresVariantSelection = variant.conflict && !variant.selected;
  const usesGeneratedFallback = variant.candidates.length === 0 && formFields.length > 0;
  return freezeContract({
    ...DEFAULT_CONTRACT,
    ...(CONTRACTS[id] || {}),
    formFields: hasForm ? formFields : DEFAULT_CONTRACT.formFields,
    hasForm,
    readOnly: !hasForm || (!variant.selected && !usesGeneratedFallback),
    mode,
    formVariant: variant.selected,
    formVariants: variant.candidates,
    formVariantConflict: variant.conflict,
    requiresVariantSelection,
    galleryVariant: galleryVariant.selected,
    galleryVariants: galleryVariant.candidates,
    galleryVariantConflict: galleryVariant.conflict,
    requiresGallerySelection: galleryVariant.conflict && !galleryVariant.selected,
  });
}

function availableColumns(columns = []) {
  return (columns || []).filter(column => !column.hidden && !isTechnicalPowerAppsField(column.name));
}

function declarationAliases(entityId, declaration) {
  const aliases = GALLERY_FIELD_ALIASES[entityId]?.[canonicalFieldName(declaration)];
  return aliases || [declaration];
}

function selectColumns(columns, declarations, predicate = () => true, entityId = "") {
  const candidates = availableColumns(columns).filter(predicate);
  if ((declarations || []).includes("*")) return candidates;
  const byCanonicalName = new Map(candidates.map(column => [canonicalFieldName(column.name), column]));
  const selected = [];
  const seen = new Set();
  for (const declaration of declarations || []) {
    const column = declarationAliases(entityId, declaration)
      .map(alias => byCanonicalName.get(canonicalFieldName(alias)))
      .find(Boolean);
    if (column && !seen.has(column.name)) {
      selected.push(column);
      seen.add(column.name);
    }
  }
  return selected;
}

function selectFieldNames(columns, declarations, entityId) {
  const selected = selectColumns(columns, declarations, () => true, entityId);
  return selected.map(column => column.name);
}

function galleryColumnForDeclaration(columns, declaration, entityId) {
  const aliases = declarationAliases(entityId, declaration).map(canonicalFieldName);
  const matches = (columns || []).filter(column => (
    column.hidden !== true
    && aliases.some(alias => [column.name, column.label, column.displayName]
      .map(canonicalFieldName)
      .includes(alias))
  ));
  return matches.length === 1 ? matches[0] : null;
}

function selectGalleryColumns(columns, declarations, entityId) {
  const selected = [];
  const seen = new Set();
  for (const declaration of declarations || []) {
    const column = galleryColumnForDeclaration(columns, declaration, entityId);
    if (column && !seen.has(column.name)) {
      selected.push(column);
      seen.add(column.name);
    }
  }
  return selected;
}

function galleryFieldName(columns, declaration, entityId) {
  return galleryColumnForDeclaration(columns, declaration, entityId)?.name || "";
}

function fallbackGalleryDeclarations(declared, entity) {
  return declared.galleryColumns.includes("*")
    ? POWERAPPS_FORM_FIELDS[String(entity.id || "")] || [...(entity.searchFields || ["Title"]), ...(entity.statusFields || [])]
    : declared.galleryColumns;
}

function safeGalleryFilters(galleryVariant, columns, entityId, fallbackFilters) {
  if (galleryVariant?.filter?.status !== "resolved") {
    return { fields: fallbackFilters, fixed: {} };
  }
  const fields = [];
  const fixed = {};
  for (const clause of galleryVariant.filter.values || []) {
    const field = galleryFieldName(columns, clause.field, entityId);
    const column = columns.find(candidate => candidate.name === field);
    if (!field || !column) return { fields: fallbackFilters, fixed: {} };
    if (clause.kind === "optional-equals") {
      fields.push(field);
    } else if (
      clause.kind === "fixed-equals"
      && column.indexed === true
      && ["text", "select", "number", "currency"].includes(column.control)
    ) {
      fixed[field] = clause.value;
    } else {
      return { fields: fallbackFilters, fixed: {} };
    }
  }
  return { fields: [...new Set(fields)], fixed };
}

function safeGallerySearch(galleryVariant, columns, entityId, fallbackSearch) {
  if (galleryVariant?.search?.status !== "resolved") return fallbackSearch;
  const fields = [];
  for (const clause of galleryVariant.search.values || []) {
    const field = galleryFieldName(columns, clause.field, entityId);
    const column = columns.find(candidate => candidate.name === field);
    if (clause.kind !== "starts-with" || !field || column?.indexed !== true || column.control !== "text") {
      return fallbackSearch;
    }
    fields.push(field);
  }
  return [...new Set(fields)];
}

function safeGallerySort(galleryVariant, columns, entityId) {
  if (galleryVariant?.sort?.status !== "resolved") return null;
  const field = galleryFieldName(columns, galleryVariant.sort.field, entityId);
  const column = columns.find(candidate => candidate.name === field);
  const compatible = ["text", "select", "number", "currency", "date", "datetime-local", "toggle"].includes(column?.control);
  if (!field || column?.indexed !== true || !compatible) return null;
  return Object.freeze({
    field,
    direction: galleryVariant.sort.direction === "descending" ? "desc" : "asc",
  });
}

function ambiguousPowerAppsFormControl(column, variants) {
  const fieldVariants = variants
    .filter(variant => variant.fields?.[column.name])
    .map(variant => Object.freeze({
      id: variant.id,
      mode: variant.mode,
      fileName: variant.fileName,
      formName: variant.formName,
      field: variant.fields[column.name],
    }));
  if (!fieldVariants.length) return column;
  const powerApps = Object.freeze({
    closed: true,
    failClosed: true,
    preserveCurrentValue: true,
    searchable: false,
    choices: Object.freeze([]),
    optionSources: Object.freeze([]),
    ambiguous: true,
    formVariants: Object.freeze(fieldVariants),
  });
  const optionSources = powerApps.optionSources || [];
  const preservesNativeRelation = (column.control === "lookup" || column.control === "person")
    && optionSources.length > 0
    && optionSources.every(source => source.kind === "person" || source.kind === "sharepoint-choice");
  if (preservesNativeRelation) {
    return Object.freeze({
      ...column,
      relation: Object.freeze({ ...(column.relation || {}), resolvable: false }),
      searchable: false,
      powerApps,
    });
  }
  return Object.freeze({ ...column, control: "select", choices: Object.freeze([]), searchable: false, powerApps });
}

function applyPowerAppsFormControl(column, powerApps) {
  if (!powerApps) return column;
  const label = powerApps.displayName || column.label;
  const literalDefault = powerApps.defaultSelection?.kind === "literal"
    ? powerApps.defaultSelection.values || []
    : [];
  const defaultValue = literalDefault.length
    ? column.allowMultipleValues === true ? literalDefault : literalDefault[0]
    : column.defaultValue;
  if (powerApps.closed !== true) {
    const powerAppsControl = powerApps.powerAppsControl;
    const control = powerAppsControl === "DatePicker"
      ? "date"
      : powerAppsControl === "CheckBox" || powerAppsControl === "Toggle"
        ? "checkbox"
        : column.control;
    return Object.freeze({
      ...column,
      label,
      control,
      choices: Object.freeze([]),
      searchable: false,
      ...(defaultValue === undefined ? {} : { defaultValue }),
    });
  }
  const optionSources = powerApps.optionSources || [];
  const searchable = powerApps.searchable === true
    && optionSources.some(source => source.kind !== "unresolved");
  const preservesNativeRelation = (column.control === "lookup" || column.control === "person")
    && optionSources.length > 0
    && optionSources.every(source => source.kind === "person" || source.kind === "sharepoint-choice");
  if (preservesNativeRelation) {
    return Object.freeze({
      ...column,
      label,
      ...(defaultValue === undefined ? {} : { defaultValue }),
      searchable,
      powerApps,
    });
  }
  const literalChoices = powerApps.choices || [];
  const choices = literalChoices.length
    ? literalChoices
    : column.control === "select"
      ? column.choices
      : Object.freeze([]);
  return Object.freeze({
    ...column,
    label,
    ...(defaultValue === undefined ? {} : { defaultValue }),
    control: "select",
    choices,
    searchable,
    powerApps,
  });
}

export function resolvePowerAppsUiContract(entity = {}, columns = [], options = {}) {
  const declared = getPowerAppsUiContract(entity.id, options);
  const variantFields = declared.formVariant?.fields || {};
  const contractColumns = (columns || []).map(column => (
    declared.formVariant
      ? applyPowerAppsFormControl(column, variantFields[column.name])
      : declared.formVariantConflict
        ? ambiguousPowerAppsFormControl(column, declared.formVariants)
        : column
  ));
  const fallbackSearch = declared.searchFields.length ? declared.searchFields : (entity.searchFields || ["Title"]);
  const fallbackFilters = declared.filterFields.length
    ? declared.filterFields
    : [...(entity.filterFields || []), ...(entity.statusFields || []), ...availableColumns(columns).filter(column => column.control === "select").map(column => column.name)];
  const entityId = String(entity.id || "");
  const fallbackDeclarations = fallbackGalleryDeclarations(declared, entity);
  const fallbackGalleryColumns = selectColumns(columns, fallbackDeclarations, () => true, entityId).slice(0, 8);
  const contractedGalleryColumns = declared.galleryVariant
    ? selectGalleryColumns(columns, declared.galleryVariant.visibleFields.values, entityId)
    : [];
  const galleryColumns = contractedGalleryColumns.length ? contractedGalleryColumns : fallbackGalleryColumns;
  const fallbackFilterFields = selectFieldNames(columns, fallbackFilters, entityId);
  const fallbackSearchFields = selectFieldNames(columns, fallbackSearch, entityId);
  const galleryFilters = safeGalleryFilters(declared.galleryVariant, columns, entityId, fallbackFilterFields);
  const gallerySearchFields = safeGallerySearch(declared.galleryVariant, columns, entityId, fallbackSearchFields);
  const gallerySort = safeGallerySort(declared.galleryVariant, columns, entityId);
  const formColumns = selectColumns(contractColumns, declared.formFields, column => column.editable === true);
  return Object.freeze({
    entityId,
    hasForm: declared.hasForm,
    readOnly: declared.readOnly,
    formColumns: Object.freeze(formColumns),
    galleryColumns: Object.freeze(galleryColumns),
    filterFields: Object.freeze(galleryFilters.fields),
    searchFields: Object.freeze(gallerySearchFields),
    galleryFixedFilters: Object.freeze({ ...galleryFilters.fixed }),
    gallerySort,
    multiple: declared.multiple,
    dateFormat: declared.dateFormat,
    mode: declared.mode,
    formVariant: declared.formVariant,
    formVariants: declared.formVariants,
    formVariantConflict: declared.formVariantConflict,
    requiresVariantSelection: declared.requiresVariantSelection,
    galleryVariant: declared.galleryVariant,
    galleryVariants: declared.galleryVariants,
    galleryVariantConflict: declared.galleryVariantConflict,
    requiresGallerySelection: declared.requiresGallerySelection,
  });
}

export default CONTRACTS;
