import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { renderChatMarkup } from "../src/ui/chat-view.js";

const portalApp = "nb-participacoes";
const home = {
  type: "poll", role: "assistant", question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?",
  options: [
    { id: "group_nb_participacoes", label: "NB PARTICIPAÇÕES" },
    { id: "group_personal_expenses", label: "GASTOS PESSOAIS" },
  ],
};
const state = { sessionStatus: "authenticated", account: { name: "Teste" }, messages: [home] };
const selector = 'button[data-action="open-rentals-report"]';

test("o mascote de aluguéis abre o relatório pelo menu inicial do NBPAR", () => {
  const { window } = new JSDOM(renderChatMarkup(state, { portalApp }));
  const button = window.document.querySelector(selector);
  assert.ok(button?.querySelector("img[src]"));
  assert.equal(button.textContent.trim(), "Aluguéis");
  assert.equal(button.getAttribute("aria-haspopup"), "dialog");
  window.close();
});

test("o atalho de aluguéis fica restrito ao menu inicial atual do NBPAR", () => {
  const submenu = { type: "poll", role: "assistant", question: "Escolha o imóvel", options: [{ id: "7", label: "Imóvel" }] };
  const markup = renderChatMarkup({ ...state, messages: [home, submenu] }, { portalApp });
  assert.doesNotMatch(markup, /data-action="open-rentals-report"/);
  assert.doesNotMatch(renderChatMarkup(state), /data-action="open-rentals-report"/);
});

test("o toque no mascote carrega os aluguéis no app NBPAR e volta ao menu", async t => {
  const { createNativeBootstrap } = await import("../src/demo/native-bootstrap.js");
  const { window } = new JSDOM('<div id="app"></div>', { url: "https://localhost/" });
  const document = window.document;
  const previousDocument = globalThis.document;
  globalThis.document = document;
  const scopesRequested = [];
  t.mock.method(globalThis, "fetch", async input => {
    const { hostname, pathname } = new URL(input);
    assert.equal(hostname, "graph.microsoft.com");
    if (!pathname.includes("/lists/")) return Response.json({ id: "example.sharepoint.com,site,web" });
    if (pathname.includes("02b3ceec-2b03-42e9-b87f-5fb02851caa8")) {
      return Response.json({ value: [{ id: "1", fields: {
        DESCRICAO: "Galpão de teste", INQUILINO: "Locatário de teste", DATAVENCIMENTO: "2025-01-01",
        NUM_x002e_CONTRATOALUGUEL: "7", VALORBRUTO: 1200,
      } }] });
    }
    assert.match(pathname, /e6b7fbf3-b5ce-406a-8ec8-8d0e8eff7885/);
    return Response.json({ value: [{ id: "7", fields: {
      DESCRICAOIMOVEL: "Galpão de teste", INQUILINO: "Locatário de teste", STATUS: "ATIVO",
    } }] });
  });
  const runtime = createNativeBootstrap({
    root: document.querySelector("#app"),
    config: { portalApp, apiBaseUrl: "https://example.com" },
    auth: {
      initialize: async () => ({ ...state.account, homeAccountId: "teste" }),
      getToken: async scopes => { scopesRequested.push(scopes); return "synthetic-token"; },
    },
    native: { importSharedItems: async () => [] },
    fetchImpl: async () => Response.json({ status: "processed", messages: [home] }),
  });
  t.after(() => {
    runtime.stop();
    globalThis.document = previousDocument;
    window.close();
  });
  await runtime.start();
  const mascot = document.querySelector(selector);
  mascot.focus();
  mascot.click();
  const content = () => document.querySelector(".rentals-content");
  for (let retry = 0; retry < 80 && !content()?.textContent.includes("Galpão de teste"); retry++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.match(content()?.textContent ?? "", /ALUGUÉIS EM ABERTO[\s\S]*Galpão de teste/);
  assert.ok(scopesRequested.some(scopes => scopes.includes("Sites.Read.All")));
  assert.ok(document.querySelector('[data-action="print-report-pdf"]'));
  document.querySelector(".rentals-dialog .report-close-control").click();
  assert.equal(document.querySelector(".rentals-dialog"), null);
  assert.equal(document.activeElement, document.querySelector(selector));
});
