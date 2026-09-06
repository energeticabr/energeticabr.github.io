import assert from "node:assert/strict";
import test from "node:test";

import { ENTITIES } from "../portal/catalog/entities.js";
import {
  getPowerAppsUiContract,
  resolvePowerAppsUiContract,
} from "../portal/catalog/powerapps-ui-contract.js";
import { entityGalleryMarkup, loadEntityData } from "../portal/ui/entity-page.js";

const EXPECTED_SURFACES = Object.freeze({
  lancamentos: Object.freeze({
    form: "F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml#FORMULÁRIO LANÇAMENTO",
    gallery: "G1- HISTÓRICO LANÇAMENTOS.pa.yaml::G1- HISTÓRICO LANÇAMENTOS::Gallery1",
  }),
  "notas-pendentes": Object.freeze({
    form: "F12- CADASTRO GRUPO_1.pa.yaml#Form42_7",
    gallery: "Screen10.pa.yaml::Screen10::Gallery6",
  }),
  "provisoes-de-pagamento": Object.freeze({
    form: "F3- CADASTRO PGTO PREV.pa.yaml#Form9",
    gallery: "G28- HISTÓRICO PAG PREVISTO.pa.yaml::G28- HISTÓRICO PAG PREVISTO::Gallery2_19",
  }),
  "despesas-recorrentes": Object.freeze({
    form: "F21- CADASTRO DESPESA RECORRENTE.pa.yaml#Form1_36",
    gallery: "G19- HISTÓRICOLOCACOES.pa.yaml::G19- HISTÓRICOLOCACOES::Gallery2_28",
  }),
  "cadastro-de-grupos": Object.freeze({
    form: "F12- CADASTRO GRUPO.pa.yaml#Form1",
    gallery: "G10- HISTÓRICO GRUPO.pa.yaml::G10- HISTÓRICO GRUPO::Gallery2_1",
  }),
  familias: Object.freeze({
    form: "F42- CADASTRO FAMÍLIA.pa.yaml#Form1_1",
    gallery: "G8- HISTÓRICO FAMÍLIA.pa.yaml::G8- HISTÓRICO FAMÍLIA::Gallery2",
  }),
  "cadastro-de-subfamilias": Object.freeze({
    form: "F43- CADASTRO SUBFAMÍLIA.pa.yaml#Form1_2",
    gallery: "G35- HISTÓRICO SUBFAMÍLIA.pa.yaml::G35- HISTÓRICO SUBFAMÍLIA::Gallery2_2",
  }),
  produtos: Object.freeze({
    form: "F37- CADASTRO PRODUTO.pa.yaml#Form1_5",
    gallery: "G38- HISTÓRICO PRODUTO.pa.yaml::G38- HISTÓRICO PRODUTO::Gallery2_3",
  }),
  "unidades-de-medida": Object.freeze({
    form: "F39- CADASTRO UNIDADEMEDIDA.pa.yaml#Form1_4",
    gallery: "G41- HISTÓRICO UNIDADE MEDIDA.pa.yaml::G41- HISTÓRICO UNIDADE MEDIDA::Gallery2_4",
  }),
  contas: Object.freeze({
    form: "I10- GERAL SUPRIMENTOS.pa.yaml#Form52_1",
    gallery: "GALERIACONTA.pa.yaml::GALERIACONTA::Gallery8",
  }),
  fornecedores: Object.freeze({
    form: "F10- CADASTRO FORNECEDOR.pa.yaml#Form2",
    gallery: "G42- HISTÓRICO FORNECEDOR.pa.yaml::G42- HISTÓRICO FORNECEDOR::Gallery2_5",
  }),
  filiais: Object.freeze({
    form: "F11- CADASTRO FILIAL.pa.yaml#Form3",
    gallery: "G40- HISTÓRICO FILIAIS.pa.yaml::G40- HISTÓRICO FILIAIS::Gallery2_7",
  }),
  imoveis: Object.freeze({
    form: "F26- CADASTRO IMÓVEL.pa.yaml#Form1_30",
    gallery: "G15- HISTÓRICO IMÓVEIS.pa.yaml::G15- HISTÓRICO IMÓVEIS::Gallery2_18",
  }),
  cidades: Object.freeze({
    form: "F40- CADASTRO CIDADE.pa.yaml#Form4",
    gallery: "G36- HISTÓRICO CIDADE.pa.yaml::G36- HISTÓRICO CIDADE::Gallery2_6",
  }),
  "tipos-de-material": Object.freeze({
    form: "F38- CADASTRO TIPO MATERIAL.pa.yaml#Form1_3",
    gallery: "G2- HISTÓRICO TIPO MATERIAL.pa.yaml::G2- HISTÓRICO TIPO MATERIAL::Gallery1_3",
  }),
  "grupos-de-imobilizados": Object.freeze({
    form: "F19- CADASTROGRUPOIMOBILIZADO.pa.yaml#Form1_37",
    gallery: "G13- HISTÓRICOGRUPOIMOBILIZADO.pa.yaml::G13- HISTÓRICOGRUPOIMOBILIZADO::Gallery2_29",
  }),
  "cadastro-de-imobilizados": Object.freeze({
    form: "F20- CADASTRO PRODUTO IMOBILIZADO.pa.yaml#Form1_40",
    gallery: "G14- HISTÓRICOIMOBILIZADO.pa.yaml::G14- HISTÓRICOIMOBILIZADO::Gallery2_30",
  }),
  imobilizados: Object.freeze({
    form: "F18- CADASTRO LANÇAMENTO IMOBILIZADO.pa.yaml#Form1_38",
    gallery: "G22- HISTÓRICOLANCAMENTOIMOBILIZADO.pa.yaml::G22- HISTÓRICOLANCAMENTOIMOBILIZADO::Gallery2_27",
  }),
});

test("as 36 superficies de Suprimentos abrem diretamente os Forms e Galleries indicados", () => {
  assert.equal(Object.keys(EXPECTED_SURFACES).length * 2, 36);

  for (const [entityId, expected] of Object.entries(EXPECTED_SURFACES)) {
    const entity = ENTITIES.find(candidate => candidate.id === entityId);
    const contract = getPowerAppsUiContract(entityId, { mode: "create" });

    assert.ok(entity, `${entityId} não existe no catálogo do portal`);
    assert.equal(contract.formVariant?.id, expected.form, `${entityId} abriu o Form incorreto`);
    assert.equal(contract.requiresVariantSelection, false, `${entityId} exigiu escolha manual do Form`);
    assert.equal(contract.galleryVariant?.id, expected.gallery, `${entityId} abriu a Gallery incorreta`);
    assert.equal(contract.requiresGallerySelection, false, `${entityId} exigiu escolha manual da Gallery`);
    assert.ok(contract.formFields.length > 0, `${entityId} abriu sem campos do Form`);
  }
});

test("F18 preserva o lançamento múltiplo de imobilizados", () => {
  assert.equal(getPowerAppsUiContract("imobilizados", { mode: "create" }).multiple, true);
});

test("as Galleries expõem Atualizar somente onde o controle existe no Power Apps", () => {
  const withoutRefresh = new Set(["contas", "cidades", "grupos-de-imobilizados", "cadastro-de-imobilizados"]);
  for (const entityId of Object.keys(EXPECTED_SURFACES)) {
    const entity = ENTITIES.find(candidate => candidate.id === entityId);
    const columns = Object.freeze([{ name: "Title", label: "TÍTULO", control: "text", hidden: false, editable: true, indexed: true }]);
    const item = { id: "1", fields: { Title: "TESTE" } };
    const data = {
      columns,
      rawItems: [item],
      metricItems: [item],
      items: { items: [item], totalKnown: true, total: 1, page: 1, pages: 1, pageSize: 20, rangeStart: 1, rangeEnd: 1, batchCount: 1, loadedCount: 1, hasMore: false },
      query: { limitations: [], notices: [] },
      uiContract: resolvePowerAppsUiContract(entity, columns),
    };
    const markup = entityGalleryMarkup(entity, data, {
      search: "", page: 1, pageSize: 20, sort: { field: "", direction: "asc" }, filters: {}, message: "", error: "",
    }, { create: true, edit: true, delete: true, approve: true });
    const refreshCount = (markup.match(/data-entity-refresh/g) || []).length
      + (markup.match(/data-g1-action="refresh"/g) || []).length;
    assert.equal(refreshCount, withoutRefresh.has(entityId) ? 0 : 1, entityId);
  }
});

test("G28 inicia por DATA PREVISTO PGTO crescente conforme o filtro padrão", async () => {
  const entity = ENTITIES.find(candidate => candidate.id === "provisoes-de-pagamento");
  const repository = {
    async resolveList() { return { status: "resolved", id: "provisoes" }; },
    async getColumns() {
      return [
        { name: "DESCRICAO", displayName: "DESCRIÇÃO", text: {}, indexed: true },
        { name: "DATAPREVISTOPGTO", displayName: "DATA PREVISTO PGTO", dateTime: {}, indexed: true },
        { name: "STATUS", displayName: "STATUS", choice: { choices: ["PAGAMENTO PREVISTO"] }, indexed: true },
      ];
    },
    async getFilterOptionValues() { return {}; },
    async getItemsPage() {
      return { items: [], nextLink: "", hasMore: false, batchCount: 0 };
    },
  };
  const data = await loadEntityData(repository, entity, { useGalleryDefaults: true });

  assert.deepEqual(data.uiContract.gallerySort, { field: "DATAPREVISTOPGTO", direction: "asc" });
  assert.deepEqual(data.queryState.sort, { field: "DATAPREVISTOPGTO", direction: "asc" });
});

test("G28 muda para Modified decrescente quando o filtro corrente exclui PAGAMENTO PREVISTO", async () => {
  const entity = ENTITIES.find(candidate => candidate.id === "provisoes-de-pagamento");
  const repository = {
    async resolveList() { return { status: "resolved", id: "provisoes" }; },
    async getColumns() {
      return [
        { name: "DATAPREVISTOPGTO", displayName: "DATA PREVISTO PGTO", dateTime: {}, indexed: true },
        { name: "Modified", displayName: "MODIFICADO", dateTime: {}, indexed: true },
        {
          name: "STATUS",
          displayName: "STATUS",
          choice: { choices: ["PAGAMENTO PREVISTO", "PAGAMENTO SEM DATA PREVISTA"] },
          indexed: true,
        },
      ];
    },
    async getFilterOptionValues() { return {}; },
    async getItemsPage() {
      return { items: [], nextLink: "", hasMore: false, batchCount: 0 };
    },
  };
  const data = await loadEntityData(repository, entity, {
    filters: { STATUS: JSON.stringify(["PAGAMENTO SEM DATA PREVISTA"]) },
    useGalleryDefaults: false,
  });

  assert.deepEqual(data.uiContract.gallerySort, { field: "Modified", direction: "desc" });
  assert.deepEqual(data.queryState.sort, { field: "Modified", direction: "desc" });
});

test("G28 pesquisa por trecho em DESCRICAO mesmo sem indice no SharePoint", () => {
  const entity = ENTITIES.find(candidate => candidate.id === "provisoes-de-pagamento");
  const columns = Object.freeze([
    { name: "DESCRICAO", label: "DESCRIÇÃO", control: "textarea", hidden: false, editable: true, indexed: false },
    { name: "FORNECEDOR", label: "FORNECEDOR", control: "text", hidden: false, editable: true, indexed: true },
  ]);

  const contract = resolvePowerAppsUiContract(entity, columns);

  assert.deepEqual(contract.searchFields, ["DESCRICAO"]);
  assert.deepEqual(contract.gallerySearch, [{ kind: "contains", field: "DESCRICAO" }]);
  assert.equal(contract.gallerySearchProven, true);
});

test("uma galeria administrativa exibe o comando de anexo somente quando o registro possui arquivo", () => {
  const entity = ENTITIES.find(candidate => candidate.id === "contas");
  const columns = Object.freeze([
    { name: "Title", label: "CONTA", control: "text", hidden: false, editable: true, indexed: true },
    { name: "STATUS", label: "STATUS", control: "select", hidden: false, editable: true, indexed: true },
    { name: "Attachments", label: "ANEXOS", control: "boolean", hidden: false, editable: false, indexed: false },
  ]);
  const items = Object.freeze([
    { id: "10", fields: { Title: "CAIXA", STATUS: "ATIVO", Attachments: true } },
    { id: "11", fields: { Title: "BANCO", STATUS: "ATIVO", Attachments: false } },
  ]);
  const data = {
    columns,
    rawItems: items,
    metricItems: items,
    items: { items, totalKnown: true, total: 2, page: 1, pages: 1, pageSize: 20, rangeStart: 1, rangeEnd: 2, batchCount: 2, loadedCount: 2, hasMore: false },
    query: { limitations: [], notices: [] },
    uiContract: resolvePowerAppsUiContract(entity, columns),
  };
  const markup = entityGalleryMarkup(entity, data, {
    search: "",
    page: 1,
    pageSize: 20,
    sort: { field: "Title", direction: "asc" },
    filters: {},
    message: "",
    error: "",
  }, { create: true, edit: true, delete: true, approve: false });

  assert.match(markup, /class="entity-gallery-attachment" data-gallery-attachment="10"/);
  assert.match(markup, /class="entity-gallery-attachment" hidden data-gallery-attachment="11"/);
});

test("as Galleries administrativas usam faixas livres e não tabelas rígidas", () => {
  const freeformEntities = Object.keys(EXPECTED_SURFACES).filter(entityId => !["lancamentos", "notas-pendentes"].includes(entityId));
  for (const entityId of freeformEntities) {
    const entity = ENTITIES.find(candidate => candidate.id === entityId);
    const columns = Object.freeze([
      { name: "Title", label: "TÍTULO", control: "text", hidden: false, editable: true, indexed: true },
      { name: "STATUS", label: "STATUS", control: "select", hidden: false, editable: true, indexed: true },
      { name: "Attachments", label: "ANEXOS", control: "boolean", hidden: false, editable: false, indexed: false },
    ]);
    const item = { id: "71", fields: { Title: `ITEM ${entityId}`, STATUS: "ATIVO", Attachments: false } };
    const data = {
      columns,
      rawItems: [item],
      metricItems: [item],
      items: { items: [item], totalKnown: true, total: 1, page: 1, pages: 1, pageSize: 20, rangeStart: 1, rangeEnd: 1, batchCount: 1, loadedCount: 1, hasMore: false },
      query: { limitations: [], notices: [] },
      uiContract: resolvePowerAppsUiContract(entity, columns),
    };
    const markup = entityGalleryMarkup(entity, data, {
      search: "", page: 1, pageSize: 20, sort: { field: "ID", direction: "desc" }, filters: {}, message: "", error: "",
    }, { create: true, edit: true, delete: true, approve: true });

    assert.match(markup, /data-powerapps-freeform-gallery/, entityId);
    assert.doesNotMatch(markup, /<table\b/i, entityId);
    assert.match(markup, /data-powerapps-freeform-row="71"/, entityId);
  }
});

test("as Galleries indicadas preservam os comandos de editar e excluir comprovados no Power Apps", () => {
  for (const entityId of Object.keys(EXPECTED_SURFACES)) {
    const entity = ENTITIES.find(candidate => candidate.id === entityId);
    const columns = Object.freeze([
      { name: "Title", label: "TÍTULO", control: "text", hidden: false, editable: true, indexed: true },
      { name: "STATUS", label: "STATUS", control: "select", hidden: false, editable: true, indexed: true },
      { name: "Attachments", label: "ANEXOS", control: "boolean", hidden: false, editable: false, indexed: false },
    ]);
    const item = { id: "10", fields: { Title: "TESTE", STATUS: "PENDENTE", Attachments: true } };
    const data = {
      columns,
      rawItems: [item],
      metricItems: [item],
      items: { items: [item], totalKnown: true, total: 1, page: 1, pages: 1, pageSize: 20, rangeStart: 1, rangeEnd: 1, batchCount: 1, loadedCount: 1, hasMore: false },
      query: { limitations: [], notices: [] },
      uiContract: resolvePowerAppsUiContract(entity, columns),
    };
    const markup = entityGalleryMarkup(entity, data, {
      search: "",
      page: 1,
      pageSize: 20,
      sort: { field: "Title", direction: "asc" },
      filters: {},
      message: "",
      error: "",
    }, { create: true, edit: true, delete: true, approve: true });

    assert.match(markup, /data-entity-edit="10"/, `${entityId} perdeu o comando Editar`);
    assert.match(markup, /data-entity-delete="10"/, `${entityId} perdeu o comando Excluir`);
  }
});

function physicalGalleryMarkup(entityId, columns, fields) {
  const entity = ENTITIES.find(candidate => candidate.id === entityId);
  const item = { id: "21", fields };
  return entityGalleryMarkup(entity, {
    columns,
    rawItems: [item],
    metricItems: [item],
    items: { items: [item], totalKnown: true, total: 1, page: 1, pages: 1, pageSize: 20, rangeStart: 1, rangeEnd: 1, batchCount: 1, loadedCount: 1, hasMore: false },
    query: { limitations: [], notices: [] },
    uiContract: resolvePowerAppsUiContract(entity, columns),
  }, {
    search: "",
    page: 1,
    pageSize: 20,
    sort: { field: "ID", direction: "desc" },
    filters: {},
    message: "",
    error: "",
  }, { create: true, edit: true, delete: true, approve: false });
}

test("as faixas de Grupo, Subfamilia e Produto usam os nomes internos reais do SharePoint", () => {
  const base = name => ({ name, label: name, control: "text", hidden: false, editable: true, indexed: true });
  const grupo = physicalGalleryMarkup("cadastro-de-grupos", [base("Title"), base("STATUS")], {
    Title: "MATERIAIS",
    STATUS: "ATIVO",
  });
  assert.match(grupo, /data-label="GRUPO">MATERIAIS</);

  const subfamilia = physicalGalleryMarkup("cadastro-de-subfamilias", [
    base("Title"), base("field_1"), base("field_3"), base("UNIDADE"), base("STATUS"),
  ], {
    Title: "ELÉTRICA",
    field_1: "FIOS",
    field_3: "MATERIAL",
    UNIDADE: "METRO",
    STATUS: "ATIVO",
  });
  assert.match(subfamilia, /data-label="FAMÍLIA">ELÉTRICA</);
  assert.match(subfamilia, /data-label="SUBFAMÍLIA">FIOS</);
  assert.match(subfamilia, /data-label="UNIDADE">METRO</);
  assert.match(subfamilia, /data-label="TIPO">MATERIAL</);

  const produto = physicalGalleryMarkup("produtos", [
    base("Title"), base("field_1"), base("SATUS"), base("TIPO"), base("GERADESEMBOLSO"), base("TIPODESPESA"),
  ], {
    Title: "FIOS",
    field_1: "CABO FLEXÍVEL",
    SATUS: "ATIVO",
    TIPO: "DESPESA",
    GERADESEMBOLSO: "SIM",
    TIPODESPESA: "MATERIAL",
  });
  assert.match(produto, /data-label="PRODUTO">CABO FLEXÍVEL</);
  assert.match(produto, /data-label="SUBFAMÍLIA">FIOS</);
  assert.match(produto, /data-label="STATUS">ATIVO</);
});

test("as Galleries G19, G40 e dos cadastros básicos iniciam com STATUS ATIVO", async () => {
  const cases = Object.freeze({
    "despesas-recorrentes": "STATUS",
    "cadastro-de-grupos": "STATUS",
    familias: "STATUS",
    "cadastro-de-subfamilias": "STATUS",
    produtos: "SATUS",
    "unidades-de-medida": "STATUS",
    "tipos-de-material": "STATUS",
    filiais: "STATUS",
  });

  for (const [entityId, statusField] of Object.entries(cases)) {
    const entity = ENTITIES.find(candidate => candidate.id === entityId);
    const repository = {
      async resolveList() { return { status: "resolved", id: `${entityId}-list` }; },
      async getColumns() {
        return [
          { name: "Title", displayName: "TÍTULO", text: {}, indexed: true },
          { name: statusField, displayName: "STATUS", choice: { choices: ["ATIVO", "INATIVO"] }, indexed: true },
        ];
      },
      async getFilterOptionValues() { return { [statusField]: ["ATIVO", "INATIVO"] }; },
      async getItems() {
        return [
          { id: "1", fields: { Title: "ATIVO", [statusField]: "ATIVO" } },
          { id: "2", fields: { Title: "INATIVO", [statusField]: "INATIVO" } },
        ];
      },
      async getItemsPage() {
        return {
          items: [{ id: "1", fields: { Title: "ATIVO", [statusField]: "ATIVO" } }],
          nextLink: "",
          hasMore: false,
          batchCount: 1,
        };
      },
    };

    const data = await loadEntityData(repository, entity, { useGalleryDefaults: true });

    assert.deepEqual(data.uiContract.galleryDefaultFilters, { [statusField]: "ATIVO" }, entityId);
    assert.deepEqual(data.rawItems.map(item => item.id), ["1"], entityId);
    assert.deepEqual(data.queryState.filters, { [statusField]: "ATIVO" }, entityId);
  }
});

test("G28 inicia com os dois status literais usados por SelectedItems no Power Apps", () => {
  const entity = ENTITIES.find(candidate => candidate.id === "provisoes-de-pagamento");
  const columns = Object.freeze([
    { name: "STATUS", label: "STATUS", control: "select", hidden: false, editable: true, indexed: true },
  ]);

  const contract = resolvePowerAppsUiContract(entity, columns);

  assert.deepEqual(contract.galleryDefaultFilters, {
    STATUS: JSON.stringify(["PAGAMENTO PREVISTO", "PAGAMENTO SEM DATA PREVISTA"]),
  });
  assert.deepEqual(
    contract.galleryFilters.find(definition => definition.field === "STATUS"),
    { kind: "multiple", field: "STATUS" },
  );
});
