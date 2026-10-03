import test from "node:test";
import assert from "node:assert/strict";

const { buildCommercialReport14, buildCommercialReport15 } = await import("../src/chat/commercial-progress-reports-model.js").catch(() => ({}));

const snapshot = {
  properties: [
    { id: "1", branch: "Centro", property: "Casa 1", visualStatus: "ATIVO", saleStatus: "VENDIDO", brokerage: "PAGO EMPRESA", invoice: "PENDENTE", fiscal: "DECLARADO" },
    { id: "2", branch: "Centro", property: "Casa 2", visualStatus: "INATIVO", saleStatus: "NÃO VENDIDO", brokerage: "", invoice: "", fiscal: "NÃO DECLARADO" },
    { id: "3", branch: "Sul", property: "Casa 1", visualStatus: "ATIVO", saleStatus: "VENDIDO", brokerage: "", invoice: "", fiscal: "" },
  ],
  contracts: [
    { id: "10", branch: "Centro", property: "Casa 1", buyer: "Ana", status: "VENDIDO", total: 200 },
    { id: "9", branch: "Centro", property: "Casa 1", buyer: "Bia", status: "RESCINDIDO", total: 50 },
  ],
  clients: [
    { id: "1", branch: "Centro", property: "Casa 1", name: "Ana", definitive: "SIM" },
    { id: "2", branch: "Centro", property: "Casa 1", name: "Bia", definitive: "RESCISÃO" },
  ],
  receipts: [
    { id: "1", branch: "Centro", property: "Casa 1", contractId: "10", buyer: "Ana", amount: 100, paidDate: "2026-09-20", dueDate: "", directBroker: "", description: "Entrada" },
    { id: "2", branch: "Centro", property: "Casa 1", contractId: "10", buyer: "Ana", amount: 20, paidDate: "2026-09-21", dueDate: "", directBroker: "SIM", description: "Corretagem" },
    { id: "3", branch: "Centro", property: "Casa 1", contractId: "10", buyer: "Ana", amount: 30, paidDate: "", dueDate: "2026-10-10", directBroker: "", description: "Saldo" },
    { id: "4", branch: "Centro", property: "Casa 1", contractId: "9", buyer: "Bia", amount: 40, paidDate: "2026-07-10", dueDate: "", directBroker: "", description: "Anterior" },
  ],
  milestones: [
    { id: "1", branch: "Centro", property: "Casa 1", buyer: "Bia", contractId: "9", type: "Proposta", description: "Primeiro", startDate: "2026-10-01", endDate: "2026-10-02", dueDate: "2026-09-01", status: "ATIVIDADE FINALIZADA" },
    { id: "2", branch: "Centro", property: "Casa 1", buyer: "Ana", contractId: "10", type: "Assinatura", description: "Último", startDate: "2026-09-30", endDate: "2026-10-04", dueDate: "2026-10-03", status: "ATIVIDADE INICIADA" },
    { id: "3", branch: "Sul", property: "Casa 1", buyer: "Caio", contractId: "11", type: "Proposta", description: "Sul", startDate: "2026-09-29", dueDate: "", status: "ATIVIDADE CRIADA" },
  ],
};

test("relatório 14 totaliza contratos, soma pagamentos efetivos e calcula saldo restante por imóvel", () => {
  assert.equal(typeof buildCommercialReport14, "function");
  const result = buildCommercialReport14(snapshot);
  assert.deepEqual(result.indicators, { total: 250, paid: 160, pending: 90, active: 2, inactive: 1 });
  const center = result.branches.find(branch => branch.name === "Centro");
  const house = center.properties.find(property => property.property === "Casa 1");
  assert.deepEqual([house.paid, house.formerContracts, house.brokerPaid, house.pending, house.total, house.paidPercentage], [100, 40, 20, 90, 250, 64]);
  assert.deepEqual([center.paid, center.formerContracts, center.brokerPaid, center.pending, center.total], [100, 40, 20, 90, 250]);
  assert.equal(result.branches.find(branch => branch.name === "Sul").properties[0].total, 0);
});

test("relatório 14 restringe contratos e pagamentos ao contrato e comprador selecionados", () => {
  const result = buildCommercialReport14(snapshot, { branch: "Centro", contractId: "10", buyer: "Ana", property: "Casa 1", contractStatus: "VENDIDO" });
  assert.equal(result.branches.length, 1);
  assert.equal(result.branches[0].properties.length, 1);
  assert.equal(result.branches[0].properties[0].formerContracts, 0);
  assert.equal(result.branches[0].properties[0].total, 200);
  assert.equal(result.branches[0].properties[0].pending, 80);
  assert.deepEqual(result.pendingPayments.map(row => row.id), ["3"]);
});

test("relatório 14 recusa total parcial quando existe valor monetário ilegível", () => {
  const invalid = { ...snapshot, receipts: [...snapshot.receipts, { ...snapshot.receipts[0], id: "5", amount: null }] };
  assert.throws(() => buildCommercialReport14(invalid), /valor|incompleto/i);
});

test("agenda de pendências mantém o filtro próprio de filial, imóvel, contrato e comprador", () => {
  const result = buildCommercialReport14(snapshot, { branch: "Centro", contractStatus: "RESCINDIDO" });
  assert.equal(result.indicators.pending, 10);
  assert.deepEqual(result.pendingPayments.map(row => row.id), ["3"]);
});

test("relatório 14 reconcilia pagamentos por ID do contrato mesmo quando filial e imóvel da receita estão vazios", () => {
  const corrected = { ...snapshot, receipts: snapshot.receipts.map(row => row.id === "1" ? { ...row, branch: "", property: "" } : row) };
  assert.equal(buildCommercialReport14(corrected).indicators.paid, 160);
});

test("relatório 14 recusa pagamentos sem contrato, contratos sem imóvel cadastrado e totais de contrato ausentes", () => {
  assert.throws(() => buildCommercialReport14({ ...snapshot, receipts: [...snapshot.receipts, { ...snapshot.receipts[0], id: "5", contractId: "99" }] }), /contrato|vínculo/i);
  assert.throws(() => buildCommercialReport14({ ...snapshot, receipts: snapshot.receipts.map(row => row.id === "1" ? { ...row, property: "Casa 2" } : row) }), /diverge|imóvel/i);
  assert.throws(() => buildCommercialReport14({ ...snapshot, contracts: [...snapshot.contracts, { id: "11", branch: "Norte", property: "Casa X", buyer: "Eva", status: "VENDIDO", total: 10 }] }), /imóvel|cadastrad/i);
  assert.throws(() => buildCommercialReport14({ ...snapshot, contracts: snapshot.contracts.map(row => row.id === "10" ? { ...row, total: null } : row) }), /total|incompleto/i);
});

test("relatório 14 limita o pendente a zero quando pagamentos excedem o total contratado", () => {
  const contracts = snapshot.contracts.map(row => ({ ...row, total: row.id === "10" ? 100 : 50 }));
  const result = buildCommercialReport14({ ...snapshot, contracts });
  assert.equal(result.indicators.total, 150);
  assert.equal(result.indicators.paid, 160);
  assert.equal(result.indicators.pending, 0);
  assert.equal(result.branches.find(branch => branch.name === "Centro").total, 150);
});

test("relatório 15 escolhe maior ID por filial e imóvel mesmo com data de início anterior", () => {
  assert.equal(typeof buildCommercialReport15, "function");
  const result = buildCommercialReport15(snapshot, {}, "2026-10-02");
  const center = result.branches.find(branch => branch.name === "Centro");
  assert.equal(center.properties.length, 1);
  assert.deepEqual([center.properties[0].id, center.properties[0].type, center.properties[0].daysInProgress, center.properties[0].daysToDue], ["2", "Assinatura", 2, 1]);
  assert.equal(result.branches.find(branch => branch.name === "Sul").properties[0].id, "3");
});

test("relatório 15 detalha histórico completo quando imóvel é selecionado e aplica status cadastral", () => {
  const result = buildCommercialReport15(snapshot, { branch: "Centro", property: "Casa 1", visualStatus: "ATIVO" }, "2026-10-02");
  assert.deepEqual(result.history.map(row => row.id), ["2", "1"]);
  assert.equal(result.branches[0].properties[0].visualStatus, "ATIVO");
  assert.equal(buildCommercialReport15(snapshot, { visualStatus: "INATIVO" }).branches.length, 0);
});

test("relatório 15 filtra STATUS do apontamento antes de escolher o último ID", () => {
  const newer = { ...snapshot.milestones[1], id: "4", status: "ATIVIDADE FINALIZADA" };
  const withNewer = { ...snapshot, milestones: [...snapshot.milestones, newer] };
  assert.equal(buildCommercialReport15(withNewer).branches.find(branch => branch.name === "Centro").properties[0].id, "4");
  const filtered = buildCommercialReport15(withNewer, { milestoneStatus: "ATIVIDADE INICIADA", property: "Casa 1" });
  assert.equal(filtered.branches.find(branch => branch.name === "Centro").properties[0].id, "2");
  assert.deepEqual(filtered.history.map(row => row.id), ["2"]);
});
