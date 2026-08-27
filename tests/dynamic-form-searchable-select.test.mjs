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

test("campo fechado marcado como nao pesquisavel tambem usa ComboBox pesquisavel", () => {
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
  assert.match(markup, /data-searchable-field="PRIORIDADE"/);
  assert.match(markup, /data-searchable-root="PRIORIDADE"/);
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

function dependentChoiceFormFixture() {
  const document = new FakeDocument();
  const listeners = new Map();
  const fields = new Map();
  const controls = new Map();

  for (const [name, value] of [["Title", "MATRIZ"], ["field_6", "FUNDAÇÃO"]]) {
    const mount = document.createElement("span");
    const native = document.createElement("select");
    const status = document.createElement("small");
    native.name = name;
    native.value = value;
    const field = {
      querySelector(selector) {
        return ({
          "select[name]": native,
          "[data-searchable-root]": mount,
          "[data-selected-items]": null,
          "[data-powerapps-option-status]": status,
        })[selector] || null;
      },
    };
    fields.set(name, { field, mount, native, status });
    controls.set(name, native);
  }

  const errors = { textContent: "", hidden: true };
  const save = { disabled: false, textContent: "Salvar alterações" };
  const cancel = {
    disabled: false,
    addEventListener(name, listener) { listeners.set(`cancel:${name}`, listener); },
    removeEventListener(name) { listeners.delete(`cancel:${name}`); },
  };
  const formControls = [...controls.values(), cancel, save];
  const form = {
    elements: {
      namedItem(name) { return controls.get(name) || null; },
      [Symbol.iterator]() { return formControls[Symbol.iterator](); },
    },
    reportValidity() { return true; },
    setAttribute() {},
    querySelectorAll(selector) {
      if (selector === "[data-searchable-field]") return [...fields.values()].map(item => item.field);
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
    root,
    field(name) { return fields.get(name); },
  };
}

function mountedDependentChoice(fixture, name) {
  const field = fixture.field(name);
  const container = field.mount.children[0];
  return { ...field, input: container.children[0], listbox: container.children[1] };
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

test("ComboBox múltiplo com delimitador espaço preserva o texto escalar sem quebrar opções compostas", async () => {
  const currentValue = "OBRA CIVIL MANUTENCAO PREDIAL";
  const fixture = choiceFormFixture(currentValue, { multiple: true, name: "ATIVIDADEEXERCIDA" });
  const submissions = [];
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: { ATIVIDADEEXERCIDA: currentValue },
    columns: [{
      name: "ATIVIDADEEXERCIDA",
      label: "Atividade exercida",
      control: "select",
      choices: [],
      allowMultipleValues: true,
      required: false,
      editable: true,
      hidden: false,
      powerApps: {
        closed: true,
        preserveCurrentValue: true,
        multipleSerialization: { kind: "concat", delimiter: " ", specialValues: [] },
      },
    }],
    async onSubmit(fields, rawValues) { submissions.push({ fields, rawValues }); },
  });

  assert.equal(fixture.selectedItems.children.length, 1);
  await fixture.submit();
  assert.deepEqual(submissions, [{
    fields: { ATIVIDADEEXERCIDA: currentValue },
    rawValues: { ATIVIDADEEXERCIDA: [currentValue] },
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

test("FILIAL de lancamentos pesquisa no provider com uma letra e preserva a preseleção", async () => {
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
  assert.deepEqual(searches, [{ column: "Title", source, term: "o", dependencies: {}, limit: 20 }]);
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

test("trocar o ComboBox pai invalida o filho e a próxima pesquisa lê o valor atual", async () => {
  const fixture = dependentChoiceFormFixture();
  const calls = [];
  const filialSource = Object.freeze({
    kind: "related",
    listName: "FILIAIS",
    valueField: "FILIAL",
  });
  const etapaSource = Object.freeze({
    kind: "dependent",
    listName: "LANCAMENTOOBRA",
    valueField: "ETAPA",
    dependsOn: [{ controlName: "COMBOBOXFILIAL", fieldName: "Title", targetField: "FILIAL" }],
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: { Title: "MATRIZ", field_6: "FUNDAÇÃO" },
    powerAppsOptionDebounceMs: 0,
    columns: [
      {
        name: "Title",
        label: "FILIAL",
        control: "select",
        choices: [],
        searchable: true,
        editable: true,
        hidden: false,
        powerApps: { closed: true, preserveCurrentValue: true, optionSources: [filialSource] },
      },
      {
        name: "field_6",
        label: "ETAPA",
        control: "select",
        choices: [],
        searchable: true,
        editable: true,
        hidden: false,
        powerApps: { closed: true, preserveCurrentValue: true, optionSources: [etapaSource] },
      },
    ],
    async powerAppsOptionSearch(column, _source, term, dependencies) {
      calls.push({ column: column.name, term, dependencies });
      return column.name === "Title"
        ? [{ value: "OBRA 01", label: "OBRA 01" }]
        : [{ value: "NOVA ETAPA", label: "NOVA ETAPA" }];
    },
  });
  const filial = mountedDependentChoice(fixture, "Title");
  const etapa = mountedDependentChoice(fixture, "field_6");

  filial.input.value = "o";
  filial.input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));
  filial.input.dispatch("keydown", { key: "ArrowDown" });
  filial.input.dispatch("keydown", { key: "Enter" });

  assert.equal(filial.native.value, "OBRA 01");
  assert.equal(etapa.native.value, "");
  assert.equal(etapa.input.value, "");

  etapa.input.value = "n";
  etapa.input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.deepEqual(calls.at(-1), {
    column: "field_6",
    term: "n",
    dependencies: { Title: "OBRA 01" },
  });
  controller.cleanup();
});

test("origem conditional escolhe a branch concreta e reage à troca do seletor", async () => {
  const fixture = choiceFormFixture("FORNECEDOR ATUAL", {
    name: "PESSOARELACIONADA",
    dependencies: { TIPOHOMOLOGACAO: "HOMOLOGAÇÃO FILIAL", FILIAL: "MATRIZ" },
  });
  const calls = [];
  const filialBranch = Object.freeze({
    kind: "related",
    entityId: "fornecedores",
    listName: "FORNECEDORES",
    valueField: "CADASTRO",
    displayFields: ["CADASTRO"],
    searchFields: ["CADASTRO"],
  });
  const comercialBranch = Object.freeze({
    kind: "dependent",
    entityId: "compras",
    listName: "LANCAMENTOCOMPRAS",
    valueField: "NOME",
    dependsOn: [{ fieldName: "FILIAL", targetField: "FILIAL" }],
    displayFields: ["NOME"],
    searchFields: ["NOME"],
  });
  const conditionalSource = Object.freeze({
    kind: "conditional",
    selector: { fieldName: "TIPOHOMOLOGACAO" },
    branches: [
      { when: { operator: "eq", values: ["HOMOLOGAÇÃO FILIAL"] }, source: filialBranch },
      { when: { operator: "eq", values: ["HOMOLOGAÇÃO COMERCIAL"] }, source: comercialBranch },
    ],
    fallback: filialBranch,
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: {
      PESSOARELACIONADA: "FORNECEDOR ATUAL",
      TIPOHOMOLOGACAO: "HOMOLOGAÇÃO FILIAL",
      FILIAL: "MATRIZ",
    },
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "PESSOARELACIONADA",
      label: "Pessoa relacionada",
      control: "select",
      choices: [],
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, preserveCurrentValue: true, optionSources: [conditionalSource] },
    }],
    async powerAppsOptionSearch(_column, source, term, dependencies) {
      calls.push({ source, term, dependencies });
      return source === comercialBranch
        ? [{ value: "CLIENTE COMERCIAL", label: "CLIENTE COMERCIAL" }]
        : [{ value: "FORNECEDOR ATUAL", label: "FORNECEDOR ATUAL" }];
    },
  });
  const combo = mountedSearchable(fixture);

  assert.equal(combo.input.value, "FORNECEDOR ATUAL");
  combo.input.dispatch("focus");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls.at(-1).source, filialBranch);
  assert.deepEqual(calls.at(-1).dependencies, {});

  const selector = fixture.dependencyControls.get("TIPOHOMOLOGACAO");
  selector.value = "HOMOLOGAÇÃO COMERCIAL";
  selector.dispatch("change");
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.equal(calls.at(-1).source, comercialBranch);
  assert.deepEqual(calls.at(-1).dependencies, { FILIAL: "MATRIZ" });
  combo.input.value = "c";
  combo.input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls.at(-1).source, comercialBranch);
  assert.equal(calls.at(-1).term, "c");
  controller.cleanup();
});

test("origem conditional com fallback vazio permanece fechada sem consultar outra lista", async () => {
  const fixture = choiceFormFixture("", {
    name: "NUMCONTRATO",
    dependencies: { TIPOHOMOLOGACAO: "HOMOLOGAÇÃO FILIAL" },
  });
  const source = Object.freeze({
    kind: "conditional",
    selector: { fieldName: "TIPOHOMOLOGACAO" },
    branches: [{
      when: { operator: "eq", values: ["HOMOLOGAÇÃO CONTRATO"] },
      source: {
        kind: "filtered-list",
        listName: "EMPREITEIRO",
        valueField: "ID",
        fixedFilters: [{ fieldName: "STATUS", operator: "eq", value: "ATIVO" }],
      },
    }],
    fallback: {
      kind: "empty",
      valueField: "ID",
      displayFields: ["Exibir"],
      searchFields: ["Exibir"],
    },
  });
  let searches = 0;
  const controller = renderDynamicForm(fixture.root, {
    entity,
    values: { NUMCONTRATO: "", TIPOHOMOLOGACAO: "HOMOLOGAÇÃO FILIAL" },
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "NUMCONTRATO",
      label: "Número do contrato",
      control: "select",
      choices: [],
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, preserveCurrentValue: true, optionSources: [source] },
    }],
    async powerAppsOptionSearch() {
      searches += 1;
      return [{ value: "1", label: "1 - INDEVIDO" }];
    },
  });
  const combo = mountedSearchable(fixture);

  assert.equal(combo.input.disabled, false);
  combo.input.dispatch("focus");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(searches, 0);
  assert.equal(combo.listbox.children.length, 0);
  controller.cleanup();
});

test("ComboBox conditional múltiplo preserva os IDs atuais ao pesquisar e adicionar", async () => {
  const fixture = choiceFormFixture("17, 29", {
    multiple: true,
    name: "IDPGTOCORRETAGEM",
    dependencies: { CORRETAGEM: "PAGO CLIENTE" },
  });
  const paidSource = Object.freeze({
    kind: "filtered-list",
    listName: "LANÇAMENTORECEITA",
    valueField: "ID",
    fixedFilters: [{ fieldName: "PRODUTO", operator: "eq", value: "PAGAMENTO CORRETOR" }],
  });
  const fallback = Object.freeze({
    kind: "filtered-list",
    listName: "LANCAMENTOS",
    valueField: "ID",
    fixedFilters: [{ fieldName: "PRODUTO", operator: "eq", value: "CORRETAGEM DE VENDA CASA" }],
  });
  const source = Object.freeze({
    kind: "conditional",
    selector: { fieldName: "CORRETAGEM" },
    branches: [{ when: { operator: "eq", values: ["PAGO CLIENTE"] }, source: paidSource }],
    fallback,
  });
  const submissions = [];
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: { IDPGTOCORRETAGEM: "17, 29", CORRETAGEM: "PAGO CLIENTE" },
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "IDPGTOCORRETAGEM",
      label: "Pagamentos de corretagem",
      control: "select",
      choices: [],
      allowMultipleValues: true,
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: {
        closed: true,
        preserveCurrentValue: true,
        optionSources: [source],
        multipleSerialization: { kind: "concat", delimiter: ", ", specialValues: ["DISPENSADO"] },
      },
    }],
    async powerAppsOptionSearch(_column, selectedSource) {
      assert.equal(selectedSource, paidSource);
      return [{ value: "31", label: "31 - CORRETOR" }];
    },
    async onSubmit(fields) { submissions.push(fields); },
  });
  const { input } = mountedSearchable(fixture);

  assert.equal(fixture.selectedItems.children.length, 2);
  input.value = "3";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(fixture.selectedItems.children.length, 2);
  input.dispatch("keydown", { key: "ArrowDown" });
  input.dispatch("keydown", { key: "Enter" });
  assert.equal(fixture.selectedItems.children.length, 3);
  await fixture.submit();
  assert.deepEqual(submissions, [{ IDPGTOCORRETAGEM: "17, 29, 31" }]);
  controller.cleanup();
});

test("ComboBox remoto preserva escolhas literais ao mesclar resultados do SharePoint", async () => {
  const fixture = choiceFormFixture([], {
    multiple: true,
    name: "IDDOCUMENTOCORRETAGEM",
    dependencies: { FILIAL: "MATRIZ" },
  });
  const source = Object.freeze({
    kind: "dependent",
    listName: "DOCUMENTOS_1",
    valueField: "ID",
    dependsOn: [{ fieldName: "FILIAL", targetField: "FILIAL" }],
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    values: { IDDOCUMENTOCORRETAGEM: [], FILIAL: "MATRIZ" },
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "IDDOCUMENTOCORRETAGEM",
      label: "Documentos de corretagem",
      control: "select",
      choices: ["DISPENSADO"],
      allowMultipleValues: true,
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, failClosed: true, optionSources: [source] },
    }],
    async powerAppsOptionSearch() {
      return [{ value: "17", label: "17 - RECIBO" }];
    },
  });
  const { input, listbox } = mountedSearchable(fixture);

  input.dispatch("focus");
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.deepEqual(
    Array.from(listbox.children).map(option => option.textContent),
    ["DISPENSADO", "17 - RECIBO"],
  );
  controller.cleanup();
});

test("availability consulta o valor padrão e só libera a origem quando o candidato existe", async () => {
  const fixture = choiceFormFixture("", {
    name: "ATIVIDADEEXECUTADA",
    dependencies: { FILIAL: "MATRIZ", FORNECEDOR: "CONSTRUTORA A" },
  });
  const calls = [];
  const source = Object.freeze({
    kind: "dependent",
    entityId: "atividades-executadas",
    listName: "ATIVIDADE EXECUTADA",
    valueField: "ATIVIDADE EXECUTADA",
    dependsOn: [{ fieldName: "FILIAL", targetField: "FILIAL" }],
    displayFields: ["ATIVIDADEEXECUTADA"],
    searchFields: ["ATIVIDADEEXECUTADA"],
    availability: {
      kind: "lookup-value-exists-or-blank",
      lookup: {
        entityId: "fornecedores",
        listName: "FORNECEDORES",
        matchField: "CADASTRO",
        valueField: "ATIVIDADE EXERCIDA",
        dependency: { fieldName: "FORNECEDOR" },
      },
      candidateField: "ATIVIDADE EXECUTADA",
      candidateDependencies: [{ fieldName: "FILIAL", targetField: "FILIAL" }],
      whenBlank: "source",
      whenFound: "source",
      whenMissing: "empty",
    },
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    values: { FILIAL: "MATRIZ", FORNECEDOR: "CONSTRUTORA A", ATIVIDADEEXECUTADA: "" },
    columns: [{
      name: "ATIVIDADEEXECUTADA",
      label: "Atividade executada",
      control: "select",
      choices: [],
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, failClosed: true, optionSources: [source] },
    }],
    powerAppsOptionDebounceMs: 0,
    async powerAppsOptionSearch(_column, selectedSource, term, dependencies) {
      calls.push({ selectedSource, term, dependencies });
      if (selectedSource.listName === "FORNECEDORES") {
        return [{ value: "ALVENARIA", label: "ALVENARIA" }];
      }
      if ((selectedSource.fixedFilters || []).some(filter => filter.fieldName === "ATIVIDADE EXECUTADA")) {
        return [{ value: "ALVENARIA", label: "ALVENARIA" }];
      }
      return [{ value: "ALVENARIA", label: "ALVENARIA" }, { value: "PINTURA", label: "PINTURA" }];
    },
  });
  const { input, listbox } = mountedSearchable(fixture);

  input.value = "a";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.selectedSource.kind), ["filtered-list", "dependent", "dependent"]);
  assert.deepEqual(calls[0].selectedSource.fixedFilters, [{ fieldName: "CADASTRO", operator: "eq", value: "CONSTRUTORA A" }]);
  assert.deepEqual(calls[1].selectedSource.fixedFilters, [{ fieldName: "ATIVIDADE EXECUTADA", operator: "eq", value: "ALVENARIA" }]);
  assert.equal(calls[2].term, "a");
  assert.equal(listbox.children.length, 2);
  controller.cleanup();
});

test("availability com dependencia preenchida e lookup vazio não consulta a fonte principal", async () => {
  const fixture = choiceFormFixture("", {
    name: "ATIVIDADEEXECUTADA",
    dependencies: { FILIAL: "MATRIZ", FORNECEDOR: "SEM CADASTRO" },
  });
  const calls = [];
  const source = Object.freeze({
    kind: "dependent",
    listName: "ATIVIDADE EXECUTADA",
    valueField: "ATIVIDADE EXECUTADA",
    dependsOn: [{ fieldName: "FILIAL", targetField: "FILIAL" }],
    availability: {
      kind: "lookup-value-exists-or-blank",
      lookup: {
        listName: "FORNECEDORES",
        matchField: "CADASTRO",
        valueField: "ATIVIDADE EXERCIDA",
        dependency: { fieldName: "FORNECEDOR" },
      },
      candidateField: "ATIVIDADE EXECUTADA",
      whenBlank: "source",
      whenFound: "source",
      whenMissing: "empty",
    },
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    values: { FILIAL: "MATRIZ", FORNECEDOR: "SEM CADASTRO" },
    columns: [{
      name: "ATIVIDADEEXECUTADA",
      label: "Atividade executada",
      control: "select",
      choices: [],
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, failClosed: true, optionSources: [source] },
    }],
    powerAppsOptionDebounceMs: 0,
    async powerAppsOptionSearch(_column, selectedSource) {
      calls.push(selectedSource.listName);
      if (selectedSource.listName === "FORNECEDORES") return [];
      return [{ value: "ALVENARIA", label: "ALVENARIA" }];
    },
  });
  const { input, listbox } = mountedSearchable(fixture);

  input.dispatch("focus");
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.deepEqual(calls, ["FORNECEDORES"]);
  assert.equal(listbox.children.length, 0);
  controller.cleanup();
});

test("availability ausente fecha as opções sem consultar a pesquisa final", async () => {
  const fixture = choiceFormFixture("", {
    name: "ATIVIDADEEXECUTADA",
    dependencies: { FILIAL: "MATRIZ", FORNECEDOR: "CONSTRUTORA A" },
  });
  const calls = [];
  const source = Object.freeze({
    kind: "dependent",
    listName: "ATIVIDADE EXECUTADA",
    valueField: "ATIVIDADE EXECUTADA",
    dependsOn: [{ fieldName: "FILIAL", targetField: "FILIAL" }],
    availability: {
      kind: "lookup-value-exists-or-blank",
      lookup: {
        listName: "FORNECEDORES",
        matchField: "CADASTRO",
        valueField: "ATIVIDADE EXERCIDA",
        dependency: { fieldName: "FORNECEDOR" },
      },
      candidateField: "ATIVIDADE EXECUTADA",
      whenBlank: "source",
      whenFound: "source",
      whenMissing: "empty",
    },
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    values: { FILIAL: "MATRIZ", FORNECEDOR: "CONSTRUTORA A" },
    columns: [{
      name: "ATIVIDADEEXECUTADA",
      label: "Atividade executada",
      control: "select",
      choices: [],
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, failClosed: true, optionSources: [source] },
    }],
    powerAppsOptionDebounceMs: 0,
    async powerAppsOptionSearch(_column, selectedSource, term, dependencies) {
      calls.push({ selectedSource, term, dependencies });
      if (selectedSource.listName === "FORNECEDORES") return [{ value: "ALVENARIA", label: "ALVENARIA" }];
      return [];
    },
  });
  const { input, listbox } = mountedSearchable(fixture);

  input.value = "a";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(calls.length, 2);
  assert.equal(listbox.children.length, 0);
  controller.cleanup();
});

test("Form20_3 usa FILIAL do registro na consulta transitiva e reage ao descritivo local", async () => {
  const fixture = choiceFormFixture("ALVENARIA", {
    name: "ATIVIDADEEXECUTADA",
    dependencies: { IDDESCRITIVOETAPA: "42" },
  });
  const calls = [];
  const source = Object.freeze({
    kind: "dependent",
    entityId: "atividades-executadas",
    listName: "ATIVIDADE EXECUTADA",
    valueField: "ATIVIDADE EXECUTADA",
    dependsOn: [{
      controlName: "Gallery2_33",
      fieldName: "FILIAL",
      targetField: "FILIAL",
      valueFrom: "record",
    }],
    displayFields: ["ATIVIDADE EXECUTADA"],
    searchFields: ["ATIVIDADE EXECUTADA"],
    availability: {
      kind: "lookup-value-exists-or-blank",
      lookup: {
        entityId: "demonstrativos-de-etapa",
        listName: "DEMONSTRATIVOETAPA",
        matchField: "ID",
        valueField: "ETAPA",
        dependency: { fieldName: "IDDESCRITIVOETAPA" },
      },
      candidateField: "ETAPA",
      candidateDependencies: [{
        controlName: "Gallery2_33",
        fieldName: "FILIAL",
        targetField: "FILIAL",
        valueFrom: "record",
      }],
      whenBlank: "source",
      whenFound: "source",
      whenMissing: "empty",
    },
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: { ATIVIDADEEXECUTADA: "ALVENARIA", IDDESCRITIVOETAPA: "42" },
    defaultContext: { record: { FILIAL: "002 - OURO PRETO" } },
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "ATIVIDADEEXECUTADA",
      label: "Atividade executada",
      control: "select",
      choices: [],
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, preserveCurrentValue: true, optionSources: [source] },
    }],
    async powerAppsOptionSearch(_column, selectedSource, term, dependencies) {
      calls.push({ selectedSource, term, dependencies });
      if (selectedSource.listName === "DEMONSTRATIVOETAPA") {
        const id = selectedSource.fixedFilters[0].value;
        return [{ value: id === "43" ? "ACABAMENTO" : "ESTRUTURA", label: id === "43" ? "ACABAMENTO" : "ESTRUTURA" }];
      }
      if ((selectedSource.fixedFilters || []).length) {
        return [{ value: "ALVENARIA", label: "ALVENARIA" }];
      }
      return [{ value: "ALVENARIA", label: "ALVENARIA" }, { value: "PINTURA", label: "PINTURA" }];
    },
  });
  const { input } = mountedSearchable(fixture);

  assert.equal(input.value, "ALVENARIA");
  input.dispatch("focus");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(calls.at(-1).dependencies, { FILIAL: "002 - OURO PRETO" });
  assert.deepEqual(calls.at(-2).dependencies, { FILIAL: "002 - OURO PRETO" });
  assert.equal(calls[0].selectedSource.fixedFilters[0].value, "42");

  const descritivo = fixture.dependencyControls.get("IDDESCRITIVOETAPA");
  descritivo.value = "43";
  descritivo.dispatch("change");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls.at(-3).selectedSource.fixedFilters[0].value, "43");
  assert.deepEqual(calls.at(-1).dependencies, { FILIAL: "002 - OURO PRETO" });
  controller.cleanup();
});

test("Form20_3 falha fechado quando a dependência exigida do registro está ausente", async () => {
  const fixture = choiceFormFixture("", {
    name: "ETAPA",
    dependencies: {},
  });
  let searches = 0;
  const source = Object.freeze({
    kind: "dependent",
    listName: "LANCAMENTOOBRA",
    valueField: "ETAPA",
    dependsOn: [{ fieldName: "FILIAL", targetField: "FILIAL", valueFrom: "record" }],
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    values: { ETAPA: "" },
    defaultContext: { record: {} },
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "ETAPA",
      label: "Etapa",
      control: "select",
      choices: [],
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, failClosed: true, optionSources: [source] },
    }],
    async powerAppsOptionSearch() {
      searches += 1;
      return [{ value: "FUNDAÇÃO", label: "FUNDAÇÃO" }];
    },
  });
  const { input, listbox } = mountedSearchable(fixture);

  input.value = "f";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(searches, 0);
  assert.equal(listbox.children.length, 0);
  assert.match(fixture.powerAppsStatus.textContent, /registro.*FILIAL|FILIAL.*registro/i);
  controller.cleanup();
});

test("Form25 transforma o contrato antes do lookup transitivo e reage à troca local", async () => {
  const fixture = choiceFormFixture("APTO 101", {
    name: "IMOVEL",
    dependencies: { NUMEROCONTRATO: "17 - FORNECEDOR A" },
  });
  const calls = [];
  const source = Object.freeze({
    kind: "related",
    entityId: "imoveis",
    listName: "IMOVEL CADASTRADO",
    valueField: "IMOVEL",
    displayFields: ["IMOVEL"],
    searchFields: ["IMOVEL"],
    availability: {
      kind: "lookup-value-exists-or-blank",
      lookup: {
        entityId: "empreiteiros",
        listName: "EMPREITEIRO",
        matchField: "ID",
        valueField: "FILIAL",
        dependency: {
          fieldName: "NUMEROCONTRATO",
          transform: { kind: "split-first", separator: " - " },
        },
      },
      candidateField: "FILIAL",
      candidateDependencies: [],
      whenBlank: "source",
      whenFound: "source",
      whenMissing: "empty",
    },
  });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    mode: "edit",
    values: { IMOVEL: "APTO 101", NUMEROCONTRATO: "17 - FORNECEDOR A" },
    powerAppsOptionDebounceMs: 0,
    columns: [{
      name: "IMOVEL",
      label: "Imóvel",
      control: "select",
      choices: [],
      searchable: true,
      editable: true,
      hidden: false,
      powerApps: { closed: true, preserveCurrentValue: true, optionSources: [source] },
    }],
    async powerAppsOptionSearch(_column, selectedSource, term, dependencies) {
      calls.push({ selectedSource, term, dependencies });
      if (selectedSource.listName === "EMPREITEIRO") {
        const contractId = selectedSource.fixedFilters[0].value;
        return [{ value: contractId === "29" ? "004 - XAVANTE" : "002 - OURO PRETO", label: "FILIAL" }];
      }
      if ((selectedSource.fixedFilters || []).length) {
        return [{ value: "APTO 101", label: "APTO 101" }];
      }
      return [{ value: "APTO 101", label: "APTO 101" }, { value: "APTO 102", label: "APTO 102" }];
    },
  });
  const { input } = mountedSearchable(fixture);

  assert.equal(input.value, "APTO 101");
  input.dispatch("focus");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls[0].selectedSource.fixedFilters[0].value, "17");

  const contrato = fixture.dependencyControls.get("NUMEROCONTRATO");
  contrato.value = "29 - FORNECEDOR B";
  contrato.dispatch("change");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls.at(-3).selectedSource.fixedFilters[0].value, "29");

  input.value = "a";
  input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls.at(-1).term, "a");
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
