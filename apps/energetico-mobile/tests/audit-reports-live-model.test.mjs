import test from "node:test";
import assert from "node:assert/strict";
import { auditNumber, normalizeAuditBudget, buildQuotationReport, buildDepreciationReport, buildDocumentReport } from "../src/chat/audit-reports-live-model.js";

test("interpreta dinheiro brasileiro com milhar ou centavos e preserva valores numéricos do Graph", () => {
  for (const [input, expected] of [
    ["1.234", 1234], ["1.234,56", 1234.56], ["1,23", 1.23],
    ["12.345.678", 12345678], ["1234.56", 1234.56], [1234.56, 1234.56],
  ]) assert.equal(auditNumber(input), expected, String(input));
});

test("normalização preserva o tipo numérico do Graph antes de interpretar dinheiro", () => {
  const columns = [{ name: "field_5", displayName: "VALORTOTAL" }];
  assert.equal(normalizeAuditBudget({ id: "1", fields: { field_5: 1.234 } }, columns).total, 1.234);
  assert.equal(normalizeAuditBudget({ id: "2", fields: { field_5: "1.234" } }, columns).total, 1234);
});

test("cotações contam status e orçamentos pendentes sem associar órfãos", () => {
  const result = buildQuotationReport({
    quotes: [{ id: "9", branch: "A", stage: "E", description: "Descrição", status: "Ativa" }, { id: "8", status: "INATIVO" }],
    budgets: [{ id: "31", quotationId: "9", supplier: "F1", branch: "A", stage: "E", status: "Pendente solicitação", total: 100 },
      { id: "32", quotationId: "9", supplier: "F1", branch: "A", stage: "E", status: "Recebido", total: null },
      { id: "33", quotationId: "999", supplier: "F2", status: "Pendente solicitacao", total: 50 }],
  });
  assert.deepEqual(result.metrics, { active: 1, inactive: 1, total: 2, pendingRequests: 2 });
  assert.deepEqual(result.quotes[0].groups[0].budgets.map(row => row.id), ["32", "31"]);
  assert.equal(result.quotes[0].supplierCount, 1);
  assert.deepEqual(result.unlinkedBudgets.map(row => row.id), ["33"]);
});

test("depreciação inclui vencidos e próximos 30 dias, agrupa filial e sinaliza soma incompleta", () => {
  const rows = [
    { id: "1", branch: "A", depreciationDate: "2026-10-01", estimated: 100, residual: 60, quantity: 2, percent: 10 },
    { id: "2", branch: "A", depreciationDate: "2026-11-01", estimated: 100, residual: 50, quantity: 1, percent: 10 },
    { id: "3", branch: "B", depreciationDate: "2026-10-12", estimated: 80, residual: null, quantity: 1, percent: 10 },
  ];
  const result = buildDepreciationReport({ rows }, "2026-10-02");
  assert.equal(result.deadline, "2026-11-01");
  assert.deepEqual(result.groups.map(group => group.branch), ["A", "B"]);
  assert.equal(result.metrics.records, 3);
  assert.equal(result.metrics.active, 2);
  assert.equal(result.metrics.total, 380);
  assert.equal(result.metrics.current, null);
  assert.equal(result.metrics.partialCurrent, 170);
  assert.equal(result.groups[0].metrics.toDepreciate, 17);
});

test("documentos filtram antes dos indicadores; vencido e a vencer usam datas locais", () => {
  const rows = [
    { id: "1", branch: "A", status: "SUBMETIDO", validityDate: "2026-10-01" },
    { id: "2", branch: "A", status: "Pendente", validityDate: "2026-10-02" },
    { id: "3", branch: "A", status: "PENDENTE", validityDate: "2026-10-17" },
    { id: "4", branch: "B", status: "PENDENTE", validityDate: "2026-10-18" },
  ];
  const result = buildDocumentReport({ rows }, { branch: "A" }, "2026-10-02");
  assert.deepEqual(result.rows.map(row => row.id), ["1", "2", "3"]);
  assert.deepEqual(result.metrics, { submitted: 1, pending: 2, total: 3, expired: 1, expiring15: 2 });
  assert.equal(result.rows[0].daysToExpiry, -1);
});
