import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bindSignatureGallery,
  bindSignatureCanvas,
  createSignatureDialog,
  normalizeStoredSignature,
  signatureActionMarkup,
  signatureDialogMarkup,
  signatureGalleryEligible,
} from "../portal/ui/signature-dialog.js";
import { ENTITIES } from "../portal/catalog/entities.js";
import { resolvePowerAppsUiContract } from "../portal/catalog/powerapps-ui-contract.js";
import { entityGalleryMarkup } from "../portal/ui/entity-page.js";

const signatureEntities = [
  "lancamentos",
  "empreiteiros",
  "receitas",
  "descricoes-de-medicao",
];
const adminCss = readFileSync(new URL("../portal/styles/admin.css", import.meta.url), "utf8");

const signatureContract = Object.freeze({
  galleryVariant: Object.freeze({
    visibleFields: Object.freeze({ values: Object.freeze(["ID", "ASSINATURA"]) }),
    actions: Object.freeze({
      unresolved: Object.freeze([
        Object.freeze({ evidence: "=Set(MOSTRARASSINATURA,true)" }),
      ]),
    }),
  }),
});

test("o comando de assinatura exige entidade suportada, evidencia no contrato e permissao de edicao", () => {
  for (const id of signatureEntities) {
    assert.equal(signatureGalleryEligible({ entity: { id }, contract: signatureContract, canEdit: true }), true, id);
  }

  assert.equal(signatureGalleryEligible({ entity: { id: "lancamentos" }, contract: signatureContract, canEdit: false }), false);
  assert.equal(signatureGalleryEligible({ entity: { id: "lancamentos" }, contract: {}, canEdit: true }), false);
  assert.equal(signatureGalleryEligible({ entity: { id: "clientes" }, contract: signatureContract, canEdit: true }), false);
  assert.equal(signatureGalleryEligible({ entity: { id: "tickets" }, contract: signatureContract, canEdit: true }), false);
  assert.equal(signatureGalleryEligible({ entity: { id: "movimentacoes" }, contract: signatureContract, canEdit: true }), false);
});

test("os contratos reais das quatro galerias preservam a evidencia de assinatura do Power Apps", () => {
  for (const id of signatureEntities) {
    const entity = ENTITIES.find(candidate => candidate.id === id);
    const contract = resolvePowerAppsUiContract(entity, [
      { name: "Title", label: "Título", control: "text", editable: true, indexed: true },
      { name: "ASSINATURA", label: "ASSINATURA", control: "text", editable: true, indexed: false },
    ]);
    assert.equal(signatureGalleryEligible({ entity, contract, canEdit: true }), true, id);
  }
});

test("o botao aparece somente quando a galeria elegivel pode ser editada", () => {
  const enabled = signatureActionMarkup({
    entity: { id: "receitas" },
    item: { id: "18", fields: { ASSINATURA: "" } },
    contract: signatureContract,
    canEdit: true,
  });
  assert.match(enabled, /data-signature-open="18"/);
  assert.match(enabled, />Assinar</);

  const existing = signatureActionMarkup({
    entity: { id: "empreiteiros" },
    item: { id: "22", fields: { ASSINATURA: '"data:image\/png;base64,QUJD"' } },
    contract: signatureContract,
    canEdit: true,
  });
  assert.match(existing, />Ver assinatura</);

  assert.equal(signatureActionMarkup({ entity: { id: "clientes" }, item: { id: "1" }, contract: signatureContract, canEdit: true }), "");
  assert.equal(signatureActionMarkup({ entity: { id: "receitas" }, item: { id: "18" }, contract: signatureContract, canEdit: false }), "");
});

test("a assinatura existente aceita o JSON do Power Apps e recusa URL remota", () => {
  assert.equal(normalizeStoredSignature('"data:image/png;base64,QUJD"'), "data:image/png;base64,QUJD");
  assert.equal(normalizeStoredSignature("data:image/jpeg;base64,REVG"), "data:image/jpeg;base64,REVG");
  assert.equal(normalizeStoredSignature("https://sharepoint.example/signature.png?token=secret"), "");

  const markup = signatureDialogMarkup({
    item: { id: "22", fields: { ASSINATURA: '"data:image/png;base64,QUJD"' } },
  });
  assert.match(markup, /data-signature-existing/);
  assert.match(markup, /src="data:image\/png;base64,QUJD"/);
  assert.match(markup, /<canvas[^>]+data-signature-canvas[^>]+width="960"[^>]+height="320"/);
  assert.match(markup, /data-signature-clear[^>]*>Limpar</);
  assert.match(markup, /data-signature-cancel[^>]*>Cancelar</);
  assert.match(markup, /data-signature-save[^>]*>Gravar</);
  assert.doesNotMatch(signatureDialogMarkup({ item: { id: "1", fields: { ASSINATURA: "https://example.test/a.png" } } }), /https:\/\//);
});

test("o dialogo adapta o canvas a tela sem alterar sua resolucao interna", () => {
  assert.match(adminCss, /\.signature-dialog\s*\{[^}]*width:\s*min\(94vw,/s);
  assert.match(adminCss, /\.signature-pad canvas\s*\{[^}]*width:\s*100%[^}]*touch-action:\s*none/s);
  assert.match(adminCss, /@media \(max-width:\s*760px\)[\s\S]*\.signature-dialog\s*\{[^}]*width:\s*100vw/s);
});

function galleryData(contract, item) {
  return {
    uiContract: {
      ...contract,
      hasForm: true,
      readOnly: false,
      galleryColumns: [{ name: "Title", label: "Título", control: "text", indexed: true }],
      filterFields: [],
      searchFields: [],
      galleryFilters: [],
      galleryFixedFilters: {},
      galleryVariants: [],
    },
    columns: [{ name: "Title", label: "Título", control: "text", indexed: true }],
    filterOptionValues: {},
    rawItems: [item],
    metricItems: [item],
    query: { limitations: [] },
    items: {
      items: [item], totalKnown: true, total: 1, page: 1, pages: 1,
      batchCount: 1, loadedCount: 1, rangeStart: 1, rangeEnd: 1,
      hasMore: false, hasPrevious: false, isLastBatch: true,
    },
  };
}

test("as quatro galerias integram o comando de assinatura em cada registro", () => {
  for (const id of signatureEntities) {
    const entity = ENTITIES.find(candidate => candidate.id === id);
    const item = { id: "7", fields: { Title: "REGISTRO", ASSINATURA: "" } };
    const markup = entityGalleryMarkup(
      entity,
      galleryData(signatureContract, item),
      { page: 1, pageSize: 20, search: "", filters: {}, sort: { field: "", direction: "asc" } },
      { view: true, create: false, edit: true, delete: false, approve: false },
    );
    assert.match(markup, /data-signature-open="7"/, id);
  }
});

function fakeCanvas() {
  const listeners = new Map();
  const operations = [];
  const context = {
    lineCap: "",
    lineJoin: "",
    lineWidth: 0,
    strokeStyle: "",
    beginPath() { operations.push(["beginPath"]); },
    moveTo(x, y) { operations.push(["moveTo", x, y]); },
    lineTo(x, y) { operations.push(["lineTo", x, y]); },
    stroke() { operations.push(["stroke"]); },
    clearRect(x, y, width, height) { operations.push(["clearRect", x, y, width, height]); },
  };
  return {
    width: 960,
    height: 320,
    operations,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
    getContext(kind) { return kind === "2d" ? context : null; },
    getBoundingClientRect() { return { left: 10, top: 20, width: 480, height: 160 }; },
    setPointerCapture() {},
    trigger(name, event = {}) { return listeners.get(name)?.({ pointerId: 1, clientX: 250, clientY: 100, preventDefault() {}, ...event }); },
    toDataURL() { return "data:image/png;base64,VEVSQUNP"; },
  };
}

test("o canvas desenha com escala visual e limpar remove somente o desenho atual", () => {
  const canvas = fakeCanvas();
  const pad = bindSignatureCanvas(canvas);

  canvas.trigger("pointerdown", { clientX: 20, clientY: 30 });
  canvas.trigger("pointermove", { clientX: 250, clientY: 100 });
  canvas.trigger("pointerup");

  assert.deepEqual(canvas.operations.slice(0, 4), [
    ["beginPath"],
    ["moveTo", 20, 20],
    ["lineTo", 480, 160],
    ["stroke"],
  ]);
  assert.equal(pad.hasDrawing(), true);

  pad.clear();
  assert.deepEqual(canvas.operations.at(-1), ["clearRect", 0, 0, 960, 320]);
  assert.equal(pad.hasDrawing(), false);
  pad.destroy();
});

function fakeControl() {
  const listeners = new Map();
  return {
    disabled: false,
    textContent: "",
    hidden: false,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
    trigger(name, event = {}) { return listeners.get(name)?.({ preventDefault() {}, target: this, currentTarget: this, ...event }); },
  };
}

function fakeDialogHost(canvas = fakeCanvas()) {
  const dialog = {
    ...fakeControl(),
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
  const controls = {
    "[data-signature-dialog]": dialog,
    "[data-signature-canvas]": canvas,
    "[data-signature-clear]": fakeControl(),
    "[data-signature-cancel]": fakeControl(),
    "[data-signature-save]": fakeControl(),
    "[data-signature-status]": fakeControl(),
  };
  return {
    canvas,
    dialog,
    controls,
    innerHTML: "",
    querySelector(selector) { return controls[selector] || null; },
  };
}

test("o vinculador reutilizavel abre o item correto da galeria e remove seus eventos ao destruir", () => {
  const listeners = new Map();
  const button = {
    dataset: { signatureOpen: "52" },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
    trigger(name) { return listeners.get(name)?.({ preventDefault() {} }); },
  };
  const dialogHost = fakeDialogHost();
  const galleryRoot = {
    querySelectorAll(selector) { return selector === "[data-signature-open]" ? [button] : []; },
  };
  const item = { id: "52", eTag: '"1,1"', fields: { ASSINATURA: "" } };
  const binding = bindSignatureGallery(galleryRoot, {
    host: dialogHost,
    entity: { id: "receitas", siteKey: "personal" },
    contract: signatureContract,
    canEdit: true,
    listId: "receitas-list",
    items: [item],
    repository: { async updateItem() {} },
  });

  button.trigger("click");
  assert.equal(dialogHost.dialog.open, true);
  assert.match(dialogHost.innerHTML, /Registro #52/);

  binding.destroy();
  assert.equal(dialogHost.dialog.open, false);
  assert.equal(listeners.has("click"), false);
});

test("a gravacao usa eTag e so atualiza o estado local depois da confirmacao SharePoint", async () => {
  const host = fakeDialogHost();
  const calls = [];
  const localUpdates = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const item = { id: "31", eTag: '"4,1"', fields: { ASSINATURA: "" } };
  const component = createSignatureDialog(host, {
    entity: { id: "lancamentos", siteKey: "personal" },
    listId: "lancamentos-list",
    item,
    contract: signatureContract,
    canEdit: true,
    repository: {
      async updateItem(...args) { calls.push(args); return pending; },
    },
    onSaved(saved) { localUpdates.push(saved); },
  });

  const saving = component.save();
  assert.deepEqual(calls, [[
    "personal",
    "lancamentos-list",
    "31",
    { ASSINATURA: '"data:image/png;base64,VEVSQUNP"' },
    { eTag: '"4,1"' },
  ]]);
  assert.equal(localUpdates.length, 0);
  assert.equal(host.dialog.open, true);

  release({ id: "31", eTag: '"4,2"', fields: { ASSINATURA: '"data:image/png;base64,VEVSQUNP"' } });
  await saving;

  assert.equal(localUpdates.length, 1);
  assert.equal(localUpdates[0].eTag, '"4,2"');
  assert.equal(host.dialog.open, false);
});

test("erro preserva o desenho e permite gravar novamente sem atualizar a galeria antes da hora", async () => {
  const host = fakeDialogHost();
  const localUpdates = [];
  let attempts = 0;
  const item = { id: "44", "@odata.etag": '"8,1"', fields: { ASSINATURA: "" } };
  const component = createSignatureDialog(host, {
    entity: { id: "descricoes-de-medicao", siteKey: "personal" },
    listId: "medicoes-list",
    item,
    contract: signatureContract,
    canEdit: true,
    repository: {
      async updateItem() {
        attempts += 1;
        if (attempts === 1) throw new Error("SharePoint indisponível");
        return { id: "44", eTag: '"8,2"', fields: { ASSINATURA: '"data:image/png;base64,VEVSQUNP"' } };
      },
    },
    onSaved(saved) { localUpdates.push(saved); },
  });

  await component.save();
  assert.equal(component.getState().error, "SharePoint indisponível");
  assert.equal(host.dialog.open, true);
  assert.equal(localUpdates.length, 0);
  assert.equal(host.canvas.operations.some(operation => operation[0] === "clearRect"), false);
  assert.equal(host.controls["[data-signature-save]"].disabled, false);

  await component.save();
  assert.equal(attempts, 2);
  assert.equal(localUpdates.length, 1);
  assert.equal(host.dialog.open, false);
});
