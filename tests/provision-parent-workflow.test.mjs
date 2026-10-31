import assert from "node:assert/strict";
import test from "node:test";
import { persistEntityRecord, persistEntityRecordWithAttachments, mergeFailedFormRetryState } from "../portal/forms/entity-submit.js";
import { createMultiEntryQueue, multiEntryQueueMarkup } from "../portal/forms/multi-entry.js";
import { createSharePointRepository } from "../portal/data/sharepoint-repository.js";
import * as entityPage from "../portal/ui/entity-page.js";
import { GraphRequestError } from "../portal/data/graph-client.js";

const workflow = await import("../portal/forms/provision-parent-workflow.js").catch(error => {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  return {};
});
const entity = { id: "provisoes-de-pagamento", siteKey: "company", listNames: ["PROVISÃO PGTOS"] };
const list = { status: "resolved", id: "children" };
const markers = ["DATAPGTOEFETUADO", "PGTOAGENDADO", "DATAPGTOAGENDADO", "DATAEXECUCAOAGENDAMENTO"];
const baseFields = { FILIAL: "001", FORNECEDOR: "Fornecedor A", FORMAPGTO: "PIX", DATAPREVISTOPGTO: "2026-11-01T00:00:00Z", OBS: "Nota", QTD: "2,5", VALORTOTAL: "10,01", FRETE: "1,20", STATUS: "PAGAMENTO PREVISTO" };
const parent = (id = "10", extra = {}) => ({ id, eTag: `"${id},1"`, fields: { Title: `Descrição ${id}`, FILIAL: "001", FORNECEDOR: "Fornecedor A", FORMAPGTO: "PIX", OBS: "Original", DATAPREVISTOPGTO: "2026-11-01T00:00:00Z", VALORTOTAL: "0", ...Object.fromEntries(markers.map(name => [name, null])), ...extra } });
const file = name => ({ name, size: 1, type: "application/pdf", async arrayBuffer() { return Uint8Array.of(1).buffer; } });

function fakeRepository() {
  const data = { parents: new Map(), children: new Map() };
  const calls = [];
  const parentColumns = ["Title", "FILIAL", "FORNECEDOR", "FORMAPGTO", "OBS", "VALORTOTAL", "DATAPREVISTOPGTO", ...markers];
  const childColumns = ["Title", ...Object.keys(baseFields), "DESCRITIVOPROVISAO", "DATAPGTOEFETUADO", "PGTOAGENDADO"];
  let nextParent = 20;
  let nextChild = 100;
  const repository = {
    data, calls,
    async resolveList(site, aliases) {
      assert.equal(site, "company");
      calls.push(["resolve", aliases]);
      return { status: "resolved", id: aliases.includes("DESCRITIVOPROVISAO") ? "parents" : "children" };
    },
    async getColumns(site, id) {
      assert.equal(site, "company");
      return (id === "parents" ? parentColumns : childColumns).map(name => ({ name, displayName: name, indexed: true, ...(name.startsWith("DATA") || id === "parents" && name === "PGTOAGENDADO" ? { dateTime: {} } : { text: {} }) }));
    },
    async getItems(site, id, query = "$expand=fields") {
      assert.equal(site, "company");
      calls.push(["query", id, query]);
      const filter = new URLSearchParams(typeof query === "string" ? query : query).get("$filter");
      let values = [...data[id].values()];
      if (filter) {
        const match = filter.match(/^fields\/([A-Za-z0-9_]+) eq '((?:[^']|'')*)'$/);
        assert.ok(match, `Unsupported query ${filter}`);
        values = values.filter(item => String(item.fields[match[1]] ?? "") === match[2].replaceAll("''", "'"));
      }
      return structuredClone(values);
    },
    async getItem(site, id, itemId, query = "$expand=fields") {
      assert.equal(site, "company");
      assert.equal(query, "$expand=fields");
      calls.push(["get", id, String(itemId)]);
      const value = data[id].get(String(itemId));
      if (!value) throw Object.assign(new Error("excluído"), { status: 404 });
      return structuredClone(value);
    },
    async createItem(site, id, fields) {
      assert.equal(site, "company");
      calls.push(["create", id, structuredClone(fields)]);
      const itemId = String(id === "parents" ? nextParent++ : nextChild++);
      const item = { id: itemId, eTag: `"${itemId},1"`, fields: structuredClone(fields) };
      data[id].set(itemId, item);
      return structuredClone(item);
    },
    async updateItem(site, id, itemId, fields, options) {
      assert.equal(site, "company");
      const item = data[id].get(String(itemId));
      assert.ok(item);
      assert.ok(options?.eTag);
      calls.push(["update", id, String(itemId), fields, options]);
      if (options.eTag !== item.eTag) throw Object.assign(new Error("conflito"), { status: 412 });
      Object.assign(item.fields, fields);
      item.eTag += "+";
      return structuredClone(item);
    },
    async uploadAttachment(site, id, itemId, upload, name) {
      calls.push(["upload", id, String(itemId), name]);
      assert.ok(data[id].has(String(itemId)));
      assert.equal(upload.name, name);
    },
  };
  return repository;
}
const save = (repository, options = {}) => persistEntityRecordWithAttachments(repository, entity, list, { fields: baseFields, ...options });
const choice = item => ({ mode: "existing", id: item.id, eTag: item.eTag });
const linkedChild = (id, parentId, fields = {}) => ({ id, fields: { ...baseFields, QTD: "1", VALORTOTAL: "0", FRETE: "0", DESCRITIVOPROVISAO: parentId, DATAPGTOEFETUADO: null, PGTOAGENDADO: "PENDENTE", ...fields } });
function seedPendingParent(repo, selected = parent()) {
  repo.data.parents.set(selected.id, selected);
  const childId = `900${selected.id}`;
  repo.data.children.set(childId, linkedChild(childId, selected.id));
}
const newChildCount = repo => repo.calls.filter(call => call[0] === "create" && call[1] === "children").length;
async function failure(operation) {
  try { await operation(); } catch (error) { return error; }
  assert.fail("Expected a recoverable failure");
}

test("pending group loader excludes empty and fully paid groups while retaining mixed groups", async () => {
  const repo = fakeRepository();
  for (const id of ["10", "11", "12", "13", "14"]) repo.data.parents.set(id, parent(id));
  repo.data.children.set("1", linkedChild("1", "10"));
  repo.data.children.set("2", linkedChild("2", "10", { DATAPGTOEFETUADO: "2026-10-01", STATUS: "PAGO" }));
  repo.data.children.set("3", linkedChild("3", "11", { DATAPGTOEFETUADO: "2026-10-01" }));
  repo.data.children.set("4", linkedChild("4", "13", { PGTOAGENDADO: "PAGO" }));
  repo.data.children.set("5", linkedChild("5", "14", { STATUS: "CANCELADO" }));
  assert.deepEqual((await workflow.loadPendingProvisionParents(repo, entity)).map(option => option.id), ["10"]);
  assert.equal(repo.calls.filter(call => ["create", "update"].includes(call[0])).length, 0);
});

for (const scenario of ["empty", "date-paid", "status-paid", "schedule-paid"]) test(`closed existing group ${scenario} cannot append even with blank parent markers`, async () => {
  const repo = fakeRepository(); repo.data.parents.set("10", parent());
  if (scenario !== "empty") repo.data.children.set("1", linkedChild("1", "10", scenario === "date-paid" ? { DATAPGTOEFETUADO: "2026-10-01" } : scenario === "status-paid" ? { STATUS: "PAGO" } : { PGTOAGENDADO: "PAGO" }));
  await assert.rejects(save(repo, { provisionParentChoice: choice(parent()) }), /pendente|encerr|filho/i);
  assert.equal(repo.calls.filter(call => call[0] === "create").length, 0);
});

test("pending children are revalidated after token lookup immediately before append", async () => {
  const repo = fakeRepository(); repo.data.parents.set("10", parent());
  repo.data.children.set("1", linkedChild("1", "10"));
  const query = repo.getItems;
  repo.getItems = async (...args) => {
    const result = await query(...args);
    if (args[1] === "children" && new URLSearchParams(args[2]).get("$filter")?.startsWith("fields/Title")) repo.data.children.get("1").fields.DATAPGTOEFETUADO = "2026-10-01";
    return result;
  };
  await assert.rejects(save(repo, { provisionParentChoice: choice(parent()) }), /pendente|encerr|filho/i);
  assert.equal(repo.calls.filter(call => call[0] === "create").length, 0);
});

test("closed-group queue reselection preserves rejected row fields and files", async () => {
  const repo = fakeRepository(); repo.data.parents.set("10", parent());
  repo.data.children.set("1", linkedChild("1", "10"));
  const queue = createMultiEntryQueue(); const upload = file("MANTER.pdf");
  const row = queue.add(baseFields, {}, {}, { uploads: [upload] }, { provisionParentChoice: choice(parent()) });
  repo.data.parents.get("10").eTag = '"10,2"';
  await queue.submitAll(submitQueueRow(repo));
  const option = (await workflow.loadPendingProvisionParents(repo, entity))[0];
  repo.data.children.get("1").fields.STATUS = "PAGO";
  await assert.rejects(workflow.reselectQueuedProvisionParent(repo, entity, queue, row.id, option), /pendente|encerr|filho/i);
  assert.deepEqual(queue.snapshot()[0].fields, row.fields);
  assert.equal(queue.snapshot()[0].attachments.uploads[0], upload);
  assert.equal(queue.snapshot()[0].status, "error");
});

test("default creation verifies new parent before child and preserves supplied child data", async () => {
  const repo = fakeRepository();
  const saved = await save(repo, { fields: { ...baseFields, Title: "Documento explícito", DATAPGTOEFETUADO: "2026-10-01T00:00:00Z" } });
  const writes = repo.calls.filter(call => call[0] === "create");
  assert.deepEqual(writes.map(call => call[1]), ["parents", "children"]);
  assert.equal(saved.fields.DESCRITIVOPROVISAO, "20");
  assert.equal(saved.fields.Title, "Documento explícito");
  assert.equal(saved.fields.DATAPGTOEFETUADO, "2026-10-01T00:00:00Z");
  const createdParent = repo.data.parents.get("20");
  assert.equal(createdParent.fields.VALORTOTAL, "26,225");
  assert.equal(createdParent.fields.OBS, "Nota");
  for (const marker of markers) assert.equal(createdParent.fields[marker], null);
  assert.ok(repo.calls.findIndex(call => call[0] === "get" && call[1] === "parents") < repo.calls.findIndex(call => call[0] === "create" && call[1] === "children"));
});

test("existing selection adds no parent and sums paid plus pending children without metadata writes", async () => {
  const repo = fakeRepository();
  const selected = parent(); seedPendingParent(repo, selected);
  repo.data.children.set("1", { id: "1", fields: { DESCRITIVOPROVISAO: "10", QTD: "3", VALORTOTAL: "0.10", FRETE: "0", DATAPGTOEFETUADO: "2026-10-01" } });
  const saved = await save(repo, { provisionParentChoice: choice(selected) });
  assert.equal(saved.fields.DESCRITIVOPROVISAO, "10");
  assert.equal(repo.data.parents.size, 1);
  assert.equal(repo.data.parents.get("10").fields.VALORTOTAL, "26,525");
  assert.equal(repo.data.parents.get("10").fields.OBS, "Original");
  assert.deepEqual(repo.calls.filter(call => call[0] === "update").map(call => Object.keys(call[3])), [["VALORTOTAL"]]);
});

test("selector only exposes authoritative pending parents with identifying labels and performs no writes", async () => {
  assert.equal(typeof workflow.loadPendingProvisionParents, "function", "pending parent loader is missing");
  const repo = fakeRepository(); seedPendingParent(repo);
  for (let index = 0; index < markers.length; index++) repo.data.parents.set(String(11 + index), parent(String(11 + index), { [markers[index]]: "2026-11-01" }));
  const noEtag = parent("17"); delete noEtag.eTag; repo.data.parents.set("17", noEtag);
  const options = await workflow.loadPendingProvisionParents(repo, entity);
  assert.deepEqual(options.map(option => option.id), ["10"]);
  for (const text of ["10", "Fornecedor A", "001", "2026-11-01", "0"]) assert.ok(options[0].label.includes(text));
  assert.equal(options[0].eTag, '"10,1"');
  assert.equal(repo.calls.filter(call => ["create", "update"].includes(call[0])).length, 0);
});

for (const marker of markers) test(`existing parent with ${marker} is refused before writing child`, async () => {
  const repo = fakeRepository(); const selected = parent();
  seedPendingParent(repo, parent("10", { [marker]: "2026-10-01" }));
  await assert.rejects(save(repo, { provisionParentChoice: choice(selected) }), /pendente|pag|agend/i);
  assert.equal(newChildCount(repo), 0);
});

for (const scenario of ["changed", "deleted", "missing-etag", "wrong-id"]) test(`existing parent ${scenario} is refused before any POST`, async () => {
  const repo = fakeRepository(); const selected = parent();
  const current = parent();
  if (scenario === "changed") current.eTag = '"10,2"';
  if (scenario === "missing-etag") delete current.eTag;
  if (scenario === "wrong-id") current.id = "11";
  if (scenario !== "deleted") seedPendingParent(repo, current);
  await assert.rejects(save(repo, { provisionParentChoice: choice(selected) }));
  assert.equal(repo.calls.filter(call => call[0] === "create").length, 0);
});

test("existing selection without ETag and conflicting supplied child link fail closed", async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  await assert.rejects(save(repo, { provisionParentChoice: { mode: "existing", id: "10" } }), /ETag/i);
  await assert.rejects(save(repo, { fields: { ...baseFields, DESCRITIVOPROVISAO: "11" }, provisionParentChoice: choice(parent()) }), /vínculo|descritivo/i);
  await assert.rejects(save(repo, { fields: { ...baseFields, DESCRITIVOPROVISAO: "11" } }), /vínculo|descritivo/i);
  assert.equal(repo.calls.filter(call => call[0] === "create").length, 0);
});

for (const [name, value] of [["QTD", ""], ["VALORTOTAL", "R$ lixo"], ["FRETE", "1.2.3"], ["QTD", "-1"], ["VALORTOTAL", "1e3"]]) test(`malformed ${name}=${value} never creates a parent`, async () => {
  const repo = fakeRepository();
  await assert.rejects(save(repo, { fields: { ...baseFields, [name]: value } }), /valor|quant|num|decimal|QTD|FRETE|VALORTOTAL/i);
  assert.equal(repo.data.parents.size, 0);
});

test("412 retries fully requery children and use fresh parent ETag", async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  const update = repo.updateItem;
  let conflicts = 1;
  repo.updateItem = async (...args) => {
    if (conflicts--) {
      repo.data.children.set("2", { id: "2", fields: { DESCRITIVOPROVISAO: "10", QTD: "1", VALORTOTAL: "2", FRETE: "0" } });
      repo.data.parents.get("10").eTag += "+";
      throw Object.assign(new Error("412"), { status: 412 });
    }
    return update(...args);
  };
  await save(repo, { provisionParentChoice: choice(parent()) });
  assert.equal(repo.data.parents.get("10").fields.VALORTOTAL, "28,225");
  // One authoritative eligibility read, then both complete total attempts.
  assert.equal(repo.calls.filter(call => call[0] === "query" && call[2].includes("DESCRITIVOPROVISAO")).length, 3);
  assert.equal(newChildCount(repo), 1);
  assert.equal(repo.data.children.size, 3); // Original pending + concurrent + newly saved.
});

test("bounded total conflicts checkpoint child and retry totals without another creation", async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  const update = repo.updateItem; let attempts = 0;
  repo.updateItem = async () => { attempts++; throw Object.assign(new Error("412"), { status: 412 }); };
  const error = await failure(() => save(repo, { provisionParentChoice: choice(parent()) }));
  assert.ok(attempts >= 2 && attempts <= 4);
  assert.ok(error.retryItem?.provisionRetryState);
  repo.updateItem = update;
  await save(repo, { retryItem: error.retryItem });
  assert.equal(newChildCount(repo), 1);
  assert.equal(repo.data.parents.get("10").fields.VALORTOTAL, "26,225");
});

test("malformed historic child stops total update and retains committed child checkpoint", async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  repo.data.children.set("1", { id: "1", fields: { DESCRITIVOPROVISAO: "10", QTD: "1", VALORTOTAL: "", FRETE: "0" } });
  const error = await failure(() => save(repo, { provisionParentChoice: choice(parent()) }));
  assert.ok(error.retryItem?.provisionRetryState?.childId);
  assert.equal(repo.calls.filter(call => call[0] === "update").length, 0);
});

for (const target of ["parents", "children"]) test(`lost ${target} POST response recovers stable title with frozen fields and choice`, async () => {
  const repo = fakeRepository();
  const create = repo.createItem; const query = repo.getItems; let hide = true;
  repo.createItem = async (...args) => {
    const saved = await create(...args);
    if (args[1] === target && hide) throw new Error("resposta perdida");
    return saved;
  };
  repo.getItems = async (...args) => args[1] === target && hide ? [] : query(...args);
  const error = await failure(() => save(repo, { attachments: { uploads: [file("ORIGINAL.pdf")] } }));
  assert.ok(error.retryItem?.provisionRetryState, "lost response must carry checkpoint");
  const state = mergeFailedFormRetryState({ displayValues: { QTD: "99" } }, error, null, { uploads: [file("ORIGINAL.pdf")] });
  hide = false;
  const saved = await save(repo, { fields: { ...baseFields, QTD: "99" }, provisionParentChoice: { mode: "existing", id: "999" }, retryState: state, retryItem: state.persistenceRetryItem, attachments: { uploads: [file("CHANGED.pdf")] } });
  assert.equal(saved.fields.QTD, "2,5");
  assert.equal(repo.data.parents.size, 1);
  assert.equal(newChildCount(repo), 1);
  assert.deepEqual(repo.calls.filter(call => call[0] === "upload").map(call => call[3]), ["ORIGINAL.pdf"]);
});

test("silent child POST response is recovered in same attempt", async () => {
  const repo = fakeRepository(); const create = repo.createItem;
  repo.createItem = async (...args) => { const saved = await create(...args); return args[1] === "children" ? undefined : saved; };
  const saved = await save(repo);
  assert.equal(saved.id, "100");
  assert.equal(repo.data.parents.size, 1);
  assert.equal(newChildCount(repo), 1);
});

test("ambiguous POST never repeats while stable-title recovery is still absent", async () => {
  const repo = fakeRepository(); const create = repo.createItem;
  repo.createItem = async (...args) => { await create(...args); throw new Error("response lost"); };
  repo.getItems = async () => [];
  const first = await failure(() => save(repo));
  const second = await failure(() => save(repo, { retryItem: first.retryItem }));
  assert.ok(second.retryItem?.provisionRetryState);
  assert.equal(repo.calls.filter(call => call[0] === "create").length, 1);
});

test("returned parent ID remains checkpointed if authoritative read fails", async () => {
  const repo = fakeRepository(); const get = repo.getItem; let unavailable = true;
  repo.getItem = async (...args) => { if (args[1] === "parents" && unavailable) throw new Error("read offline"); return get(...args); };
  const error = await failure(() => save(repo));
  assert.equal(error.retryItem?.provisionRetryState?.parentId, "20");
  unavailable = false;
  await save(repo, { retryItem: error.retryItem });
  assert.equal(repo.data.parents.size, 1);
});

test("attachment retry keeps parent, child and only remaining frozen uploads", async () => {
  const repo = fakeRepository(); const upload = repo.uploadAttachment; let fail = true;
  repo.uploadAttachment = async (...args) => { if (args[4] === "B.pdf" && fail) throw new Error("offline"); return upload(...args); };
  const error = await failure(() => save(repo, { attachments: { uploads: [file("A.pdf"), file("B.pdf")] } }));
  assert.equal(error.name, "EntityAttachmentPersistenceError");
  assert.ok(error.retryItem.provisionRetryState);
  fail = false;
  await save(repo, { retryItem: error.retryItem, fields: { QTD: "999" }, attachments: { uploads: [file("C.pdf")] } });
  assert.equal(repo.data.parents.size, 1);
  assert.equal(newChildCount(repo), 1);
  assert.deepEqual(repo.calls.filter(call => call[0] === "upload").map(call => call[3]), ["A.pdf", "B.pdf"]);
});

test("queue freezes parent choice per row and resumes partial child commits", async () => {
  const repo = fakeRepository(); const queue = createMultiEntryQueue();
  const selected = parent(); seedPendingParent(repo, selected);
  queue.add(baseFields, {}, {}, {}, { provisionParentChoice: choice(selected) });
  queue.add(baseFields, {}, {}, {}, { provisionParentChoice: { mode: "new" } });
  const update = repo.updateItem; let fail = true;
  repo.updateItem = async (...args) => { if (args[2] === "10" && fail) throw new Error("total offline"); return update(...args); };
  const submit = row => save(repo, { fields: row.fields, attachments: row.attachments, retryState: row.retryState, retryItem: row.retryItem });
  await queue.submitAll(submit);
  assert.deepEqual(queue.snapshot().map(row => row.status), ["error", "success"]);
  assert.equal(newChildCount(repo), 2);
  fail = false; await queue.submitAll(submit);
  assert.deepEqual(queue.snapshot().map(row => row.status), ["success", "success"]);
  assert.equal(repo.data.parents.size, 2);
  assert.equal(newChildCount(repo), 2);
});

test("edits preserve old path and require current ETag; generic creation is unchanged", async () => {
  const repo = fakeRepository(); repo.data.children.set("5", { id: "5", eTag: '"5,1"', fields: { QTD: "1" } });
  await persistEntityRecord(repo, entity, list, { mode: "edit", item: { id: "5", eTag: '"5,1"' }, fields: { QTD: "2" } });
  await assert.rejects(persistEntityRecord(repo, entity, list, { mode: "edit", item: { id: "5" }, fields: {} }), /ETag/);
  await persistEntityRecord(repo, { id: "other", siteKey: "company" }, list, { fields: { Title: "Other" } });
  assert.equal(repo.data.parents.size, 0);
  assert.equal(repo.data.children.get("5").fields.QTD, "2");
  assert.equal(repo.calls.filter(call => call[0] === "resolve").length, 0);
});

test("total includes repository Graph pagination instead of a first-page sum", async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  const paged = createSharePointRepository({ async request(path) {
    if (path === "/sites/example.test:/finance") return { id: "site" };
    if (path.includes("$skiptoken=next")) return { value: [{ id: "1", fields: { DESCRITIVOPROVISAO: "10", QTD: "2", VALORTOTAL: "1.1", FRETE: "0", DATAPGTOEFETUADO: "2026-01-01" } }] };
    if (path.startsWith("/sites/site/lists/children/items?")) return { value: [...repo.data.children.values()], "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/site/lists/children/items?$skiptoken=next" };
    throw new Error(`Unexpected path ${path}`);
  } }, { company: { host: "example.test", path: "/finance" } });
  const query = repo.getItems;
  repo.getItems = (...args) => args[1] === "children" && String(args[2]).includes("DESCRITIVOPROVISAO") ? paged.getItems(...args) : query(...args);
  await save(repo, { provisionParentChoice: choice(parent()) });
  assert.equal(repo.data.parents.get("10").fields.VALORTOTAL, "28,425");
});

test("revalidation occurs after title recovery query immediately before child POST", async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  const query = repo.getItems;
  repo.getItems = async (...args) => {
    const items = await query(...args);
    if (args[1] === "children" && new URLSearchParams(args[2]).get("$filter")?.startsWith("fields/Title")) repo.data.parents.get("10").fields.PGTOAGENDADO = "2026-10-12";
    return items;
  };
  await assert.rejects(save(repo, { provisionParentChoice: choice(parent()) }), /pendente|agend/i);
  assert.equal(newChildCount(repo), 0);
});

test("existing child title collision cannot orphan a newly created parent", async () => {
  const repo = fakeRepository();
  repo.data.children.set("3", { id: "3", fields: { ...baseFields, Title: "Mesmo documento", DESCRITIVOPROVISAO: "8" } });
  await assert.rejects(save(repo, { fields: { ...baseFields, Title: "Mesmo documento" } }), /título|conflit/i);
  assert.equal(repo.data.parents.size, 0);
  assert.equal(repo.data.children.get("3").fields.DESCRITIVOPROVISAO, "8");
});

test("authoritative child read accepts equivalent SharePoint datetime representation", async () => {
  const repo = fakeRepository(); const create = repo.createItem;
  repo.createItem = async (...args) => {
    const saved = await create(...args);
    if (args[1] === "children") repo.data.children.get(saved.id).fields.DATAPREVISTOPGTO = "2026-11-01T00:00:00.000Z";
    return saved;
  };
  const saved = await save(repo);
  assert.equal(saved.fields.DESCRITIVOPROVISAO, "20");
});

test("internal names resolved by metadata are used for link, amount and parent dates", async () => {
  const repo = fakeRepository(); const columns = repo.getColumns;
  repo.getColumns = async (...args) => (await columns(...args)).map(column => ({ ...column, name: `internal_${column.name}`, displayName: column.name }));
  const renamed = Object.fromEntries(Object.entries(baseFields).map(([name, value]) => [`internal_${name}`, value]));
  const saved = await save(repo, { fields: renamed });
  assert.equal(saved.fields.internal_DESCRITIVOPROVISAO, "20");
  assert.equal(repo.data.parents.get("20").fields.internal_VALORTOTAL, "26,225");
  assert.equal(repo.data.parents.get("20").fields.internal_DATAPGTOEFETUADO, null);
});

test("lost child with conflicting recovered link is rejected without relinking", async () => {
  const repo = fakeRepository(); const create = repo.createItem; const query = repo.getItems; let hide = true;
  repo.createItem = async (...args) => { const saved = await create(...args); if (args[1] === "children") throw new Error("lost"); return saved; };
  repo.getItems = (...args) => args[1] === "children" && hide ? [] : query(...args);
  const error = await failure(() => save(repo));
  repo.data.children.get("100").fields.DESCRITIVOPROVISAO = "99";
  hide = false;
  await assert.rejects(save(repo, { retryItem: error.retryItem }), /conflit|vínculo/i);
  assert.equal(repo.data.children.get("100").fields.DESCRITIVOPROVISAO, "99");
  assert.equal(repo.data.parents.size, 1);
  assert.equal(repo.calls.filter(call => call[0] === "update").length, 0);
});

test("silent parent POST response recovers parent before child", async () => {
  const repo = fakeRepository(); const create = repo.createItem;
  repo.createItem = async (...args) => { const saved = await create(...args); return args[1] === "parents" ? null : saved; };
  await save(repo);
  assert.equal(repo.data.parents.size, 1);
  assert.equal(repo.data.children.get("100").fields.DESCRITIVOPROVISAO, "20");
});

test("total readback mismatch checkpoints saved child for a total-only retry", async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  const update = repo.updateItem;
  repo.updateItem = async (...args) => { const saved = await update(...args); repo.data.parents.get("10").fields.VALORTOTAL = "1"; return saved; };
  const error = await failure(() => save(repo, { provisionParentChoice: choice(parent()) }));
  assert.match(error.message, /total|releitura/i);
  assert.equal(error.retryItem.provisionRetryState.childId, "100");
  repo.updateItem = update;
  await save(repo, { retryItem: error.retryItem });
  assert.equal(repo.data.parents.get("10").fields.VALORTOTAL, "26,225");
  assert.equal(newChildCount(repo), 1);
});

test("412 retry cannot append to a parent paid during total recalculation", async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  let writes = 0;
  repo.updateItem = async () => { writes++; repo.data.parents.get("10").fields.DATAPGTOEFETUADO = "2026-10-12"; throw Object.assign(new Error("412"), { status: 412 }); };
  await assert.rejects(save(repo, { provisionParentChoice: choice(parent()) }), /pendente|pag/i);
  assert.equal(writes, 1);
  assert.equal(newChildCount(repo), 1);
});

test("invalid pending selection before any write leaves fields and choice editable for resubmission", async () => {
  const repo = fakeRepository(); seedPendingParent(repo, parent("10", { PGTOAGENDADO: "2026-10-12" }));
  const error = await failure(() => save(repo, { provisionParentChoice: choice(parent()) }));
  assert.equal(error.retryItem, undefined, "a rejected selection is not a committed workflow");
  assert.equal(error.provisionRetryState, undefined);
  const saved = await save(repo, { fields: { ...baseFields, QTD: "1" }, provisionParentChoice: { mode: "new" } });
  assert.equal(saved.fields.QTD, "1");
  assert.equal(repo.data.parents.get("20").fields.VALORTOTAL, "11,21");
});

test("unindexed Title and textual link use complete repository reads without unsupported Graph filters", async () => {
  const repo = fakeRepository(); const columns = repo.getColumns; const query = repo.getItems;
  repo.getColumns = async (...args) => (await columns(...args)).map(column => ({ ...column, indexed: false }));
  repo.data.children.set("3", { id: "3", fields: { ...baseFields, DESCRITIVOPROVISAO: "99", VALORTOTAL: "invalid unrelated amount" } });
  repo.getItems = async (...args) => {
    if (new URLSearchParams(args[2]).has("$filter")) throw new Error("Graph refuses nonindexed filters");
    return query(...args);
  };
  const saved = await save(repo);
  assert.equal(saved.fields.DESCRITIVOPROVISAO, "20");
  assert.equal(repo.data.parents.get("20").fields.VALORTOTAL, "26,225");
  assert.equal(repo.data.children.get("3").fields.DESCRITIVOPROVISAO, "99");
});

const submitQueueRow = repo => row => save(repo, { fields: row.fields, attachments: row.attachments, retryState: row.retryState, retryItem: row.retryItem });

test("same-parent queue explicitly reselects second prewrite-rejected row without rebuilding fields or attachments", async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  const queue = createMultiEntryQueue(); const secondFile = file("SEGUNDO.pdf");
  queue.add(baseFields, { QTD: "2,5" }, {}, { uploads: [file("PRIMEIRO.pdf")] }, { provisionParentChoice: choice(parent()) });
  const second = queue.add(baseFields, { QTD: "2,5" }, { FORNECEDOR: "Fornecedor A" }, { uploads: [secondFile] }, { provisionParentChoice: choice(parent()) });
  await queue.submitAll(submitQueueRow(repo));
  assert.deepEqual(queue.snapshot().map(row => row.status), ["success", "error"]);
  assert.equal(queue.snapshot()[1].retryItem, undefined);
  assert.equal(newChildCount(repo), 1);
  assert.equal(typeof workflow.reselectQueuedProvisionParent, "function", "prewrite queue reselection is missing");
  const options = await workflow.loadPendingProvisionParents(repo, entity);
  await workflow.reselectQueuedProvisionParent(repo, entity, queue, second.id, options[0]);
  const selected = queue.snapshot()[1];
  assert.deepEqual(selected.fields, second.fields);
  assert.deepEqual(selected.rawValues, second.rawValues);
  assert.deepEqual(selected.relationshipLabels, second.relationshipLabels);
  assert.equal(selected.attachments.uploads[0], secondFile);
  assert.equal(selected.retryState.provisionParentChoice.eTag, repo.data.parents.get("10").eTag);
  await queue.submitAll(submitQueueRow(repo));
  assert.deepEqual(queue.snapshot().map(row => row.status), ["success", "success"]);
  assert.equal(newChildCount(repo), 2);
  assert.equal(repo.data.parents.size, 1);
  assert.equal(repo.data.parents.get("10").fields.VALORTOTAL, "52,45");
  assert.deepEqual(repo.calls.filter(call => call[0] === "upload").map(call => call[3]), ["PRIMEIRO.pdf", "SEGUNDO.pdf"]);
});

for (const change of ["paid", "etag", "deleted", "missing-etag"]) test(`queue reselection refuses authoritative ${change} parent and retains row files`, async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  const queue = createMultiEntryQueue(); const upload = file("MANTER.pdf");
  const row = queue.add(baseFields, {}, {}, { uploads: [upload] }, { provisionParentChoice: choice(parent()) });
  repo.data.parents.get("10").eTag = '"10,2"';
  await queue.submitAll(submitQueueRow(repo));
  assert.equal(queue.snapshot()[0].status, "error");
  assert.equal(typeof workflow.reselectQueuedProvisionParent, "function", "authoritative queue reselection is missing");
  const option = (await workflow.loadPendingProvisionParents(repo, entity))[0];
  if (change === "paid") repo.data.parents.get("10").fields.DATAPGTOEFETUADO = "2026-10-12";
  if (change === "etag") repo.data.parents.get("10").eTag = '"10,3"';
  if (change === "deleted") repo.data.parents.delete("10");
  if (change === "missing-etag") delete repo.data.parents.get("10").eTag;
  await assert.rejects(workflow.reselectQueuedProvisionParent(repo, entity, queue, row.id, option));
  assert.equal(queue.snapshot()[0].retryState.provisionParentChoice.eTag, '"10,1"');
  assert.equal(queue.snapshot()[0].attachments.uploads[0], upload);
  assert.equal(queue.snapshot()[0].status, "error");
  assert.equal(newChildCount(repo), 0);
});

test("queue cannot reselect a started partial commit or bypass its frozen checkpoint", async () => {
  const repo = fakeRepository(); seedPendingParent(repo); repo.data.parents.set("11", parent("11"));
  const queue = createMultiEntryQueue(); const upload = file("ORIGINAL.pdf");
  const row = queue.add(baseFields, {}, {}, { uploads: [upload] }, { provisionParentChoice: choice(parent()) });
  repo.updateItem = async () => { throw new Error("total update offline"); };
  await queue.submitAll(submitQueueRow(repo));
  const checkpoint = queue.snapshot()[0].retryItem;
  assert.equal(checkpoint.provisionRetryState.childId, "100");
  assert.equal(typeof workflow.reselectQueuedProvisionParent, "function", "checkpoint reselection guard is missing");
  await assert.rejects(workflow.reselectQueuedProvisionParent(repo, entity, queue, row.id, { ...choice(parent("11")), label: "11" }), /grava|retent|inici|parcial/i);
  assert.throws(() => queue.reselectProvisionParent(row.id, choice(parent("11"))), /grava|retent|inici|parcial/i);
  assert.equal(queue.snapshot()[0].retryItem, checkpoint);
  assert.equal(queue.snapshot()[0].retryState.provisionParentChoice.id, "10");
  assert.equal(queue.snapshot()[0].attachments.uploads[0], upload);
  assert.equal(repo.data.children.get("100").fields.DESCRITIVOPROVISAO, "10");
});

test("queue exposes reselection only for rejected provision rows with no started checkpoint", async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  const queue = createMultiEntryQueue(); queue.add(baseFields, {}, {}, {}, { provisionParentChoice: choice(parent()) });
  repo.data.parents.get("10").eTag = '"10,2"';
  await queue.submitAll(submitQueueRow(repo));
  assert.match(multiEntryQueueMarkup(queue.snapshot(), [], { allowProvisionReselection: true }), /data-multi-entry-reselect/);
  assert.doesNotMatch(multiEntryQueueMarkup(queue.snapshot(), []), /data-multi-entry-reselect/);
  const partial = { ...queue.snapshot()[0], retryItem: { provisionRetryState: { childId: "100" } } };
  assert.doesNotMatch(multiEntryQueueMarkup([partial], [], { allowProvisionReselection: true }), /data-multi-entry-reselect/);
});

function queueReselectHost(rowId) {
  const control = (dataset = {}) => {
    const listeners = new Map();
    return { dataset, value: "", innerHTML: "", textContent: "", disabled: false, hidden: true,
      addEventListener(name, handler) { listeners.set(name, handler); },
      async trigger(name) { await listeners.get(name)?.({ currentTarget: this }); } };
  };
  const button = control({ multiEntryReselect: rowId });
  const panel = control(); const select = control(); const apply = control(); const status = control();
  return { button, panel, select, apply, status,
    querySelectorAll(selector) { return selector === "[data-multi-entry-reselect]" ? [button] : []; },
    querySelector(selector) {
      return selector.startsWith("[data-multi-entry-parent-options=") ? panel
        : selector.startsWith("[data-multi-entry-parent-id=") ? select
          : selector.startsWith("[data-multi-entry-parent-apply=") ? apply
            : selector.startsWith("[data-multi-entry-parent-status=") ? status : null;
    } };
}

test("queue UI opens current pending options then explicitly confirms reselection without writes or file loss", async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  const queue = createMultiEntryQueue(); const upload = file("PRESERVADO.pdf");
  const row = queue.add(baseFields, {}, {}, { uploads: [upload] }, { provisionParentChoice: choice(parent()) });
  repo.data.parents.get("10").eTag = '"10,2"';
  await queue.submitAll(submitQueueRow(repo));
  const host = queueReselectHost(row.id);
  assert.equal(typeof entityPage.bindProvisionQueueReselection, "function", "queue reselection UI binding is missing");
  entityPage.bindProvisionQueueReselection(host, { repository: repo, entity, queue });
  await host.button.trigger("click");
  assert.equal(host.panel.hidden, false);
  assert.match(host.select.innerHTML, /Fornecedor A/);
  assert.equal(queue.snapshot()[0].retryState.provisionParentChoice.eTag, '"10,1"');
  assert.equal(newChildCount(repo), 0);
  host.select.value = "10";
  await host.apply.trigger("click");
  assert.equal(queue.snapshot()[0].retryState.provisionParentChoice.eTag, '"10,2"');
  assert.equal(queue.snapshot()[0].attachments.uploads[0], upload);
  assert.equal(newChildCount(repo), 0);
  await queue.submitAll(submitQueueRow(repo));
  assert.equal(queue.snapshot()[0].status, "success");
});

test("queue UI refuses parent payment change between options loading and confirmation", async () => {
  const repo = fakeRepository(); seedPendingParent(repo);
  const queue = createMultiEntryQueue(); const row = queue.add(baseFields, {}, {}, {}, { provisionParentChoice: choice(parent()) });
  repo.data.parents.get("10").eTag = '"10,2"'; await queue.submitAll(submitQueueRow(repo));
  const host = queueReselectHost(row.id);
  assert.equal(typeof entityPage.bindProvisionQueueReselection, "function", "queue reselection UI validation is missing");
  entityPage.bindProvisionQueueReselection(host, { repository: repo, entity, queue });
  await host.button.trigger("click");
  repo.data.parents.get("10").fields.PGTOAGENDADO = "2026-10-12";
  host.select.value = "10"; await host.apply.trigger("click");
  assert.match(host.status.textContent, /pendente|agend/i);
  assert.equal(queue.snapshot()[0].status, "error");
  assert.equal(queue.snapshot()[0].retryState.provisionParentChoice.eTag, '"10,1"');
  assert.equal(newChildCount(repo), 0);
});

for (const [target, status, code] of [["parents", 403, "accessDenied"], ["children", 403, "accessDenied"], ["parents", 400, "invalidRequest"], ["children", 401, "token_unavailable"]]) test(`${target} explicit HTTP ${status} rejection retries same token and identity after restoration`, async () => {
  const repo = fakeRepository(); const create = repo.createItem; let rejected = true; const attempts = [];
  repo.createItem = async (...args) => {
    if (args[1] === target) {
      attempts.push(structuredClone(args[2]));
      if (rejected) throw new GraphRequestError({ status, code, message: "explicit noncommitting rejection" });
    }
    return create(...args);
  };
  const upload = file("ORIGINAL.pdf");
  const error = await failure(() => save(repo, { attachments: { uploads: [upload] } }));
  assert.equal(error.status, status);
  assert.ok(error.retryItem?.provisionRetryState, "the rejected attempt must retain stable tokens");
  assert.equal(repo.data[target].size, 0);
  assert.equal(error.retryItem.provisionRetryState[target === "parents" ? "parentAttempted" : "childAttempted"], false, "an explicit rejection is safe to POST again");
  rejected = false;
  const saved = await save(repo, { retryItem: error.retryItem, fields: { ...baseFields, QTD: "999" }, provisionParentChoice: { mode: "existing", id: "999", eTag: '"999,1"' }, attachments: { uploads: [file("CHANGED.pdf")] } });
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(saved.fields.QTD, "2,5");
  assert.equal(repo.data.parents.size, 1);
  assert.equal(newChildCount(repo), 1);
  assert.equal(saved.fields.DESCRITIVOPROVISAO, "20");
  assert.equal(repo.calls.filter(call => call[0] === "create" && call[1] === "parents").length, 1);
  assert.deepEqual(repo.calls.filter(call => call[0] === "upload").map(call => call[3]), ["ORIGINAL.pdf"]);
});

for (const status of [409, 412, 429, 500, 503]) test(`HTTP ${status} cannot be assumed noncommitting and never repeats an unrecovered POST`, async () => {
  const repo = fakeRepository(); const create = repo.createItem; let calls = 0;
  repo.createItem = async (...args) => {
    calls++;
    if (calls === 1) throw new GraphRequestError({ status, code: `http_${status}`, message: "ambiguous outcome" });
    return create(...args);
  };
  const error = await failure(() => save(repo));
  assert.equal(error.retryItem.provisionRetryState.parentAttempted, true);
  const again = await failure(() => save(repo, { retryItem: error.retryItem }));
  assert.ok(again.retryItem.provisionRetryState);
  assert.equal(calls, 1);
  assert.equal(repo.data.parents.size, 0);
});
