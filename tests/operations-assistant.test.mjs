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
  attachmentPreviewMarkup,
  clearAssistantConversation,
  formatAssistantText,
  launchesMarkup,
  processAssistantAttachments,
  remoteMessageMarkup,
  removeConsumedAssistantChoice,
  shouldResetAssistantConversation,
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
  assert.equal(resolveAssistantCommand("abrir painel inicial", common).type, "unknown");
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
  assert.match(markup, /data-assistant-camera[^>]*aria-label="Tirar foto"/);
  assert.match(markup, /data-assistant-camera-input[^>]*accept="image\/\*"[^>]*capture="environment"/);
  assert.match(markup, /data-assistant-file[^>]*aria-label="Anexar fotos ou arquivos"/);
  assert.match(markup, /data-assistant-file-input[^>]*multiple/);
  assert.match(markup, /data-assistant-attachments/);
});

test("ao escolher uma opção o formulário anterior desaparece sem marcador residual", () => {
  let removed = false;
  const choice = { remove() { removed = true; } };
  const target = { closest(selector) { return selector === "[data-assistant-choice-card]" ? choice : null; } };

  assert.equal(removeConsumedAssistantChoice(target), true);
  assert.equal(removed, true);
  assert.equal(removeConsumedAssistantChoice({ closest() { return null; } }), false);
});

test("a conclusão da VM reinicia o histórico visual e libera as mídias anteriores", () => {
  const revoked = [];
  const mediaUrls = new Set(["blob:resumo-1", "blob:resumo-2"]);
  const transcript = {
    innerHTML: "mensagens e formulários antigos",
    scrollTop: 81,
  };

  assert.equal(shouldResetAssistantConversation({ resetConversation: true }), true);
  assert.equal(shouldResetAssistantConversation({ resetConversation: false }), false);
  assert.equal(shouldResetAssistantConversation({}), false);

  clearAssistantConversation(transcript, mediaUrls, url => revoked.push(url));

  assert.equal(transcript.innerHTML, "");
  assert.equal(transcript.scrollTop, 0);
  assert.deepEqual(revoked, ["blob:resumo-1", "blob:resumo-2"]);
  assert.equal(mediaUrls.size, 0);
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

test("o cliente envia foto ou arquivo bruto para a rota autenticada da VM", async () => {
  const calls = [];
  const file = new Blob(["conteudo-do-comprovante"], { type: "application/pdf" });
  Object.defineProperty(file, "name", { value: "Comprovante agosto.pdf" });
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
    randomUUID: () => "attachment-1",
  });

  await client.sendFile(file);

  assert.equal(calls[0].url, "https://163-176-171-217.sslip.io/api/portal-upload");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.body, file);
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.headers.Authorization, "Bearer microsoft-token");
  assert.equal(calls[0].options.headers["Content-Type"], "application/pdf");
  assert.equal(calls[0].options.headers["X-Portal-File-Name"], encodeURIComponent("Comprovante agosto.pdf"));
  assert.equal(calls[0].options.headers["X-Portal-Message-Id"], "attachment-1");
});

test("o cliente bloqueia executáveis e anexos acima de 60 MB antes do upload", async () => {
  const client = createPortalChatClient({
    endpoint: "https://163-176-171-217.sslip.io/api/portal-chat",
    tokenProvider: async () => "microsoft-token",
    fetch: async () => {
      throw new Error("não deveria acessar a rede");
    },
  });
  const executable = new Blob(["Write-Host risco"], { type: "text/plain" });
  Object.defineProperty(executable, "name", { value: "risco.ps1" });
  const oversized = { name: "filmagem.mov", type: "video/quicktime", size: 60_000_001 };

  await assert.rejects(client.sendFile(executable), /tipo de arquivo não permitido/i);
  await assert.rejects(client.sendFile(oversized), /60 MB/i);
});

test("uma falha da VM mantém o arquivo falho e os seguintes na fila sem falso sucesso", async () => {
  const files = [
    { name: "foto-1.jpg" },
    { name: "comprovante.pdf" },
    { name: "foto-2.jpg" },
  ];
  const confirmed = [];
  const outcome = await processAssistantAttachments(
    files,
    async file => {
      if (file.name === "comprovante.pdf") throw new Error("A VM não confirmou o processamento");
      return { status: "processed", messages: [] };
    },
    async file => confirmed.push(file.name),
  );

  assert.deepEqual(confirmed, ["foto-1.jpg"]);
  assert.deepEqual(outcome.remaining.map(file => file.name), ["comprovante.pdf", "foto-2.jpg"]);
  assert.equal(outcome.completed, false);
  assert.match(outcome.error.message, /não confirmou/i);
});

test("upload com HTTP 200 mas sem confirmação JSON válida permanece como falha", async () => {
  const file = new Blob(["foto"], { type: "image/jpeg" });
  Object.defineProperty(file, "name", { value: "foto.jpg" });
  const client = createPortalChatClient({
    endpoint: "https://163-176-171-217.sslip.io/api/portal-chat",
    tokenProvider: async () => "microsoft-token",
    fetch: async () => ({
      ok: true,
      status: 200,
      async json() { throw new SyntaxError("corpo truncado"); },
    }),
  });

  await assert.rejects(client.sendFile(file), /confirmação válida/i);
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

test("confirmação de presença mostra fornecedor e status com a cor correspondente", () => {
  const present = remoteMessageMarkup({
    type: "text",
    text: "ID 42: PRESENÇA DE DIBRITA APONTADA COMO PRESENTE.",
    presence_confirmation: { id: 42, supplier: "DIBRITA", presence: "PRESENTE" },
  });
  const absent = remoteMessageMarkup({
    type: "text",
    text: "ID 43: PRESENÇA DE OUTRO FORNECEDOR APONTADA COMO AUSENTE.",
    presence_confirmation: { id: 43, supplier: "OUTRO FORNECEDOR", presence: "AUSENTE" },
  });

  assert.match(present, /ID 42: PRESENÇA DE DIBRITA APONTADA COMO/);
  assert.match(present, /assistant-presence-confirmation__status--present">PRESENTE</);
  assert.match(absent, /assistant-presence-confirmation__status--absent">AUSENTE</);
  assert.doesNotMatch(present, /PRESENÇA ALTERADA PARA/);
});

test("confirmação de edição do fornecedor renderiza tabela antes/depois e mantém as ações", () => {
  const markup = remoteMessageMarkup({
    type: "poll",
    question: "👷 DESEJA EDITAR O FORNECEDOR?\nMUDANÇA | CAMPO | ANTES | DEPOIS\n1 | CIDADE | DIVINÓPOLIS | OURO PRETO",
    change_table: {
      title: "⚠️ ALTERAÇÕES NO CADASTRO DO FORNECEDOR",
      headers: ["Mudança", "Campo", "Antes", "Depois"],
      rows: [{ change: 1, field: "CIDADE", before: "DIVINÓPOLIS", after: "OURO PRETO" }],
    },
    options: [
      { id: "supplier_sync_none", label: "🚫 NÃO EDITAR NADA" },
      { id: "supplier_sync_all", label: "🔄 EDITAR TUDO" },
    ],
  });

  assert.match(markup, /assistant-change-table/);
  assert.match(markup, /DIVINÓPOLIS/);
  assert.match(markup, /OURO PRETO/);
  assert.match(markup, /supplier_sync_none/);
  assert.match(markup, /supplier_sync_all/);
  assert.doesNotMatch(markup, /supplier_sync_field_/);
  assert.doesNotMatch(markup, /MUDANÇA \| CAMPO \| ANTES \| DEPOIS/);
});

test("garante o botão de log no menu principal quando a VM omite a opção", () => {
  const markup = remoteMessageMarkup({
    type: "poll",
    question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?",
    options: [{ id: "group_supplies", label: "📦 SUPRIMENTOS", reply: "group_supplies" }],
  });

  assert.match(markup, /data-assistant-reply="audit_log"/);
  assert.match(markup, /LOG DE AÇÕES/);
  assert.ok(markup.indexOf("LOG DE AÇÕES") < markup.indexOf("SUPRIMENTOS"));
});

test("não duplica o botão de log quando a VM já o devolve", () => {
  const markup = remoteMessageMarkup({
    type: "poll",
    question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?",
    options: [
      { id: "audit_log", label: "🧾 LOG DE AÇÕES", reply: "audit_log" },
      { id: "group_supplies", label: "📦 SUPRIMENTOS", reply: "group_supplies" },
    ],
  });

  assert.equal((markup.match(/data-assistant-reply="audit_log"/g) || []).length, 1);
});

test("não mostra salvar rascunho como botão dentro das perguntas do fluxo", () => {
  const markup = remoteMessageMarkup({
    type: "poll",
    question: "ESCOLHA UMA OPÇÃO",
    options: [
      { id: "group_supplies", label: "SUPRIMENTOS" },
      { id: "save_draft_main_menu", label: "💾 SALVAR RASCUNHO E RETORNAR AO MENU PRINCIPAL" },
    ],
  });

  assert.match(markup, />SUPRIMENTOS</);
  assert.doesNotMatch(markup, /SALVAR RASCUNHO E RETORNAR/);
});

test("o lançamento múltiplo aparece em uma única linha por lançamento", () => {
  const markup = launchesMarkup({
    totalDisplay: "R$ 32,00",
    lines: [
      { product: "EXECUÇÃO DE FORMA PILAR/VIGA", unitPriceDisplay: "R$ 4,00", quantity: "3", freightDisplay: "R$ 0,00", totalDisplay: "R$ 12,00" },
      { product: "ALVENARIA", unitPriceDisplay: "R$ 10,00", quantity: "2", freightDisplay: "R$ 1,00", totalDisplay: "R$ 21,00" },
    ],
  });

  assert.match(markup, /data-assistant-launches/);
  assert.equal((markup.match(/data-assistant-launch-row/g) || []).length, 2);
  assert.match(markup, /assistant-launch-row--header/);
  assert.match(markup, /Produto.*Unitário.*Qtd\..*Frete.*Total/s);
  assert.match(markup, /EXECUÇÃO DE FORMA PILAR\/VIGA/);
  assert.match(markup, /data-assistant-edit-launch-line="1"/);
  assert.match(markup, /data-assistant-edit-launch-line="2"/);
  assert.match(markup, />Editar</);
  assert.doesNotMatch(markup, /PADRÃO DO PRODUTO|⭐/i);
});

test("o menu de rascunhos sempre oferece exclusão para cada retomada", () => {
  const markup = remoteMessageMarkup({
    type: "poll",
    question: "2 RASCUNHOS AGUARDANDO. ESCOLHA QUAL DESEJA CONTINUAR.",
    options: [{ id: "draft_resume:abc123", title: "▶️ RETOMAR • EFETUAR LANÇAMENTO" }],
  });

  assert.match(markup, /data-assistant-draft-delete="true"/);
  assert.match(markup, /data-assistant-reply="draft_delete:abc123"/);
  assert.match(markup, /class="assistant-draft-option"/);
  assert.match(markup, /aria-label="Excluir rascunho: EFETUAR LANÇAMENTO"/);
  assert.doesNotMatch(markup, /🗑️ EXCLUIR • EFETUAR LANÇAMENTO/);
});

test("a prévia de anexos identifica imagens e PDFs para abertura completa", () => {
  const image = attachmentPreviewMarkup({ id: "a1", fileName: "foto.jpg", mimeType: "image/jpeg" });
  const pdf = attachmentPreviewMarkup({ id: "a2", fileName: "laudo.pdf", mimeType: "application/pdf" });
  assert.match(image, /Prévia da imagem/);
  assert.match(pdf, /Prévia do PDF/);
  assert.match(image, /data-assistant-attachment-media/);
  assert.match(pdf, /data-attachment-id="a2"/);
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
  assert.match(css, /\.assistant-launch-row\s*\{/);
  assert.match(css, /\.assistant-media-preview-link/);
  assert.match(css, /\.assistant-bubble p\s*\{[^}]*white-space:\s*pre-wrap/i);
});
