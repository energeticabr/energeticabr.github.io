import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const module = await import("../src/chat/commercial-documents-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const build = (snapshot, filters = {}, today = "2026-10-05") => {
  assert.equal(typeof module.buildCommercialDocuments, "function", "buildCommercialDocuments must be implemented");
  return module.buildCommercialDocuments(snapshot, filters, today);
};
const property = (extra = {}) => ({ id: "1", branch: "A", property: "Casa", saleStatus: "VENDIDO", visualStatus: "ATIVO",
  fiscal: "DECLARADO", insurance: "10", proposal: "10", bankContract: "10", deed: "10", brokerDocument: "10",
  fiscalDocument: "10", fiscalPayment: "20", brokerPayment: "20", fiscalObservation: "Obs", brokerage: "SIM",
  broker: "João", brokerDescription: "Comissão", fiscalValue: 0, brokerValue: 100, ...extra });
const contract = (extra = {}) => ({ id: "100", branch: "A", property: "Casa", buyer: "Ana", status: "ATIVO",
  total: 1000, saleDate: "2026-10-01", broker: "João", ...extra });
const receipt = (extra = {}) => ({ id: "1", contractId: "100", createdDate: "2026-09-01", dueDate: "2026-10-01",
  paidDate: "", description: "Parcela", amount: 100, status: "PREVISTO", ...extra });
const snapshot = (extra = {}) => ({ complete: true, properties: [property()], contracts: [contract()],
  documents: [{ id: "10", createdDate: "2026-09-01" }], expenses: [{ id: "20", paidDate: "2026-10-02" }],
  receipts: [receipt()], ...extra });

test("eleven measures remain independent from eight blank metadata fields", () => {
  const row = property({ insurance: "", proposal: " ", bankContract: null, deed: "", brokerDocument: "", fiscalDocument: "",
    fiscalPayment: "", brokerPayment: "", fiscal: "", saleStatus: "", visualStatus: "", fiscalObservation: "",
    brokerage: "", broker: "", brokerDescription: "", fiscalValue: null, brokerValue: "" });
  const result = build(snapshot({ properties: [row] }));
  assert.equal(result.rows[0].pendingMeasures, 11); assert.equal(result.rows[0].pendingFields, 8);
  assert.equal(result.rows[0].totalPendencies, 19);
  assert.equal(result.cards.totalIDs, 11); assert.equal(result.cards.totalFields, 8); assert.equal(result.cards.total, 11);
  assert.equal(result.cards.totalPendencies, 19);
  assert.equal(result.branches[0].pendingMeasures, 11);
  assert.deepEqual(Object.keys(result.cards.counts), ["insurance", "proposal", "bankContract", "deed", "brokerDocument", "fiscalDocument", "brokerPayment"]);
});

test("missing fiscal payment counts in measures although omitted from seven summary cards", () => {
  const result = build(snapshot({ properties: [property({ fiscalPayment: "" })] }));
  assert.equal(result.rows[0].pendingMeasures, 1); assert.equal(result.cards.totalIDs, 1);
  assert.deepEqual(Object.values(result.cards.counts), [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(result.branches[0].counts.fiscalPayment, 1);
});

test("DISPENSADO IDs and exempt commercial/visual statuses are nonpending but undeclared fiscal is pending", () => {
  const result = build(snapshot({ properties: [property({ insurance: " dispensado ", proposal: "DISPENSADO", bankContract: "DISPENSADO",
    deed: "DISPENSADO", brokerDocument: "DISPENSADO", fiscalDocument: "DISPENSADO", fiscalPayment: "DISPENSADO",
    brokerPayment: "DISPENSADO", saleStatus: "DISPENSADO", visualStatus: "DISPENSADO", fiscal: "DISPENSADO" })] }));
  assert.equal(result.rows[0].pendingMeasures, 1); assert.equal(result.rows[0].pendingFields, 0);
  assert.equal(result.rows[0].ids.insurance.tone, "amber"); assert.equal(result.rows[0].fiscalSituation, "NÃO DECLARADO");
  assert.equal(result.rows[0].saleState.label, "DISPENSADO"); assert.equal(result.rows[0].detailSaleState.label, "PENDENTE");
  assert.equal(result.rows[0].detailVisualState.tone, "red");
  assert.equal(result.rows[0].detailIds.deed.label, "DISPENSADO"); assert.equal(result.rows[0].detailIds.deed.tone, "neutral");
});

test("only blank branch/property TODOS and accented ESCRITÓRIO prefix are excluded", () => {
  const properties = [property({ id: "1", branch: "" }), property({ id: "2", property: " " }),
    property({ id: "3", property: " todos " }), property({ id: "4", property: " Escritório Central " }),
    property({ id: "5", property: "ESCRITORIO sem acento" }), property({ id: "6", branch: "B", property: "Apartamento" })];
  const result = build(snapshot({ properties }));
  assert.deepEqual(result.rows.map(row => row.id), ["5", "6"]); assert.deepEqual(result.branches.map(row => row.name), ["A", "B"]);
  assert.deepEqual(result.filterOptions.property, ["Apartamento", "ESCRITORIO sem acento"]);
});

test("default status is all and branch/status alone never activate detail", () => {
  const source = snapshot({ properties: [property(), property({ id: "2", property: "Lote", saleStatus: "NÃO VENDIDO", visualStatus: "INATIVO" })] });
  assert.equal(build(source).rows.length, 2); assert.equal(build(source).detail, false);
  assert.equal(build(source, { branch: "A", saleStatus: "NÃO VENDIDO" }).detail, false);
  assert.deepEqual(build(source, { saleStatus: "NÃO VENDIDO" }).rows.map(row => row.property), ["Lote"]);
  assert.equal(build(source, { saleStatus: "INATIVO" }).rows.length, 0);
  for (const filters of [{ contractId: "100" }, { buyer: "Ana" }, { property: "Casa" }]) assert.equal(build(source, filters).detail, true);
});

test("buyer and item-ID contract filters join both branch and property and are independently existential", () => {
  const source = snapshot({ properties: [property(), property({ id: "2", branch: "B" })],
    contracts: [contract(), contract({ id: "101", buyer: "Bia" }), contract({ id: "200", branch: "B", buyer: "Carlos" })] });
  assert.deepEqual(build(source, { buyer: "ana" }).rows.map(row => row.branch), ["A"]);
  assert.deepEqual(build(source, { contractId: 200 }).rows.map(row => row.branch), ["B"]);
  const independent = build(source, { buyer: "Ana", contractId: "101" });
  assert.equal(independent.rows.length, 1); assert.equal(independent.rows[0].contracts.length, 0);
  assert.equal(build(source, { branch: "B", contractId: "100" }).rows.length, 0);
  assert.deepEqual(Object.keys(build(source).filterOptions), ["branch", "contractId", "buyer", "property", "saleStatus"]);
  assert.deepEqual(build(source).filterOptions.contractId, ["100", "101", "200"]);
});

test("arbitrary textual document IDs are preserved and never split or coerced into lookups", () => {
  const result = build(snapshot({ properties: [property({ proposal: "10; 11", deed: "ABC-001", insurance: "0010", bankContract: "10.0" })] }));
  assert.deepEqual([result.rows[0].ids.proposal.value, result.rows[0].ids.proposal.date, result.rows[0].ids.proposal.dateLabel], ["10; 11", "", "SEM DATA"]);
  assert.equal(result.rows[0].ids.deed.date, ""); assert.equal(result.rows[0].ids.insurance.date, "2026-09-01");
  assert.equal(result.rows[0].ids.bankContract.date, "2026-09-01"); assert.equal(result.rows[0].pendingMeasures, 0);
  for (const value of ["0", "-1", "ABC/10", "10,11", "9007199254740993"]) {
    const row = build(snapshot({ properties: [property({ proposal: value })] })).rows[0];
    assert.equal(row.proposal, value); assert.equal(row.ids.proposal.date, ""); assert.equal(row.ids.proposal.tone, "green");
  }
});

test("fiscal payment without paid date is amber while broker payment stays green with amber SEM DATA note", () => {
  const result = build(snapshot({ expenses: [{ id: "20", paidDate: "" }] })); const row = result.rows[0];
  assert.equal(row.pendingMeasures, 0); assert.equal(row.ids.fiscalPayment.tone, "amber");
  assert.equal(row.ids.fiscalPayment.note, "PAGAMENTO NÃO EFETUADO");
  assert.equal(row.ids.brokerPayment.tone, "green"); assert.equal(row.ids.brokerPayment.dateTone, "amber");
  assert.equal(row.ids.brokerPayment.dateLabel, "SEM DATA");
  assert.equal(build(snapshot()).rows[0].ids.fiscalPayment.date, "2026-10-02");
});

test("document dates come from Created and payment dates come only from expenses", () => {
  const result = build(snapshot({ properties: [property({ fiscalPayment: "10", brokerPayment: "10" })] }));
  assert.equal(result.rows[0].ids.deed.date, "2026-09-01"); assert.equal(result.rows[0].ids.fiscalPayment.date, "");
  assert.equal(result.rows[0].ids.brokerPayment.date, "");
  assert.deepEqual(result.detailFields, ["saleStatus", "visualStatus", "fiscal", "fiscalPayment", "fiscalDocument", "fiscalValue",
    "fiscalObservation", "brokerage", "broker", "brokerDocument", "brokerValue", "brokerDescription", "deed", "bankContract"]);
});
test("pt-BR scalar IDs resolve grouped thousands rather than another paid item", () => {
 const row=build(snapshot({properties:[property({fiscalPayment:"1.000",proposal:"1.000,00",insurance:"5, 31"})],
 expenses:[{id:"1",paidDate:"2026-01-01"},{id:"1000",paidDate:""}],
 documents:[{id:"1",createdDate:"2026-01-01"},{id:"1000",createdDate:"2026-07-24"}]})).rows[0];
 assert.equal(row.ids.fiscalPayment.date,"");assert.equal(row.ids.fiscalPayment.tone,"amber");
 assert.equal(row.ids.proposal.date,"2026-07-24");assert.equal(row.ids.insurance.date,"");
});
test("Created timestamps use Sao Paulo calendar days without shifting date-only payment fields", () => {
 const result=build(snapshot({documents:[{id:"10",createdDate:"2026-07-25T01:30:00Z"}],
 expenses:[{id:"20",paidDate:"2026-07-25"}],receipts:[receipt({createdDate:"2026-09-15T01:30:00Z",dueDate:"2026-09-15"})]}));
 assert.equal(result.rows[0].ids.deed.date,"2026-07-24");
 assert.equal(result.rows[0].ids.fiscalPayment.date,"2026-07-25");
 assert.equal(result.rows[0].contracts[0].payments[0].createdDate,"2026-09-14");
 assert.equal(result.rows[0].contracts[0].payments[0].dueDate,"2026-09-15");
});
test("timezone-free Created input has the same validated instant on devices in different timezones", () => {
 const url=new URL("../src/chat/commercial-documents-model.js",import.meta.url).href;
 const code=`import {normalizeCommercialDocumentsCreatedDate as convert} from ${JSON.stringify(url)};process.stdout.write(convert("2026-07-25T01:30:00"));`;
 for(const timezone of ["UTC","America/Sao_Paulo","Asia/Tokyo"]){
  const result=spawnSync(process.execPath,["--input-type=module","-e",code],{env:{...process.env,TZ:timezone},encoding:"utf8",timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,"2026-07-24",timezone);
 }
});

test("contracts sort by real chronology including timestamps while preserving the source calendar day", () => {
  const source = snapshot({ contracts: [contract({ id: "100", saleDate: "2026-10-01T23:30:00-03:00" }),
    contract({ id: "101", saleDate: "2026-10-02T01:00:00Z" }), contract({ id: "102", saleDate: "30/09/2026" }),
    contract({ id: "103", saleDate: "" })] });
  const result = build(source, { property: "Casa" });
  assert.deepEqual(result.rows[0].contracts.map(row => row.id), ["100", "101", "102", "103"]);
  assert.equal(result.rows[0].contracts[0].saleDate, "2026-10-01");
  assert.equal(result.rows[0].contracts[0].saleOrder, Date.parse("2026-10-02T02:30:00Z"));
});

test("receipts join contract ID only and sort due date ascending including blanks", () => {
  const result = build(snapshot({ receipts: [receipt({ id: "1", dueDate: "2026-10-07", branch: "Wrong", property: "Wrong" }),
    receipt({ id: "2", dueDate: "2026-10-01" }), receipt({ id: "3", dueDate: "" }),
    receipt({ id: "4", contractId: "999" })] }), { property: "Casa" });
  assert.deepEqual(result.rows[0].contracts[0].payments.map(row => row.id), ["3", "2", "1"]);
  assert.equal(result.rows[0].contracts[0].payments[1].tone, "red");
});

test("payment row and status tones follow dates and blank status independently", () => {
  const result = build(snapshot({ receipts: [receipt({ id: "1", paidDate: "2026-10-04", status: "" }),
    receipt({ id: "2", dueDate: "2026-10-05" }), receipt({ id: "3", dueDate: "" })] }), { property: "Casa" });
  const payments = new Map(result.contracts[0].payments.map(row => [row.id, row]));
  assert.equal(payments.get("1").tone, "green"); assert.equal(payments.get("1").statusState.tone, "red");
  assert.equal(payments.get("1").statusState.label, "PENDENTE");
  assert.equal(payments.get("2").tone, "neutral"); assert.equal(payments.get("2").statusState.tone, "amber");
  assert.equal(payments.get("3").tone, "neutral");
});

test("blank monetary fields stay unknown and numeric zero never counts as blank", () => {
  const result = build(snapshot({ properties: [property({ fiscalValue: " ", brokerValue: "0,00" })],
    contracts: [contract({ total: null })], receipts: [receipt({ amount: "0" })] }));
  assert.equal(result.rows[0].fiscalValue, null); assert.equal(result.rows[0].brokerValue, 0);
  assert.equal(result.rows[0].pendingFields, 1); assert.equal(result.contracts[0].total, null);
  assert.equal(result.contracts[0].payments[0].amount, 0);
});

test("branch subtotals classify explicit states only and do not count DISPENSADO as active or sold", () => {
  const result = build(snapshot({ properties: [property(), property({ id: "2", property: "B", saleStatus: "NAO VENDIDO", visualStatus: "INATIVO", fiscal: "x" }),
    property({ id: "3", property: "C", saleStatus: "DISPENSADO", visualStatus: "DISPENSADO" })] }));
  assert.equal(result.branches[0].count, 3);
  assert.deepEqual([result.branches[0].counts.sold, result.branches[0].counts.unsold, result.branches[0].counts.active,
    result.branches[0].counts.inactive, result.branches[0].counts.declared, result.branches[0].counts.undeclared], [1, 1, 1, 1, 2, 1]);
});

test("incomplete malformed and duplicate snapshots reject before filtering can hide a bad record", () => {
  for (const source of [null, {}, snapshot({ complete: false }), snapshot({ partial: true }), snapshot({ incomplete: true }),
    snapshot({ truncated: true }), snapshot({ aborted: true }), snapshot({ error: "503" }), snapshot({ contracts: null })]) {
    assert.throws(() => build(source), /snapshot|incompleto|inválido/i);
  }
  for (const kind of ["properties", "contracts", "documents", "expenses", "receipts"]) {
    const source = snapshot(); source[kind].push({ ...source[kind][0] });
    assert.throws(() => build(source, { branch: "hidden" }), /duplicado/i);
    const missing = snapshot(); delete missing[kind][0].id; assert.throws(() => build(missing), /campo|registro|ID/i);
    const incomplete = snapshot(); delete incomplete[kind][0][Object.keys(incomplete[kind][0])[1]];
    assert.throws(() => build(incomplete), /campo|registro|incompleto/i);
  }
});

test("invalid IDs scalar fields dates and monetary values reject rather than becoming pending or paid", () => {
  for (const extra of [{ id: "01" }, { id: " 1 " }, { insurance: {} }, { proposal: ["10", "11"] },
    { fiscalValue: {} }, { brokerValue: Infinity }, { branch: true }]) {
    assert.throws(() => build(snapshot({ properties: [property(extra)] })), /inválid|campo|valor/i);
  }
  for (const date of ["2026-02-30", "31/04/2026", "2026-10-01T24:00:00Z", "nonsense", true]) {
    assert.throws(() => build(snapshot({ contracts: [contract({ saleDate: date })] })), /data|calendário/i);
    assert.throws(() => build(snapshot({ receipts: [receipt({ paidDate: date })] })), /data|calendário/i);
  }
  assert.throws(() => build(snapshot(), {}, "2026-02-30"), /data|calendário/i);
  assert.throws(() => build(snapshot(), []), /filtro/i);
  assert.throws(() => build(snapshot(), { branch: {} }), /filtro/i);
});
test("property fiscal and brokerage values retain the PowerFx textual fallback without changing numeric totals", () => {
 const result=build(snapshot({properties:[property({fiscalValue:" ISENTO ",brokerValue:"DISPENSADO"})]}));
 assert.equal(result.rows[0].fiscalValue,"ISENTO");assert.equal(result.rows[0].brokerValue,"DISPENSADO");
 assert.equal(result.rows[0].pendingFields,0);
 assert.throws(()=>build(snapshot({contracts:[contract({total:"ISENTO"})]})),/valor/i);
});

test("calendar date exports preserve offset days and validate additive sale chronology", () => {
  assert.equal(typeof module.normalizeCommercialDocumentsDate, "function");
  assert.equal(module.normalizeCommercialDocumentsDate("2026-10-01T23:30:00-03:00"), "2026-10-01");
  assert.deepEqual(module.normalizeCommercialDocumentsSaleDate("01/10/2026"), { saleDate: "2026-10-01" });
  assert.throws(() => build(snapshot({ contracts: [contract({ saleOrder: NaN })] })), /ordem|data/i);
  assert.throws(() => build(snapshot({ contracts: [contract({ saleDate: "", saleOrder: 1 })] })), /ordem|data/i);
});

test("empty snapshots return complete empty projections and inputs are not mutated", () => {
  const empty = build(snapshot({ properties: [], contracts: [], documents: [], expenses: [], receipts: [] }));
  assert.deepEqual(empty.rows, []); assert.deepEqual(empty.branches, []); assert.equal(empty.cards.totalIDs, 0);
  const source = snapshot(); const before = structuredClone(source); build(source, { buyer: "Ana" }); assert.deepEqual(source, before);
});
