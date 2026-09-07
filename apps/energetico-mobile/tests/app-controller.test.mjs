import test from "node:test";
import assert from "node:assert/strict";

import { createAppController } from "../src/app-controller.js";
import { createConversationStore } from "../src/chat/conversation-store.js";
import { renderChatMarkup } from "../src/ui/chat-view.js";

function makeView() {
  const handlers = new Map();
  const renders = [];
  return {
    renders,
    render(state) { renders.push(state); },
    on(type, handler) {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
    emit(type, value = {}) { return handlers.get(type)?.({ type, ...value }); },
    focusComposer() {},
    destroy() { handlers.clear(); },
  };
}

function makeHarness({ account = { homeAccountId: "a1", name: "Bernardo" }, historyMode } = {}) {
  let next = 0;
  const store = createConversationStore({ randomUUID: () => `id-${++next}`, historyMode });
  const view = makeView();
  const chatCalls = [];
  const client = {
    async sendText(payload) {
      chatCalls.push(["text", payload]);
      return { status: "processed", messages: [{ type: "text", text: "Confirmado" }] };
    },
    async sendFile(file) {
      chatCalls.push(["file", file.name]);
      return { status: "processed", messages: [{ type: "text", text: `Recebi ${file.name}` }] };
    },
    async deleteAttachment(id) {
      chatCalls.push(["delete-attachment", id]);
      return { status: "processed", messages: [], attachments: [] };
    },
    async fetchMedia(message) {
      chatCalls.push(["media", message.id]);
      return new Blob(["conteúdo"], { type: "application/pdf" });
    },
  };
  const auth = {
    async initialize() { return account; },
    async signIn() { return { homeAccountId: "a2", name: "Bernardo" }; },
    async getToken() { return "token"; },
    async signOut() {},
  };
  const discarded = [];
  const exported = [];
  const native = {
    async capturePhoto() { return []; },
    async pickDocuments() { return []; },
    async importSharedItems() { return []; },
    async discardSharedItem(id) { discarded.push(id); },
    async exportMedia(blob, name) { exported.push([blob.size, name]); },
  };
  const controller = createAppController({ store, view, client, auth, native });
  return { store, view, client, auth, native, controller, chatCalls, discarded, exported };
}

test("anexo PDF sem MIME também solicita a prévia pelo nome do arquivo", async () => {
  const harness = makeHarness();
  let fetched = false;
  harness.client.getAttachments = async () => [{ id: "pdf-no-mime", fileName: "NOTA.PDF", mediaUrl: "/api/portal-media/pdf" }];
  harness.client.fetchMedia = async () => { fetched = true; throw new Error("download simulado"); };
  try {
    await harness.controller.start();
    await harness.controller.refreshAttachments();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(fetched, true);
  } finally { harness.controller.stop(); }
});

test("inicia sessão armazenada e retoma a VM sem responder à pergunta atual", async () => {
  const harness = makeHarness();
  await harness.controller.start();

  assert.equal(harness.view.renders.at(-1).sessionStatus, "authenticated");
  assert.deepEqual(harness.chatCalls[0], ["text", { text: "", replyId: "input_continue" }]);
  assert.equal(harness.store.getState().messages[0].text, "Confirmado");
  assert.equal(harness.store.getState().messages.some(message => message.text === "input_continue"), false);
});

test("retomada consulta a coleção de anexos e restaura a lista suspensa do fluxo", async () => {
  const harness = makeHarness();
  harness.client.getAttachments = async () => [{
    id: "resume-attachment",
    fileName: "contrato.pdf",
    mimeType: "application/pdf",
    size: 1024,
    mediaUrl: "/api/portal-media/resume-attachment",
  }];
  await harness.controller.start();

  assert.equal(harness.store.getState().attachments[0].id, "resume-attachment");
  assert.match(renderChatMarkup(harness.view.renders.at(-1)), /Anexos do fluxo \(1\)/);
});

test('imagem da VM sem id ganha prévia e abre o arquivo sem perder a conversa', async () => {
  const h = makeHarness();
  h.client.sendText = async () => ({ status: 'processed', messages: [
    { type: 'image', fileName: 'log.png', mimeType: 'image/png', mediaUrl: '/api/portal-media/log', caption: 'LOG DE AÇÕES' },
  ] });
  h.client.fetchMedia = async message => {
    h.chatCalls.push(['media', message.id]);
    return new Blob(['test image'], { type: 'image/png' });
  };
  try {
    await h.controller.start();
    await new Promise(resolve => setTimeout(resolve, 200));
    const message = h.store.getState().messages[0];
    assert.ok(message.id);
    assert.match(message.previewUrl, /^blob:/);
    assert.match(renderChatMarkup(h.view.renders.at(-1)), /class="chat-media-preview__image"/);
    await h.view.emit('open-media', { messageId: message.id });
    assert.equal(h.exported.length, 1);
    assert.equal(h.store.getState().messages[0].previewUrl, message.previewUrl);
  } finally { h.controller.stop(); }
});

test('ao abrir identifica o fluxo ativo e permite resumo em imagem sem substituir pergunta ou rascunho', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = { id: 'task', title: 'ADICIONAR TAREFA' };
  h.client.sendText = async () => ({ status: 'processed', activeFlow, messages: [{type:'text', text:'Qual é a filial?'}] });
  await h.controller.start();
  assert.deepEqual(h.store.getState().activeFlow, activeFlow);
  assert.match(renderChatMarkup(h.view.renders.at(-1)), /Ver resumo/);
  h.store.setDraft('Rascunho em andamento');
  const messages = h.store.getState().messages;
  h.client.sendText = async payload => {
    assert.equal(payload.replyId, 'flow_summary');
    return {status:'processed', activeFlow, results:[{status:'flow_summary'}], messages:[{type:'image',mediaUrl:'/api/portal-media/summary',fileName:'resumo.png'}]};
  };
  const previews = [];
  h.native.previewMedia = async (source, name) => { previews.push([await source,name]); };
  await h.view.emit('show-summary');
  assert.equal(previews.length, 1);
  assert.equal(previews[0][1], 'resumo.png');
  assert.equal(h.store.getState().messages, messages);
  assert.equal(h.store.getState().draft, 'Rascunho em andamento');
});

test('res digitado abre resumo, e conclusão remove a opção do fluxo anterior', async () => {
  const h = makeHarness({historyMode:'current-step'});
  await h.controller.start();
  const messages = h.store.getState().messages;
  h.client.sendText = async () => ({status:'processed',activeFlow:{id:'task',title:'TAREFA'},results:[{status:'flow_summary'}],messages:[{type:'image',mediaUrl:'/api/portal-media/summary'}]});
  h.store.setDraft('res');
  await h.controller.sendText();
  assert.equal(h.store.getState().draft, '');
  assert.equal(h.store.getState().messages, messages);
  assert.equal(h.exported.length, 1);
  h.client.sendText = async () => ({status:'processed',activeFlow:null,messages:[{type:'text',text:'Concluído'}]});
  await h.controller.sendText('Sim');
  assert.equal(h.store.getState().activeFlow, null);
  assert.doesNotMatch(renderChatMarkup(h.view.renders.at(-1)), /Ver resumo/);
});

test('resumo sem fluxo ou indisponível preserva a pergunta e informa o motivo', async () => {
  const h = makeHarness({historyMode:'current-step'});
  await h.controller.start();
  const messages = h.store.getState().messages;
  h.client.sendText = async () => ({status:'processed',activeFlow:null,results:[{status:'no_active_flow'}],messages:[{type:'text',text:'Não há nenhum fluxo em andamento.'}]});
  await h.controller.sendText('res');
  assert.equal(h.store.getState().messages, messages);
  assert.match(h.view.renders.at(-1).error, /nenhum fluxo/);
});

test('menu do portal pergunta pelo rascunho antes de sair e não mostra prévia sobre o menu', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = { id: 'task', title: 'EFETUAR LANÇAMENTO', contextId: 'ctx-1' };
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === 'portal_confirm_main_menu') {
      return { status: 'processed', activeFlow, messages: [{ type: 'poll', question: 'Deseja deixar como rascunho?', options: [
        { id: 'portal_draft_exit_save', label: 'SIM, SALVAR COMO RASCUNHO' },
        { id: 'portal_draft_exit_discard', label: 'NÃO, SAIR SEM SALVAR' },
      ] }] };
    }
    return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
      results: [{ draft_saved: true }], activeFlow: null,
      messages: [{ type: 'poll', question: 'MENU PRINCIPAL', options: [] }] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'Pergunta do fluxo', options: [
    { id: 'navigation_main_menu', label: 'RETORNAR AO MENU INICIAL' },
  ] }], { activeFlow });
  assert.ok(h.store.getState().activeFlow);
  await h.view.emit('select-reply', { label: 'RETORNAR AO MENU INICIAL', replyId: 'navigation_main_menu' });
  assert.equal(calls.at(-1).replyId, 'portal_confirm_main_menu');
  assert.match(h.store.getState().messages.at(-1).question, /Deseja deixar como rascunho/);
  await h.view.emit('select-reply', { label: 'SIM, SALVAR COMO RASCUNHO', replyId: 'portal_draft_exit_save' });
  assert.equal(calls.at(-1).replyId, 'portal_draft_exit_save');
  assert.equal(h.view.renders.at(-1).recoveryReference, null);
  assert.doesNotMatch(renderChatMarkup(h.view.renders.at(-1)), /Rascunho da conversa anterior/);
});

test("toques repetidos durante envio não criam uma segunda operação", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  let resolve;
  let calls = 0;
  harness.client.sendText = () => { calls++; return new Promise(done => { resolve = done; }); };
  const sending = harness.controller.sendText('Sim', 'yes');
  const second = harness.controller.sendText('Sim', 'yes');
  assert.equal(calls, 1);
  assert.equal(await second, false);
  resolve({ status: 'processed', messages: [{ type: 'text', text: 'Próxima pergunta' }] });
  await sending;
  assert.equal(harness.store.getState().messages.at(-1).text, 'Próxima pergunta');
});

test("anexo selecionado durante resposta em trânsito aguarda e depois é enviado", async () => {
  const h = makeHarness();
  await h.controller.start();
  let finishText;
  h.client.sendText = () => new Promise(resolve => { finishText = resolve; });
  const sending = h.controller.sendText('Resposta');
  h.native.pickDocuments = async () => [{ name: 'foto.jpg', size: 4, type: 'image/jpeg' }];
  const selecting = h.view.emit('pick-files');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.chatCalls.filter(call => call[0] === 'file').length, 0);
  finishText({ status: 'processed', messages: [] });
  await sending; await selecting;
  assert.deepEqual(h.chatCalls.filter(call => call[0] === 'file'), [['file', 'foto.jpg']]);
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test("sair apaga dados locais antes do redirecionamento Microsoft terminar", async () => {
  const h = makeHarness();
  await h.controller.start();
  h.store.setDraft('Rascunho privado');
  let finishLogout;
  h.auth.signOut = () => new Promise(resolve => { finishLogout = resolve; });
  const logout = h.view.emit('sign-out');
  assert.equal(h.view.renders.at(-1).sessionStatus, 'signed-out');
  assert.equal(h.store.getState().draft, '');
  assert.deepEqual(h.store.getState().messages, []);
  finishLogout(); await logout;
});

test("seleção antiga que retorna após sair não entra na próxima conta", async () => {
  const h = makeHarness();
  await h.controller.start();
  let finishSelection;
  h.native.pickDocuments = () => new Promise(resolve => { finishSelection = resolve; });
  const selecting = h.view.emit('pick-files');
  await h.view.emit('sign-out');
  await h.view.emit('sign-in');
  finishSelection([{ name: 'privado.jpg', size: 4, type: 'image/jpeg' }]);
  await selecting;
  assert.equal(h.chatCalls.filter(call => call[0] === 'file').length, 0);
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test("sem conta aguarda login antes de falar com a VM", async () => {
  const harness = makeHarness({ account: null });
  await harness.controller.start();
  assert.equal(harness.chatCalls.length, 0);
  assert.equal(harness.view.renders.at(-1).sessionStatus, "signed-out");

  await harness.view.emit("sign-in");
  assert.equal(harness.view.renders.at(-1).sessionStatus, "authenticated");
  assert.deepEqual(harness.chatCalls[0], ["text", { text: "", replyId: "input_continue" }]);
});

test("redirecionamento de login não autentica antes de existir uma conta", async () => {
  const harness = makeHarness({ account: null });
  harness.auth.signIn = async () => null;
  await harness.controller.start();

  await harness.view.emit("sign-in");

  assert.equal(harness.chatCalls.length, 0);
  assert.equal(harness.view.renders.at(-1).sessionStatus, "signed-out");
});

test("falha preserva rascunho e não confirma mensagem local", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.ingestRemoteMessages([], { resetConversation: true });
  harness.client.sendText = async () => { throw new Error("VM indisponível"); };

  harness.store.setDraft("Criar registro");
  await harness.controller.sendText("Criar registro");

  assert.equal(harness.store.getState().draft, "Criar registro");
  assert.equal(harness.store.getState().messages.some(message => message.text === "Criar registro"), false);
  assert.equal(harness.store.getState().error, "VM indisponível");
});

test("cancelar a câmera não cria anexo", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  await harness.view.emit("capture-photo");
  assert.equal(harness.store.getState().pendingFiles.length, 0);
});

test("envia vários anexos em série e mantém apenas o que falhou", async () => {
  const harness = makeHarness();
  const attempts = [];
  harness.native.pickDocuments = async () => [
    { name: "a.jpg", size: 1, type: "image/jpeg" },
    { name: "b.pdf", size: 1, type: "application/pdf" },
    { name: "c.txt", size: 1, type: "text/plain" },
  ];
  harness.client.sendFile = async file => {
    attempts.push(file.name);
    if (file.name === "b.pdf") throw new Error("falhou b");
    return { status: "processed", messages: [] };
  };
  await harness.controller.start();

  await harness.view.emit("pick-files");

  assert.deepEqual(attempts, ["a.jpg", "b.pdf", "c.txt"]);
  assert.deepEqual(harness.store.getState().pendingFiles.map(item => [item.file.name, item.status]), [
    ["b.pdf", "failed"],
  ]);
});

test("exibe confirmação do anexo sozinha e troca pela próxima pergunta após um segundo", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  await harness.controller.start();
  harness.store.queueFiles([{ name: "foto.jpg", size: 4, type: "image/jpeg" }]);
  const [file] = harness.store.getState().pendingFiles;
  harness.client.sendFile = async () => ({
    status: "processed",
    messages: [
      { type: "text", text: "📎 ANEXO RECEBIDO. Continue preenchendo o formulário." },
      { type: "text", text: "Qual é a data?" },
    ],
    attachments: [],
  });
  harness.client.getAttachments = async () => [{
    id: "vm-pdf",
    fileName: "anexo-lancamento.pdf",
    mimeType: "application/pdf",
    size: 42,
    mediaUrl: "/api/portal-media/vm-pdf",
  }];

  await harness.controller.uploadFile(file.id);
  assert.deepEqual(harness.store.getState().messages.map(message => message.text), [
    "📎 ANEXO RECEBIDO. Continue preenchendo o formulário.",
  ]);
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.deepEqual(harness.store.getState().messages.map(message => message.text), ["Qual é a data?"]);
  assert.equal(harness.store.getState().attachments[0].fileName, "anexo-lancamento.pdf");
  harness.controller.stop();
});

test("aplica a mesma transição quando uma tarefa é enviada antes da pergunta", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  await harness.controller.start();
  harness.store.ingestRemoteMessages([{ type: "text", text: "Informe a data." }]);
  harness.store.setDraft("Registrar tarefa antecipada");
  harness.client.sendText = async () => ({
    status: "processed",
    messages: [
      { type: "text", text: "✅ TAREFA RECEBIDA." },
      { type: "text", text: "Qual é a data?" },
    ],
  });

  await harness.controller.sendText();
  assert.deepEqual(harness.store.getState().messages.map(message => message.text), ["✅ TAREFA RECEBIDA."]);
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.deepEqual(harness.store.getState().messages.map(message => message.text), ["Qual é a data?"]);
  harness.controller.stop();
});

test("responde enquete, exporta mídia protegida e encerra sessão", async () => {
  const harness = makeHarness();
  let signedOut = false;
  harness.auth.signOut = async () => { signedOut = true; };
  await harness.controller.start();
  harness.store.ingestRemoteMessages([
    { id: "poll", type: "poll", question: "Escolha", options: [] },
    { id: "media", type: "document", fileName: "relatório.pdf", mediaUrl: "/api/portal-media/1" },
  ]);

  await harness.view.emit("select-reply", { label: "Sim", replyId: "yes" });
  assert.deepEqual(harness.chatCalls.at(-1), ["text", { text: "Sim", replyId: "yes" }]);
  await harness.view.emit("open-media", { messageId: "media" });
  assert.deepEqual(harness.exported, [[9, "relatório.pdf"]]);
  await harness.view.emit("sign-out");
  assert.equal(signedOut, true);
  assert.equal(harness.view.renders.at(-1).sessionStatus, "signed-out");
});

test("importa compartilhados e só remove a origem depois da confirmação", async () => {
  const harness = makeHarness();
  harness.native.importSharedItems = async () => [{
    id: "share-1",
    sourceId: "share-1",
    name: "obra.jpg",
    size: 1,
    type: "image/jpeg",
  }];

  await harness.controller.start();

  assert.deepEqual(harness.chatCalls.filter(([kind]) => kind === "file"), [["file", "obra.jpg"]]);
  assert.deepEqual(harness.discarded, ["share-1"]);
  assert.equal(harness.store.getState().pendingFiles.length, 0);
});

test("não duplica upload já confirmado pela extensão", async () => {
  const harness = makeHarness();
  const confirmation = {
    status: "processed",
    messages: [{ type: "text", text: "Já confirmado" }],
  };
  const shared = {
    id: "share-2",
    sourceId: "share-2",
    name: "medição.pdf",
    size: 1,
    type: "application/pdf",
    confirmedResult: confirmation,
  };
  harness.native.importSharedItems = async () => [shared];

  await harness.controller.start();

  assert.deepEqual(harness.chatCalls.filter(([kind]) => kind === "file"), []);
  assert.equal(harness.store.getState().messages.some(message => message.text === "Já confirmado"), true);
  assert.deepEqual(harness.discarded, ["share-2"]);
});

test("web mostra só a nova etapa após responder enquete e permite abrir a mídia atual", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  await harness.controller.start();
  harness.store.ingestRemoteMessages([
    { type: "poll", question: "Gerar relatório?", options: [{ id: "yes", label: "Gerar agora" }] },
  ]);
  harness.client.sendText = async payload => {
    harness.chatCalls.push(["text", payload]);
    return { status: "processed", messages: [
      { type: "text", text: "Relatório disponível." },
      { id: "report", type: "document", fileName: "relatório.pdf", mediaUrl: "/api/portal-media/1" },
      { type: "poll", question: "O que deseja fazer agora?", options: [{ id: "menu", label: "Menu inicial" }] },
    ] };
  };

  await harness.view.emit("select-reply", { label: "Gerar agora", replyId: "yes" });

  assert.deepEqual(harness.chatCalls.at(-1), ["text", { text: "Gerar agora", replyId: "yes" }]);
  const markup = renderChatMarkup(harness.view.renders.at(-1));
  assert.doesNotMatch(markup, /Gerar relatório\?|Gerar agora|Confirmado/);
  assert.match(markup, /Relatório disponível\./);
  assert.match(markup, /O que deseja fazer agora\?/);
  assert.match(markup, /Menu inicial/);
  assert.deepEqual(harness.store.getState().messages.map(message => message.type), ["text", "document", "poll"]);

  await harness.view.emit("open-media", { messageId: "report" });
  assert.deepEqual(harness.exported, [[9, "relatório.pdf"]]);
  assert.deepEqual(harness.chatCalls.at(-1), ["media", "report"]);
});

test("web conserva a pergunta durante envio e falha e a troca depois de tentar novamente", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  await harness.controller.start();
  harness.store.ingestRemoteMessages([{ type: "text", text: "Descreva as atividades." }]);
  let rejectSend;
  harness.client.sendText = () => new Promise((resolve, reject) => { rejectSend = reject; });
  harness.view.emit("draft-changed", { value: "Concretagem da laje" });
  const sending = harness.view.emit("send-text");
  assert.match(renderChatMarkup(harness.view.renders.at(-1)), /Descreva as atividades\./);
  rejectSend(new Error("Conexão perdida"));
  await sending;
  assert.equal(harness.store.getState().draft, "Concretagem da laje");
  assert.deepEqual(harness.store.getState().messages.map(message => message.text), ["Descreva as atividades."]);

  harness.client.sendText = async () => ({ status: "processed", messages: [{ type: "text", text: "Houve ocorrências?" }] });
  await harness.view.emit("send-text");
  const markup = renderChatMarkup(harness.view.renders.at(-1));
  assert.doesNotMatch(markup, /Descreva as atividades\.|Concretagem da laje|Conexão perdida/);
  assert.match(markup, /Houve ocorrências\?/);
});

test("visualiza anexo local confirmado e pendente sem reenviar nem alterar a pergunta", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  const previews = [];
  harness.native.previewMedia = async (source, name) => previews.push([await source, name]);
  await harness.controller.start();
  const file = new File(["foto"], "obra.jpg", { type: "image/jpeg" });
  harness.store.queueFiles([file]);
  const [item] = harness.store.getState().pendingFiles;
  await harness.view.emit("open-file", { fileId: item.id });
  assert.equal(previews.length, 1);
  assert.equal(previews[0][0], file);
  harness.store.confirmFile(harness.store.beginFile(item.id), { messages: [{ type: "text", text: "Pergunta atual" }] });
  harness.store.setDraft("Rascunho");
  await harness.view.emit("open-file", { fileId: item.id });
  assert.equal(previews.length, 2);
  assert.equal(harness.store.getState().draft, "Rascunho");
  assert.equal(harness.store.getState().messages[0].text, "Pergunta atual");
  assert.equal(harness.chatCalls.filter(([kind]) => kind === "file").length, 0);
});

test("retorno do Atalho atualiza somente anexos e entrega mídia remota ao visualizador", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  const previews = [];
  harness.native.previewMedia = async (source, name) => previews.push([await source, name]);
  await harness.controller.start();
  harness.client.getAttachments = async () => [{ id: "from-shortcut", fileName: "planta.pdf", mediaUrl: "/api/portal-media/a" }];
  assert.equal(typeof harness.controller.refreshAttachments, "function");
  await harness.controller.refreshAttachments();
  await harness.view.emit("open-file", { fileId: "from-shortcut" });
  assert.deepEqual(harness.chatCalls, [["text", { text: "", replyId: "input_continue" }], ["media", "from-shortcut"]]);
  assert.equal(previews[0][1], "planta.pdf");
  assert.equal(await previews[0][0].text(), "conteúdo");
  assert.equal(harness.store.getState().messages[0].text, "Confirmado");
});

test('lixeira exclui apenas o anexo confirmado selecionado dentro do fluxo', async () => {
  const h = makeHarness();
  await h.controller.start();
  h.store.syncAttachments([
    { id: "remove-me", fileName: "remover.jpg", mediaUrl: "/api/portal-media/a" },
    { id: "keep-me", fileName: "manter.pdf", mediaUrl: "/api/portal-media/b" },
  ]);
  h.client.deleteAttachment = async id => {
    h.chatCalls.push(["delete-attachment", id]);
    return { status: "processed", messages: [], attachments: [
      { id: "keep-me", fileName: "manter.pdf", mediaUrl: "/api/portal-media/b" },
    ] };
  };
  await h.view.emit("remove-attachment", { fileId: "remove-me" });
  assert.deepEqual(h.chatCalls.at(-1), ["delete-attachment", "remove-me"]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ["keep-me"]);
  h.controller.stop();
});

test("snapshot atrasado não sobrescreve anexos da resposta mais nova", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  let resolveSnapshot;
  harness.client.getAttachments = () => new Promise(resolve => { resolveSnapshot = resolve; });
  assert.equal(typeof harness.controller.refreshAttachments, "function");
  const refresh = harness.controller.refreshAttachments();
  harness.client.sendText = async () => ({ status: "processed", messages: [], attachments: [
    { id: "new", fileName: "novo.pdf", mediaUrl: "/api/portal-media/new" },
  ] });
  await harness.controller.sendText("Continuar");
  resolveSnapshot([{ id: "old", fileName: "velho.pdf", mediaUrl: "/api/portal-media/old" }]);
  await refresh;
  assert.deepEqual(harness.store.getState().attachments.map(item => item.id), ["new"]);
});

test("mídia expirada renova snapshot sem reenviar resposta ao fluxo", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.syncAttachments([{ id: "file", fileName: "nota.pdf", mediaUrl: "/api/portal-media/old" }]);
  harness.client.getAttachments = async () => [{ id: "file", fileName: "nota.pdf", mediaUrl: "/api/portal-media/new" }];
  harness.client.fetchMedia = async item => {
    if (item.mediaUrl.endsWith("old")) throw Object.assign(new Error("expirou"), { status: 404 });
    return new Blob(["renovado"]);
  };
  let previewText;
  harness.native.previewMedia = async source => { previewText = await (await source).text(); };
  await harness.view.emit("open-file", { fileId: "file" });
  assert.equal(previewText, "renovado");
  assert.equal(harness.chatCalls.length, 1);
});

test("sair fecha prévia e impede snapshot antigo de restaurar anexos privados", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  let resolveSnapshot;
  let closed = false;
  harness.native.closePreview = () => { closed = true; };
  harness.client.getAttachments = () => new Promise(resolve => { resolveSnapshot = resolve; });
  assert.equal(typeof harness.controller.refreshAttachments, "function");
  const refresh = harness.controller.refreshAttachments();
  await harness.view.emit("sign-out");
  resolveSnapshot([{ id: "old", fileName: "privado.pdf", mediaUrl: "/api/portal-media/old" }]);
  await refresh;
  assert.equal(closed, true);
  assert.deepEqual(harness.store.getState().attachments, []);
});
