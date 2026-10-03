import test from "node:test";
import assert from "node:assert/strict";
import { createRhReportsData } from "../src/chat/rh-reports-data.js";

function fixture(overrides = {}) {
  const calls = [];
  const repository = {
    async resolveList(site, aliases) { assert.equal(site, "personal"); calls.push(["resolve", aliases[0]]); return { status: "resolved", id: aliases[0] }; },
    async getColumns() { return []; },
    async getItemsPage(_site, list, query, options) {
      calls.push(["page", list, options.pageNumber, options.cursor || ""]);
      assert.equal(new URLSearchParams(query).get("$expand"), "fields");
      if (list === "DESCRITIVOPRESENCA" && options.pageNumber === 1) return { items: [{ id: "1", fields: { FORNECEDOR: "Ana", DATA: "2026-10-01", PRESENCA: "PRESENTE" } }], hasMore: true, nextLink: "next" };
      if (list === "DESCRITIVOPRESENCA") return { items: [{ id: "2", fields: { FORNECEDOR: "Ana", DATA: "2026-10-02", PRESENCA: "PENDENTE" } }], hasMore: false };
      return { items: [{ id: "3", fields: list === "FORNECEDORES" ? { CADASTRO: "Ana", EMPREITEIRO: "SIM" } : { FORNECEDOR: "Ana", DATA: "2026-10-02" } }], hasMore: false };
    }, ...overrides,
  };
  return { repository, calls };
}

test("relatórios 3 e 5 consultam fornecedores e todas as páginas de presenças; 4 usa apenas presenças", async () => {
  const { repository, calls } = fixture();
  const data = createRhReportsData({ repository });
  const three = await data.loadSnapshot(3);
  assert.equal(three.suppliers[0].name, "Ana"); assert.equal(three.presences.length, 2);
  assert.ok(calls.some(call => call[0] === "page" && call[1] === "DESCRITIVOPRESENCA" && call[2] === 2 && call[3] === "next"));
  calls.length = 0;
  const four = await data.loadSnapshot(4);
  assert.equal(four.presences.length, 2);
  assert.equal(calls.some(call => call.includes("FORNECEDORES")), false);
});

test("paginação quebrada e erro remoto rejeitam sem devolver registros parciais", async () => {
  const broken = fixture({ async getItemsPage() { return { items: [{ id: "1", fields: {} }], hasMore: true }; } });
  await assert.rejects(createRhReportsData({ repository: broken.repository }).loadSnapshot(5), /paginação/i);
  const throttled = fixture({ async getItemsPage() { throw new Error("429 SharePoint"); } });
  await assert.rejects(createRhReportsData({ repository: throttled.repository }).loadSnapshot(3), /429/);
});

test("cancelamento e número inválido não iniciam consulta", async () => {
  const { repository, calls } = fixture(); const data = createRhReportsData({ repository });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(data.loadSnapshot(4, { signal: abort.signal }), /abort|cancelad/i);
  await assert.rejects(data.loadSnapshot(17), /3, 4 ou 5/i);
  assert.equal(calls.length, 0);
});
