import test from "node:test";
import assert from "node:assert/strict";

async function dataFactory(t) {
  const module = await import("../src/chat/orders-gallery-data.js");
  assert.equal(typeof module.createPaymentProgrammingGalleryData, "function", "createPaymentProgrammingGalleryData must be implemented");
  return module.createPaymentProgrammingGalleryData;
}

test("carrega a lista PROVISÃO PGTOS da sessão SharePoint e preserva os campos G28", async t => {
  const createPaymentProgrammingGalleryData = await dataFactory(t);
  const calls = [];
  const repository = {
    async resolveList(...args) { calls.push(["resolveList", ...args]); return { status: "resolved", id: "list-provisoes" }; },
    async getItemsPage(...args) {
      calls.push(["getItemsPage", ...args]);
      return { items: [
        { id: "306", fields: {
          ID: 306,
          FORNECEDOR: "DIBRITA",
          OBS: "Compra de brita",
          "DATA PREVISTO PGTO": "2026-09-23T03:00:00Z",
          "DATA PGTO EFETUADO": "",
          STATUS: "PAGAMENTO PREVISTO",
          "VALOR TOTAL": 120,
          QTD: 10,
          DESCRICAOPGTO: "BRITA (10 M3 DE BRITA)",
          APROVACAO: "PENDENTE",
          FILIAL: "004 - EDIFÍCIO XAVANTE",
          IMOVEL: "TODOS",
          IDPEDIDO: "",
          IDLANCAMENTOS: "",
          IDRECORRENCIA: "",
          PGTOAGENDADO: false,
          "Tem anexos": true,
        } },
      ], nextLink: "", hasMore: false };
    },
    async listAttachments(...args) { calls.push(["listAttachments", ...args]); return [{ name: "nota.pdf", type: "application/pdf", size: 2048 }]; },
    async downloadAttachment(...args) { calls.push(["downloadAttachment", ...args]); return new Blob(["pdf"], { type: "application/pdf" }); },
  };

  const data = createPaymentProgrammingGalleryData({ repository });
  const snapshot = await data.loadSnapshot();

  assert.equal(snapshot.listName, "PROVISÃO PGTOS");
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].id, "306");
  assert.equal(snapshot.rows[0].fields.FORNECEDOR, "DIBRITA");
  assert.equal(snapshot.rows[0].fields["DATA PREVISTO PGTO"], "2026-09-23T03:00:00Z");
  assert.equal(snapshot.rows[0].fields.DESCRICAOPGTO, "BRITA (10 M3 DE BRITA)");
  assert.equal(snapshot.rows[0].hasAttachments, true);
  assert.deepEqual(calls[0], ["resolveList", "personal", ["PROVISÃO PGTOS", "PROVISAO PGTOS", "PROVISAO PAGAMENTOS"], {}]);
  assert.deepEqual(await data.listAttachments("306"), [{ fileName: "nota.pdf", mimeType: "application/pdf", size: 2048, uploadedAt: "" }]);
  assert.equal((await data.downloadAttachment("306", "nota.pdf")).type, "application/pdf");
});

test("mostra erro específico quando a lista da galeria G28 não está acessível", async t => {
  const createPaymentProgrammingGalleryData = await dataFactory(t);
  const data = createPaymentProgrammingGalleryData({ repository: {
    async resolveList() { return { status: "missing" }; },
    async getItemsPage() { throw new Error("não deve consultar lista ausente"); },
  } });

  await assert.rejects(data.loadSnapshot(), error => (
    error.code === "payment_programming_list_missing"
    && /PROVISÃO PGTOS/.test(error.message)
  ));
});
