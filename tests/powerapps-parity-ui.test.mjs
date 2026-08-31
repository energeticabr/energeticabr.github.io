import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getPowerAppsUiContract,
  resolvePowerAppsUiContract,
} from "../portal/catalog/powerapps-ui-contract.js";
import {
  formatGalleryValue,
  matchesGallerySearchTerms,
  normalizeGallerySearchTerms,
} from "../portal/gallery/gallery-model.js";
import { createMultiEntryQueue, multiEntryQueueMarkup } from "../portal/forms/multi-entry.js";
import { persistEntityRecord } from "../portal/forms/entity-submit.js";
import { formMarkup } from "../portal/ui/dynamic-form.js";
import { buildG1FieldVisitPayload, entityGalleryMarkup, loadEntityData } from "../portal/ui/entity-page.js";

const adminCss = readFileSync(new URL("../portal/styles/admin.css", import.meta.url), "utf8");

const entity = Object.freeze({
  id: "lancamentos",
  moduleId: "suprimentos",
  title: "Lançamentos",
  siteKey: "personal",
  searchFields: Object.freeze(["FILIAL", "FORNECEDOR", "PRODUTO", "DESCRICAO"]),
  statusFields: Object.freeze(["CONCLUIDO"]),
  capabilities: Object.freeze({ view: true, create: true, edit: true }),
});

const columns = Object.freeze([
  { name: "ID", label: "ID", control: "number", hidden: false, editable: false },
  { name: "Title", label: "Título", control: "text", hidden: false, editable: true, indexed: true },
  { name: "FILIAL", label: "Filial", control: "select", choices: ["001", "002"], hidden: false, editable: true, indexed: true },
  { name: "DATA", label: "Data", control: "date", hidden: false, editable: true, indexed: true },
  { name: "FORNECEDOR", label: "Fornecedor", control: "lookup", hidden: false, editable: true, indexed: true },
  { name: "PRODUTO", label: "Produto", control: "select", choices: ["CIMENTO", "AREIA"], hidden: false, editable: true, indexed: true },
  { name: "DESCRICAO", label: "Descrição", control: "textarea", hidden: false, editable: true, indexed: true },
  { name: "CONCLUIDO", label: "Concluído", control: "select", choices: ["PENDENTE", "PGTO EFETUADO"], hidden: false, editable: true, indexed: true },
  { name: "NOTA", label: "Nota", control: "text", hidden: false, editable: true, indexed: false },
  { name: "CONTRATO", label: "Contrato", control: "lookup", hidden: false, editable: true, indexed: false },
  { name: "STATUS", label: "Status", control: "select", choices: ["PENDENTE", "CONCLUÍDO"], hidden: false, editable: true, indexed: true },
  { name: "Created", label: "Criado", control: "datetime-local", hidden: false, editable: false },
  { name: "Editor", label: "Modificado por", control: "person", hidden: false, editable: false },
]);

const lancamentoFormColumns = Object.freeze([
  { name: "Title", label: "Título", control: "text", hidden: false, editable: true },
  { name: "FILIAL", label: "Filial", control: "select", hidden: false, editable: true },
  { name: "field_2", label: "Data", control: "date", hidden: false, editable: true },
  { name: "field_5", label: "Fornecedor", control: "lookup", hidden: false, editable: true },
  { name: "field_7", label: "Produto", control: "select", hidden: false, editable: true },
  { name: "field_16", label: "Descrição", control: "textarea", hidden: false, editable: true },
  { name: "field_19", label: "Concluído", control: "select", hidden: false, editable: true },
  { name: "NOTA", label: "Nota", control: "text", hidden: false, editable: true },
  { name: "OBSERVA_x00c7__x00d5_ESENTREGA", label: "Observações entrega", control: "textarea", hidden: false, editable: true },
  { name: "CAMPO_FORA_DO_POWERAPPS", label: "Campo estranho", control: "text", hidden: false, editable: true },
]);

test("o contrato Power Apps define formulario, galeria, filtros e lancamento multiplo sem campos tecnicos", () => {
  const declared = getPowerAppsUiContract(entity.id);
  const contract = resolvePowerAppsUiContract(entity, lancamentoFormColumns);
  const galleryContract = resolvePowerAppsUiContract(entity, columns);

  assert.equal(declared.hasForm, true);
  assert.equal(declared.readOnly, false);
  assert.equal(declared.multiple, true);
  assert.deepEqual(contract.formColumns.map(column => column.name), [
    "field_2",
    "field_5",
    "Title",
    "field_16",
    "field_19",
    "field_7",
    "NOTA",
    "OBSERVA_x00c7__x00d5_ESENTREGA",
  ]);
  assert.deepEqual(galleryContract.galleryColumns.map(column => column.name), [
    "FILIAL",
    "DATA",
    "CONCLUIDO",
    "PRODUTO",
    "NOTA",
    "ID",
    "CONTRATO",
    "FORNECEDOR",
    "DESCRICAO",
    "Created",
    "Editor",
  ]);
  assert.deepEqual(galleryContract.filterFields, ["FILIAL", "CONCLUIDO", "FORNECEDOR", "ID", "PRODUTO", "CONTRATO"]);
  assert.deepEqual(galleryContract.searchFields, ["FILIAL", "FORNECEDOR", "PRODUTO", "DESCRICAO"]);
  assert.equal(contract.formColumns.find(column => column.name === "Title")?.control, "select");
  assert.equal(galleryContract.galleryColumns.some(column => column.name === "Title"), false);
  assert.equal(contract.multiple, true);
  assert.equal(contract.formColumns.some(column => ["ID", "Created", "Editor"].includes(column.name)), false);
});

test("a Galeria de LANCAMENTOS preserva a coluna fisica Title independentemente do Form selecionado", () => {
  const physicalColumns = Object.freeze([
    { name: "Title", label: "Filial", control: "text", hidden: false, editable: true, indexed: true },
    { name: "field_6", label: "Etapa", control: "text", hidden: false, editable: true, indexed: true },
  ]);

  for (const mode of ["create", "edit"]) {
    const contract = resolvePowerAppsUiContract(entity, physicalColumns, { mode });
    assert.equal(contract.formColumns.find(column => column.name === "Title")?.control, "select");
    assert.deepEqual(contract.galleryColumns.map(column => column.name), ["Title", "field_6"]);
    assert.deepEqual(contract.searchFields, ["Title"]);
    assert.deepEqual(contract.filterFields, ["Title", "field_6"]);
    assert.equal(contract.galleryColumns[0].control, "text");
  }
});

test("a galeria mostra datas curtas pt-BR e pesquisa todos os termos em campos diferentes", () => {
  assert.equal(formatGalleryValue({ DATA: "2026-08-26T18:45:00Z" }, { name: "DATA", control: "datetime-local" }), "26/08/2026");
  assert.equal(formatGalleryValue({ DATA: "2026-08-26T01:00:00Z" }, { name: "DATA", control: "datetime-local" }), "25/08/2026");
  assert.equal(formatGalleryValue({ DATA: "2026-08-26" }, { name: "DATA", control: "date" }), "26/08/2026");
  assert.deepEqual(normalizeGallerySearchTerms("  ana   bandeirante ANA  "), ["ANA", "BANDEIRANTE"]);
  assert.equal(matchesGallerySearchTerms(
    { Title: "ANA SILVA", EMPREENDIMENTO: "CONDOMÍNIO BANDEIRANTE" },
    ["Title", "EMPREENDIMENTO"],
    ["ANA", "BANDEIRANTE"],
  ), true);
  assert.equal(matchesGallerySearchTerms(
    { Title: "ANA SILVA", EMPREENDIMENTO: "CONDOMÍNIO BANDEIRANTE" },
    ["Title", "EMPREENDIMENTO"],
    ["ANA", "OURO PRETO"],
  ), false);
});

test("a busca com varios termos consulta pelo primeiro e refina o lote por todos", async () => {
  const searches = [];
  const data = await loadEntityData({
    async resolveList() { return { status: "resolved", id: "lancamentos-list" }; },
    async getColumns() { return columns.map(column => ({ ...column, indexed: true })); },
    async getItemsPage() { throw new Error("a busca contratada deve usar a pesquisa estruturada"); },
    async searchItemsPage(_siteKey, _listId, search) {
      searches.push(search);
      return {
        items: [
          { id: "1", fields: { FILIAL: "OURO PRETO", FORNECEDOR: "BANDEIRANTE MATERIAIS", PRODUTO: "CIMENTO", DESCRICAO: "COMPRA" } },
          { id: "2", fields: { FILIAL: "OURO PRETO", FORNECEDOR: "OUTRO", PRODUTO: "CIMENTO", DESCRICAO: "COMPRA" } },
        ],
        nextLink: "",
        hasMore: false,
      };
    },
  }, entity, { search: "ouro bandeirante", pageSize: 20 });

  assert.equal(searches.length, 1);
  assert.equal(searches[0].term, "OURO");
  assert.deepEqual(data.rawItems.map(item => item.id), ["1"]);
});

test("a Galeria G1 abre pelos maiores IDs reais do SharePoint", async () => {
  const data = await loadEntityData({
    async resolveList() { return { status: "resolved", id: "lancamentos-list" }; },
    async getColumns() { return columns.map(column => ({ ...column, indexed: true })); },
    async getItems() {
      return [
        { id: "1", fields: { FILIAL: "001", PRODUTO: "PROJETO" } },
        { id: "3339", fields: { FILIAL: "004", PRODUTO: "TRINCHA" } },
        { id: "20", fields: { FILIAL: "002", PRODUTO: "CIMENTO" } },
      ];
    },
    async getItemsPage() { throw new Error("a abertura padrão da G1 deve ordenar a lista completa localmente"); },
  }, entity, { pageSize: 20 });

  assert.equal(data.query.mode, "bounded-client-query");
  assert.deepEqual(data.rawItems.map(item => item.id), ["3339", "20", "1"]);
});

test("a fila multipla adiciona, remove e conserva o resultado individual de cada linha", async () => {
  const queue = createMultiEntryQueue();
  const first = queue.add({ Title: "ITEM A" }, { Title: "ITEM A" });
  const removed = queue.add({ Title: "REMOVER" }, { Title: "REMOVER" });
  const second = queue.add({ Title: "ITEM B" }, { Title: "ITEM B" });
  queue.remove(removed.id);

  const result = await queue.submitAll(async row => {
    if (row.fields.Title === "ITEM B") throw new Error("Falha B");
    return { id: "101", fields: row.fields };
  });

  assert.deepEqual(result.map(row => [row.id, row.status, row.message]), [
    [first.id, "success", "Registro criado com sucesso."],
    [second.id, "error", "Falha B"],
  ]);
  assert.equal(queue.snapshot().length, 2);
});

test("a persistencia usa create para cadastro e update com ETag para edicao", async () => {
  const calls = [];
  const simpleEntity = Object.freeze({ ...entity, id: "compras" });
  const repository = {
    async createItem(...args) { calls.push(["create", ...args]); return { id: "8", fields: args[2] }; },
    async updateItem(...args) { calls.push(["edit", ...args]); return { id: args[2], eTag: '"2,1"', fields: args[3] }; },
  };
  await persistEntityRecord(repository, simpleEntity, { id: "list-1" }, { mode: "create", fields: { Title: "NOVO" } });
  await persistEntityRecord(repository, simpleEntity, { id: "list-1" }, {
    mode: "edit",
    item: { id: "7", eTag: '"1,1"', fields: { Title: "ANTIGO" } },
    fields: { Title: "EDITADO" },
  });

  assert.deepEqual(calls, [
    ["create", "personal", "list-1", { Title: "NOVO" }],
    ["edit", "personal", "list-1", "7", { Title: "EDITADO" }, { eTag: '"1,1"' }],
  ]);
});

test("o componente mantem contrato, filtros e data curta ao tornar o detalhe acessivel", () => {
  const data = {
    columns,
    rawItems: [{ id: "7", fields: { Title: "ANA", FILIAL: "001", "TIPO TRANSAÇÃO": "CUSTO", DATA: "2026-08-26", FORNECEDOR: "ACME", ETAPA: "FUNDAÇÃO", PRODUTO: "CONCRETO", QUANTIDADE: 2, "VALOR UNITÁRIO": 150, FRETE: 25, DESCRICAO: "TESTE", STATUS: "PENDENTE", "CONCLUÍDO": "PENDENTE" } }],
    items: { items: [{ id: "7", fields: { Title: "ANA", FILIAL: "001", "TIPO TRANSAÇÃO": "CUSTO", DATA: "2026-08-26", FORNECEDOR: "ACME", ETAPA: "FUNDAÇÃO", PRODUTO: "CONCRETO", QUANTIDADE: 2, "VALOR UNITÁRIO": 150, FRETE: 25, DESCRICAO: "TESTE", STATUS: "PENDENTE", "CONCLUÍDO": "PENDENTE" } }], totalKnown: false, page: 1, pageSize: 20, rangeStart: 1, rangeEnd: 1, batchCount: 1, loadedCount: 1, hasMore: false },
    query: { limitations: [], notices: [] },
  };
  const markup = entityGalleryMarkup(entity, data, {
    search: "", page: 1, pageSize: 20, sort: { field: "Title", direction: "asc" }, filters: {}, message: "", error: "",
  }, { create: true, edit: true, approve: false });

  assert.match(markup, /class="entity-split-workspace" data-entity-workspace/);
  assert.doesNotMatch(markup, /data-entity-form/);
  assert.match(markup, /data-entity-gallery/);
  assert.match(markup, /data-entity-filter="FILIAL"/);
  assert.match(markup, /data-entity-filter="CONCLUIDO"/);
  assert.match(markup, />25\/08\/2026</);
  assert.match(markup, /class="button-primary"[^>]+data-entity-edit="7"[^>]*>Editar</);
  assert.match(markup, /data-gallery-attachment="7"/);
  assert.match(markup, /entity-gallery-attachment g1-row-attachment" hidden data-gallery-attachment="7"/);
  assert.match(markup, /href="#\/entity\/lancamentos\/item\/7"[^>]*>Abrir detalhes<\/a>/);
  assert.match(markup, /class="lancamentos-gallery"/);
  assert.match(markup, />TIPO DE OPERAÇÃO:</);
  assert.match(markup, />R\$ 325,00</);
  assert.doesNotMatch(markup, /class="entity-table"/);
});

test("a Galeria G1 reproduz a barra operacional, metricas e acoes do Power Apps", () => {
  const data = {
    columns,
    rawItems: [{
      id: "7",
      fields: {
        Title: "002 - OURO PRETO",
        FILIAL: "002 - OURO PRETO",
        FORNECEDOR: "MATERIAL FORTE",
        PRODUTO: "CIMENTO",
        ETAPA: "FUNDAÇÃO",
        "TIPO TRANSAÇÃO": "CUSTO",
        QUANTIDADE: 2,
        "VALOR UNITÁRIO": 150,
        FRETE: 25,
        "DATA RMS": "2026-08-26",
        "DATA PGTO PREVISTO": "2026-08-28",
        "DATA PGTO EFETUADO": "2026-08-29",
        "CONCLUÍDO": "PEDIDO FINALIZADO",
        APROVACAO: "PENDENTE DE APROVAÇÃO",
        Attachments: true,
      },
    }],
    items: { items: [], totalKnown: false, page: 1, pageSize: 20, rangeStart: 1, rangeEnd: 1, batchCount: 1, loadedCount: 1, hasMore: false },
    query: { limitations: [], notices: [] },
    uiContract: resolvePowerAppsUiContract(entity, columns),
  };
  data.items.items = data.rawItems;

  const markup = entityGalleryMarkup(entity, data, {
    search: "", page: 1, pageSize: 20, sort: { field: "ID", direction: "desc" }, filters: {}, message: "", error: "",
  }, { create: true, edit: true, approve: true });

  assert.match(markup, /class="g1-operational-bar"/);
  assert.match(markup, /data-g1-action="new-launch"[^>]*href="#\/entity\/lancamentos\/new"/);
  assert.match(markup, /data-g1-action="field-visit"/);
  assert.match(markup, /data-g1-action="refresh"/);
  assert.match(markup, />EMPENHADO</);
  assert.match(markup, />LIQUIDAÇÃO</);
  assert.match(markup, />PENDENTE</);
  assert.match(markup, />TOTAL</);
  assert.match(markup, /data-g1-filter-grid/);
  assert.match(markup, /class="g1-list-row is-done"/);
  assert.match(markup, /class="g1-row-file"/);
  assert.match(markup, /class="g1-row-main"/);
  assert.match(markup, /class="g1-row-side"/);
  assert.match(markup, /class="entity-gallery-attachment g1-row-attachment" data-gallery-attachment="7"/);
  assert.doesNotMatch(markup, /g1-row-attachment" hidden/);
  assert.match(markup, /aria-label="Abrir PDFs e anexos do lançamento #7"/);
  assert.match(markup, />DATA DE RMS:</);
  assert.match(markup, />PEDIDO FINALIZADO</);
  assert.match(markup, /data-g1-field-visit-dialog/);
  assert.match(markup, /data-g1-field-visit-form/);
  assert.match(adminCss, /\.g1-list-row\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;/i);
});

test("a Galeria G1 aceita registros reais com data Created sem confundir o indice com today", () => {
  const realItem = { id: "8", fields: { Created: "2026-08-31T10:00:00-03:00", FORNECEDOR: "FORNECEDOR REAL" } };
  const data = {
    columns,
    rawItems: [realItem],
    items: { items: [realItem], totalKnown: false, page: 1, pageSize: 20, rangeStart: 1, rangeEnd: 1, batchCount: 1, loadedCount: 1, hasMore: false },
    query: { limitations: [], notices: [] },
    uiContract: resolvePowerAppsUiContract(entity, columns),
  };

  assert.doesNotThrow(() => entityGalleryMarkup(entity, data, {
    search: "", page: 1, pageSize: 20, sort: { field: "ID", direction: "desc" }, filters: {}, message: "", error: "",
  }, { create: true, edit: true, approve: true }));
});

test("a visita em campo cria o lancamento e o diario conforme a regra do G1", () => {
  const payload = buildG1FieldVisitPayload({
    filial: "002 - OURO PRETO",
    valor: "250,50",
    createDiary: true,
    today: "2026-08-31",
    nextGroupId: 341,
  });

  assert.deepEqual(payload.lancamento, {
    "VALOR UNITÁRIO": 250.5,
    QUANTIDADE: 1,
    FORNECEDOR: "BERNARDO",
    FILIAL: "002 - OURO PRETO",
    CONTA: "DINHEIRO",
    DATA: "2026-08-31",
    "DATA PGTO EFETUADO": "2026-08-31",
    "DATA PGTO PREVISTO": "2026-08-31",
    "DATA RMS": "2026-08-31",
    "TIPO TRANSAÇÃO": "DESPESA",
    ETAPA: "VISITA EM CAMPO",
    "CONCLUÍDO": "PEDIDO FINALIZADO",
    PRODUTO: "VISITA EM CAMPO",
    GERADESEMBOLSO: "SIM",
    "ID 2": 341,
  });
  assert.deepEqual(payload.diario, {
    DATA: "2026-08-31",
    FILIAL: "002 - OURO PRETO",
    RESPONSAVELTECNICO: "BERNARDO NOTINI MOREIRA BAHIA",
    STATUS: "PENDENTE",
  });
});

test("a visita em campo usa a data local de Divinopolis e nao a virada UTC", () => {
  const payload = buildG1FieldVisitPayload({
    filial: "002 - OURO PRETO",
    valor: 100,
    createDiary: false,
    now: new Date("2027-01-01T02:30:00.000Z"),
  });
  assert.equal(payload.lancamento.DATA, "2026-12-31");
});

test("as acoes de cada lancamento quebram em linhas completas no celular", () => {
  assert.match(adminCss, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.lancamentos-head-actions \.entity-row-actions\s*\{[^}]*flex-wrap:\s*wrap[^}]*width:\s*100%/i);
});

test("a fila multipla exibe o item preparado como faixa de galeria com seus valores", () => {
  const markup = multiEntryQueueMarkup([{
    id: "row-1",
    fields: { Title: "001 - OURO PRETO", FORNECEDOR: "MATERIAL FORTE", QUANTIDADE: 4, "VALOR UNITÁRIO": 89.5 },
    rawValues: {},
    relationshipLabels: {},
    status: "pending",
    message: "Aguardando envio.",
  }], [
    { name: "Title", label: "Filial", control: "select", hidden: false },
    { name: "FORNECEDOR", label: "Fornecedor", control: "select", hidden: false },
    { name: "QUANTIDADE", label: "Quantidade", control: "number", hidden: false },
    { name: "VALOR UNITÁRIO", label: "Valor unitário", control: "number", hidden: false },
  ], { mode: "lancamentos-gallery3-1" });

  assert.match(markup, /Item 1/);
  assert.match(markup, /<dt>Filial<\/dt><dd>001 - OURO PRETO<\/dd>/);
  assert.match(markup, /<dt>Fornecedor<\/dt><dd>MATERIAL FORTE<\/dd>/);
  assert.match(markup, /<dt>Quantidade<\/dt><dd>4<\/dd>/);
  assert.doesNotMatch(markup, />row-1</);
});

test("formulario de lancamentos diferencia submeter cancelar e limpar formulario", () => {
  const markup = formMarkup({ entity, columns, mode: "create", values: { Title: "001" }, submitLabel: "Submeter" });

  assert.match(markup, /data-form-save[^>]*>Submeter</);
  assert.match(markup, /data-form-cancel[^>]*>Cancelar</);
  assert.match(markup, /data-form-clear[^>]*>Limpar formulário</);
  assert.match(markup, /class="button-secondary form-clear-button"/);
});

test("formulario de notas pendentes identifica o Novo Pedido Form42_7", () => {
  const markup = formMarkup({ entity: { id: "notas-pendentes", title: "Notas pendentes" }, columns: [{ name: "Title", editable: true, required: true, text: {} }], mode: "create" });
  assert.match(markup, />Novo Pedido Form42_7</);
});
