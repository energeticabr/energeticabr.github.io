import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createOrdersGalleryData, createPaymentProgrammingGalleryData, createHrPayrollGalleryData } from "../src/chat/orders-gallery-data.js";
import { createRegistrationGalleryData } from "../src/chat/registration-gallery-data.js";

function fixture({ columns, fields, eTag = '"v1"', conflict = false } = {}) {
  const writes = [], reads = [], searches = [];
  const repository = {
    async resolveList(_site, aliases) { return { status: "resolved", id: aliases[0] }; },
    async getItemsPage() { return { items: [], hasMore: false }; },
    async getColumns() { return columns || [
      { name: "OBS", text: {} }, { name: "STATUS", choice: { choices: ["PAGO", "PENDENTE AUDITORIA"] } },
      { name: "DATAPGTOEFETUADO", dateTime: { format: "dateOnly" } },
      { name: "VALORTOTAL", currency: {} }, { name: "SECRET", text: {} },
      { name: "OBSFISCAL", text: {}, readOnly: true }, { name: "Created", dateTime: {} },
    ]; },
    async getItem(site, list, id) { reads.push({ site, list, id }); return { id, eTag, fields: fields || { OBS: "ANTIGO", STATUS: "PAGO", DATAPGTOEFETUADO: "2026-09-30T03:00:00Z", VALORTOTAL: 500 } }; },
    async updateItem(site, list, id, values, options) {
      writes.push({ site, list, id, values, options });
      if (conflict) throw Object.assign(new Error("Conflito"), { status: 412 });
      return { id, eTag: '"v2"', fields: values };
    },
    async deleteItem(site, list, id, options) { writes.push({ site, list, id, options }); },
    async searchRelationshipOptions(...args) { searches.push(args); return [{ id: 3, label: "Relacionada", secondary: "" }]; },
    async searchPowerAppsOptions(...args) { searches.push(args); return [{ value: "ATIVO", label: "Ativo" }]; },
  };
  return { repository, writes, reads, searches };
}

test("ordinary order and payroll reads do not load the editor catalog", () => {
  const moduleUrl = new URL("../src/chat/orders-gallery-data.js", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('/gallery-record-data.js')) throw new Error('Editor catalog loaded during snapshot');
      return nextResolve(specifier, context);
    } });
    const { createOrdersGalleryData, createHrPayrollGalleryData } = await import(${JSON.stringify(moduleUrl)});
    const repository = {
      async resolveList() { return { status: 'resolved', id: 'list' }; },
      async getItemsPage() { return { items: [], hasMore: false }; },
    };
    await createOrdersGalleryData({ repository }).loadSnapshot();
    await createHrPayrollGalleryData({ repository }).loadPage('IDFOLHA');
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("editor uses the verified order edit form and preserves typed closed descriptors", async () => {
  const f = fixture(), data = createOrdersGalleryData(f);
  assert.equal(typeof data.loadEditor, "function");
  const context = await data.loadEditor("2");
  assert.equal(context.entity.id, "notas-pendentes");
  assert.equal(context.contract.formVariant.formName, "Form43");
  assert.deepEqual(context.columns, context.contract.formColumns);
  assert.ok(!context.columns.some(c => ["Created", "SECRET", "OBSFISCAL"].includes(c.name)));
  assert.equal(context.columns.find(c => c.name === "STATUS").powerApps.closed, true);
  assert.equal(context.columns.find(c => c.name === "DATAPGTOEFETUADO").control, "date");
  await assert.rejects(data.loadEditor("2", { formVariantId: "invented" }), /formulário|variante/i);
});

test("save pins the loaded version and only sends modified editable values", async () => {
  const f = fixture(), data = createOrdersGalleryData(f), context = await data.loadEditor("2");
  await data.saveEditor(context, { OBS: "novo", STATUS: "PAGO", DATAPGTOEFETUADO: "2026-09-30", VALORTOTAL: 500 });
  assert.equal(f.reads.length, 1);
  assert.deepEqual(f.writes[0].values, { OBS: "NOVO" });
  assert.deepEqual(f.writes[0].options, { eTag: '"v1"' });
});

test("stale edits propagate conflict and cannot silently refresh their baseline", async () => {
  const f = fixture({ conflict: true }), data = createOrdersGalleryData(f), context = await data.loadEditor("2");
  await assert.rejects(data.saveEditor(context, { OBS: "novo" }), { status: 412 });
  assert.equal(f.reads.length, 1);
  assert.equal(f.writes[0].options.eTag, '"v1"');
});

test("save rejects missing versions, foreign contexts, forbidden keys, and unproven closed choices", async () => {
  for (const eTag of ["", "*"]) {
    const f = fixture({ eTag }), data = createOrdersGalleryData(f);
    await assert.rejects(data.loadEditor("2"), /versão|ETag/i);
    assert.equal(f.writes.length, 0);
  }
  const f = fixture(), data = createOrdersGalleryData(f), context = await data.loadEditor("2");
  const other = createOrdersGalleryData(f);
  await assert.rejects(other.saveEditor(context, { OBS: "novo" }), /contexto/i);
  await assert.rejects(data.saveEditor({ ...context }, { OBS: "novo" }), /contexto/i);
  for (const fields of [{ SECRET: "x" }, { Created: "x" }, { OBSFISCAL: "x" }, { STATUS: "invented" }]) {
    await assert.rejects(data.saveEditor(context, fields), /campo|opção/i);
  }
  assert.equal(f.writes.length, 0);
});

test("delete uses the displayed ETag or fetches a fresh conditional version when absent", async () => {
  const f = fixture(), data = createOrdersGalleryData(f);
  await data.deleteItem("2", { eTag: '"displayed"' });
  assert.equal(f.reads.length, 0);
  assert.equal(f.writes[0].options.eTag, '"displayed"');
  await data.deleteItem("2");
  assert.equal(f.reads.length, 1);
  assert.equal(f.writes[1].options.eTag, '"v1"');
  await assert.rejects(data.deleteItem("2", { eTag: "*" }), /versão|ETag/i);
  assert.equal(f.writes.length, 2);
});

test("registration editors retain Power Apps relationship sources and reject spoofed searches", async () => {
  const f = fixture({ columns: [{ name: "Title", text: {} }, { name: "field_1", text: {} }, { name: "STATUS", text: {} }], fields: { Title: "ANTIGO", field_1: "Família", STATUS: "ATIVO" } });
  const data = createRegistrationGalleryData({ kind: "family", ...f }), context = await data.loadEditor("2");
  const column = context.columns.find(c => c.name === "Title"), source = column.powerApps.optionSources[0];
  assert.equal(column.control, "select");
  assert.equal(source.listName, "CADASTROGRUPO");
  await context.powerAppsOptionSearch(column, source, "ativ", {}, { limit: 20 });
  assert.equal(f.searches[0][0], "personal");
  await assert.rejects(context.powerAppsOptionSearch(column, { ...source, listName: "SECRETS" }, "x", {}), /origem|campo/i);
  await assert.rejects(data.saveEditor(context, { Title: "SPOOFED" }), /opção/i);
  await data.saveEditor(context, { Title: "ATIVO" });
  await assert.rejects(data.saveEditor(context, { Title: "ATIVO" }), /contexto/i);
});

test("HR metadata keeps typed native choices and isolates contexts between payroll lists and services", async () => {
  const f = fixture({ columns: [
    { name: "MESREFERENCIA", dateTime: { format: "dateOnly" } },
    { name: "TIPOPGTO", choice: { choices: ["SALÁRIO", "FÉRIAS"] } },
    { name: "FORNECEDOR", lookup: { listId: "suppliers", columnName: "Title" } },
    { name: "VALORUNITARIO", currency: {} }, { name: "Created", dateTime: {} },
    { name: "UNKNOWN" }, { name: "COMPUTED", calculated: {}, number: {} },
  ], fields: { TIPOPGTO: "SALÁRIO", FORNECEDORLookupId: 3, VALORUNITARIO: 1 } });
  const data = createHrPayrollGalleryData(f), context = await data.loadEditor("FOLHAPGTO", "7");
  assert.equal(context.contract.hasForm, true);
  assert.equal(context.contract.metadataOnly, true);
  assert.ok(!context.columns.some(c => ["Created", "UNKNOWN", "COMPUTED"].includes(c.name)));
  assert.equal(context.columns.find(c => c.name === "TIPOPGTO").control, "select");
  const relation = context.columns.find(c => c.name === "FORNECEDOR");
  await context.relationshipSearch(relation, "Rela", { limit: 20 });
  assert.equal(f.searches[0][1], "FOLHAPGTO");
  await assert.rejects(createHrPayrollGalleryData(f).saveEditor(context, { VALORUNITARIO: 2 }), /contexto/i);
  await assert.rejects(data.saveEditor(context, { TIPOPGTO: "SPOOF" }), /opção/i);
  await data.saveEditor(context, { TIPOPGTO: "FÉRIAS", FORNECEDORLookupId: 3 });
  assert.equal(f.writes[0].list, "FOLHAPGTO");
  assert.deepEqual(f.writes[0].values, { TIPOPGTO: "FÉRIAS" });
  await data.deleteItem("IDFOLHA", "8", { eTag: '"shown"' });
  assert.equal(f.writes.at(-1).list, "IDFOLHA");
});

test("payroll snapshots preserve the displayed version and editors reject a different returned record", async () => {
  const f = fixture();
  f.repository.getItemsPage = async () => ({ items: [{ id: "2", eTag: '"displayed"', fields: { MESREFERENCIA: "2026-09" } }], hasMore: false });
  const data = createHrPayrollGalleryData(f);
  const page = await data.loadPage("IDFOLHA");
  assert.equal(page.rows[0].eTag, '"displayed"');
  f.repository.getItem = async () => ({ id: "3", eTag: '"v1"', fields: {} });
  await assert.rejects(data.loadEditor("IDFOLHA", "2"), /registro solicitado/i);
  assert.equal(f.writes.length, 0);
});

test("dependent options are rechecked against changed parents even when the child is retained", async () => {
  const f = fixture({ columns: [{ name: "FILIAL", text: {} }, { name: "IMOVEL", text: {} }], fields: { FILIAL: "A", IMOVEL: "CASA A" } });
  f.repository.searchPowerAppsOptions = async (site, source, term, dependencies, options) => {
    f.searches.push({ site, source, term, dependencies, options });
    if (source.valueField === "FILIAL") return [{ value: "B", label: "B" }];
    return [{ value: dependencies.FILIAL === "B" ? "CASA B" : "CASA A", label: "Casa" }];
  };
  const data = createPaymentProgrammingGalleryData(f), context = await data.loadEditor("2");
  const column = context.columns.find(c => c.name === "IMOVEL"), source = column.powerApps.optionSources[0];
  assert.equal(column.control, "select");
  assert.equal(source.kind, "dependent");
  await context.powerAppsOptionSearch(column, source, "CASA", { FILIAL: "A" }, { limit: 20 });
  await assert.rejects(data.saveEditor(context, { FILIAL: "B", IMOVEL: "CASA A" }), /opção/i);
  assert.equal(f.searches.at(-1).dependencies.FILIAL, "B");
  assert.equal(f.writes.length, 0);
  await data.saveEditor(context, { FILIAL: "B", IMOVEL: "CASA B" });
  assert.deepEqual(f.writes[0].values, { FILIAL: "B", IMOVEL: "CASA B" });
});

test("native relationships validate selected IDs using labels returned by the trusted search", async () => {
  const f = fixture({ columns: [{ name: "FORNECEDOR", lookup: { listId: "suppliers", columnName: "Title" } }], fields: { FORNECEDORLookupId: 1 } });
  f.repository.searchRelationshipOptions = async (site, list, relation, term) => {
    f.searches.push({ site, list, relation, term });
    return term.startsWith("Rela") ? [{ id: 3, label: "Relacionada", secondary: "" }] : [];
  };
  const data = createHrPayrollGalleryData(f), context = await data.loadEditor("FOLHAPGTO", "2"), column = context.columns[0];
  await context.relationshipSearch(column, "Rela");
  await data.saveEditor(context, { FORNECEDORLookupId: 3 });
  assert.equal(f.searches.at(-1).term, "Relacionada");
  assert.deepEqual(f.writes[0].values, { FORNECEDORLookupId: 3 });
});

test("conditional choices are checked when their form selector changes", async () => {
  const f = fixture({ columns: [{ name: "TIPOHOMOLOGACAO", text: {} }, { name: "PESSOARELACIONADA", text: {} }], fields: { TIPOHOMOLOGACAO: "HOMOLOGAÇÃO FILIAL", PESSOARELACIONADA: "FORNECEDOR ANTIGO" } });
  f.repository.searchPowerAppsOptions = async (_site, source) => source.listName === "FORNECEDORES" ? [{ value: "FORNECEDOR ANTIGO", label: "Fornecedor antigo" }] : [];
  const data = createRegistrationGalleryData({ kind: "documents", ...f }), context = await data.loadEditor("2");
  await assert.rejects(data.saveEditor(context, { TIPOHOMOLOGACAO: "HOMOLOGAÇÃO COMERCIAL", PESSOARELACIONADA: "FORNECEDOR ANTIGO" }), /opção/i);
  assert.equal(f.writes.length, 0);
});

test("primitive metadata controls reject object payloads and scalar controls reject arrays", async () => {
  const f = fixture(), data = createOrdersGalleryData(f), context = await data.loadEditor("2");
  for (const fields of [{ OBS: { unexpected: "object" } }, { OBS: ["hidden"] }, { VALORTOTAL: [] }]) {
    await assert.rejects(data.saveEditor(context, fields), /campo|valor/i);
  }
  assert.equal(f.writes.length, 0);
});

test("typed booleans reject unrecognized normalized values instead of silently saving false", async () => {
  const f = fixture({ columns: [{ name: "CONFIRMADO", boolean: {} }], fields: { CONFIRMADO: true } });
  const data = createHrPayrollGalleryData(f), context = await data.loadEditor("IDFOLHA", "2");
  await assert.rejects(data.saveEditor(context, { CONFIRMADO: "unexpected" }), /valor|campo/i);
  assert.equal(f.writes.length, 0);
  await data.saveEditor(context, { CONFIRMADO: false });
  assert.deepEqual(f.writes[0].values, { CONFIRMADO: false });
});

for (const [control, metadata] of [
  ["lookup", { lookup: { listId: "suppliers", columnName: "Title", allowMultipleValues: true } }],
  ["person", { personOrGroup: { chooseFromType: "peopleOnly", allowMultipleSelection: true } }],
]) test(`native multi ${control} searches each safe option and saves typed IDs with the loaded version`, async () => {
  const f = fixture({ columns: [{ name: "FORNECEDOR", ...metadata }], fields: { FORNECEDORLookupId: [1] } });
  f.repository.searchRelationshipOptions = async (site, list, relation, term) => {
    assert.equal(relation.multiple, false);
    assert.equal(relation.resolvable, true);
    assert.equal(relation.kind, control);
    assert.equal(relation.listId, control === "lookup" ? "suppliers" : "");
    assert.equal(relation.displayField, "Title");
    f.searches.push({ site, list, relation, term });
    return [{ id: 3, label: "Relacionada", secondary: "" }];
  };
  const data = createHrPayrollGalleryData(f), context = await data.loadEditor("FOLHAPGTO", "2"), column = context.columns[0];
  assert.equal(column.relation.multiple, true);
  assert.equal(column.relation.resolvable, false);
  const rendererSearchColumn = { ...column, relation: { ...column.relation, multiple: false, resolvable: true, listId: "spoofed-list" } };
  await context.relationshipSearch(rendererSearchColumn, "Rela");
  await data.saveEditor(context, { FORNECEDORLookupId: [1, 3] });
  assert.equal(f.searches.at(-1).term, "Relacionada");
  assert.deepEqual(f.writes[0].values, { FORNECEDORLookupId: [1, 3] });
  assert.deepEqual(f.writes[0].options, { eTag: '"v1"' });
});
