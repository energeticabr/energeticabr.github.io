import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRegistrationGalleryData, REGISTRATION_GALLERY_MODELS } from "../src/chat/registration-gallery-data.js";
import { createRegistrationGallery } from "../src/ui/registration-gallery-view.js";

const cases = [
  ["contracts", "EMPREITEIRO", "GALERIA DE CONTRATOS", "G31- HISTÓRICO CONTRATOS", "FORNECEDOR", "ATIVO", "E12- EDITAR CONTRATO EMPREITEIRO.pa.yaml#Form1_8"],
  ["contractLines", "LINHACONTRATO", "GALERIA DE LINHAS DE CONTRATO", "G48 - HISTÓRICO LINHAS CONTRATO", "FORNECEDOR", "", "G48 - HISTÓRICO LINHAS CONTRATO.pa.yaml#EDITARGRUPO_18"],
  ["measurements", "DESCRICAOMEDICOES", "GALERIA DE MEDIÇÕES", "G6- HISTÓRICO DESCRITIVO MEDIÇÃO", "FORNECEDOR", "ATIVO", "G6- HISTÓRICO DESCRITIVO MEDIÇÃO.pa.yaml#Form24"],
  ["measurementLines", "LINHASMEDICAO", "GALERIA DE LINHAS DE MEDIÇÃO", "G49 - HISTÓRICO LINHAS MEDIÇÃO", "Título", "PENDENTE PGTO", "G49 - HISTÓRICO LINHAS MEDIÇÃO.pa.yaml#EDITARGRUPO_19"],
  ["stageDemonstratives", "DEMONSTRATIVOETAPA", "GALERIA DE DEMONSTRATIVO ETAPA", "G23- HISTÓRICO DESCRITIVO ETAPA", "ATIVIDADEEXECUTADA", "ATIVIDADE INICIADA", "G23- HISTÓRICO DESCRITIVO ETAPA.pa.yaml#Form20_1"],
  ["constructionStages", "LANCAMENTOOBRA", "GALERIA DE ETAPA OBRA", "G25- HISTÓRICO ETAPA OBRA", "ETAPA", "INICIADO", "E7- EDITAR ETAPA OBRA.pa.yaml#EDITARGRUPO_9"],
];

function setup(t, kind, rows, extra = {}) {
  const dom = new JSDOM("<!doctype html><body></body>");
  const doc = dom.window.document;
  const gallery = createRegistrationGallery({ document: doc, kind, data: { async loadSnapshot() { return { rows }; }, ...extra } });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  return { dom, doc, gallery };
}

function ids(doc) { return [...doc.querySelectorAll('[data-registration-row]')].map(card => card.dataset.registrationRow); }
function change(dom, control, value) { control.value = value; control.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }
function money(card, field) { return card.querySelector(`[data-field="${field}"] dd`)?.textContent.replace(/\s/g, " "); }

for (const [kind, list, title, screen, primary, status, formVariantId] of cases) {
  test(`${kind} uses its exact recovered gallery list and pencil form`, async t => {
    const aliases = [];
    const fields = { [primary]: "EXEMPLO", STATUS: status, TIPO: "ATIVIDADE COMUM" };
    const data = createRegistrationGalleryData({ kind, repository: {
      async resolveList(_site, requested) { aliases.push(requested); return { status: "resolved", id: list }; },
      async getItemsPage() { return { items: [{ id: "4", fields }], hasMore: false }; },
      async getItem(_site, _list, id) { return { id, eTag: '"v1"', fields }; },
      async getColumns() { return [{ name: "FORNECEDOR", text: {} }, { name: "ETAPA", text: {} }, { name: "STATUS", text: {} }, { name: "FILIAL", text: {} }]; },
    } });
    const snapshot = await data.loadSnapshot();
    assert.equal(aliases[0][0], list);
    assert.equal(REGISTRATION_GALLERY_MODELS[kind].screen, screen);
    const { doc, gallery } = setup(t, kind, snapshot.rows);
    await gallery.open();
    assert.equal(doc.querySelector('h1').textContent, title);
    assert.deepEqual(ids(doc), ["4"]);
    assert.ok(doc.querySelector('[data-gallery-action="edit"]'));
    assert.ok(doc.querySelector('[data-gallery-action="delete"]'));
    const context = await data.loadEditor("4");
    assert.equal(context.contract.formVariant.id, formVariantId);
    assert.equal(context.contract.requiresVariantSelection, false);
    await assert.rejects(data.loadEditor("4", { formVariantId: "UNPROVED" }), /formulário|galeria/i);
  });
}

test("contract lines retain the source two text sort criteria and multiply quantity by unit value", async t => {
  const { doc, gallery } = setup(t, "contractLines", [
    { id: "1", fields: { IDCONTRATO: "10", INDICELINHA: "9", FORNECEDOR: "C", QTD: "2,5", VALORUNITARIO: "100,10", DEMONSTRATIVOETAPA: "ESTRUTURA", DESCRICAO: "VIGAS" }, hasAttachments: false },
    { id: "2", fields: { IDCONTRATO: "9", INDICELINHA: "10", FORNECEDOR: "C", QTD: "1", VALORUNITARIO: "10" }, hasAttachments: false },
    { id: "3", fields: { IDCONTRATO: "9", INDICELINHA: "2", FORNECEDOR: "C", QTD: "1", VALORUNITARIO: "10" }, hasAttachments: false },
  ]);
  await gallery.open();
  assert.deepEqual(ids(doc), ["3", "2", "1"]);
  const card = doc.querySelector('[data-registration-row="1"]');
  assert.equal(money(card, "VALOR TOTAL"), "R$ 250,25");
  assert.equal(card.querySelector('[data-field="ETAPA"] dd').textContent, "ESTRUTURA");
  assert.deepEqual([...doc.querySelectorAll('[data-filter-field]')].map(control => control.dataset.filterField), ["FORNECEDOR", "IDCONTRATO", "FILIAL", "ATIVIDADE", "ID"]);
});

test("measurement lines apply source totals per measurement type and retain pending-payment default", async t => {
  const { doc, dom, gallery } = setup(t, "measurementLines", [
    { id: "2", hasAttachments: false, fields: { Title: "GLOBAL", TIPOMEDICAO: "MEDIÇÃO VALOR GLOBAL", VALORUNITARIO: "10,005", QTD: "2,005", STATUS: "PENDENTE PGTO", DATAMEDICAO: "2026-10-02", DATAPGTO: "2026-10-06", OBSERVA_x00c7__x00c3_O: "CONFERIR" } },
    { id: "1", hasAttachments: false, fields: { Title: "ÁREA", TIPOMEDICAO: "MEDIÇÃO VALOR UNITÁRIO", ALTURA: "2,5", LARGURA: "4", VALORUNITARIO: "100", QTD: "999", STATUS: "PENDENTE PGTO" } },
    { id: "3", hasAttachments: false, fields: { Title: "PAGA", TIPOMEDICAO: "MEDIÇÃO VALOR GLOBAL", VALORUNITARIO: "100", QTD: "1", STATUS: "PAGO", IDPGTO: "87" } },
  ]);
  await gallery.open();
  assert.deepEqual(ids(doc), ["2", "1"]);
  const globalCard = doc.querySelector('[data-registration-row="2"]');
  assert.equal(globalCard.querySelector('.rg-row-title').textContent, "GLOBAL");
  assert.equal(money(globalCard, "VALOR TOTAL"), "R$ 20,12");
  assert.equal(money(doc.querySelector('[data-registration-row="1"]'), "VALOR TOTAL"), "R$ 1.000,00");
  assert.equal(globalCard.querySelector('[data-field="DATAMEDICAO"] dd').textContent, "02/10/2026");
  assert.equal(globalCard.querySelector('[data-field="OBSERVAÇÃO"] dd').textContent, "CONFERIR");
  change(dom, doc.querySelector('[data-filter-field="STATUS"]'), "PAGO");
  assert.deepEqual(ids(doc), ["3"]);
  assert.equal(doc.querySelector('[data-field="IDPGTO"] dd').textContent, "87");
});

test("contracts default active, sort by ID, and apply the source date window only with both bounds", async t => {
  const { doc, dom, gallery } = setup(t, "contracts", [
    { id: "2", hasAttachments: false, fields: { FORNECEDOR: "C", STATUS: "ATIVO", DATA: "2026-09-01", DATAIN_x00cd_CIO: "2026-09-01", DATAFIM: "2026-09-11", ACR_x00c9_SCIMO: "125,5" } },
    { id: "3", hasAttachments: false, fields: { FORNECEDOR: "D", STATUS: "ATIVO", DATA: "01/10/2026" } },
    { id: "4", hasAttachments: false, fields: { FORNECEDOR: "E", STATUS: "INATIVO", DATA: "2026-10-01" } },
  ]);
  await gallery.open();
  assert.deepEqual(ids(doc), ["3", "2"]);
  const start = doc.querySelector('[data-date-bound="start"]'), end = doc.querySelector('[data-date-bound="end"]');
  change(dom, start, "2026-10-01");
  assert.deepEqual(ids(doc), ["3", "2"]);
  change(dom, end, "2026-10-02");
  assert.deepEqual(ids(doc), ["3"]);
  change(dom, start, "");
  const card = doc.querySelector('[data-registration-row="2"]');
  assert.equal(card.querySelector('[data-field="DURAÇÃO"] dd').textContent, "10 dia(s)");
  assert.equal(card.querySelector('[data-field="DATA INÍCIO"] dd').textContent, "01/09/2026");
  assert.equal(money(card, "ACRÉSCIMO"), "R$ 125,50");
});

test("measurements sort payment dates descending and expose their actual source fields without raw HTML", async t => {
  const { doc, gallery } = setup(t, "measurements", [
    { id: "9", hasAttachments: false, fields: { FORNECEDOR: "ANTIGA", STATUS: "ATIVO", DATAFIM: "2026-09-01", ETAPAOBRA: "ALVENARIA", html: "SECRET RAW HTML", VALORTOTAL: "100" } },
    { id: "1", hasAttachments: false, fields: { FORNECEDOR: "RECENTE", STATUS: "ATIVO", DATAFIM: "2026-10-01", ETAPAOBRA: "ESTRUTURA", VALORTOTAL: "1.250,50", VALORUNITARIO: "250,10", QTD: "5", NUMEROCONTRATO: "22", IDLANCAMENTO: "50", OBSERVACAO: "APROVADA", PENDENCIAS: "PINTURA" } },
  ]);
  await gallery.open();
  assert.deepEqual(ids(doc), ["1", "9"]);
  const card = doc.querySelector('[data-registration-row="1"]');
  assert.equal(card.querySelector('[data-field="ETAPA OBRA"] dd').textContent, "ESTRUTURA");
  assert.equal(money(card, "VALORTOTAL"), "R$ 1.250,50");
  assert.equal(card.querySelector('[data-field="IDLANCAMENTO"] dd').textContent, "50");
  assert.doesNotMatch(doc.querySelector('.rg-list').textContent, /SECRET RAW HTML|ETAPAOBRA/);
});

test("demonstratives sort branch then activity and calculate safe progress from executed and total quantities", async t => {
  const { doc, gallery } = setup(t, "stageDemonstratives", [
    { id: "9", hasAttachments: false, fields: { FILIAL: "B", ATIVIDADEEXECUTADA: "A", STATUS: "ATIVIDADE INICIADA", QTDEXECUTADA: "2", TOTAL: "4" } },
    { id: "2", hasAttachments: false, fields: { FILIAL: "A", ATIVIDADEEXECUTADA: "Z", STATUS: "ATIVIDADE INICIADA", QTDEXECUTADA: "0", TOTAL: "0" } },
    { id: "3", hasAttachments: false, fields: { FILIAL: "A", ATIVIDADEEXECUTADA: "A", STATUS: "ATIVIDADE INICIADA", QTDEXECUTADA: "1,5", TOTAL: "6", DATAEXECUTADO: "2026-10-01", DATAPREVISTO: "2026-10-15" } },
  ]);
  await gallery.open();
  assert.deepEqual(ids(doc), ["3", "2", "9"]);
  assert.equal(doc.querySelector('[data-registration-row="3"] [data-field="PERCENTUAL EXECUTADO"] dd').textContent, "25%");
  assert.equal(doc.querySelector('[data-registration-row="9"] [data-field="PERCENTUAL EXECUTADO"] dd').textContent, "50%");
  assert.equal(doc.querySelector('[data-registration-row="2"] [data-field="PERCENTUAL EXECUTADO"]'), null);
  assert.doesNotMatch(doc.querySelector('.rg-list').textContent, /Infinity|NaN/);
});

test("construction stages map actual internal fields, sort branch and numeric index, and apply source defaults", async t => {
  const { doc, gallery } = setup(t, "constructionStages", [
    { id: "7", hasAttachments: false, fields: { Title: "ESTRUTURA", field_3: "PAREDES", field_2: "ATIVIDADE COMUM", FILIAL: "B", INDICE: 1, STATUS: "INICIADO", PERCENTUALEFETUADO: 0.4 } },
    { id: "8", hasAttachments: false, fields: { Title: "ESTRUTURA", field_3: "LAJE", field_2: "ATIVIDADE COMUM", FILIAL: "A", INDICE: 10, STATUS: "INICIADO", PERCENTUALEFETUADO: 0.5, field_4: "2026-10-01T12:00:00Z", field_5: "2026-10-05", DATAFATAL: "2026-10-10" } },
    { id: "9", hasAttachments: false, fields: { field_3: "FUNDAÇÃO", field_2: "ATIVIDADE COMUM", FILIAL: "A", INDICE: 2, STATUS: "INICIADO" } },
    { id: "10", hasAttachments: false, fields: { field_3: "OUTRA", field_2: "ATIVIDADE ESPECIAL", FILIAL: "A", INDICE: 0, STATUS: "INICIADO" } },
  ]);
  await gallery.open();
  assert.deepEqual(ids(doc), ["9", "8", "7"]);
  const card = doc.querySelector('[data-registration-row="8"]');
  assert.equal(card.querySelector('.rg-row-title').textContent, "LAJE");
  assert.equal(card.querySelector('[data-field="GRUPO DE OBRA"] dd').textContent, "ESTRUTURA");
  assert.equal(card.querySelector('[data-field="PERCENTUALEFETUADO"] dd').textContent, "50%");
  assert.equal(card.querySelector('[data-field="INÍCIO"] dd').textContent, "01/10/2026");
  assert.equal(card.querySelector('[data-field="DATA FATAL"] dd').textContent, "10/10/2026");
});

test("unfinished contract duration uses the device's local Today calendar near UTC midnight", async t => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "America/Sao_Paulo";
  t.after(() => { if (originalTimezone == null) delete process.env.TZ; else process.env.TZ = originalTimezone; });
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-03T01:30:00Z") });
  const { doc, gallery } = setup(t, "contracts", [{ id: "1", hasAttachments: false, fields: { FORNECEDOR: "C", STATUS: "ATIVO", DATAIN_x00cd_CIO: "2026-10-01T03:00:00Z" } }]);
  await gallery.open();
  assert.equal(doc.querySelector('[data-field="DURAÇÃO"] dd').textContent, "1 dia(s)");
});
