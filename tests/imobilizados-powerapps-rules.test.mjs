import assert from "node:assert/strict";
import test from "node:test";

import {
  buildF18PowerAppsDefaults,
  buildF20SecondaryCadastroProdutoPayload,
  deriveF18ImobilizadoDefaults,
  getF18NextAssetNumber,
  getF18NextMonthDepreciationDate,
} from "../portal/forms/imobilizados-powerapps-rules.js";
import { persistEntityRecord } from "../portal/forms/entity-submit.js";

test("F18 uses the greatest SharePoint asset number plus one", () => {
  const records = [
    { NÚMEROIMOBILIZADO: 41 },
    { N_x00da_MEROIMOBILIZADO: "105" },
    { NUMEROIMOBILIZADO: 72 },
    { NÚMEROIMOBILIZADO: "inválido" },
  ];

  assert.equal(getF18NextAssetNumber(records), 106);
  assert.equal(getF18NextAssetNumber([]), 1);
});

test("F18 starts depreciation on the first day of the following month", () => {
  assert.equal(getF18NextMonthDepreciationDate("2026-01-31"), "2026-02-01");
  assert.equal(getF18NextMonthDepreciationDate("2026-12-15"), "2027-01-01");
  assert.equal(getF18NextMonthDepreciationDate(""), null);
  assert.equal(getF18NextMonthDepreciationDate("not-a-date"), null);
});

test("F18 derives group and function from the selected immobilized product and copies estimated value to residual", () => {
  const result = deriveF18ImobilizadoDefaults({
    selectedImobilizado: "BETONEIRA 400 L",
    cadastroImobilizado: [
      {
        IMOBILIZADO: "BETONEIRA 400 L",
        GRUPOIMOBILIZADO: "MÁQUINAS E EQUIPAMENTOS",
        FUNCAO: "PRODUÇÃO",
      },
    ],
    estimatedValue: "18900,00",
  });

  assert.deepEqual(result, {
    grupoImobilizado: "MÁQUINAS E EQUIPAMENTOS",
    funcao: "PRODUÇÃO",
    valorResidual: "18900,00",
  });
});

test("F18 returns null for derived values whose source inputs are unavailable", () => {
  assert.deepEqual(
    deriveF18ImobilizadoDefaults({
      selectedImobilizado: "NÃO CADASTRADO",
      cadastroImobilizado: [],
    }),
    {
      grupoImobilizado: null,
      funcao: null,
      valorResidual: null,
    },
  );
});

test("F18 exposes all defaults through one integration-friendly pure result", () => {
  const result = buildF18PowerAppsDefaults({
    existingAssets: [{ NÚMEROIMOBILIZADO: 3399 }],
    registrationDate: "2026-08-28",
    selectedImobilizado: {
      IMOBILIZADO: "ANDAIME",
      "GRUPO IMOBILIZADO": "EQUIPAMENTOS",
      "FUNÇÃO": "APOIO À OBRA",
    },
    estimatedValue: 2500,
  });

  assert.deepEqual(result, {
    numeroImobilizado: 3400,
    dataDepreciacao: "2026-09-01",
    grupoImobilizado: "EQUIPAMENTOS",
    funcao: "APOIO À OBRA",
    valorResidual: 2500,
  });
});

test("F20 creates the secondary CADASTROPRODUTO payload when the product is absent", () => {
  assert.deepEqual(
    buildF20SecondaryCadastroProdutoPayload({
      product: "BETONEIRA 400 L",
      existingProducts: [{ PRODUTO: "MARTELO" }],
    }),
    {
      PRODUTO: "BETONEIRA 400 L",
      SUBFAMÍLIA: "DEPRECIAÇÃO E AMORTIZAÇÃO",
    },
  );
});

test("F20 does not create a secondary product for an existing or blank product", () => {
  const existingProducts = [{ PRODUTO: "BETONEIRA 400 L" }];

  assert.equal(
    buildF20SecondaryCadastroProdutoPayload({
      product: "  betoneira 400 l  ",
      existingProducts,
    }),
    null,
  );
  assert.equal(
    buildF20SecondaryCadastroProdutoPayload({
      product: "   ",
      existingProducts,
    }),
    null,
  );
});

test("F20 creates a missing CADASTROPRODUTO row before saving the asset catalog", async () => {
  const writes = [];
  const repository = {
    async createItem(_site, listId, fields) {
      writes.push({ listId, fields });
      return { id: String(writes.length), fields };
    },
    async resolveList() { return { status: "resolved", id: "products-list" }; },
    async getColumns() {
      return [
        { name: "field_1", displayName: "PRODUTO" },
        { name: "Title", displayName: "SUBFAMÍLIA" },
      ];
    },
    async getItems() { return [{ id: "1", fields: { field_1: "MARTELO" } }]; },
  };

  await persistEntityRecord(repository, { id: "cadastro-de-imobilizados", siteKey: "company" }, { id: "asset-list" }, {
    mode: "create",
    fields: { IMOBILIZADO: "BETONEIRA 400 L", GRUPOIMOBILIZADO: "MÁQUINAS" },
  });

  assert.deepEqual(writes, [
    { listId: "products-list", fields: { field_1: "BETONEIRA 400 L", Title: "DEPRECIAÇÃO E AMORTIZAÇÃO" } },
    { listId: "asset-list", fields: { IMOBILIZADO: "BETONEIRA 400 L", GRUPOIMOBILIZADO: "MÁQUINAS" } },
  ]);
});

test("F20 does not save the asset catalog when creating the related product fails", async () => {
  const writes = [];
  const repository = {
    async createItem(_site, listId, fields) {
      writes.push({ listId, fields });
      if (listId === "products-list") throw new Error("Falha ao criar CADASTROPRODUTO");
      return { id: "asset-created", fields };
    },
    async resolveList() { return { status: "resolved", id: "products-list" }; },
    async getColumns() {
      return [
        { name: "field_1", displayName: "PRODUTO" },
        { name: "Title", displayName: "SUBFAMÍLIA" },
      ];
    },
    async getItems() { return []; },
  };

  await assert.rejects(
    persistEntityRecord(repository, { id: "cadastro-de-imobilizados", siteKey: "company" }, { id: "asset-list" }, {
      mode: "create",
      fields: { IMOBILIZADO: "BETONEIRA 400 L", GRUPOIMOBILIZADO: "MÁQUINAS" },
    }),
    /Falha ao criar CADASTROPRODUTO/,
  );

  assert.deepEqual(writes, [
    { listId: "products-list", fields: { field_1: "BETONEIRA 400 L", Title: "DEPRECIAÇÃO E AMORTIZAÇÃO" } },
  ]);
});

test("F18 normalizes residual and depreciation defaults before the SharePoint write", async () => {
  let written;
  const repository = {
    async createItem(_site, _list, fields) { written = fields; return { id: "3400", fields }; },
  };

  await persistEntityRecord(repository, { id: "imobilizados", siteKey: "company" }, { id: "assets" }, {
    mode: "create",
    fields: {
      DATACADASTRO: "2026-12-15",
      DATADEPRECIA_x00c7__x00c3_O: "",
      VALORESTIMADO: "2500",
      VALORRESIDUAL: "",
    },
  });

  assert.equal(written.DATADEPRECIA_x00c7__x00c3_O, "2027-01-01");
  assert.equal(written.VALORRESIDUAL, "2500");
});
