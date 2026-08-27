import assert from "node:assert/strict";
import test from "node:test";

import { createSharePointRepository } from "../portal/data/sharepoint-repository.js";

const personalSite = Object.freeze({
  host: "energeticaltda-my.sharepoint.com",
  path: "/personal/bernardonotini_energeticabr_com",
  readTransport: "rest",
  writeTransport: "rest",
});

const listId = "11111111-1111-1111-1111-111111111111";
const relatedListId = "22222222-2222-2222-2222-222222222222";
const siteOrigin = `https://${personalSite.host}${personalSite.path}`;
const itemCollectionPath = `/_api/web/lists(guid'${listId}')/items`;

function createForbiddenGraph() {
  const calls = [];
  return {
    calls,
    async request(path, options = {}) {
      calls.push({ path, options });
      throw new Error(`O site pessoal nao pode depender do Microsoft Graph: ${path}`);
    },
  };
}

function createRestTransport(handler) {
  const calls = [];
  return {
    calls,
    async request(site, path, options = {}) {
      calls.push({ site, path, options });
      assert.equal(site, personalSite);
      return handler(path, options, calls.length);
    },
  };
}

function createRepository(handler) {
  const graph = createForbiddenGraph();
  const restTransport = createRestTransport(handler);
  return {
    graph,
    restTransport,
    repository: createSharePointRepository(
      graph,
      { personal: personalSite },
      { restTransport },
    ),
  };
}

function requestBody(options) {
  if (typeof options.body === "string") return JSON.parse(options.body);
  return options.body;
}

function decodedPath(path) {
  return decodeURIComponent(String(path));
}

function restItem(id, fields, eTag = `"${id},1"`) {
  return {
    ID: Number(id),
    ...fields,
    __metadata: { id: `${siteOrigin}${itemCollectionPath}(${id})`, etag: eTag, type: "SP.Data.LANCAMENTOSListItem" },
  };
}

function expectedItem(id, fields, eTag = `"${id},1"`) {
  return { id: String(id), eTag, fields: { ID: Number(id), ...fields } };
}

test("o site pessoal descobre todas as listas REST paginadas sem consultar Graph", async () => {
  const collectionPath = "/_api/web/lists?$select=Id,Title,Hidden,BaseTemplate,RootFolder/ServerRelativeUrl&$expand=RootFolder&$filter=Hidden%20eq%20false%20and%20BaseTemplate%20eq%20100";
  const nextLink = `${siteOrigin}${collectionPath}&$skiptoken=Paged%3DTRUE%26p_ID%3D1`;
  const { repository, graph, restTransport } = createRepository((path, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.permission, "read");
    if (path === collectionPath) {
      return {
        value: [{
          Id: listId,
          Title: "LANCAMENTOS",
          Hidden: false,
          BaseTemplate: 100,
          RootFolder: { ServerRelativeUrl: `${personalSite.path}/Lists/LANCAMENTOS` },
        }],
        "@odata.nextLink": nextLink,
      };
    }
    if (path === nextLink) {
      return {
        value: [{
          Id: relatedListId,
          Title: "FILIAIS",
          Hidden: false,
          BaseTemplate: 100,
          RootFolder: { ServerRelativeUrl: `${personalSite.path}/Lists/FILIAIS` },
        }],
      };
    }
    throw new Error(`Rota REST inesperada: ${path}`);
  });

  const lists = await repository.listLists("personal");

  assert.deepEqual(lists.map(list => ({ id: list.id, displayName: list.displayName })), [
    { id: listId, displayName: "LANCAMENTOS" },
    { id: relatedListId, displayName: "FILIAIS" },
  ]);
  assert.equal(restTransport.calls.length, 2);
  assert.equal(graph.calls.length, 0);
});

test("as colunas REST preservam obrigatoriedade, choices e metadados de lookup", async () => {
  const { repository, graph, restTransport } = createRepository((path, options) => {
    assert.match(path, new RegExp(`^/_api/web/lists\\(guid'${listId}'\\)/fields\\?`));
    assert.equal(options.method, "GET");
    assert.equal(options.permission, "read");
    return {
      value: [
        {
          InternalName: "Title",
          Title: "Descricao",
          Indexed: true,
          Hidden: false,
          ReadOnlyField: false,
          Required: true,
          TypeAsString: "Text",
        },
        {
          InternalName: "STATUS",
          Title: "Status",
          Indexed: true,
          Hidden: false,
          ReadOnlyField: false,
          Required: true,
          TypeAsString: "Choice",
          Choices: { results: ["ATIVO", "PENDENTE", "FINALIZADO"] },
          AllowMultipleValues: false,
        },
        {
          InternalName: "FILIAL",
          Title: "Filial",
          Indexed: true,
          Hidden: false,
          ReadOnlyField: false,
          Required: true,
          TypeAsString: "Lookup",
          LookupList: `{${relatedListId}}`,
          LookupField: "Title",
          AllowMultipleValues: false,
        },
      ],
    };
  });

  const columns = await repository.getColumns("personal", listId);
  const title = columns.find(column => column.name === "Title");
  const status = columns.find(column => column.name === "STATUS");
  const filial = columns.find(column => column.name === "FILIAL");

  assert.equal(title.required, true);
  assert.deepEqual(status.choice, {
    choices: ["ATIVO", "PENDENTE", "FINALIZADO"],
    allowMultipleValues: false,
  });
  assert.equal(status.required, true);
  assert.deepEqual(filial.lookup, {
    listId: relatedListId,
    columnName: "Title",
    allowMultipleValues: false,
  });
  assert.equal(filial.required, true);
  assert.equal(restTransport.calls.length, 1);
  assert.equal(graph.calls.length, 0);
});

test("a listagem incremental usa REST, normaliza itens e continua pelo nextLink da mesma colecao", async () => {
  const nextLink = `${siteOrigin}${itemCollectionPath}?$skiptoken=Paged%3DTRUE%26p_ID%3D1`;
  const { repository, graph, restTransport } = createRepository((path, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.permission, "read");
    if (path === nextLink) {
      return { value: [restItem(2, { Title: "PEDIDO 2", STATUS: "PENDENTE" }, '"2,4"')] };
    }
    assert.match(path, new RegExp(`^${itemCollectionPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?`));
    assert.doesNotMatch(path, /\$expand=fields/);
    return {
      value: [restItem(1, { Title: "PEDIDO 1", STATUS: "ATIVO" }, '"1,3"')],
      "@odata.nextLink": nextLink,
    };
  });

  const first = await repository.getItemsPage("personal", listId, "$expand=fields&$top=1", { pageNumber: 1 });
  const second = await repository.getItemsPage("personal", listId, "$expand=fields&$top=1", {
    pageNumber: 2,
    cursor: first.nextLink,
  });

  assert.deepEqual(first, {
    items: [expectedItem(1, { Title: "PEDIDO 1", STATUS: "ATIVO" }, '"1,3"')],
    nextLink,
    hasMore: true,
    batchCount: 1,
  });
  assert.deepEqual(second, {
    items: [expectedItem(2, { Title: "PEDIDO 2", STATUS: "PENDENTE" }, '"2,4"')],
    nextLink: "",
    hasMore: false,
    batchCount: 1,
  });
  assert.equal(restTransport.calls.length, 2);
  assert.equal(graph.calls.length, 0);
});

test("getItems percorre todas as paginas REST e nao perde registros", async () => {
  const nextLink = `${siteOrigin}${itemCollectionPath}?$skiptoken=Paged%3DTRUE%26p_ID%3D2`;
  const { repository, graph, restTransport } = createRepository(path => {
    if (path === nextLink) {
      return { value: [restItem(3, { Title: "TERCEIRO" }, '"3,2"')] };
    }
    if (path.startsWith(itemCollectionPath)) {
      return {
        value: [
          restItem(1, { Title: "PRIMEIRO" }),
          restItem(2, { Title: "SEGUNDO" }),
        ],
        "odata.nextLink": nextLink,
      };
    }
    throw new Error(`Rota REST inesperada: ${path}`);
  });

  const items = await repository.getItems("personal", listId, "$expand=fields&$top=2");

  assert.deepEqual(items, [
    expectedItem(1, { Title: "PRIMEIRO" }),
    expectedItem(2, { Title: "SEGUNDO" }),
    expectedItem(3, { Title: "TERCEIRO" }, '"3,2"'),
  ]);
  assert.equal(restTransport.calls.length, 2);
  assert.equal(graph.calls.length, 0);
});

test("a busca estruturada consulta campos REST, combina resultados e elimina duplicidades", async () => {
  const { repository, graph, restTransport } = createRepository(path => {
    assert.match(path, new RegExp(`^${itemCollectionPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?`));
    const decoded = decodedPath(path);
    assert.match(decoded, /startswith\((?:Title|FORNECEDOR),'AC'\)/);
    const titleSearch = decoded.includes("startswith(Title,'AC')");
    const supplierSearch = decoded.includes("startswith(FORNECEDOR,'AC')");
    if (titleSearch && supplierSearch) {
      return { value: [
        restItem(1, { Title: "ACABAMENTO", FORNECEDOR: "BETA" }),
        restItem(2, { Title: "PISO", FORNECEDOR: "ACME" }),
      ] };
    }
    if (titleSearch) return { value: [restItem(1, { Title: "ACABAMENTO", FORNECEDOR: "BETA" })] };
    if (supplierSearch) return { value: [restItem(2, { Title: "PISO", FORNECEDOR: "ACME" })] };
    throw new Error(`Filtro REST inesperado: ${decoded}`);
  });

  const page = await repository.searchItemsPage("personal", listId, {
    fields: ["Title", "FORNECEDOR"],
    term: "AC",
    pageSize: 20,
  });

  assert.deepEqual(page.items, [
    expectedItem(1, { Title: "ACABAMENTO", FORNECEDOR: "BETA" }),
    expectedItem(2, { Title: "PISO", FORNECEDOR: "ACME" }),
  ]);
  assert.equal(page.nextLink, "");
  assert.equal(page.hasMore, false);
  assert.ok(restTransport.calls.length >= 1);
  assert.equal(graph.calls.length, 0);
});

test("os filtros de galeria sao derivados de todas as paginas REST e ordenados sem duplicatas", async () => {
  const nextLink = `${siteOrigin}${itemCollectionPath}?$skiptoken=Paged%3DTRUE%26p_ID%3D2`;
  const { repository, graph, restTransport } = createRepository(path => {
    if (path === nextLink) {
      return { value: [restItem(3, { FILIAL: { LookupId: 2, LookupValue: "002 - OURO PRETO" }, STATUS: "ATIVO" })] };
    }
    if (path.startsWith(itemCollectionPath)) {
      return {
        value: [
          restItem(1, { FILIAL: { LookupId: 1, LookupValue: "001 - CENTRAL" }, STATUS: "PENDENTE" }),
          restItem(2, { FILIAL: { LookupId: 2, LookupValue: "002 - OURO PRETO" }, STATUS: "ATIVO" }),
        ],
        "@odata.nextLink": nextLink,
      };
    }
    throw new Error(`Rota REST inesperada: ${path}`);
  });

  const values = await repository.getFilterOptionValues("personal", listId, ["FILIAL", "STATUS"]);

  assert.deepEqual(values, {
    FILIAL: ["001 - CENTRAL", "002 - OURO PRETO"],
    STATUS: ["ATIVO", "PENDENTE"],
  });
  assert.equal(restTransport.calls.length, 2);
  assert.equal(graph.calls.length, 0);
});

test("o detalhe de item vem do REST com campos e ETag no contrato usado pelo portal", async () => {
  const { repository, graph, restTransport } = createRepository((path, options) => {
    assert.match(path, new RegExp(`^${itemCollectionPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\(7\\)(?:\\?|$)`));
    assert.equal(options.method, "GET");
    assert.equal(options.permission, "read");
    return restItem(7, { Title: "CONCRETO", STATUS: "ATIVO", VALOR: 1250.5 }, '"7,5"');
  });

  const item = await repository.getItem("personal", listId, "7", "$expand=fields");

  assert.deepEqual(item, expectedItem(7, { Title: "CONCRETO", STATUS: "ATIVO", VALOR: 1250.5 }, '"7,5"'));
  assert.equal(restTransport.calls.length, 1);
  assert.equal(graph.calls.length, 0);
});

test("criacao, edicao com ETag e exclusao usam somente REST e preservam o contrato de item", async () => {
  let stored;
  const { repository, graph, restTransport } = createRepository((path, options) => {
    if (path === itemCollectionPath && options.method === "POST") {
      const body = requestBody(options);
      assert.equal(body.fields, undefined);
      stored = restItem(8, { Title: body.Title, STATUS: body.STATUS }, '"8,1"');
      return stored;
    }
    if (path === `${itemCollectionPath}(8)` && options.headers?.["X-HTTP-Method"] === "MERGE") {
      assert.equal(options.method, "POST");
      assert.equal(options.permission, "write");
      assert.equal(options.headers["IF-MATCH"] ?? options.headers["If-Match"], '"8,1"');
      const body = requestBody(options);
      stored = restItem(8, { Title: body.Title, STATUS: body.STATUS }, '"8,2"');
      return undefined;
    }
    if (path.startsWith(`${itemCollectionPath}(8)`) && options.method === "GET") return stored;
    if (path === `${itemCollectionPath}(8)` && options.headers?.["X-HTTP-Method"] === "DELETE") {
      assert.equal(options.method, "POST");
      assert.equal(options.permission, "write");
      assert.equal(options.headers["IF-MATCH"] ?? options.headers["If-Match"], '"8,2"');
      stored = undefined;
      return undefined;
    }
    throw new Error(`Operacao REST inesperada: ${options.method || "GET"} ${path}`);
  });

  const created = await repository.createItem("personal", listId, { Title: "NOVO", STATUS: "PENDENTE" });
  const updated = await repository.updateItem(
    "personal",
    listId,
    created.id,
    { Title: "REVISADO", STATUS: "ATIVO" },
    { eTag: created.eTag },
  );
  const deleted = await repository.deleteItem("personal", listId, updated.id, { eTag: updated.eTag });

  assert.deepEqual(created, expectedItem(8, { Title: "NOVO", STATUS: "PENDENTE" }, '"8,1"'));
  assert.deepEqual(updated, expectedItem(8, { Title: "REVISADO", STATUS: "ATIVO" }, '"8,2"'));
  assert.equal(deleted, undefined);
  assert.equal(stored, undefined);
  assert.equal(restTransport.calls.length, 4);
  assert.equal(graph.calls.length, 0);
});

test("a paginacao REST rejeita cursor externo antes de enviar qualquer requisicao", async () => {
  const { repository, graph, restTransport } = createRepository(() => {
    throw new Error("Nenhuma requisicao deve ser enviada para cursor externo.");
  });

  await assert.rejects(
    repository.getItemsPage("personal", listId, "$expand=fields&$top=20", {
      pageNumber: 2,
      cursor: "https://evil.example/_api/web/lists/items?$skiptoken=segredo",
    }),
    /cursor|nextLink|pagina/i,
  );
  assert.equal(restTransport.calls.length, 0);
  assert.equal(graph.calls.length, 0);
});
