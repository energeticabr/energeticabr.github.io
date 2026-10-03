import test from "node:test";
import assert from "node:assert/strict";

const { createSpendingReportsData } = await import("../src/chat/spending-reports-data.js").catch(() => ({}));

function fixture(overrides = {}) {
  const calls = [];
  const repository = {
    async resolveList(site, aliases) { assert.equal(site, "personal"); calls.push(["resolve", aliases[0]]); return { status: "resolved", id: aliases[0] }; },
    async getColumns(_site, list) { calls.push(["columns", list]); return list === "LANCAMENTOS"
      ? [{ name: "field_9", displayName: "VALOR UNITÁRIO" }, { name: "field_8", displayName: "QUANTIDADE" }]
      : [{ name: "field_1", displayName: "PRODUTO" }, { name: "field_2", displayName: "TIPODESPESA" }]; },
    async getItemsPage(_site, list, query, options) {
      calls.push(["page", list, options.pageNumber, options.cursor, query]);
      if (list === "CADASTROPRODUTO") return { items: [{ id: "3", fields: { field_1: "Cimento", field_2: "Material" } }], hasMore: false, nextLink: "" };
      if (options.pageNumber === 1) return { items: [{ id: "1", fields: { field_9: 10, field_8: 2 } }], hasMore: true, nextLink: "next" };
      return { items: [{ id: "2", fields: { field_9: 30, field_8: 1 } }], hasMore: false, nextLink: "" };
    }, ...overrides,
  };
  return { repository, calls };
}

test("carrega todas as páginas de LANCAMENTOS e CADASTROPRODUTO para o relatório 9", async () => {
  assert.equal(typeof createSpendingReportsData, "function");
  const { repository, calls } = fixture();
  const snapshot = await createSpendingReportsData({ repository }).loadSnapshot({ reportNumber: 9 });
  assert.deepEqual(snapshot.launches.map(item => item.id), ["1", "2"]);
  assert.equal(snapshot.productTypes[0].expenseType, "Material");
  assert.ok(calls.some(call => call[0] === "page" && call[1] === "LANCAMENTOS" && call[2] === 2 && call[3] === "next"));
});

test("relatório 10 carrega lançamentos sem exigir cadastro de produto", async () => {
  const { repository, calls } = fixture();
  const snapshot = await createSpendingReportsData({ repository }).loadSnapshot({ reportNumber: 10 });
  assert.equal(snapshot.launches.length, 2);
  assert.equal(calls.some(call => call[1] === "CADASTROPRODUTO"), false);
});

test("erro de paginação ou limite seguro impede qualquer resultado parcial", async () => {
  const { repository } = fixture({ async getItemsPage() { return { items: [], hasMore: true, nextLink: "" }; } });
  await assert.rejects(createSpendingReportsData({ repository }).loadSnapshot({ reportNumber: 10 }), /página|paginação/i);
});

test("resposta sem indicador de próxima página não pode encerrar o relatório como completo", async () => {
  const { repository } = fixture({ async getItemsPage() { return { items: [{ id: "1", fields: {} }], nextLink: "" }; } });
  await assert.rejects(createSpendingReportsData({ repository }).loadSnapshot({ reportNumber: 10 }), /página|paginação/i);
});

test("consulta cancelada não acessa o repositório", async () => {
  const { repository, calls } = fixture(); const abort = new AbortController(); abort.abort();
  await assert.rejects(createSpendingReportsData({ repository }).loadSnapshot({ reportNumber: 9, signal: abort.signal }), /abort|cancelad/i);
  assert.equal(calls.length, 0);
});
