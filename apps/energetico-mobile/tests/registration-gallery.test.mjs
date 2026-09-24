import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.equal(doc.querySelector('[role="dialog"] select').value, "ATIVO");
  assert.equal(doc.querySelectorAll("[data-registration-row]").length, 1);
  const status = doc.querySelector('[role="dialog"] select');
  status.value = "";
  status.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
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

test("falha ao atualizar mantém aviso de erro e reinicia paginação", async () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const doc = dom.window.document;
  let fails = false;
  const gallery = createRegistrationGallery({ document: doc, kind: "group", data: {
    async loadSnapshot() {
      if (fails) throw new Error("offline");
      return { rows: Array.from({ length: 25 }, (_, index) => ({ id: String(index + 1), fields: { Title: `GRUPO ${index + 1}` } })) };
    },
  } });
  await gallery.open();
  const [previous, next] = doc.querySelectorAll(".rg-pagination button");
  next.click();
  assert.match(doc.querySelector(".rg-pagination span").textContent, /Página 2/);
  fails = true;
  doc.querySelector(".rg-toolbar > button").click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(doc.querySelector(".rg-feedback").textContent, /Não foi possível carregar/);
  assert.match(doc.querySelector(".rg-pagination span").textContent, /Página 1 de 1/);
  assert.equal(previous.disabled, true);
  assert.equal(next.disabled, true);
  doc.querySelector('input[type="search"]').value = "OUTRO";
  doc.querySelector('input[type="search"]').dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.match(doc.querySelector(".rg-feedback").textContent, /Não foi possível carregar/);
  gallery.destroy();
  dom.window.close();
});

test("galeria mantém Tab dentro do diálogo e cabeçalho visível na rolagem", async () => {
  const dom = new JSDOM("<!doctype html><body><button id='behind'>Fundo</button></body>");
  const doc = dom.window.document;
  const gallery = createRegistrationGallery({ document: doc, kind: "group", data: {
    async loadSnapshot() { return { rows: Array.from({ length: 25 }, (_, index) => ({ id: String(index + 1), fields: { Title: `GRUPO ${index + 1}` } })) }; },
  } });
  await gallery.open();
  const dialog = doc.querySelector('.rg-overlay');
  const first = dialog.querySelector('button');
  const last = dialog.querySelector('.rg-pagination button:last-child');
  last.focus();
  last.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(doc.activeElement, first);
  first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(doc.activeElement, last);
  const css = readFileSync(new URL('../src/ui/registration-gallery.css', import.meta.url), 'utf8');
  assert.match(css, /\.rg-header\s*\{[^}]*position:\s*sticky/);
  gallery.destroy();
  dom.window.close();
});

test("menu de cadastros reserva altura suficiente para rótulos em 320 px", () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media\s*\(max-width:\s*360px\)\s*\{[^}]*--registration-row-height:\s*78px/);
});

test("galerias interpretam os nomes internos SharePoint dos campos PowerApps", async () => {
  for (const [kind, fields, expected] of [
    ["group", { Title: "ELÉTRICO", STATUS: "ATIVO" }, "ELÉTRICO"],
    ["family", { Title: "MATERIAL", field_1: "CABOS", STATUS: "ATIVO" }, "CABOS"],
    ["subfamily", { Title: "CABOS", field_1: "FLEXÍVEL", field_2: "METRO", field_3: "DESPESA", STATUS: "ATIVO" }, "FLEXÍVEL"],
    ["product", { Title: "FLEXÍVEL", field_1: "CABO 2,5", SATUS: "BLOQUEADO" }, "CABO 2,5"],
  ]) {
    const dom = new JSDOM("<!doctype html><body></body>");
    const doc = dom.window.document;
    const gallery = createRegistrationGallery({ document: doc, kind, data: { async loadSnapshot() { return { rows: [{ id: "7", fields }] }; } } });
    await gallery.open();
    assert.match(doc.querySelector("[data-registration-row]").textContent, new RegExp(expected), kind);
    if (kind === "subfamily") assert.match(doc.querySelector("[data-registration-row]").textContent, /UNIDADE\s*METRO/);
    gallery.destroy();
    dom.window.close();
  }
});
