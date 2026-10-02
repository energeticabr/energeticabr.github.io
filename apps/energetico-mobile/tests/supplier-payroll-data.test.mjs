import test from "node:test";
import assert from "node:assert/strict";
import * as module from "../src/chat/supplier-payroll-data.js";
const defs = {
  FORNECEDORES: ["CADASTRO", "STATUS", "EMPREITEIRO", "FILIAL", "PROFISSAO"],
  CADASTROPRODUTO: ["PRODUTO", "SATUS", "TIPO", "UNIDADE", "TIPODESPESA"],
  CADASTROCONTA: ["CONTA"],
  LANCAMENTOOBRA: ["ETAPA", "FILIAL"],
  LANCAMENTOS: [
    "__PowerAppsId__",
    "FILIAL",
    "TIPO TRANSAÇÃO",
    "DATA",
    "DATA PGTO EFETUADO",
    "DATA PGTO PREVISTO",
    "FORNECEDOR",
    "PRODUTO",
    "ETAPA",
    "QUANTIDADE",
    "VALOR UNITÁRIO",
    "CONTA",
    "UN",
    "TIPO DESPESA",
    "GERADESEMBOLSO",
    "APROVACAO",
    "OBS",
    "FRETE",
  ],
  IDFOLHA: ["MESREFERENCIA", "FORNECEDOR"],
  FOLHAPGTO: [
    "Title",
    "FORNECEDOR",
    "TIPOPGTO",
    "VALORUNITARIO",
    "QTD",
    "DATA",
    "IDFOLHA",
    "IDLANCAMENTO",
  ],
};
export function fixture() {
  const columns = Object.fromEntries(
    Object.entries(defs).map(([list, fields]) => [
      list,
      fields.map((displayName, i) => ({
        name: `c${i}`,
        displayName,
        ...(/DATA/.test(displayName)
          ? { dateTime: { format: "dateOnly" } }
          : { text: {} }),
      })),
    ]),
  );
  const encode = (list, fields) =>
    Object.fromEntries(
      Object.entries(fields).map(([key, v]) => [
        columns[list].find((c) => c.displayName === key)?.name || key,
        v,
      ]),
    );
  const item = (list, id, fields) => ({
    id: String(id),
    fields: encode(list, fields),
  });
  const rows = {
    FORNECEDORES: [
      item("FORNECEDORES", 1, {
        CADASTRO: "EDGAR",
        STATUS: "ATIVO",
        EMPREITEIRO: "SIM",
        FILIAL: "OBRA A",
        PROFISSAO: "PEDREIRO",
      }),
      item("FORNECEDORES", 2, {
        CADASTRO: "INATIVO",
        STATUS: "INATIVO",
        EMPREITEIRO: "SIM",
      }),
      item("FORNECEDORES", 3, {
        CADASTRO: "OUTRO",
        STATUS: "ATIVO",
        EMPREITEIRO: "NÃO",
      }),
    ],
    CADASTROPRODUTO: [
      item("CADASTROPRODUTO", 4, {
        PRODUTO: "PEDREIRO",
        SATUS: "ATIVO",
        TIPO: "DESPESA",
        UNIDADE: "DIA",
        TIPODESPESA: "MÃO DE OBRA",
      }),
      item("CADASTROPRODUTO", 5, {
        PRODUTO: "OUTRO",
        SATUS: "INATIVO",
        TIPO: "DESPESA",
      }),
    ],
    CADASTROCONTA: [item("CADASTROCONTA", 6, { CONTA: "PIX" })],
    LANCAMENTOOBRA: [
      item("LANCAMENTOOBRA", 7, { ETAPA: "FUNDAÇÃO", FILIAL: "OBRA A" }),
      item("LANCAMENTOOBRA", 8, { ETAPA: "OUTRA OBRA", FILIAL: "OBRA B" }),
    ],
    LANCAMENTOS: [],
    IDFOLHA: [
      item("IDFOLHA", 9, { MESREFERENCIA: "10/2026", FORNECEDOR: "EDGAR" }),
      item("IDFOLHA", 10, { MESREFERENCIA: "08/2026", FORNECEDOR: "EDGAR" }),
      item("IDFOLHA", 11, { MESREFERENCIA: "10/2026", FORNECEDOR: "OUTRO" }),
    ],
    FOLHAPGTO: [],
  };
  const writes = [],
    uploads = [];
  let loseResponse = false,
    failUpload = false;
  const repository = {
    resolveList: async (_s, [name]) => ({ id: name }),
    getColumns: async (_s, list) => columns[list],
    getItemsPage: async (_s, list, query, options = {}) => {
      const match = query.match(/\$filter=fields\/([^ ]+) eq '([^']*)'/);
      return {
        items: match
          ? rows[list].filter((r) => r.fields[match[1]] === match[2])
          : rows[list],
        hasMore: false,
      };
    },
    getItem: async (_s, list, id) =>
      rows[list].find((r) => r.id === String(id)),
    createItem: async (_s, list, fields) => {
      const row = { id: String(100 + rows[list].length), fields };
      rows[list].push(row);
      writes.push({ list, fields });
      if (loseResponse) {
        loseResponse = false;
        throw new Error("resposta perdida");
      }
      return row;
    },
    listAttachments: async () => uploads.map((name) => ({ fileName: name })),
    uploadAttachment: async (_s, list, id, file) => {
      if (failUpload) {
        failUpload = false;
        throw new Error("upload falhou");
      }
      uploads.push(file.name);
    },
  };
  const data = module.createSupplierPayrollData({
    repository,
    now: () => new Date("2026-10-02T20:00:00Z"),
  });
  const draft = {
    date: "2026-10-02",
    supplier: { id: "1", label: "EDGAR", branch: "OBRA A" },
    product: { id: "4", label: "PEDREIRO" },
    stage: { id: "7", label: "FUNDAÇÃO" },
    lines: [
      {
        rubric: "salary",
        quantity: "2",
        unitValue: "100,50",
        account: { id: "6", label: "PIX" },
        files: [],
      },
      {
        rubric: "meal",
        quantity: "3",
        unitValue: "10",
        account: { id: "6", label: "PIX" },
        files: [],
      },
    ],
  };
  return {
    data,
    repository,
    rows,
    columns,
    writes,
    uploads,
    draft,
    decode: (list, fields) =>
      Object.fromEntries(
        Object.entries(fields).map(([key, v]) => [
          columns[list].find((c) => c.name === key)?.displayName || key,
          v,
        ]),
      ),
    loseResponse: () => {
      loseResponse = true;
    },
    failUpload: () => {
      failUpload = true;
    },
  };
}
test("prepara permissões Graph e anexos SharePoint antes de qualquer gravação", async () => {
  const f = fixture();
  const scopes = [];
  const data = module.createSupplierPayrollData({
    repository: f.repository,
    tokenProvider: async (value) => {
      scopes.push(value);
      return "token";
    },
  });
  await data.prepare();
  assert.deepEqual(scopes, [
    ["Sites.Read.All", "Sites.ReadWrite.All"],
    [
      "https://energeticaltda-my.sharepoint.com/AllSites.Read",
      "https://energeticaltda-my.sharepoint.com/AllSites.Write",
    ],
  ]);
  assert.equal(f.writes.length, 0);
});
test("filtra fornecedores, produtos, etapa por filial e IDFOLHA atual com estrela", async () => {
  const f = fixture();
  const suppliers = await f.data.loadSuppliers();
  assert.deepEqual(
    suppliers.map((r) => r.label),
    ["EDGAR"],
  );
  assert.equal(suppliers[0].branch, "OBRA A");
  const products = await f.data.loadProducts(suppliers[0]);
  assert.equal(products[0].recommended, true);
  assert.deepEqual(
    (await f.data.loadStages(suppliers[0])).map((r) => r.label),
    ["FUNDAÇÃO"],
  );
  assert.deepEqual(
    (await f.data.loadSheets(suppliers[0])).map((r) => r.id),
    ["9"],
  );
});
test("posta uma linha por rubrica com os campos pedidos e vincula tipos existentes em FOLHAPGTO", async () => {
  const f = fixture();
  const progress = { operationId: "op1" };
  const result = await f.data.post(f.draft, progress);
  assert.equal(result.lines.length, 2);
  const fields = f.decode("LANCAMENTOS", f.writes[0].fields);
  for (const [key, v] of Object.entries({
    FILIAL: "OBRA A",
    "TIPO TRANSAÇÃO": "CUSTO",
    FORNECEDOR: "EDGAR",
    PRODUTO: "PEDREIRO",
    ETAPA: "FUNDAÇÃO",
    QUANTIDADE: 2,
    "VALOR UNITÁRIO": 100.5,
    CONTA: "PIX",
  }))
    assert.equal(fields[key], v);
  for (const key of ["DATA", "DATA PGTO EFETUADO", "DATA PGTO PREVISTO"])
    assert.equal(fields[key].slice(0, 10), "2026-10-02");
  await f.data.linkPayroll(result, "9", progress);
  assert.equal(f.rows.FOLHAPGTO.length, 2);
  const linked = f.decode("FOLHAPGTO", f.rows.FOLHAPGTO[1].fields);
  assert.equal(linked.TIPOPGTO, "VALE REFEIÇÃO");
  assert.equal(linked.IDFOLHA, 9);
  assert.equal(linked.IDLANCAMENTO, 101);
});
test("retenta gravação com resposta perdida sem duplicar e não aceita editar após gravação parcial", async () => {
  const f = fixture();
  const p = { operationId: "op2" };
  f.loseResponse();
  await assert.rejects(f.data.post(f.draft, p), /perdida/);
  await f.data.post(f.draft, p);
  assert.equal(f.rows.LANCAMENTOS.length, 2);
  await f.data.post(f.draft, p);
  assert.equal(f.rows.LANCAMENTOS.length, 2);
  await assert.rejects(
    f.data.post({ ...f.draft, date: "2026-10-03" }, p),
    /alter|modific/i,
  );
});
test("upload falho retoma somente comprovante sem recriar linha", async () => {
  const f = fixture();
  const file = new File(["abc"], "recibo.pdf", { type: "application/pdf" });
  f.draft.lines[0].files = [file];
  const p = { operationId: "op3" };
  f.failUpload();
  await assert.rejects(f.data.post(f.draft, p), /upload/);
  await f.data.post(f.draft, p);
  assert.equal(f.rows.LANCAMENTOS.length, 2);
  assert.deepEqual(f.uploads, ["recibo.pdf"]);
});
test("revalida fornecedor e etapa e impede vínculo a folha de outra pessoa", async () => {
  const f = fixture();
  await assert.rejects(
    f.data.post(
      { ...f.draft, stage: { id: "8", label: "OUTRA OBRA" } },
      { operationId: "op4" },
    ),
    /etapa/i,
  );
  assert.equal(f.writes.length, 0);
  const p = { operationId: "op5" };
  const result = await f.data.post(f.draft, p);
  await assert.rejects(f.data.linkPayroll(result, "11", p), /folha/i);
  assert.equal(f.rows.FOLHAPGTO.length, 0);
});
test("paginação completa encontra fornecedores elegíveis depois da primeira página", async () => {
  const f = fixture();
  const original = f.repository.getItemsPage;
  f.repository.getItemsPage = async (site, list, query, options) =>
    list === "FORNECEDORES"
      ? options.cursor
        ? { items: [f.rows.FORNECEDORES[0]], hasMore: false }
        : {
            items: [f.rows.FORNECEDORES[1]],
            hasMore: true,
            nextLink: "next-supplier",
          }
      : original(site, list, query, options);
  assert.deepEqual(
    (await f.data.loadSuppliers()).map((s) => s.id),
    ["1"],
  );
});
test("recusa renomeação de fornecedor e comprovantes de mesmo nome antes de gravar", async () => {
  const f = fixture();
  f.rows.FORNECEDORES[0].fields.c0 = "EDGAR NOVO";
  await assert.rejects(
    f.data.post(f.draft, { operationId: "op6" }),
    /alter|cadastro|fornecedor/i,
  );
  assert.equal(f.writes.length, 0);
  f.rows.FORNECEDORES[0].fields.c0 = "EDGAR";
  f.draft.lines[0].files = [
    new File(["a"], "igual.pdf", { type: "application/pdf" }),
    new File(["b"], "igual.pdf", { type: "application/pdf" }),
  ];
  await assert.rejects(
    f.data.post(f.draft, { operationId: "op7" }),
    /nome|repet/i,
  );
  assert.equal(f.writes.length, 0);
});

test("sessão encerrada depois da criação impede outros lançamentos", async () => {
  const f = fixture();
  let valid = true;
  const create = f.repository.createItem;
  f.repository.createItem = async (...args) => {
    const row = await create(...args);
    valid = false;
    return row;
  };
  const data = module.createSupplierPayrollData({
    repository: f.repository,
    assertSession: () => {
      if (!valid) throw new Error("sessão encerrada");
    },
  });
  await assert.rejects(
    data.post(f.draft, { operationId: "session1" }),
    /sessão/,
  );
  assert.equal(f.rows.LANCAMENTOS.length, 1);
});
test("campos booleanos recebem valor booleano e data aceita ISO equivalente", async () => {
  const f = fixture();
  f.columns.LANCAMENTOS.find(
    (c) => c.displayName === "GERADESEMBOLSO",
  ).boolean = {};
  const get = f.repository.getItem;
  f.repository.getItem = async (...args) => {
    const row = await get(...args);
    return {
      ...row,
      fields: Object.fromEntries(
        Object.entries(row.fields).map(([k, v]) => [
          k,
          typeof v === "string" && v.endsWith("T12:00:00Z")
            ? v.replace("Z", ".000Z")
            : v,
        ]),
      ),
    };
  };
  await f.data.post(f.draft, { operationId: "bool1" });
  assert.equal(
    f.decode("LANCAMENTOS", f.writes[0].fields).GERADESEMBOLSO,
    true,
  );
});
