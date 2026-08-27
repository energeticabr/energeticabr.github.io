import assert from "node:assert/strict";
import test from "node:test";

import { persistEntityRecord } from "../portal/forms/entity-submit.js";

const entity = Object.freeze({ id: "lancamentos", siteKey: "personal" });
const list = Object.freeze({ id: "lancamentos-list" });

function requiredFields(extra = {}) {
  return {
    FILIAL: "001",
    ETAPA: "FUNDAÇÃO",
    CONTA: "OBRA",
    "TIPO TRANSAÇÃO": "CUSTO",
    QUANTIDADE: 2,
    FORNECEDOR: "ACME",
    "VALOR UNITÁRIO": 100,
    ...extra,
  };
}

test("lancamentos bloqueia envio quando faltam campos obrigatorios do PowerApps", async () => {
  await assert.rejects(
    persistEntityRecord({
      async resolveList() { throw new Error("não deve consultar listas sem validar campos"); },
      async createItem() { throw new Error("não deve gravar item inválido"); },
    }, entity, list, { mode: "create", fields: requiredFields({ FILIAL: "" }) }),
    /FILIAL/,
  );
});

test("lancamentos cria pedido em notas pendentes e usa o ID como agrupamento", async () => {
  const calls = [];
  const result = await persistEntityRecord({
    async resolveList(_siteKey, aliases) {
      if (aliases.includes("NOTASPENDENTES")) return { status: "resolved", id: "notas-list" };
      if (aliases.includes("PROVISÃO PGTOS")) return { status: "missing" };
      return { status: "missing" };
    },
    async createItem(_siteKey, listId, fields) {
      calls.push(["create", listId, fields]);
      return listId === "notas-list" ? { id: "55", eTag: '"1"', fields } : { id: "99", fields };
    },
  }, entity, list, { mode: "create", fields: requiredFields({ FRETE: 25 }) });

  assert.equal(calls.length, 2);
  assert.equal(calls[0][1], "notas-list");
  assert.equal(calls[0][2].STATUS, "PENDENTE");
  assert.equal(calls[0][2].VALORTOTAL, 225);
  assert.equal(calls[1][1], "lancamentos-list");
  assert.equal(calls[1][2].AGRUPAR, "55");
  assert.equal(result.item.id, "99");
});

test("lancamentos remove nota preventiva quando o lancamento principal falha", async () => {
  const deleted = [];
  await assert.rejects(
    persistEntityRecord({
      async resolveList(_siteKey, aliases) {
        return aliases.includes("NOTASPENDENTES") ? { status: "resolved", id: "notas-list" } : { status: "missing" };
      },
      async createItem(_siteKey, listId, fields) {
        if (listId === "notas-list") return { id: "55", eTag: '"1"', fields };
        throw new Error("falha no lançamento");
      },
      async deleteItem(_siteKey, listId, itemId, options) {
        deleted.push([listId, itemId, options.eTag]);
      },
    }, entity, list, { mode: "create", fields: requiredFields() }),
    /falha no lançamento/,
  );

  assert.deepEqual(deleted, [["notas-list", "55", '"1"']]);
});

test("lancamentos valida agrupamento existente antes de gravar", async () => {
  const calls = [];
  await assert.rejects(
    persistEntityRecord({
      async resolveList(_siteKey, aliases) {
        return aliases.includes("NOTASPENDENTES") ? { status: "resolved", id: "notas-list" } : { status: "missing" };
      },
      async getItem(_siteKey, _listId, id) {
        calls.push(["get", id]);
        throw new Error("não encontrado");
      },
      async createItem() { throw new Error("não deve criar com agrupamento inválido"); },
    }, entity, list, { mode: "create", fields: requiredFields({ AGRUPAR: "123" }) }),
    /agrupamento 123 não existe/i,
  );
  assert.deepEqual(calls, [["get", "123"]]);
});

test("edicao de lancamento preserva fluxo normal com etag e valores atuais", async () => {
  const calls = [];
  await persistEntityRecord({
    async updateItem(...args) {
      calls.push(args);
      return { id: args[2], fields: args[3] };
    },
  }, entity, list, {
    mode: "edit",
    item: { id: "7", eTag: '"2"' },
    fields: requiredFields({ FILIAL: "002" }),
  });
  assert.deepEqual(calls[0], ["personal", "lancamentos-list", "7", requiredFields({ FILIAL: "002" }), { eTag: '"2"' }]);
});

test("lancamentos avisa quando ja existe provisao relacionada ao fornecedor", async () => {
  const result = await persistEntityRecord({
    async resolveList(_siteKey, aliases) {
      if (aliases.includes("NOTASPENDENTES")) return { status: "resolved", id: "notas-list" };
      if (aliases.includes("PROVISÃO PGTOS")) return { status: "resolved", id: "provisoes-list" };
      return { status: "missing" };
    },
    async createItem(_siteKey, listId, fields) {
      return listId === "notas-list" ? { id: "55", fields } : { id: "99", fields };
    },
    async getItemsPage(_siteKey, listId) {
      return listId === "provisoes-list" ? { items: [{ id: "3", fields: { FORNECEDOR: "ACME" } }] } : { items: [] };
    },
  }, entity, list, { mode: "create", fields: requiredFields() });

  assert.match(result.warnings.join(" "), /provisão de pagamento/i);
});
