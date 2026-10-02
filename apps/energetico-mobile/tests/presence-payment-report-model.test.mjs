import test from "node:test";
import assert from "node:assert/strict";

const model = await import("../src/chat/presence-payment-report-model.js").catch(() => ({}));

function presence(id, paymentId, date, dailyValue, overrides = {}) {
  return {
    id: String(id), paymentId: String(paymentId), date, dailyValue,
    branch: "004 - EDIFÍCIO XAVANTE", property: "TODOS", supplier: "RAFAEL GONTIJO",
    stage: "ALVENARIA E ESTRUTURAS", activity: "EXECUÇÃO DE ALVENARIA CERÂMICA",
    presence: "PRESENTE", observation: "", motivation: "", ...overrides,
  };
}

function launch(id, order, total, overrides = {}) {
  return { id: String(id), order, date: "2026-09-30", supplier: "RAFAEL GONTIJO",
    branch: "004 - EDIFÍCIO XAVANTE", stage: "ALVENARIA E ESTRUTURAS",
    description: "PAGAMENTO SEMANA RAFAEL", product: "ENGENHEIRO", account: "CAIXA",
    total, ...overrides };
}

test("normaliza colunas internas do SharePoint, moeda brasileira e data sem deslocar o dia", () => {
  assert.equal(typeof model.normalizePresencePaymentRow, "function");
  const columns = [
    { name: "field_1", displayName: "IDPGTO" }, { name: "field_2", displayName: "DATA" },
    { name: "field_3", displayName: "VLORDIARIO" }, { name: "field_4", displayName: "FORNECEDOR" },
    { name: "field_5", displayName: "MOTIVACAO" },
  ];
  const row = model.normalizePresencePaymentRow({ id: "2080", fields: {
    field_1: 3470, field_2: "2026-09-21T00:00:00-03:00", field_3: "R$ 150,00",
    field_4: { LookupValue: "RAFAEL GONTIJO" }, field_5: "Ajuste aprovado",
  } }, columns);
  assert.equal(row.paymentId, "3470");
  assert.equal(row.date, "2026-09-21");
  assert.equal(row.dailyValue, 150);
  assert.equal(row.supplier, "RAFAEL GONTIJO");
  assert.equal(row.motivation, "Ajuste aprovado");

  const linked = model.normalizePaymentLaunchRow({ id: "3470", fields: {
    AGRUPAR: "346", "VALOR UNITÁRIO": "R$ 150,00", QUANTIDADE: 5, FRETE: "R$ 0,00",
  } });
  assert.equal(linked.order, "346");
  assert.equal(linked.total, 750);
  assert.equal(model.normalizeSupplierStatusRow({ id: "12", fields: { CADASTRO: "RAFAEL GONTIJO", STATUS: "ATIVO" } }).status, "ATIVO");
});

test("filtra até o último dia inclusive, agrupa IDPGTO uma vez e soma pedidos sem duplicar lançamentos", () => {
  const snapshot = {
    presences: [
      presence(2080, 3470, "2026-09-21", 150), presence(2090, 3470, "2026-09-22", 150),
      presence(2110, 3469, "2026-09-23", 200),
      presence(2200, 3471, "2026-09-24", 400, { supplier: "OUTRO" }),
    ],
    launchesById: { "3470": launch(3470, "346", 750), "3469": launch(3469, "346", 200), "3471": launch(3471, "347", 400, { supplier: "OUTRO" }) },
    supplierStatusByName: { "RAFAEL GONTIJO": "ATIVO", OUTRO: "INATIVO" },
  };
  const result = model.buildPresencePaymentReport(snapshot, { startDate: "2026-09-21", endDate: "2026-09-23", status: "ATIVO" });
  assert.deepEqual(result.metrics, { paymentIds: 2, presences: 3, totalDaily: 500, complete: true });
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].order, "346");
  assert.equal(result.orders[0].totalValue, 950);
  assert.deepEqual(result.orders[0].groups.map(group => group.paymentId), ["3470", "3469"]);
  assert.equal(result.orders[0].groups[0].presencesTotal, 300);
  assert.equal(result.orders[0].groups[0].launchTotal, 750);
  assert.equal(result.orders[0].groups[0].difference, 450);
  assert.equal(result.orders[0].groups[0].firstDate, "2026-09-21");
  assert.equal(result.orders[0].groups[0].lastDate, "2026-09-22");
  assert.deepEqual(result.orders[0].groups[0].presences.map(row => row.id), ["2080", "2090"]);
  assert.equal(result.orders[0].groups[1].difference, 0);
});

test("pedidos ausentes ficam separados por IDPGTO e não aparecem como valor zero", () => {
  const result = model.buildPresencePaymentReport({
    presences: [presence(1, 10, "2026-09-21", 100), presence(2, 11, "2026-09-22", 200)],
    launchesById: {}, supplierStatusByName: { "RAFAEL GONTIJO": "ATIVO" },
  });
  assert.equal(result.orders.length, 2);
  assert.deepEqual(result.orders.map(order => order.order), ["SEM PEDIDO", "SEM PEDIDO"]);
  assert.notEqual(result.orders[0].key, result.orders[1].key);
  assert.equal(result.orders[0].totalValue, null);
  assert.equal(result.orders[0].groups[0].launchTotal, null);
  assert.equal(result.orders[0].groups[0].difference, null);
});

test("valor diário ausente sinaliza total incompleto e filtros preservam pontuação dos nomes", () => {
  const snapshot = {
    presences: [
      presence(1, 10, "2026-09-21", null, { supplier: "ACME-A", presence: "AUSENTE", observation: "Falta" }),
      presence(2, 10, "2026-09-21", 100, { supplier: "ACMEA", property: "TORRE 2" }),
    ],
    launchesById: { "10": launch(10, "2", 100, { supplier: "ACMEA" }) },
    supplierStatusByName: { "ACME-A": "PENDENTE PGTO", ACMEA: "ATIVO" },
  };
  const result = model.buildPresencePaymentReport(snapshot, { supplier: "ACME-A", status: "PENDENTE PGTO" });
  assert.equal(result.metrics.presences, 1);
  assert.equal(result.metrics.complete, false);
  assert.equal(result.metrics.totalDaily, null);
  assert.equal(result.orders[0].groups[0].presencesTotal, null);
  assert.equal(result.orders[0].groups[0].presences[0].supplierMismatch, true);
  assert.equal(result.orders[0].groups[0].presences[0].presence, "AUSENTE");
});
