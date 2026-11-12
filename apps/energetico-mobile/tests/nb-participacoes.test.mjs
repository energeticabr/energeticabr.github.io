import assert from "node:assert/strict";
import test from "node:test";

import { createChatClient } from "../src/chat/chat-client.js";
import { renderChatMarkup } from "../src/ui/chat-view.js";

const portalApp = "nb-participacoes";
const area = (id, label) => ({ id, reply: id, label });
const state = {
  sessionStatus: "authenticated",
  account: { name: "Conta de teste" },
  messages: [{
    role: "assistant",
    type: "poll",
    question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?",
    options: [
      area("group_nb_participacoes", "NB PARTICIPAÇÕES"),
      area("group_personal_expenses", "GASTOS PESSOAIS"),
      area("group_financial", "FINANCEIRO"),
    ],
  }],
};

test("NB has its own Microsoft login and only shows its two home areas", () => {
  assert.match(renderChatMarkup({}, { portalApp }), /<h1>NBPAR<\/h1>[\s\S]*Entrar com a Microsoft/);
  const markup = renderChatMarkup(state, { portalApp });
  assert.match(markup, /data-reply-id="group_nb_participacoes"/);
  assert.match(markup, /data-reply-id="group_personal_expenses"/);
  assert.doesNotMatch(markup, /group_financial|action_powerbi_dashboard|open-rhid-attendance-today|open-general-summary-report/);
  assert.match(renderChatMarkup(state), /action_powerbi_dashboard/);
});

test("NB keeps submenu, field and attachment controls", () => {
  const markup = renderChatMarkup({
    ...state,
    activeFlow: { id: "rent_payment", title: "Pagamento de aluguel" },
    messages: [{
      type: "poll", role: "assistant", question: "Escolha o imóvel",
      options: [area("123", "Imóvel de teste")],
    }],
  }, { portalApp });
  assert.match(markup, /data-reply-id="123"/);
  assert.match(markup, /data-action="pick-files"/);
  assert.match(markup, /data-reply-id="navigation_main_menu"/);
});

test("NB scopes requests while Energético keeps its existing request format", async () => {
  const headers = [];
  const options = {
    apiBaseUrl: "https://example.com",
    tokenProvider: async () => "synthetic",
    fetchImpl: async (_url, init) => {
      headers.push(new Headers(init.headers));
      return Response.json({ status: "processed", messages: [] });
    },
  };
  const nb = createChatClient({ ...options, portalApp });
  await nb.sendText({ replyId: "group_nb_participacoes" });
  await nb.sendFile(new File(["fixture"], "recibo.pdf", { type: "application/pdf" }));
  await createChatClient(options).sendText({ replyId: "group_financial" });
  assert.deepEqual(headers.map(item => item.get("X-Portal-App")), [portalApp, portalApp, null]);
});
