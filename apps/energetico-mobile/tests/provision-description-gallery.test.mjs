import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createRegistrationGalleryData } from "../src/chat/registration-gallery-data.js";
import { createRegistrationGallery } from "../src/ui/registration-gallery-view.js";
import { createChatView } from "../src/ui/chat-view.js";
import { createConversationStore } from "../src/chat/conversation-store.js";

test("descritivo provisão consulta todas as páginas da lista pai, mapeia datas e ordena por maior ID", async () => {
  const calls = [];
  const data = createRegistrationGalleryData({ kind: "provisionDescription", repository: {
    async resolveList(site, aliases) { calls.push([site, aliases]); return { status: "resolved", id: "parent-list" }; },
    async getColumns() { return [{ name: "DATAPREVISTOPGTO", displayName: "DATA PREVISTO PGTO", dateTime: {} }]; },
    async getItemsPage(site, list, query, options) {
      assert.equal(site, "personal"); assert.equal(list, "parent-list");
      return options.cursor ? { items: [{ id: "9", fields: { FORNECEDOR: "B", VALORTOTAL: "1234,56", DATAPREVISTOPGTO: "2026-10-09T03:00:00Z" } }], hasMore: false }
        : { items: [{ id: "2", fields: { FORNECEDOR: "A", VALORTOTAL: "10" } }], hasMore: true, nextLink: "next-page" };
    },
  } });
  const snapshot = await data.loadSnapshot();
  assert.deepEqual(calls, [["personal", ["DESCRITIVOPROVISAO"]]]);
  assert.equal(snapshot.listName, "DESCRITIVOPROVISAO");
  assert.deepEqual(snapshot.rows.map(row => row.id), ["9", "2"]);
  assert.equal(snapshot.rows[0].fields["DATA PREVISTO PGTO"], "2026-10-09T03:00:00Z");
});

test("descritivo provisão não consulta outra lista quando a lista pai está indisponível", async () => {
  const data = createRegistrationGalleryData({ kind: "provisionDescription", repository: {
    async resolveList() { return { status: "missing" }; },
    async getItemsPage() { assert.fail("lista ausente não pode ser consultada"); },
  } });
  await assert.rejects(data.loadSnapshot(), error => error.code === "registration_provisionDescription_list_missing" && /DESCRITIVOPROVISAO/.test(error.message));
});

test("galeria pai apresenta moeda e datas, permite filtrar fornecedor e voltar sem alterar registros", async t => {
  const dom = new JSDOM("<!doctype html><body></body>");
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const gallery = createRegistrationGallery({ document: doc, kind: "provisionDescription", data: {
    async loadSnapshot() { return { rows: [
      { id: "9", hasAttachments: false, fields: { FORNECEDOR: "FORNECEDOR A", FILIAL: "FILIAL A", VALORTOTAL: "1234,56", DATAPREVISTOPGTO: "2026-10-09T03:00:00Z", PGTOAGENDADO: "2026-10-08T03:00:00Z", OBS: "Duas linhas", FORMAPGTO: "CAIXA" } },
      { id: "2", hasAttachments: false, fields: { FORNECEDOR: "FORNECEDOR B", FILIAL: "FILIAL B", VALORTOTAL: "10" } },
    ] }; },
  } });
  t.after(() => gallery.destroy());
  await gallery.open();
  const root = doc.querySelector('[data-gallery-kind="provisionDescription"]');
  assert.equal(root.querySelector("h1").textContent, "GALERIA DESCRITIVO PROVISÃO");
  assert.equal(root.querySelectorAll('[role="listitem"]').length, 2);
  assert.match(root.textContent, /1\.234,56/);
  assert.match(root.textContent, /09\/10\/2026/);
  assert.match(root.textContent, /08\/10\/2026/);
  assert.match(root.textContent, /Duas linhas/);
  assert.equal(root.querySelector('[data-gallery-action]'), null, "o grupo pai não oferece mutação isolada que deixe itens sem vínculo");
  const supplier = root.querySelector('[data-filter-field="FORNECEDOR"]');
  supplier.value = "FORNECEDOR B";
  supplier.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll('[role="listitem"]').length, 1);
  assert.match(root.querySelector('[role="listitem"]').textContent, /FORNECEDOR B/);
  root.querySelector('[data-action="registration-close"]').click();
  assert.equal(root.hidden, true);
});

test("menu deduplica o atalho pai, envia a ação correta e reserva três linhas só para provisões", () => {
  const dom = new JSDOM('<!doctype html><body><main id="app"></main></body>');
  const doc = dom.window.document, root = doc.querySelector("#app");
  const view = createChatView(root);
  const store = createConversationStore();
  const state = { ...store.getState(), sessionStatus: "authenticated", account: { homeAccountId: "a", name: "Bernardo" }, messages: [{
    id: "menu", role: "assistant", type: "poll", question: "📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?", options: [
      { id: "new_document", reply: "new_document", label: "LANÇAMENTOS" },
      { id: "payment", reply: "payment", label: "PROVISÃO DE PAGAMENTO" },
      { id: "action_provision_description_gallery", reply: "action_provision_description_gallery", label: "ATALHO ANTIGO" },
    ],
  }] };
  view.render(state);
  const style = doc.createElement("style"); style.textContent = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8").replace(/^@import[^;]+;/gm, ""); doc.head.append(style);
  const pairs = [...root.querySelectorAll(".chat-supplies-pair")];
  assert.equal(pairs[0].querySelectorAll("[data-gallery-button]").length, 2);
  assert.equal(pairs[1].querySelectorAll("[data-gallery-button]").length, 3);
  assert.equal(dom.window.getComputedStyle(pairs[1].querySelector(".chat-gallery-actions")).gridTemplateRows, "repeat(3, minmax(var(--supplies-gallery-height), 1fr))");
  assert.equal(root.querySelectorAll('[data-reply-id="action_provision_description_gallery"]').length, 1);
  const events = []; view.on("select-reply", event => events.push(event.replyId));
  root.querySelector('[data-reply-id="action_provision_description_gallery"]').click();
  assert.deepEqual(events, ["action_provision_description_gallery"]);
  view.render({ ...state, activeText: "sending" });
  assert.equal(root.querySelector('[data-reply-id="action_provision_description_gallery"]').disabled, true);
  view.destroy(); dom.window.close();
});
