const unsorted = () => Object.freeze({
  status: "unsorted",
  field: null,
  direction: null,
  indicator: "unsorted",
});

const sorted = (field, direction) => Object.freeze({
  status: "sorted",
  field,
  direction,
  indicator: direction === "asc" ? "ascending" : "descending",
});

function identityKey(identity = {}) {
  return [identity.fileName, identity.screenName, identity.galleryName]
    .map(value => String(value || "").trim())
    .join("::");
}

function auditedRule(fileName, screenName, galleryName, refresh, initialSort) {
  const identity = Object.freeze({ fileName, screenName, galleryName });
  return [identityKey(identity), Object.freeze({
    matched: true,
    identity,
    refresh: Object.freeze({
      present: refresh.controls.length > 0,
      controls: Object.freeze([...refresh.controls]),
      sources: Object.freeze([...refresh.sources]),
    }),
    initialSort,
  })];
}

const refresh = (controls, sources) => ({ controls, sources });
const noRefresh = refresh([], []);
const G28_IDENTITY_KEY = identityKey({
  fileName: "G28- HISTÓRICO PAG PREVISTO.pa.yaml",
  screenName: "G28- HISTÓRICO PAG PREVISTO",
  galleryName: "Gallery2_19",
});
const G28_PREDICTED_STATUS = "PAGAMENTO PREVISTO";

function canonicalFieldName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLocaleUpperCase("pt-BR");
}

function filterStatusValue(input = {}) {
  const filterSources = [
    input.filters,
    input.queryState?.filters,
    input.galleryDefaultFilters,
    input.uiContract?.galleryDefaultFilters,
    input.contract?.galleryDefaultFilters,
  ];
  for (const filters of filterSources) {
    const statusEntry = Object.entries(filters || {})
      .find(([field]) => canonicalFieldName(field) === "STATUS");
    if (statusEntry) return { present: true, value: statusEntry[1] };
  }
  return { present: false, value: undefined };
}

function selectedFilterValues(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null || value === "") return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    return [String(value)];
  }
}

function g28InitialSort(input) {
  const status = filterStatusValue(input);
  if (!status.present) return null;
  return selectedFilterValues(status.value).includes(G28_PREDICTED_STATUS)
    ? sorted("DATA PREVISTO PGTO", "asc")
    : sorted("Modified", "desc");
}

// Audited from the freshly downloaded ENERGÉTICA publication dated 2026-09-06.
export const POWERAPPS_GALLERY_TOOLBAR_RULES = Object.freeze(Object.fromEntries([
  auditedRule(
    "G1- HISTÓRICO LANÇAMENTOS.pa.yaml",
    "G1- HISTÓRICO LANÇAMENTOS",
    "Gallery1",
    refresh(["Image21_8"], ["LANCAMENTOS"]),
    sorted("ID", "desc"),
  ),
  auditedRule(
    "Screen10.pa.yaml",
    "Screen10",
    "Gallery6",
    refresh(["Icon64_12"], ["NOTASPENDENTES"]),
    sorted("ID", "desc"),
  ),
  auditedRule(
    "G28- HISTÓRICO PAG PREVISTO.pa.yaml",
    "G28- HISTÓRICO PAG PREVISTO",
    "Gallery2_19",
    refresh(["Icon64"], ["PROVISÃO PGTOS"]),
    sorted("DATA PREVISTO PGTO", "asc"),
  ),
  auditedRule(
    "G19- HISTÓRICOLOCACOES.pa.yaml",
    "G19- HISTÓRICOLOCACOES",
    "Gallery2_28",
    refresh(["Icon65"], ["DESPESASRECORRENTES"]),
    sorted("ID", "desc"),
  ),
  auditedRule(
    "G10- HISTÓRICO GRUPO.pa.yaml",
    "G10- HISTÓRICO GRUPO",
    "Gallery2_1",
    refresh(["Icon64_1"], ["CADASTROGRUPO"]),
    sorted("ID", "desc"),
  ),
  auditedRule(
    "G8- HISTÓRICO FAMÍLIA.pa.yaml",
    "G8- HISTÓRICO FAMÍLIA",
    "Gallery2",
    refresh(["Icon64_4"], ["CADASTRO FAMÍLIA_1"]),
    sorted("ID", "desc"),
  ),
  auditedRule(
    "G35- HISTÓRICO SUBFAMÍLIA.pa.yaml",
    "G35- HISTÓRICO SUBFAMÍLIA",
    "Gallery2_2",
    refresh(["Icon64_3"], ["CADASTROSUBFAMÍLIA"]),
    sorted("ID", "desc"),
  ),
  auditedRule(
    "G38- HISTÓRICO PRODUTO.pa.yaml",
    "G38- HISTÓRICO PRODUTO",
    "Gallery2_3",
    refresh(["Icon64_2"], ["CADASTROPRODUTO"]),
    sorted("ID", "desc"),
  ),
  auditedRule(
    "G41- HISTÓRICO UNIDADE MEDIDA.pa.yaml",
    "G41- HISTÓRICO UNIDADE MEDIDA",
    "Gallery2_4",
    refresh(["Image21_12"], ["CADASTROUNIDADEMEDIDA"]),
    unsorted(),
  ),
  auditedRule(
    "GALERIACONTA.pa.yaml",
    "GALERIACONTA",
    "Gallery8",
    noRefresh,
    unsorted(),
  ),
  auditedRule(
    "G42- HISTÓRICO FORNECEDOR.pa.yaml",
    "G42- HISTÓRICO FORNECEDOR",
    "Gallery2_5",
    refresh(["Icon64_5"], ["FORNECEDORES"]),
    sorted("ID", "desc"),
  ),
  auditedRule(
    "G40- HISTÓRICO FILIAIS.pa.yaml",
    "G40- HISTÓRICO FILIAIS",
    "Gallery2_7",
    refresh(["Icon64_6"], ["FILIAIS"]),
    unsorted(),
  ),
  auditedRule(
    "G15- HISTÓRICO IMÓVEIS.pa.yaml",
    "G15- HISTÓRICO IMÓVEIS",
    "Gallery2_18",
    refresh(["Image21_13"], ["IMOVEL CADASTRADO"]),
    sorted("IMOVEL", "asc"),
  ),
  auditedRule(
    "G36- HISTÓRICO CIDADE.pa.yaml",
    "G36- HISTÓRICO CIDADE",
    "Gallery2_6",
    noRefresh,
    unsorted(),
  ),
  auditedRule(
    "G2- HISTÓRICO TIPO MATERIAL.pa.yaml",
    "G2- HISTÓRICO TIPO MATERIAL",
    "Gallery1_3",
    refresh(["Image21_11"], ["CADASTROTIPOMATERIAL"]),
    unsorted(),
  ),
  auditedRule(
    "G13- HISTÓRICOGRUPOIMOBILIZADO.pa.yaml",
    "G13- HISTÓRICOGRUPOIMOBILIZADO",
    "Gallery2_29",
    noRefresh,
    sorted("ID", "desc"),
  ),
  auditedRule(
    "G14- HISTÓRICOIMOBILIZADO.pa.yaml",
    "G14- HISTÓRICOIMOBILIZADO",
    "Gallery2_30",
    noRefresh,
    unsorted(),
  ),
  auditedRule(
    "G22- HISTÓRICOLANCAMENTOIMOBILIZADO.pa.yaml",
    "G22- HISTÓRICOLANCAMENTOIMOBILIZADO",
    "Gallery2_27",
    refresh(["Icon50"], ["IMOBILIZADOS"]),
    sorted("VALOR RESIDUAL", "desc"),
  ),
]));

function identityFromInput(input) {
  if (typeof input === "string") {
    const [fileName = "", screenName = "", galleryName = ""] = input.split("::");
    return { fileName, screenName, galleryName };
  }

  const candidates = [
    input,
    input?.identity,
    input?.galleryVariant?.identity,
    input?.contract?.identity,
    input?.contract?.galleryVariant?.identity,
    input?.uiContract?.galleryVariant?.identity,
  ];
  return candidates.find(candidate => (
    candidate
    && typeof candidate === "object"
    && candidate.fileName
    && candidate.screenName
    && candidate.galleryName
  )) || {};
}

export function getPowerAppsGalleryToolbarRules(input = {}) {
  const candidate = identityFromInput(input);
  const identity = Object.freeze({
    fileName: String(candidate.fileName || "").trim(),
    screenName: String(candidate.screenName || "").trim(),
    galleryName: String(candidate.galleryName || "").trim(),
  });
  const audited = POWERAPPS_GALLERY_TOOLBAR_RULES[identityKey(identity)];
  if (audited) {
    const conditionalSort = identityKey(identity) === G28_IDENTITY_KEY ? g28InitialSort(input) : null;
    return conditionalSort
      ? Object.freeze({ ...audited, initialSort: conditionalSort })
      : audited;
  }

  return Object.freeze({
    matched: false,
    identity,
    refresh: Object.freeze({
      present: false,
      controls: Object.freeze([]),
      sources: Object.freeze([]),
    }),
    initialSort: Object.freeze({
      status: "unknown",
      field: null,
      direction: null,
      indicator: "unknown",
    }),
  });
}

export default getPowerAppsGalleryToolbarRules;
