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

test('a fresh edit search starts empty and preserves the committed option until another is chosen', () => {
  const { control, changes } = fixture({ value: 'ana', clearSelectionLabelOnOpen: true });
  control.input.dispatch('focus');
  assert.equal(control.input.value, '');
  assert.equal(control.getValue(), 'ana');
  assert.equal(control.visibleOptions().length, 3);
  assert.deepEqual(changes, []);
  control.input.value = 'bruno';
  control.input.dispatch('input');
  assert.deepEqual(control.visibleOptions().map(option => option.value), ['bruno']);
  assert.equal(control.getValue(), 'ana');
  control.listbox.children[0].dispatch('click');
  assert.equal(control.getValue(), 'bruno');
  assert.equal(changes.length, 1);
});

test('typing or pasting after choosing starts a new query without appending to the committed label', () => {
  for (const name of ['beforeinput', 'paste', 'drop', 'compositionstart']) {
    const { control, changes } = fixture({ value: 'ana', clearSelectionLabelOnOpen: true });
    control.input.dispatch(name);
    assert.equal(control.input.value, '', name);
    assert.equal(control.getValue(), 'ana');
    assert.deepEqual(changes, []);
    control.input.value = 'car';
    control.input.dispatch('input');
    control.listbox.children[0].dispatch('click');
    assert.equal(control.getValue(), 'carla');
    control.input.dispatch(name);
    assert.equal(control.input.value, '', `${name} after choosing with focus retained`);
    assert.equal(control.getValue(), 'carla');
  }
});

test('opening or refreshing an active edit query does not reset what the user is already typing', () => {
  const { control } = fixture({ value: 'ana', clearSelectionLabelOnOpen: true });
  control.input.dispatch('focus');
  control.input.value = 'Ana Beatriz Almeida';
  control.input.dispatch('input');
  control.input.dispatch('click');
  assert.equal(control.input.value, 'Ana Beatriz Almeida');
  control.setOptions(OPTIONS, { preserveInput: true });
  assert.equal(control.input.value, 'Ana Beatriz Almeida');
  control.input.dispatch('blur');
  assert.equal(control.input.value, 'Ana Beatriz Almeida');
  control.input.dispatch('focus');
  assert.equal(control.input.value, '');
  control.input.dispatch('keydown', { key: 'Escape' });
  assert.equal(control.input.value, 'Ana Beatriz Almeida');
  assert.equal(control.getValue(), 'ana');
});

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

test("abrir uma seleção existente mostra todas as opções sem perder o valor atual", () => {
  const { control } = fixture({ value: "bruno" });

  control.input.focus();
  control.input.dispatch("focus");

  assert.deepEqual(control.visibleOptions().map(option => option.value), ["ana", "bruno", "carla"]);
  assert.equal(control.input.getAttribute("aria-expanded"), "true");
  assert.equal(control.getValue(), "bruno");
  assert.equal(control.input.value, "Bruno Almeida Costa");
});

test("apagar o texto limpa a seleção e o blur não restaura o dado excluído", () => {
  const { control, changes } = fixture({ value: "bruno" });
  type(control, "");
  control.input.dispatch("blur");
  assert.equal(control.getValue(), "");
  assert.equal(control.input.value, "");
  assert.deepEqual(changes, [{ value: "", option: null }]);
});

test("atualização remota preserva pesquisa, seleção e intenção de abrir ou fechar", () => {
  const { control } = fixture({ value: "bruno" });
  control.input.dispatch("focus");
  control.setOptions(OPTIONS, { preserveInput: true });
  assert.equal(control.input.value, "Bruno Almeida Costa");
  assert.equal(control.visibleOptions().length, 3);
  type(control, "car");
  control.setOptions(OPTIONS, { preserveInput: true });
  assert.equal(control.input.value, "car");
  assert.deepEqual(control.visibleOptions().map(option => option.value), ["carla"]);
  control.input.dispatch("keydown", { key: "Escape" });
  control.setOptions(OPTIONS, { preserveInput: true });
  assert.equal(control.listbox.hidden, true);
  control.input.dispatch("focus");
  control.input.dispatch("blur");
  control.setOptions(OPTIONS, { preserveInput: true });
  assert.equal(control.listbox.hidden, true);
});

test("botão de limpar remove a seleção, mas respeita um campo bloqueado", () => {
  const { control } = fixture({ value: "bruno", clearable: true });
  const clear = Array.from(control.element.children).find(child => child.getAttribute("data-searchable-clear") !== null);
  assert.ok(clear);
  control.input.dispatch("focus");
  for (const event of ["pointerdown", "mousedown"]) {
    assert.equal(clear.dispatch(event).defaultPrevented, true, "do not blur/collapse the list and move the clear button before click");
  }
  control.input.disabled = true;
  clear.dispatch("click");
  assert.equal(control.getValue(), "bruno");
  control.input.disabled = false;
  clear.dispatch("click");
  assert.equal(control.getValue(), "");
  assert.equal(clear.hidden, true);
});

test("Escape cancela pesquisa sem resultados antes de liberar o fechamento do formulário", () => {
  const { control } = fixture({ value: "bruno" });
  type(control, "nenhum resultado");
  assert.equal(control.listbox.hidden, true);
  assert.equal(control.input.dispatch("keydown", { key: "Escape" }).defaultPrevented, true);
  assert.equal(control.input.value, "Bruno Almeida Costa");
  assert.equal(control.input.dispatch("keydown", { key: "Escape" }).defaultPrevented, false);
});

test("resultados do provedor podem corresponder a outro campo sem aceitar texto livre nem vazar para outra pesquisa", () => {
  const { control } = fixture();
  type(control, "assinatura-123");
  control.setOptions(OPTIONS, { preserveInput:true, matchingValues:["carla"] });
  assert.deepEqual(control.visibleOptions().map(option=>option.value), ["carla"]);
  assert.equal(control.getValue(), "");
  type(control, "outro termo");
  assert.equal(control.visibleOptions().length, 0);
  control.input.dispatch("blur");
  control.setOptions(OPTIONS, { preserveInput:true, matchingValues:["carla"] });
  assert.equal(control.listbox.hidden, true);
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

test("Enter de composição IME não confirma uma opção nem interrompe a digitação", () => {
  const { control, changes } = fixture();
  type(control, "almeida");
  control.input.dispatch("keydown", { key: "ArrowDown" });
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    const event = control.input.dispatch("keydown", { key: "Enter", ...composition });
    assert.equal(event.defaultPrevented, false);
    assert.equal(control.getValue(), "");
    assert.equal(control.input.getAttribute("aria-expanded"), "true");
    assert.deepEqual(changes, []);
  }
  control.input.dispatch("keydown", { key: "Enter" });
  assert.equal(control.getValue(), "ana");
  assert.equal(changes.length, 1);
});

test("Escape fecha a lista, preserva a seleção e não aceita o texto pesquisado como valor", () => {
  const { control, changes } = fixture({ value: "carla" });
  type(control, "texto inexistente");
  assert.equal(control.getValue(), "carla");

  control.input.dispatch("keydown", { key: "Escape" });

  assert.equal(control.input.getAttribute("aria-expanded"), "false");
  assert.equal(control.input.value, "Carla Souza");
  assert.equal(control.getValue(), "carla");
  assert.deepEqual(changes, []);
});

test("clique seleciona somente a opção correspondente e setOptions revoga valor removido", () => {
  const { control, changes } = fixture();
  type(control, "carla");
  const mouseDown = control.listbox.children[0].dispatch("mousedown");
  assert.equal(mouseDown.defaultPrevented, true);
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

test("aceita a opção vazia Todos somente quando allowEmpty está habilitado", () => {
  const todos = Object.freeze({ value: "", label: "Todos" });
  const { control, changes } = fixture({
    allowEmpty: true,
    options: [todos, ...OPTIONS],
    value: "",
  });

  assert.equal(control.getValue(), "");
  assert.equal(control.input.value, "Todos");

  control.setValue("ana");
  control.setValue("");

  assert.equal(control.input.value, "Todos");
  assert.deepEqual(changes, [
    { value: "ana", option: OPTIONS[0] },
    { value: "", option: todos },
  ]);
});
