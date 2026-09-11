import test from "node:test";
import assert from "node:assert/strict";

import { commandFromTarget, createChatView, renderChatMarkup } from "../src/ui/chat-view.js";
import { JSDOM } from "jsdom";

function signedInState(overrides = {}) {
  return {
    sessionStatus: "authenticated",
    account: { name: "Bernardo Notini", username: "bernardonotini@energeticabr.com" },
    draft: "",
    messages: [],
    pendingFiles: [],
    activeText: null,
    error: null,
    ...overrides,
  };
}

test("mostra somente a entrada Microsoft quando não há sessão", () => {
  const markup = renderChatMarkup({ sessionStatus: "signed-out" });

  assert.match(markup, /data-action="sign-in"/);
  assert.match(markup, /Entrar com a Microsoft/);
  assert.doesNotMatch(markup, /data-action="capture-photo"/);
});

test("renderiza conversa acessível com câmera, anexo e compositor", () => {
  const markup = renderChatMarkup(signedInState());

  assert.match(markup, /role="log"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /data-action="capture-photo"/);
  assert.match(markup, /data-action="pick-files"/);
  assert.match(markup, /data-action="send-text"/);
  assert.match(markup, /alt="Mascote Energético"/);
  assert.doesNotMatch(markup, /Painel inicial|Instalar aplicativo/);
  assert.ok(markup.indexOf('data-action="pick-files"') < markup.indexOf('data-action="capture-photo"'),
    "o clipe deve ficar acima da câmera na coluna de anexos");
});

test("escapa conteúdo do usuário e da VM", () => {
  const markup = renderChatMarkup(signedInState({
    draft: "<img onerror=alert(1)>",
    messages: [{
      id: "m1",
      role: "assistant",
      type: "text",
      text: "<script>alert(1)</script>",
    }],
  }));

  assert.doesNotMatch(markup, /<img onerror/);
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /&lt;script&gt;/);
});

test("renderiza confirmação de presença com fornecedor e status colorido", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [
      {
        id: "presence-present",
        role: "assistant",
        type: "text",
        text: "ID 42: PRESENÇA DE DIBRITA APONTADA COMO PRESENTE.",
        presence_confirmation: { id: 42, supplier: "DIBRITA", presence: "PRESENTE" },
      },
      {
        id: "presence-absent",
        role: "assistant",
        type: "text",
        text: "ID 43: PRESENÇA DE OUTRO FORNECEDOR APONTADA COMO AUSENTE.",
        presence_confirmation: { id: 43, supplier: "OUTRO FORNECEDOR", presence: "AUSENTE" },
      },
    ],
  }));

  assert.match(markup, /ID 42: PRESENÇA DE DIBRITA APONTADA COMO/);
  assert.match(markup, /chat-presence-confirmation__status--present">PRESENTE</);
  assert.match(markup, /chat-presence-confirmation__status--absent">AUSENTE</);
  assert.doesNotMatch(markup, /PRESENÇA ALTERADA PARA/);
});

test("renderiza dados da presença em tabela compacta", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "presence-detail",
      role: "assistant",
      type: "poll",
      question: "👷 VALIDAR PRESENÇA\nSELECIONE PRESENTE, AUSENTE OU EDITAR.",
      detail_table: {
        title: "📋 DADOS DA PRESENÇA",
        kind: "presence",
        rows: [[
          { label: "DATA", value: "09/09/2026" },
          { label: "FILIAL", value: "004 - EDIFÍCIO XAVANTE" },
        ], [
          { label: "FORMA PGTO", value: "DIÁRIA" },
          { label: "IDCONTRATO", value: "-", muted: true },
        ]],
      },
      options: [
        { id: "present", label: "🟢 PRESENTE", reply: "present" },
        { id: "absent", label: "🔴 AUSENTE", reply: "absent" },
        { id: "edit", label: "⚪ EDITAR", reply: "edit" },
      ],
    }],
  }));

  assert.match(markup, /chat-presence-table/);
  assert.match(markup, /004 - EDIFÍCIO XAVANTE/);
  assert.match(markup, /chat-presence-table-cell is-muted/);
  assert.match(markup, /data-reply-id="present"/);
});

test("reduz a tipografia da lista de presenças pendentes e acomoda nomes longos", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "pending-attendance-records",
      role: "assistant",
      type: "poll",
      presentation: "accordion",
      question: "PRESENÇAS PENDENTES",
      options: [{ id: "1985", label: "1985 - JOSÉ GERALDO DOS SANTOS", reply: "1985" }],
    }],
  }));

  assert.match(markup, /chat-choice-card--pending-attendance/);
  assert.match(markup, /1985 - JOSÉ GERALDO DOS SANTOS/);
});

test("não mostra tabela de fornecedor vazia no menu principal", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "main-menu",
      role: "assistant",
      type: "poll",
      question: "👉 QUAL ÁREA VOCÊ DESEJA ACESSAR?",
      change_table: { title: "⚠️ ALTERAÇÕES NO CADASTRO DO FORNECEDOR", rows: [] },
      options: [{ id: "group_supplies", label: "📦 SUPRIMENTOS", reply: "group_supplies" }],
    }],
  }));

  assert.doesNotMatch(markup, /chat-change-table/);
  assert.doesNotMatch(markup, /Nenhuma alteração identificada/);
});

test("exibe tamanhos da compactação em KB ou MB, nunca em bytes", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "compression-preview",
      role: "assistant",
      type: "text",
      text: "🗜️ PRÉVIA COMPRIMIDA — 495152 → 313057 bytes.",
    }, {
      id: "compression-large",
      role: "assistant",
      type: "text",
      text: "Original 2500000 bytes; compactado 1250000 bytes.",
    }],
  }));

  assert.match(markup, /495\.2 KB → 313\.1 KB \(36\.8% de redução\)/);
  assert.match(markup, /Original 2\.5 MB; compactado 1\.3 MB \(50\.0% de redução\)/);
  assert.doesNotMatch(markup, /bytes/);
});

test("renderiza enquete como opções grandes e mídia como ação protegida", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [
      {
        id: "poll-1",
        role: "assistant",
        type: "poll",
        question: "Escolha",
        options: [{ id: "yes", label: "Sim", reply: "reply_yes" }],
      },
      {
        id: "media-1",
        role: "assistant",
        type: "document",
        fileName: "resumo.pdf",
        mediaUrl: "/api/portal-media/id",
      },
    ],
  }));

  assert.match(markup, /data-action="select-reply"/);
  assert.match(markup, /data-reply-id="reply_yes"/);
  assert.match(markup, /data-action="open-media"/);
  assert.match(markup, /data-message-id="media-1"/);
});

test("oferece assinatura desenhada somente na etapa de assinatura de documentos", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{
      id: "signature-question",
      role: "assistant",
      type: "text",
      text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA.",
    }],
  }));

  assert.match(markup, /data-action="open-signature-pad"/);
  assert.match(markup, /ASSINAR NA TELA/);
  const pad = renderChatMarkup(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-question", role: "assistant", type: "text", text: "Envie o documento PDF." }],
  }), { signaturePad: true });
  assert.match(pad, /data-role="signature-pad"/);
  assert.match(pad, /data-action="confirm-signature-pad"/);
  assert.match(pad, /fundo branco será removido/);
});

test("renderiza ação marcada como perigosa com botão vermelho", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "pending-menu",
      role: "assistant",
      type: "poll",
      question: "⏳ PENDÊNCIAS",
      options: [
        { id: "pending", label: "💳 PROVISÕES PGTO PENDENTES (1)", reply: "pending", tone: "danger" },
        { id: "documents", label: "📄 DOCUMENTOS PENDENTES", reply: "documents" },
      ],
    }],
  }));

  assert.match(markup, /class="chat-choice-button chat-choice-button--danger"[^>]*data-reply-id="pending"/);
  assert.match(markup, /class="chat-choice-button"[^>]*data-reply-id="documents"/);
});

test("renderiza confirmação de saída com Sim e Não quando solicitada", () => {
  const markup = renderChatMarkup(signedInState(), { signOutConfirm: true });

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /Tem certeza que deseja sair\?/);
  assert.match(markup, /data-action="cancel-sign-out"[^>]*>Não</);
  assert.match(markup, /data-action="confirm-sign-out"[^>]*>Sim</);
});

test("clipe abre escolha entre foto e arquivo antes de iniciar a seleção", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState();
  let selected;
  view.on("pick-photos", () => { selected = "foto"; });
  view.render(state);

  root.querySelector('[data-action="pick-files"]').click();
  assert.match(root.textContent, /Escolha se deseja selecionar uma foto ou um arquivo/);
  assert.ok(root.querySelector('[data-action="pick-photos"]'));
  assert.ok(root.querySelector('[data-action="pick-document-files"]'));
  root.querySelector('[data-action="pick-photos"]').click();
  assert.equal(selected, "foto");
  assert.equal(root.querySelector('[data-attachment-source-dialog]'), null);
  view.destroy();
  dom.window.close();
});

test("mostra o calendário em pergunta de data mesmo sem metadado da VM", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "launch-payment-date",
      role: "assistant",
      type: "poll",
      question: "📅 QUAL É A DATA DE PAGAMENTO PREVISTO?\nSelecione uma opção. Caso prefira outra data, envie-a no formato dd/mm/yyyy.",
      options: [
        { id: "blank", label: "EM BRANCO" },
        { id: "yesterday", label: "🔴 📆 ONTEM" },
        { id: "today", label: "📅 HOJE" },
        { id: "tomorrow", label: "AMANHÃ" },
        { id: "other", label: "OUTRA DATA" },
      ],
    }],
  }));

  assert.match(markup, /data-action="open-date-picker"/);
  assert.match(markup, /aria-label="Selecionar data pelo calendário"/);
});

test("não confunde data exibida no texto de uma seleção com pergunta de data", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "provision-selection",
      role: "assistant",
      type: "poll",
      question: "A QUAL PROVISÃO DE PAGAMENTO DESEJA ADICIONAR OS ANEXOS? As opções incluem a DATA PREVISTO PGTO.",
      options: [{ id: "42", label: "42 - FORNECEDOR (10/09/2026)" }],
    }],
  }));

  assert.doesNotMatch(markup, /data-action="open-date-picker"/);
});

test("mantém o X e o título do calendário em áreas separadas", () => {
  const markup = renderChatMarkup(signedInState(), {
    datePicker: true,
    datePickerValue: "2026-09-30",
  });

  assert.match(markup, /class="chat-date-picker__header"[\s\S]*data-action="cancel-date-picker"[\s\S]*id="date-picker-title"/);
  assert.match(markup, /class="chat-date-picker__close"/);
  assert.match(markup, /Selecionar data/);
});

test("não mostra o LOG de ações no menu principal", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "main-menu",
      role: "assistant",
      type: "poll",
      question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?",
      options: [
        { id: "audit_log", label: "🧾 LOG DE AÇÕES", reply: "audit_log" },
        { id: "group_supplies", label: "📦 SUPRIMENTOS", reply: "group_supplies" },
      ],
    }],
  }));

  assert.doesNotMatch(markup, /data-reply-id="audit_log"/);
  assert.doesNotMatch(markup, /LOG DE AÇÕES/);
  assert.match(markup, /SUPRIMENTOS/);
});

test("mantém o LOG de ações dentro de Auditoria e Documentos", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "audit-menu",
      role: "assistant",
      type: "poll",
      question: "🔎 AUDITORIA E DOCUMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "audit_log", label: "🧾 LOG DE AÇÕES", reply: "audit_log" },
        { id: "action_document", label: "📄 ADICIONAR UM NOVO DOCUMENTO", reply: "action_document" },
      ],
    }],
  }));

  assert.equal((markup.match(/data-reply-id="audit_log"/g) || []).length, 1);
  assert.match(markup, /LOG DE AÇÕES/);
});

test("move a navegação do formulário para a faixa superior do fluxo", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "task", title: "ADICIONAR UMA TAREFA COM UM NOME MUITO LONGO PARA TESTAR A QUEBRA" },
    messages: [{
      id: "question-with-navigation",
      role: "assistant",
      type: "poll",
      question: "Qual opção?",
      options: [
        { id: "answer", label: "RESPOSTA", reply: "answer" },
        { id: "navigation_back", label: "↩️ RETORNAR À PERGUNTA ANTERIOR", reply: "navigation_back", navigation_back: true },
        { id: "navigation_main_menu", label: "🏠 RETORNAR AO MENU INICIAL", reply: "navigation_main_menu", navigation_main_menu: true },
      ],
    }],
  }));

  assert.match(markup, /class="chat-flow-navigation"/);
  assert.match(markup, /data-reply-id="navigation_back"[^>]*>↩️</);
  assert.match(markup, /data-reply-id="navigation_main_menu"[^>]*>🏠</);
  assert.match(markup, /class="chat-flow-title"/);
  assert.match(markup, /Ver resumo/);
  const formChoices = markup.match(/<div class="chat-choice-list">[\s\S]*?<\/div>/)?.[0] || "";
  assert.doesNotMatch(formChoices, /RETORNAR/);
  assert.match(markup, /data-reply-id="answer"/);
});

test("mantém a faixa de navegação em telas internas sem enquete", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "attachments", title: "ADICIONAR ANEXOS" },
    messages: [{ id: "status", role: "assistant", type: "text", text: "Anexo recebido." }],
  }));

  assert.match(markup, /class="chat-flow-navigation"/);
  assert.match(markup, /data-reply-id="navigation_back"[^>]*>↩️</);
  assert.match(markup, /data-reply-id="navigation_main_menu"[^>]*>🏠</);
});

test("prioriza duas casas no total das linhas de lançamento", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: {
      launches: {
        id: "batch-1",
        totalDisplay: "R$ 62,00",
        lines: [{ index: 1, product: "FORMA", unitPriceDisplay: "R$ 5,00", quantity: "4", freightDisplay: "R$ 0,00", totalDisplay: "R$ 20,00" }],
      },
    },
  }));

  assert.match(markup, /R\$ 5,0/);
  assert.match(markup, /4,0/);
  assert.match(markup, /R\$ 0,0/);
  assert.match(markup, /R\$ 20,00/);
  assert.match(markup, /class="chat-launch-total"/);
});

test("compacta linhas de contrato com cabeçalhos abreviados, números centralizados e qtd vazia como hífen", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: {
      measurementLines: {
        id: "measurement-batch-1",
        totalDisplay: "R$ 21,5",
        lines: [{
          index: 1,
          activity: "Execução de forma",
          quantity: "",
          height: "2",
          width: "1,5",
          unitPriceDisplay: "R$ 7",
          totalDisplay: "R$ 21,5",
          details: { contract: "C-1", branch: "Matriz", description: "Forma", unit: "m²", lineType: "Área" },
        }],
      },
    },
  }));

  const dom = new JSDOM(`<main>${markup}</main>`);
  const panel = dom.window.document.querySelector(".chat-measurements");
  assert.deepEqual([...panel.querySelectorAll(".chat-measurement-row--header span")].map(node => node.textContent),
    ["Atividade", "Qtd.", "H", "L", "VLOR UN.", "Total", "Ações"]);
  assert.deepEqual([...panel.querySelectorAll(".chat-measurement-number")].map(node => node.textContent), ["-", "2,00", "1,50", "7,00", "21,50"]);
  assert.equal(panel.querySelectorAll(".chat-measurement-number")[0].className, "chat-measurement-number");
});

test("mostra a lixeira para excluir cada rascunho sem confundir com retomar", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "draft-menu",
      role: "assistant",
      type: "poll",
      question: "1 RASCUNHO AGUARDANDO. ESCOLHA QUAL DESEJA CONTINUAR.",
      options: [
        { id: "draft_resume:abc", label: "▶️ RETOMAR • EFETUAR LANÇAMENTO" },
        { id: "draft_resume:abc", label: "EFETUAR LANÇAMENTO" },
      ],
    }],
  }));

  assert.match(markup, /data-reply-id="draft_resume:abc"/);
  assert.match(markup, /data-reply-id="draft_delete:abc"/);
  assert.match(markup, /class="chat-draft-option"/);
  assert.match(markup, /class="chat-draft-delete"/);
  assert.match(markup, /aria-label="Excluir rascunho: EFETUAR LANÇAMENTO"/);
  assert.doesNotMatch(markup, /🗑️ EXCLUIR • EFETUAR LANÇAMENTO/);
  assert.equal((markup.match(/data-reply-id="draft_resume:abc"/g) || []).length, 1);
});

test("não mostra salvar rascunho dentro das perguntas do fluxo", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "flow-question",
      role: "assistant",
      type: "poll",
      question: "ESCOLHA UMA OPÇÃO",
      options: [
        { id: "one", label: "UMA OPÇÃO" },
        { id: "save_draft_main_menu", label: "💾 SALVAR RASCUNHO E RETORNAR AO MENU PRINCIPAL" },
      ],
    }],
  }));

  assert.match(markup, /UMA OPÇÃO/);
  assert.doesNotMatch(markup, /SALVAR RASCUNHO E RETORNAR/);
});

test("mídia recebida mostra cartão de prévia clicável", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{ id: "photo-1", type: "image", fileName: "foto.jpg", previewUrl: "blob:http://local/preview" }],
  }));
  assert.match(markup, /class="chat-media-preview chat-media-preview--image"/);
  assert.match(markup, /alt="Prévia de foto\.jpg"/);
  assert.match(markup, /Toque para abrir o arquivo completo/);
});

test("mostra estado individual e ações de anexos pendentes", () => {
  const markup = renderChatMarkup(signedInState({
    pendingFiles: [
      { id: "f1", file: { name: "foto.jpg", size: 1500 }, status: "sending", error: null },
      { id: "f2", file: { name: "ata.pdf", size: 2200 }, status: "failed", error: "timeout" },
    ],
  }));

  assert.match(markup, /foto\.jpg/);
  assert.match(markup, /Enviando/);
  assert.match(markup, /data-action="retry-file" data-file-id="f2"/);
  assert.match(markup, /data-action="remove-file" data-file-id="f2"/);
  assert.match(markup, /timeout/);
});

test("traduz alvos DOM em comandos sem acoplar a rede", () => {
  const target = {
    closest(selector) {
      if (selector === "[data-action]") {
        return { dataset: { action: "select-reply", replyId: "yes", label: "Sim" } };
      }
      return null;
    },
  };

  assert.deepEqual(commandFromTarget(target), {
    type: "select-reply",
    replyId: "yes",
    label: "Sim",
  });
  assert.equal(commandFromTarget({ closest: () => null }), null);
});

test("anexos do fluxo ficam em lista compacta com ação de visualizar e nomes escapados", () => {
  const markup = renderChatMarkup(signedInState({ attachments: [
    { id: "vm-1", fileName: 'foto <teste>.jpg', size: 1500, mediaUrl: "/api/portal-media/id" },
  ] }));
  assert.match(markup, /<details[^>]*class="chat-attachments"/);
  assert.match(markup, /Anexos \(1\)/);
  assert.match(markup, /data-action="open-file" data-file-id="vm-1"/);
  assert.match(markup, /data-action="remove-attachment" data-file-id="vm-1"/);
  assert.match(markup, /data-action="compress-attachment" data-file-id="vm-1"/);
  assert.ok(markup.indexOf('data-action="compress-attachment"') < markup.indexOf('data-action="remove-attachment"'));
  assert.match(markup, /aria-label="Excluir anexo: foto &lt;teste&gt;\.jpg"/);
  assert.match(markup, /class="chat-attachment-cluster"/);
  assert.match(markup, /foto &lt;teste&gt;\.jpg/);
  assert.doesNotMatch(markup, /src="\/api\/portal-media/);
});

test("anexos novos e existentes ficam visualmente identificados na bandeja", () => {
  const markup = renderChatMarkup(signedInState({ attachments: [
    { id: "old", fileName: "nota-existente.pdf", size: 1200, mediaUrl: "/api/portal-media/old", existing: true, readOnly: true },
    { id: "new", fileName: "comprovante-novo.pdf", size: 2400, mediaUrl: "/api/portal-media/new" },
  ] }));
  assert.match(markup, /data-attachment-origin="existing"/);
  assert.match(markup, /data-attachment-origin="new"/);
  assert.match(markup, /chat-attachment-badge--existing">JÁ EXISTIA/);
  assert.match(markup, /chat-attachment-badge--new">NOVO/);
  assert.doesNotMatch(markup, /data-file-id="old"[^>]*aria-label="Comprimir/);
  assert.doesNotMatch(markup, /data-file-id="old"[^>]*aria-label="Excluir/);
  assert.match(markup, /data-action="compress-attachment" data-file-id="new"/);
  assert.match(markup, /data-action="remove-attachment" data-file-id="new"/);
});

test("bandeja de anexos mostra transferir somente durante um fluxo ativo", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { title: "EFETUAR LANÇAMENTO" },
    attachments: [{ id: "vm-1", fileName: "foto.jpg", size: 20 }],
  }));
  assert.match(markup, /data-action="transfer-attachments"/);
  assert.match(markup, />TRANSFERIR</);
  const menuMarkup = renderChatMarkup(signedInState({
    attachments: [{ id: "vm-1", fileName: "foto.jpg", size: 20 }],
  }));
  assert.doesNotMatch(menuMarkup, /data-action="transfer-attachments"/);
});

test("bandeja de anexos oferece eliminar todos para anexos novos e preserva os existentes", () => {
  const creationMarkup = renderChatMarkup(signedInState({
    activeFlow: { title: "NOVO LANÇAMENTO", allowBulkAttachmentDelete: true },
    attachments: [{ id: "vm-1", fileName: "foto.jpg", size: 20 }],
  }));
  assert.match(creationMarkup, /data-action="delete-all-attachments"/);
  assert.match(creationMarkup, />ELIMINAR</);
  assert.match(creationMarkup, /class="chat-attachments-danger-cluster"><button class="chat-attachments-delete-all"/);
  assert.ok(creationMarkup.indexOf('data-action="delete-all-attachments"')
    < creationMarkup.indexOf('data-action="transfer-attachments"'));

  const editMarkup = renderChatMarkup(signedInState({
    activeFlow: { title: "EDITAR DIÁRIO", allowBulkAttachmentDelete: true },
    attachments: [{ id: "vm-1", fileName: "foto.jpg", size: 20, existing: true, readOnly: true }],
  }));
  assert.doesNotMatch(editMarkup, /data-action="delete-all-attachments"/);
  assert.doesNotMatch(editMarkup, />ELIMINAR</);
  assert.doesNotMatch(editMarkup, /chat-attachments-danger-cluster/);

  const editWithNewMarkup = renderChatMarkup(signedInState({
    activeFlow: { title: "EDITAR DIÁRIO", allowBulkAttachmentDelete: true },
    attachments: [
      { id: "old", fileName: "foto-existente.jpg", size: 20, existing: true, readOnly: true },
      { id: "new", fileName: "foto-nova.jpg", size: 20 },
    ],
  }));
  assert.match(editWithNewMarkup, /data-action="delete-all-attachments"/);
});

test("arquivo pendente também pode ser visualizado sem reenviar", () => {
  const markup = renderChatMarkup(signedInState({ pendingFiles: [
    { id: "pending-1", file: { name: "planta.pdf", size: 40 }, status: "failed" },
  ] }));
  assert.match(markup, /data-action="open-file" data-file-id="pending-1"/);
});
