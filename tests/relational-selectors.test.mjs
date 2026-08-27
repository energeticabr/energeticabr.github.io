import assert from "node:assert/strict";
import test from "node:test";

import { mapSharePointColumns, validateFormValues } from "../portal/data/column-mapper.js";
import { createSharePointRepository } from "../portal/data/sharepoint-repository.js";
import * as dynamicForm from "../portal/ui/dynamic-form.js";

const { formMarkup } = dynamicForm;

const lookupListId = "3f3da72d-4cbb-4d3c-96a6-90bcc9045e25";
const sourceListId = "d9ab61da-aa40-48d7-b4d5-cf8e52bbf1d7";
const site = Object.freeze({
  host: "energeticaltda.sharepoint.com",
  path: "/sites/energetica",
});

function graphResponseSequence(responses) {
  const calls = [];
  return {
    calls,
    async request(path, options = {}) {
      calls.push([path, options]);
      if (!responses.length) throw new Error(`Rota Graph inesperada: ${path}`);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next(path, options) : next;
    },
  };
}

test("metadados Graph preservam a relação necessária ao seletor nominal", () => {
  const mapped = mapSharePointColumns([
    {
      name: "CLIENTE",
      displayName: "Cliente",
      required: true,
      lookup: { listId: lookupListId, columnName: "Title", allowMultipleValues: false },
    },
    {
      name: "RESPONSAVEL",
      displayName: "Responsável",
      personOrGroup: { allowMultipleSelection: false, chooseFromType: "peopleOnly" },
    },
  ], { id: "pedidos" });

  assert.deepEqual(mapped[0].relation, {
    kind: "lookup",
    listId: lookupListId,
    displayField: "Title",
    multiple: false,
    resolvable: true,
  });
  assert.deepEqual(mapped[1].relation, {
    kind: "person",
    listId: "",
    displayField: "Title",
    multiple: false,
    principalType: "peopleOnly",
    resolvable: true,
  });
});

test("lookup sem lista relacionada ou relação múltipla falha fechado antes do envio", () => {
  const mapped = mapSharePointColumns([
    { name: "CLIENTE", displayName: "Cliente", lookup: { columnName: "Title" } },
    { name: "APROVADORES", displayName: "Aprovadores", personOrGroup: { allowMultipleSelection: true } },
    { name: "GRUPO", displayName: "Grupo", personOrGroup: { chooseFromType: "peopleAndGroups" } },
  ], {});

  assert.equal(mapped[0].relation.resolvable, false);
  assert.equal(mapped[1].relation.resolvable, false);
  assert.equal(mapped[2].relation.resolvable, false);
  const validation = validateFormValues({ CLIENTE: "__UNRESOLVED__", APROVADORES: "__UNRESOLVED__", GRUPO: "__UNRESOLVED__" }, mapped, {}, { mode: "create" });
  assert.match(validation.errors.CLIENTE, /selecione.*Cliente/i);
  assert.match(validation.errors.APROVADORES, /selecione.*Aprovadores/i);
  assert.match(validation.errors.GRUPO, /selecione.*Grupo/i);
  assert.deepEqual(validation.fields, {});
});

test("formulário troca IDs digitáveis por combobox nominal acessível e mantém o ID oculto", () => {
  const markup = formMarkup({
    entity: { title: "Lançamentos" },
    columns: mapSharePointColumns([
      {
        name: "CLIENTE",
        displayName: "Cliente",
        required: true,
        lookup: { listId: lookupListId, columnName: "Title" },
      },
    ]),
    values: { CLIENTELookupId: 42, CLIENTELookupValue: "CONDOMÍNIO BANDEIRANTE" },
  });

  assert.match(markup, /role="combobox"/);
  assert.match(markup, /aria-autocomplete="list"/);
  assert.match(markup, /aria-controls="relation-CLIENTE-options"/);
  assert.match(markup, /role="listbox"/);
  assert.match(markup, /type="hidden" name="CLIENTE" value="42"/);
  assert.match(markup, /type="search"[^>]+value="CONDOMÍNIO BANDEIRANTE"/);
  assert.doesNotMatch(markup, /type="number" name="CLIENTE"/);
  assert.doesNotMatch(markup, /identificador.*SharePoint/i);
});

test("pesquisa lookup usa lista e campo dos metadados, autorização e um único lote de até 20", async () => {
  const graph = graphResponseSequence([
    { id: "company-site" },
    { value: [{ name: "Title", displayName: "Nome", indexed: true, text: {} }] },
    {
      value: [
        { id: "7", fields: { Title: "ANA ALMEIDA" } },
        { id: "9", fields: { Title: "ANA BEATRIZ" } },
      ],
    },
  ]);
  const repository = createSharePointRepository(graph, { company: site });
  const authorizations = [];
  repository.setAuthorizationProvider({
    async authorize(request) { authorizations.push(request); },
  });

  const options = await repository.searchRelationshipOptions("company", sourceListId, {
    kind: "lookup",
    listId: lookupListId,
    displayField: "Title",
    multiple: false,
    resolvable: true,
  }, "ana", { limit: 20 });

  assert.deepEqual(options, [
    { id: 7, label: "ANA ALMEIDA", secondary: "" },
    { id: 9, label: "ANA BEATRIZ", secondary: "" },
  ]);
  assert.equal(authorizations.some(call => call.action === "view" && call.listId === lookupListId), true);
  const searchPath = graph.calls.at(-1)[0];
  assert.match(searchPath, /%24top=20/);
  assert.match(decodeURIComponent(searchPath), /startswith\(fields\/Title,'ana'\)/);
  assert.equal(graph.calls.filter(([path]) => path.includes("/items?")).length, 1);
});

test("pesquisa lookup recusa termo curto, coluna não indexada e continuação em vez de varrer a lista", async () => {
  const shortGraph = graphResponseSequence([]);
  const shortRepository = createSharePointRepository(shortGraph, { company: site });
  await assert.rejects(
    shortRepository.searchRelationshipOptions("company", sourceListId, {
      kind: "lookup", listId: lookupListId, displayField: "Title", multiple: false, resolvable: true,
    }, "a"),
    /pelo menos 2 caracteres/i,
  );
  assert.equal(shortGraph.calls.length, 0);

  const unindexedGraph = graphResponseSequence([
    { id: "company-site" },
    { value: [{ name: "Title", indexed: false, text: {} }] },
  ]);
  const unindexedRepository = createSharePointRepository(unindexedGraph, { company: site });
  await assert.rejects(
    unindexedRepository.searchRelationshipOptions("company", sourceListId, {
      kind: "lookup", listId: lookupListId, displayField: "Title", multiple: false, resolvable: true,
    }, "ana"),
    /indexad[ao]/i,
  );
  assert.equal(unindexedGraph.calls.filter(([path]) => path.includes("/items?")).length, 0);

  const continuedGraph = graphResponseSequence([
    { id: "company-site" },
    { value: [{ name: "Title", indexed: true, text: {} }] },
    {
      value: [{ id: "7", fields: { Title: "ANA" } }],
      "@odata.nextLink": `https://graph.microsoft.com/v1.0/sites/company-site/lists/${lookupListId}/items?$skiptoken=x`,
    },
  ]);
  const continuedRepository = createSharePointRepository(continuedGraph, { company: site });
  await assert.rejects(
    continuedRepository.searchRelationshipOptions("company", sourceListId, {
      kind: "lookup", listId: lookupListId, displayField: "Title", multiple: false, resolvable: true,
    }, "ana"),
    /refine/i,
  );
});

test("pesquisa de pessoa usa usuários do site SharePoint sem criar conta nem alterar Microsoft", async () => {
  const restCalls = [];
  const graph = graphResponseSequence([{ id: "company-site" }]);
  const repository = createSharePointRepository(graph, { company: site }, {
    restTransport: {
      async request(config, path, options) {
        restCalls.push([config, path, options]);
        return {
          value: [
            { Id: 13, Title: "ANA SILVA", Email: "ana@energeticabr.com", LoginName: "i:0#.f|membership|ana@energeticabr.com" },
          ],
        };
      },
    },
  });
  const authorizations = [];
  repository.setAuthorizationProvider({ async authorize(request) { authorizations.push(request); } });

  const options = await repository.searchRelationshipOptions("company", sourceListId, {
    kind: "person", listId: "", displayField: "Title", multiple: false, resolvable: true,
  }, "ana", { limit: 10 });

  assert.deepEqual(options, [{ id: 13, label: "ANA SILVA", secondary: "ana@energeticabr.com" }]);
  assert.equal(authorizations.some(call => call.action === "view" && call.listId === sourceListId), true);
  assert.equal(restCalls.length, 1);
  assert.match(decodeURIComponent(restCalls[0][1]), /\/_api\/web\/siteusers\?/);
  assert.match(decodeURIComponent(restCalls[0][1]), /\$top=10/);
  assert.equal(restCalls[0][2].method, "GET");
  assert.equal(restCalls[0][2].body, undefined);
});

test("repositório não confia em relação de grupo marcada artificialmente como resolvível", async () => {
  let restCalls = 0;
  const repository = createSharePointRepository(graphResponseSequence([]), { company: site }, {
    restTransport: { async request() { restCalls += 1; return { value: [] }; } },
  });

  await assert.rejects(
    repository.searchRelationshipOptions("company", sourceListId, {
      kind: "person",
      listId: "",
      displayField: "Title",
      multiple: false,
      principalType: "peopleAndGroups",
      resolvable: true,
    }, "ana"),
    /pessoa individual|peopleOnly/i,
  );
  assert.equal(restCalls, 0);
});

test("controlador relacional aplica debounce, cancela a consulta anterior e ignora resposta obsoleta", async () => {
  const calls = [];
  const states = [];
  let releaseFirst;
  const firstStarted = new Promise(resolve => { releaseFirst = resolve; });
  const controller = dynamicForm.createRelationshipSearchController({
    debounceMs: 5,
    minLength: 2,
    limit: 20,
    onState(state) { states.push(state); },
    async search(term, { signal, limit }) {
      calls.push({ term, signal, limit });
      if (term === "an") {
        releaseFirst();
        await new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancelada", "AbortError")), { once: true }));
      }
      return [{ id: term === "ana" ? 7 : 8, label: term.toUpperCase(), secondary: "" }];
    },
  });

  controller.input("an");
  await firstStarted;
  controller.input("ana");
  assert.equal(calls[0].signal.aborted, true);
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(calls.map(call => [call.term, call.limit]), [["an", 20], ["ana", 20]]);
  assert.deepEqual(states.at(-1).options, [{ id: 7, label: "ANA", secondary: "" }]);
  assert.equal(states.at(-1).status, "ready");
  controller.dispose();
});

test("controlador não consulta texto curto e falha fechado quando a relação não resolve", async () => {
  let calls = 0;
  const states = [];
  const controller = dynamicForm.createRelationshipSearchController({
    debounceMs: 0,
    minLength: 2,
    onState(state) { states.push(state); },
    async search() { calls += 1; throw new Error("Lista relacionada indisponível"); },
  });

  controller.input("a");
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(calls, 0);
  assert.equal(states.at(-1).status, "too-short");

  controller.input("ana");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls, 1);
  assert.equal(states.at(-1).status, "error");
  assert.match(states.at(-1).message, /indisponível/i);
  assert.deepEqual(states.at(-1).options, []);
  controller.dispose();
});

function relationshipFormFixture(initial = {}) {
  const listeners = new Map();
  const hidden = { name: "CLIENTE", value: String(initial.id || ""), disabled: false };
  const search = {
    value: String(initial.label || ""),
    disabled: false,
    dataset: { relationSearch: "CLIENTE" },
    attributes: new Map(),
    addEventListener(name, listener) { listeners.set(`search:${name}`, listener); },
    removeEventListener(name) { listeners.delete(`search:${name}`); },
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
  const status = { textContent: "" };
  const listbox = {
    innerHTML: "",
    hidden: true,
    addEventListener(name, listener) { listeners.set(`list:${name}`, listener); },
    removeEventListener(name) { listeners.delete(`list:${name}`); },
  };
  const container = {
    dataset: { relationField: "CLIENTE" },
    querySelector(selector) {
      return ({
        "[data-relation-search]": search,
        "[data-relation-value]": hidden,
        "[data-relation-status]": status,
        "[data-relation-options]": listbox,
      })[selector] || null;
    },
  };
  const save = { disabled: false, textContent: "Salvar registro" };
  const cancel = {
    disabled: false,
    addEventListener(name, listener) { listeners.set(`cancel:${name}`, listener); },
    removeEventListener(name) { listeners.delete(`cancel:${name}`); },
  };
  const errors = { textContent: "", hidden: true };
  const form = {
    attributes: new Map(),
    elements: {
      namedItem(name) { return name === "CLIENTE" ? hidden : null; },
      [Symbol.iterator]() { return [hidden, search, save, cancel][Symbol.iterator](); },
    },
    reportValidity() { return true; },
    setAttribute(name, value) { this.attributes.set(name, value); },
    querySelectorAll(selector) { return selector === "[data-relation-field]" ? [container] : []; },
    addEventListener(name, listener) { listeners.set(`form:${name}`, listener); },
    removeEventListener(name) { listeners.delete(`form:${name}`); },
  };
  const root = {
    innerHTML: "",
    querySelector(selector) {
      return ({
        "[data-dynamic-form]": form,
        "[data-form-save]": save,
        "[data-form-cancel]": cancel,
        "[data-form-errors]": errors,
        "[data-form-reload-conflict]": null,
      })[selector] || null;
    },
  };
  return {
    root, hidden, search, status, listbox, errors,
    input(value) { search.value = value; return listeners.get("search:input")?.({ target: search }); },
    choose(index) {
      return listeners.get("list:click")?.({
        target: { closest() { return { dataset: { relationOption: String(index) } }; } },
      });
    },
    submit() { return listeners.get("form:submit")?.({ preventDefault() {} }); },
  };
}

test("formulário pesquisa por nome, seleciona uma opção e envia somente LookupId", async () => {
  const fixture = relationshipFormFixture();
  const submissions = [];
  const columns = mapSharePointColumns([{
    name: "CLIENTE",
    displayName: "Cliente",
    required: true,
    lookup: { listId: lookupListId, columnName: "Title" },
  }], {});
  const controller = dynamicForm.renderDynamicForm(fixture.root, {
    entity: {}, columns, relationshipDebounceMs: 0,
    async relationshipSearch(column, term, options) {
      assert.equal(column.name, "CLIENTE");
      assert.equal(term, "ana");
      assert.equal(options.limit, 20);
      return [{ id: 7, label: "ANA ALMEIDA", secondary: "UNIDADE 101" }];
    },
    async onSubmit(fields, rawValues, labels) { submissions.push({ fields, rawValues, labels }); },
  });

  fixture.input("ana");
  assert.equal(fixture.hidden.value, "__UNRESOLVED__");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(fixture.listbox.innerHTML, /ANA ALMEIDA/);
  assert.match(fixture.listbox.innerHTML, /UNIDADE 101/);
  fixture.choose(0);
  assert.equal(fixture.hidden.value, "7");
  assert.equal(fixture.search.value, "ANA ALMEIDA");

  await fixture.submit();
  assert.deepEqual(submissions, [{
    fields: { CLIENTELookupId: 7 },
    rawValues: { CLIENTE: "7" },
    labels: { CLIENTE: "ANA ALMEIDA" },
  }]);
  controller.cleanup();
});

test("formulário em edição preserva lookup atual como opção fechada já selecionada", async () => {
  const fixture = relationshipFormFixture({ id: 42, label: "CONDOMÍNIO BANDEIRANTE" });
  const submissions = [];
  const columns = mapSharePointColumns([{
    name: "CLIENTE",
    displayName: "Cliente",
    required: true,
    lookup: { listId: lookupListId, columnName: "Title" },
  }], {});
  const controller = dynamicForm.renderDynamicForm(fixture.root, {
    entity: {},
    columns,
    mode: "edit",
    values: { CLIENTELookupId: 42, CLIENTELookupValue: "CONDOMÍNIO BANDEIRANTE" },
    relationshipLabels: { CLIENTE: "CONDOMÍNIO BANDEIRANTE" },
    async relationshipSearch() { throw new Error("não deve pesquisar para manter a seleção atual"); },
    async onSubmit(fields) { submissions.push(fields); },
  });

  await fixture.submit();

  assert.deepEqual(submissions, [{ CLIENTELookupId: 42 }]);
  controller.cleanup();
});

test("formulário não envia texto digitado quando a relação falha ou não foi selecionada", async () => {
  const fixture = relationshipFormFixture();
  let submissions = 0;
  const columns = mapSharePointColumns([{
    name: "CLIENTE",
    displayName: "Cliente",
    required: false,
    lookup: { listId: lookupListId, columnName: "Title" },
  }], {});
  const controller = dynamicForm.renderDynamicForm(fixture.root, {
    entity: {}, columns, relationshipDebounceMs: 0,
    async relationshipSearch() { throw new Error("Lista relacionada sem acesso"); },
    async onSubmit() { submissions += 1; },
  });

  fixture.input("ana");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(fixture.status.textContent, /sem acesso/i);
  await fixture.submit();
  assert.equal(submissions, 0);
  assert.match(fixture.errors.textContent, /selecione.*Cliente/i);
  controller.cleanup();
});

test("formulário bloqueia CLIENTE=999 adulterado no DOM depois de uma seleção autorizada", async () => {
  const fixture = relationshipFormFixture();
  let submissions = 0;
  const columns = mapSharePointColumns([{
    name: "CLIENTE",
    displayName: "Cliente",
    required: true,
    lookup: { listId: lookupListId, columnName: "Title" },
  }], {});
  const controller = dynamicForm.renderDynamicForm(fixture.root, {
    entity: {}, columns, relationshipDebounceMs: 0,
    async relationshipSearch() { return [{ id: 7, label: "ANA ALMEIDA", secondary: "" }]; },
    async onSubmit() { submissions += 1; },
  });

  fixture.input("ana");
  await new Promise(resolve => setTimeout(resolve, 5));
  fixture.choose(0);
  fixture.hidden.value = "999";
  await fixture.submit();

  assert.equal(submissions, 0);
  assert.match(fixture.errors.textContent, /seleção.*Cliente.*não corresponde|Cliente.*seleção/i);
  controller.cleanup();
});

test("formulário bloqueia texto relacional alterado depois da opção autorizada", async () => {
  const fixture = relationshipFormFixture();
  let submissions = 0;
  const columns = mapSharePointColumns([{
    name: "CLIENTE",
    displayName: "Cliente",
    required: true,
    lookup: { listId: lookupListId, columnName: "Title" },
  }], {});
  const controller = dynamicForm.renderDynamicForm(fixture.root, {
    entity: {}, columns, relationshipDebounceMs: 0,
    async relationshipSearch() { return [{ id: 7, label: "ANA ALMEIDA", secondary: "" }]; },
    async onSubmit() { submissions += 1; },
  });

  fixture.input("ana");
  await new Promise(resolve => setTimeout(resolve, 5));
  fixture.choose(0);
  fixture.search.value = "CLIENTE ALTERADO";
  await fixture.submit();

  assert.equal(submissions, 0);
  assert.match(fixture.errors.textContent, /seleção.*Cliente.*não corresponde|Cliente.*seleção/i);
  controller.cleanup();
});

test("resposta obsoleta não substitui nem comprova a seleção da busca atual", async () => {
  const fixture = relationshipFormFixture();
  const submissions = [];
  let releaseOld;
  let oldStarted;
  const oldStartedPromise = new Promise(resolve => { oldStarted = resolve; });
  const columns = mapSharePointColumns([{
    name: "CLIENTE",
    displayName: "Cliente",
    required: true,
    lookup: { listId: lookupListId, columnName: "Title" },
  }], {});
  const controller = dynamicForm.renderDynamicForm(fixture.root, {
    entity: {}, columns, relationshipDebounceMs: 0,
    async relationshipSearch(_column, term) {
      if (term === "an") {
        oldStarted();
        await new Promise(resolve => { releaseOld = resolve; });
        return [{ id: 999, label: "RESPOSTA OBSOLETA", secondary: "" }];
      }
      return [{ id: 7, label: "ANA ALMEIDA", secondary: "" }];
    },
    async onSubmit(fields) { submissions.push(fields); },
  });

  fixture.input("an");
  await oldStartedPromise;
  fixture.input("ana");
  await new Promise(resolve => setTimeout(resolve, 5));
  fixture.choose(0);
  releaseOld();
  await new Promise(resolve => setTimeout(resolve, 5));
  await fixture.submit();

  assert.deepEqual(submissions, [{ CLIENTELookupId: 7 }]);
  assert.equal(fixture.hidden.value, "7");
  assert.equal(fixture.search.value, "ANA ALMEIDA");
  controller.cleanup();
});
