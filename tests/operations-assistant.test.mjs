import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import { ENTITIES } from "../portal/catalog/entities.js";
import { MODULES } from "../portal/catalog/modules.js";
import {
  assistantMenuItems,
  assistantQuickActions,
  resolveAssistantCommand,
} from "../portal/assistant/assistant-intents.js";
import {
  buildPresenceValidationSummary,
  loadPresenceValidation,
} from "../portal/assistant/presence-validation.js";
import { createPortalChatClient } from "../portal/assistant/portal-chat-client.js";
import {
  assistantMarkup,
  formatAssistantText,
  remoteMessageMarkup,
  removeConsumedAssistantChoice,
} from "../portal/ui/operations-assistant.js";

function context() {
  return {
    modules: MODULES,
    entities: ENTITIES,
    access: buildSuperAdminAccess("bernardo@energeticabr.com", "Bernardo", MODULES),
    can,
  };
}

test("o Energético entende lançamento, edição, presença e o menu administrativo", () => {
  const common = context();

  assert.deepEqual(resolveAssistantCommand("quero fazer um novo lançamento", common).route, {
    name: "entity-create",
    params: { entityId: "lancamentos" },
  });
  assert.deepEqual(resolveAssistantCommand("editar lançamento ID 243", common).route, {
    name: "item",
    params: { entityId: "lancamentos", itemId: "243" },
  });
  assert.equal(resolveAssistantCommand("validar presença de hoje", common).type, "presence-validation");
  assert.deepEqual(resolveAssistantCommand("abrir suprimentos", common).route, {
    name: "module",
    params: { moduleId: "suprimentos" },
  });
  assert.deepEqual(resolveAssistantCommand("abrir painel inicial", common).route, { name: "dashboard", params: {} });
  assert.deepEqual(resolveAssistantCommand("abrir relatórios", common).route, { name: "reports", params: {} });
  assert.deepEqual(resolveAssistantCommand("abrir usuários e acessos", { ...common, isSuperAdmin: true }).route, { name: "access", params: {} });
});

test("o assistente não oferece nem abre operações sem a permissão correspondente", () => {
  const common = context();
  common.access.permissions.suprimentos.create = false;
  common.access.permissions.financeiro.view = false;

  const denied = resolveAssistantCommand("novo lançamento", common);
  assert.equal(denied.type, "denied");
  assert.match(denied.message, /permissão/i);
  assert.equal(assistantMenuItems(common).some(item => item.moduleId === "financeiro"), false);
  assert.equal(assistantQuickActions(common).some(item => item.command === "novo lançamento"), false);
});

test("o menu do chat reproduz as operações administrativas frequentes", () => {
  const quickActions = assistantQuickActions(context());
  assert.ok(quickActions.some(item => item.command === "novo lançamento"));
  assert.ok(quickActions.some(item => item.command === "editar lançamento"));
  assert.ok(quickActions.some(item => item.command === "validar presença de hoje"));
  assert.ok(quickActions.some(item => item.command === "criar diário de obras"));

  const followUp = resolveAssistantCommand("editar lançamento", context());
  assert.equal(followUp.type, "needs-input");
  assert.deepEqual(followUp.pending, { action: "edit", entityId: "lancamentos" });
});

test("a validação de presença usa todos os lotes SharePoint do dia", async () => {
  const calls = [];
  const pages = {
    "presence-list": [
      { items: [{ id: "1", fields: { DATA: "2026-09-05", FILIAL: "004", FUNCIONARIO: "ANA" } }], nextLink: "presence-next", hasMore: true },
      { items: [{ id: "2", fields: { DATA: "2026-09-05", FILIAL: "004", FUNCIONARIO: "BRUNO" } }], nextLink: "", hasMore: false },
    ],
    "description-list": [
      { items: [{ id: "11", fields: { DATA: "2026-09-05", FILIAL: "004", CADASTRO: "ANA", ATIVIDADEEXECUTADA: "ALVENARIA" } }], nextLink: "description-next", hasMore: true },
      { items: [{ id: "12", fields: { DATA: "2026-09-05", FILIAL: "004", CADASTRO: "BRUNO", ATIVIDADEEXECUTADA: "PINTURA" } }], nextLink: "", hasMore: false },
    ],
  };
  const pageIndex = new Map();
  const repository = {
    async resolveList(_siteKey, aliases) {
      return { status: "resolved", id: aliases[0].includes("APONTAMENTO") ? "presence-list" : "description-list" };
    },
    async getItemsPage(_siteKey, listId, _query, options) {
      calls.push({ listId, cursor: options.cursor || "" });
      const index = pageIndex.get(listId) || 0;
      pageIndex.set(listId, index + 1);
      return pages[listId][index];
    },
  };

  const summary = await loadPresenceValidation(repository, ENTITIES, { date: "2026-09-05" });
  assert.equal(summary.presenceCount, 2);
  assert.equal(summary.descriptionCount, 2);
  assert.equal(summary.uniquePeople, 2);
  assert.equal(summary.inconsistencies, 0);
  assert.equal(calls.length, 4);
  assert.ok(calls.some(call => call.cursor === "presence-next"));
  assert.ok(calls.some(call => call.cursor === "description-next"));
});

test("o resumo sinaliza descrições incompletas sem alterar dados", () => {
  const summary = buildPresenceValidationSummary({
    date: "2026-09-05",
    presenceItems: [{ id: "1", fields: { DATA: "2026-09-05", FILIAL: "004", FUNCIONARIO: "ANA" } }],
    descriptionItems: [
      { id: "10", fields: { DATA: "2026-09-05", FILIAL: "004", CADASTRO: "ANA" } },
      { id: "11", fields: { DATA: "2026-09-05", FILIAL: "", CADASTRO: "" } },
    ],
  });

  assert.equal(summary.inconsistencies, 2);
  assert.deepEqual(summary.incompleteItemIds, ["10", "11"]);
});

test("o chat identifica visualmente o usuário Microsoft e o Energético", () => {
  const markup = assistantMarkup({
    account: { name: "Bernardo Notini", username: "bernardo@energeticabr.com" },
    mascotSrc: "assets/mascote-energetica-transparente.png",
    menuItems: assistantMenuItems(context()),
    quickActions: assistantQuickActions(context()),
  });

  assert.match(markup, /data-operations-assistant/);
  assert.match(markup, /Energético/);
  assert.match(markup, /mascote-energetica-transparente\.png/);
  assert.match(markup, /data-assistant-user-photo/);
  assert.match(markup, /data-assistant-user-initials[^>]*>BN</);
  assert.match(markup, /data-assistant-module="suprimentos"/);
  assert.match(markup, /data-assistant-command="novo lançamento"/);
  assert.doesNotMatch(markup, /mensagem apagada/i);
});

test("ao escolher uma opção o formulário anterior desaparece sem marcador residual", () => {
  let removed = false;
  const choice = { remove() { removed = true; } };
  const target = { closest(selector) { return selector === "[data-assistant-choice-card]" ? choice : null; } };

  assert.equal(removeConsumedAssistantChoice(target), true);
  assert.equal(removed, true);
  assert.equal(removeConsumedAssistantChoice({ closest() { return null; } }), false);
});

test("o cliente envia a conversa à VM com o token Microsoft sem expor segredo interno", async () => {
  const calls = [];
  const client = createPortalChatClient({
    endpoint: "https://163-176-171-217.sslip.io/api/portal-chat",
    tokenProvider: async scopes => {
      assert.deepEqual(scopes, ["User.Read"]);
      return "microsoft-token";
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, async json() { return { status: "processed", messages: [] }; } };
    },
    randomUUID: () => "message-1",
  });

  await client.send({ text: "SUPRIMENTOS", replyId: "group_supplies" });
  assert.equal(calls[0].options.headers.Authorization, "Bearer microsoft-token");
  assert.equal(calls[0].options.headers["X-Channel-Bridge-Token"], undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    messageId: "message-1",
    text: "SUPRIMENTOS",
    replyId: "group_supplies",
  });
});

test("as respostas estruturadas da VM viram mensagens e formulários selecionáveis", () => {
  assert.match(remoteMessageMarkup({ type: "text", text: "QUAL ÁREA VOCÊ DESEJA ACESSAR?" }), /QUAL ÁREA/);
  const poll = remoteMessageMarkup({
    type: "poll",
    question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?",
    options: [
      { id: "group_supplies", reply: "group_supplies", label: "SUPRIMENTOS" },
      { id: "group_demands", reply: "group_demands", label: "DEMANDAS" },
    ],
  });
  assert.match(poll, /data-assistant-choice-card/);
  assert.match(poll, /data-assistant-reply="group_supplies"/);
  assert.match(poll, />SUPRIMENTOS</);
  assert.doesNotMatch(poll, /mensagem apagada/i);
});

test("o chat respeita negrito, quebras de linha e escapa conteúdo não confiável", () => {
  const markup = formatAssistantText(
    "✅ *TAREFA GRAVADA ÀS 20:52.*\n*REGISTROS CONFIRMADOS:*\n• ID 1929 <script>",
  );

  assert.match(markup, /<strong>TAREFA GRAVADA ÀS 20:52\.<\/strong>/);
  assert.match(markup, /\n<strong>REGISTROS CONFIRMADOS:<\/strong>\n• ID 1929/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
});

test("o resumo gerado pela VM é preparado para leitura dentro do chat", () => {
  const markup = remoteMessageMarkup({
    type: "image",
    caption: "RESUMO PARA CONFIRMAÇÃO",
    fileName: "resumo.png",
    mimeType: "image/png",
    mediaUrl: "https://163-176-171-217.sslip.io/api/portal-media/media-1",
  });

  assert.match(markup, /data-assistant-media/);
  assert.match(markup, /RESUMO PARA CONFIRMAÇÃO/);
  assert.match(markup, /data-assistant-media-content/);
  assert.doesNotMatch(markup, /permanece disponível no canal da VM/i);
});

test("o cliente baixa a mídia temporária usando a mesma identidade Microsoft", async () => {
  const calls = [];
  const expectedBlob = new Blob(["summary"], { type: "image/png" });
  const client = createPortalChatClient({
    endpoint: "https://163-176-171-217.sslip.io/api/portal-chat",
    tokenProvider: async scopes => {
      assert.deepEqual(scopes, ["User.Read"]);
      return "microsoft-token";
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, async blob() { return expectedBlob; } };
    },
  });

  const blob = await client.fetchMedia({
    mediaUrl: "https://163-176-171-217.sslip.io/api/portal-media/media-1",
  });

  assert.equal(blob, expectedBlob);
  assert.equal(calls[0].options.headers.Authorization, "Bearer microsoft-token");
  await assert.rejects(
    client.fetchMedia({ mediaUrl: "https://attacker.example/resumo.png" }),
    /endereço de mídia inválido/i,
  );
});

test("o CSS apresenta o painel como conversa responsiva com avatares opostos", async () => {
  const css = await readFile(new URL("../portal/styles/admin.css", import.meta.url), "utf8");
  assert.match(css, /\.operations-assistant-panel\s*\{[\s\S]*?position:\s*fixed/i);
  assert.match(css, /\.assistant-message\.is-user\s*\{[\s\S]*?flex-direction:\s*row-reverse/i);
  assert.match(css, /\.assistant-avatar\s*\{[\s\S]*?border-radius:\s*50%/i);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.operations-assistant-panel\s*\{[\s\S]*?inset:/i);
  assert.match(css, /\.assistant-media-preview/);
  assert.match(css, /\.assistant-bubble p\s*\{[^}]*white-space:\s*pre-wrap/i);
});
