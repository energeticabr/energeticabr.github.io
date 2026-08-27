import assert from "node:assert/strict";
import test from "node:test";

import ENTITIES from "../portal/catalog/entities.js";
import { resolvePowerAppsUiContract } from "../portal/catalog/powerapps-ui-contract.js";
import { formMarkup, renderDynamicForm } from "../portal/ui/dynamic-form.js";

const entity = Object.freeze({ title: "Lancamentos" });

test("Choice fechado prepara o seletor pesquisavel e preserva o valor atual na edicao", () => {
  const markup = formMarkup({
    entity,
    mode: "edit",
    values: { STATUS: "PGTO EFETUADO" },
    columns: [{
      name: "STATUS",
      label: "Status",
      control: "select",
      choices: ["PENDENTE", "PGTO EFETUADO"],
      editable: true,
      hidden: false,
    }],
  });

  assert.match(markup, /data-searchable-field="STATUS"/);
  assert.match(markup, /data-searchable-root="STATUS"/);
  assert.match(markup, /<select[^>]+name="STATUS"/);
  assert.match(markup, /value="PGTO EFETUADO" selected/);
});

test("campo marcado como nao pesquisavel continua como select simples", () => {
  const markup = formMarkup({
    entity,
    columns: [{
      name: "PRIORIDADE",
      label: "Prioridade",
      control: "select",
      choices: ["BAIXA", "ALTA"],
      searchable: false,
      editable: true,
      hidden: false,
    }],
  });

  assert.match(markup, /<select[^>]+name="PRIORIDADE"/);
  assert.doesNotMatch(markup, /data-searchable-field="PRIORIDADE"/);
  assert.doesNotMatch(markup, /data-searchable-root="PRIORIDADE"/);
});

test("Lookup e Person fechados preparam o seletor pesquisavel reutilizavel", () => {
  const markup = formMarkup({
    entity,
    columns: [
      {
        name: "CLIENTE",
        label: "Cliente",
        control: "lookup",
        relation: { kind: "lookup", listId: "clientes", displayField: "Title", multiple: false, resolvable: true },
        editable: true,
        hidden: false,
      },
      {
        name: "RESPONSAVEL",
        label: "Responsavel",
        control: "person",
        relation: { kind: "person", principalType: "peopleOnly", multiple: false, resolvable: true },
        editable: true,
        hidden: false,
      },
    ],
  });

  assert.match(markup, /data-relation-searchable-root="CLIENTE"/);
  assert.match(markup, /data-relation-searchable-root="RESPONSAVEL"/);
});

test("Choice multipla declarada no schema preserva SelectedItems como lista", () => {
  const markup = formMarkup({
    entity,
    mode: "edit",
    values: { CATEGORIAS: ["OBRA CIVIL", "MANUTENCAO PREDIAL"] },
    columns: [{
      name: "CATEGORIAS",
      label: "Categorias",
      control: "select",
      choices: ["OBRA CIVIL", "MANUTENCAO PREDIAL", "ELETRICA"],
      allowMultipleValues: true,
      editable: true,
      hidden: false,
    }],
  });

  assert.match(markup, /<select[^>]+name="CATEGORIAS"[^>]+multiple/);
  assert.match(markup, /value="OBRA CIVIL" selected/);
  assert.match(markup, /value="MANUTENCAO PREDIAL" selected/);
  assert.match(markup, /data-selected-items="CATEGORIAS"/);
});

test("Choice bruta conserva allowMultipleValues ao ser mapeada pelo formulario", () => {
  const markup = formMarkup({
    entity,
    values: { AREAS: ["OBRAS", "FINANCEIRO"] },
    columns: [{
      name: "AREAS",
      displayName: "Areas",
      choice: { choices: ["OBRAS", "FINANCEIRO"], allowMultipleValues: true },
    }],
  });

  assert.match(markup, /<select[^>]+name="AREAS"[^>]+multiple/);
  assert.match(markup, /data-selected-items="AREAS"/);
});

test("Lookup multiplo seguro permanece habilitado e prepara SelectedItems", () => {
  const markup = formMarkup({
    entity,
    mode: "edit",
    values: {
      EQUIPESLookupId: [7, 9],
      EQUIPESLookupValue: ["ANA ALMEIDA", "BRUNO COSTA"],
    },
    columns: [{
      name: "EQUIPES",
      displayName: "Equipes",
      lookup: { listId: "clientes", columnName: "Title", allowMultipleValues: true },
    }],
  });

  assert.match(markup, /data-relation-searchable-root="EQUIPES"/);
  assert.match(markup, /data-selected-items="EQUIPES"/);
  assert.doesNotMatch(markup, /data-relation-search="EQUIPES"[^>]+disabled/);
});

class FakeHtmlCollection {
  replace(items) {
    for (let index = 0; index < this.length; index += 1) delete this[index];
    items.forEach((item, index) => { this[index] = item; });
    this.length = items.length;
  }

  [Symbol.iterator]() {
    return Array.from({ length: this.length }, (_, index) => this[index])[Symbol.iterator]();
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.children = new FakeHtmlCollection();
    this.children.replace([]);
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.required = false;
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.parentNode = null;
    this.dataset = {};
  }

  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.childNodes.push(child);
    }
    this.children.replace(this.childNodes);
  }

  replaceChildren(...children) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }

  removeEventListener(name, listener) {
    this.listeners.get(name)?.delete(listener);
  }

  dispatch(name, properties = {}) {
    const event = {
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...properties,
    };
    for (const listener of this.listeners.get(name) || []) listener(event);
    return event;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

function choiceFormFixture(initialValue = "PGTO EFETUADO", { multiple = false, name = "STATUS", dependencies = {} } = {}) {
  const document = new FakeDocument();
  const listeners = new Map();
  const mount = document.createElement("span");
  const native = document.createElement("select");
  native.name = name;
  native.value = Array.isArray(initialValue) ? String(initialValue[0] || "") : initialValue;
  native.multiple = multiple;
  native.required = true;
  const dependencyControls = new Map(Object.entries(dependencies).map(([fieldName, value]) => {
    const control = document.createElement("select");
    control.name = fieldName;
    control.value = String(value ?? "");
    return [fieldName, control];
  }));
  const selectedItems = document.createElement("ul");
  const powerAppsStatus = document.createElement("small");
  const field = {
    querySelector(selector) {
      return ({
        "select[name]": native,
        "[data-searchable-root]": mount,
        "[data-selected-items]": multiple ? selectedItems : null,
        "[data-powerapps-option-status]": powerAppsStatus,
      })[selector] || null;
    },
  };
  const errors = { textContent: "", hidden: true };
  const save = { disabled: false, textContent: "Salvar alteracoes" };
  const cancel = {
    disabled: false,
    addEventListener(name, listener) { listeners.set(`cancel:${name}`, listener); },
    removeEventListener(name) { listeners.delete(`cancel:${name}`); },
  };
  const controls = [native, ...dependencyControls.values(), cancel, save];
  const form = {
    elements: {
      namedItem(fieldName) {
        if (fieldName === native.name) return native;
        return dependencyControls.get(fieldName) || null;
      },
      [Symbol.iterator]() { return controls[Symbol.iterator](); },
    },
    reportValidity() { return true; },
    setAttribute() {},
    querySelectorAll(selector) {
      if (selector === "[data-searchable-field]") return [field];
      if (selector === "[data-relation-field]") return [];
      return [];
    },
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
    document,
    root,
    mount,
    native,
    selectedItems,
    powerAppsStatus,
    dependencyControls,
    errors,
    submit() { return listeners.get("form:submit")?.({ preventDefault() {} }); },
  };
}

function mountedSearchable(fixture) {
  const container = fixture.mount.children[0];
  return { input: container.children[0], listbox: container.children[1] };
}

test("Choice usa o seletor existente com foco estavel, teclado, ARIA e valor fechado", async () => {
  const fixture = choiceFormFixture();
  const submissions = [];
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    columns: [{
      name: "STATUS",
      label: "Status",
      control: "select",
      choices: ["PENDENTE", "PGTO EFETUADO", "PGTO PARCIAL"],
      required: true,
      editable: true,
      hidden: false,
    }],
    async onSubmit(fields, rawValues) { submissions.push({ fields, rawValues }); },
  });
  const { input, listbox } = mountedSearchable(fixture);

  assert.equal(input.value, "PGTO EFETUADO");
  assert.equal(input.getAttribute("placeholder"), "Pesquisar e selecionar");
  assert.equal(input.getAttribute("role"), "combobox");
  assert.equal(input.getAttribute("aria-autocomplete"), "list");
  assert.equal(listbox.getAttribute("role"), "listbox");
  input.focus();
  input.value = "pgto efe";
  input.dispatch("input");

  assert.equal(mountedSearchable(fixture).input, input);
  assert.equal(fixture.document.activeElement, input);
  assert.equal(listbox.children.length, 1);
  assert.equal(listbox.children[0].textContent, "PGTO EFETUADO");
  input.dispatch("keydown", { key: "ArrowDown" });
  input.dispatch("keydown", { key: "Enter" });
  assert.equal(fixture.native.value, "PGTO EFETUADO");

  await fixture.submit();
  assert.deepEqual(submissions, [{
    fields: { STATUS: "PGTO EFETUADO" },
    rawValues: { STATUS: "PGTO EFETUADO" },
  }]);

  input.value = "STATUS INVENTADO";
  input.dispatch("input");
  await fixture.submit();
  assert.equal(submissions.length, 1);
  assert.match(fixture.errors.textContent, /selecione.*Status/i);
  controller.cleanup();
});

test("Choice multipla adiciona e remove pelo teclado sem perder SelectedItems", async () => {
  const fixture = choiceFormFixture(["OBRA CIVIL"], { multiple: true });
  fixture.native.name = "CATEGORIAS";
  const submissions = [];
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: { CATEGORIAS: ["OBRA CIVIL"] },
    columns: [{
      name: "CATEGORIAS",
      label: "Categorias",
      control: "select",
      choices: ["OBRA CIVIL", "MANUTENCAO PREDIAL", "ELETRICA"],
      allowMultipleValues: true,
      required: true,
      editable: true,
      hidden: false,
    }],
    async onSubmit(fields, rawValues) { submissions.push({ fields, rawValues }); },
  });
  const { input, listbox } = mountedSearchable(fixture);

  assert.equal(input.value, "");
  assert.equal(listbox.getAttribute("aria-multiselectable"), "true");
  assert.equal(fixture.selectedItems.getAttribute("aria-label"), "Categorias selecionadas");
  assert.equal(fixture.selectedItems.children.length, 1);
  input.value = "manutencao predial";
  input.dispatch("input");
  input.dispatch("keydown", { key: "ArrowDown" });
  input.dispatch("keydown", { key: "Enter" });
  assert.equal(fixture.selectedItems.children.length, 2);

  input.dispatch("keydown", { key: "Backspace" });
  assert.equal(fixture.selectedItems.children.length, 1);
  input.value = "manutencao predial";
  input.dispatch("input");
  input.dispatch("keydown", { key: "ArrowDown" });
  input.dispatch("keydown", { key: "Enter" });
  await fixture.submit();

  assert.deepEqual(submissions, [{
    fields: { CATEGORIAS: ["OBRA CIVIL", "MANUTENCAO PREDIAL"] },
    rawValues: { CATEGORIAS: ["OBRA CIVIL", "MANUTENCAO PREDIAL"] },
  }]);
  controller.cleanup();
});

test("Choice multipla vazia em edicao continua sendo uma lista", async () => {
  const fixture = choiceFormFixture([], { multiple: true });
  fixture.native.name = "CATEGORIAS";
  const submissions = [];
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: { CATEGORIAS: [] },
    columns: [{
      name: "CATEGORIAS",
      label: "Categorias",
      control: "select",
      choices: ["OBRA CIVIL", "MANUTENCAO PREDIAL"],
      allowMultipleValues: true,
      required: false,
      editable: true,
      hidden: false,
    }],
    async onSubmit(fields, rawValues) { submissions.push({ fields, rawValues }); },
  });

  await fixture.submit();

  assert.deepEqual(submissions, [{
    fields: { CATEGORIAS: [] },
    rawValues: { CATEGORIAS: [] },
  }]);
  controller.cleanup();
});

test("ComboBox multiplo textual recompõe a edição e grava com o separador do Power Apps", async () => {
  const fixture = choiceFormFixture("17, 29", { multiple: true, name: "CONTRATO" });
  const submissions = [];
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: { CONTRATO: "17, 29" },
    columns: [{
      name: "CONTRATO",
      label: "Contratos",
      control: "select",
      choices: ["17", "29", "31"],
      allowMultipleValues: true,
      required: false,
      editable: true,
      hidden: false,
      powerApps: {
        closed: true,
        allowMultipleValues: true,
        multipleSerialization: { kind: "concat", delimiter: ", ", specialValues: [] },
      },
    }],
    async onSubmit(fields, rawValues) { submissions.push({ fields, rawValues }); },
  });

  assert.equal(fixture.selectedItems.children.length, 2);
  await fixture.submit();
  assert.deepEqual(submissions, [{
    fields: { CONTRATO: "17, 29" },
    rawValues: { CONTRATO: ["17", "29"] },
  }]);
  controller.cleanup();
});

test("ComboBox percentual mostra a escala visual e grava a fracao do Power Apps", async () => {
  const fixture = choiceFormFixture("0.5", { name: "PERCENTUALEFETUADO" });
  const submissions = [];
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: { PERCENTUALEFETUADO: 0.5 },
    columns: [{
      name: "PERCENTUALEFETUADO",
      label: "Percentual efetuado",
      control: "select",
      choices: ["0", "50", "100"],
      required: false,
      editable: true,
      hidden: false,
      searchable: true,
      powerApps: {
        closed: true,
        valueTransform: { kind: "scale", displayMultiplier: 100, submitDivisor: 100 },
      },
    }],
    async onSubmit(fields, rawValues) { submissions.push({ fields, rawValues }); },
  });

  assert.equal(mountedSearchable(fixture).input.value, "50");
  await fixture.submit();
  assert.deepEqual(submissions, [{
    fields: { PERCENTUALEFETUADO: 0.5 },
    rawValues: { PERCENTUALEFETUADO: "50" },
  }]);
  controller.cleanup();
});

test("um seletor Power Apps grava todos os campos produzidos pelo mesmo ComboBox", async () => {
  const fixture = choiceFormFixture("", { name: "CONTRATO" });
  const submissions = [];
  const source = Object.freeze({
    kind: "related",
    listName: "DESCRICAOMEDICOES",
    valueField: "NUMEROCONTRATO",
    additionalFields: ["ID"],
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: { CONTRATO: "", MEDICAOPARCIAL: "" },
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "CONTRATO",
      label: "Contrato e medição",
      control: "select",
      choices: [],
      required: false,
      editable: true,
      hidden: false,
      searchable: true,
      powerApps: {
        closed: true,
        optionSources: [source],
        sharedOutputs: [
          { fieldName: "CONTRATO", sourceField: "NUMEROCONTRATO" },
          { fieldName: "MEDICAOPARCIAL", sourceField: "ID" },
        ],
      },
    }],
    async powerAppsOptionSearch() {
      return [{
        value: "CT-12",
        label: "34 - Fornecedor (CT-12)",
        data: { NUMEROCONTRATO: "CT-12", ID: "34" },
      }];
    },
    async onSubmit(fields) { submissions.push(fields); },
  });
  const { input } = mountedSearchable(fixture);

  input.value = "34";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));
  input.dispatch("keydown", { key: "ArrowDown" });
  input.dispatch("keydown", { key: "Enter" });
  await fixture.submit();

  assert.deepEqual(submissions, [{ CONTRATO: "CT-12", MEDICAOPARCIAL: "34" }]);
  controller.cleanup();
});

test("FILIAL de lancamentos pesquisa no provider com dois caracteres e preserva a preseleção", async () => {
  const fixture = choiceFormFixture("MATRIZ", { name: "Title" });
  const searches = [];
  const submissions = [];
  const source = Object.freeze({
    kind: "related",
    entityId: "filiais",
    listName: "FILIAIS",
    valueField: "FILIAL",
    formula: "=FILIAIS.FILIAL",
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: { Title: "MATRIZ" },
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "Title",
      label: "FILIAL",
      control: "select",
      choices: [],
      searchable: true,
      required: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, failClosed: true, preserveCurrentValue: true, optionSources: [source] },
    }],
    async powerAppsOptionSearch(column, selectedSource, term, dependencies, requestOptions) {
      searches.push({ column: column.name, source: selectedSource, term, dependencies, limit: requestOptions.limit });
      return [{ value: "OBRA 01", label: "OBRA 01" }];
    },
    async onSubmit(fields) { submissions.push(fields); },
  });
  const { input, listbox } = mountedSearchable(fixture);

  assert.equal(input.value, "MATRIZ");
  input.value = "o";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(searches.length, 0);

  input.value = "ob";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(searches, [{ column: "Title", source, term: "ob", dependencies: {}, limit: 20 }]);
  assert.equal(listbox.children.length, 1);
  input.dispatch("keydown", { key: "ArrowDown" });
  input.dispatch("keydown", { key: "Enter" });
  await fixture.submit();

  assert.deepEqual(submissions, [{ Title: "OBRA 01" }]);
  controller.cleanup();
});

test("campo Power Apps com espaço continua remoto até a resolução por metadados", async () => {
  const fixture = choiceFormFixture("", { name: "FORMA PGTO" });
  const calls = [];
  const source = Object.freeze({
    kind: "related",
    listName: "FORMAPAGAMENTO",
    valueField: "FORMA PGTO",
    searchFields: ["FORMA PGTO"],
    displayFields: ["FORMA PGTO"],
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "FORMA PGTO",
      label: "FORMA PGTO",
      control: "select",
      choices: [],
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, failClosed: true, preserveCurrentValue: true, optionSources: [source] },
    }],
    async powerAppsOptionSearch(_column, selectedSource, term) {
      calls.push({ selectedSource, term });
      return [{ value: "PIX", label: "PIX" }];
    },
  });
  const { input } = mountedSearchable(fixture);

  input.value = "pi";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.deepEqual(calls, [{ selectedSource: source, term: "pi" }]);
  assert.equal(input.disabled, false);
  controller.cleanup();
});

test("ETAPA de lancamentos envia a FILIAL selecionada como dependência comprovada", async () => {
  const fixture = choiceFormFixture("", { name: "field_6", dependencies: { Title: "MATRIZ" } });
  const calls = [];
  const source = Object.freeze({
    kind: "dependent",
    entityId: "lancamentos-de-obras",
    listName: "LANCAMENTOOBRA",
    valueField: "ETAPA",
    formula: "=Distinct(Filter(LANCAMENTOOBRA, FILIAL = COMBOBOXFILIAL.Selected.FILIAL), ETAPA)",
    dependsOn: [{ controlName: "COMBOBOXFILIAL", fieldName: "Title", targetField: "FILIAL" }],
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    values: { Title: "MATRIZ", field_6: "" },
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "field_6",
      label: "ETAPA",
      control: "select",
      choices: [],
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, failClosed: true, preserveCurrentValue: true, optionSources: [source] },
    }],
    async powerAppsOptionSearch(_column, _source, term, dependencies) {
      calls.push({ term, dependencies });
      return [{ value: "FUNDAÇÃO", label: "FUNDAÇÃO" }];
    },
  });
  const { input } = mountedSearchable(fixture);

  input.value = "fu";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.deepEqual(calls, [{ term: "fu", dependencies: { Title: "MATRIZ" } }]);
  controller.cleanup();
});

test("seletor envia dependencia opcional vazia sem bloquear a pesquisa", async () => {
  const fixture = choiceFormFixture("", { name: "IDMEDICAO", dependencies: { IDCONTRATO: "" } });
  const calls = [];
  const source = Object.freeze({
    kind: "dependent",
    listName: "DESCRICAOMEDICOES",
    valueField: "ID",
    dependsOn: [{
      controlName: "ContratoCombo",
      fieldName: "IDCONTRATO",
      targetField: "NUMEROCONTRATO",
      optional: true,
    }],
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    values: { IDCONTRATO: "", IDMEDICAO: "" },
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "IDMEDICAO",
      label: "MEDIÇÃO",
      control: "select",
      choices: [],
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, failClosed: true, preserveCurrentValue: true, optionSources: [source] },
    }],
    async powerAppsOptionSearch(_column, _source, term, dependencies) {
      calls.push({ term, dependencies });
      return [{ value: "11", label: "11" }];
    },
  });
  const { input } = mountedSearchable(fixture);

  input.value = "11";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.deepEqual(calls, [{ term: "11", dependencies: {} }]);
  controller.cleanup();
});

test("provider Power Apps indisponível mantém o campo fechado e recusa texto livre", async () => {
  const fixture = choiceFormFixture("", { name: "Title" });
  let submissions = 0;
  const controller = renderDynamicForm(fixture.root, {
    entity,
    values: { Title: "" },
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "Title",
      label: "FILIAL",
      control: "select",
      choices: [],
      searchable: true,
      required: true,
      editable: true,
      hidden: false,
      powerApps: {
        closed: true,
        failClosed: true,
        preserveCurrentValue: true,
        optionSources: [{ kind: "related", entityId: "filiais", listName: "FILIAIS", valueField: "FILIAL" }],
      },
    }],
    async powerAppsOptionSearch() { throw new Error("Lista comprovada indisponível"); },
    async onSubmit() { submissions += 1; },
  });
  const { input, listbox } = mountedSearchable(fixture);

  input.value = "inventada";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));
  await fixture.submit();

  assert.equal(listbox.children.length, 0);
  assert.equal(submissions, 0);
  assert.match(fixture.powerAppsStatus.textContent, /indisponível/i);
  assert.match(fixture.errors.textContent, /selecione.*FILIAL/i);
  controller.cleanup();
});

test("contrato real de lancamentos monta FILIAL remoto e ETAPA dependente sem origem manual", async () => {
  const lancamentos = ENTITIES.find(candidate => candidate.id === "lancamentos");
  const columns = [
    {
      name: "Title",
      label: "FILIAL",
      control: "text",
      choices: [],
      editable: true,
      hidden: false,
    },
    {
      name: "field_6",
      label: "ETAPA",
      control: "text",
      choices: [],
      editable: true,
      hidden: false,
    },
  ];
  const createContract = resolvePowerAppsUiContract(lancamentos, columns, { mode: "create" });
  const editContract = resolvePowerAppsUiContract(lancamentos, columns, { mode: "edit" });
  const filial = createContract.formColumns.find(column => column.name === "Title");
  const etapa = createContract.formColumns.find(column => column.name === "field_6");

  assert.equal(createContract.formVariant.fileName, "F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml");
  assert.equal(editContract.formVariant.fileName, "E1- EDITAR LANÇAMENTO COMPRA.pa.yaml");
  assert.deepEqual(filial.powerApps.optionSources.map(source => source.kind), ["related"]);
  assert.equal(filial.powerApps.optionSources[0].listName, "FILIAIS");
  assert.equal(filial.powerApps.optionSources[0].valueField, "FILIAL");
  assert.equal(etapa.powerApps.optionSources.every(source => (
    source.kind === "dependent"
    && source.dependsOn?.[0]?.fieldName === "Title"
    && source.dependsOn?.[0]?.targetField === "FILIAL"
  )), true);

  const filialFixture = choiceFormFixture("MATRIZ", { name: "Title" });
  const filialCalls = [];
  const filialController = renderDynamicForm(filialFixture.root, {
    entity: lancamentos,
    mode: "edit",
    values: { Title: "MATRIZ" },
    columns: [filial],
    powerAppsOptionDebounceMs: 0,
    async powerAppsOptionSearch(_column, source, term, dependencies) {
      filialCalls.push({ source, term, dependencies });
      return [{ value: "MATRIZ", label: "MATRIZ" }];
    },
  });
  const filialInput = mountedSearchable(filialFixture).input;
  assert.equal(filialInput.disabled, false);
  assert.equal(filialInput.value, "MATRIZ");
  filialInput.value = "ma";
  filialInput.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(filialCalls.length, 1);
  assert.equal(filialCalls[0].source.kind, "related");
  assert.deepEqual(filialCalls[0].dependencies, {});
  filialController.cleanup();

  const etapaFixture = choiceFormFixture("FUNDAÇÃO", { name: "field_6", dependencies: { Title: "MATRIZ" } });
  const etapaCalls = [];
  const etapaController = renderDynamicForm(etapaFixture.root, {
    entity: lancamentos,
    mode: "edit",
    values: { Title: "MATRIZ", field_6: "FUNDAÇÃO" },
    columns: [etapa],
    powerAppsOptionDebounceMs: 0,
    async powerAppsOptionSearch(_column, source, term, dependencies) {
      etapaCalls.push({ source, term, dependencies });
      return [{ value: "FUNDAÇÃO", label: "FUNDAÇÃO" }];
    },
  });
  const etapaInput = mountedSearchable(etapaFixture).input;
  assert.equal(etapaInput.disabled, false);
  assert.equal(etapaInput.value, "FUNDAÇÃO");
  etapaInput.value = "fu";
  etapaInput.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(etapaCalls.length, 1);
  assert.equal(etapaCalls[0].source.kind, "dependent");
  assert.deepEqual(etapaCalls[0].dependencies, { Title: "MATRIZ" });
  etapaController.cleanup();

  for (const fieldName of ["Title", "field_6"]) {
    const field = editContract.formColumns.find(column => column.name === fieldName);
    const fixture = choiceFormFixture(fieldName === "Title" ? "MATRIZ" : "FUNDAÇÃO", {
      name: fieldName,
      dependencies: fieldName === "field_6" ? { Title: "MATRIZ" } : {},
    });
    const calls = [];
    const controller = renderDynamicForm(fixture.root, {
      entity: lancamentos,
      mode: "edit",
      values: { Title: "MATRIZ", field_6: "FUNDAÇÃO" },
      columns: [field],
      powerAppsOptionDebounceMs: 0,
      async powerAppsOptionSearch(_column, source, term, dependencies) {
        calls.push({ source, term, dependencies });
        return [{ value: fieldName === "Title" ? "MATRIZ" : "FUNDAÇÃO", label: fieldName === "Title" ? "MATRIZ" : "FUNDAÇÃO" }];
      },
    });
    const input = mountedSearchable(fixture).input;
    input.value = fieldName === "Title" ? "ma" : "fu";
    input.dispatch("input");
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(input.disabled, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].source.kind, fieldName === "Title" ? "related" : "dependent");
    assert.deepEqual(calls[0].dependencies, fieldName === "Title" ? {} : { Title: "MATRIZ" });
    controller.cleanup();
  }
});

function relationshipFormFixture(initial = { id: 42, label: "CLIENTE ATUAL" }, { multiple = false, name = "CLIENTE" } = {}) {
  const document = new FakeDocument();
  const listeners = new Map();
  const mount = document.createElement("span");
  const fallback = document.createElement("input");
  fallback.value = multiple ? "" : initial.label;
  const hidden = document.createElement("input");
  hidden.name = name;
  hidden.value = multiple ? JSON.stringify(initial.ids || []) : String(initial.id || "");
  const status = document.createElement("p");
  const legacyListbox = document.createElement("ul");
  const selectedItems = document.createElement("ul");
  const container = {
    dataset: { relationField: name },
    querySelector(selector) {
      return ({
        "[data-relation-search]": fallback,
        "[data-relation-value]": hidden,
        "[data-relation-status]": status,
        "[data-relation-options]": legacyListbox,
        "[data-relation-searchable-root]": mount,
        "[data-selected-items]": multiple ? selectedItems : null,
      })[selector] || null;
    },
  };
  const errors = { textContent: "", hidden: true };
  const save = { disabled: false, textContent: "Salvar alteracoes" };
  const cancel = {
    disabled: false,
    addEventListener(name, listener) { listeners.set(`cancel:${name}`, listener); },
    removeEventListener(name) { listeners.delete(`cancel:${name}`); },
  };
  const controls = [hidden, fallback, cancel, save];
  const form = {
    elements: {
      namedItem(fieldName) { return fieldName === hidden.name ? hidden : null; },
      [Symbol.iterator]() { return controls[Symbol.iterator](); },
    },
    reportValidity() { return true; },
    setAttribute() {},
    querySelectorAll(selector) {
      if (selector === "[data-relation-field]") return [container];
      if (selector === "[data-searchable-field]") return [];
      return [];
    },
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
    document,
    root,
    mount,
    hidden,
    status,
    selectedItems,
    errors,
    submit() { return listeners.get("form:submit")?.({ preventDefault() {} }); },
  };
}

test("Lookup remoto reutiliza o mesmo input e envia apenas a opcao pesquisada", async () => {
  const fixture = relationshipFormFixture();
  const submissions = [];
  const searches = [];
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: { CLIENTELookupId: 42, CLIENTELookupValue: "CLIENTE ATUAL" },
    relationshipLabels: { CLIENTE: "CLIENTE ATUAL" },
    relationshipDebounceMs: 0,
    columns: [{
      name: "CLIENTE",
      label: "Cliente",
      control: "lookup",
      relation: { kind: "lookup", listId: "clientes", displayField: "Title", multiple: false, resolvable: true },
      required: true,
      editable: true,
      hidden: false,
    }],
    async relationshipSearch(_column, term) {
      searches.push(term);
      return [
        { id: 7, label: "ANA ALMEIDA", secondary: "UNIDADE 101" },
        { id: 8, label: "ANA BEATRIZ", secondary: "UNIDADE 102" },
      ];
    },
    async onSubmit(fields, rawValues, labels) { submissions.push({ fields, rawValues, labels }); },
  });
  const { input, listbox } = mountedSearchable(fixture);

  assert.equal(input.value, "CLIENTE ATUAL");
  input.focus();
  input.value = "ana almeida";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.deepEqual(searches, ["ana"]);
  assert.equal(mountedSearchable(fixture).input, input);
  assert.equal(fixture.document.activeElement, input);
  assert.equal(listbox.children.length, 1);
  assert.equal(listbox.children[0].textContent, "ANA ALMEIDA");
  input.dispatch("keydown", { key: "ArrowDown" });
  input.dispatch("keydown", { key: "Enter" });
  await fixture.submit();

  assert.deepEqual(submissions, [{
    fields: { CLIENTELookupId: 7 },
    rawValues: { CLIENTE: "7" },
    labels: { CLIENTE: "ANA ALMEIDA" },
  }]);
  controller.cleanup();
});

test("Lookup multiplo preserva IDs e rotulos atuais como listas fechadas", async () => {
  const fixture = relationshipFormFixture({ ids: [7, 9] }, { multiple: true, name: "EQUIPES" });
  const submissions = [];
  const searchedRelations = [];
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: {
      EQUIPESLookupId: [7, 9],
      EQUIPESLookupValue: ["ANA ALMEIDA", "BRUNO COSTA"],
    },
    relationshipLabels: { EQUIPES: ["ANA ALMEIDA", "BRUNO COSTA"] },
    relationshipDebounceMs: 0,
    columns: [{
      name: "EQUIPES",
      label: "Equipes",
      control: "lookup",
      relation: { kind: "lookup", listId: "clientes", displayField: "Title", multiple: true, resolvable: false },
      required: true,
      editable: true,
      hidden: false,
    }],
    async relationshipSearch(column) {
      searchedRelations.push(column.relation);
      return [{ id: 11, label: "CARLA SOUZA", secondary: "UNIDADE 103" }];
    },
    async onSubmit(fields, rawValues, labels) { submissions.push({ fields, rawValues, labels }); },
  });
  const { input, listbox } = mountedSearchable(fixture);

  assert.equal(input.value, "");
  assert.equal(listbox.getAttribute("aria-multiselectable"), "true");
  assert.equal(fixture.selectedItems.children.length, 2);
  input.value = "carla souza";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(searchedRelations[0].multiple, false);
  assert.equal(searchedRelations[0].resolvable, true);
  input.dispatch("keydown", { key: "ArrowDown" });
  input.dispatch("keydown", { key: "Enter" });
  assert.equal(fixture.selectedItems.children.length, 3);
  input.dispatch("keydown", { key: "Backspace" });
  assert.equal(fixture.selectedItems.children.length, 2);
  input.value = "carla souza";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));
  input.dispatch("keydown", { key: "ArrowDown" });
  input.dispatch("keydown", { key: "Enter" });
  await fixture.submit();

  assert.deepEqual(submissions, [{
    fields: { EQUIPESLookupId: [7, 9, 11] },
    rawValues: { EQUIPES: [7, 9, 11] },
    labels: { EQUIPES: ["ANA ALMEIDA", "BRUNO COSTA", "CARLA SOUZA"] },
  }]);
  controller.cleanup();
});
