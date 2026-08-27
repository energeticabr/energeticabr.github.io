import assert from "node:assert/strict";
import test from "node:test";

import { createSearchableSelect } from "../portal/forms/searchable-select.js";

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
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.parentNode = null;
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

const OPTIONS = Object.freeze([
  Object.freeze({ value: "ana", label: "Ana Beatriz Almeida" }),
  Object.freeze({ value: "bruno", label: "Bruno Almeida Costa" }),
  Object.freeze({ value: "carla", label: "Carla Souza" }),
]);

function fixture(config = {}) {
  const document = new FakeDocument();
  const root = document.createElement("div");
  const changes = [];
  const control = createSearchableSelect(root, {
    id: "cliente",
    label: "Cliente",
    options: OPTIONS,
    onChange(value, option) { changes.push({ value, option }); },
    ...config,
  });
  return { document, root, control, changes };
}

function type(control, value) {
  control.input.value = value;
  control.input.dispatch("input");
}

test("aceita valor pre-selecionado somente quando pertence às opções", () => {
  const valid = fixture({ value: "bruno" }).control;
  assert.equal(valid.getValue(), "bruno");
  assert.equal(valid.input.value, "Bruno Almeida Costa");

  const invalid = fixture({ value: "fora-da-lista" }).control;
  assert.equal(invalid.getValue(), "");
  assert.equal(invalid.input.value, "");
  assert.equal(invalid.setValue("fora-da-lista"), false);
  assert.equal(invalid.getValue(), "");
});

test("expõe semântica ARIA de combobox e listbox", () => {
  const { control } = fixture();

  assert.equal(control.input.getAttribute("role"), "combobox");
  assert.equal(control.input.getAttribute("aria-autocomplete"), "list");
  assert.equal(control.input.getAttribute("aria-controls"), "cliente-listbox");
  assert.equal(control.input.getAttribute("aria-expanded"), "false");
  assert.equal(control.input.getAttribute("aria-label"), "Cliente");
  assert.equal(control.listbox.getAttribute("role"), "listbox");
  assert.equal(control.listbox.getAttribute("id"), "cliente-listbox");
});

test("filtra por múltiplos termos sem substituir nem desfocar o campo", () => {
  const { control, document } = fixture();
  const originalInput = control.input;
  originalInput.focus();

  type(control, "almeida");
  type(control, "almeida ana");

  assert.equal(control.input, originalInput);
  assert.equal(document.activeElement, originalInput);
  assert.deepEqual(control.visibleOptions().map(option => option.value), ["ana"]);
  assert.equal(control.listbox.children.length, 1);
  assert.equal(control.listbox.children[0].textContent, "Ana Beatriz Almeida");
  assert.equal(control.input.getAttribute("aria-expanded"), "true");
});

test("teclado navega, seleciona uma única opção e fecha a lista", () => {
  const { control, changes } = fixture();
  type(control, "almeida");

  const down = control.input.dispatch("keydown", { key: "ArrowDown" });
  assert.equal(down.defaultPrevented, true);
  assert.equal(control.input.getAttribute("aria-activedescendant"), "cliente-option-0");
  assert.equal(control.listbox.children[0].getAttribute("aria-selected"), "true");
  control.input.dispatch("keydown", { key: "ArrowDown" });
  assert.equal(control.input.getAttribute("aria-activedescendant"), "cliente-option-1");
  control.input.dispatch("keydown", { key: "ArrowUp" });
  assert.equal(control.input.getAttribute("aria-activedescendant"), "cliente-option-0");

  const enter = control.input.dispatch("keydown", { key: "Enter" });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(control.getValue(), "ana");
  assert.equal(control.input.value, "Ana Beatriz Almeida");
  assert.equal(control.input.getAttribute("aria-expanded"), "false");
  assert.equal(control.input.getAttribute("aria-activedescendant"), null);
  assert.deepEqual(changes, [{ value: "ana", option: OPTIONS[0] }]);
});

test("Escape fecha a lista sem aceitar o texto pesquisado como valor", () => {
  const { control, changes } = fixture({ value: "carla" });
  type(control, "texto inexistente");
  assert.equal(control.getValue(), "");

  control.input.dispatch("keydown", { key: "Escape" });

  assert.equal(control.input.getAttribute("aria-expanded"), "false");
  assert.equal(control.getValue(), "");
  assert.deepEqual(changes, [{ value: "", option: null }]);
});

test("clique seleciona somente a opção correspondente e setOptions revoga valor removido", () => {
  const { control, changes } = fixture();
  type(control, "carla");
  control.listbox.children[0].dispatch("click");

  assert.equal(control.getValue(), "carla");
  assert.equal(control.input.value, "Carla Souza");
  assert.deepEqual(changes, [{ value: "carla", option: OPTIONS[2] }]);

  control.setOptions([{ value: "ana", label: "Ana Beatriz Almeida" }]);
  assert.equal(control.getValue(), "");
  assert.equal(control.input.value, "");
  assert.deepEqual(changes.at(-1), { value: "", option: null });
});

test("rejeita opções inválidas ou com valores duplicados", () => {
  assert.throws(
    () => fixture({ options: [{ value: "1", label: "Um" }, { value: "1", label: "Outro" }] }),
    /opções.*válidas e únicas/i,
  );
  assert.throws(() => fixture({ options: [{ value: "", label: "Sem valor" }] }), /opções.*válidas e únicas/i);
});
