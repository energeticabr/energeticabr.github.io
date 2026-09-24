import test from "node:test";
import assert from "node:assert/strict";

async function dataFactory() {
  const module = await import("../src/chat/orders-gallery-data.js");
  assert.equal(typeof module.createRecurringExpensesGalleryData, "function");
  return module.createRecurringExpensesGalleryData;
}

test("consulta DESPESASRECORRENTES e mantém campos G19 e operações de anexo", async () => {
  const createData = await dataFactory();
  const calls = [];
  const repository = {
    async resolveList(...args) {
      calls.push(["resolveList", ...args]);
      return { status: "resolved", id: "list-recurring-expenses" };
    },
    async getItemsPage(...args) {
      calls.push(["getItemsPage", ...args]);
      return { items: [{ id: "33", fields: {
        ID: 33,
        DESCRICAOPGTO: "TARIFA DE ENERGIA (TODOS)",
        FORNECEDOR: { LookupValue: "CEMIG" },
        "VALOR MENSAL": "144,92",
        RECORRENCIA: "Month",
        DATAINICIO: "2026-07-27T03:00:00Z",
        DATAFIM: "2026-11-04T03:00:00Z",
        EQUIPAMENTO: "TARIFA DE ENERGIA",
        FILIAL: "004 - EDIFÍCIO XAVANTE",
        IMOVEL: "TODOS",
        FORMAPGTO: "ENERGÉTICA - CAIXA",
        "RESPONSAVEL LOCACAO": "BERNARDO",
        STATUS: "ATIVO",
        "Tem anexos": true,
      } }], nextLink: "", hasMore: false };
    },
    async listAttachments(...args) {
      calls.push(["listAttachments", ...args]);
      return [{ name: "conta.pdf", type: "application/pdf", size: 1024 }];
    },
    async downloadAttachment(...args) {
      calls.push(["downloadAttachment", ...args]);
      return new Blob(["pdf"], { type: "application/pdf" });
    },
  };

  const data = createData({ repository });
  const snapshot = await data.loadSnapshot();

  assert.equal(snapshot.listName, "DESPESASRECORRENTES");
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].id, "33");
  assert.equal(snapshot.rows[0].fields.RECORRENCIA, "Month");
  assert.equal(snapshot.rows[0].fields["VALOR MENSAL"], "144,92");
  assert.equal(snapshot.rows[0].fields.FORNECEDOR.LookupValue, "CEMIG");
  assert.equal(snapshot.rows[0].hasAttachments, true);
  assert.deepEqual(calls[0], ["resolveList", "personal", ["DESPESASRECORRENTES", "DESPESAS RECORRENTES"], {}]);
  assert.deepEqual(await data.listAttachments("33"), [
    { fileName: "conta.pdf", mimeType: "application/pdf", size: 1024, uploadedAt: "" },
  ]);
  assert.equal((await data.downloadAttachment("33", "conta.pdf")).type, "application/pdf");
});

test("informa quando a lista de despesas recorrentes não está disponível", async () => {
  const createData = await dataFactory();
  const data = createData({ repository: {
    async resolveList() { return { status: "missing" }; },
    async getItemsPage() { throw new Error("não deve consultar lista ausente"); },
  } });

  await assert.rejects(data.loadSnapshot(), error => (
    error.code === "recurring_expenses_list_missing"
    && /DESPESASRECORRENTES/.test(error.message)
  ));
});
