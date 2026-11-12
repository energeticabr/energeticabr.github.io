import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as production from "../src/chat/supplier-payroll-data.js";
import { PDFDocument } from "pdf-lib";
const journals=new WeakMap();
const module={...production,createSupplierPayrollData(options){
  if(options.repository){
    if(options.storage)journals.set(options.repository,options.storage);
    if(!journals.has(options.repository)){const records=new Map();journals.set(options.repository,{getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)});}
    options={loadHoleriteLogo: () => readFile(new URL("../../../assets/logo-energetica-oficial.png", import.meta.url)),
      ...options,storage:journals.get(options.repository)};
  }
  return production.createSupplierPayrollData(options);
}};
test('option progress counts resolved schema and real pages without inventing a page total', async () => {
  const f = fixture(), events = []; let release;
  f.repository.getItemsPage = async (_site, list, _query, options) => options.cursor
    ? new Promise(resolve => { release = () => resolve({ items: f.rows[list].slice(1), hasMore: false }); })
    : { items: f.rows[list].slice(0, 1), hasMore: true, nextLink: 'page-two' };
  const reading = f.data.loadSuppliers({ onProgress: event => events.push(event) });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(events.some(event => event.percent > 0 && event.percent < 100), 'schema completion must be visible during the remaining request');
  assert.ok(events.some(event => event.completedPages === 1 && event.completedItems === 1));
  assert.ok(events.every(event => event.percent < 100));
  release(); const suppliers = await reading;
  assert.equal(suppliers.length, 1); assert.equal(events.at(-1).percent, 100);
  assert.equal(f.writes.length, 0);
});

test('opened supplier cards share sheet reads while a refresh bypasses the prior catalog', async () => {
  const f = fixture();
  const read = f.repository.getItemsPage;
  let sheetReads = 0;
  f.repository.getItemsPage = async (...args) => {
    if (args[1] === 'IDFOLHA') sheetReads++;
    return read(...args);
  };
  const catalogCache = new Map();
  const [first, second, tax] = await Promise.all([
    f.data.loadSheets({ label: 'EDGAR' }, { catalogCache }),
    f.data.loadSheets({ label: 'OUTRO' }, { catalogCache }),
    f.data.loadSheets({ label: 'EDGAR' }, { catalogCache, competence: '2026-08' }),
  ]);
  assert.deepEqual(first.map(sheet => sheet.id), ['9']);
  assert.deepEqual(second.map(sheet => sheet.id), ['11']);
  assert.deepEqual(tax.map(sheet => sheet.id), ['10']);
  assert.equal(sheetReads, 1);
  await f.data.loadSheets({ label: 'EDGAR' }, { catalogCache, refreshCatalog: true });
  assert.equal(sheetReads, 2);
});

test('payroll post reports confirmed launches, payroll links and receipts without storing UI progress', async () => {
  const f = fixture(), events = [], journal = { operationId: 'measured-payroll' };
  f.draft.lines[0].files = [new File(['abc'], 'receipt.pdf', { type: 'application/pdf' })];
  await f.data.post(f.draft, journal, event => events.push({ ...event, launches: f.rows.LANCAMENTOS.length, payroll: f.rows.FOLHAPGTO.length, uploads: f.uploads.length }));
  assert.ok(events.some(event => event.stage === 'launch:salary' && event.launches === 1));
  assert.ok(events.some(event => event.stage === 'payroll:salary' && event.payroll === 1));
  assert.ok(events.some(event => event.stage === 'attachment:salary:receipt.pdf' && event.uploads === 1));
  assert.equal(events.at(-1).percent, 100); assert.ok(events.some(event => event.percent > 0 && event.percent < 100));
  assert.equal(journal.percent, undefined); assert.equal(journal.completed, undefined);
  const writes = f.writes.length; await f.data.post(f.draft, journal, () => { throw new Error('Detached UI'); });
  assert.equal(f.writes.length, writes); assert.equal(f.uploads.length, 1);
});

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
    "IDFOLHA",
  ],
  IDFOLHA: ["MESREFERENCIA", "FORNECEDOR"],
  HOLERITE: ["Title", "CHAVE", "OPERACAO", "FORNECEDOR", "IDFORNECEDOR", "FILIAL", "SEMANA_INICIO", "SEMANA_FIM",
    "DATA_PAGAMENTO", "PRODUTO", "ETAPA", "IDFOLHA", "IDFOLHATRIBUTOS", "RUBRICAS", "TOTAL", "TOTAL_JA_PAGO",
    "TOTAL_PROVISOES", "SITUACAO", "PROVISOES"],
  DESCRITIVOPROVISAO: ["Title", "FOLHAOPERACAO", "FILIAL", "FORNECEDOR", "FORMAPGTO", "OBS", "DATAPREVISTOPGTO", "STATUS", "VALORTOTAL"],
  "PROVISÃO PGTOS": ["Title", "FOLHAOPERACAO", "FILIAL", "FORNECEDOR", "FORMAPGTO", "OBS", "DATAPREVISTOPGTO", "STATUS", "DATA",
    "PRODUTO", "QTD", "VALORTOTAL", "FRETE", "ETAPA", "PGTOAGENDADO", "TIPOPGTO", "DESCRITIVOPROVISAO", "IDFOLHA"],
  FOLHAPGTO: [
    "Title",
    "FORNECEDOR",
    "TIPOPGTO",
    "VALORUNITARIO",
    "QTD",
    "DATA",
    "IDFOLHA",
    "IDLANCAMENTO",
    "IDPROVISAO",
  ],
};
export function fixture() {
  const journal=new Map(), storage={getItem:k=>journal.get(k)??null,setItem:(k,v)=>journal.set(k,v),removeItem:k=>journal.delete(k)};
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
  Object.assign(columns.LANCAMENTOS.find(c=>c.displayName==='IDFOLHA'),{text:undefined,number:{decimalPlaces:'none'},required:false});
  for (const list of ["DESCRITIVOPROVISAO", "PROVISÃO PGTOS"])
    Object.assign(columns[list].find(c=>c.displayName==="FOLHAOPERACAO"),{indexed:true,enforceUniqueValues:true});
  Object.assign(columns["PROVISÃO PGTOS"].find(c=>c.displayName==="IDFOLHA"),{text:undefined,number:{}});
  Object.assign(columns.FOLHAPGTO.find(c=>c.displayName==="IDPROVISAO"),{text:undefined,number:{},indexed:true,enforceUniqueValues:true});
  for (const column of columns.HOLERITE) {
    if (column.displayName === "CHAVE") Object.assign(column, { indexed: true, enforceUniqueValues: true });
    if (column.displayName.startsWith("SEMANA_")) Object.assign(column, { text: undefined, dateTime: {} });
    if (/^(ID|TOTAL)/.test(column.displayName)) Object.assign(column, { text: undefined, number: {} });
  }
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
    HOLERITE: [],
    DESCRITIVOPROVISAO: [],
    "PROVISÃO PGTOS": [],
  };
  const writes = [],
    uploads = [];
  let loseResponse = false,
    failUpload = false;
  const repository = {
    resolveList: async (_s, [name]) => ({ id: name }),
    getColumns: async (_s, list) => columns[list],
    getItemsPage: async (_s, list, query, options = {}) => {
      const match = query.match(/\$filter=fields\/([^ ]+) eq (?:'([^']*)'|(\d+))/);
      return {
        items: match
          ? rows[list].filter((r) => r.fields[match[1]] === (match[2] ?? Number(match[3])))
          : rows[list],
        hasMore: false,
      };
    },
    getItem: async (_s, list, id) =>
      rows[list].find((r) => r.id === String(id)),
    createItem: async (_s, list, fields) => {
      const row = { id: String(100 + rows[list].length), fields, ...(list === "HOLERITE" ? { eTag: '"1"' } : {}) };
      rows[list].push(row);
      writes.push({ list, fields });
      if (loseResponse) {
        loseResponse = false;
        throw new Error("resposta perdida");
      }
      return row;
    },
    updateItem: async (_s, list, id, fields, options) => {
      const row = rows[list].find(item => item.id === String(id));
      assert.equal(options.eTag, row.eTag);
      Object.assign(row.fields, fields);
    },
    listAttachments: async () => uploads.map((name) => ({ fileName: name })),
    uploadAttachment: async (_s, list, id, file, name = file.name) => {
      if (failUpload) {
        failUpload = false;
        throw new Error("upload falhou");
      }
      uploads.push(name);
    },
  };
  const data = module.createSupplierPayrollData({
    repository,
    storage,
    now: () => new Date("2026-10-02T20:00:00Z"),
  });
  const draft = {
    date: "2026-10-02",
    supplier: { id: "1", label: "EDGAR", branch: "OBRA A" },
    product: { id: "4", label: "PEDREIRO" },
    stage: { id: "7", label: "FUNDAÇÃO" },
    sheet: { id: "9", label: "10/2026" },
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
    storage,
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
test("fechamento misto guarda ambas as rubricas e cria provisão somente para a pendente", async () => {
  const f = fixture();
  f.draft.lines[0].alreadyPaid = true;
  f.draft.lines[0].account = null;
  const upload = f.repository.uploadAttachment;
  let pages;
  f.repository.uploadAttachment = async (...args) => {
    if (args[1] === "HOLERITE") {
      const pdf = await PDFDocument.load(await args[3].arrayBuffer());
      pages = pdf.getPageCount();
    }
    return upload(...args);
  };
  const progress = { operationId: "weekly-mixed" };
  const posted = await f.data.post(f.draft, progress, undefined, { weekly: true });
  assert.equal(pages, 1);
  assert.match(posted.holerite.fileName, /^Holerite-2026-09-28-1\.pdf$/);
  assert.equal(f.rows.HOLERITE.length, 1);
  const saved = f.decode("HOLERITE", f.rows.HOLERITE[0].fields);
  assert.equal(saved.SITUACAO, "FECHADO");
  assert.equal(saved.TOTAL, 231);
  assert.equal(saved.TOTAL_JA_PAGO, 201);
  assert.equal(saved.TOTAL_PROVISOES, 30);
  assert.deepEqual(JSON.parse(saved.RUBRICAS).map(row => [row.rubrica, row.alreadyPaid, row.idFolha]),
    [["salary", true, null], ["meal", false, 9]]);
  assert.equal(f.rows.LANCAMENTOS.length, 0);
  assert.equal(f.rows.DESCRITIVOPROVISAO.length, 1);
  assert.equal(f.rows["PROVISÃO PGTOS"].length, 1);
  assert.equal(f.rows.FOLHAPGTO.length, 1);
  const parent = f.decode("DESCRITIVOPROVISAO", f.rows.DESCRITIVOPROVISAO[0].fields);
  const child = f.decode("PROVISÃO PGTOS", f.rows["PROVISÃO PGTOS"][0].fields);
  const payment = f.decode("FOLHAPGTO", f.rows.FOLHAPGTO[0].fields);
  assert.equal(parent.VALORTOTAL, "30");
  assert.equal(child.VALORTOTAL, "10");
  assert.equal(child.ETAPA, "FUNDAÇÃO");
  assert.equal(child.STATUS, "PAGAMENTO PREVISTO");
  assert.equal(child.DATAPGTOEFETUADO, undefined);
  assert.equal(child.FORMAPGTO, "PIX");
  assert.equal(child.DESCRITIVOPROVISAO, f.rows.DESCRITIVOPROVISAO[0].id);
  assert.equal(child.IDFOLHA, 9);
  assert.equal(payment.IDPROVISAO, Number(f.rows["PROVISÃO PGTOS"][0].id));
  assert.equal(payment.IDLANCAMENTO, undefined);
  f.rows.CADASTROPRODUTO.length = 0;
  const reopened = await f.data.post(f.draft, { operationId: "weekly-mixed-reopened" }, undefined, { weekly: true });
  assert.equal(reopened.lines[1].id, posted.lines[1].id);
  assert.equal(f.rows["PROVISÃO PGTOS"].length, 1);
  assert.equal(f.uploads.length, 1);
});

test("folha inteiramente já paga dispensa IDFOLHA e recupera falha de anexo sem duplicar a linha", async () => {
  const f = fixture();
  const draft = { ...f.draft, product: null, stage: null, sheet: null,
    lines: [{ ...f.draft.lines[0], alreadyPaid: true, account: null }] };
  const first = { operationId: "weekly-paid" };
  f.failUpload();
  await assert.rejects(f.data.post(draft, first, undefined, { weekly: true }), /upload falhou/);
  assert.equal(f.decode("HOLERITE", f.rows.HOLERITE[0].fields).SITUACAO, "EM PROCESSAMENTO");
  await f.data.post(draft, { operationId: "weekly-paid-reopened" }, undefined, { weekly: true });
  assert.equal(f.rows.HOLERITE.length, 1);
  assert.equal(f.decode("HOLERITE", f.rows.HOLERITE[0].fields).SITUACAO, "FECHADO");
  assert.equal(f.rows.LANCAMENTOS.length, 0);
  assert.equal(f.rows.DESCRITIVOPROVISAO.length, 0);
  assert.equal(f.rows["PROVISÃO PGTOS"].length, 0);
  assert.equal(f.rows.FOLHAPGTO.length, 0);
  assert.equal(f.uploads.length, 1);
  await assert.rejects(f.data.post({ ...draft, date: "2026-10-03" }, { operationId: "weekly-conflict" },
    undefined, { weekly: true }), /outros dados/);
  assert.equal(f.rows.HOLERITE.length, 1);
});

test("retoma uma provisão semanal após perda da resposta sem duplicar registros nem anexos", async () => {
  const f = fixture();
  const draft = { ...f.draft, lines: [{ ...f.draft.lines[0],
    files: [new File(["receipt"], "recibo.pdf", { type: "application/pdf" })] }] };
  const create = f.repository.createItem;
  let loseResponse = true;
  f.repository.createItem = async (...args) => {
    const row = await create(...args);
    if (args[1] === "PROVISÃO PGTOS" && loseResponse) {
      loseResponse = false;
      throw new Error("resposta da provisão perdida");
    }
    return row;
  };
  const uploaded = [];
  const upload = f.repository.uploadAttachment;
  f.repository.uploadAttachment = async (...args) => {
    uploaded.push([args[1], args[3].name]);
    return upload(...args);
  };
  const options = { weekly: true };
  await assert.rejects(f.data.post(draft, { operationId: "first-provision-attempt" }, undefined, options), /resposta da provisão perdida/);
  const confirmed = await f.data.post(draft, { operationId: "resume-provision" }, undefined, options);
  assert.ok(confirmed.holerite.id);
  assert.equal(f.rows.DESCRITIVOPROVISAO.length, 1);
  assert.equal(f.rows["PROVISÃO PGTOS"].length, 1);
  assert.equal(f.rows.FOLHAPGTO.length, 1);
  assert.equal(f.rows.LANCAMENTOS.length, 0);
  assert.deepEqual(uploaded, [["PROVISÃO PGTOS", "recibo.pdf"], ["HOLERITE", confirmed.holerite.fileName]]);
});
test('folha vincula cada rubrica antes do comprovante e da próxima linha', async () => {
  const f=fixture();f.draft.lines[0].files=[new File(['abc'],'comprovante.pdf',{type:'application/pdf'})];
  const upload=f.repository.uploadAttachment;
  f.repository.uploadAttachment=async(...args)=>{
    assert.equal(f.rows.FOLHAPGTO.length,1,'comprovante não pode impedir o vínculo');
    assert.equal(f.decode('LANCAMENTOS',f.rows.LANCAMENTOS[0].fields).IDFOLHA,9);
    return upload(...args);
  };
  await f.data.post(f.draft,{operationId:'per-line-link'});
  assert.deepEqual(f.rows.LANCAMENTOS.map(row=>f.decode('LANCAMENTOS',row.fields).IDFOLHA),[9,9]);
  assert.equal(f.rows.FOLHAPGTO.length,2);
});

test('folha interrompida no comprovante já mantém o primeiro vínculo confirmado', async () => {
  const f=fixture();f.draft.lines[0].files=[new File(['abc'],'comprovante.pdf',{type:'application/pdf'})];f.failUpload();
  const progress={operationId:'receipt-failure-link'};
  await assert.rejects(f.data.post(f.draft,progress),/upload falhou/);
  assert.equal(f.rows.LANCAMENTOS.length,1);assert.equal(f.rows.FOLHAPGTO.length,1);
  assert.equal(f.decode('LANCAMENTOS',f.rows.LANCAMENTOS[0].fields).IDFOLHA,9);
  await f.data.post(f.draft,progress);assert.equal(f.rows.LANCAMENTOS.length,2);assert.equal(f.rows.FOLHAPGTO.length,2);
});

test('folha bloqueia coluna IDFOLHA ausente antes de registrar qualquer pagamento', async () => {
  const f=fixture();f.columns.LANCAMENTOS=f.columns.LANCAMENTOS.filter(c=>c.displayName!=='IDFOLHA');
  await assert.rejects(f.data.post(f.draft,{operationId:'missing-sheet-column'}),/IDFOLHA/);assert.equal(f.writes.length,0);
});

test('mudança financeira no lançamento durante upload bloqueia a conclusão da folha', async () => {
  const f=fixture();f.draft.lines[0].files=[new File(['abc'],'nota.pdf',{type:'application/pdf'})];
  const upload=f.repository.uploadAttachment,unit=f.columns.LANCAMENTOS.find(c=>c.displayName==='VALOR UNITÁRIO').name;
  f.repository.uploadAttachment=async(...args)=>{await upload(...args);f.rows.LANCAMENTOS[0].fields[unit]=999;};
  await assert.rejects(f.data.post(f.draft,{operationId:'financial-upload-race'}),/dados|alterad|rubrica/);
});

test('reconciliação consulta apenas a origem em uma folha com mais de 10000 registros históricos',async()=>{
  const f=fixture(),pages=f.repository.getItemsPage,origin=f.columns.FOLHAPGTO.find(c=>c.displayName==='IDLANCAMENTO').name;let scoped=0;
  f.repository.getItemsPage=async(...args)=>{
    if(args[1]==='FOLHAPGTO'&&!args[2].includes(`fields/${origin} eq`)){
      if(args[2].includes('$filter='))return pages(...args);
      return {items:[],hasMore:true,nextLink:`page-${args[3].pageNumber+1}`};
    }
    if(args[1]==='FOLHAPGTO')scoped++;
    return pages(...args);
  };
  await f.data.post(f.draft,{operationId:'large-payroll-history'});
  assert.ok(scoped>0);assert.equal(f.rows.LANCAMENTOS.length,2);assert.equal(f.rows.FOLHAPGTO.length,2);
});

test('comprovantes reconhecem o campo name real do repositório sem upload duplicado',async()=>{
  const f=fixture();f.draft.lines[0].files=[new File(['abc'],'comprovante.pdf',{type:'application/pdf'})];
  f.repository.listAttachments=async()=>f.uploads.map(name=>({name}));
  const progress={operationId:'canonical-receipt-name'};
  await f.data.post(f.draft,progress);await f.data.post(f.draft,progress);
  assert.equal(f.uploads.length,1);assert.equal(f.rows.FOLHAPGTO.length,2);
});

test("folha usa paginação Graph real e inclui fornecedores após a primeira página", async () => {
  const f = fixture();
  const calls = [];
  const status = f.columns.FORNECEDORES.find(
    (c) => c.displayName === "STATUS",
  ).name;
  const name = f.columns.FORNECEDORES.find(
    (c) => c.displayName === "CADASTRO",
  ).name;
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: String(index + 1),
    fields: {
      ...f.rows.FORNECEDORES[0].fields,
      [status]: index ? "INATIVO" : "ATIVO",
    },
  }));
  const lastSupplier = {
    id: "101",
    fields: { ...f.rows.FORNECEDORES[0].fields, [name]: "OUTRO EMPREITEIRO" },
  };
  const data = module.createSupplierPayrollData({
    tokenProvider: async () => "token",
    now: () => new Date("2026-10-02T20:00:00Z"),
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      calls.push({
        url: parsed,
        method: options.method,
        headers: options.headers,
      });
      if (parsed.pathname.includes(".sharepoint.com:"))
        return Response.json({
          id: parsed.pathname.includes("-my.")
            ? "site-personal"
            : "site-company",
        });
      if (parsed.pathname.endsWith("/lists"))
        return Response.json({
          value: Object.keys(f.columns).map((id) => ({
            id,
            displayName: id,
            list: { template: "genericList" },
          })),
        });
      const match = parsed.pathname.match(/\/lists\/([^/]+)\/(columns|items)$/);
      assert.ok(match, `URL Graph inesperada: ${parsed.pathname}`);
      const [, list, collection] = match;
      if (collection === "columns")
        return Response.json({ value: f.columns[list] });
      if (list === "FORNECEDORES") {
        return Response.json(
          parsed.searchParams.has("$skiptoken")
            ? { value: [lastSupplier] }
            : {
                value: firstPage,
                "@odata.nextLink":
                  "https://graph.microsoft.com/v1.0/sites/site-personal/lists/FORNECEDORES/items?$expand=fields&$top=100&$skiptoken=second-page",
              },
        );
      }
      return Response.json({ value: f.rows[list] });
    },
  });
  const suppliers = await data.loadSuppliers();
  assert.deepEqual(
    suppliers.map((s) => s.id),
    ["1", "101"],
  );
  assert.deepEqual(
    (await data.loadProducts(suppliers[0])).map((p) => p.id),
    ["4"],
  );
  assert.deepEqual(
    (await data.loadAccounts()).map((a) => a.id),
    ["6"],
  );
  assert.deepEqual(
    (await data.loadStages(suppliers[0])).map((s) => s.id),
    ["7"],
  );
  assert.deepEqual(
    (await data.loadSheets(suppliers[0])).map((s) => s.id),
    ["9"],
  );
  const itemCalls = calls.filter((c) => c.url.pathname.endsWith("/items"));
  assert.equal(
    itemCalls.filter((c) => c.url.pathname.includes("FORNECEDORES")).length,
    2,
  );
  assert.ok(
    itemCalls.every((c) => Number(c.url.searchParams.get("$top")) <= 100),
  );
  assert.ok(calls.every((c) => c.method === "GET"));
});
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
test("IDFOLHA aceita referências de mês nos mesmos formatos do lançamento existente", async () => {
  const f = fixture();
  const monthColumn = f.columns.IDFOLHA.find(
    (c) => c.displayName === "MESREFERENCIA",
  ).name;
  f.rows.IDFOLHA[0].fields[monthColumn] = "2026/10";
  f.rows.IDFOLHA.push({
    id: "12",
    fields: { ...f.rows.IDFOLHA[0].fields, [monthColumn]: "2026-9" },
  });
  f.rows.IDFOLHA.push({
    id: "13",
    fields: { ...f.rows.IDFOLHA[0].fields, [monthColumn]: "11-2026" },
  });
  f.rows.IDFOLHA.push({
    id: "14",
    fields: { ...f.rows.IDFOLHA[0].fields, [monthColumn]: "2026/13" },
  });
  const sheets = await f.data.loadSheets((await f.data.loadSuppliers())[0]);
  assert.deepEqual(sheets.map((s) => s.id).sort(), ["12", "13", "9"]);
  assert.equal(sheets.find((s) => s.id === "9").recommended, true);
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
    QUANTIDADE: "2",
    "VALOR UNITÁRIO": "100.5",
    CONTA: "PIX",
  }))
    assert.equal(fields[key], v);
  for (const key of ["DATA", "DATA PGTO EFETUADO", "DATA PGTO PREVISTO"])
    assert.equal(fields[key].slice(0, 10), "2026-10-02");
  assert.equal(result.sheet.id, "9");
  assert.equal(f.rows.FOLHAPGTO.length, 2);
  const linked = f.decode("FOLHAPGTO", f.rows.FOLHAPGTO[1].fields);
  assert.equal(linked.TIPOPGTO, "VALE REFEIÇÃO");
  assert.equal(linked.IDFOLHA, "9");
  assert.equal(linked.IDLANCAMENTO, "101");
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
  assert.equal(f.rows.FOLHAPGTO.length, 2);
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

test("postagem exige IDFOLHA válido do fornecedor antes de qualquer gravação", async () => {
  for (const sheet of [
    null,
    { id: "11", label: "10/2026" },
    { id: "10", label: "08/2026" },
    { id: "999", label: "10/2026" },
    { id: "9", label: "09/2026" },
  ]) {
    const f = fixture();
    await assert.rejects(
      f.data.post({ ...f.draft, sheet }, { operationId: "required-sheet" }),
      /IDFOLHA|folha/i,
    );
    assert.equal(f.writes.length, 0);
  }
});
test("metadados incompletos de FOLHAPGTO bloqueiam lançamentos antes de gravar", async () => {
  for (const field of ["Title", "IDFOLHA", "IDLANCAMENTO", "TIPOPGTO"]) {
    const f = fixture();
    f.columns.FOLHAPGTO = f.columns.FOLHAPGTO.filter(
      (c) => c.displayName !== field,
    );
    await assert.rejects(
      f.data.post(f.draft, { operationId: "link-preflight" }),
      /campo/i,
    );
    assert.equal(f.writes.length, 0);
  }
});
test("falha na confirmação do vínculo retoma a mesma folha sem duplicar registros", async () => {
  const f = fixture();
  const p = { operationId: "lost-link" };
  const create = f.repository.createItem;
  let lose = true;
  f.repository.createItem = async (...args) => {
    const row = await create(...args);
    if (args[1] === "FOLHAPGTO" && lose) {
      lose = false;
      throw new Error("resposta do vínculo perdida");
    }
    return row;
  };
  await assert.rejects(f.data.post(f.draft, p), /vínculo perdida/);
  // Stop at the first interrupted association instead of opening another launch.
  assert.equal(f.rows.LANCAMENTOS.length, 1);
  assert.equal(f.decode('LANCAMENTOS', f.rows.LANCAMENTOS[0].fields).IDFOLHA, 9);
  assert.equal(f.rows.FOLHAPGTO.length, 1);
  await assert.rejects(
    f.data.post({ ...f.draft, sheet: { id: "12", label: "11/2026" } }, p),
    /alterada/,
  );
  const result = await f.data.post(f.draft, p);
  assert.equal(result.sheet.id, "9");
  assert.equal(f.rows.LANCAMENTOS.length, 2);
  assert.equal(f.rows.FOLHAPGTO.length, 2);
  for (const line of result.lines) assert.ok(p.lines[line.rubric].payrollId);
});

test("postagem só conclui depois de confirmar o IDFOLHA gravado em todas as rubricas", async () => {
  const f = fixture();
  const get = f.repository.getItem;
  const idColumn = f.columns.FOLHAPGTO.find(
    (c) => c.displayName === "IDFOLHA",
  ).name;
  let mismatch = true;
  f.repository.getItem = async (...args) => {
    const row = await get(...args);
    return args[1] === "FOLHAPGTO" && mismatch
      ? { ...row, fields: { ...row.fields, [idColumn]: 11 } }
      : row;
  };
  const p = { operationId: "verify-link" };
  await assert.rejects(f.data.post(f.draft, p), /confirmou todos/);
  assert.equal(f.rows.FOLHAPGTO.length, 1);
  mismatch = false;
  const result = await f.data.post(f.draft, p);
  assert.equal(result.sheet.id, "9");
  assert.equal(f.rows.LANCAMENTOS.length, 2);
  assert.equal(f.rows.FOLHAPGTO.length, 2);
});

test("retomada após virada do mês preserva IDFOLHA validado sem aceitar nova folha fora do período", async () => {
  const f = fixture();
  let now = new Date("2026-10-02T20:00:00Z");
  f.rows.IDFOLHA[0].fields.c0 = "09/2026";
  f.draft.sheet.label = "09/2026";
  const data = module.createSupplierPayrollData({
    repository: f.repository,
    now: () => now,
  });
  const create = f.repository.createItem;
  let lose = true;
  f.repository.createItem = async (...args) => {
    const row = await create(...args);
    if (args[1] === "FOLHAPGTO" && lose) {
      lose = false;
      throw new Error("resposta perdida antes da virada do mês");
    }
    return row;
  };
  const p = { operationId: "month-rollover" };
  await assert.rejects(data.post(f.draft, p), /perdida/);
  now = new Date("2026-11-02T20:00:00Z");
  const result = await data.post(f.draft, p);
  assert.equal(result.sheet.id, "9");
  assert.equal(result.sheet.label, "09/2026");
  assert.equal(f.rows.LANCAMENTOS.length, 2);
  assert.equal(f.rows.FOLHAPGTO.length, 2);
  const writes = f.writes.length;
  await assert.rejects(
    data.post(f.draft, { operationId: "new-stale-sheet" }),
    /IDFOLHA/,
  );
  assert.equal(f.writes.length, writes);
});
test('exact tax competence loads historical sheets outside the normal window', async()=>{
  const f=fixture();
  assert.deepEqual((await f.data.loadSheets(f.draft.supplier,{competence:'2026-08'})).map(s=>s.id),['10']);
});

test('uncertain tax launch POST without a visible row is never blindly repeated',async()=>{
  const f=fixture(),taxSheet=taxSheetFixture(f),progress={operationId:'unknown-tax-post'};
  const draft={...f.draft,sheet:null,taxCompetence:'2026-09',taxSheet,lines:[{...f.draft.lines[0],rubric:'inss'}]};
  let attempts=0;f.repository.createItem=async()=>{attempts++;throw new Error('response lost');};
  await assert.rejects(f.data.post(draft,progress),/response lost/);
  await assert.rejects(f.data.post(draft,progress),/confirm|incert/i);
  assert.equal(attempts,1);
});

test('two sheets for the same tax competence fail before creating launches',async()=>{
  const f=fixture(),taxSheet=taxSheetFixture(f);
  f.rows.IDFOLHA.push({...f.rows.IDFOLHA.at(-1),id:'13'});
  await assert.rejects(f.data.post({...f.draft,taxCompetence:'2026-09',taxSheet,lines:[{...f.draft.lines[0],rubric:'inss'}]}, {operationId:'ambiguous-tax'}),/único|competência/i);
  assert.equal(f.writes.length,0);
});

function taxSheetFixture(f) {
  const month=f.columns.IDFOLHA.find(c=>c.displayName==='MESREFERENCIA').name;
  f.rows.IDFOLHA.push({id:'12',fields:{...f.rows.IDFOLHA[0].fields,[month]:'09/2026'}});
  return {id:'12',label:'09/2026'};
}

test('resuming a tax batch reuses a compatible gallery link for the same launch regardless of Title',async()=>{
  const f=fixture(),taxSheet=taxSheetFixture(f),progress={operationId:'cross-flow-tax'};
  const selected={...f.draft,sheet:null,taxCompetence:'2026-09',taxSheet,lines:[{...f.draft.lines[0],rubric:'inss'}]};
  const pages=f.repository.getItemsPage;let fail=true;
  f.repository.getItemsPage=async(...args)=>{if(args[1]==='FOLHAPGTO'&&fail){fail=false;throw new Error('lookup failed');}return pages(...args);};
  await assert.rejects(f.data.post(selected,progress),/lookup failed/);
  const fields={Title:'APP-folha-encargo-lancamento-100-INSS',FORNECEDOR:'EDGAR',TIPOPGTO:'INSS',VALORUNITARIO:'100.5',QTD:'2',DATA:'2026-10-02T12:00:00Z',IDFOLHA:'12',IDLANCAMENTO:'100'};
  f.rows.FOLHAPGTO.push({id:'88',fields:Object.fromEntries(Object.entries(fields).map(([label,value])=>[f.columns.FOLHAPGTO.find(c=>c.displayName===label).name,value]))});
  await f.data.post(selected,progress);
  assert.equal(f.rows.FOLHAPGTO.length,1);assert.equal(progress.lines.inss.payrollId,'88');
});

test('unavailable durable tax journal blocks before any paid launch is created',async()=>{
  const f=fixture(),taxSheet=taxSheetFixture(f);f.storage.setItem=()=>{throw new Error('quota');};
  await assert.rejects(f.data.post({...f.draft,sheet:null,taxCompetence:'2026-09',taxSheet,lines:[{...f.draft.lines[0],rubric:'inss'}]}, {operationId:'no-tax-storage'}),/quota|armazenamento/i);
  assert.equal(f.writes.length,0);
});

test('weekly payroll keeps tax in its selected sheet and out of the payslip',async()=>{
  const f=fixture(),taxSheet=taxSheetFixture(f);
  const upload=f.repository.uploadAttachment;
  let holeritePdf;
  f.repository.uploadAttachment=async (...args)=>{
    if(args[1]==='HOLERITE' && args[3].type==='application/pdf') holeritePdf=await args[3].arrayBuffer();
    return upload(...args);
  };
  const draft={...f.draft,taxCompetence:'2026-09',taxSheet,lines:[f.draft.lines[0],
    {...f.draft.lines[0],rubric:'inss',quantity:'1',unitValue:'10'},
    {...f.draft.lines[0],rubric:'fgts',quantity:'1',unitValue:'20',alreadyPaid:true,account:null}]};
  const result=await f.data.post(draft,{operationId:'mixed-tax-test'},undefined,{weekly:true});
  const payments=f.writes.filter(w=>w.list==='FOLHAPGTO').map(w=>f.decode('FOLHAPGTO',w.fields));
  assert.deepEqual(payments.map(p=>[p.TIPOPGTO,Number(p.IDFOLHA)]),[['SALÁRIO',9],['INSS',12]]);
  assert.deepEqual(f.rows['PROVISÃO PGTOS'].map(row=>f.decode('PROVISÃO PGTOS',row.fields).IDFOLHA),[9,12]);
  assert.equal(result.taxSheet.id,'12');
  assert.equal(result.sheet.id,'9');
  const saved=f.decode('HOLERITE',f.rows.HOLERITE[0].fields);
  assert.deepEqual(JSON.parse(saved.RUBRICAS).map(line=>line.rubrica),['salary']);
  assert.deepEqual(JSON.parse(saved.PROVISOES).map(line=>line.rubric),['salary']);
  assert.equal(saved.IDFOLHATRIBUTOS,undefined);
  assert.equal(saved.TOTAL,201);
  assert.equal(saved.TOTAL_JA_PAGO,0);
  assert.equal(saved.TOTAL_PROVISOES,201);
  const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf=getDocument({data:new Uint8Array(holeritePdf),useSystemFonts:true});
  try {
    const doc=await pdf.promise;
    assert.equal(doc.numPages,1);
    const page=await doc.getPage(1);
    const text=(await page.getTextContent()).items.map(item=>item.str).join(' ');
    assert.doesNotMatch(text,/INSS|FGTS/);
    assert.match(text,/Provisionado\s+R\$ 201,00/);
    assert.equal((text.match(/Assinatura do responsável pela empresa/g) || []).length,2);
    assert.equal((text.match(/Assinatura do funcionário/g) || []).length,2);
    const {fnArray}=await page.getOperatorList();
    assert.equal(fnArray.filter(operator=>operator===OPS.paintImageXObject).length,2);
  } finally { await pdf.destroy(); }
  const retry=await f.data.post(draft,{operationId:'mixed-tax-retry'},undefined,{weekly:true});
  assert.equal(retry.lines.find(line=>line.rubric==='inss').id,result.lines.find(line=>line.rubric==='inss').id);
  await assert.rejects(f.data.post({...draft,lines:[draft.lines[0],{...draft.lines[1],unitValue:'99'}]},
    {operationId:'mixed-tax-modified'},undefined,{weekly:true}),/tributos em um envio próprio/);
  assert.equal(f.rows['PROVISÃO PGTOS'].length,2);
  assert.equal(f.rows.LANCAMENTOS.length,0);
});

test('tax-only payroll posts to historical competence without requiring a normal sheet',async()=>{
  const f=fixture();
  await f.data.post({...f.draft,sheet:null,taxCompetence:'2026-08',taxSheet:{id:'10',label:'08/2026'},
    lines:[{...f.draft.lines[0],rubric:'fgts'}]}, {operationId:'tax-only-test'},undefined,{weekly:true});
  const payment=f.writes.filter(w=>w.list==='FOLHAPGTO').map(w=>f.decode('FOLHAPGTO',w.fields))[0];
  assert.equal(Number(payment.IDFOLHA),10);
  assert.equal(payment.TIPOPGTO,'FGTS');
  assert.equal(f.decode('PROVISÃO PGTOS',f.rows['PROVISÃO PGTOS'][0].fields).IDFOLHA,10);
  assert.equal(f.rows.HOLERITE.length,0);
  const taxSheet=taxSheetFixture(f);
  const draft={...f.draft,sheet:null,taxCompetence:'2026-09',taxSheet,lines:[{...f.draft.lines[0],rubric:'fgts'}]};
  await f.data.post(draft,{operationId:'same-week-other-competence'},undefined,{weekly:true});
  await f.data.post(draft,{operationId:'same-week-retry'},undefined,{weekly:true});
  assert.deepEqual(f.rows['PROVISÃO PGTOS'].map(row=>f.decode('PROVISÃO PGTOS',row.fields).IDFOLHA),[10,12]);
});

test('tax sheets from another supplier or wrong competence fail before any financial write',async()=>{
  for(const taxSheet of [{id:'11',label:'10/2026'},{id:'9',label:'09/2026'}]) {
    const f=fixture();
    await assert.rejects(f.data.post({...f.draft,taxCompetence:'2026-09',taxSheet,
      lines:[{...f.draft.lines[0],rubric:'inss'}]}, {operationId:'bad-tax-sheet'}), /IDFOLHA|competência/i);
    assert.equal(f.writes.length,0);
  }
});
