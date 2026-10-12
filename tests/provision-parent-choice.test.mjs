import assert from "node:assert/strict";
import test from "node:test";
import { createEntityPage } from "../portal/ui/entity-page.js";
import { ENTITIES } from "../portal/catalog/entities.js";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";

function rootHarness() {
  let markup = "";
  let formMarkup = "";
  const controls = new Map();
  function control(selector) {
    if (!controls.has(selector)) {
      const listeners = new Map();
      controls.set(selector, {
        value: "", disabled: false, hidden: false, innerHTML: "", textContent: "", dataset: {},
        classList: { toggle() {} },
        addEventListener(name, listener) { listeners.set(name, listener); },
        removeEventListener(name) { listeners.delete(name); },
        async trigger(name, value) { if (value !== undefined) this.value = value; await listeners.get(name)?.({ target: this, currentTarget: this, preventDefault() {} }); },
        querySelector() { return null; }, querySelectorAll() { return []; },
        setAttribute() {}, removeAttribute() {},
      });
    }
    return controls.get(selector);
  }
  const form = control("form");
  form.elements = { namedItem() { return null; }, *[Symbol.iterator]() {} };
  form.reportValidity = () => true;
  form.insertAdjacentHTML = (_position, value) => { formMarkup += value; };
  const formHost = {
    get innerHTML() { return formMarkup; },
    set innerHTML(value) { formMarkup = value; },
    querySelector(selector) {
      if (selector === "[data-dynamic-form]") return form;
      if (selector.startsWith("[data-provisao-payment-stage")) return null;
      if (formMarkup.includes(selector.replace(/[\[\]]/g, ""))) return control(selector);
      return null;
    },
    querySelectorAll() { return []; },
  };
  form.querySelector = selector => formHost.querySelector(selector);
  const queue = { innerHTML: "", querySelector() { return null; }, querySelectorAll() { return []; } };
  return {
    get innerHTML() { return markup; }, set innerHTML(value) { markup = value; formMarkup = ""; },
    get formMarkup() { return formMarkup; },
    querySelector(selector) {
      if (selector === "[data-entity-form]") return formHost;
      if (selector === "[data-multi-entry-host]") return queue;
      return markup.includes(selector.replace(/[\[\]]/g, "")) ? control(selector) : null;
    },
    querySelectorAll() { return []; },
    control,
  };
}

async function openPage() {
  const root = rootHarness(); const calls = [];
  const fields = ["Title", "FILIAL", "FORNECEDOR", "FORMAPGTO", "OBS", "VALORTOTAL", "DATAPREVISTOPGTO", "DATAPGTOEFETUADO", "PGTOAGENDADO", "DATAPGTOAGENDADO", "DATAEXECUCAOAGENDAMENTO"];
  const page = createEntityPage(root, {
    entity: ENTITIES.find(item => item.id === "provisoes-de-pagamento"),
    access: buildSuperAdminAccess("admin@energeticabr.com", "Admin"), can, initialFormOpen: true,
    repository: {
      async resolveList(_site, aliases) { calls.push(["resolve", aliases]); return { status: "resolved", id: aliases.includes("DESCRITIVOPROVISAO") ? "parents" : "children" }; },
      async getColumns(_site, id) { return (id === "parents" ? fields : ["Title", "FILIAL", "QTD", "VALORTOTAL", "FRETE", "DESCRITIVOPROVISAO", "STATUS", "PGTOAGENDADO", "DATAPGTOEFETUADO"]).map(name => ({ name, displayName: name, ...(name.startsWith("DATA") || id === "parents" && name === "PGTOAGENDADO" ? { dateTime: {} } : { text: {} }) })); },
      async getItemsPage() { return { items: [], nextLink: "", hasMore: false, batchCount: 0 }; },
      async getItems(_site, id) { calls.push(["read", id]); return id === "children" ? [{ id: "1", fields: { DESCRITIVOPROVISAO: "10", STATUS: "PAGAMENTO PREVISTO", DATAPGTOEFETUADO: null, PGTOAGENDADO: "PENDENTE" } }] : [{ id: "10", eTag: '"10,1"', fields: { FORNECEDOR: "Fornecedor A", FILIAL: "001", DATAPREVISTOPGTO: "2026-11-01", VALORTOTAL: "10" } }]; },
      async createItem() { calls.push(["write"]); throw new Error("UI composition must not write"); },
    },
  });
  await page.ready;
  return { root, calls, page };
}

test("provision creation form defaults to new parent and offers pending parent choice offline", async () => {
  const { root, calls, page } = await openPage();
  assert.match(root.formMarkup, /data-provision-parent-mode/);
  assert.match(root.formMarkup, /NOVO DESCRITIVO/);
  assert.match(root.formMarkup, /VINCULAR A DESCRITIVO PENDENTE/);
  assert.equal(calls.filter(call => call[0] === "write").length, 0);
  page.cleanup();
});

test("changing to existing loads ID supplier branch due total without composing writes", async () => {
  const { root, calls, page } = await openPage();
  await root.control("[data-provision-parent-mode]").trigger("change", "existing");
  const options = root.control("[data-provision-parent-id]");
  for (const text of ["10", "Fornecedor A", "001", "2026-11-01"]) assert.ok(options.innerHTML.includes(text));
  assert.ok(calls.some(call => call[0] === "read" && call[1] === "parents"));
  assert.equal(calls.filter(call => call[0] === "write").length, 0);
  page.cleanup();
});
