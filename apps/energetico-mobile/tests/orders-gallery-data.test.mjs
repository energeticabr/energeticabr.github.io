import test from "node:test";
import assert from "node:assert/strict";
import * as galleryData from "../src/chat/orders-gallery-data.js";

const { createOrdersGalleryData, createPendingProvisionAttachmentsData, OrdersGalleryDataError } = galleryData;

function repositoryHarness(overrides = {}) {
  const calls = [];
  const pages = [
    { items: [
      { id: "319", fields: { FILIAL: "004 - EDIFÍCIO XAVANTE", FORNECEDOR: "IMPERMATEX", FORMAPGTO: "CAIXA", VALORTOTAL: 650, STATUS: "PENDENTE AUDITORIA", "NOTA_x0020_FISCAL": "PENDENTE", Criado: "2026-09-21T16:48:00Z", "Tem anexos": true } },
      { id: "320", fields: { FILIAL: "004 - EDIFÍCIO XAVANTE", FORNECEDOR: "COFER", FORMAPGTO: "ENERGÉTICA - CAIXA", VALORTOTAL: 765.6, STATUS: "PAGO", "NOTA FISCAL": "NF-55", Criado: "2026-09-21T17:12:00Z", DATAPGTOEFETUADO: "2026-09-22T12:00:00Z", OBS: "Pedido liberado", "OBS FISCAL": "Recebida", "Criado por": { DisplayName: "Bernardo Notini" }, "Modificado por": { DisplayName: "Bernardo Notini" }, Modificado: "2026-09-21T17:12:00Z", "Tem anexos": true } },
    ], nextLink: "cursor-2", hasMore: true },
    { items: [{ id: "318", fields: { FILIAL: "001 - CENTRAL", FORNECEDOR: "RAFAEL", STATUS: "PENDENTE AUDITORIA", "Tem anexos": false } }], nextLink: "", hasMore: false },
  ];
  const repository = {
    async resolveList(...args) {
      calls.push(["resolveList", ...args]);
      return { status: "resolved", id: "list-notas" };
    },
    async getItemsPage(...args) {
      calls.push(["getItemsPage", ...args]);
      return pages.shift();
    },
    async listAttachments(...args) {
      calls.push(["listAttachments", ...args]);
      return [
        { name: "pedido.pdf", type: "application/pdf", size: 2048, uploadedAt: "2026-09-21T17:00:00Z" },
        { name: "foto.jpg", type: "image/jpeg", size: 4096 },
      ];
    },
    async downloadAttachment(...args) {
      calls.push(["downloadAttachment", ...args]);
      return new Uint8Array([37, 80, 68, 70, 45]).buffer;
    },
    ...overrides,
  };
  return { repository, calls };
}

test("galerias de folha leem IDFOLHA e FOLHAPGTO com paginação e normalização de campos", async () => {
  assert.equal(typeof galleryData.createHrPayrollGalleryData, "function", "a leitura direta SharePoint da folha precisa estar disponível");
  const calls = [];
  const repository = {
    async resolveList(siteKey, aliases) {
      calls.push(["resolveList", siteKey, aliases]);
      return { status: "resolved", id: `list-${aliases[0]}` };
    },
    async getItemsPage(siteKey, listId, query, options) {
      calls.push(["getItemsPage", siteKey, listId, query, options]);
      if (listId === "list-IDFOLHA") return {
        items: [{ id: "12", fields: { "MÊS REFERÊNCIA": "09/2026", FORNECEDOR: { LookupValue: "EDGAR" } } }],
        nextLink: "idfolha-next", hasMore: true,
      };
      return {
        items: [{ id: "81", fields: {
          FORNECEDOR: "EDGAR", TIPOPGTO: "SALÁRIO", VALORUNITARIO: 1200,
          QTD: 1, DATA: "2026-09-28T00:00:00Z", IDFOLHA: 12, IDLANCAMENTO: 3456,
        } }],
        nextLink: "", hasMore: false,
      };
    },
  };
  const data = galleryData.createHrPayrollGalleryData({ repository });

  const first = await data.loadPage("IDFOLHA", { page: 1, pageSize: 25 });
  const next = await data.loadPage("IDFOLHA", { page: 2, pageSize: 25, cursor: first.nextCursor });
  const payroll = await data.loadPage("FOLHAPGTO", { page: 1, pageSize: 25 });

  assert.deepEqual(first.rows, [{ id: "12", MESREFERENCIA: "09/2026", FORNECEDOR: "EDGAR" }]);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, "idfolha-next");
  assert.equal(next.page, 2);
  assert.deepEqual(payroll.rows, [{
    id: "81", FORNECEDOR: "EDGAR", TIPOPGTO: "SALÁRIO", VALORUNITARIO: 1200,
    QTD: 1, DATA: "2026-09-28T00:00:00Z", IDFOLHA: 12, IDLANCAMENTO: 3456,
  }]);
  assert.deepEqual(calls, [
    ["resolveList", "personal", ["IDFOLHA"]],
    ["getItemsPage", "personal", "list-IDFOLHA", "$select=id&$expand=fields($select=MESREFERENCIA,FORNECEDOR)&$top=25", { pageNumber: 1, maxPages: 100 }],
    ["getItemsPage", "personal", "list-IDFOLHA", "$select=id&$expand=fields($select=MESREFERENCIA,FORNECEDOR)&$top=25", { pageNumber: 2, maxPages: 100, cursor: "idfolha-next" }],
    ["resolveList", "personal", ["FOLHAPGTO"]],
    ["getItemsPage", "personal", "list-FOLHAPGTO", "$select=id&$expand=fields($select=FORNECEDOR,TIPOPGTO,VALORUNITARIO,QTD,DATA,IDFOLHA,IDLANCAMENTO)&$top=25", { pageNumber: 1, maxPages: 100 }],
  ]);
});

test("galeria de folha recusa lista e parâmetros fora da allowlist", async () => {
  assert.equal(typeof galleryData.createHrPayrollGalleryData, "function", "a fábrica da galeria precisa estar disponível");
  const data = galleryData.createHrPayrollGalleryData({ repository: {
    async resolveList() { return { status: "resolved", id: "list" }; },
    async getItemsPage() { return { items: [], hasMore: false }; },
  } });
  await assert.rejects(data.loadPage("LANÇAMENTOS"), /galeria de folha/i);
  await assert.rejects(data.loadPage("IDFOLHA", { page: 0 }), /página/i);
  await assert.rejects(data.loadPage("FOLHAPGTO", { pageSize: 100 }), /página/i);
});

test("relatório da folha filtra no SharePoint pelo IDFOLHA e pagina todos os pagamentos", async () => {
  const calls = [];
  const repository = {
    async resolveList(siteKey, aliases) {
      calls.push(["resolveList", siteKey, aliases]);
      return { status: "resolved", id: "list-FOLHAPGTO" };
    },
    async getItemsPage(siteKey, listId, query, options) {
      calls.push(["getItemsPage", siteKey, listId, query, options]);
      if (options.pageNumber === 1) return {
        items: [{ id: "81", fields: {
          FORNECEDOR: "EDGAR", TIPOPGTO: "SALÁRIO", VALORUNITARIO: 1200,
          QTD: 1, DATA: "2026-09-28T00:00:00Z", IDFOLHA: 12, IDLANCAMENTO: 3456,
        } }],
        nextLink: "payroll-next", hasMore: true,
      };
      return {
        items: [{ id: "82", fields: {
          FORNECEDOR: "EDGAR", TIPOPGTO: "VALE REFEIÇÃO", VALORUNITARIO: 50,
          QTD: 2, DATA: "2026-09-29T00:00:00Z", IDFOLHA: 12, IDLANCAMENTO: 3457,
        } }],
        nextLink: "", hasMore: false,
      };
    },
  };
  const data = galleryData.createHrPayrollGalleryData({ repository });

  const rows = await data.loadPaymentsForPayrollId("12");

  assert.deepEqual(rows.map(row => row.id), ["81", "82"]);
  assert.deepEqual(rows.map(row => row.IDLANCAMENTO), [3456, 3457]);
  const itemQueries = calls.filter(([operation]) => operation === "getItemsPage");
  assert.equal(itemQueries.length, 2);
  assert.match(itemQueries[0][3], /\$filter=fields\/IDFOLHA eq 12/);
  assert.match(itemQueries[0][3], /fields\(\$select=FORNECEDOR,TIPOPGTO,VALORUNITARIO,QTD,DATA,IDFOLHA,IDLANCAMENTO\)/);
  assert.deepEqual(itemQueries.map(([, , , , options]) => options), [
    { pageNumber: 1, maxPages: 100 },
    { pageNumber: 2, maxPages: 100, cursor: "payroll-next" },
  ]);
  assert.ok(calls.every(([operation]) => ["resolveList", "getItemsPage"].includes(operation)));
});

test("relatório recusa IDFOLHA inválido antes de consultar o SharePoint", async () => {
  let requests = 0;
  const data = galleryData.createHrPayrollGalleryData({ repository: {
    async resolveList() { requests += 1; return { status: "resolved", id: "list" }; },
    async getItemsPage() { requests += 1; return { items: [], hasMore: false }; },
  } });

  await assert.rejects(data.loadPaymentsForPayrollId("12 or fields/IDFOLHA eq 3"), /IDFOLHA/i);
  assert.equal(requests, 0);
});

test("carrega a lista Screen10 autenticada, percorre páginas e normaliza os campos dos pedidos", async () => {
  const { repository, calls } = repositoryHarness();
  const signal = new AbortController().signal;
  const gallery = createOrdersGalleryData({ repository });

  const snapshot = await gallery.loadSnapshot({ signal });

  assert.equal(snapshot.listName, "NOTASPENDENTES");
  assert.equal(snapshot.rows.length, 3);
  assert.deepEqual(snapshot.rows.map(row => row.id), ["320", "319", "318"]);
  assert.equal(snapshot.rows[0].fields.FORNECEDOR, "COFER");
  assert.equal(snapshot.rows[0].fields["NOTA FISCAL"], "NF-55");
  assert.equal(snapshot.rows[0].fields.VALORTOTAL, 765.6);
  assert.equal(snapshot.rows[0].fields["Criado por"], "Bernardo Notini");
  assert.equal(snapshot.rows[0].hasAttachments, true);
  assert.equal(snapshot.rows[2].hasAttachments, false);
  assert.equal(calls.filter(([name]) => name === "getItemsPage").length, 2);
  assert.equal(calls[0][1], "personal");
  assert.deepEqual(calls[0][2], ["NOTASPENDENTES"]);
  assert.equal(calls[1][1], "personal");
  assert.equal(calls[1][2], "list-notas");
  assert.equal(calls[1][4].signal, signal);
});

test("busca o cabeçalho NOTASPENDENTES diretamente pelo ID em vez de paginar a lista", async () => {
  const calls = [];
  const repository = {
    async resolveList(...args) { calls.push(["resolveList", ...args]); return { status: "resolved", id: "list-notas" }; },
    async getItem(...args) {
      calls.push(["getItem", ...args]);
      return { id: "338", fields: { FORNECEDOR: "EDGAR", VALORTOTAL: 905, STATUS: "PENDENTE AUDITORIA" } };
    },
    async getItemsPage(...args) { calls.push(["getItemsPage", ...args]); return { items: [], hasMore: false }; },
  };
  const data = createOrdersGalleryData({ repository });
  const signal = new AbortController().signal;

  assert.equal(typeof data.loadItem, "function");
  const item = await data.loadItem("338", { signal });

  assert.deepEqual(item, {
    id: "338", fields: { FORNECEDOR: "EDGAR", VALORTOTAL: 905, STATUS: "PENDENTE AUDITORIA" }, hasAttachments: null,
  });
  assert.deepEqual(calls, [
    ["resolveList", "personal", ["NOTASPENDENTES"], { signal }],
    ["getItem", "personal", "list-notas", "338", "$expand=fields", { signal }],
  ]);
});

test("pedido ausente retorna vazio na consulta pontual, mas outros erros SharePoint continuam visíveis", async () => {
  const data = createOrdersGalleryData({ repository: {
    async resolveList() { return { status: "resolved", id: "list-notas" }; },
    async getItem(_site, _list, id) {
      if (id === "338") throw Object.assign(new Error("Item ausente"), { status: 404 });
      throw new Error("Falha de rede");
    },
    async getItemsPage() { return { items: [], hasMore: false }; },
  } });

  assert.equal(await data.loadItem("338"), null);
  await assert.rejects(data.loadItem("339"), /Falha de rede/);
});

test("filtra LANCAMENTOS por AGRUPAR no SharePoint e pagina somente as linhas correspondentes", async () => {
  assert.equal(typeof galleryData.createLaunchClusterData, "function", "a leitura delegável de AGRUPAR precisa estar disponível");
  const calls = [];
  const signal = new AbortController().signal;
  const pages = [
    { items: [
      { id: "3451", fields: { AGRUPAR: "338", FORNECEDOR: "EDGAR", "VALOR TOTAL": 905 } },
      { id: "3450", fields: { AGRUPAR: "339", FORNECEDOR: "OUTRO" } },
    ], nextLink: "launch-next", hasMore: true },
    { items: [{ id: "3449", fields: { AGRUPAR: "338", FORNECEDOR: "EDGAR", "VALOR TOTAL": 100 } }], nextLink: "", hasMore: false },
  ];
  const repository = {
    async resolveList(...args) { calls.push(["resolveList", ...args]); return { status: "resolved", id: "list-lancamentos" }; },
    async getItemsPage(...args) { calls.push(["getItemsPage", ...args]); return pages.shift(); },
  };
  const data = galleryData.createLaunchClusterData({ repository });

  const rows = await data.loadGroup("338", { signal });

  assert.deepEqual(rows.map(row => row.id), ["3451", "3449"]);
  assert.deepEqual(calls, [
    ["resolveList", "personal", ["LANCAMENTOS"], { signal }],
    ["getItemsPage", "personal", "list-lancamentos", "$select=id&$expand=fields&$filter=fields/AGRUPAR eq '338'&$top=100", { pageNumber: 1, maxPages: 100, headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" }, signal }],
    ["getItemsPage", "personal", "list-lancamentos", "$select=id&$expand=fields&$filter=fields/AGRUPAR eq '338'&$top=100", { pageNumber: 2, maxPages: 100, cursor: "launch-next", headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" }, signal }],
  ]);
});

test("recusa valores de AGRUPAR que não são IDs numéricos antes de consultar o SharePoint", async () => {
  assert.equal(typeof galleryData.createLaunchClusterData, "function", "a leitura delegável de AGRUPAR precisa estar disponível");
  const calls = [];
  const data = galleryData.createLaunchClusterData({ repository: {
    async resolveList(...args) { calls.push(args); return { status: "resolved", id: "list-lancamentos" }; },
    async getItemsPage(...args) { calls.push(args); return { items: [], hasMore: false }; },
  } });

  await assert.rejects(data.loadGroup("338' or ID ne 0"), /AGRUPAR|ID/i);
  assert.deepEqual(calls, []);
});

test("reabrir popup após cancelar descoberta de LANCAMENTOS não reutiliza promessa abortada", async () => {
  const firstController = new AbortController();
  const secondController = new AbortController();
  let discoveryStarted;
  const started = new Promise(resolve => { discoveryStarted = resolve; });
  let resolves = 0;
  let pageReads = 0;
  const data = galleryData.createLaunchClusterData({ repository: {
    resolveList(_site, _aliases, { signal } = {}) {
      resolves += 1;
      if (resolves === 1) return new Promise((resolve, reject) => {
        discoveryStarted();
        signal.addEventListener("abort", () => reject(signal.reason || new DOMException("Cancelado", "AbortError")), { once: true });
      });
      return Promise.resolve({ status: "resolved", id: "list-lancamentos" });
    },
    async getItemsPage() {
      pageReads += 1;
      return { items: [{ id: "3451", fields: { AGRUPAR: "338" } }], hasMore: false };
    },
  } });

  const first = data.loadGroup("338", { signal: firstController.signal });
  await started;
  firstController.abort();
  const reopened = data.loadGroup("338", { signal: secondController.signal });

  await assert.rejects(first, error => error.name === "AbortError");
  assert.deepEqual((await reopened).map(item => item.id), ["3451"]);
  assert.equal(resolves, 2);
  assert.equal(pageReads, 1);
});

test("integra o popup ao Graph e envia Prefer apenas no filtro OData não indexado de AGRUPAR", async () => {
  const scopes = [];
  const urls = [];
  const requests = [];
  const tokenProvider = async requested => { scopes.push(requested); return "sharepoint-token"; };
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    urls.push(parsed);
    requests.push({ url: parsed, headers: init.headers || {} });
    if (parsed.pathname.includes("/sites/energeticaltda-my.sharepoint.com:")) {
      return Response.json({ id: "site-personal" });
    }
    if (parsed.pathname.endsWith("/lists") && !parsed.pathname.includes("/items")) {
      return Response.json({ value: [
        { id: "list-notas", displayName: "NOTASPENDENTES", list: { template: "genericList" } },
        { id: "list-lancamentos", displayName: "LANCAMENTOS", list: { template: "genericList" } },
      ] });
    }
    if (parsed.pathname.endsWith("/lists/list-notas/items/338")) {
      return Response.json({ id: "338", fields: { FORNECEDOR: "EDGAR", VALORTOTAL: 905 } });
    }
    if (parsed.pathname.endsWith("/lists/list-lancamentos/items")) {
      assert.equal(parsed.searchParams.get("$filter"), "fields/AGRUPAR eq '338'");
      assert.equal(parsed.searchParams.get("$top"), "100");
      assert.equal(init.headers?.Prefer, "HonorNonIndexedQueriesWarningMayFailRandomly");
      return Response.json({ value: [{ id: "3451", fields: { AGRUPAR: "338", FORNECEDOR: "EDGAR" } }] });
    }
    throw new Error(`URL Graph inesperada: ${parsed.pathname}${parsed.search}`);
  };
  const data = createOrdersGalleryData({ tokenProvider, fetchImpl });

  const order = await data.loadItem("338");
  const launches = await data.loadLaunchGroup("338");

  assert.equal(order.id, "338");
  assert.deepEqual(launches.map(item => item.id), ["3451"]);
  assert.ok(scopes.length > 0);
  assert.ok(scopes.every(requested => requested.includes("Sites.Read.All")));
  assert.ok(urls.some(url => url.pathname.endsWith("/lists/list-notas/items/338")));
  assert.ok(urls.some(url => url.searchParams.get("$filter") === "fields/AGRUPAR eq '338'"));
  assert.equal(requests.find(request => request.url.pathname.endsWith("/lists/list-notas/items/338"))?.headers?.Prefer, undefined);
});

test("lista e baixa anexos do pedido usando a API SharePoint com o ID do item", async () => {
  const { repository, calls } = repositoryHarness();
  const gallery = createOrdersGalleryData({ repository });

  const attachments = await gallery.listAttachments("320");
  const file = await gallery.downloadAttachment("320", "pedido.pdf");

  assert.deepEqual(attachments.map(({ fileName, mimeType, size }) => ({ fileName, mimeType, size })), [
    { fileName: "pedido.pdf", mimeType: "application/pdf", size: 2048 },
    { fileName: "foto.jpg", mimeType: "image/jpeg", size: 4096 },
  ]);
  assert.equal(file.type, "application/pdf");
  assert.equal(file.size, 5);
  assert.deepEqual(calls.filter(([name]) => name === "listAttachments")[0].slice(1, 4), ["personal", "list-notas", "320"]);
  assert.deepEqual(calls.filter(([name]) => name === "downloadAttachment")[0].slice(1, 5), ["personal", "list-notas", "320", "pedido.pdf"]);
});

test("atualiza somente a data prevista da provisão com o ETag atual", async () => {
  const calls = [];
  const repository = {
    async resolveList(...args) { calls.push(["resolveList", ...args]); return { status: "resolved", id: "list-provisions" }; },
    async getItemsPage() { return { items: [], hasMore: false }; },
    async getItem(...args) { calls.push(["getItem", ...args]); return { id: "306", eTag: "etag-306", fields: { FORNECEDOR: "DIBRITA" } }; },
    async getColumns(...args) { calls.push(["getColumns", ...args]); return [
      { name: "Title", displayName: "Título", readOnly: false },
      { name: "Data_x0020_Previsto_x0020_PGTO", displayName: "DATA PREVISTO PGTO", readOnly: false },
      { name: "STATUS", displayName: "STATUS", readOnly: false },
    ]; },
    async updateItem(...args) { calls.push(["updateItem", ...args]); return { id: "306" }; },
  };
  const data = createPendingProvisionAttachmentsData({ repository });

  await data.updateDueDate("306", "2026-10-07");

  const update = calls.find(([name]) => name === "updateItem");
  assert.deepEqual(update.slice(1, 4), ["personal", "list-provisions", "306"]);
  assert.deepEqual(Object.keys(update[4]), ["Data_x0020_Previsto_x0020_PGTO"]);
  assert.match(update[4].Data_x0020_Previsto_x0020_PGTO, /^2026-10-07T/);
  assert.equal(update[5].eTag, "etag-306");
});

test("recusa datas impossíveis e nunca atualiza sem ETag", async () => {
  let updates = 0;
  const repository = {
    async resolveList() { return { status: "resolved", id: "list-provisions" }; },
    async getItemsPage() { return { items: [], hasMore: false }; },
    async getItem() { return { id: "306", fields: {} }; },
    async getColumns() { return [{ name: "DATA_PREVISTO_PGTO", displayName: "Data Previsto Pgto", readOnly: false }]; },
    async updateItem() { updates += 1; },
  };
  const data = createPendingProvisionAttachmentsData({ repository });

  await assert.rejects(data.updateDueDate("306", "2026-02-29"), /data/i);
  await assert.rejects(data.updateDueDate("306", "2026-10-07"), /ETag|versão/i);
  await assert.rejects(data.updateDueDate("../306", "2026-10-07"), /ID/i);
  assert.equal(updates, 0);
});

test("upload da provisão invalida o cache de anexos e permite reler do SharePoint", async () => {
  let listed = 0;
  const calls = [];
  const repository = {
    async resolveList() { return { status: "resolved", id: "list-provisions" }; },
    async getItemsPage() { return { items: [], hasMore: false }; },
    async listAttachments(...args) { calls.push(["listAttachments", ...args]); listed += 1; return listed === 1 ? [] : [{ name: "novo.pdf", size: 12 }]; },
    async uploadAttachment(...args) { calls.push(["uploadAttachment", ...args]); return { name: "novo.pdf" }; },
  };
  const data = createPendingProvisionAttachmentsData({ repository });
  const file = new File(["conteúdo"], "novo.pdf", { type: "application/pdf" });

  assert.deepEqual(await data.listAttachments("306"), []);
  await data.uploadAttachment("306", file);
  const refreshed = await data.listAttachments("306");

  assert.equal(refreshed[0].fileName, "novo.pdf");
  assert.equal(calls.filter(([name]) => name === "listAttachments").length, 2);
  assert.deepEqual(calls.find(([name]) => name === "uploadAttachment").slice(1, 4), ["personal", "list-provisions", "306"]);
  assert.equal(calls.find(([name]) => name === "uploadAttachment")[4], file);
});

test("não inventa uma lista nem vaza erro interno quando NOTASPENDENTES não existe", async () => {
  const { repository } = repositoryHarness({
    async resolveList() { return { status: "missing", aliases: ["NOTASPENDENTES"] }; },
  });
  const gallery = createOrdersGalleryData({ repository });

  await assert.rejects(gallery.loadSnapshot(), error => {
    assert.ok(error instanceof OrdersGalleryDataError);
    assert.equal(error.code, "orders_list_missing");
    assert.match(error.message, /NOTASPENDENTES/);
    assert.doesNotMatch(error.message, /stack|token|https?:/i);
    return true;
  });
});

test("mantém presença de anexos desconhecida quando Graph não informa essa coluna", async () => {
  const { repository } = repositoryHarness({
    async getItemsPage() { return { items: [{ id: "400", fields: { FORNECEDOR: "COFER" } }], hasMore: false }; },
  });
  const gallery = createOrdersGalleryData({ repository });
  const snapshot = await gallery.loadSnapshot();
  assert.equal(snapshot.rows[0].hasAttachments, null);
});

test("usa o autor humano do item antes do campo SharePoint e não exibe a conta técnica", async () => {
  const { repository } = repositoryHarness({
    async getItemsPage() {
      return { items: [
        {
          id: "401",
          createdBy: { user: { displayName: "Bernardo Notini" } },
          lastModifiedBy: { user: { displayName: "Ana Souza" } },
          fields: { "Criado por": "SharePoint App", "Modificado por": "SharePoint App" },
        },
        {
          id: "402",
          createdBy: { application: { displayName: "SharePoint App" } },
          fields: { "Criado por": 1073741822 },
        },
        {
          id: "403",
          createdBy: { user: { id: "user-403" } },
          fields: { "Criado por": "Rafael Gontijo" },
        },
      ], hasMore: false };
    },
  });
  const gallery = createOrdersGalleryData({ repository });
  const snapshot = await gallery.loadSnapshot();

  assert.equal(snapshot.rows.find(row => row.id === "401").fields["Criado por"], "Bernardo Notini");
  assert.equal(snapshot.rows.find(row => row.id === "401").fields["Modificado por"], "Ana Souza");
  assert.equal(snapshot.rows.find(row => row.id === "402").fields["Criado por"], "Usuário não identificado");
  assert.equal(snapshot.rows.find(row => row.id === "403").fields["Criado por"], "Rafael Gontijo");
});

test("usa Graph Sites.Read.All para listar itens pela origem SharePoint configurada", async () => {
  const requestedScopes = [];
  const tokenProvider = async scopes => { requestedScopes.push(scopes); return "test-token"; };
  const fetchImpl = async url => {
    const value = String(url);
    if (value.includes("/sites/energeticaltda-my.sharepoint.com:")) return Response.json({ id: "site-personal" });
    if (value.includes("/lists?") && !value.includes("/items?")) return Response.json({ value: [{ id: "list-notas", displayName: "NOTASPENDENTES", list: { template: "genericList" } }] });
    if (value.includes("/lists/list-notas/items?")) return Response.json({ value: [{ id: "320", fields: { FORNECEDOR: "COFER" } }] });
    throw new Error(`Unexpected URL: ${value}`);
  };
  const gallery = createOrdersGalleryData({ tokenProvider, fetchImpl });

  const snapshot = await gallery.loadSnapshot();

  assert.equal(snapshot.rows[0].fields.FORNECEDOR, "COFER");
  assert.ok(requestedScopes.length > 0);
  assert.ok(requestedScopes.every(scopes => scopes.includes("Sites.Read.All")));
});
