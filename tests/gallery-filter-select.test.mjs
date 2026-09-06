import assert from "node:assert/strict";
import test from "node:test";

import { createGalleryFilterSelect } from "../portal/ui/gallery-filter-select.js";

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

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = options.bubbles === true;
    this.defaultPrevented = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
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
    this.multiple = false;
    this.selected = false;
    this.type = "";
    this.value = "";
    this.label = "";
    this.textContent = "";
    this.className = "";
    this.parentNode = null;
  }

  get options() {
    return this.tagName === "SELECT" ? this.childNodes : undefined;
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

  hasAttribute(name) {
    return this.attributes.has(name);
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

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return !event.defaultPrevented;
  }

  dispatch(name, properties = {}) {
    return this.dispatchEvent(Object.assign(new FakeEvent(name), properties));
  }
}

class FakeDocument {
  constructor() {
    this.defaultView = { Event: FakeEvent };
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

function appendOption(document, select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.label = label;
  option.textContent = label;
  select.append(option);
  return option;
}

function fixture({ value = "", hidden = false } = {}) {
  const document = new FakeDocument();
  const select = document.createElement("select");
  const mount = document.createElement("div");
  select.setAttribute("id", "filtro-filial");
  select.setAttribute("aria-label", "Filial");
  select.hidden = hidden;
  appendOption(document, select, "", "Todos");
  appendOption(document, select, "002", "002 - Ouro Preto");
  appendOption(document, select, "004", "004 - Edifício Xavante");
  select.value = value;
  return { document, select, mount };
}

test("lê as opções e o valor do select nativo, incluindo Todos", () => {
  const { select, mount } = fixture();
  const adapter = createGalleryFilterSelect(select, mount);

  assert.ok(adapter);
  assert.equal(select.hidden, true);
  assert.equal(adapter.control.getValue(), "");
  assert.equal(adapter.control.input.value, "Todos");
  assert.deepEqual(
    adapter.control.search("xavante").map(option => option.value),
    ["004"],
  );
});

test("sincroniza uma escolha pesquisada e dispara exatamente um change nativo", () => {
  const { select, mount } = fixture();
  let changes = 0;
  select.addEventListener("change", () => { changes += 1; });
  const adapter = createGalleryFilterSelect(select, mount);

  adapter.control.search("ouro");
  adapter.control.listbox.children[0].dispatch("click");

  assert.equal(select.value, "002");
  assert.equal(changes, 1);
  assert.equal(adapter.control.getValue(), "002");
});

test("reflete uma mudança externa do select sem emitir um segundo change", () => {
  const { select, mount } = fixture({ value: "002" });
  let changes = 0;
  select.addEventListener("change", () => { changes += 1; });
  const adapter = createGalleryFilterSelect(select, mount);

  select.value = "004";
  select.dispatchEvent(new FakeEvent("change", { bubbles: true }));

  assert.equal(changes, 1);
  assert.equal(adapter.control.getValue(), "004");
  assert.equal(adapter.control.input.value, "004 - Edifício Xavante");
});

test("destroy remove a sincronização e restaura o estado visual original", () => {
  const { select, mount } = fixture();
  select.setAttribute("aria-hidden", "false");
  const adapter = createGalleryFilterSelect(select, mount);
  const searchableInput = adapter.control.input;

  adapter.destroy();

  assert.equal(select.hidden, false);
  assert.equal(select.getAttribute("aria-hidden"), "false");
  assert.equal(mount.children.length, 0);

  select.value = "004";
  select.dispatchEvent(new FakeEvent("change", { bubbles: true }));
  assert.equal(searchableInput.value, "Todos");
});

test("transforma o filtro múltiplo em pesquisa com seleções removíveis", () => {
  const document = new FakeDocument();
  const multiple = document.createElement("select");
  const multipleMount = document.createElement("div");
  multiple.multiple = true;
  multiple.setAttribute("multiple", "");
  const first = appendOption(document, multiple, "FINALIZADO", "FINALIZADO");
  const second = appendOption(document, multiple, "PENDENTE", "PENDENTE");
  first.selected = true;
  let changes = 0;
  multiple.addEventListener("change", () => { changes += 1; });

  const adapter = createGalleryFilterSelect(multiple, multipleMount, { label: "Pesquisar STATUS" });

  assert.ok(adapter);
  assert.equal(multiple.hidden, true);
  assert.equal(adapter.selectionList.children.length, 1);
  adapter.control.search("pend");
  adapter.control.listbox.children[0].dispatch("click");
  assert.equal(first.selected, true);
  assert.equal(second.selected, true);
  assert.equal(changes, 1);
  assert.equal(adapter.selectionList.children.length, 2);

  adapter.selectionList.children[0].children[1].dispatch("click");
  assert.equal(first.selected, false);
  assert.equal(second.selected, true);
  assert.equal(changes, 2);

  adapter.destroy();
  assert.equal(multiple.hidden, false);
  assert.equal(multipleMount.children.length, 0);
});

test("ignora data e toggle sem alterar os elementos", () => {
  const document = new FakeDocument();
  const date = document.createElement("input");
  const toggle = document.createElement("input");
  const dateMount = document.createElement("div");
  const toggleMount = document.createElement("div");
  date.type = "date";
  toggle.type = "checkbox";

  assert.equal(createGalleryFilterSelect(date, dateMount), null);
  assert.equal(createGalleryFilterSelect(toggle, toggleMount), null);
  assert.equal(date.hidden, false);
  assert.equal(toggle.hidden, false);
  assert.equal(dateMount.children.length, 0);
  assert.equal(toggleMount.children.length, 0);
});
