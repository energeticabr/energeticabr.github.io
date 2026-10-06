import test from "node:test";
import assert from "node:assert/strict";

const module = await import("../src/chat/commercial-receipts-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const build = (...args) => {
  assert.equal(typeof module.buildCommercialReceipts, "function", "buildCommercialReceipts must be implemented");
  return module.buildCommercialReceipts(...args);
};
const property = (id, branch = "A", name = "Casa", extra = {}) => ({ id, branch, property: name,
  visualStatus: "ATIVO", saleStatus: "VENDIDO", brokerage: "PENDENTE", invoice: "NF 1", fiscal: "DECLARADO", ...extra });
const contract = (id, buyer, extra = {}) => ({ id, branch: "A", property: "Casa", buyer,
  status: "ATIVO", total: 99999, saleDate: "2026-09-01", broker: "João", ...extra });
const client = (id, name, definitive = "", extra = {}) => ({ id, branch: "A", property: "Casa", name, definitive, ...extra });
const receipt = (id, contractId, buyer, amount, extra = {}) => ({ id, contractId, branch: "A", property: "Casa", buyer,
  amount, paidDate: "2026-10-01", dueDate: "2026-10-01", directBroker: "NÃO", description: "Parcela",
  paymentMethod: "PIX", account: "Banco", status: "PAGAMENTO EFETUADO", ...extra });
function snapshot() {
  return { complete: true, properties: [property("1"), property("2", "B", "Casa", { visualStatus: "INATIVO" }),
    property("3", "A", "TODOS"), property("4", "A", "ESCRITÓRIO CENTRAL"), property("5", "A", "Vazia")],
    contracts: [contract("10", "Ana"), contract("20", "Antigo", { status: "RESCINDIDO", saleDate: "2025-01-01" }),
      contract("30", "Bia", { branch: "B" })],
    clients: [client("1", "Antigo", " rescisão "), client("2", "Ana"), client("3", "Bia", "", { branch: "B" })],
    receipts: [receipt("1", "10", "Ana", 100), receipt("2", "10", "Ana", 20, { directBroker: " sim " }),
      receipt("3", "10", "Ana", 30, { paidDate: "", dueDate: "2026-10-04" }),
      receipt("4", "10", "Ana", 10, { paidDate: "", dueDate: "2026-10-05", directBroker: "SIM" }),
      receipt("5", "20", "Antigo", 50), receipt("6", "20", "Antigo", 7, { directBroker: "SIM" }),
      receipt("7", "20", "Antigo", 9, { paidDate: "", dueDate: "" }),
      receipt("8", "30", "Bia", 200, { branch: "B" }),
      receipt("9", "", "", 11, { property: "ESCRITÓRIO CENTRAL", paidDate: "", dueDate: "" }),
      receipt("10", "", "", 12, { property: "TODOS", paidDate: "", dueDate: "2026-10-06" }),
      receipt("11", "", "", 13, { branch: "", property: "", paidDate: "", dueDate: "" })] };
}

test("PowerFx summary sums current receipts plus all former nonbroker payments, never subtracts contract totals", () => {
  const input = snapshot(); const before = structuredClone(input);
  const result = build(input, {}, "2026-10-05");
  assert.equal(result.detail, false); assert.deepEqual(result.contracts, []);
  assert.deepEqual(result.indicators, { total: 426, paid: 377, pending: 49, active: 2, inactive: 1 });
  const row = result.branches[0].properties.find(row => row.property === "Casa");
  assert.equal(row.paid, 100); assert.equal(row.formerContracts, 50); assert.equal(row.brokerPaid, 20);
  assert.equal(row.pending, 40); assert.equal(row.total, 210); assert.equal(row.paidPercentage, 170 / 210 * 100);
  assert.equal(row.buyer, "Ana"); assert.equal(row.hasBrokerPayment, true); assert.equal(row.brokerPending, true);
  assert.equal(result.branches[0].total, 210); assert.equal(result.branches[1].total, 200);
  assert.equal(result.branches[0].properties.find(row => row.property === "Vazia").paidPercentage, 0);
  assert.deepEqual(input, before); assert.ok(Object.isFrozen(result.branches[0].properties));
});

test("contract, buyer and contractStatus selectors retain former payments outside their selection", () => {
  for (const filters of [{ contractId: 10 }, { buyer: "ANA" }, { contractStatus: "ATIVO", branch: "A" }]) {
    const result = build(snapshot(), filters, "2026-10-05");
    const row = result.branches[0].properties[0];
    assert.equal(row.formerContracts, 50); assert.equal(row.total, 210);
    assert.equal(result.indicators.total, 160); assert.equal(result.indicators.paid, 120);
  }
  const former = build(snapshot(), { contractId: "20" }, "2026-10-05");
  assert.equal(former.branches[0].properties[0].total, 50);
  assert.equal(former.branches[0].properties[0].brokerPaid, 0);
  assert.equal(former.branches[0].properties[0].buyer, "Antigo");
  assert.equal(former.indicators.total, 66);
});

test("pending table ignores contractStatus, rescission and excluded or uncatalogued properties", () => {
  const result = build(snapshot(), { contractStatus: "IMPOSSÍVEL" }, "2026-10-05");
  assert.deepEqual(result.branches, []); assert.equal(result.detail, false);
  assert.equal(result.pendingTotal, 85);
  assert.deepEqual(result.pendingPayments.map(row => row.id), ["3", "4", "10", "7", "9", "11"]);
  assert.deepEqual(result.pendingPayments.map(row => row.dueStatus), ["ATRASADO", "A VENCER", "A VENCER", "SEM DATA", "SEM DATA", "SEM DATA"]);
  assert.equal(result.pendingPayments[1].dueToday, true);
  assert.equal(result.pendingPayments[3].dueDate, "");
});

test("details include every receipt of the selected contract despite conflicting receipt selectors", () => {
  const input = snapshot(); input.receipts.push(receipt("12", "10", "Outra pessoa", 5, { branch: "B", property: "Outra casa" }));
  const result = build(input, { branch: "A", buyer: "Ana", property: "Casa", contractStatus: "ATIVO" }, "2026-10-05");
  assert.equal(result.detail, true); assert.equal(result.contracts.length, 1);
  const detail = result.contracts[0];
  assert.deepEqual(detail.payments.map(row => row.id), ["1", "2", "3", "4", "12"]);
  assert.deepEqual(detail.totals, { paid: 105, brokerPaid: 20, pending: 40, total: 165 });
  assert.equal(detail.paid, 105); assert.equal(detail.brokerPaid, 20); assert.equal(detail.pending, 40); assert.equal(detail.paymentsTotal, 165);
  assert.deepEqual(detail.indicators, { total: 99999, paid: 125, pending: 40, visualStatus: "ATIVO" });
  assert.equal(detail.payments[1].paymentState, "PAGO CORRETOR");
  assert.equal(detail.payments[2].status, "PAGAMENTO EFETUADO"); // Source status is independent of paid date.
});

test("details sort contracts by descending sale date, preserve blank dates and money, and fallback to receipt buyer", () => {
  const input = snapshot(); input.contracts[0].saleDate = ""; input.contracts[0].total = null;
  input.receipts.push(receipt("12", "404", "Antigo", 1));
  const result = build(input, { property: "Casa", branch: "A" }, "2026-10-05");
  assert.deepEqual(result.contracts.map(row => row.id), ["20", "10"]);
  assert.equal(result.contracts[1].saleDate, ""); assert.equal(result.contracts[1].total, null);
  assert.equal(result.branches[0].properties[0].formerContracts, 51);
});

test("branch isolates identical property names and contractStatus selects contract rather than visual status", () => {
  const result = build(snapshot(), { branch: "B", property: "Casa", contractStatus: "ATIVO" }, "2026-10-05");
  assert.equal(result.indicators.total, 200); assert.equal(result.indicators.visualStatus, "INATIVO");
  assert.equal(result.branches[0].properties[0].formerContracts, 0);
  assert.equal(result.branches[0].properties[0].buyer, "Bia");
  assert.equal(build(snapshot(), { branch: "A" }, "2026-10-05").detail, false);
});

test("valid orphan receipts use their own property and buyer and require no registered contract or property", () => {
  const input = { complete: true, properties: [], contracts: [], clients: [], receipts: [
    receipt("1", "404", "Ana", 10), receipt("2", "", "Bia", 20, { property: "Unregistered", paidDate: "" }),
    receipt("3", "", "", 30, { property: "", branch: "", paidDate: "" })] };
  const all = build(input, {}, "2026-10-05");
  assert.equal(all.indicators.total, 30); assert.equal(all.indicators.paid, 10); assert.equal(all.pendingTotal, 50);
  assert.deepEqual(all.branches, []);
  const status = build(input, { contractStatus: "ATIVO" }, "2026-10-05");
  assert.equal(status.indicators.total, 0); assert.equal(status.pendingTotal, 50);
  const buyer = build(input, { buyer: "Bia" }, "2026-10-05");
  assert.equal(buyer.indicators.total, 20); assert.equal(buyer.pendingTotal, 20); assert.equal(buyer.detail, true);
});

test("filterOptions retain full unfiltered selectors and contract statuses", () => {
  const result = build(snapshot(), { branch: "B" }, "2026-10-05");
  assert.deepEqual(result.filterOptions, { branch: ["A", "B"], contractId: ["10", "20", "30"], buyer: ["Ana", "Antigo", "Bia"],
    property: ["Casa", "Vazia"], contractStatus: ["ATIVO", "RESCINDIDO"] });
  assert.ok(Object.isFrozen(result.filterOptions.buyer));
});

test("unknown amounts remain null, pt-BR currency parses exactly, zero is known, and decimal sums are stable", () => {
  const input = { complete: true, properties: [property("1")], contracts: [], clients: [], receipts: [
    receipt("1", "", "", "R$ 1.234,56"), receipt("2", "", "", ""), receipt("3", "", "", null),
    receipt("4", "", "", 0), receipt("5", "", "", 0.1), receipt("6", "", "", 0.2)] };
  const result = build(input, {}, "2026-10-05");
  assert.equal(result.indicators.total, 1234.86);
  input.receipts = [receipt("1", "", "", 0.1), receipt("2", "", "", 0.2)];
  assert.equal(build(input, {}, "2026-10-05").indicators.total, 0.3);
});

test("equivalent client identities with distinct IDs preserve first lookup and tolerate blank drafts", () => {
  const input = snapshot();
  input.clients.push(client("99", "Antigo", "RESCISÃO"), client("100", "Ana", "   "),
    client("101", "", "", { branch: "", property: "" }), client("102", "", "  ", { branch: "", property: "" }));
  const before = structuredClone(input);
  const result = build(input, {}, "2026-10-05");
  const row = result.branches[0].properties.find(row => row.property === "Casa");
  assert.equal(row.formerContracts, 50); assert.equal(row.paid, 100); assert.equal(row.total, 210); assert.equal(row.buyer, "Ana");
  assert.equal(result.indicators.total, 426); assert.equal(result.pendingTotal, 85);
  assert.deepEqual(build(input, { branch: "Z" }, "2026-10-05").branches, []);
  assert.deepEqual(input, before);
});

test("contract detail looks up visual status from full property source including office and TODOS", () => {
  for (const name of ["ESCRITÓRIO CENTRAL", "TODOS"]) {
    const input = { complete: true, properties: [property("1", "B", name, { visualStatus: "ATIVO" }),
      property("2", "A", name, { visualStatus: "INATIVO" })],
      contracts: [contract("10", "Ana", { property: name })], clients: [],
      receipts: [receipt("1", "10", "Ana", 100, { property: name })] };
    const result = build(input, { contractId: "10" }, "2026-10-05");
    assert.equal(result.contracts[0].visualStatus, "INATIVO");
    assert.equal(result.contracts[0].indicators.visualStatus, "INATIVO");
    assert.equal(result.contracts[0].paymentsTotal, 100);
    assert.deepEqual(result.branches, []); assert.equal(result.indicators.total, 0);
    assert.equal(result.indicators.active, 0); assert.equal(result.indicators.inactive, 0);
  }
});

test("incomplete, duplicate and malformed snapshots reject before filtered totals can conceal bad rows", () => {
  const invalid = [input => { input.complete = false; }, input => { input.partial = true; },
    input => { delete input.clients; }, input => { input.receipts.push({ ...input.receipts[0] }); },
    input => { input.properties.push(property("99")); }, input => { input.contracts[0].id = "0"; },
    input => { input.receipts[0].amount = "junk 100"; }, input => { input.contracts[0].total = Infinity; },
    input => { input.receipts[0].paidDate = "2026-02-30"; }, input => { input.receipts[0].dueDate = "05/13/2026"; },
    input => { input.receipts[0].branch = {}; }, input => { input.receipts[0].contractId = "xyz"; },
    input => { input.clients.push(client("99", "Ana", "RESCISÃO")); }];
  for (const change of invalid) { const input = snapshot(); change(input); assert.throws(() => build(input, { branch: "Z" }, "2026-10-05")); }
  assert.throws(() => build(snapshot(), [], "2026-10-05"));
  assert.throws(() => build(snapshot(), { buyer: {} }, "2026-10-05"));
  assert.throws(() => build(snapshot(), {}, ""));
});
