import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { createRegistrationGalleryData } from "../src/chat/registration-gallery-data.js";
import { createRegistrationGallery } from "../src/ui/registration-gallery-view.js";

const cases = [
  ["group", "CADASTROGRUPO", "G10- HISTÓRICO GRUPO", "GRUPO"],
  ["family", "CADASTRO FAMÍLIA_1", "G8- HISTÓRICO FAMÍLIA", "FAMÍLIA"],
  ["subfamily", "CADASTROSUBFAMÍLIA", "G35- HISTÓRICO SUBFAMÍLIA", "SUBFAMÍLIAS CADASTRADAS"],
  ["product", "CADASTROPRODUTO", "G38- HISTÓRICO PRODUTO", "PRODUTO"],
];

for (const [kind, listName, screen, primaryField] of cases) {
  test(`${kind} consulta a lista do modelo PowerApps ${screen}`, async () => {
    const resolved = [];
    const repository = {
      async resolveList(site, aliases) { resolved.push([site, aliases]); return { status: "resolved", id: listName }; },
      async getItemsPage() { return { items: [{ id: "12", fields: { [primaryField]: "EXEMPLO", STATUS: "ATIVO" } }], hasMore: false }; },
    };
    const data = createRegistrationGalleryData({ kind, repository });
    const snapshot = await data.loadSnapshot();
    assert.equal(resolved[0][0], "personal");
    assert.equal(resolved[0][1][0], listName);
    assert.equal(snapshot.rows[0].fields[primaryField], "EXEMPLO");
    assert.equal(snapshot.rows[0].id, "12");
  });
}

test("galeria exibe registros, filtra pelo nome e permite voltar", async () => {
  const dom = new JSDOM("<!doctype html><body><button id='origin'>Abrir</button></body>");
  const doc = dom.window.document;
  const gallery = createRegistrationGallery({
    document: doc,
    kind: "family",
    data: { async loadSnapshot() { return { rows: [
      { id: "1", fields: { "FAMÍLIA": "ELÉTRICA", GRUPO: "MATERIAL", STATUS: "ATIVO" } },
      { id: "2", fields: { "FAMÍLIA": "HIDRÁULICA", GRUPO: "MATERIAL", STATUS: "BLOQUEADO" } },
    ] }; } },
  });
  await gallery.open();
  assert.equal(doc.querySelector('[role="dialog"] h1').textContent, "GALERIA FAMÍLIA");
  assert.equal(doc.querySelectorAll("[data-registration-row]").length, 2);
  const search = doc.querySelector('[type="search"]');
  search.value = "HIDRÁULICA";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(doc.querySelectorAll("[data-registration-row]").length, 1);
  assert.match(doc.querySelector("[data-registration-row]").textContent, /HIDRÁULICA/);
  doc.querySelector('[data-action="registration-close"]').click();
  assert.equal(doc.querySelector('[role="dialog"]').hidden, true);
  gallery.destroy();
  dom.window.close();
});

test("galerias interpretam os nomes internos SharePoint dos campos PowerApps", async () => {
  for (const [kind, fields, expected] of [
    ["group", { Title: "ELÉTRICO", STATUS: "ATIVO" }, "ELÉTRICO"],
    ["family", { Title: "MATERIAL", field_1: "CABOS", STATUS: "ATIVO" }, "CABOS"],
    ["subfamily", { Title: "CABOS", field_1: "FLEXÍVEL", field_3: "DESPESA", STATUS: "ATIVO" }, "FLEXÍVEL"],
    ["product", { Title: "FLEXÍVEL", field_1: "CABO 2,5", SATUS: "BLOQUEADO" }, "CABO 2,5"],
  ]) {
    const dom = new JSDOM("<!doctype html><body></body>");
    const doc = dom.window.document;
    const gallery = createRegistrationGallery({ document: doc, kind, data: { async loadSnapshot() { return { rows: [{ id: "7", fields }] }; } } });
    await gallery.open();
    assert.match(doc.querySelector("[data-registration-row]").textContent, new RegExp(expected), kind);
    gallery.destroy();
    dom.window.close();
  }
});
