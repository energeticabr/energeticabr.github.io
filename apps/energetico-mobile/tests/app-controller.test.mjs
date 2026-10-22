import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from 'pdf-lib';

import { createAppController, shouldRemoveSignedSource } from "../src/app-controller.js";
import { createConversationStore } from "../src/chat/conversation-store.js";
import { validateAttachment } from "../../../portal/data/attachments.js";
import { createChatView, renderChatMarkup } from "../src/ui/chat-view.js";
import { createAttachmentPreview } from '../src/web/attachment-preview.js';
import { createNativePorts } from '../src/native/native-ports.js';
import { scannedPages } from './helpers/scanned-pages.mjs';

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

// The native preview accepts local blobs, legacy promises and cancellable loaders.
const previewSource = async source => typeof source === 'function' ? source({}) : source;

function makeHarness({ account = { homeAccountId: "a1", name: "Bernardo" }, historyMode, mediaLoadTimeoutMs, rhidReportTimeoutMs, authTimeoutMs, authSignInTimeoutMs, signPdfAttachment, launchGalleryFactory, ordersGalleryFactory, ordersGalleryDataFactory, tasksGalleryFactory, tasksGalleryDataFactory, contractorReportsFactory, paymentLedgerFactory, paymentLedgerDataFactory, cargosFactory, cargosDataFactory, paymentProgrammingGalleryFactory, paymentProgrammingGalleryDataFactory, recurringExpensesGalleryFactory, recurringExpensesGalleryDataFactory, registrationGalleryFactory, registrationGalleryDataFactory, pendingProvisionAttachmentsDataFactory, pendingConstructionDiaryDataFactory, recentDiaryActivitiesDataFactory, hrPayrollGalleryFactory, hrPayrollGalleryDataFactory, payrollSheetCreateFactory, supplierPayrollFactory, supplierPayrollDataFactory, mealVoucherFactory, mealVoucherDataFactory, databaseFilterDebounceMs, view: suppliedView } = {}) {
  let next = 0;
  const store = createConversationStore({ randomUUID: () => `id-${++next}`, historyMode });
  const view = suppliedView || makeView();
  const chatCalls = [];
  const client = {
    async prepareSignatureEvidence() {
      return { id: "0123456789abcdef0123456789abcdef", signedAt: "2026-10-03T23:00:00Z", sourceSha256: "a".repeat(64) };
    },
    async confirmSignatureEvidence({ recordId }) {
      return { id: recordId, signedAt: "2026-10-03T23:00:00Z", sourceSha256: "a".repeat(64), finalSha256: "b".repeat(64), status: "confirmed", mediaUrl: "/api/portal-media/confirmed" };
    },
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
  const provisionDataFactory = pendingProvisionAttachmentsDataFactory || (async () => ({
    loadUpcomingPayments: async () => [], listAttachments: async () => [], downloadAttachment: async () => new Blob(),
  }));
  const controller = createAppController({ store, view, client, auth, native, diaryFieldVisitDataFactory: async () => ({ load: async () => [] }), mediaLoadTimeoutMs, rhidReportTimeoutMs, authTimeoutMs, authSignInTimeoutMs, signPdfAttachment, launchGalleryFactory, ordersGalleryFactory, ordersGalleryDataFactory, tasksGalleryFactory, tasksGalleryDataFactory, contractorReportsFactory, paymentLedgerFactory, paymentLedgerDataFactory, cargosFactory, cargosDataFactory, paymentProgrammingGalleryFactory, paymentProgrammingGalleryDataFactory, recurringExpensesGalleryFactory, recurringExpensesGalleryDataFactory, registrationGalleryFactory, registrationGalleryDataFactory, pendingProvisionAttachmentsDataFactory: provisionDataFactory, pendingConstructionDiaryDataFactory, recentDiaryActivitiesDataFactory, hrPayrollGalleryFactory, hrPayrollGalleryDataFactory, payrollSheetCreateFactory, supplierPayrollFactory, supplierPayrollDataFactory, mealVoucherFactory, mealVoucherDataFactory, databaseFilterDebounceMs });
  return { store, view, client, auth, native, controller, chatCalls, discarded, exported };
}

const observationQuestion = '💬 DESEJA FAZER ALGUMA OBSERVAÇÃO?\nDIGITE DIRETAMENTE A OBSERVAÇÃO OU DESCRIÇÃO, OU SELECIONE UMA DAS OPÇÕES ABAIXO.';

for (const command of ['open-file', 'open-media']) test(`${command} opens the real preview before downloading and forwards measured progress`, async t => {
  const h = makeHarness();
  const dom = new JSDOM('<main></main>'), documentRef = dom.window.document;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const preview = createAttachmentPreview({ documentRef });
  h.native.previewMedia = preview.open; h.native.closePreview = preview.close;
  t.after(() => { h.controller.stop(); preview.destroy(); dom.window.close(); });
  await h.controller.start();
  const attachment = { id: 'download', fileName: 'large.txt', mimeType: 'text/plain', size: 12_000_000, mediaUrl: '/api/portal-media/download' };
  h.store.ingestRemoteMessages([{ ...attachment, type: 'document' }], { attachments: [attachment], activeFlow: { id: 'supplies', title: 'SUPRIMENTOS' } });
  let received, finish, openedAtRequest;
  h.client.fetchMedia = (_item, options) => {
    received = options;
    openedAtRequest = documentRef.querySelector('dialog').open;
    return new Promise(resolve => { finish = resolve; });
  };
  const opening = h.view.emit(command, { fileId: 'download', messageId: 'download' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(openedAtRequest, true);
  assert.equal(typeof received?.onProgress, 'function');
  received.onProgress({ percent: 40, loaded: 4, total: 10 });
  assert.equal(documentRef.querySelector('[role="progressbar"]').textContent, '40%');
  finish(new Blob(['conteúdo'], { type: 'text/plain' }));
  assert.equal(await opening, true);
  assert.equal(documentRef.querySelector('[role="progressbar"]').textContent, '100%');
  assert.equal(documentRef.querySelector('.attachment-preview-text').textContent, 'conteúdo');
});

for (const mode of ['scan','photo',null]) test(`camera mode ${mode} uses only the chosen confirmed files`, async t => {
  const h=makeHarness();t.after(()=>h.controller.stop());await h.controller.start();
  h.view.chooseCaptureMode=async()=>mode;
  h.native.scanDocument=async()=>[new File(['scan'],'scan.jpg',{type:'image/jpeg'})];
  h.native.capturePhoto=async()=>[new File(['photo'],'photo.jpg',{type:'image/jpeg'})];
  await h.view.emit('capture-photo');
  assert.deepEqual(h.chatCalls.filter(c=>c[0]==='file'),mode?[["file",`${mode}.jpg`]]:[]);
});

// A regression to queueing every scanner image, or merging a later check, must fail at sendFile.
test('scanner batches reach the tray and upload as one separate PDF per check without merging existing photos',async t=>{
  const h=makeHarness();t.after(()=>h.controller.stop());await h.controller.start();
  const fixture=await scannedPages([[[80,120,'red'],[160,90,'blue']],[[70,110,'green'],[90,130,'yellow'],[100,140,'purple']]]);
  h.native.scanDocument=createNativePorts(fixture).scanDocument;
  h.view.chooseCaptureMode=async()=>'scan';
  h.store.queueFiles([new File(['existing'],'foto-anterior.jpg',{type:'image/jpeg'})]);
  const uploaded=[];let finish;
  h.client.sendFile=async file=>{uploaded.push(file);return new Promise(resolve=>finish=()=>resolve({status:'processed',messages:[],attachments:[]}));};
  const first=h.view.emit('capture-photo');
  for(let i=0;i<100&&!uploaded.length;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(uploaded.length,1);
  assert.deepEqual(h.store.getState().pendingFiles.map(item=>item.file.type),['image/jpeg','application/pdf']);
  finish();await first;
  h.client.sendFile=async file=>{uploaded.push(file);return {status:'processed',messages:[],attachments:[]};};
  assert.equal(await h.view.emit('capture-photo'),true);
  assert.equal(uploaded.length,2);
  assert.ok(uploaded.every(file=>file.type==='application/pdf'));
  assert.notEqual(uploaded[0].name,uploaded[1].name);
  assert.equal((await PDFDocument.load(await uploaded[0].arrayBuffer())).getPageCount(),2);
  assert.equal((await PDFDocument.load(await uploaded[1].arrayBuffer())).getPageCount(),3);
  assert.ok(h.store.getState().pendingFiles.some(item=>item.file.name==='foto-anterior.jpg'),'não consumir outras fotos da bandeja');
});

test('invalid multi-page scan never queues or uploads partial images and reports a retryable error',async t=>{
  const h=makeHarness();t.after(()=>h.controller.stop());await h.controller.start();
  const fixture=await scannedPages([[[80,120,'red'],[160,90,'blue']]]);
  fixture.bytes.set('file:///scan/1/2.jpg',Buffer.from('not-a-jpeg'));fixture.results[0].items[1].size=10;
  h.native.scanDocument=createNativePorts(fixture).scanDocument;h.view.chooseCaptureMode=async()=>'scan';
  assert.equal(await h.view.emit('capture-photo'),false);
  assert.deepEqual(h.chatCalls.filter(c=>c[0]==='file'),[]);
  assert.deepEqual(h.store.getState().pendingFiles,[]);
  assert.ok(h.view.renders.some(state=>state.error||state.sessionError),'exibir falha de preparação sem enviar páginas soltas');
  assert.deepEqual(fixture.released,[{id:'scan-session-1'}]);
});

test('camera selection is single-flight and never uploads after the session ends',async t=>{
  const h=makeHarness();t.after(()=>h.controller.stop());await h.controller.start();
  let choose,opens=0;
  h.view.chooseCaptureMode=()=>{opens++;return new Promise(r=>choose=r);};
  h.native.scanDocument=async()=>[new File(['scan'],'scan.jpg',{type:'image/jpeg'})];
  const first=h.view.emit('capture-photo');const second=h.view.emit('capture-photo');
  assert.equal(opens,1);await h.controller.stop();choose('scan');await Promise.all([first,second]);
  assert.deepEqual(h.chatCalls.filter(c=>c[0]==='file'),[]);
});

for(const phase of ['chooser','scanner']) test(`old ${phase} cannot send a scan after reentry with the same account object`,async t=>{
  const sameAccount={homeAccountId:'same',name:'Test'};
  const h=makeHarness({account:sameAccount});t.after(()=>h.controller.stop());await h.controller.start();
  let complete,finishLogout,scans=0;
  h.auth.signOut=()=>new Promise(r=>finishLogout=r);h.auth.signIn=async()=>sameAccount;
  h.view.chooseCaptureMode=()=>phase==='chooser'?new Promise(r=>complete=r):Promise.resolve('scan');
  h.native.scanDocument=()=>{scans++;return phase==='scanner'?new Promise(r=>complete=r):Promise.resolve([new File(['late'],'late-scan.jpg',{type:'image/jpeg'})]);};
  const pending=h.view.emit('capture-photo');await new Promise(r=>setImmediate(r));
  const logout=h.view.emit('sign-out');await h.view.emit('sign-in');
  complete(phase==='chooser'?'scan':[new File(['late'],'late-scan.jpg',{type:'image/jpeg'})]);await pending;
  assert.deepEqual(h.chatCalls.filter(c=>c[0]==='file'),[]);
  if(phase==='chooser')assert.equal(scans,0);
  finishLogout();await logout;
});

test('old scanner rejection cannot show an error after sign-out',async t=>{
  const h=makeHarness();t.after(()=>h.controller.stop());await h.controller.start();let fail;
  h.view.chooseCaptureMode=async()=>'scan';h.native.scanDocument=()=>new Promise((_,reject)=>fail=reject);
  const pending=h.view.emit('capture-photo');await new Promise(r=>setImmediate(r));await h.view.emit('sign-out');
  fail(new Error('stale-scanner-error'));await pending;
  assert.ok(!h.view.renders.some(state=>String(state.error||state.sessionError).includes('stale-scanner-error')));
});

test('camera scanner failures show a retryable error without an attachment',async t=>{
  const h=makeHarness();t.after(()=>h.controller.stop());await h.controller.start();
  h.view.chooseCaptureMode=async()=>'scan';h.native.scanDocument=async()=>{throw new Error('Scanner indisponível agora');};
  assert.equal(await h.view.emit('capture-photo'),false);
  assert.ok(h.view.renders.some(state=>String(state.error||state.sessionError).includes('Scanner indisponível agora')));
  assert.deepEqual(h.chatCalls.filter(c=>c[0]==='file'),[]);
});

function provisionPdfResult(category = 'A VENCER') {
  return { status: 'processed', results: [{ status: 'pending_provisions_report', category, count: 1 }],
    messages: [{ id: 'generated-report', type: 'document', mimeType: 'application/pdf',
      fileName: 'provisoes.pdf', caption: `PROVISÕES PGTO — ${category}`, mediaUrl: '/api/portal-media/provisions' },
    { type: 'poll', question: 'PROVISÕES PGTO PENDENTES', options: [
      { id: 'pending_payment_provisions_due', label: 'PROVISÕES VENCIDAS / VENCEM HOJE' },
      { id: 'pending_payment_provisions_future', label: '🟢 PROVISÕES A VENCER' },
    ] }] };
}

for (const [replyId, category] of [
  ['pending_payment_provisions_due', 'VENCIDAS / VENCEM HOJE'],
  ['pending_payment_provisions_future', 'A VENCER'],
]) {
  test(`provision PDF auto-open: ${replyId} opens the generated PDF without a media click`, async t => {
    const h = makeHarness();
    t.after(() => h.controller.stop());
    await h.controller.start();
    const previews = [];
    h.native.previewMedia = async (blob, name, options) => { previews.push({ blob: await previewSource(blob), name, options }); };
    h.client.sendText = async () => provisionPdfResult(category);
    assert.equal(await h.view.emit('select-reply', { replyId, label: category }), true);
    assert.equal(previews.length, 1);
    assert.equal(previews[0].name, 'provisoes.pdf');
    assert.equal(previews[0].blob.type, 'application/pdf');
    assert.equal(previews[0].options.layout, 'report-pdf');
    assert.ok(h.store.getState().messages.some(message => message.mediaUrl === '/api/portal-media/provisions'));
    h.store.setDraft('outra consulta');
    assert.equal(previews.length, 1, 'rerender must not reopen the PDF');
  });
}

test('provision PDF auto-open: unrelated replies, empty reports and mismatched media never open a PDF', async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const previews = [];
  h.native.previewMedia = async (...args) => { previews.push(args); };
  const unrelated = provisionPdfResult();
  const wrongCategory = provisionPdfResult('VENCIDAS / VENCEM HOJE');
  const empty = { status: 'processed', results: [{ status: 'pending_provisions_empty' }], messages: [{ type: 'text', text: 'NÃO HÁ PROVISÕES A VENCER.' }] };
  const image = provisionPdfResult(); image.messages[0] = { ...image.messages[0], type: 'image', mimeType: 'image/png', fileName: 'outro.png', caption: 'Outro relatório' };
  for (const [replyId, response] of [['input_continue', unrelated], ['pending_payment_provisions_future', empty],
    ['pending_payment_provisions_future', wrongCategory], ['pending_payment_provisions_future', image]]) {
    h.client.sendText = async () => response;
    assert.equal(await h.view.emit('select-reply', { replyId, label: 'Consultar' }), true);
  }
  assert.equal(previews.length, 0);
});

for (const [replyId, category] of [
  ['pending_payment_provisions_due', 'VENCIDAS / VENCEM HOJE'],
  ['pending_payment_provisions_future', 'A VENCER'],
]) test(`provision image report: ${replyId} opens every generated image page as one PDF`, async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const result = provisionPdfResult(category), first = result.messages[0];
  result.messages = [
    { ...first, id: 'page-1', type: 'image', mimeType: 'image/png', fileName: 'provisoes-1.png' },
    { ...first, id: 'page-2', type: 'image', mimeType: 'application/octet-stream', fileName: 'provisoes-2.jpg', mediaUrl: '/api/portal-media/provisions-2' },
    result.messages[1],
  ];
  h.client.sendText = async () => result;
  const png = readFileSync(new URL('../../../assets/logo-energetica-oficial.png', import.meta.url));
  h.client.fetchMedia = async message => {
    assert.ok(['page-1', 'page-2'].includes(message.id));
    // Some media responses omit Content-Type: the encoded bytes still identify JPEG.
    return message.id === 'page-1' ? new Blob([png], { type: 'image/png' })
      : new Blob([readFileSync(new URL('../../../assets/projeto-bandeirante/bandeirante-sala-cozinha-render.jpg', import.meta.url))]);
  };
  const previews = [];
  h.native.previewMedia = async (blob, name, options) => { previews.push({ blob: await previewSource(blob), name, options }); };
  assert.equal(await h.view.emit('select-reply', { replyId, label: category }), true);
  assert.equal(previews.length, 1, 'one popup for the whole report, not one per image');
  assert.equal(previews[0].blob.type, 'application/pdf');
  assert.match(previews[0].name, /\.pdf$/i);
  assert.equal(previews[0].options.layout, 'report-pdf');
  const pdf = await PDFDocument.load(await previews[0].blob.arrayBuffer());
  assert.equal(pdf.getPageCount(), 2, 'the generated PDF must contain both report pages');
  assert.ok(Math.abs(pdf.getPage(0).getHeight() - 287.14) < 0.01, '431x147 PNG stays first with its aspect ratio');
  assert.ok(Math.abs(pdf.getPage(1).getHeight() - 631.4175) < 0.01, '1448x1086 JPEG stays second with its aspect ratio');
  assert.equal(h.store.getState().messages.filter(message => message.type === 'image').length, 2);
});

test('provision image report: a failed page never opens a misleading partial PDF', async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const result = provisionPdfResult(), page = { ...result.messages[0], type: 'image', mimeType: 'image/png', fileName: 'pagina.png' };
  result.messages = [page, { ...page, id: 'second', mediaUrl: '/api/portal-media/second' }, result.messages[1]];
  h.client.sendText = async () => result;
  h.client.fetchMedia = async message => {
    if (message.id === 'second') throw new Error('Segunda página indisponível');
    return new Blob([readFileSync(new URL('../../../assets/logo-energetica-oficial.png', import.meta.url))], { type: 'image/png' });
  };
  const previews = [];
  h.native.previewMedia = async (...args) => { previews.push(args); };
  assert.equal(await h.view.emit('select-reply', { replyId: 'pending_payment_provisions_future', label: 'A VENCER' }), true);
  assert.equal(previews.length, 0);
  assert.match(h.view.renders.at(-1).error, /Segunda página indisponível/);
  assert.equal(h.store.getState().messages.filter(message => message.type === 'image').length, 2);
});

test('provision image report: an unsupported matching image rejects the entire PDF instead of omitting a page', async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const result = provisionPdfResult(), page = { ...result.messages[0], type: 'image', mimeType: 'image/png', fileName: 'pagina.png' };
  result.messages = [page, { ...page, id: 'second', mimeType: 'image/webp', fileName: 'pagina2.webp', mediaUrl: '/api/portal-media/second' }, result.messages[1]];
  h.client.sendText = async () => result;
  h.client.fetchMedia = async message => message.id === 'second'
    ? new Blob(['invalid image'], { type: 'image/webp' })
    : new Blob([readFileSync(new URL('../../../assets/logo-energetica-oficial.png', import.meta.url))], { type: 'image/png' });
  const previews = [];
  h.native.previewMedia = async (...args) => { previews.push(args); };
  assert.equal(await h.view.emit('select-reply', { replyId: 'pending_payment_provisions_future', label: 'A VENCER' }), true);
  assert.equal(previews.length, 0);
  assert.ok(h.view.renders.at(-1).error);
});

test('provision image report: leaving during the first download skips remaining pages', async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const result = provisionPdfResult(), page = { ...result.messages[0], type: 'image', mimeType: 'image/png', fileName: 'pagina.png' };
  result.messages = [page, { ...page, id: 'second', mediaUrl: '/api/portal-media/second' }, result.messages[1]];
  h.client.sendText = async () => result;
  let release, downloads = 0;
  h.client.fetchMedia = () => { downloads++; return new Promise(resolve => { release = resolve; }); };
  const pending = h.view.emit('select-reply', { replyId: 'pending_payment_provisions_future', label: 'A VENCER' });
  await new Promise(resolve => setImmediate(resolve));
  h.controller.stop();
  release(new Blob(['png'], { type: 'image/png' }));
  await pending;
  assert.equal(downloads, 1);
  assert.equal(h.exported.length, 0);
});

test('provision PDF auto-open: slow media cannot open over a newer conversation', async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  let release;
  const previews = [];
  h.native.previewMedia = async (...args) => { previews.push(args); };
  h.client.fetchMedia = () => new Promise(resolve => { release = resolve; });
  h.client.sendText = async ({ replyId }) => replyId === 'pending_payment_provisions_future'
    ? provisionPdfResult() : { status: 'processed', messages: [{ type: 'text', text: 'Outra tela' }] };
  const request = h.view.emit('select-reply', { replyId: 'pending_payment_provisions_future', label: 'A VENCER' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function');
  await h.view.emit('select-reply', { replyId: 'group_pending', label: 'Pendências' });
  release(new Blob(['pdf'], { type: 'application/pdf' }));
  assert.equal(await request, true);
  assert.equal(previews.length, 0);
});

test('provision PDF auto-open: download failure preserves the report and manual retry', async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.client.sendText = async () => provisionPdfResult();
  h.client.fetchMedia = async () => { throw new Error('Arquivo indisponível'); };
  assert.equal(await h.view.emit('select-reply', { replyId: 'pending_payment_provisions_future', label: 'A VENCER' }), true);
  assert.match(h.view.renders.at(-1).error || '', /abrir.*PDF|Arquivo indisponível/i);
  const message = h.store.getState().messages.find(item => item.mediaUrl);
  assert.ok(message);
  h.client.fetchMedia = async () => new Blob(['pdf'], { type: 'application/pdf' });
  assert.equal(await h.view.emit('open-media', { messageId: message.id }), true);
  assert.equal(h.exported.length, 1);
});

for (const action of ['stop', 'sign-out']) {
  test(`provision PDF auto-open: ${action} invalidates an in-flight download`, async t => {
    const h = makeHarness();
    t.after(() => h.controller.stop());
    await h.controller.start();
    let release;
    const previews = [];
    h.native.previewMedia = async (...args) => { previews.push(args); };
    h.client.fetchMedia = () => new Promise(resolve => { release = resolve; });
    h.client.sendText = async () => provisionPdfResult();
    const pending = h.view.emit('select-reply', { replyId: 'pending_payment_provisions_future', label: 'A VENCER' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof release, 'function');
    if (action === 'stop') h.controller.stop();
    else await h.view.emit('sign-out');
    release(new Blob(['pdf'], { type: 'application/pdf' }));
    await pending;
    assert.equal(previews.length, 0);
  });
}

test('carrega atividades recentes somente na pergunta de atividades do diário', async t => {
  let loads = 0;
  let reference;
  const h = makeHarness({ recentDiaryActivitiesDataFactory: async () => ({
    async load(options) { loads++; reference = options; return ['Impermeabilização arrimo', 'Escoramento laje']; },
  }) });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const sentBeforeSuggestions = h.chatCalls.filter(call => call[0] === 'text').length;
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'DIGITE AS ATIVIDADES EXECUTADAS:',
    options: [{ id: 'abandon_construction_diary', label: 'ABANDONAR DIÁRIO DE OBRAS' }],
  }], { activeFlow: { id: 'construction_diary_fill', title: 'PREENCHER DIÁRIO DE OBRAS',
    contextId: 'diary-217', rows: [{ label: 'DATA', value: '14/10/2026' }, { label: 'FILIAL', value: 'Obra A' }] } });
  assert.equal(h.store.getState().activeFlow?.id, 'construction_diary_fill');
  assert.equal(h.store.getState().messages.at(-1)?.type, 'poll');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads, 1);
  assert.equal(reference.diaryDate, '14/10/2026');
  assert.equal(reference.branch, 'Obra A');
  assert.deepEqual(h.view.renders.at(-1).messages.at(-1).recentDiaryActivities,
    ['Impermeabilização arrimo', 'Escoramento laje']);
  assert.equal(h.chatCalls.filter(call => call[0] === 'text').length, sentBeforeSuggestions);
});

test('trocar diário descarta sugestões atrasadas e consulta a nova data e filial', async t => {
  const requests = [];
  const h = makeHarness({ recentDiaryActivitiesDataFactory: async () => ({
    load(options) { return new Promise(resolve => requests.push({ ...options, resolve })); },
  }) });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const show = (day, branch) => h.store.ingestRemoteMessages([{
    type: 'poll', question: 'DIGITE AS ATIVIDADES EXECUTADAS:',
    options: [{ id: 'abandon_construction_diary', label: 'ABANDONAR DIÁRIO DE OBRAS' }],
  }], { activeFlow: { id: 'construction_diary_fill', title: 'PREENCHER DIÁRIO DE OBRAS', contextId: `diary-${day}`,
    rows: [{ label: 'DATA', value: day }, { label: 'FILIAL', value: branch }] } });
  show('14/10/2026', 'Obra A');
  await new Promise(resolve => setImmediate(resolve));
  show('10/10/2026', 'Obra B');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].diaryDate, '10/10/2026');
  assert.equal(requests[1].branch, 'Obra B');
  requests[1].resolve(['Nova obra']);
  await new Promise(resolve => setImmediate(resolve));
  requests[0].resolve(['Resultado antigo']);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.view.renders.at(-1).messages.at(-1).recentDiaryActivities, ['Nova obra']);
});

function groupedPendingProvisionSnapshot() {
  return { sourceKind: "provision-description", due: true, today: "2026-10-11", checkedDate: "2026-10-11", rows: [{
    id: "306", supplier: "COFER", product: "CIMENTO · AREIA", branch: "XAVANTE", property: "A · B",
    dueDate: "2026-10-12", total: "9007199254740993.21", totalDisplay: "R$ 9.007.199.254.740.993,21",
    childCount: 3, pendingChildIds: ["91", "92"], sourceKind: "provision-description",
  }] };
}

test('pending description delete opens a complete preview and No returns without deleting', async t => {
  const preview = { id: '306', supplier: 'COFER', children: [{ id: '91' }, { id: '92' }, { id: '93', status: 'PAGO' }] };
  let removes = 0;
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    listAttachments: async () => [], downloadAttachment: async () => new Blob(),
    previewDeletion: async id => { assert.equal(id, '306'); return preview; },
    deleteDescription: async () => { removes++; },
  }) });
  h.client.getPendingProvisionSnapshot = async () => groupedPendingProvisionSnapshot();
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('request-pending-provision-deletion', { paymentId: '306' }), true);
  assert.equal(h.view.renders.at(-1).pendingProvisionDeletion.status, 'ready');
  assert.deepEqual(h.view.renders.at(-1).pendingProvisionDeletion.children.map(row => row.id), ['91', '92', '93']);
  assert.equal(removes, 0);
  assert.equal(await h.view.emit('cancel-pending-provision-deletion'), true);
  assert.equal(h.view.renders.at(-1).pendingProvisionDeletion, null);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 1);
  assert.equal(removes, 0);
});

test('pending description deletion requires its preview and prevents double confirmation', async t => {
  const preview = { id: '306', supplier: 'COFER', children: [{ id: '91' }] };
  let release, removes = 0;
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    listAttachments: async () => [], downloadAttachment: async () => new Blob(),
    previewDeletion: async () => preview,
    deleteDescription: async (context, options) => {
      assert.equal(context, preview); assert.deepEqual(options, { confirm: true }); removes++;
      await new Promise(resolve => { release = resolve; });
      return { id: '306', deleted: true, deletedChildIds: ['91'] };
    },
  }) });
  h.client.getPendingProvisionSnapshot = async () => groupedPendingProvisionSnapshot();
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit('confirm-pending-provision-deletion', { paymentId: '306' }), false);
  await h.view.emit('request-pending-provision-deletion', { paymentId: '306' });
  const first = h.view.emit('confirm-pending-provision-deletion', { paymentId: '306' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(removes, 1);
  assert.equal(await h.view.emit('confirm-pending-provision-deletion', { paymentId: '306' }), false);
  assert.equal(await h.view.emit('cancel-pending-provision-deletion'), false);
  release();
  assert.equal(await first, true);
  assert.equal(h.view.renders.at(-1).pendingProvisionDeletion, null);
  assert.deepEqual(h.view.renders.at(-1).pendingProvisions.rows, []);
});

test('incomplete deletion keeps confirmation and pending parent for explicit retry', async t => {
  const preview = { id: '306', supplier: 'COFER', children: [{ id: '91' }, { id: '92' }] };
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    listAttachments: async () => [], downloadAttachment: async () => new Blob(), previewDeletion: async () => preview,
    deleteDescription: async () => { throw Object.assign(new Error('A provisão 92 ainda não foi excluída. Tente concluir.'), { code: 'PROVISION_DESCRIPTION_DELETE_INCOMPLETE' }); },
  }) });
  h.client.getPendingProvisionSnapshot = async () => groupedPendingProvisionSnapshot();
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit('request-pending-provision-deletion', { paymentId: '306' });
  assert.equal(await h.view.emit('confirm-pending-provision-deletion', { paymentId: '306' }), false);
  assert.equal(h.view.renders.at(-1).pendingProvisionDeletion.canConfirm, true);
  assert.match(h.view.renders.at(-1).pendingProvisionDeletion.error, /92/);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 1);
});

test('pending deletion preview cannot reopen after stop or cancellation', async t => {
  let release;
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    listAttachments: async () => [], downloadAttachment: async () => new Blob(),
    previewDeletion: async () => new Promise(resolve => { release = resolve; }),
  }) });
  h.client.getPendingProvisionSnapshot = async () => groupedPendingProvisionSnapshot();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const request = h.view.emit('request-pending-provision-deletion', { paymentId: '306' });
  await new Promise(resolve => setImmediate(resolve));
  await h.view.emit('cancel-pending-provision-deletion');
  release({ id: '306', children: [{ id: '91' }] });
  assert.equal(await request, false);
  assert.equal(h.view.renders.at(-1).pendingProvisionDeletion, null);
});

test('partial deletion with changed source requires a fresh preview, not the invalid retry context', async t => {
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    listAttachments: async () => [], downloadAttachment: async () => new Blob(),
    previewDeletion: async () => ({ id: '306', children: [{ id: '91' }] }),
    deleteDescription: async () => { throw Object.assign(new Error('Os vínculos mudaram. Atualize a confirmação.'),
      { code: 'PROVISION_DESCRIPTION_DELETE_INCOMPLETE', requiresPreview: true, retryable: false }); },
  }) });
  h.client.getPendingProvisionSnapshot = async () => groupedPendingProvisionSnapshot();
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit('request-pending-provision-deletion', { paymentId: '306' });
  await h.view.emit('confirm-pending-provision-deletion', { paymentId: '306' });
  assert.equal(h.view.renders.at(-1).pendingProvisionDeletion.canConfirm, false);
  assert.equal(await h.view.emit('confirm-pending-provision-deletion', { paymentId: '306' }), false);
});

test("grouped provisions retain authoritative totals and metadata without merging colliding child IDs", async t => {
  let childReads = 0;
  const providerKinds = [];
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async ({ sourceKind }) => {
    providerKinds.push(sourceKind);
    return {
      async loadUpcomingPayments() { childReads++; return [{ id: "306", total: 1 }, { id: "91", total: 2 }]; },
      async listAttachments() { return []; }, async downloadAttachment() { return new Blob(); },
    };
  } });
  const snapshot = groupedPendingProvisionSnapshot();
  h.client.getPendingProvisionSnapshot = async () => snapshot;
  t.after(() => h.controller.stop());
  await h.controller.start();
  await new Promise(resolve => setImmediate(resolve));
  const shown = h.view.renders.at(-1).pendingProvisions;
  assert.deepEqual(shown.rows, snapshot.rows);
  assert.equal(shown.checkedDate, "2026-10-11");
  assert.equal(shown.upcomingUnavailable, false);
  assert.equal(shown.totalsUnavailable, false);
  assert.equal(childReads, 0);
  assert.deepEqual(providerKinds, ["provision-description"]);
});

test("grouped provisions switch the cached parent provider back to the legacy child provider on the same account", async t => {
  let grouped = true;
  const providerKinds = [], downloads = [], dates = [];
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async ({ sourceKind }) => {
    const kind = sourceKind || "legacy";
    providerKinds.push(kind);
    return {
      async loadUpcomingPayments() { return []; },
      async listAttachments() { return [{ fileName: "receipt.pdf", mimeType: "application/pdf" }]; },
      async downloadAttachment(id) { downloads.push([kind, id]); return new Blob(["pdf"]); },
      async updateDueDate(id, date) { dates.push([kind, id, date]); },
    };
  } });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-11T15:00:00Z") });
  h.client.getPendingProvisionSnapshot = async () => grouped ? groupedPendingProvisionSnapshot() : { due: true, rows: [{ id: "306" }] };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await new Promise(resolve => setImmediate(resolve));
  await h.view.emit("share-pending-provision-attachment", { paymentId: "306", fileName: "receipt.pdf" });
  await h.view.emit("edit-pending-provision-due-date", { paymentId: "306" });
  assert.equal(await h.view.emit("save-pending-provision-due-date", { paymentId: "306", value: "13/10/2026" }), true);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows[0].dueDate, "2026-10-13");
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows[0].total, "9007199254740993.21");
  await h.view.emit("dismiss-pending-provisions");
  grouped = false;
  await h.view.emit("open-pending-provisions");
  await new Promise(resolve => setImmediate(resolve));
  await h.view.emit("share-pending-provision-attachment", { paymentId: "306", fileName: "receipt.pdf" });
  assert.deepEqual(providerKinds, ["provision-description", "legacy"]);
  assert.deepEqual(downloads, [["provision-description", "306"], ["legacy", "306"]]);
  assert.deepEqual(dates, [["provision-description", "306", "2026-10-13"]]);
});

test("grouped provisions check selects only the namespaced parent and leaves the first child quantity unanswered", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => groupedPendingProvisionSnapshot();
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === "input_continue") return {
      status: "processed", activeFlow: { id: "payment_settlement", stepKey: "provisao_para_baixa" },
      messages: [{ type: "poll", question: "QUAL DESCRITIVO DE PROVISÃO DESEJA BAIXAR?", options: [
        { id: "306", reply: "306", label: "306 - CHILD" },
        { id: "provision_description:306", reply: "provision_description:306", value: "306", label: "306 - COFER" },
      ] }],
    };
    if (payload.replyId === "provision_description:306") return {
      status: "processed", activeFlow: { id: "payment_settlement", stepKey: "qtd_pagamento" },
      messages: [{ type: "poll", question: "DESEJA MANTER A QUANTIDADE DO FILHO 91?", options: [] }],
    };
    throw new Error(`Unexpected or financial reply: ${payload.replyId}`);
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "306" }), true);
  assert.deepEqual(calls, ["input_continue", "provision_description:306"]);
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  assert.match(h.view.renders.at(-1).messages.at(-1).question, /FILHO 91/);
});

test("grouped provisions check accepts the VM transport ID and sends only the canonical parent reply", async t => {
  for (const option of [
    { id: "choice:provisao_para_baixa:provision_description:28", reply: "provision_description:28", label: "28 - ARCELOR MITTAL (19/10/2026) - R$ 8.186,02" },
    { id: "choice:provisao_para_baixa:provision_description:28", label: "28 - ARCELOR MITTAL (19/10/2026) - R$ 8.186,02" },
  ]) {
    const h = makeHarness();
    const calls = [];
    h.client.getPendingProvisionSnapshot = async () => ({
      sourceKind: "provision-description", due: true,
      rows: [{ id: "28", sourceKind: "provision-description", childCount: 4, pendingChildIds: ["342", "343", "344", "345"] }],
    });
    h.client.sendText = async payload => {
      calls.push(payload.replyId);
      if (payload.replyId === "input_continue") return {
        status: "processed", activeFlow: { id: "payment_settlement", stepKey: "provisao_para_baixa" },
        messages: [{ type: "poll", question: "QUAL PAGAMENTO AGENDADO FOI PAGO?", options: [
          { id: "choice:provisao_para_baixa:28", reply: "choice:provisao_para_baixa:28", label: "28 - CHILD" }, option,
        ] }],
      };
      if (payload.replyId === "provision_description:28") return {
        status: "processed", activeFlow: { id: "payment_settlement", stepKey: "qtd_pagamento" },
        messages: [{ type: "poll", question: "DESEJA MANTER A QUANTIDADE DO FILHO 342?", options: [] }],
      };
      throw new Error(`Unexpected or financial reply: ${payload.replyId}`);
    };
    t.after(() => h.controller.stop());
    await h.controller.start();
    assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "28" }), true);
    assert.deepEqual(calls, ["input_continue", "provision_description:28"]);
    assert.equal(h.view.renders.at(-1).error, null);
    assert.match(h.store.getState().messages.at(-1).question, /FILHO 342/);
  }
});

test("grouped provisions never fall back to a bare child ID or a parent value without its namespace", async t => {
  for (const options of [
    [{ id: "306", reply: "306", label: "306 - CHILD" }],
    [{ id: "other", value: "306", label: "306 - COFER" }],
    [{ id: "provision_description:307", value: "306", label: "306 - COFER" }],
    [{ id: "provision_description:306", reply: "306", value: "306", label: "306 - COFER" }],
    [{ id: "choice:provisao_para_baixa:provision_description:307", reply: "provision_description:306", label: "306 - COFER" }],
    [{ id: "choice:another_step:provision_description:306", reply: "provision_description:306", label: "306 - COFER" }],
    [{ id: "choice:provisao_para_baixa:306", reply: "provision_description:306", label: "306 - COFER" }],
    [{ id: "provision_description:306", reply: "provision_description:306" },
      { id: "choice:provisao_para_baixa:provision_description:306", reply: "provision_description:306" }],
  ]) {
    const h = makeHarness();
    const calls = [];
    h.client.getPendingProvisionSnapshot = async () => groupedPendingProvisionSnapshot();
    h.client.sendText = async payload => {
      calls.push(payload.replyId);
      return { status: "processed", activeFlow: { id: "payment_settlement", stepKey: "provisao_para_baixa" },
        messages: [{ type: "poll", question: "QUAL PAGAMENTO AGENDADO FOI PAGO?", options }] };
    };
    t.after(() => h.controller.stop());
    await h.controller.start();
    assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "306" }), false);
    assert.deepEqual(calls, ["input_continue"]);
    assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  }
});

test("legacy provisions check ignores namespaced parent options with a colliding child ID", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306" }] });
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    return payload.replyId === "input_continue"
      ? { status: "processed", activeFlow: { id: "payment_settlement" }, messages: [{ type: "poll", question: "QUAL PAGAMENTO AGENDADO FOI PAGO?", options: [
        { id: "provision_description:306", reply: "provision_description:306", value: "306", label: "306 - PARENT" },
        { id: "306", reply: "306", label: "306 - CHILD" },
      ] }] }
      : { status: "processed", activeFlow: { id: "payment_settlement" }, messages: [{ type: "poll", question: "QUAL A QUANTIDADE?", options: [] }] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "306" }), true);
  assert.deepEqual(calls, ["input_continue", "306"]);
});

test("legacy provisions check cannot select a wrapped parent from its numeric display label", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306" }] });
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    return { status: "processed", activeFlow: { id: "payment_settlement" }, messages: [{ type: "poll",
      question: "QUAL PAGAMENTO AGENDADO FOI PAGO?", options: [
        { id: "choice:provisao_para_baixa:provision_description:306", label: "306 - PARENT" },
      ] }] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "306" }), false);
  assert.deepEqual(calls, ["input_continue"]);
});

test("grouped provisions check closes immediately and abandons an existing draft before selecting the parent", async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const h = makeHarness({ view: createChatView(root) });
  const calls = [];
  let releaseExit;
  const exitGate = new Promise(resolve => { releaseExit = resolve; });
  h.client.getPendingProvisionSnapshot = async () => groupedPendingProvisionSnapshot();
  const poll = (question, options, activeFlow = null, resetConversation = false) => ({
    status: "processed", activeFlow, resetConversation, messages: [{ type: "poll", question, options }],
  });
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    switch (payload.replyId) {
      case "input_continue": return poll("QUAL A OBSERVAÇÃO?", [], { id: "launch" });
      case "portal_confirm_main_menu":
        await exitGate;
        return poll("DESEJA ABANDONAR O FLUXO?", [
          { id: "portal_draft_exit_discard", label: "ABANDONAR SEM SALVAR" },
          { id: "portal_draft_exit_cancel", label: "CONTINUAR" },
        ], { id: "launch" });
      case "portal_draft_exit_discard": return poll("QUAL ÁREA VOCÊ DESEJA ACESSAR?", [{ id: "group_pending", label: "PENDÊNCIAS" }], null, true);
      case "group_pending": return poll("PENDÊNCIAS", [{ id: "pending_payment_settlement", label: "BAIXAR PAGAMENTO AGENDADO" }]);
      case "pending_payment_settlement": return poll("QUAL DESCRITIVO DE PROVISÃO DESEJA BAIXAR?", [
        { id: "306", label: "306 - CHILD" },
        { id: "choice:provisao_para_baixa:provision_description:306", reply: "provision_description:306", value: "306", label: "306 - COFER" },
      ], { id: "payment_settlement", stepKey: "provisao_para_baixa" });
      case "provision_description:306": return poll("QUAL A QUANTIDADE DO FILHO 91?", [], { id: "payment_settlement" });
      default: throw new Error(`Unexpected or financial reply: ${payload.replyId}`);
    }
  };
  t.after(() => { releaseExit(); h.controller.stop(); dom.window.close(); });
  await h.controller.start();
  root.querySelector('[data-action="settle-pending-provision"][data-payment-id="306"]').click();
  assert.equal(root.querySelector("[data-pending-provisions-dialog]"), null);
  releaseExit();
  for (let attempt = 0; attempt < 100 && !/QUANTIDADE DO FILHO 91/.test(root.textContent); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(calls, ["input_continue", "portal_confirm_main_menu", "portal_draft_exit_discard", "group_pending", "pending_payment_settlement", "provision_description:306"]);
  assert.match(root.textContent, /QUANTIDADE DO FILHO 91/);
});

test("grouped provisions preserve the backend refusal to abandon a parent with a committed intent", async t => {
  const h = makeHarness();
  const calls = [];
  const reason = "A baixa do descritivo 99 já foi iniciada. Retome esse grupo antes de abandonar ou editar.";
  h.client.getPendingProvisionSnapshot = async () => groupedPendingProvisionSnapshot();
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === "input_continue") return {
      status: "processed", activeFlow: { id: "payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO", contextId: "committed-parent-99" },
      messages: [{ type: "poll", question: "CONFIRME A BAIXA DO DESCRITIVO 99", options: [] }],
    };
    if (payload.replyId === "portal_confirm_main_menu") throw new Error(reason);
    throw new Error(`Must not select or commit another parent: ${payload.replyId}`);
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "306" }), false);
  assert.deepEqual(calls, ["input_continue", "portal_confirm_main_menu"]);
  assert.equal(h.view.renders.at(-1).error, reason);
  assert.equal(h.store.getState().activeFlow.contextId, "committed-parent-99");
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
});

test("grouped provisions blocked clicks keep all groups open without navigation or selection", async t => {
  const snapshot = groupedPendingProvisionSnapshot();
  const base = snapshot.rows[0];
  snapshot.rows = [
    ...["306", "307", "308"].map(id => ({ ...base, id, total: null, totalDisplay: "—", settlementBlocked: true,
      amountError: `Não foi possível conferir: valor inválido no filho de ${id}.` })),
    ...Array.from({ length: 13 }, (_, index) => ({ ...base, id: String(400 + index) })),
  ];
  const parentReads = [], dates = [];
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async ({ sourceKind }) => {
    assert.equal(sourceKind, "provision-description");
    return {
      async listAttachments(id) { return [{ fileName: "parent.pdf", mimeType: "application/pdf" }]; },
      async downloadAttachment(id) { parentReads.push(id); return new Blob(["pdf"]); },
      async updateDueDate(id, date) { dates.push([id, date]); },
    };
  } });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-11T15:00:00Z") });
  h.client.getPendingProvisionSnapshot = async () => snapshot;
  t.after(() => h.controller.stop());
  await h.controller.start();
  await new Promise(resolve => setImmediate(resolve));
  h.chatCalls.length = 0;
  for (const paymentId of ["306", "307", "308"]) {
    assert.equal(await h.view.emit("settle-pending-provision", { paymentId }), false);
  }
  assert.deepEqual(h.chatCalls, []);
  assert.deepEqual(h.view.renders.at(-1).pendingProvisions.rows, snapshot.rows);
  assert.equal(h.view.renders.at(-1).pendingProvisionSettlementPaymentId, "");
  assert.equal(await h.view.emit("share-pending-provision-attachment", { paymentId: "306", fileName: "parent.pdf" }), true);
  assert.equal(await h.view.emit("edit-pending-provision-due-date", { paymentId: "306" }), true);
  assert.equal(await h.view.emit("save-pending-provision-due-date", { paymentId: "306", value: "13/10/2026" }), true);
  assert.deepEqual(parentReads, ["306"]);
  assert.deepEqual(dates, [["306", "2026-10-13"]]);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 16);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows[0].settlementBlocked, true);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows[0].total, null);
});
const observationOptions = [
  { id: 'choice:tem_observacao_lancamento:1', label: '1 - ✅ SIM' },
  { id: 'choice:tem_observacao_lancamento:2', label: '2 - ❌ NÃO' },
];

async function observationHarness(t, { draft = 'Arame comprado com Marcos arcelor', flow = 'launch', question = observationQuestion } = {}) {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{ type: 'poll', question, options: observationOptions }], { activeFlow: { id: flow, title: 'EFETUAR LANÇAMENTO' } });
  h.store.setDraft(draft);
  h.chatCalls.length = 0;
  return h;
}

test('observação: SIM envia o rascunho em uma única resposta de texto, não a opção SIM', async t => {
  const h = await observationHarness(t);
  await h.view.emit('select-reply', { replyId: observationOptions[0].id, label: observationOptions[0].label });
  assert.deepEqual(h.chatCalls, [['text', { text: 'Arame comprado com Marcos arcelor' }]]);
  assert.equal(h.store.getState().draft, '');
});

test('observação: SIM sem texto mantém a escolha para a VM pedir a observação', async t => {
  for (const draft of ['', '  \n ']) {
    const h = await observationHarness(t, { draft });
    await h.view.emit('select-reply', { replyId: observationOptions[0].id, label: observationOptions[0].label });
    assert.deepEqual(h.chatCalls, [['text', { text: '1 - ✅ SIM', replyId: observationOptions[0].id }]]);
  }
});

test('observação: NÃO, outra pergunta, outro fluxo e opção antiga não consomem o rascunho como observação', async t => {
  for (const scenario of [
    { replyId: observationOptions[1].id, label: observationOptions[1].label },
    { question: 'DESEJA ADICIONAR MAIS LINHAS?' },
    { flow: 'construction_diary_fill' },
    { replyId: 'old-yes', label: 'SIM' },
  ]) {
    const h = await observationHarness(t, scenario);
    const replyId = scenario.replyId || observationOptions[0].id;
    const label = scenario.label || observationOptions[0].label;
    await h.view.emit('select-reply', { replyId, label });
    assert.deepEqual(h.chatCalls, [['text', { text: label, replyId }]]);
  }
});

test('observação: falha de envio conserva o texto para tentar novamente', async t => {
  const h = await observationHarness(t);
  h.client.sendText = async payload => { h.chatCalls.push(['text', payload]); throw new Error('Rede indisponível'); };
  assert.equal(await h.view.emit('select-reply', { replyId: observationOptions[0].id, label: observationOptions[0].label }), false);
  assert.equal(h.store.getState().draft, 'Arame comprado com Marcos arcelor');
  assert.deepEqual(h.chatCalls, [['text', { text: 'Arame comprado com Marcos arcelor' }]]);
});

test('observação: clique no SIM da tela envia o texto atual e preserva os anexos confirmados', async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  const h = makeHarness({ view });
  t.after(() => { h.controller.stop(); dom.window.close(); });
  await h.controller.start();
  const attachments = [{ id: 'receipt', fileName: 'recibo.pdf', mimeType: 'application/pdf', size: 3, mediaUrl: '/api/portal-media/receipt' }];
  h.store.ingestRemoteMessages([{ type: 'poll', question: observationQuestion, options: observationOptions }], {
    activeFlow: { id: 'launch', title: 'EFETUAR LANÇAMENTO' }, attachments,
  });
  const draft = root.querySelector('[data-role="draft"]');
  draft.value = 'Arame comprado com Marcos arcelor\nConferir na obra.';
  draft.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  h.chatCalls.length = 0;
  root.querySelector(`[data-reply-id="${observationOptions[0].id}"]`).click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.chatCalls, [['text', { text: 'Arame comprado com Marcos arcelor\nConferir na obra.' }]]);
  assert.equal(root.querySelector('[data-role="draft"]').value, '');
  assert.equal(h.store.getState().attachments[0].id, 'receipt');
});

test('observação: SIM não contorna upload pendente nem envia duas vezes enquanto ocupado', async t => {
  const blocked = await observationHarness(t);
  blocked.store.queueFiles([new File(['pdf'], 'aguardando.pdf', { type: 'application/pdf' })]);
  assert.equal(await blocked.view.emit('select-reply', { replyId: observationOptions[0].id, label: observationOptions[0].label }), false);
  assert.deepEqual(blocked.chatCalls, []);
  assert.equal(blocked.store.getState().draft, 'Arame comprado com Marcos arcelor');

  const h = await observationHarness(t);
  let release;
  h.client.sendText = async payload => {
    h.chatCalls.push(['text', payload]);
    await new Promise(resolve => { release = resolve; });
    return { status: 'processed', messages: [{ type: 'text', text: 'Confirmado' }] };
  };
  const first = h.view.emit('select-reply', { replyId: observationOptions[0].id, label: observationOptions[0].label });
  assert.equal(await h.view.emit('select-reply', { replyId: observationOptions[0].id, label: observationOptions[0].label }), false);
  release();
  assert.equal(await first, true);
  assert.deepEqual(h.chatCalls, [['text', { text: 'Arame comprado com Marcos arcelor' }]]);
});

test("descritivo provisão abre localmente e reutiliza a galeria sem enviar comandos para a VM", async t => {
  const created = [], opened = [], destroyed = [];
  let sessionGuard;
  const h = makeHarness({
    registrationGalleryDataFactory: async ({ kind,assertSession }) => {
      assert.equal(kind, "provisionDescription");
      assert.equal(typeof assertSession,'function');sessionGuard=assertSession;assertSession();
      return { kind, loadSnapshot: async () => ({ rows: [] }) };
    },
    registrationGalleryFactory: async ({ kind, data, openMediaCollection }) => {
      assert.equal(kind, "provisionDescription");
      assert.equal(data.kind, kind);
      assert.equal(typeof openMediaCollection, "function");
      created.push(kind);
      return { open() { opened.push(kind); }, destroy() { destroyed.push(kind); } };
    },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;
  await h.view.emit("select-reply", { replyId: "action_provision_description_gallery" });
  await h.view.emit("select-reply", { replyId: "action_provision_description_gallery" });
  assert.deepEqual(created, ["provisionDescription"]);
  assert.deepEqual(opened, ["provisionDescription", "provisionDescription"]);
  assert.equal(h.chatCalls.length, before);
  h.controller.stop();
  assert.deepEqual(destroyed, ["provisionDescription"]);
  assert.throws(sessionGuard,/sessão/);
});

test("galeria de presenças conecta o visualizador de anexos sem enviar comando à VM", async t => {
  let opened = 0;
  const h = makeHarness({
    registrationGalleryDataFactory: async ({ kind }) => {
      assert.equal(kind, "presenceDescriptions");
      return { loadSnapshot: async () => ({ rows: [] }) };
    },
    registrationGalleryFactory: async ({ kind, openMediaCollection }) => {
      assert.equal(kind, "presenceDescriptions");
      assert.equal(typeof openMediaCollection, "function");
      return { open() { opened++; }, destroy() {} };
    },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;
  await h.view.emit("select-reply", { replyId: "action_hr_gallery_presencas" });
  assert.equal(opened, 1);
  assert.equal(h.chatCalls.length, before);
});

test('popup keeps partial parent synchronization visible with pending child IDs instead of reporting success',async t=>{
 const message='O descritivo 306 foi salvo, mas a sincronização não foi concluída. Itens pendentes: 92.';
 const h=makeHarness({pendingProvisionAttachmentsDataFactory:async()=>({listAttachments:async()=>[],downloadAttachment:async()=>new Blob(),updateDueDate:async()=>{throw Object.assign(new Error(message),{code:'PROVISION_DESCRIPTION_SYNC_INCOMPLETE'});}})});
 h.client.getPendingProvisionSnapshot=async()=>groupedPendingProvisionSnapshot();t.after(()=>h.controller.stop());await h.controller.start();
 await h.view.emit('edit-pending-provision-due-date',{paymentId:'306'});
 assert.equal(await h.view.emit('save-pending-provision-due-date',{paymentId:'306',value:'25/09/2099'}),false);
 assert.equal(h.view.renders.at(-1).pendingProvisionDateEditError,message);
 assert.equal(h.view.renders.at(-1).pendingProvisionDateEditPaymentId,'306');
});

test("relatório RHID consulta a data escolhida e coloca os registros no chat", async t => {
  const h = makeHarness();
  const requested = [];
  h.client.getRhidAttendanceReport = async selectedDate => {
    requested.push(selectedDate);
    return {
      date: selectedDate,
      rows: [{
        Id: 81,
        ID_PESSOA_RHID: "rh-9",
        DATA_REFERENCIA: selectedDate,
        NOME_COLABORADOR: "Pessoa A",
        BATIDAS_RHID: "07:01; 12:00; 13:00; 17:02",
        MINUTOS_TRABALHADOS: 541,
        STATUS_RHID: "MARCAÇÃO RECEBIDA",
        COLETADO_EM: "2026-09-25T20:12:00Z",
      }],
    };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-25" });

  assert.deepEqual(requested, ["2026-09-25"]);
  const report = h.store.getState().messages.at(-1);
  assert.match(report.question, /25\/09\/2026/);
  assert.equal(report.detail_table.kind, "rhid_attendance");
  assert.equal(report.detail_table.title, "📋 PRESENÇAS");
  assert.deepEqual(report.detail_table.headers, ["Nome", "Entrada 1", "Saída 1", "Entrada 2", "Saída 2", "Total de horas/dia"]);
  assert.deepEqual(report.detail_table.rows, [["Pessoa A", "07:01", "12:00", "13:00", "17:02", "09:01"]]);
  assert.equal(report.detail_table.updateLabel, "ÚLTIMA COLETA DO RHID ÀS 17:12");
});

test("calendário RHID atual gera e abre o relatório da data tocada, sem voltar ao menu escuro", async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const originalView = createChatView(root);
  let calendarClosedBeforeReportRender = false;
  const view = {
    ...originalView,
    closeRhidAttendanceReport(options) {
      if (options?.render === false) calendarClosedBeforeReportRender = true;
      return originalView.closeRhidAttendanceReport(options);
    },
    render(state) {
      if (state.messages.some(message => message?.detail_table?.kind === "rhid_attendance"))
        assert.equal(calendarClosedBeforeReportRender, true, "fechar o calendário antes de renderizar o relatório evita a camada antiga no iOS");
      return originalView.render(state);
    },
  };
  const h = makeHarness({ view });
  const requested = [];
  h.client.getRhidAttendanceMonth = async () => ({ presentDates: [] });
  h.client.getRhidAttendanceReport = async date => {
    requested.push(date);
    return { date, rows: [{ ID_PESSOA_RHID: "9", NOME_COLABORADOR: "ANA", BATIDAS_RHID: "07:00; 12:00; 13:00; 17:00" }] };
  };
  t.after(() => { h.controller.stop(); h.view.destroy(); dom.window.close(); });
  await h.controller.start();
  h.store.ingestRemoteMessages([{ id: "hr-menu", type: "poll", question: "👥 RECURSOS HUMANOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?", options: [
    { id: "attendance", reply: "action_validate_attendance", label: "VALIDAR PRESENÇAS" },
    { id: "rhid", reply: "action_rhid_attendance_report", label: "RELATÓRIO DE PRESENÇAS RHID" },
  ] }], { activeFlow: { id: "human_resources", title: "👥 RECURSOS HUMANOS" }, resetConversation: false });

  root.querySelector('[data-action="open-rhid-attendance-report"]').click();
  const month = root.querySelector('[data-role="rhid-calendar-day"]').dataset.value.slice(0, 7);
  const selected = `${month}-15`;
  root.querySelector(`[data-role="rhid-calendar-day"][data-value="${selected}"]`).click();
  root.querySelector('[data-action="generate-rhid-attendance-report"]').click();
  assert.equal(root.querySelector('.chat-confirmation-backdrop'), null);
  assert.match(root.querySelector('.chat-transcript')?.textContent || "", /Consultando relatório RHID/);

  for (let attempt = 0; attempt < 20 && !root.querySelector('.chat-rhid-attendance-report'); attempt += 1)
    await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(requested, [selected]);
  assert.ok(root.querySelector('.chat-rhid-attendance-report'), "o relatório substitui o calendário e o menu RH");
  assert.equal(root.querySelector('.chat-confirmation-backdrop'), null);
  assert.doesNotMatch(root.querySelector('.chat-transcript')?.textContent || "", /QUAL FLUXO VOCÊ DESEJA INICIAR/i);
});

test("HORÁRIO abre RHID do dia em validação sem PDF e permite voltar à lista", async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  const h = makeHarness({ view });
  const requested = [], previews = [];
  h.client.getRhidAttendanceReport = async date => {
    requested.push(date);
    return { date, pendingValidationCount: 1, rows: [{ ID_PESSOA_RHID: '9', NOME_COLABORADOR: 'ANA', BATIDAS_RHID: '07:00; 12:00; 13:00; 17:00' }] };
  };
  h.native.previewMedia = async () => previews.push(true);
  t.after(() => { h.controller.stop(); view.destroy(); dom.window.close(); });
  await h.controller.start();
  h.store.ingestRemoteMessages([{ id: 'validation-day', type: 'poll', presentation: 'attendance_multi_select',
    question: 'QUAL PRESENÇA DESEJA VALIDAR?', options: [
      { id: 'choice:registro_presenca_pendente:21', label: '21 - ANA', date: '2026-09-25' },
    ] }], { activeFlow: { id: 'attendance_validation', title: 'VALIDAR PRESENÇAS' }, resetConversation: true });
  // Badge enrichment may also read RHID; only count reads made by this shortcut.
  await new Promise(resolve => setImmediate(resolve));
  requested.length = 0;
  root.querySelector('[data-action="attendance-select-toggle"]').click();
  const button = root.querySelector('[data-action="attendance-validation-hours"]');
  assert.ok(button, 'atalho no cabeçalho da pergunta');
  button.click();
  for (let attempt = 0; attempt < 30 && !root.querySelector('.chat-rhid-attendance-report'); attempt++)
    await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requested, ['2026-09-25']);
  assert.equal(h.store.getState().messages.at(-1).detail_table.reportDate, '2026-09-25');
  assert.ok(root.querySelector('.chat-rhid-attendance-report'));
  assert.deepEqual(previews, []);
  root.querySelector('[data-action="rhid-day-validation-open"]').click();
  for (let attempt = 0; attempt < 30 && !root.querySelector('[data-action="attendance-validation-hours"]'); attempt++)
    await new Promise(resolve => setImmediate(resolve));
  assert.ok(root.querySelector('[data-action="attendance-validation-hours"]'));
  assert.equal(root.querySelector('[data-action="attendance-select-toggle"]').checked, true);
  assert.match(root.querySelector('.chat-choice-card > p').textContent, /25\/09\/2026/);
});

test("HORÁRIO rejeita mensagem antiga, dia ambíguo e comandos com data adulterada", async t => {
  const h = makeHarness();
  const requested = [];
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{ id: 'current', type: 'poll', presentation: 'attendance_multi_select',
    question: 'QUAL PRESENÇA?', options: [{ id: 'pending_attendance_record:1', date: '2026-09-25' }] }],
    { activeFlow: { id: 'attendance_validation' }, resetConversation: true });
  h.client.getRhidAttendanceReport = async date => { requested.push(date); return { date, rows: [] }; };
  assert.equal(await h.view.emit('attendance-validation-hours', { messageId: 'old', value: '2026-10-13' }), false);
  assert.deepEqual(requested, []);
  await h.view.emit('attendance-validation-hours', { messageId: 'current', value: '2026-10-13' });
  assert.deepEqual(requested, ['2026-09-25'], 'date comes from current records, never command or clock');
  h.store.ingestRemoteMessages([{ id: 'mixed', type: 'poll', presentation: 'attendance_multi_select',
    question: 'QUAL PRESENÇA?', options: [{ id: 'pending_attendance_record:1', date: '2026-09-25' },
      { id: 'pending_attendance_record:2', date: '2026-09-26' }] }], { resetConversation: true });
  await new Promise(resolve => setImmediate(resolve));
  requested.length = 0;
  assert.equal(await h.view.emit('attendance-validation-hours', { messageId: 'mixed' }), false);
  assert.deepEqual(requested, [], 'rejected shortcut adds no request beyond badge enrichment');
});

test("consulta RHID sem resposta termina a espera e informa o erro", async t => {
  const h = makeHarness({ rhidReportTimeoutMs: 15 });
  const statuses = [];
  h.view.setRhidAttendanceReportStatus = status => statuses.push(status);
  h.client.getRhidAttendanceReport = () => new Promise(() => {});
  t.after(() => h.controller.stop());
  await h.controller.start();

  const result = await Promise.race([
    h.view.emit("rhid-attendance-report-generate", { value: "2026-10-01" }),
    new Promise(resolve => setTimeout(() => resolve("still-pending"), 120)),
  ]);

  assert.equal(result, false);
  assert.equal(statuses.at(-1)?.busy, false);
  assert.match(statuses.at(-1)?.error || "", /demorou demais/i);
  assert.equal(h.store.getState().messages.some(message => message?.detail_table?.kind === "rhid_attendance"), false);
});

test("botão de presença abre diretamente o fluxo do ID pendente da pessoa e data exibidas", async t => {
  const h = makeHarness();
  h.client.getRhidAttendanceReport = async date => ({ date, rows: [
    { ID_PESSOA_RHID: "9", NOME_COLABORADOR: "ANA", BATIDAS_RHID: "2026-09-25 07:00", pendingPresenceIds: ["21"] },
  ] });
  const requests = [];
  h.client.startRhidPendingValidation = async payload => {
    requests.push(payload);
    return { status: "processed", messages: [{ type: "poll", question: "VALIDAR ANA?", options: [] }], activeFlow: { id: "attendance_validation", title: "VALIDAR PRESENÇAS" }, attachments: [] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-25" });
  const report = h.store.getState().messages.at(-1);
  const result = await h.view.emit("rhid-presence-validate-open", {
    messageId: report.id, personKey: "rhid:9", value: "21",
  });
  assert.equal(result, true);
  assert.deepEqual(requests, [{ date: "2026-09-25", personKey: "rhid:9", presenceId: "21" }]);
  assert.equal(h.store.getState().messages.at(-1).question, "VALIDAR ANA?");
  assert.equal(h.store.getState().activeFlow?.id, "attendance_validation");
});

test("botão geral do relatório abre a lista completa de validação da data selecionada", async t => {
  const h = makeHarness();
  const historicalDay = "2026-09-25";
  h.client.getRhidAttendanceReport = async date => ({ date, pendingValidationCount: 2, rows: [
    { ID_PESSOA_RHID: "9", NOME_COLABORADOR: "ANA", BATIDAS_RHID: "07:00" },
  ] });
  const dates = [];
  h.client.startRhidDayValidation = async date => {
    dates.push(date);
    return { status: "processed", messages: [{ type: "poll", question: "QUAL PRESENÇA?", options: [
      { id: "pending_attendance_record:1", title: "1 - ANA" },
      { id: "pending_attendance_record:2", title: "2 - BIA" },
    ] }], activeFlow: { id: "attendance_validation", title: "VALIDAR PRESENÇAS" }, attachments: [] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("rhid-attendance-report-generate", { value: historicalDay });
  const report = h.store.getState().messages.at(-1);
  assert.equal(report.detail_table.pendingValidationCount, 2);
  assert.equal(await h.view.emit("rhid-day-validation-open", { messageId: report.id }), true);
  assert.deepEqual(dates, [historicalDay]);
  assert.equal(h.store.getState().messages.at(-1).options.length, 2);
  assert.equal(h.store.getState().activeFlow.id, "attendance_validation");
});

test("ajuste RHID salva justificativa e atualiza somente o relatório selecionado", async t => {
  const h = makeHarness();
  const rows = [{ ID_PESSOA_RHID: "23", NOME_COLABORADOR: "EDGAR", BATIDAS_RHID: "07:01; 11:59; 13:00; 17:03" }];
  let reportCalls = 0;
  h.client.getRhidAttendanceReport = async date => {
    reportCalls += 1;
    return { date, rows: rows.map(row => ({ ...row, ...(reportCalls > 1 ? { ADMIN_AJUSTES: {
      exit2: { time: "17:00", reason: "Conferência", actorName: "Bernardo" },
    } } : {}) })) };
  };
  const saves = [];
  h.client.saveRhidAttendanceAdjustment = async payload => { saves.push(payload); return { id: 1 }; };
  let closed = 0;
  h.view.closeRhidAttendanceAdjustment = () => { closed += 1; };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-25" });
  const message = h.store.getState().messages.at(-1);
  const result = await h.view.emit("rhid-attendance-adjust-save", {
    messageId: message.id, personKey: "rhid:23", slot: "exit2", time: "17:00", reason: "Conferência",
  });
  assert.equal(result, true);
  assert.deepEqual(saves, [{ date: "2026-09-25", personKey: "rhid:23", slot: "exit2", time: "17:00", reason: "Conferência" }]);
  assert.equal(reportCalls, 2);
  assert.equal(closed, 1);
  const current = h.store.getState().messages.at(-1);
  assert.equal(current.id, message.id);
  assert.equal(current.detail_table.people[0].slots.exit2.rhid, "17:03");
  assert.equal(current.detail_table.people[0].slots.exit2.effective, "17:00");
});

test('own manual RHID deletion refreshes the same report and retains original punches', async t => {
  const h = makeHarness({ account: { homeAccountId: 'a1', name: 'Bernardo', username: 'bernardo@example.test' } });
  const adjustment = { id: 47, time: '12:00', actorEmail: 'bernardo@example.test' };
  let removed = false;
  h.client.getRhidAttendanceReport = async date => ({ date, rows: [{ Id: 10, ID_PESSOA_RHID: '23', NOME_COLABORADOR: 'EDGAR',
    BATIDAS_RHID: '06:55;13:00;17:06', ...(removed ? {} : { ADMIN_AJUSTES: { exit1: adjustment } }) }] });
  const deletions = [];
  h.client.deleteRhidAttendanceAdjustment = async payload => { deletions.push(payload); removed = true; return { deleted: true, revisionId: '47' }; };
  let closed = 0; h.view.closeRhidAttendanceAdjustment = () => closed++;
  t.after(() => h.controller.stop()); await h.controller.start();
  await h.view.emit('rhid-attendance-report-generate', { value: '2020-10-15' });
  const id = h.store.getState().messages.at(-1).id;
  assert.equal(await h.view.emit('rhid-attendance-adjust-delete', { messageId: id, personKey: 'rhid:23', slot: 'exit1', revisionId: '47' }), true);
  assert.deepEqual(deletions, [{ date: '2020-10-15', personKey: 'rhid:23', slot: 'exit1', revisionId: '47' }]);
  const current = h.store.getState().messages.at(-1);
  assert.equal(current.id, id);
  assert.equal(current.detail_table.people[0].slots.exit1.effective, null);
  assert.equal(current.detail_table.people[0].slots.entry1.rhid, '06:55');
  assert.equal(closed, 1);
});
test('forged, stale or non-owned manual RHID deletion cannot reach the client', async t => {
  const h = makeHarness({ account: { homeAccountId: 'a1', username: 'bernardo@example.test' } });
  h.client.getRhidAttendanceReport = async date => ({ date, rows: [{ Id: 10, ID_PESSOA_RHID: '23', BATIDAS_RHID: '06:55',
    ADMIN_AJUSTES: { exit1: { id: 47, time: '12:00', actorEmail: 'other@example.test' } } }] });
  const calls = []; h.client.deleteRhidAttendanceAdjustment = async p => calls.push(p);
  t.after(() => h.controller.stop()); await h.controller.start();
  await h.view.emit('rhid-attendance-report-generate', { value: '2020-10-15' });
  const id = h.store.getState().messages.at(-1).id;
  for (const slot of ['exit1', 'entry2']) assert.equal(await h.view.emit('rhid-attendance-adjust-delete',
    { messageId: id, personKey: 'rhid:23', slot, revisionId: '47' }), false);
  assert.equal(calls.length, 0);
});

test('confirmed deletion with failed refresh cannot export stale hours and can retry the same day', async t => {
  const h = makeHarness({ account: { homeAccountId: 'a1', username: 'bernardo@example.test' } });
  let removed = false, failRefresh = true;
  const adjustment = { id: 47, time: '12:00', actorEmail: 'bernardo@example.test' };
  h.client.getRhidAttendanceReport = async date => {
    if (removed && failRefresh) throw new Error('offline');
    return { date, rows: [{ Id: 10, ID_PESSOA_RHID: '23', NOME_COLABORADOR: 'EDGAR', BATIDAS_RHID: '06:55;13:00;17:06',
      ...(removed ? {} : { ADMIN_AJUSTES: { exit1: adjustment } }) }] };
  };
  h.client.deleteRhidAttendanceAdjustment = async () => { removed = true; return { deleted: true, revisionId: '47' }; };
  let exports = 0; h.native.exportMedia = async () => { exports++; };
  t.after(() => h.controller.stop()); await h.controller.start();
  await h.view.emit('rhid-attendance-report-generate', { value: '2020-10-15' });
  const id = h.store.getState().messages.at(-1).id;
  assert.equal(await h.view.emit('rhid-attendance-adjust-delete', { messageId: id, personKey: 'rhid:23', slot: 'exit1', revisionId: '47' }), true);
  assert.equal(await h.view.emit('share-rhid-attendance-report', { messageId: id }), false);
  assert.equal(exports, 0);
  assert.deepEqual(h.store.getState().messages.at(-1).detail_table.rows, []);
  failRefresh = false;
  assert.equal(await h.view.emit('rhid-attendance-report-navigate', { messageId: id, value: 'reload' }), true);
  const fresh = h.store.getState().messages.at(-1);
  assert.equal(fresh.id, id);
  assert.equal(fresh.detail_table.reportDate, '2020-10-15');
  assert.equal(fresh.detail_table.people[0].slots.exit1.effective, null);
  assert.equal(await h.view.emit('share-rhid-attendance-report', { messageId: id }), true);
  assert.equal(exports, 1);
});

test("seta de retorno no relatório RHID restaura a tela anterior sem voltar ao menu principal", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  const previousScreen = {
    id: "hr-menu",
    role: "assistant",
    type: "poll",
    question: "👥 RECURSOS HUMANOS — QUAL FLUXO VOCÊ DESEJA INICIAR?",
    options: [{ id: "rhid-report", reply: "rhid-report", label: "RELATÓRIO DE PRESENÇAS RHID" }],
  };
  const requested = [];
  h.client.getRhidAttendanceReport = async date => {
    requested.push(date);
    return { date, rows: [] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([previousScreen]);
  assert.equal(h.store.getState().messages.at(-1)?.question, previousScreen.question, "a tela RH deve estar ativa antes da consulta");

  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-28" });
  const initialReport = h.store.getState().messages.at(-1);
  assert.equal(initialReport?.detail_table?.kind, "rhid_attendance");
  await h.view.emit("rhid-attendance-report-navigate", { messageId: initialReport.id, value: "-1" });
  assert.equal(h.store.getState().messages.at(-1)?.detail_table?.reportDate, "2026-09-27");
  const callsBeforeReturn = h.chatCalls.length;

  await h.view.emit("select-reply", { replyId: "navigation_back", label: "↩️ RETORNAR À PERGUNTA ANTERIOR" });

  assert.equal(h.chatCalls.length, callsBeforeReturn, "o retorno local não deve enviar navigation_back ao servidor");
  assert.equal(h.store.getState().messages.length, 1);
  assert.equal(h.store.getState().messages[0].question, previousScreen.question);
  assert.deepEqual(requested, ["2026-09-28", "2026-09-27"]);
});

test("resposta tardia do RHID não substitui uma tela aberta durante a consulta", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  let closedReportDialog = 0;
  h.view.closeRhidAttendanceReport = () => { closedReportDialog += 1; };
  let beginRequest;
  let resolveReport;
  const requestStarted = new Promise(resolve => { beginRequest = resolve; });
  const reportResponse = new Promise(resolve => { resolveReport = resolve; });
  h.client.getRhidAttendanceReport = () => {
    beginRequest();
    return reportResponse;
  };
  h.client.sendText = async () => ({
    status: "processed",
    messages: [{ type: "poll", question: "📦 OUTRA TELA", options: [] }],
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    id: "hr-menu", role: "assistant", type: "poll",
    question: "👥 RECURSOS HUMANOS — QUAL FLUXO VOCÊ DESEJA INICIAR?", options: [],
  }]);

  const reportRequest = h.view.emit("rhid-attendance-report-generate", { value: "2026-09-28" });
  await requestStarted;
  await h.view.emit("select-reply", { replyId: "next-screen", label: "Abrir outra tela" });
  assert.equal(h.store.getState().messages.at(-1)?.question, "📦 OUTRA TELA");

  resolveReport({ date: "2026-09-28", rows: [] });
  await reportRequest;

  assert.equal(h.store.getState().messages.at(-1)?.question, "📦 OUTRA TELA");
  assert.equal(h.store.getState().messages.some(message => message?.detail_table?.kind === "rhid_attendance"), false);
  assert.equal(closedReportDialog, 1, "a consulta descartada não deixa a janela RHID presa em estado ocupado");
});

test("resposta tardia do RHID não restaura anexo removido enquanto carregava", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  let beginRequest;
  let resolveReport;
  const requestStarted = new Promise(resolve => { beginRequest = resolve; });
  const reportResponse = new Promise(resolve => { resolveReport = resolve; });
  h.client.getRhidAttendanceReport = () => {
    beginRequest();
    return reportResponse;
  };
  h.client.deleteAttachment = async () => ({ status: "processed", messages: [], attachments: [] });
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    id: "hr-menu", role: "assistant", type: "poll",
    question: "👥 RECURSOS HUMANOS — QUAL FLUXO VOCÊ DESEJA INICIAR?", options: [],
  }]);
  h.store.syncAttachments([{
    id: "remove-me", fileName: "remover.pdf", mediaUrl: "/api/portal-media/remove-me",
  }]);

  const reportRequest = h.view.emit("rhid-attendance-report-generate", { value: "2026-09-28" });
  await requestStarted;
  await h.view.emit("remove-attachment", { fileId: "remove-me" });
  assert.deepEqual(h.store.getState().attachments, []);

  resolveReport({ date: "2026-09-28", rows: [] });
  await reportRequest;

  assert.equal(h.store.getState().messages.some(message => message?.detail_table?.kind === "rhid_attendance"), false);
  assert.deepEqual(h.store.getState().attachments, []);
});

test("prévia carregada em segundo plano não cancela nem perde a origem do relatório RHID", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  let beginRequest;
  let resolveReport;
  const requestStarted = new Promise(resolve => { beginRequest = resolve; });
  const reportResponse = new Promise(resolve => { resolveReport = resolve; });
  h.client.getRhidAttendanceReport = () => {
    beginRequest();
    return reportResponse;
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    id: "hr-menu", role: "assistant", type: "poll",
    question: "👥 RECURSOS HUMANOS — QUAL FLUXO VOCÊ DESEJA INICIAR?", options: [],
  }]);
  h.store.syncAttachments([{
    id: "file-preview", fileName: "relatorio.pdf", mediaUrl: "/api/portal-media/file-preview",
  }]);

  const reportRequest = h.view.emit("rhid-attendance-report-generate", { value: "2026-09-28" });
  await requestStarted;
  h.store.setMessagePreview("hr-menu", "blob:hr-menu-preview");
  h.store.setAttachmentPreview("file-preview", "blob:file-preview");
  resolveReport({ date: "2026-09-28", rows: [] });
  await reportRequest;

  const report = h.store.getState().messages.at(-1);
  assert.equal(report?.detail_table?.kind, "rhid_attendance");
  await h.view.emit("select-reply", { replyId: "navigation_back", label: "↩️ RETORNAR À PERGUNTA ANTERIOR" });
  assert.equal(h.store.getState().messages[0].previewUrl, "blob:hr-menu-preview");
  assert.equal(h.store.getState().attachments[0].previewUrl, "blob:file-preview");
});

test("setas do relatório consultam o dia adjacente e substituem o relatório no mesmo cartão", async t => {
  const h = makeHarness();
  const requested = [];
  h.client.getRhidAttendanceReport = async selectedDate => {
    requested.push(selectedDate);
    return { date: selectedDate, rows: selectedDate === "2026-09-26" ? [] : [{
      ID_PESSOA_RHID: "rh-9", DATA_REFERENCIA: selectedDate, NOME_COLABORADOR: "Pessoa A",
      BATIDAS_RHID: "07:01; 12:00; 13:00; 17:02",
    }] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-26" });
  const original = h.store.getState().messages.at(-1);
  assert.deepEqual(original.detail_table.rows, [], "o relatório vazio também precisa manter a navegação");
  await h.view.emit("rhid-attendance-report-navigate", { messageId: original.id, value: "-1" });
  assert.equal(h.store.getState().messages.at(-1).detail_table.reportDate, "2026-09-25");
  await h.view.emit("rhid-attendance-report-navigate", { messageId: original.id, value: "1" });

  assert.deepEqual(requested, ["2026-09-26", "2026-09-25", "2026-09-26"]);
  const reportMessages = h.store.getState().messages.filter(message => message.detail_table?.kind === "rhid_attendance");
  assert.equal(reportMessages.length, 1);
  assert.equal(reportMessages[0].id, original.id);
  assert.equal(reportMessages[0].detail_table.reportDate, "2026-09-26");
});

test("seletor de calendário RHID atualiza a data escolhida no mesmo cartão do relatório", async t => {
  const h = makeHarness();
  const requested = [];
  h.client.getRhidAttendanceReport = async selectedDate => {
    requested.push(selectedDate);
    return { date: selectedDate, rows: [{
      ID_PESSOA_RHID: "rh-9", DATA_REFERENCIA: selectedDate, NOME_COLABORADOR: "Pessoa A",
      BATIDAS_RHID: selectedDate === "2026-09-25" ? "07:01; 12:00; 13:00; 17:02" : "08:00; 12:00; 13:00; 18:00",
    }] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-25" });
  const original = h.store.getState().messages.at(-1);
  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-26", messageId: original.id });

  const reports = h.store.getState().messages.filter(message => message.detail_table?.kind === "rhid_attendance");
  assert.deepEqual(requested, ["2026-09-25", "2026-09-26"]);
  assert.equal(reports.length, 1, "trocar a data deve atualizar o relatório exposto, sem criar outro cartão");
  assert.equal(reports[0].id, original.id);
  assert.equal(reports[0].detail_table.reportDate, "2026-09-26");
  assert.deepEqual(reports[0].detail_table.rows[0], ["Pessoa A", "08:00", "12:00", "13:00", "18:00", "09:00"]);
});

test("calendário RHID carrega o resumo mensal e informa falha sem inventar ausências", async t => {
  const h = makeHarness();
  const statuses = [];
  h.view.setRhidAttendanceMonthStatus = value => statuses.push(value);
  h.client.getRhidAttendanceMonth = async month => {
    if (month === "2026-10") throw new Error("Rede indisponível");
    return { month, presentDates: ["2026-09-28"] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("rhid-attendance-month-load", { value: "2026-09" });
  await h.view.emit("rhid-attendance-month-load", { value: "2026-10" });
  assert.deepEqual(statuses[0], { month: "2026-09", presentDates: ["2026-09-28"] });
  assert.match(statuses[1].error, /não foi possível consultar/i);
});

test("calendário RHID conta horários efetivos do snapshot mensal após correções", async t => {
  const h = makeHarness();
  const statuses = [];
  h.view.setRhidAttendanceMonthStatus = value => statuses.push(value);
  h.client.getRhidAttendanceMonth = async month => ({ month, presentDates: ["2026-09-28"], rows: [
    { ID_PESSOA_RHID: "1", NOME_COLABORADOR: "Teste", DATA_REFERENCIA: "2026-09-28", BATIDAS_RHID: "07:00; 12:00" },
    { ID_PESSOA_RHID: "2", NOME_COLABORADOR: "Corrigido", DATA_REFERENCIA: "2026-09-28", BATIDAS_RHID: "12:00; 13:00; 17:00", ADMIN_AJUSTES: { entry1: { time: "07:00" } } },
  ] });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("rhid-attendance-month-load", { value: "2026-09" });
  assert.deepEqual(statuses[0].irregularCounts, { "2026-09-28": 1 });
});

for (const staleError of [false, true]) {
  test(`calendário RHID rejeita ${staleError ? "erro" : "sucesso"} antigo após A-B-A ou reabrir A`, async t => {
    const h = makeHarness();
    const statuses = [], requests = [];
    h.view.setRhidAttendanceMonthStatus = value => statuses.push(value);
    h.client.getRhidAttendanceMonth = month => new Promise((resolve, reject) => requests.push({ month, resolve, reject }));
    t.after(() => h.controller.stop());
    await h.controller.start();
    const old = h.view.emit("rhid-attendance-month-load", { value: "2026-09" });
    const middle = h.view.emit("rhid-attendance-month-load", { value: "2026-10" });
    const latest = h.view.emit("rhid-attendance-month-load", { value: "2026-09" });
    requests[2].resolve({ month: "2026-09", presentDates: [], rows: [] });
    await latest;
    if (staleError) requests[0].reject(new Error("Old offline response"));
    else requests[0].resolve({ month: "2026-09", presentDates: ["2026-09-28"], rows: [{ ID_PESSOA_RHID: "1", NOME_COLABORADOR: "Teste", DATA_REFERENCIA: "2026-09-28", BATIDAS_RHID: "07:00" }] });
    requests[1].resolve({ month: "2026-10", presentDates: [] });
    await Promise.all([old, middle]);
    assert.deepEqual(statuses, [{ month: "2026-09", presentDates: [], irregularCounts: {} }]);
    const closedRequest = h.view.emit("rhid-attendance-month-load", { value: "2026-09" });
    const reopenedRequest = h.view.emit("rhid-attendance-month-load", { value: "2026-09" });
    requests[4].resolve({ month: "2026-09", presentDates: [], rows: [] });
    await reopenedRequest;
    requests[3].reject(new Error("Request before reopening"));
    await closedRequest;
    assert.equal(statuses.length, 2);
    assert.deepEqual(statuses[1].irregularCounts, {});
  });
}

test("falha ao trocar data pelo calendário libera o popup e preserva o relatório atual", async t => {
  const h = makeHarness();
  const statuses = [];
  let requestCount = 0;
  h.view.setRhidAttendanceReportStatus = status => statuses.push(status);
  h.client.getRhidAttendanceReport = async selectedDate => {
    requestCount += 1;
    if (requestCount > 1) throw new Error("Falha de conexão");
    return { date: selectedDate, rows: [{
      ID_PESSOA_RHID: "rh-9", NOME_COLABORADOR: "Pessoa A", BATIDAS_RHID: "07:01; 12:00; 13:00; 17:02",
    }] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-25" });
  const original = h.store.getState().messages.at(-1);

  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-26", messageId: original.id });

  assert.deepEqual(statuses.at(-1), {
    busy: false,
    error: "Não foi possível atualizar o relatório. Tente novamente.",
  });
  const current = h.store.getState().messages.at(-1);
  assert.equal(current.id, original.id);
  assert.equal(current.detail_table.reportDate, "2026-09-25");
  assert.equal(current.detail_table.rows.length, 1);
});

test("setas RHID ficam bloqueadas durante a consulta e liberam após atualizar o cartão", async t => {
  const h = makeHarness();
  const requested = [];
  let resolveAdjacent;
  h.client.getRhidAttendanceReport = async selectedDate => {
    requested.push(selectedDate);
    if (selectedDate === "2026-09-25") return { date: selectedDate, rows: [{
      ID_PESSOA_RHID: "rh-9", NOME_COLABORADOR: "Pessoa A", BATIDAS_RHID: "07:01; 12:00; 13:00; 17:02",
    }] };
    return new Promise(resolve => { resolveAdjacent = resolve; });
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-25" });
  const report = h.store.getState().messages.at(-1);

  const pending = h.view.emit("rhid-attendance-report-navigate", { messageId: report.id, value: "-1" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.store.getState().messages.at(-1).detail_table.navigationBusy, true);
  assert.equal(h.view.emit("rhid-attendance-report-navigate", { messageId: report.id, value: "-1" }), false);
  assert.deepEqual(requested, ["2026-09-25", "2026-09-24"]);

  resolveAdjacent({ date: "2026-09-24", rows: [] });
  await pending;
  assert.notEqual(h.store.getState().messages.at(-1).detail_table.navigationBusy, true);
});

test("cartões RHID diferentes podem consultar seus próximos dias em paralelo", async t => {
  const h = makeHarness();
  const requested = [];
  const callsByDate = new Map();
  const pending = new Map();
  h.client.getRhidAttendanceReport = async selectedDate => {
    requested.push(selectedDate);
    const calls = callsByDate.get(selectedDate) || 0;
    callsByDate.set(selectedDate, calls + 1);
    if (calls === 0 && ["2026-09-25", "2026-09-26"].includes(selectedDate)) {
      return { date: selectedDate, rows: [{
        ID_PESSOA_RHID: "rh-9", NOME_COLABORADOR: "Pessoa A", BATIDAS_RHID: "07:01; 12:00; 13:00; 17:02",
      }] };
    }
    return new Promise(resolve => pending.set(selectedDate, resolve));
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-25" });
  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-26" });
  const [first, second] = h.store.getState().messages.filter(message => message.detail_table?.kind === "rhid_attendance");

  const firstNavigation = h.view.emit("rhid-attendance-report-navigate", { messageId: first.id, value: "-1" });
  await new Promise(resolve => setImmediate(resolve));
  const secondNavigation = h.view.emit("rhid-attendance-report-navigate", { messageId: second.id, value: "-1" });
  await new Promise(resolve => setImmediate(resolve));
  const requestedWhilePending = [...requested];
  for (const [date, resolve] of pending) resolve({ date, rows: [] });
  await Promise.all([firstNavigation, secondNavigation]);

  assert.deepEqual(requestedWhilePending, ["2026-09-25", "2026-09-26", "2026-09-24", "2026-09-25"]);
  const reports = h.store.getState().messages.filter(message => message.detail_table?.kind === "rhid_attendance");
  assert.deepEqual(reports.map(message => message.detail_table.reportDate), ["2026-09-24", "2026-09-25"]);
  assert.deepEqual(reports.map(message => message.id), [first.id, second.id]);
});

test("falha ao consultar outro dia aparece no cartão sem perder os dados anteriores", async t => {
  const h = makeHarness();
  let call = 0;
  h.client.getRhidAttendanceReport = async selectedDate => {
    call += 1;
    if (call > 1) throw new Error("Falha de conexão com o RHID");
    return { date: selectedDate, rows: [{
      ID_PESSOA_RHID: "rh-9", NOME_COLABORADOR: "Pessoa A", BATIDAS_RHID: "07:01; 12:00; 13:00; 17:02",
    }] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-25" });
  const report = h.store.getState().messages.at(-1);

  await h.view.emit("rhid-attendance-report-navigate", { messageId: report.id, value: "-1" });

  const current = h.store.getState().messages.at(-1);
  assert.equal(current.detail_table.reportDate, "2026-09-25");
  assert.equal(current.detail_table.navigationBusy, false);
  assert.match(current.detail_table.navigationError, /não foi possível atualizar/i);
  assert.equal(current.detail_table.rows.length, 1);
});

test("atalho RHID consulta hoje e abre apenas a tela de presenças, sem PDF automático", async t => {
  const h = makeHarness();
  const requested = [];
  const previews = [];
  h.client.getRhidAttendanceReport = async date => {
    requested.push(date);
    return { date, rows: [{
      ID_PESSOA_RHID: "1", NOME_COLABORADOR: "ANA", BATIDAS_RHID: "07:00; 12:00; 13:00; 17:00",
      COLETADO_EM: "2026-09-27T20:11:00Z",
    }] };
  };
  h.native.previewMedia = async (source, fileName) => previews.push({ blob: await previewSource(source), fileName });
  t.after(() => h.controller.stop());
  await h.controller.start();

  await h.view.emit("rhid-attendance-report-today", { value: "2026-09-27" });

  assert.deepEqual(requested, ["2026-09-27"]);
  assert.equal(h.store.getState().messages.at(-1).detail_table.kind, "rhid_attendance");
  assert.equal(h.store.getState().messages.at(-1).detail_table.updateLabel, "ÚLTIMA COLETA DO RHID ÀS 17:11");
  assert.equal(previews.length, 0);
});
test('Gerar relatório abaixo do calendário RHID abre o dia selecionado sem gerar PDF',async t=>{
 const h=makeHarness(),previews=[];
 h.client.getRhidAttendanceReport=async date=>({date,rows:[{ID_PESSOA_RHID:'1',NOME_COLABORADOR:'ANA',BATIDAS_RHID:'07:00;12:00;13:00;17:00'}]});
 h.native.previewMedia=async(source,name,options)=>previews.push({blob:await previewSource(source),name,options});
 t.after(()=>h.controller.stop());await h.controller.start();
 assert.equal(await h.view.emit('rhid-attendance-report-generate',{value:'2026-10-08'}),true);
 assert.equal(previews.length,0);
 assert.equal(h.store.getState().messages.at(-1).detail_table.reportDate,'2026-10-08');
 assert.equal(h.store.getState().messages.at(-1).detail_table.rows[0][0],'ANA');
});

for(const replaceExisting of [false,true])test(`navegação iniciada após consultar RHID descarta o PDF diário antes de abrir (relatório ${replaceExisting?'existente':'novo'})`,async t=>{
 const h=makeHarness(),previews=[];let navigation,started=false;
 h.client.getRhidAttendanceReport=async date=>({date,rows:[{ID_PESSOA_RHID:'1',NOME_COLABORADOR:'ANA',BATIDAS_RHID:'07:00;12:00;13:00;17:00'}]});
 h.client.sendText=async()=>({status:'processed',messages:[{type:'poll',question:'OUTRA TELA',options:[]}]});
 h.native.previewMedia=async(...args)=>previews.push(args);
 t.after(()=>h.controller.stop());await h.controller.start();
 if(replaceExisting)h.store.ingestRemoteMessages([{id:'existing-rhid',type:'poll',question:'RELATÓRIO RHID',options:[],detail_table:{kind:'rhid_attendance',reportDate:'2026-10-07',headers:[],rows:[]}}]);
 const messageId=replaceExisting?h.store.getState().messages.at(-1).id:'';
 const unsubscribe=h.store.subscribe(state=>{
   if(started||!state.messages.some(m=>m.detail_table?.kind==='rhid_attendance'&&m.detail_table.reportDate==='2026-10-08'))return;
   started=true;navigation=h.view.emit('select-reply',{replyId:'next-screen',label:'Abrir outra tela'});
 });t.after(unsubscribe);
 const result=await h.view.emit('rhid-attendance-report-generate',{value:'2026-10-08',messageId});await navigation;
 assert.equal(started,true);assert.equal(result,false);assert.equal(previews.length,0);
 assert.equal(h.store.getState().messages.at(-1).question,'OUTRA TELA');
});

test("ícone de atualização aguarda a sincronização RHID/SharePoint e informa conclusão", async t => {
  const h = makeHarness();
  const statuses = [];
  h.view.setRhidRefreshStatus = status => statuses.push(status);
  h.client.refreshRhidAttendance = async () => ({ status: "running", requestId: "a".repeat(32) });
  h.client.getRhidRefreshStatus = async () => ({ status: "completed", requestId: "a".repeat(32) });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("rhid-refresh");
  assert.equal(statuses[0].busy, true);
  assert.match(statuses.at(-1).message, /sharepoint.*atualizad/i);
  assert.equal(statuses.at(-1).busy, false);
});

test("atalho RHID abre a tela mesmo sem presenças no dia, sem PDF automático", async t => {
  const h = makeHarness();
  const previews = [];
  h.client.getRhidAttendanceReport = async date => ({ date, rows: [] });
  h.native.previewMedia = async (source, name) => previews.push({ blob: await previewSource(source), name });
  t.after(() => h.controller.stop());
  await h.controller.start();

  await h.view.emit("rhid-attendance-report-today", { value: "2026-09-27" });

  assert.equal(h.store.getState().messages.at(-1).detail_table.kind, "rhid_attendance");
  assert.deepEqual(h.store.getState().messages.at(-1).detail_table.rows, []);
  assert.equal(previews.length, 0);
});

test("compartilha PDF RHID sem o colaborador que não bate ponto regularmente, sem refazer a consulta", async t => {
  const h = makeHarness();
  const requested = [];
  const exported = [];
  const previews = [];
  h.native.previewMedia = async (blob, name, options) => { previews.push({ blob, name, options }); };
  const collectedAt = "2026-09-25T21:19:00Z";
  h.client.getRhidAttendanceReport = async date => {
    requested.push(date);
    return { date, rows: [
      { Id: 1, NOME_COLABORADOR: "BERNARDO NOTINI MOREIRA BAHIA", BATIDAS_RHID: "12:31", COLETADO_EM: collectedAt },
      { Id: 2, NOME_COLABORADOR: "CLEITON CESAR NONATO", BATIDAS_RHID: "06:58; 12:01; 12:59; 15:50", COLETADO_EM: collectedAt },
      { Id: 3, NOME_COLABORADOR: "EDGAR NELSON DA SILVA", BATIDAS_RHID: "06:55; 12:00", COLETADO_EM: collectedAt },
      { Id: 4, NOME_COLABORADOR: "FELICIANO ROGERIO DA SILVA", BATIDAS_RHID: "06:54; 12:04; 13:00; 16:01", COLETADO_EM: collectedAt },
      { Id: 5, NOME_COLABORADOR: "HELISON ROSA LUIS", BATIDAS_RHID: "07:01; 12:05; 13:01", COLETADO_EM: collectedAt },
      { Id: 6, NOME_COLABORADOR: "JOSE GERALDO DOS SANTOS", BATIDAS_RHID: "07:00; 12:04; 12:56; 16:04", COLETADO_EM: collectedAt },
      { Id: 7, NOME_COLABORADOR: "LUIZ BERNARDO DOS SANTOS", BATIDAS_RHID: "06:54; 12:10; 16:00", COLETADO_EM: collectedAt },
      { Id: 8, NOME_COLABORADOR: "MAURICIO HONORATO DE SOUZA", BATIDAS_RHID: "06:53; 12:01; 12:59; 15:52", COLETADO_EM: collectedAt },
      { Id: 9, NOME_COLABORADOR: "MAURO ANTONIO PEREIRA", BATIDAS_RHID: "06:57; 12:00; 13:03; 16:01", COLETADO_EM: collectedAt },
    ] };
  };
  h.native.exportMedia = async (blob, name) => { exported.push({ blob, name }); return "shared"; };
  t.after(() => h.controller.stop());
  await h.controller.start();

  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-25" });
  assert.equal(previews.length, 0, "abrir a tela diária não gera nem abre o PDF");
  assert.equal(exported.length, 0);
  const report = h.store.getState().messages.at(-1);
  assert.equal(report.detail_table.rows.length, 8, "a tela e o PDF devem partir das mesmas oito pessoas regulares");
  const expectedRows = [
    ["CLEITON CESAR NONATO", "06:58", "12:01", "12:59", "15:50", "07:54"],
    ["EDGAR NELSON DA SILVA", "06:55", "12:00", "—", "—", "05:05 (parcial)"],
    ["FELICIANO ROGERIO DA SILVA", "06:54", "12:04", "13:00", "16:01", "08:11"],
    ["HELISON ROSA LUIS", "07:01", "12:05", "13:01", "—", "05:04 (parcial)"],
    ["JOSE GERALDO DOS SANTOS", "07:00", "12:04", "12:56", "16:04", "08:12"],
    ["LUIZ BERNARDO DOS SANTOS", "06:54", "12:10", "—", "16:00", "05:16 (parcial)"],
    ["MAURICIO HONORATO DE SOUZA", "06:53", "12:01", "12:59", "15:52", "08:01"],
    ["MAURO ANTONIO PEREIRA", "06:57", "12:00", "13:03", "16:01", "08:01"],
  ];
  assert.deepEqual(report.detail_table.rows, expectedRows, "a tabela deve manter cada horário na linha do colaborador da tela");
  await h.view.emit("share-rhid-attendance-report", { messageId: report.id });

  assert.deepEqual(requested, ["2026-09-25"], "compartilhar deve usar a tabela já consultada, sem uma segunda fonte ou data");
  assert.equal(exported.length, 1);
  assert.equal(exported[0].name, "presencas-rhid-2026-09-25.pdf");
  assert.equal(exported[0].blob.type, "application/pdf");
  const bytes = new Uint8Array(await exported[0].blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 8)), "%PDF-1.7");
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const viewer = await task.promise;
  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= viewer.numPages; pageNumber += 1) {
      pages.push(await (await viewer.getPage(pageNumber)).getTextContent());
    }
    const text = pages.flatMap(page => page.items).map(item => item.str).join(" ");
    assert.equal(text.includes("BERNARDO NOTINI MOREIRA BAHIA"), false);
    for (let index = 0; index < expectedRows.length; index += 1) {
      const row = expectedRows[index];
      const name = row[0];
      const start = text.indexOf(name);
      assert.notEqual(start, -1, `PDF compartilhado sem ${name}`);
      const nextNames = expectedRows.slice(index + 1).map(next => text.indexOf(next[0], start + name.length)).filter(position => position >= 0);
      const end = nextNames.length ? Math.min(...nextNames) : text.length;
      const section = text.slice(start, end)
        .replaceAll("ÚLTIMA COLETA DO RHID ÀS 18:19", "")
        .replaceAll(/\b18:19\b/g, "");
      const expectedTimes = row.slice(1, -1).filter(value => /^\d{2}:\d{2}$/.test(value));
      const totalTime = row.at(-1).match(/^(\d{2}:\d{2})/)?.[1];
      if (totalTime) expectedTimes.push(totalTime);
      assert.deepEqual(section.match(/\b\d{2}:\d{2}\b/g) || [], expectedTimes, `PDF deve associar apenas as batidas e total de ${name}`);
    }
    assert.ok(text.includes("25/09/2026"), "PDF deve exibir a data da tabela selecionada");
    assert.ok(text.includes("ÚLTIMA COLETA DO RHID ÀS 18:19"), "PDF deve preservar o horário de coleta do relatório");
  } finally {
    await task.destroy();
  }
});

test("não consulta RHID para uma data impossível no calendário", async t => {
  const h = makeHarness();
  let calls = 0;
  h.client.getRhidAttendanceReport = async () => { calls += 1; return { rows: [] }; };
  t.after(() => h.controller.stop());
  await h.controller.start();

  const result = await h.view.emit("rhid-attendance-report-generate", { value: "2026-02-31" });
  assert.equal(result, false);
  assert.equal(calls, 0);
});

test("relatório RHID reúne batidas da mesma pessoa, ordena horários e sinaliza total parcial", async t => {
  const h = makeHarness();
  h.client.getRhidAttendanceReport = async date => ({ date, rows: [
    { ID_PESSOA_RHID: "1", NOME_COLABORADOR: "ANA", BATIDAS_RHID: "2026-09-25T18:00:00-03:00; 2026-09-25T07:00:00-03:00; 12:00" },
    { ID_PESSOA_RHID: "2", NOME_COLABORADOR: "BRUNO", BATIDAS_RHID: "06:55; 12:00; 13:00" },
    { ID_PESSOA_RHID: "1", NOME_COLABORADOR: "ANA", BATIDAS_RHID: ["13:00", "17:00", "19:00", "07:00"] },
  ] });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("rhid-attendance-report-generate", { value: "2026-09-25" });

  const table = h.store.getState().messages.at(-1).detail_table;
  assert.deepEqual(table.headers, ["Nome", "Entrada 1", "Saída 1", "Entrada 2", "Saída 2", "Total de horas/dia"]);
  assert.deepEqual(table.rows, [
    ["ANA", "07:00", "12:00", "13:00", "—", "05:00 (parcial)"],
    ["BRUNO", "06:55", "12:00", "13:00", "—", "05:05 (parcial)"],
  ]);
  assert.deepEqual(table.people[0].slots.exit2.rhidCandidates, ["17:00", "18:00", "19:00"]);
});

test("galerias de cadastro e documentos abrem localmente, reutilizam a tela e são destruídas no encerramento", async t => {
  const created = [];
  const opened = [];
  const destroyed = [];
  const previews = [];
  let previewOptions;
  const h = makeHarness({
    registrationGalleryDataFactory: async ({ kind }) => ({ kind, loadSnapshot: async () => ({ rows: [] }) }),
    registrationGalleryFactory: async ({ kind, data, openMediaCollection }) => {
      created.push([kind, data.kind]);
      if (kind === "documents") {
        assert.equal(typeof openMediaCollection, "function");
        await openMediaCollection([{ fileName: "contrato.pdf", source: "arquivo-local" }]);
      }
      return { open() { opened.push(kind); }, destroy() { destroyed.push(kind); } };
    },
  });
  h.native.previewMediaCollection = (items, options) => { previews.push(items); previewOptions = options; };
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;
  for (const [id, kind] of [
    ["action_group_gallery", "group"], ["action_family_gallery", "family"],
    ["action_subfamily_gallery", "subfamily"], ["action_product_gallery", "product"],
    ["action_documents_gallery", "documents"],
  ]) await h.view.emit("select-reply", { replyId: id });
  await h.view.emit("select-reply", { replyId: "action_group_gallery" });
  assert.deepEqual(created, [["group", "group"], ["family", "family"], ["subfamily", "subfamily"], ["product", "product"], ["documents", "documents"]]);
  assert.deepEqual(opened, ["group", "family", "subfamily", "product", "documents", "group"]);
  assert.deepEqual(previews, [[{ fileName: "contrato.pdf", source: "arquivo-local" }]]);
  assert.equal(typeof previewOptions.onAddToTray, "function");
  assert.equal(h.chatCalls.length, before);
  h.controller.stop();
  assert.deepEqual(destroyed.sort(), ["documents", "family", "group", "product", "subfamily"]);
});

test("PDF da galeria de documentos pode ser adicionado à barra como novo anexo", async t => {
  let callbacks;
  let previewOptions;
  let uploadedFile;
  let galleryCloseCount = 0;
  const h = makeHarness({
    registrationGalleryDataFactory: async ({ kind }) => ({ kind, loadSnapshot: async () => ({ rows: [] }) }),
    registrationGalleryFactory: async options => {
      callbacks = options;
      return { open() {}, close() { galleryCloseCount += 1; }, destroy() {} };
    },
  });
  h.native.previewMediaCollection = async (items, options) => { previewOptions = options; };
  h.client.sendFile = async file => {
    uploadedFile = file;
    h.chatCalls.push(["file", file.name]);
    return { status: "processed", messages: [{ type: "text", text: `Recebi ${file.name}` }] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    return {
      status: "processed",
      returned_to_main_menu: true,
      messages: [{ type: "poll", question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?", options: [] }],
    };
  };
  const before = h.chatCalls.length;
  await h.view.emit("select-reply", { replyId: "action_documents_gallery" });

  const blob = new Blob(["%PDF-1.7"], { type: "application/pdf" });
  const originalName = " comprovante.pdf ";
  await callbacks.openMediaCollection([{ fileName: originalName, source: Promise.resolve(blob) }]);
  assert.equal(typeof previewOptions.onAddToTray, "function");
  assert.equal(await previewOptions.onAddToTray({
    blob,
    fileName: originalName,
    attachments: [{ fileName: originalName, source: blob }],
  }), true);

  assert.equal(uploadedFile.name, originalName);
  assert.equal(uploadedFile.type, "application/pdf");
  assert.equal(await uploadedFile.text(), "%PDF-1.7");
  assert.equal(galleryCloseCount, 1, "a galeria deve fechar para revelar o menu inicial após adicionar o PDF");
  assert.deepEqual(h.chatCalls.slice(before), [
    ["text", { text: "", replyId: "portal_confirm_main_menu" }],
    ["file", originalName],
  ]);
});

test("adicionar anexo mantém a galeria aberta se a VM não retornar ao menu principal", async t => {
  let callbacks;
  let previewOptions;
  let galleryCloseCount = 0;
  let uploadCount = 0;
  const h = makeHarness({
    registrationGalleryDataFactory: async ({ kind }) => ({ kind, loadSnapshot: async () => ({ rows: [] }) }),
    registrationGalleryFactory: async options => {
      callbacks = options;
      return { open() {}, close() { galleryCloseCount += 1; }, destroy() {} };
    },
  });
  h.native.previewMediaCollection = async (_items, options) => { previewOptions = options; };
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    return {
      status: "processed",
      activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
      messages: [{ type: "text", text: "O fluxo anterior continua ativo." }],
    };
  };
  h.client.sendFile = async file => { uploadCount += 1; h.chatCalls.push(["file", file.name]); return { status: "processed" }; };
  await h.view.emit("select-reply", { replyId: "action_documents_gallery" });

  const blob = new Blob(["PDF"], { type: "application/pdf" });
  await callbacks.openMediaCollection([{ fileName: "comprovante.pdf", source: blob }]);
  assert.equal(await previewOptions.onAddToTray({
    blob,
    fileName: "comprovante.pdf",
    attachments: [{ fileName: "comprovante.pdf", source: blob }],
  }), false);

  assert.equal(galleryCloseCount, 0);
  assert.equal(uploadCount, 0);
  assert.equal(h.store.getState().activeFlow.id, "document_signing");
});

test("galeria reutiliza todos os anexos escolhidos e abre o menu principal antes de enviá-los à barra", async t => {
  let callbacks;
  let previewOptions;
  let galleryCloseCount = 0;
  const uploadedFiles = [];
  const h = makeHarness({
    registrationGalleryDataFactory: async ({ kind }) => ({ kind, loadSnapshot: async () => ({ rows: [] }) }),
    registrationGalleryFactory: async options => {
      callbacks = options;
      return { open() {}, close() { galleryCloseCount += 1; }, destroy() {} };
    },
  });
  h.native.previewMediaCollection = async (_items, options) => { previewOptions = options; };
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    return {
      status: "processed",
      returned_to_main_menu: true,
      messages: [{ type: "poll", question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?", options: [] }],
    };
  };
  h.client.sendFile = async file => {
    assert.equal(galleryCloseCount, 1, "a galeria deve fechar antes do primeiro envio de anexo");
    uploadedFiles.push(file);
    h.chatCalls.push(["file", file.name]);
    return { status: "processed", messages: [{ type: "text", text: `Recebi ${file.name}` }] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("select-reply", { replyId: "action_documents_gallery" });

  const first = new Blob(["PDF"], { type: "application/pdf" });
  const second = new Blob(["imagem"], { type: "image/jpeg" });
  await callbacks.openMediaCollection([
    { fileName: "comprovante.pdf", source: first },
    { fileName: "foto.jpg", source: Promise.resolve(second) },
  ]);
  assert.equal(await previewOptions.onAddToTray({
    blob: first,
    fileName: "comprovante.pdf",
    attachments: [
      { fileName: "comprovante.pdf", source: first },
      { fileName: "foto.jpg", source: Promise.resolve(second) },
    ],
  }), true);

  assert.deepEqual(h.chatCalls.slice(-3), [
    ["text", { text: "", replyId: "portal_confirm_main_menu" }],
    ["file", "comprovante.pdf"],
    ["file", "foto.jpg"],
  ]);
  assert.deepEqual(await Promise.all(uploadedFiles.map(file => file.text())), ["PDF", "imagem"]);
  assert.deepEqual(uploadedFiles.map(file => file.type), ["application/pdf", "image/jpeg"]);
});

test("abrir Power BI obtém token delegado, solicita consentimento e navega ao menu pela casa", async t => {
  const h = makeHarness();
  const opens = [];
  const tokenCalls = [];
  const authorizations = [];
  let tokenAttempts = 0;
  h.auth.getToken = async scopes => {
    tokenCalls.push(scopes);
    tokenAttempts += 1;
    if (tokenAttempts === 1) throw { code: "AUTH_REQUIRED", message: "consentimento necessário" };
    return "powerbi-aad-token";
  };
  h.auth.authorize = async (scopes, options) => { authorizations.push({ scopes, options }); };
  h.view.openPowerBiDashboard = options => { opens.push(options); return true; };
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;

  assert.equal(await h.view.emit("select-reply", { replyId: "action_powerbi_dashboard", label: "📊 POWER BI" }), true);

  const powerBiScopes = ["https://analysis.windows.net/powerbi/api/Report.Read.All"];
  assert.deepEqual(tokenCalls, [powerBiScopes, powerBiScopes]);
  assert.deepEqual(authorizations, [{
    scopes: powerBiScopes,
    options: { resumeAction: "action_powerbi_dashboard" },
  }]);
  assert.equal(opens.length, 1);
  assert.equal(opens[0].accessToken, "powerbi-aad-token");
  assert.equal(await opens[0].getAccessToken(), "powerbi-aad-token");
  await opens[0].onHome();
  assert.deepEqual(h.chatCalls.slice(before), [["text", { text: "", replyId: "portal_confirm_main_menu" }]]);
  assert.equal(h.chatCalls.length, before + 1);
});

test('casinha do painel Power BI também abandona o fluxo sem mostrar confirmação', async t => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = { id: 'payment_provision', title: 'CRIAR UMA PROVISÃO DE PAGAMENTO' };
  const calls = [];
  let onHome;
  h.view.openPowerBiDashboard = options => { onHome = options.onHome; return true; };
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === 'portal_confirm_main_menu') return {
      status: 'processed', activeFlow,
      messages: [{ type: 'poll', question: 'TEM CERTEZA QUE DESEJA ABANDONAR ESTE FLUXO?', options: [
        { id: 'portal_draft_exit_discard', label: 'SIM, ABANDONAR' },
        { id: 'portal_draft_exit_cancel', label: 'NÃO, CONTINUAR' },
      ] }],
    };
    assert.equal(payload.replyId, 'portal_draft_exit_discard');
    return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
      activeFlow: null, messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'QUAL É O VALOR?', options: [] }], { activeFlow });
  await h.view.emit('select-reply', { replyId: 'action_powerbi_dashboard', label: 'POWER BI' });
  const before = calls.length;

  assert.equal(await onHome(), true);
  assert.deepEqual(calls.slice(before), ['portal_confirm_main_menu', 'portal_draft_exit_discard']);
  assert.equal(h.store.getState().activeFlow, null);
  assert.equal(h.view.renders.some(render => render.messages?.some(message => /ABANDONAR ESTE FLUXO/.test(message.question || ''))), false);
});

test("retoma a abertura do painel Power BI após consentimento Microsoft", async t => {
  const h = makeHarness();
  let opens = 0;
  h.auth.consumePendingAction = () => "action_powerbi_dashboard";
  h.view.openPowerBiDashboard = options => { opens += 1; assert.equal(options.accessToken, "token"); return true; };
  t.after(() => h.controller.stop());

  await h.controller.start();

  assert.equal(opens, 1);
});
const backendWorkflowPath = join(homedir(), "OneDrive - energetica", "Documents", "New project", "whatsapp-sharepoint-oci", "worker", "workflow_config.json");
const pendingNoteWorkflowConfig = JSON.parse(readFileSync(
  existsSync(backendWorkflowPath) ? backendWorkflowPath : new URL("./fixtures/pending-note-workflow-config.json", import.meta.url),
  "utf8",
));

function pendingNoteWorkflowScreens() {
  const whatsapp = pendingNoteWorkflowConfig.whatsapp;
  const named = (items, id) => items.find(item => item.id === id);
  const menuOption = item => ({ id: item.id, reply: item.id, label: item.title });
  const stepOption = (step, item) => ({
    id: `choice:${step.key}:${item.id}`, reply: `choice:${step.key}:${item.id}`,
    label: `${item.id} - ${item.title}`,
  });
  const steps = pendingNoteWorkflowConfig.sharepoint.launch_flow.steps;
  const step = key => steps.find(item => item.key === key);
  const orderType = step("pedido_lancamento");
  const modality = step("tipo_lancamento");
  const order = step("pedido_existente_lancamento");
  const date = step("data_pgto_previsto_lancamento");
  const supplies = named(whatsapp.start_groups, "group_supplies");
  const launches = named(whatsapp.start_actions, "action_supply_launches");
  const personal = named(whatsapp.start_actions, "action_personal_expense_launch");
  const launch = named(whatsapp.submenus.supply_launches.actions, "action_launch");
  const screens = [
    ["QUAL ÁREA VOCÊ DESEJA ACESSAR?", [menuOption(supplies)]],
    [`${supplies.title}\nQUAL FLUXO VOCÊ DESEJA INICIAR?`, [menuOption(launches)]],
    [`${whatsapp.submenus.supply_launches.title}\n${whatsapp.submenus.supply_launches.prompt}`, [menuOption(launch)]],
    [orderType.prompt, orderType.source.options.map(item => stepOption(orderType, item))],
    [modality.prompt, modality.source.options.map(item => stepOption(modality, item))],
    [order.prompt, [{ id: `choice:${order.key}:13`, reply: `choice:${order.key}:13`, label: "13 - Terceiro (R$ 100,00)" }]],
    [date.prompt, []],
  ];
  const replies = ["group_supplies", "action_supply_launches", "action_launch", "choice:pedido_lancamento:2", "choice:tipo_lancamento:2", "choice:pedido_existente_lancamento:13"];
  return { screens, replies, personal: menuOption(personal) };
}

function configurePendingNoteWorkflow(h, { initial = "main", failAt = "", advanceBeforeFailure = false, wrongStage = -1, orderOffscreen = false, dateContextUnchanged = false, selectedOrderId = "13" } = {}) {
  const { screens, replies, personal } = pendingNoteWorkflowScreens();
  const calls = [];
  let stage = initial === "diary" ? -4 : initial === "document" ? -2 : initial === "personal" ? -1 : initial === "modality" || initial === "new-order-modality" ? 4 : initial === "date" ? 6 : 0;
  let failed = false;
  h.client.getPendingNotesSnapshot = async () => ({ count: 1, rows: [{ id: "13", supplier: "Terceiro", label: "13 - Terceiro" }] });
  const response = () => {
    const [question, options] = stage === -4
      ? ["QUAL É A DESCRIÇÃO DO DIÁRIO?", []]
      : stage === -5
        ? ["DESEJA POSTAR COMO PENDENTE OU SAIR SEM POSTAR AGORA?", [
          { id: "diary_partial_save_yes", reply: "diary_partial_save_yes", label: "POSTAR COMO PENDENTE" },
          { id: "diary_partial_save_no", reply: "diary_partial_save_no", label: "SAIR SEM POSTAR AGORA" },
        ]]
        : stage === -2
      ? ["QUAL DOCUMENTO DESEJA ASSINAR?", []]
      : stage === -3
        ? ["ANTES DE ABRIR O MENU PRINCIPAL: DESEJA CONVERTER ESTE ITEM EM RASCUNHO?", [
          { id: "portal_draft_exit_save", reply: "portal_draft_exit_save", label: "CRIAR RASCUNHO" },
          { id: "portal_draft_exit_discard", reply: "portal_draft_exit_discard", label: "ELIMINAR RASCUNHO FORMULÁRIO" },
        ]]
        : stage === -1
          ? ["💰 GASTOS PESSOAIS\nQUAL FLUXO VOCÊ DESEJA INICIAR?", [personal]]
          : screens[stage];
    return { status: "processed", activeFlow: stage === -4 || stage === -5 ? { id: "construction_diary_fill", title: "DIÁRIO DE OBRAS" } : stage === -2 || stage === -3 ? { id: "document_signing", title: "ASSINAR DOCUMENTOS" } : stage >= 3 ? { id: "launch", title: "EFETUAR LANÇAMENTO",
      contextId: `launch-step-${stage === 6 && dateContextUnchanged ? 5 : stage}`,
      rows: stage === 6 ? [{ label: "TIPO DE PEDIDO", value: "PEDIDO EXISTENTE" },
        ...(selectedOrderId == null ? [] : [{ label: "ID DO PEDIDO EXISTENTE", value: selectedOrderId }])] : [] } : null,
      messages: [{ type: "poll", question, options: stage === wrongStage || (stage === 5 && orderOffscreen) ? [] : options }] };
  };
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === "input_continue") return response();
    if (payload.replyId === "portal_confirm_main_menu") { stage = stage === -2 ? -3 : 0; return response(); }
    if (payload.replyId === "abandon_construction_diary" && stage === -4) { stage = -5; return response(); }
    if (payload.replyId === "diary_partial_save_no" && stage === -5) { stage = 0; return response(); }
    if (payload.replyId === "portal_draft_exit_discard" && stage === -3) { stage = 0; return response(); }
    if (stage === 5 && orderOffscreen && !payload.replyId && payload.text === "13") { stage = 6; return response(); }
    if (payload.replyId !== replies[stage]) throw new Error(`resposta fora do fluxo: ${payload.replyId} na etapa ${stage}`);
    if (payload.replyId === failAt && !failed) {
      failed = true;
      if (advanceBeforeFailure) stage++;
      throw new Error(`Falha real da VM em ${payload.replyId}`);
    }
    stage++;
    return response();
  };
  return { calls, replies };
}

test("atalhos IDFOLHA e FOLHA PGTO abrem suas galerias sem responder ao fluxo RH", async t => {
  const opened = [];
  const h = makeHarness({ hrPayrollGalleryFactory: async options => ({
    open() { opened.push(options.gallery); },
    destroy() {},
  }) });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;
  await h.view.emit("select-reply", { replyId: "action_hr_gallery_idfolha", label: "GALERIA IDFOLHA" });
  await h.view.emit("select-reply", { replyId: "action_hr_gallery_folhapgto", label: "GALERIA FOLHA PGTO" });
  assert.deepEqual(opened, ["IDFOLHA", "FOLHAPGTO"]);
  assert.equal(h.chatCalls.length, before);
});

test("galeria de folha usa leitura SharePoint Graph autenticada sem chamar rota inexistente do chat", async t => {
  let galleryOptions;
  const dataCalls = [];
  const serverCalls = [];
  const h = makeHarness({
    hrPayrollGalleryDataFactory: async ({ tokenProvider }) => {
      dataCalls.push(["token", await tokenProvider(["Sites.Read.All"])]);
      return { async loadPage(...args) {
        dataCalls.push(args);
        return { gallery: "IDFOLHA", page: 1, pageSize: 25, fields: [], rows: [{ id: "12", MESREFERENCIA: "09/2026" }], hasMore: false, nextCursor: null };
      }, async loadPaymentsForPayrollId(id, options) {
        dataCalls.push(["report", id, options.signal instanceof AbortSignal]);
        return [{ id: "81", IDFOLHA: Number(id) }];
      }, invalidateRelatedReports() { dataCalls.push(['invalidate-linked']); } };
    },
    hrPayrollGalleryFactory: async options => {
      galleryOptions = options;
      return { open() {}, destroy() {} };
    },
  });
  h.client.hrPayrollGalleryRequest = async (...args) => { serverCalls.push(args); throw new Error("rota backend ausente"); };
  t.after(() => h.controller.stop());
  await h.controller.start();

  await h.view.emit("select-reply", { replyId: "action_hr_gallery_idfolha", label: "GALERIA IDFOLHA" });
  const result = await galleryOptions.request("IDFOLHA", 1, 25, null);
  const reportRows = await galleryOptions.requestReport("12", { signal: new AbortController().signal });
  galleryOptions.invalidateRelatedReports();

  assert.deepEqual(dataCalls, [
    ["token", "token"],
    ["IDFOLHA", { page: 1, pageSize: 25, cursor: null }],
    ["report", "12", true],
    ['invalidate-linked'],
  ]);
  assert.equal(result.rows[0].MESREFERENCIA, "09/2026");
  assert.equal(reportRows[0].IDFOLHA, 12);
  assert.deepEqual(serverCalls, []);
});
test('FOLHAPGTO creation callbacks use authenticated gallery data and reject a stopped session', async t => {
  let options; const calls=[];
  const h=makeHarness({hrPayrollGalleryDataFactory:async()=>({loadPage:async()=>({}),loadPaymentOptions:async arg=>{calls.push(['options',arg]);return {launches:[]};},savePayment:async(...args)=>{calls.push(['save',...args]);return {id:'101'};}}),hrPayrollGalleryFactory:async value=>{options=value;return {open(){},destroy(){}};}});
  t.after(()=>h.controller.stop());await h.controller.start();
  await h.view.emit('select-reply',{replyId:'action_hr_gallery_folhapgto',label:'GALERIA FOLHA PGTO'});
  const signal=new AbortController().signal;
  assert.deepEqual(await options.loadPaymentOptions({signal}),{launches:[]});
  assert.equal((await options.savePayment({launchId:'10'},{operationId:'test'})).id,'101');
  assert.deepEqual(calls,[['options',{signal}],['save',{launchId:'10'},{operationId:'test'}]]);
  h.controller.stop();await assert.rejects(options.savePayment({launchId:'10'},{operationId:'test'}));assert.equal(calls.length,2);
});
test('IDFOLHA editor forwards attachment save options and guarded current app tray',async t=>{
  let options;const calls=[];
  const h=makeHarness({hrPayrollGalleryDataFactory:async()=>({loadPage:async()=>({}),loadPaymentsForPayrollId:async()=>[],
    saveEditor:async(...args)=>{calls.push(args);return {id:'4'};}}),
    hrPayrollGalleryFactory:async value=>{options=value;return {open(){},destroy(){}};}});
  t.after(()=>h.controller.stop());await h.controller.start();
  h.store.syncAttachments([{id:'remote',fileName:'assinado.pdf',mimeType:'application/pdf',mediaUrl:'/api/portal-media/remote'}]);
  await h.view.emit('select-reply',{replyId:'action_hr_gallery_idfolha'});
  assert.equal(typeof options.getReceiptAttachments,'function');
  assert.equal(typeof options.readReceiptAttachment,'function');
  const tray=options.getReceiptAttachments();assert.deepEqual(tray.map(a=>a.id),['attachment:remote']);
  const file=await options.readReceiptAttachment(tray[0].id,tray[0]);
  const extra={attachments:[file],signal:new AbortController().signal},context={};
  await options.saveEditor(context,{STATUS:'INATIVO'},extra);
  assert.deepEqual(calls,[[context,{STATUS:'INATIVO'},extra]]);
  assert.equal(h.store.getState().attachments.length,1);
  h.store.syncAttachments([{id:'remote',fileName:'substituido.pdf',mediaUrl:'/api/portal-media/remote'}]);
  await assert.rejects(options.readReceiptAttachment(tray[0].id,tray[0]),/alterad/i);
  h.controller.stop();assert.throws(options.getReceiptAttachments,/sessão/i);
  await assert.rejects(options.saveEditor(context,{STATUS:'INATIVO'},extra),/sessão/i);
  assert.equal(calls.length,1);
});

test("abre galeria sem enviar escolha ao fluxo e captura assinatura sem usar bandeja", async t => {
  let callbacks;
  let opens = 0;
  let destroys = 0;
  const h = makeHarness({ launchGalleryFactory: async options => {
    callbacks = options;
    return { open() { opens++; }, destroy() { destroys++; } };
  } });
  h.view.openSignaturePad = () => true;
  h.client.launchGalleryRequest = async () => ({ rows: [] });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;
  await h.view.emit("select-reply", { replyId: "action_launch_gallery", label: "GALERIA LANÇAMENTOS" });
  assert.equal(opens, 1);
  assert.equal(h.chatCalls.length, before);
  const signature = callbacks.captureSignature();
  const file = new File(["png"], "assinatura.png", { type: "image/png" });
  await h.view.emit("signature-captured", { file, fileId: "launch-gallery" });
  assert.equal(await signature, file);
  assert.equal(h.chatCalls.length, before);
  const cancelled = callbacks.captureSignature();
  await h.view.emit("signature-cancelled", { fileId: "launch-gallery" });
  assert.equal(await cancelled, null);
  h.controller.stop();
  assert.equal(destroys, 1);
});

test("galeria abre coleção de anexos pelo visualizador sem cair no detalhe do lançamento", async t => {
  let callbacks;
  let collection;
  let previewOptions;
  const h = makeHarness({ launchGalleryFactory: async options => {
    callbacks = options;
    return { open() {}, destroy() {} };
  } });
  h.native.previewMediaCollection = async (items, options) => { collection = items; previewOptions = options; };
  h.client.launchGalleryRequest = async () => ({ rows: [] });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("select-reply", { replyId: "action_launch_gallery" });
  await callbacks.openMediaCollection([
    { id: 3429, fileName: "foto.jpg", mediaUrl: "/api/portal-media/foto-3429" },
    { id: 3429, fileName: "comprovante.pdf", mediaUrl: "/api/portal-media/pdf-3429" },
  ]);
  assert.equal(collection.length, 2);
  assert.deepEqual(collection.map(item => ({ id: item.id, fileName: item.fileName })), [
    { id: 3429, fileName: "foto.jpg" },
    { id: 3429, fileName: "comprovante.pdf" },
  ]);
  assert.deepEqual(collection.map(item => item.mediaUrl), [
    "/api/portal-media/foto-3429",
    "/api/portal-media/pdf-3429",
  ]);
  assert.equal(typeof previewOptions.onAddToTray, "function");
});

test("anexo único da Galeria Lançamentos também pode ser adicionado à barra", async t => {
  let callbacks;
  let previewOptions;
  let previewBlob;
  const h = makeHarness({ launchGalleryFactory: async options => {
    callbacks = options;
    return { open() {}, destroy() {} };
  } });
  h.native.previewMedia = async (source, fileName, options) => {
    previewBlob = await previewSource(source);
    previewOptions = options;
    assert.equal(fileName, "foto.jpg");
  };
  h.client.fetchMedia = async () => new Blob(["foto"], { type: "image/jpeg" });
  h.client.launchGalleryRequest = async () => ({ rows: [] });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("select-reply", { replyId: "action_launch_gallery" });
  await callbacks.openMedia({ id: 3429, fileName: "foto.jpg" });
  assert.equal(previewBlob.type, "image/jpeg");
  assert.equal(typeof previewOptions.onAddToTray, "function");
});

test("Galeria Lançamentos abre localmente a partir do menu de Suprimentos", async t => {
  let opens = 0;
  const h = makeHarness({ historyMode: "current-step", launchGalleryFactory: async () => ({
    open() { opens++; },
    destroy() {},
  }) });
  h.client.launchGalleryRequest = async () => ({ rows: [] });
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
    options: [{ id: "new_document", label: "📄 LANÇAMENTOS", reply: "new_document" }],
  }], { resetConversation: true });
  const before = h.chatCalls.length;

  await h.view.emit("select-reply", { replyId: "action_launch_gallery", label: "GALERIA LANÇAMENTOS" });
  assert.equal(opens, 1);
  assert.equal(h.chatCalls.length, before, "abrir a galeria também deve permanecer local");
});

test("Galeria Lançamentos fornece leituras pontuais autenticadas do pedido e dos lançamentos agrupados", async t => {
  let callbacks;
  const reads = [];
  let tokenScopes;
  let orderSignal, groupSignal;
  const h = makeHarness({
    launchGalleryFactory: async options => {
      callbacks = options;
      return { async open() {}, destroy() {} };
    },
    ordersGalleryDataFactory: async ({ tokenProvider }) => ({
      async loadItem(id, { signal } = {}) {
        reads.push(["item", id]);
        orderSignal = signal;
        assert.equal(await tokenProvider(["Sites.Read.All"]), "sharepoint-token");
        return { id, fields: { FORNECEDOR: "Fornecedor A" } };
      },
      async loadLaunchGroup(id, { signal } = {}) {
        reads.push(["group", id]);
        groupSignal = signal;
        assert.equal(await tokenProvider(["Sites.Read.All"]), "sharepoint-token");
        return [{ id: "3451", fields: { AGRUPAR: id } }];
      },
    }),
  });
  h.auth.getToken = async scopes => { tokenScopes = scopes; return "sharepoint-token"; };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("select-reply", { replyId: "action_launch_gallery", label: "GALERIA LANÇAMENTOS" });

  const controller = new AbortController();
  const snapshot = await callbacks.loadOrderSnapshot({ id: "334", signal: controller.signal });
  const launches = await callbacks.loadLaunchGroup("334", { signal: controller.signal });
  assert.deepEqual(reads, [["item", "334"], ["group", "334"]]);
  assert.equal(orderSignal, controller.signal);
  assert.equal(groupSignal, controller.signal);
  assert.deepEqual(tokenScopes, ["Sites.Read.All"]);
  assert.equal(snapshot.rows[0].id, "334");
  assert.equal(launches[0].fields.AGRUPAR, "334");
});

test("Galeria Pedidos e popup AGRUPAR preservam o próprio retorno após consentimento SharePoint", async t => {
  let launchOptions, orderData;
  const resumeActions = [], factories = [];
  const h = makeHarness({
    launchGalleryFactory: async options => {
      launchOptions = options;
      return { async open() {}, destroy() {} };
    },
    ordersGalleryFactory: async options => {
      orderData = options.data;
      return { async open() {}, destroy() {} };
    },
    ordersGalleryDataFactory: async ({ tokenProvider }) => {
      factories.push(tokenProvider);
      return { async loadSnapshot() {
        return { rows: [], token: await tokenProvider(["Sites.Read.All"]) };
      } };
    },
  });
  let tokenAttempts = 0;
  h.auth.getToken = async () => {
    tokenAttempts += 1;
    if (tokenAttempts % 2 === 1) throw { code: "AUTH_REQUIRED", message: "consentimento necessário" };
    return "sharepoint-token";
  };
  h.auth.authorize = async (_scopes, options) => resumeActions.push(options.resumeAction);
  t.after(() => h.controller.stop());
  await h.controller.start();

  await h.view.emit("select-reply", { replyId: "action_orders_gallery" });
  await orderData.loadSnapshot();
  await h.view.emit("select-reply", { replyId: "action_launch_gallery" });
  await launchOptions.loadOrderSnapshot();

  assert.equal(factories.length, 2);
  assert.deepEqual(resumeActions, ["action_orders_gallery", "action_launch_gallery"]);
});

test("Galeria Pedidos abre a Screen10 SharePoint localmente e usa o visualizador compartilhado", async t => {
  let callbacks;
  let opens = 0;
  let scopesRequested;
  let previewItems;
  let previewOptions;
  const h = makeHarness({
    ordersGalleryFactory: async options => {
      callbacks = options;
      return { async open() { opens++; }, destroy() {} };
    },
    ordersGalleryDataFactory: async ({ tokenProvider }) => ({
      async loadSnapshot() { return { rows: [], token: await tokenProvider(["Sites.Read.All"]) }; },
    }),
  });
  h.auth.getToken = async scopes => { scopesRequested = scopes; return "sharepoint-token"; };
  h.native.previewMediaCollection = async (items, options) => { previewItems = items; previewOptions = options; };
  h.client.launchGalleryRequest = async () => { throw new Error("não deve consultar a galeria de lançamentos"); };
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;
  await h.view.emit("select-reply", { replyId: "action_orders_gallery", label: "GALERIA PEDIDOS" });
  assert.equal(opens, 1);
  assert.equal(h.chatCalls.length, before);
  const result = await callbacks.data.loadSnapshot();
  assert.equal(result.token, "sharepoint-token");
  assert.deepEqual(scopesRequested, ["Sites.Read.All"]);
  await callbacks.openMediaCollection([{ fileName: "nota.pdf", source: Promise.resolve(new Blob(["pdf"])) }]);
  assert.equal(previewItems.length, 1);
  assert.equal(previewItems[0].fileName, "nota.pdf");
  assert.equal(typeof previewOptions.onAddToTray, "function");
});

test("retoma a Galeria Pedidos depois do retorno de consentimento Microsoft no navegador", async t => {
  let opens = 0;
  const h = makeHarness({
    ordersGalleryFactory: async () => ({ async open() { opens++; }, destroy() {} }),
    ordersGalleryDataFactory: async () => ({}),
  });
  h.auth.consumePendingAction = () => "action_orders_gallery";
  t.after(() => h.controller.stop());

  await h.controller.start();

  assert.equal(opens, 1);
});

test("retoma a galeria de folha escolhida após o retorno de consentimento Microsoft", async t => {
  for (const [action, gallery] of [
    ["action_hr_gallery_idfolha", "IDFOLHA"],
    ["action_hr_gallery_folhapgto", "FOLHAPGTO"],
  ]) {
    let opened = "";
    const h = makeHarness({
      hrPayrollGalleryDataFactory: async () => ({
        async loadPage() { return { rows: [] }; },
        async loadPaymentsForPayrollId() { return []; },
      }),
      hrPayrollGalleryFactory: async options => ({ async open() { opened = options.gallery; }, destroy() {} }),
    });
    h.auth.consumePendingAction = () => action;
    t.after(() => h.controller.stop());
    await h.controller.start();
    assert.equal(opened, gallery);
  }
});

test("Galeria Pedidos solicita consentimento interativo quando SharePoint exige outro escopo", async t => {
  let tokenProvider;
  const authorizationCalls = [];
  const h = makeHarness({
    ordersGalleryFactory: async () => ({ async open() {}, destroy() {} }),
    ordersGalleryDataFactory: async options => {
      tokenProvider = options.tokenProvider;
      return { async loadSnapshot() { return { rows: [] }; } };
    },
  });
  let tokenAttempts = 0;
  h.auth.getToken = async scopes => {
    tokenAttempts++;
    if (tokenAttempts === 1) throw { code: "AUTH_REQUIRED", message: "interação necessária" };
    return "sharepoint-token";
  };
  h.auth.authorize = async scopes => { authorizationCalls.push(scopes); };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("select-reply", { replyId: "action_orders_gallery", label: "GALERIA PEDIDOS" });

  assert.equal(await tokenProvider(["https://energeticaltda-my.sharepoint.com/AllSites.Read"]), "sharepoint-token");
  assert.deepEqual(authorizationCalls, [["https://energeticaltda-my.sharepoint.com/AllSites.Read"]]);
  assert.equal(tokenAttempts, 2);
});

test("Galeria Tarefas consulta LANCAMENTOTAREFAS autenticada e abre seus anexos sem enviar nada à VM", async t => {
  let callbacks;
  let opens = 0;
  let scopesRequested;
  let previewItems;
  let previewOptions;
  const h = makeHarness({
    tasksGalleryFactory: async options => {
      callbacks = options;
      return { async open() { opens++; }, destroy() {} };
    },
    tasksGalleryDataFactory: async ({ tokenProvider }) => ({
      async loadSnapshot() { return { rows: [], token: await tokenProvider(["Sites.Read.All"]) }; },
    }),
  });
  h.auth.getToken = async scopes => { scopesRequested = scopes; return "sharepoint-token"; };
  h.native.previewMediaCollection = async (items, options) => { previewItems = items; previewOptions = options; };
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;
  await h.view.emit("select-reply", { replyId: "action_tasks_gallery", label: "GALERIA TAREFAS" });
  assert.equal(opens, 1);
  assert.equal(h.chatCalls.length, before);
  assert.equal((await callbacks.data.loadSnapshot()).token, "sharepoint-token");
  assert.deepEqual(scopesRequested, ["Sites.Read.All"]);
  await callbacks.openMediaCollection([{ fileName: "foto.jpg", source: Promise.resolve(new Blob(["img"])) }]);
  assert.equal(previewItems.length, 1);
  assert.equal(previewItems[0].fileName, "foto.jpg");
  assert.equal(typeof previewOptions.onAddToTray, "function");
});

test("Galeria Tarefas é reaberta após retorno do consentimento Microsoft da tela G7", async t => {
  let opens = 0;
  const h = makeHarness({
    tasksGalleryFactory: async () => ({ async open() { opens++; }, destroy() {} }),
    tasksGalleryDataFactory: async () => ({}),
  });
  h.auth.consumePendingAction = () => "action_tasks_gallery";
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(opens, 1);
});

test('mais da galeria envia action_task e exibe o fluxo real de criação de tarefa', async t => {
  const { createTasksGallery } = await import('../src/ui/tasks-gallery-view.js');
  const dom = new JSDOM('<main id="app"></main>');
  const h = makeHarness({
    tasksGalleryFactory: options => createTasksGallery({ document: dom.window.document, ...options }),
    tasksGalleryDataFactory: async () => ({ async loadSnapshot() { return { rows: [] }; } }),
  });
  h.client.sendText = async payload => {
    h.chatCalls.push(['text', payload]);
    return { status: 'awaiting_field', activeFlow: { id: 'task', title: 'ADICIONAR UMA NOVA TAREFA' },
      messages: [{ type: 'poll', question: 'QUAL É A TAREFA?', options: [] }] };
  };
  t.after(() => { h.controller.stop(); dom.window.close(); });
  await h.controller.start();
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'DEMANDAS', options: [
    { id: 'action_task', label: 'ADICIONAR UMA NOVA TAREFA' },
  ] }], { activeFlow: { id: 'demands', title: 'DEMANDAS' } });
  const before = h.chatCalls.length;
  await h.view.emit('select-reply', { replyId: 'action_tasks_gallery', label: 'GALERIA TAREFAS' });
  const button = dom.window.document.querySelector('[data-action="create-task"]');
  assert.ok(button, 'botão de criação integrado à galeria');
  button.click(); button.click();
  for (let attempt = 0; attempt < 20 && h.store.getState().activeFlow?.id !== 'task'; attempt++)
    await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.chatCalls.slice(before), [['text', {
    text: 'ADICIONAR UMA NOVA TAREFA', replyId: 'action_task',
  }]]);
  assert.equal(dom.window.document.querySelector('.tg-overlay').hidden, true);
  assert.equal(h.store.getState().activeFlow.id, 'task');
  assert.equal(h.store.getState().messages.at(-1).question, 'QUAL É A TAREFA?');
});

const galleryCreationCases = [
  ...['investment', 'institution', 'investment_type', 'profitability', 'taxation'].map((kind, index) => [
    `action_${kind}_gallery`, 'registrationGalleryFactory', 'registrationGalleryDataFactory', `action_register_${kind}`,
    ['CADASTRO INVESTIMENTO', 'CADASTRO INSTITUIÇÃO', 'CADASTRO TIPO INVESTIMENTO', 'CADASTRO DE RENTABILIDADE', 'CADASTRO TRIBUTAÇÃO'][index], `${kind}_registration`,
  ]),
  ['action_provision_description_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_payment', 'CRIAR UMA PROVISÃO DE PAGAMENTO', 'payment'],
  ['action_hr_gallery_presencas', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_create_supplier_attendance', 'CRIAR PRESENÇA DE FORNECEDOR', 'supplier_attendance'],
  ['action_launch_gallery', 'launchGalleryFactory', null, 'action_launch', 'EFETUAR LANÇAMENTO', 'launch'],
  ['action_orders_gallery', 'ordersGalleryFactory', 'ordersGalleryDataFactory', 'action_pending_order_registration', 'EFETUAR CADASTRO DE PEDIDO (NOTAS PENDENTES)', 'pending_order_registration'],
  ['action_tasks_gallery', 'tasksGalleryFactory', 'tasksGalleryDataFactory', 'action_task', 'ADICIONAR UMA NOVA TAREFA', 'task'],
  ['action_payment_programming_gallery', 'paymentProgrammingGalleryFactory', 'paymentProgrammingGalleryDataFactory', 'action_payment', 'CRIAR UMA PROVISÃO DE PAGAMENTO', 'payment'],
  ['action_recurring_expenses_gallery', 'recurringExpensesGalleryFactory', 'recurringExpensesGalleryDataFactory', 'action_recurring_expense', 'CRIAR UMA DESPESA RECORRENTE', 'recurring_expense'],
  ['action_group_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_supply_group', 'CADASTRAR GRUPO', 'supply_group_registration'],
  ['action_family_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_supply_family', 'CADASTRAR FAMÍLIA', 'supply_family_registration'],
  ['action_subfamily_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_supply_subfamily', 'CADASTRAR SUBFAMÍLIA', 'supply_subfamily_registration'],
  ['action_product_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_supply_product', 'CADASTRAR PRODUTO', 'supply_product_registration'],
  ['action_documents_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_document', 'ADICIONAR UM NOVO DOCUMENTO', 'document'],
  ['action_asset_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_fixed_asset', 'CADASTRAR IMOBILIZADO', 'fixed_asset_registration'],
  ['action_asset_function_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_fixed_asset_function', 'CADASTRAR FUNÇÃO DO IMOBILIZADO', 'fixed_asset_function_registration'],
  ['action_asset_product_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_fixed_asset_product', 'CADASTRAR PRODUTO IMOBILIZADO', 'fixed_asset_product_registration'],
  ['action_asset_group_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_fixed_asset_group', 'CADASTRAR GRUPO IMOBILIZADO', 'fixed_asset_group_registration'],
  ['action_work_diary_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_create_construction_diary', 'CADASTRAR DIÁRIO DE OBRAS', 'construction_diary_create'],
  ['action_quote_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_create_new_quotation', 'CRIAR NOVA COTAÇÃO', 'new_quotation'],
  ['action_contract_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_contractor_contract', 'CADASTRAR CONTRATO DE EMPREITEIRO', 'contractor_contract_registration'],
  ['action_contract_line_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_contract_line', 'CADASTRAR LINHA CONTRATO', 'contract_line_registration'],
  ['action_measurement_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_measurement', 'CADASTRAR MEDIÇÃO', 'measurement_registration'],
  ['action_measurement_line_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_measurement_line', 'CADASTRAR LINHA MEDIÇÃO', 'measurement_line_registration'],
  ['action_stage_demonstrative_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_create_construction_stage_demonstrative', 'CRIAR DEMONSTRATIVO DE ETAPA', 'construction_stage_demonstrative_create'],
  ['action_construction_stage_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_register_construction_stage', 'CADASTRO DE ETAPA OBRA', 'construction_stage_registration'],
  ['action_recurring_tasks_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_recurring_task_registration', 'CADASTRAR TAREFA RECORRENTE', 'recurring_task_registration'],
  ['action_delegated_tasks_gallery', 'registrationGalleryFactory', 'registrationGalleryDataFactory', 'action_delegated_task', 'CRIAR UMA TAREFA DELEGADA', 'delegated_task'],
];

for (const [galleryId, factory, dataFactory, replyId, label, flow] of galleryCreationCases) {
  test(`gallery create shortcut ${galleryId} starts its own existing flow`, async t => {
    let options;
    const h = makeHarness({
      [factory]: async value => { options = value; return { open() {}, destroy() {} }; },
      ...(dataFactory ? { [dataFactory]: async () => ({ loadSnapshot: async () => ({ rows: [] }) }) } : {}),
    });
    t.after(() => h.controller.stop());
    await h.controller.start();
    h.client.sendText = async payload => {
      h.chatCalls.push(['text', payload]);
      assert.equal(payload.replyId, replyId, 'only the matched existing workflow is requested');
      return { status: 'awaiting_field', activeFlow: { id: flow, title: label },
        messages: [{ type: 'poll', question: 'PRIMEIRO CAMPO DO CADASTRO', options: [] }] };
    };
    const before = h.chatCalls.length;
    await h.view.emit('select-reply', { replyId: galleryId });
    assert.equal(typeof options?.onCreate, 'function', 'gallery receives its creation callback');
    await options.onCreate();
    assert.deepEqual(h.chatCalls.slice(before), [['text', { text: label, replyId }]]);
    assert.equal(h.store.getState().activeFlow.id, flow);
    assert.equal(h.store.getState().messages.at(-1).question, 'PRIMEIRO CAMPO DO CADASTRO');
  });
}

test('gallery creation callbacks cannot send after sign-out or controller stop', async t => {
  let options;
  const h = makeHarness({ ordersGalleryFactory: async value => {
    options = value; return { open() {}, destroy() {} };
  }, ordersGalleryDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [] }) }) });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit('select-reply', { replyId: 'action_orders_gallery' });
  assert.equal(typeof options?.onCreate, 'function');
  const before = h.chatCalls.length;
  h.controller.stop();
  assert.equal(await options.onCreate(), false);
  assert.equal(h.chatCalls.length, before, 'expired callback never starts a workflow');
});

test('cached gallery creation still works after a report navigation attempt', async t => {
  let options, constructions = 0;
  const h = makeHarness({
    ordersGalleryFactory: async value => { options = value; constructions++; return { open() {}, close() {}, destroy() {} }; },
    ordersGalleryDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [] }) }),
    paymentLedgerDataFactory: async () => ({}),
    paymentLedgerFactory: async () => ({ open() {}, close() {}, destroy() {} }),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit('select-reply', { replyId: 'action_orders_gallery' });
  await h.view.emit('open-payment-ledger');
  // The next report has no DOM in this harness, but navigation invalidates old
  // openings before its factory runs. A cached gallery must remain reusable.
  await h.view.emit('navigate-mascot-report', { from: 'open-payment-ledger', direction: 'next' });
  await h.view.emit('select-reply', { replyId: 'action_orders_gallery' });
  assert.equal(constructions, 1, 'the same gallery is reopened');
  const before = h.chatCalls.length;
  await options.onCreate();
  assert.deepEqual(h.chatCalls.slice(before), [['text', {
    text: 'EFETUAR CADASTRO DE PEDIDO (NOTAS PENDENTES)', replyId: 'action_pending_order_registration',
  }]]);
});

test('IDFOLHA shortcut opens its native supplier-month registration without posting', async t => {
  let galleryOptions, createOptions, opens = 0;
  const writes = [];
  const h = makeHarness({
    hrPayrollGalleryDataFactory: async () => ({
      loadPage: async () => ({}), loadPaymentsForPayrollId: async () => [],
      loadSheetOptions: async () => ({ suppliers: [{ id: '9', label: 'Fornecedor' }], month: '2026-10' }),
      saveSheet: async (...args) => { writes.push(args); return { id: '21' }; },
    }),
    hrPayrollGalleryFactory: async options => { galleryOptions = options; return { open() {}, destroy() {} }; },
    payrollSheetCreateFactory: async options => { createOptions = options; return { open() { opens++; }, destroy() {} }; },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit('select-reply', { replyId: 'action_hr_gallery_idfolha' });
  const before = h.chatCalls.length;
  assert.equal(typeof galleryOptions.onCreate, 'function');
  await galleryOptions.onCreate();
  assert.equal(opens, 1);
  assert.equal(h.chatCalls.length, before, 'no invented remote payroll command');
  assert.deepEqual(await createOptions.loadOptions({}), { suppliers: [{ id: '9', label: 'Fornecedor' }], month: '2026-10' });
  assert.deepEqual(writes, [], 'opening a registration never posts a sheet');
  const draft = { supplierId: '9', month: '2026-10' };
  await createOptions.save(draft, { operationId: 'sheet-op' });
  assert.deepEqual(writes, [[draft, { operationId: 'sheet-op' }]]);
  await h.view.emit('sign-out');
  await assert.rejects(createOptions.save(draft, { operationId: 'expired-op' }), /sessão/i);
  assert.equal(writes.length, 1);
});

test('IDFOLHA creation resumes locally after consent and returns to the gallery on close', async t => {
  let options, galleryOpens = 0, destroys = 0;
  const h = makeHarness({
    hrPayrollGalleryDataFactory: async () => ({ loadPage: async () => ({}), loadPaymentsForPayrollId: async () => [],
      loadSheetOptions: async () => ({}), saveSheet: async () => ({}) }),
    hrPayrollGalleryFactory: async () => ({ open() { galleryOpens++; }, destroy() {} }),
    payrollSheetCreateFactory: async value => { options = value; return { open() {}, destroy() { destroys++; } }; },
  });
  h.auth.consumePendingAction = () => 'action_hr_create_idfolha';
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.ok(options);
  assert.ok(h.chatCalls.every(([, payload]) => payload.replyId !== 'action_hr_create_idfolha'),
    'consent resumes the native form, not a remote creation command');
  options.onClose();
  for (let n = 0; n < 20 && !galleryOpens; n++) await new Promise(done => setImmediate(done));
  assert.equal(galleryOpens, 1);
  assert.equal(destroys, 1);
  options.onClose();
  assert.equal(galleryOpens, 1, 'stale close never reopens a gallery');
});

test('IDFOLHA delayed creation factory is destroyed after logout, not opened', async t => {
  let finish, opens = 0, destroys = 0;
  const h = makeHarness({
    hrPayrollGalleryDataFactory: async () => ({}),
    payrollSheetCreateFactory: () => new Promise(resolve => { finish = resolve; }),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const opening = h.view.emit('select-reply', { replyId: 'action_hr_create_idfolha' });
  for (let n = 0; n < 20 && !finish; n++) await new Promise(done => setImmediate(done));
  assert.ok(finish);
  await h.view.emit('sign-out');
  finish({ open() { opens++; }, destroy() { destroys++; } });
  assert.equal(await opening, false);
  assert.equal(opens, 0);
  assert.equal(destroys, 1);
});

test('IDFOLHA delayed creation cannot cover a newer gallery navigation', async t => {
  let finish, opens = 0, destroys = 0;
  const h = makeHarness({
    hrPayrollGalleryDataFactory: async () => ({}),
    payrollSheetCreateFactory: () => new Promise(resolve => { finish = resolve; }),
    ordersGalleryDataFactory: async () => ({ loadSnapshot: async () => ({ rows: [] }) }),
    ordersGalleryFactory: async () => ({ open() {}, destroy() {} }),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const opening = h.view.emit('select-reply', { replyId: 'action_hr_create_idfolha' });
  for (let n = 0; n < 20 && !finish; n++) await new Promise(done => setImmediate(done));
  await h.view.emit('select-reply', { replyId: 'action_orders_gallery' });
  finish({ open() { opens++; }, destroy() { destroys++; } });
  assert.equal(await opening, false);
  assert.equal(opens, 0);
  assert.equal(destroys, 1);
});

test('IDFOLHA default real gallery and composer open through +, never posting on open', async t => {
  const dom = new JSDOM('<main id="app"></main>', { url: 'https://example.test' });
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  let writes = 0;
  const h = makeHarness({
    hrPayrollGalleryDataFactory: async () => ({
      loadPage: async () => ({ gallery: 'IDFOLHA', page: 1, rows: [], hasMore: false }),
      loadPaymentsForPayrollId: async () => [],
      loadSheetOptions: async () => ({ suppliers: [{ id: '7', label: 'Fornecedor demonstrativo' }], defaultMonth: '2026-10' }),
      saveSheet: async () => { writes++; return { id: '21' }; },
    }),
  });
  t.after(() => { h.controller.stop(); globalThis.document = previous; dom.window.close(); });
  await h.controller.start();
  await h.view.emit('select-reply', { replyId: 'action_hr_gallery_idfolha' });
  const add = dom.window.document.querySelector('[data-gallery-create]');
  assert.ok(add); assert.equal(add.disabled, false);
  add.click();
  for (let n = 0; n < 20 && !dom.window.document.querySelector('[data-payroll-sheet-create]'); n++)
    await new Promise(done => setImmediate(done));
  const dialog = dom.window.document.querySelector('[data-payroll-sheet-create]');
  assert.ok(dialog, 'the real default factory opens the native form');
  assert.equal(dialog.querySelector('[name="month"]').value, '2026-10');
  assert.equal(writes, 0);
  dialog.querySelector('[data-sheet-create-cancel]').click();
  for (let n = 0; n < 20 && !dom.window.document.querySelector('[data-gallery-create]'); n++)
    await new Promise(done => setImmediate(done));
  assert.equal(dom.window.document.querySelector('[data-payroll-sheet-create]'), null);
  assert.ok(dom.window.document.querySelector('[data-gallery-create]'));
});

for (const consentRetry of [false, true]) {
  test(`IDFOLHA Graph write held at ${consentRetry ? 'consent retry' : 'silent token'} is blocked after logout`, async t => {
    const { createGraphClient } = await import('../../../portal/data/graph-client.js');
    let createOptions, resolveToken, attempts = 0, writes = 0;
    const h = makeHarness({
      hrPayrollGalleryDataFactory: async ({ tokenProvider }) => {
        const graph = createGraphClient(tokenProvider, { fetch: async () => {
          writes++; return new Response(JSON.stringify({ id: '21' }), { status: 201 });
        } });
        return { loadSheetOptions: async () => ({}), saveSheet: () => graph.request('/sites/test/lists/idfolha/items', {
          method: 'POST', scopes: ['Sites.ReadWrite.All'], body: { fields: { FORNECEDOR: 'Teste' } },
        }) };
      },
      payrollSheetCreateFactory: async options => { createOptions = options; return { open() {}, destroy() {} }; },
    });
    t.after(() => h.controller.stop());
    await h.controller.start();
    await h.view.emit('select-reply', { replyId: 'action_hr_create_idfolha' });
    h.auth.authorize = async () => {};
    h.auth.getToken = () => {
      if (consentRetry && attempts++ === 0) return Promise.reject(Object.assign(new Error('Autorize'), { code: 'AUTH_REQUIRED' }));
      return new Promise(resolve => { resolveToken = resolve; });
    };
    const pending = createOptions.save({}, {});
    const rejected = assert.rejects(pending, /sessão.*encerrada/i);
    for (let n = 0; n < 20 && !resolveToken; n++) await new Promise(done => setImmediate(done));
    assert.ok(resolveToken);
    await h.view.emit('sign-out');
    resolveToken('old-token');
    await rejected;
    assert.equal(writes, 0, 'no fetch POST after expired session');
  });
}

test('real IDFOLHA Cancel and reopen cannot repeat an uncertain committed POST', async t => {
  const { createSharePointRepository } = await import('../../../portal/data/sharepoint-repository.js');
  const { createHrPayrollGalleryData } = await import('../src/chat/orders-gallery-data.js');
  const dom = new JSDOM('<main></main>', { url: 'https://example.test' });
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  const rows = { suppliers: [{ id: '7', fields: { Title: 'Fornecedor teste' } }], sheets: [] };
  let writes = 0;
  const graph = { async request(path, options = {}) {
    const url = new URL(path, 'https://graph.microsoft.com/v1.0/');
    const m = url.pathname.match(/\/lists\/(suppliers|sheets)\/(columns|items)(?:\/([^/]+))?$/);
    if (m) {
      const [, list, resource, id] = m;
      if (resource === 'columns') return { value: list === 'suppliers'
        ? [{ name: 'Title', displayName: 'CADASTRO', text: {} }]
        : [{ name: 'Title', displayName: 'Title', text: {} }, { name: 'FORNECEDOR', displayName: 'FORNECEDOR', text: {} },
          { name: 'MESREFERENCIA', displayName: 'MESREFERENCIA', text: {} }, { name: 'STATUS', displayName: 'STATUS', text: {} }] };
      if (options.method === 'POST') {
        assert.equal(list, 'sheets'); writes++;
        rows.sheets.push({ id: String(100 + writes), fields: structuredClone(options.body.fields) });
        throw new Error('Resposta perdida após cadastro');
      }
      if (id) return structuredClone(rows[list].find(row => row.id === id));
      return { value: list === 'sheets' ? [] : structuredClone(rows[list]) };
    }
    if (url.pathname.endsWith('/lists')) return { value: [
      { id: 'suppliers', displayName: 'FORNECEDORES', list: { template: 'genericList' } },
      { id: 'sheets', displayName: 'IDFOLHA', list: { template: 'genericList' } },
    ] };
    return { id: 'site-id' };
  } };
  const repository = createSharePointRepository(graph, { personal: { host: 'tenant.sharepoint.com', path: '/sites/test' } });
  const h = makeHarness({ hrPayrollGalleryDataFactory: async options =>
    createHrPayrollGalleryData({ ...options, repository, now: () => new Date('2026-10-07T12:00:00Z') }) });
  t.after(() => { h.controller.stop(); globalThis.document = previousDocument; dom.window.close(); });
  const settleUntil = async predicate => {
    for (let n = 0; n < 60 && !predicate(); n++) await new Promise(done => setImmediate(done));
    assert.ok(predicate());
  };
  await h.controller.start();
  await h.view.emit('select-reply', { replyId: 'action_hr_gallery_idfolha' });
  for (let iteration = 0; iteration < 2; iteration++) {
    await settleUntil(() => dom.window.document.querySelector('[data-gallery-create]')?.disabled === false);
    dom.window.document.querySelector('[data-gallery-create]').click();
    await settleUntil(() => dom.window.document.querySelector('[data-payroll-sheet-create] [name="supplierId"]'));
    const form = dom.window.document.querySelector('[data-payroll-sheet-create] form');
    form.querySelector('[name="supplierId"]').value = '7';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await settleUntil(() => dom.window.document.querySelector('[data-payroll-sheet-create] [role="alert"]:not([hidden])'));
    assert.equal(writes, 1, 'the same supplier/month is not posted again after Cancel and reopen');
    dom.window.document.querySelector('[data-sheet-create-cancel]').click();
  }
});

test("ação aposentada de relatórios não abre tela nem envia comando à VM", async t => {
  let opens = 0;
  const h = makeHarness({ contractorReportsFactory: async () => ({ open() { opens++; }, destroy() {} }) });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;
  await h.view.emit("select-reply", { replyId: "action_contractor_reports", label: "RELATÓRIOS" });
  assert.equal(opens, 0);
  assert.equal(h.chatCalls.length, before);
});

test("consentimento antigo de relatórios não ressuscita o hub ao iniciar", async t => {
  let opens = 0;
  const h = makeHarness({ contractorReportsFactory: async () => ({ open() { opens++; }, destroy() {} }) });
  h.auth.consumePendingAction = () => "action_contractor_reports";
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(opens, 0);
});

test('home payment shortcut uses authenticated SharePoint session, stays local and disposes on logout', async t => {
  let opens = 0, destroys = 0, token;
  const h = makeHarness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => ({ async loadPaymentsSnapshot() { token = await tokenProvider(['Sites.Read.All']); return { launches: [] }; } }),
    paymentLedgerFactory: async ({ data }) => ({ async open() { opens++; await data.loadPaymentsSnapshot(); }, destroy() { destroys++; } }),
  });
  t.after(() => h.controller.stop());
  await h.controller.start(); const before = h.chatCalls.length;
  await Promise.all([h.view.emit('open-payment-ledger'), h.view.emit('open-payment-ledger')]);
  assert.equal(opens, 1); assert.equal(token, 'token'); assert.equal(h.chatCalls.length, before);
  await h.view.emit('sign-out'); assert.equal(destroys, 1);
});

test('payment report factory response after stop cannot resurrect an overlay', async t => {
  let finish, opens = 0, destroys = 0;
  const h = makeHarness({ paymentLedgerDataFactory: async () => ({}), paymentLedgerFactory: () => new Promise(done => { finish = done; }) });
  t.after(() => h.controller.stop()); await h.controller.start();
  const pending = h.view.emit('open-payment-ledger'); await new Promise(done => setImmediate(done));
  h.controller.stop(); finish({ open() { opens++; }, destroy() { destroys++; } }); await pending;
  assert.equal(opens, 0); assert.equal(destroys, 1);
});

test('late AUTH_REQUIRED after logout cannot start report authorization', async t => {
  let rejectToken, authorizations = 0;
  const h = makeHarness({
    paymentLedgerDataFactory: async ({ tokenProvider }) => ({ loadPaymentsSnapshot: () => tokenProvider(['Sites.Read.All']) }),
    paymentLedgerFactory: async ({ data }) => ({ open: () => data.loadPaymentsSnapshot(), destroy() {} }),
  });
  t.after(() => h.controller.stop()); await h.controller.start();
  h.auth.getToken = () => new Promise((_, reject) => { rejectToken = reject; });
  h.auth.authorize = async () => { authorizations++; };
  const pending = h.view.emit('open-payment-ledger'); await new Promise(r => setImmediate(r));
  await h.view.emit('sign-out'); rejectToken(Object.assign(new Error('Expired'), { code: 'AUTH_REQUIRED' }));
  await pending; assert.equal(authorizations, 0);
});

test("Galeria Programação de Pagamentos consulta SharePoint autenticado, abre anexos e permanece local", async t => {
  let callbacks;
  let opens = 0;
  let requestedScopes;
  let previewItems;
  let previewOptions;
  const h = makeHarness({
    paymentProgrammingGalleryFactory: async options => {
      callbacks = options;
      return { async open() { opens++; }, destroy() {} };
    },
    paymentProgrammingGalleryDataFactory: async ({ tokenProvider }) => ({
      async loadSnapshot() { return { rows: [], token: await tokenProvider(["Sites.Read.All"]) }; },
      async listAttachments() { return [{ fileName: "nota.pdf" }]; },
      async downloadAttachment() { return new Blob(["pdf"], { type: "application/pdf" }); },
    }),
  });
  h.auth.getToken = async scopes => { requestedScopes = scopes; return "sharepoint-token"; };
  h.native.previewMediaCollection = async (items, options) => { previewItems = items; previewOptions = options; };
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;

  await h.view.emit("select-reply", { replyId: "action_payment_programming_gallery", label: "GAL. PGTOS PREVISTOS" });

  assert.equal(opens, 1);
  assert.equal(h.chatCalls.length, before);
  assert.equal((await callbacks.data.loadSnapshot()).token, "sharepoint-token");
  assert.deepEqual(requestedScopes, ["Sites.Read.All"]);
  await callbacks.openMediaCollection([{ fileName: "nota.pdf", source: Promise.resolve(new Blob(["pdf"])) }]);
  assert.equal(previewItems.length, 1);
  assert.equal(previewItems[0].fileName, "nota.pdf");
  assert.equal(typeof previewOptions.onAddToTray, "function");
});

test("Galeria Despesas Recorrentes consulta SharePoint e abre localmente pelo menu de Suprimentos", async t => {
  let callbacks;
  let opens = 0;
  let destroyed = 0;
  let requestedScopes;
  let previewItems;
  let previewOptions;
  const h = makeHarness({
    recurringExpensesGalleryFactory: async options => {
      callbacks = options;
      return { async open() { opens++; }, destroy() { destroyed++; } };
    },
    recurringExpensesGalleryDataFactory: async ({ tokenProvider }) => ({
      async loadSnapshot() { return { rows: [], token: await tokenProvider(["Sites.Read.All"]) }; },
      async listAttachments() { return [{ fileName: "conta.pdf" }]; },
      async downloadAttachment() { return new Blob(["pdf"], { type: "application/pdf" }); },
    }),
  });
  h.auth.getToken = async scopes => { requestedScopes = scopes; return "sharepoint-token"; };
  h.native.previewMediaCollection = async (items, options) => { previewItems = items; previewOptions = options; };
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;

  await h.view.emit("select-reply", { replyId: "action_recurring_expenses_gallery", label: "GAL. DESPESAS RECORRENTES" });

  assert.equal(opens, 1);
  assert.equal(h.chatCalls.length, before);
  assert.equal((await callbacks.data.loadSnapshot()).token, "sharepoint-token");
  assert.deepEqual(requestedScopes, ["Sites.Read.All"]);
  await callbacks.openMediaCollection([{ fileName: "conta.pdf", source: Promise.resolve(new Blob(["pdf"])) }]);
  assert.equal(previewItems.length, 1);
  assert.equal(previewItems[0].fileName, "conta.pdf");
  assert.equal(typeof previewOptions.onAddToTray, "function");

  await h.view.emit("sign-out");
  assert.equal(destroyed, 1);
});

test("Galeria Despesas Recorrentes retoma após o consentimento Microsoft do SharePoint", async t => {
  let opens = 0;
  const h = makeHarness({
    recurringExpensesGalleryFactory: async () => ({ async open() { opens++; }, destroy() {} }),
    recurringExpensesGalleryDataFactory: async () => ({}),
  });
  h.auth.consumePendingAction = () => "action_recurring_expenses_gallery";
  t.after(() => h.controller.stop());

  await h.controller.start();

  assert.equal(opens, 1);
});

test("Galeria Programação de Pagamentos retoma após o consentimento Microsoft do SharePoint", async t => {
  let opens = 0;
  const h = makeHarness({
    paymentProgrammingGalleryFactory: async () => ({ async open() { opens++; }, destroy() {} }),
    paymentProgrammingGalleryDataFactory: async () => ({}),
  });
  h.auth.consumePendingAction = () => "action_payment_programming_gallery";
  t.after(() => h.controller.stop());

  await h.controller.start();

  assert.equal(opens, 1);
});

test("sair da conta destrói a Galeria Programação de Pagamentos", async t => {
  let destroyed = 0;
  const h = makeHarness({
    paymentProgrammingGalleryFactory: async () => ({ async open() {}, destroy() { destroyed++; } }),
    paymentProgrammingGalleryDataFactory: async () => ({}),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("select-reply", { replyId: "action_payment_programming_gallery" });

  await h.view.emit("sign-out");

  assert.equal(destroyed, 1);
});

test("sair da conta invalida consulta em andamento e fecha galeria", async t => {
  let callbacks;
  let destroyed = 0;
  const response = deferred();
  const h = makeHarness({ launchGalleryFactory: async options => {
    callbacks = options;
    return { open() {}, destroy() { destroyed++; } };
  } });
  h.client.launchGalleryRequest = () => response.promise;
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("select-reply", { replyId: "action_launch_gallery" });
  const query = callbacks.request("snapshot", {});
  const rejection = assert.rejects(query, /sessão.*encerrada/);
  await h.view.emit("sign-out");
  response.resolve({ rows: [{ id: "secret" }] });
  await rejection;
  assert.equal(destroyed, 1);
});

test("filtro de banco é automático, preserva a digitação e limpa ao selecionar", async t => {
  const h = makeHarness({ databaseFilterDebounceMs: 1 });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS" };
  const filterPoll = options => ({
    type: "poll",
    question: "QUAL O PRODUTO?",
    databaseFilter: true,
    databaseFilterKey: "document_signing_payment_product",
    options,
  });
  h.store.ingestRemoteMessages([
    filterPoll([{ id: "3", label: "ARGAMASSA", reply: "3" }]),
  ], { activeFlow });
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    if (payload.replyId === "filter_query") {
      return {
        status: "processed",
        activeFlow,
        messages: [filterPoll([{ id: "5", label: "AREIA MÉDIA", reply: "5" }])],
      };
    }
    return {
      status: "processed",
      activeFlow,
      messages: [{ type: "text", text: "PRODUTO SELECIONADO" }],
    };
  };

  await h.view.emit("draft-changed", { value: "are" });
  await h.view.emit("database-filter-changed", {
    value: "are",
    filterKey: "document_signing_payment_product",
  });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(payloads[0].text, "are");
  assert.equal(payloads[0].replyId, "filter_query");
  assert.equal(h.store.getState().draft, "are");
  assert.equal(h.store.getState().messages.filter(message => message.role === "user").length, 0);
  assert.equal(h.store.getState().messages.at(-1).options[0].label, "AREIA MÉDIA");

  await h.view.emit("draft-changed", { value: "areia" });
  await h.view.emit("database-filter-changed", {
    value: "areia",
    filterKey: "document_signing_payment_product",
  });
  await h.view.emit("select-reply", { replyId: "5", label: "AREIA MÉDIA" });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(payloads.slice(1), [{ text: "AREIA MÉDIA", replyId: "5" }]);
  assert.equal(h.store.getState().draft, "");
});

test("filtro remoto mantém CADASTRAR NOVO quando o servidor devolve zero opções", async t => {
  const h = makeHarness({ databaseFilterDebounceMs: 1 });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "supply_supplier_registration", title: "CADASTRAR FORNECEDOR" };
  const registration = { id: "register_supplier", label: "➕ CADASTRAR NOVO FORNECEDOR", reply: "register_supplier" };
  const filterPoll = (options, question = "QUAL FORNECEDOR?") => ({
    type: "poll",
    question,
    databaseFilter: true,
    databaseFilterKey: "supplier",
    options,
  });
  h.store.ingestRemoteMessages([filterPoll([
    { id: "supplier:17", label: "17 - WILLIAM SILVA", reply: "17" },
    registration,
  ])], { activeFlow });
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    if (payload.replyId === "register_supplier") {
      return {
        status: "processed",
        activeFlow,
        messages: [{ type: "poll", question: "QUAL É A RAZÃO SOCIAL DO FORNECEDOR?", options: [] }],
      };
    }
    const options = payload.text === "Swi" ? [] : [
      { id: "supplier:19", label: "19 - SWIFT MATERIAIS", reply: "19" },
      { ...registration },
    ];
    const question = payload.text === "Swi"
      ? "NENHUMA OPÇÃO CORRESPONDENTE FOI ENCONTRADA. DIGITE OUTRO TEXTO OU CADASTRE UM FORNECEDOR."
      : "QUAL FORNECEDOR?";
    return { status: "processed", activeFlow, messages: [filterPoll(options, question)] };
  };

  await h.view.emit("draft-changed", { value: "Swi" });
  await h.view.emit("database-filter-changed", { value: "Swi", filterKey: "supplier" });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(payloads, [{ text: "Swi", replyId: "filter_query" }]);
  assert.match(h.store.getState().messages.at(-1).question, /NENHUMA OPÇÃO CORRESPONDENTE/);
  assert.deepEqual(h.store.getState().messages.at(-1).options.map(option => option.reply), ["register_supplier"]);

  await h.view.emit("draft-changed", { value: "Swift" });
  await h.view.emit("database-filter-changed", { value: "Swift", filterKey: "supplier" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.store.getState().messages.at(-1).options.filter(option => option.reply === "register_supplier").length, 1);
  assert.deepEqual(h.store.getState().messages.at(-1).options.map(option => option.reply), ["19", "register_supplier"]);

  await h.view.emit("draft-changed", { value: "Swift Materiais LTDA" });
  await h.view.emit("database-filter-changed", { value: "Swift Materiais LTDA", filterKey: "supplier" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(payloads.length, 2, "consultas com mais de duas palavras continuam aguardando envio manual");
  await h.view.emit("send-text", {});
  assert.deepEqual(payloads.at(-1), { text: "Swift Materiais LTDA", replyId: "filter_query" });
  assert.equal(h.store.getState().messages.at(-1).options.filter(option => option.reply === "register_supplier").length, 1);

  await h.view.emit("select-reply", { replyId: "register_supplier", label: registration.label });
  assert.equal(h.store.getState().messages.at(-1).question, "QUAL É A RAZÃO SOCIAL DO FORNECEDOR?");
  assert.deepEqual(h.store.getState().messages.at(-1).options, []);
});

async function waitForSupplierGrouping(predicate) {
  for (let attempt = 0; attempt < 50 && !predicate(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), 'o agrupamento deve concluir a atualização esperada');
}

async function supplierGroupingHarness(t) {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const h = makeHarness({ view: createChatView(root), historyMode: 'current-step', databaseFilterDebounceMs: 1 });
  t.after(() => { h.controller.stop(); dom.window.close(); });
  await h.controller.start();
  const activeFlow = { id: 'launch', title: 'LANÇAMENTOS MÚLTIPLOS' };
  const registration = { id: 'register_supplier', reply: 'register_supplier', label: '➕ CADASTRAR FORNECEDOR', registrationAction: true };
  const initialSupplier = { id: '1', reply: '1', label: '1 - FORNECEDOR DAS LINHAS' };
  const poll = options => ({
    type: 'poll', question: 'QUAL FORNECEDOR DEVE AGRUPAR O NOVO PEDIDO?',
    databaseFilter: true, databaseFilterKey: 'fornecedor_agrupador_lancamento', options,
  });
  const response = options => ({ status: 'processed', activeFlow, messages: [poll(options)] });
  h.store.ingestRemoteMessages([poll([initialSupplier, registration])], { activeFlow });
  const input = value => {
    const draft = root.querySelector('[data-role="draft"]');
    draft.value = value;
    draft.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  return { ...h, root, input, response, registration, initialSupplier, activeFlow };
}

test('agrupamento remoto pesquisa nome completo fora das linhas e seleciona o fornecedor sem alterar a resposta', async t => {
  const h = await supplierGroupingHarness(t);
  const supplier = { id: 'choice:fornecedor_agrupador_lancamento:804', reply: '804', label: '804 - JOSÉ GERALDO DOS SANTOS' };
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    if (payload.replyId === 'filter_query') return h.response([supplier]);
    return { status: 'processed', activeFlow: h.activeFlow, messages: [{ type: 'poll', question: 'QUAL A DATA?', options: [] }] };
  };
  h.input('Jose Geraldo dos Santos');
  await waitForSupplierGrouping(() => payloads.length === 1 && !h.store.getState().activeText);
  assert.deepEqual(payloads, [{ text: 'Jose Geraldo dos Santos', replyId: 'filter_query' }]);
  assert.equal(h.store.getState().draft, 'Jose Geraldo dos Santos');
  assert.equal(h.store.getState().messages.some(message => message.role === 'user'), false);
  assert.deepEqual(h.store.getState().messages.at(-1).options, [supplier, h.registration]);
  const button = h.root.querySelector(`[data-reply-id="${supplier.id}"]`);
  assert.ok(button, 'o fornecedor retornado pelo backend deve estar visível');
  h.input('Outra empresa de materiais');
  h.root.querySelector(`[data-reply-id="${supplier.id}"]`).click();
  await waitForSupplierGrouping(() => payloads.length === 2 && !h.store.getState().activeText);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(payloads, [
    { text: 'Jose Geraldo dos Santos', replyId: 'filter_query' },
    { text: '804 - JOSÉ GERALDO DOS SANTOS', replyId: 'choice:fornecedor_agrupador_lancamento:804' },
  ]);
  assert.equal(h.store.getState().draft, '');
  assert.equal(h.root.querySelector('[data-role="draft"]').dataset.databaseFilterKey, undefined);
});

test('agrupamento remoto preserva cadastro com zero resultados e abre a pergunta existente do wizard', async t => {
  const h = await supplierGroupingHarness(t);
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    if (payload.replyId === 'filter_query') return h.response(payloads.length === 1 ? [] : [{ ...h.registration }]);
    return { status: 'processed', activeFlow: { id: 'supply_supplier_registration' },
      messages: [{ type: 'poll', question: 'QUAL É A RAZÃO SOCIAL DO FORNECEDOR?', options: [] }] };
  };
  for (const value of ['Empresa nova sem cadastro', 'Outra empresa sem cadastro']) {
    h.input(value);
    await waitForSupplierGrouping(() => payloads.at(-1)?.text === value && !h.store.getState().activeText);
    assert.deepEqual(h.store.getState().messages.at(-1).options, [h.registration]);
    assert.equal(h.root.querySelectorAll('[data-reply-id="register_supplier"]').length, 1);
  }
  h.root.querySelector('[data-reply-id="register_supplier"]').click();
  await waitForSupplierGrouping(() => h.store.getState().messages.at(-1)?.question === 'QUAL É A RAZÃO SOCIAL DO FORNECEDOR?');
  assert.deepEqual(payloads, [
    { text: 'Empresa nova sem cadastro', replyId: 'filter_query' },
    { text: 'Outra empresa sem cadastro', replyId: 'filter_query' },
    { text: '➕ CADASTRAR FORNECEDOR', replyId: 'register_supplier' },
  ]);
  assert.deepEqual(h.store.getState().messages.at(-1).options, []);
  assert.equal(h.store.getState().draft, '');
  assert.equal(h.root.querySelector('[data-role="draft"]').dataset.databaseFilterKey, undefined);
});

test('agrupamento remoto aplica a última revisão do nome e limpa a busca durante respostas pendentes', async t => {
  const h = await supplierGroupingHarness(t);
  const first = deferred(), second = deferred();
  t.after(() => { first.resolve(h.response([])); second.resolve(h.response([])); });
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    if (payload.replyId === 'filter_clear') return h.response([h.initialSupplier]);
    return payloads.length === 1 ? first.promise : second.promise;
  };
  h.input('Jose Geraldo dos Santos');
  await waitForSupplierGrouping(() => payloads.length === 1);
  h.input('Maria Silva');
  h.input('Maria Silva de Souza');
  first.resolve(h.response([{ id: '804', reply: '804', label: '804 - JOSÉ GERALDO DOS SANTOS' }]));
  await waitForSupplierGrouping(() => payloads.length === 2);
  assert.deepEqual(payloads, [
    { text: 'Jose Geraldo dos Santos', replyId: 'filter_query' },
    { text: 'Maria Silva de Souza', replyId: 'filter_query' },
  ]);
  assert.equal(h.store.getState().draft, 'Maria Silva de Souza');
  h.input('');
  second.resolve(h.response([{ id: '805', reply: '805', label: '805 - MARIA SILVA DE SOUZA' }]));
  await waitForSupplierGrouping(() => payloads.length === 3 && !h.store.getState().activeText);
  assert.deepEqual(payloads.at(-1), { text: 'Limpar filtro', replyId: 'filter_clear' });
  assert.equal(h.store.getState().draft, '');
  assert.deepEqual(h.store.getState().messages.at(-1).options, [h.initialSupplier, h.registration]);
  assert.ok(h.root.querySelector('[data-reply-id="1"]'));
  assert.equal(h.root.querySelector('[data-reply-id="805"]'), null);
  h.input('Maria Silva de Souza');
  await waitForSupplierGrouping(() => payloads.length === 4 && !h.store.getState().activeText);
  assert.deepEqual(payloads.at(-1), { text: 'Maria Silva de Souza', replyId: 'filter_query' });
  h.input('Maria Silva de Souza');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(payloads.length, 4, 'a mesma consulta concluída não deve ser enviada outra vez');
});

test("texto digitado em pesquisa numérica nunca escolhe ID; somente o botão seleciona", async t => {
  const h = makeHarness({ databaseFilterDebounceMs: 1 });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "payment_provision", title: "CRIAR UMA PROVISÃO DE PAGAMENTO" };
  const poll = (key, options) => ({
    type: "poll", question: key === "product" ? "QUAL PRODUTO?" : "QUAL FILIAL?",
    databaseFilter: true, databaseFilterKey: key, options,
  });
  h.store.ingestRemoteMessages([poll("product", [{ id: "8", reply: "8", label: "8 - OUTRO PRODUTO" }])], { activeFlow });
  const payloads = [];
  let currentKey = "product";
  h.client.sendText = async payload => {
    payloads.push(payload);
    return {
      status: "processed", activeFlow,
      messages: [poll(currentKey, [
        { id: "8", reply: "8", label: "8 - OUTRO PRODUTO" },
        { id: "657", reply: "657", label: "657 - VERGALHÃO 8MM" },
        { id: "4", reply: "4", label: "4 - 004 - EDIFÍCIO XAVANTE" },
      ])],
    };
  };
  for (const value of ["8", "8mm"]) {
    await h.view.emit("draft-changed", { value });
    await h.view.emit("database-filter-changed", { value, filterKey: "product" });
    for (let attempt = 0; attempt < 30 && payloads.at(-1)?.text !== value; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.deepEqual(payloads.at(-1), { text: value, replyId: "filter_query" });
    assert.equal(h.store.getState().activeFlow.id, "payment_provision");
  }
  currentKey = "branch";
  h.store.ingestRemoteMessages([poll("branch", [{ id: "0", reply: "0", label: "0 - OUTRA FILIAL" }])], { activeFlow });
  for (const value of ["0", "004"]) {
    await h.view.emit("draft-changed", { value });
    await h.view.emit("database-filter-changed", { value, filterKey: "branch" });
    for (let attempt = 0; attempt < 30 && payloads.at(-1)?.text !== value; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.deepEqual(payloads.at(-1), { text: value, replyId: "filter_query" });
  }
  await h.view.emit("select-reply", { replyId: "4", label: "4 - 004 - EDIFÍCIO XAVANTE" });
  assert.deepEqual(payloads.at(-1), { text: "4 - 004 - EDIFÍCIO XAVANTE", replyId: "4" });
});

test("após validar uma presença mostra primeiro somente o mesmo dia e oferece outras datas", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "presence_validation", title: "VALIDAR PRESENÇAS APONTADAS" };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "👷 VALIDAR PRESENÇA\\nSELECIONE PRESENTE, AUSENTE OU EDITAR.",
    detail_table: {
      kind: "presence",
      rows: [[{ label: "DATA", value: "12/09/2026" }]],
    },
    options: [{ id: "present", reply: "present", label: "✅ PRESENTE" }],
  }], { activeFlow });
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    return {
      status: "processed",
      activeFlow,
      messages: [
        { type: "text", text: "✅ PRESENÇA ATUALIZADA NA BASE DE DADOS" },
        {
          type: "poll",
          presentation: "accordion",
          question: "OS SEGUINTES ITENS AINDA ESTÃO PENDENTES DE VALIDAÇÃO DE PRESENÇA.",
          options: [
            { id: "12", reply: "12", label: "12 - PESSOA DOZE (12/09/2026)" },
            { id: "19", reply: "19", label: "19 - PESSOA DEZENOVE (19/09/2026)" },
          ],
        },
      ],
    };
  };

  await h.view.emit("select-reply", { replyId: "present", label: "✅ PRESENTE" });

  let poll = h.store.getState().messages.at(-1);
  assert.deepEqual(poll.options.map(option => option.label), [
    "12 - PESSOA DOZE (12/09/2026)",
    "📅 VER OUTRAS DATAS",
  ]);
  assert.equal(payloads.length, 1);

  await h.view.emit("select-reply", {
    replyId: "presence_other_dates",
    label: "📅 VER OUTRAS DATAS",
  });

  poll = h.store.getState().messages.at(-1);
  assert.deepEqual(poll.options.map(option => option.label), [
    "12 - PESSOA DOZE (12/09/2026)",
    "19 - PESSOA DEZENOVE (19/09/2026)",
  ]);
  assert.equal(payloads.length, 1);
});

test('atalho de presenças de hoje encaminha uma navegação e mantém os nomes de hoje após data histórica', async t => {
  const h=makeHarness({historyMode:'current-step'});
  t.after(()=>h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{type:'poll',question:'CONFIRMA A PRESENÇA?',
    detail_table:{kind:'presence',rows:[[{label:'DATA',value:'12/10/2026'}]]},options:[{id:'present',label:'PRESENTE'}]}],
    {activeFlow:{id:'attendance_validation'}});
  h.client.sendText=async()=>({status:'processed',messages:[]});
  await h.view.emit('select-reply',{replyId:'present',label:'PRESENTE'});
  h.store.ingestRemoteMessages([{type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',
    options:[{id:'start_today_pending_attendance',reply:'start_today_pending_attendance',label:'👷 PRESENÇAS (1)',tone:'danger'}]}],
    {activeFlow:null,resetConversation:true});
  const payloads=[];
  h.client.sendText=async payload=>{
    payloads.push(payload);
    return {status:'awaiting_input',activeFlow:{id:'attendance_validation'},messages:[{
      type:'poll',presentation:'attendance_multi_select',question:'QUAL PRESENÇA DESEJA VALIDAR?',
      options:[{id:'choice:registro_presenca_pendente:2249',reply:'choice:registro_presenca_pendente:2249',label:'2249 - TESTE',date:'2026-10-13',name:'TESTE'}],
    }]};
  };
  await h.view.emit('select-reply',{replyId:'start_today_pending_attendance',label:'👷 PRESENÇAS (1)'});
  assert.deepEqual(payloads.map(p=>p.replyId),['start_today_pending_attendance']);
  assert.deepEqual(h.store.getState().messages.at(-1).options.map(o=>o.reply),['choice:registro_presenca_pendente:2249']);
});

test("avaliar outra data em Pendências não reaplica o dia da presença anterior", async t => {
  const h = makeHarness({ historyMode: 'current-step' });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: 'attendance_validation', title: 'VALIDAR PRESENÇAS APONTADAS' };
  h.store.ingestRemoteMessages([{
    type: 'poll', question: 'CONFIRMA A PRESENÇA?',
    detail_table: { kind: 'presence', rows: [[{ label: 'DATA', value: '09/10/2026' }]] },
    options: [{ id: 'present', reply: 'present', label: 'PRESENTE' }],
  }], { activeFlow });
  const otherDate = { id: 'pending_attendance_other_date', reply: 'pending_attendance_other_date', label: '📅 AVALIAR OUTRA DATA' };
  const checklist = (date, options) => ({ type: 'poll', presentation: 'attendance_multi_select',
    question: `PRESENÇAS PENDENTES DE ${date}`, options });
  const option = (id, date) => ({ id: `pending_attendance_record:${id}`, reply: `pending_attendance_record:${id}`,
    label: `${id} - EXEMPLO`, source_values: { Id: id, DATA: date } });
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    const messages = payload.replyId === 'present'
      ? [checklist('09/10/2026', [option('2229', '2026-10-09'), option('2219', '2026-10-08'), otherDate])]
      : payload.replyId === 'pending_attendance_other_date'
        ? [{ type: 'poll', question: 'QUAL DATA?', options: [{ id: 'pending_attendance_date:1', label: '08/10/2026' }] }]
        : [checklist('08/10/2026', [option('2219', '2026-10-08'), otherDate])];
    return { status: 'processed', activeFlow, messages };
  };
  await h.view.emit('select-reply', { replyId: 'present', label: 'PRESENTE' });
  assert.deepEqual(h.store.getState().messages.at(-1).options.map(o => o.id), ['pending_attendance_record:2229', 'pending_attendance_other_date']);
  await h.view.emit('select-reply', { replyId: 'pending_attendance_other_date', label: otherDate.label });
  await h.view.emit('select-reply', { replyId: 'pending_attendance_date:1', label: '08/10/2026' });
  assert.deepEqual(h.store.getState().messages.at(-1).options.map(o => o.id), ['pending_attendance_record:2219', 'pending_attendance_other_date']);
  assert.deepEqual(payloads.map(p => p.replyId), ['present', 'pending_attendance_other_date', 'pending_attendance_date:1']);
});

test('novo dia após esgotar presenças de Pendências não herda o filtro anterior', async t => {
  const h = makeHarness({ historyMode: 'current-step' });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: 'attendance_validation', title: 'VALIDAR PRESENÇAS APONTADAS' };
  h.store.ingestRemoteMessages([{
    type: 'poll', question: 'CONFIRMA A PRESENÇA?',
    detail_table: { kind: 'presence', rows: [[{ label: 'DATA', value: '09/10/2026' }]] },
    options: [{ id: 'present', reply: 'present', label: 'PRESENTE' }],
  }], { activeFlow });
  const dayControl = { id: 'pending_attendance_other_date', reply: 'pending_attendance_other_date', label: '📅 AVALIAR OUTRA DATA' };
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    return { status: 'processed', activeFlow, messages: payload.replyId === 'present'
      ? [{ type: 'text', text: 'NÃO HÁ OUTRAS PRESENÇAS PENDENTES NESTA DATA.' },
        { type: 'poll', question: 'QUAL DATA DE PRESENÇA DESEJA VALIDAR?',
          options: [{ id: 'pending_attendance_date:1', reply: 'pending_attendance_date:1', label: '08/10/2026' }] }]
      : [{ type: 'poll', presentation: 'attendance_multi_select', question: 'PRESENÇAS PENDENTES DE 08/10/2026',
        options: [
          { id: 'pending_attendance_record:2219', reply: 'pending_attendance_record:2219', label: '2219 - EXEMPLO', source_values: { DATA: '2026-10-08' } },
          { id: 'pending_attendance_record:2229', reply: 'pending_attendance_record:2229', label: '2229 - EXEMPLO', source_values: { DATA: '2026-10-09' } },
          dayControl,
        ] }],
    };
  };
  await h.view.emit('select-reply', { replyId: 'present', label: 'PRESENTE' });
  await h.view.emit('select-reply', { replyId: 'pending_attendance_date:1', label: '08/10/2026' });
  const poll = h.store.getState().messages.at(-1);
  assert.equal(poll.presenceDateKey, '2026-10-08');
  assert.deepEqual(poll.options.map(o => o.reply), ['pending_attendance_record:2219', 'pending_attendance_other_date']);
  assert.deepEqual(payloads.map(p => p.replyId), ['present', 'pending_attendance_date:1']);
});

test("mantém anexos transferidos visíveis nos menus até entrar no próximo fluxo", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();

  const originalFlow = { id: "document", title: "ADICIONAR UM NOVO DOCUMENTO", contextId: "ctx-transfer" };
  const nextFlow = { id: "launch", title: "EFETUAR LANÇAMENTO", contextId: "ctx-next" };
  const attachment = {
    id: "carried-file",
    fileName: "foto-da-obra.jpg",
    mimeType: "image/jpeg",
    size: 512,
    mediaUrl: "/api/portal-media/carried-file",
  };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "ADICIONAR DOCUMENTO",
    options: [],
  }], { activeFlow: originalFlow });
  h.store.syncAttachments([attachment]);

  h.client.sendText = async payload => {
    if (payload.replyId === "portal_transfer_attachments") {
      return {
        status: "processed",
        activeFlow: originalFlow,
        messages: [{
          type: "poll",
          question: "TRANSFERIR ANEXOS PARA O MENU PRINCIPAL?",
          options: [{ id: "confirm-transfer", reply: "confirm-transfer", label: "SIM, TRANSFERIR" }],
        }],
      };
    }
    if (payload.replyId === "confirm-transfer") {
      return {
        status: "processed",
        activeFlow: originalFlow,
        attachments: [],
        messages: [
          { type: "text", text: "OS DADOS DO FLUXO FORAM ELIMINADOS. OS ANEXOS FORAM TRANSFERIDOS PARA O PRÓXIMO FLUXO." },
          {
            type: "poll",
            question: "TRANSFERÊNCIA CONCLUÍDA",
            options: [{ id: "transfer-finished-to-menu", reply: "transfer-finished-to-menu", label: "IR AO MENU PRINCIPAL" }],
          },
        ],
      };
    }
    if (payload.replyId === "transfer-finished-to-menu") {
      return {
        status: "processed",
        returned_to_main_menu: true,
        resetConversation: true,
        activeFlow: null,
        attachments: [],
        messages: [{
          type: "poll",
          question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?",
          options: [{ id: "supplies", reply: "supplies", label: "SUPRIMENTOS" }],
        }],
      };
    }
    if (payload.replyId === "supplies") {
      return {
        status: "processed",
        stage: "choosing_group",
        resetConversation: true,
        activeFlow: null,
        attachments: [],
        messages: [{
          type: "poll",
          question: "SUPRIMENTOS — QUAL FLUXO DESEJA INICIAR?",
          options: [{ id: "launches", reply: "launches", label: "LANÇAMENTOS" }],
        }],
      };
    }
    return {
      status: "processed",
      activeFlow: nextFlow,
      attachments: [],
      messages: [{ type: "poll", question: "QUAL OPERAÇÃO DE LANÇAMENTO?", options: [] }],
    };
  };

  await h.view.emit("transfer-attachments");
  await h.view.emit("select-reply", { replyId: "confirm-transfer", label: "SIM, TRANSFERIR" });
  assert.equal(h.store.getState().attachments.length, 1);
  assert.match(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(1\)/);

  await h.view.emit("select-reply", { replyId: "transfer-finished-to-menu", label: "IR AO MENU PRINCIPAL" });

  assert.equal(h.store.getState().attachments.length, 1);
  assert.match(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(1\)/);

  await h.view.emit("select-reply", { replyId: "supplies", label: "SUPRIMENTOS" });
  assert.equal(h.store.getState().attachments.length, 1);
  assert.match(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(1\)/);

  await h.view.emit("select-reply", { replyId: "launches", label: "LANÇAMENTOS" });
  assert.equal(h.store.getState().activeFlow.id, "launch");
  assert.equal(h.store.getState().attachments.length, 1);
  assert.match(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(1\)/);
});

test("cancelar a transferência permite que uma saída por voltar limpe os anexos", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();

  const activeFlow = { id: "document", title: "ADICIONAR UM NOVO DOCUMENTO", contextId: "ctx-cancel-transfer" };
  const attachment = {
    id: "cancelled-transfer-file",
    fileName: "documento.pdf",
    mimeType: "application/pdf",
    size: 256,
    mediaUrl: "/api/portal-media/cancelled-transfer-file",
  };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "ADICIONAR DOCUMENTO",
    options: [],
  }], { activeFlow });
  h.store.syncAttachments([attachment]);

  h.client.sendText = async payload => {
    if (payload.replyId === "portal_transfer_attachments") {
      return {
        status: "processed",
        activeFlow,
        messages: [{
          type: "poll",
          question: "TRANSFERIR ANEXOS PARA O MENU PRINCIPAL?",
          options: [{ id: "cancel-transfer", reply: "cancel-transfer", label: "CANCELAR" }],
        }],
      };
    }
    if (payload.replyId === "cancel-transfer") {
      return {
        status: "processed",
        activeFlow,
        attachments: [attachment],
        messages: [{
          type: "poll",
          question: "ADICIONAR DOCUMENTO",
          options: [{ id: "navigation_main_menu", reply: "navigation_main_menu", label: "RETORNAR AO MENU INICIAL" }],
        }],
      };
    }
    return {
      status: "processed",
      returned_to_main_menu: true,
      resetConversation: true,
      activeFlow: null,
      attachments: [],
      messages: [{ type: "poll", question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?", options: [] }],
    };
  };

  await h.view.emit("transfer-attachments");
  await h.view.emit("select-reply", { replyId: "cancel-transfer", label: "CANCELAR" });
  await h.view.emit("select-reply", { replyId: "navigation_back", label: "VOLTAR" });

  assert.deepEqual(h.store.getState().attachments, []);
  assert.doesNotMatch(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(/);
});

test("novo fluxo após inatividade preserva o anexo recém-enviado só depois da confirmação", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const attachment = { id: "new-inactive-photo", fileName: "nova-foto.jpg", mimeType: "image/jpeg", size: 512,
    mediaUrl: "/api/portal-media/new-inactive-photo" };
  const activeFlow = { id: "task", title: "ADICIONAR UMA NOVA TAREFA", contextId: "inactive-task" };
  h.store.ingestRemoteMessages([{ type: "poll", question: "USAR ANEXO NO FLUXO ATUAL?", options: [
    { id: "inactivity_attachment_new_flow", label: "USAR EM UM NOVO FLUXO" },
  ] }], { activeFlow });
  h.store.syncAttachments([attachment]);
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === "inactivity_attachment_new_flow") return { status: "processed", activeFlow,
      attachments: [attachment], messages: [{ type: "poll", question: "TEM CERTEZA QUE DESEJA ABANDONAR ESTE FLUXO?",
        options: [{ id: "portal_draft_exit_discard", label: "SIM, ABANDONAR" },
          { id: "portal_draft_exit_cancel", label: "NÃO, CONTINUAR" }] }] };
    return { status: "processed", resetConversation: true, returned_to_main_menu: true,
      started_new_flow_with_inactivity_attachment: true, activeFlow: null, attachments: [attachment],
      messages: [{ type: "poll", question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?", options: [] }] };
  };
  await h.view.emit("select-reply", { replyId: "inactivity_attachment_new_flow", label: "USAR EM UM NOVO FLUXO" });
  assert.deepEqual(calls, ["inactivity_attachment_new_flow"]);
  assert.equal(h.store.getState().attachments.length, 1);
  await h.view.emit("select-reply", { replyId: "portal_draft_exit_discard", label: "SIM, ABANDONAR" });
  assert.deepEqual(calls, ["inactivity_attachment_new_flow", "portal_draft_exit_discard"]);
  assert.equal(h.store.getState().attachments.length, 1);
  assert.match(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(1\)/);
});

test("quando a data validada não tem pendências mostra resumo e permite ver outras datas", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "presence_validation", title: "VALIDAR PRESENÇAS APONTADAS" };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "👷 VALIDAR PRESENÇA\nSELECIONE PRESENTE, AUSENTE OU EDITAR.",
    detail_table: {
      kind: "presence",
      rows: [[{ label: "DATA", value: "12/09/2026" }]],
    },
    options: [{ id: "present", reply: "present", label: "✅ PRESENTE" }],
  }], { activeFlow });
  h.client.sendText = async () => ({
    status: "processed",
    activeFlow,
    messages: [{
      type: "poll",
      presentation: "accordion",
      question: "OS SEGUINTES ITENS AINDA ESTÃO PENDENTES DE VALIDAÇÃO DE PRESENÇA.",
      options: [{ id: "19", reply: "19", label: "19 - PESSOA DEZENOVE (19/09/2026)" }],
    }],
  });

  await h.view.emit("select-reply", { replyId: "present", label: "✅ PRESENTE" });

  const poll = h.store.getState().messages.at(-1);
  assert.deepEqual(poll.options.map(option => option.label), ["📅 VER OUTRAS DATAS"]);
  assert.deepEqual(poll.presenceDateSummary, { date: "2026-09-12", count: 0 });
});

test("finalizar na seleção de produto envia FINALIZAR diretamente e limpa a retomada antiga", { concurrency: false }, async t => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const records = new Map([["energetico.document-line-selection:a1", JSON.stringify({
    contextId: "documento-anterior",
    productKind: "epi",
    finalizeOption: { id: "no", reply: "no", label: "❌ NÃO" },
  })]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) { return records.get(key) ?? null; },
      setItem(key, value) { records.set(key, String(value)); },
      removeItem(key) { records.delete(key); },
    },
  });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  });
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "📦 QUAL PRODUTO FOI PAGO?",
    options: [{ id: "document_line_finalize", reply: "document_line_finalize", label: "✅ FINALIZAR" }],
  }], { activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" } });

  await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });

  assert.deepEqual(h.chatCalls.at(-1), ["text", {
    text: "✅ FINALIZAR",
    replyId: "document_line_finalize",
  }]);
  assert.equal(records.has("energetico.document-line-selection:a1"), false);
});

test("avança automaticamente a pergunta intermediária de outra linha", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS" };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "📦 QUAL PRODUTO FOI PAGO?",
    options: [{ id: "3", reply: "3", label: "3 - ARGAMASSA" }],
  }], { activeFlow });
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "3") {
      return {
        status: "processed",
        activeFlow,
        messages: [{
          type: "poll",
          question: "DESEJA APONTAR OUTRO PRODUTO?",
          options: [{ id: "yes", reply: "yes", label: "✅ SIM" }, { id: "no", reply: "no", label: "❌ NÃO" }],
        }],
      };
    }
    return {
      status: "processed",
      activeFlow,
      messages: [{
        type: "poll",
        question: "📦 QUAL PRODUTO FOI PAGO?",
        options: [{ id: "4", reply: "4", label: "4 - GESSO" }],
      }],
    };
  };

  await h.view.emit("select-reply", { replyId: "3", label: "3 - ARGAMASSA" });

  assert.deepEqual(h.chatCalls.filter(([, payload]) => payload.replyId !== "input_continue").map(call => call[1]), [
    { text: "3 - ARGAMASSA", replyId: "3" },
    { text: "✅ SIM", replyId: "yes" },
  ]);
  assert.deepEqual(h.store.getState().messages.at(-1).options.map(option => option.label), [
    "✅ FINALIZAR",
    "4 - GESSO",
  ]);
});

function epiOption(id, description, unit = "UN") {
  return {
    id: String(id),
    reply: String(id),
    label: `${id} - ${description} (${unit})`,
    source_values: { PRODUTO: description, UNIDADE: unit },
  };
}

function epiProductPoll(options) {
  return {
    type: "poll",
    question: "📦 🦺 QUAL PRODUTO EPI FOI ENTREGUE?",
    databaseFilterKey: "document_signing_epi_product",
    options,
  };
}

function epiQuantityPoll() {
  return { type: "poll", question: "🔢 QUAL A QUANTIDADE?", options: [{ id: "1", reply: "1", label: "1" }] };
}

function epiMorePoll() {
  return {
    type: "poll",
    question: "➕ DESEJA APONTAR OUTRO PRODUTO EPI?",
    options: [
      { id: "yes", reply: "yes", label: "✅ SIM" },
      { id: "no", reply: "no", label: "❌ NÃO" },
    ],
  };
}

const epiActiveFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS", contextId: "epi-delivery-1" };

test("finaliza checkbox EPI lançando quantidade 1 e respondendo não sem catálogo vazio", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([epiProductPoll([epiOption(612, "CAPACETE")])], { activeFlow: epiActiveFlow });
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "612") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiQuantityPoll()] };
    if (payload.text === "1") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiMorePoll()] };
    if (payload.replyId === "no") return {
      status: "processed",
      activeFlow: epiActiveFlow,
      messages: [{ type: "poll", question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.", options: [] }],
    };
    throw new Error(`Resposta EPI inesperada: ${JSON.stringify(payload)}`);
  };

  await h.view.emit("epi-product-selection-changed", { productId: "612", selected: true });
  assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, ["612"]);
  await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });

  assert.deepEqual(h.chatCalls.filter(([, payload]) => payload.replyId !== "input_continue").map(([, payload]) => [payload.replyId, payload.text]), [
    ["612", "612 - CAPACETE (UN)"],
    [undefined, "1"],
    ["no", "❌ NÃO"],
  ]);
  assert.match(h.store.getState().messages.at(-1).question, /PDF GERADO/);
});

test("opção pedido EPI em branco envia só o replyId e não publica balão em branco", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const blankReplyId = "document_signing_epi_order_blank";
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "QUAL PEDIDO DESEJA VINCULAR À ENTREGA?",
    databaseFilterKey: "document_signing_epi_order",
    options: [{ id: blankReplyId, reply: blankReplyId, label: "0 - EM BRANCO" }],
  }], { activeFlow: epiActiveFlow });
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    return { status: "processed", activeFlow: epiActiveFlow, messages: [{
      type: "poll", question: "QUAL O NOME DO FORNECEDOR?", options: [],
    }] };
  };

  await h.view.emit("select-reply", { replyId: blankReplyId, label: "0 - EM BRANCO" });

  assert.deepEqual(h.chatCalls.at(-1), ["text", { text: "", replyId: blankReplyId }]);
  assert.equal(h.store.getState().messages.some(message => message.role === "user" && message.text === "0 - EM BRANCO"), false);
  assert.equal(h.store.getState().messages.some(message => message.role === "user" && message.text === ""), false);
});

test("opção CPF/CNPJ EPI em branco não publica balão com o rótulo", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const blankReplyId = "document_signing_epi_supplier_document_blank";
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "O FORNECEDOR ESTÁ SEM CPF/CNPJ NO CADASTRO. DESEJA APONTAR PARA ESTE COMPROVANTE?",
    options: [{ id: blankReplyId, reply: blankReplyId, label: "⬜ EM BRANCO" }],
  }], { activeFlow: epiActiveFlow });
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    return { status: "processed", activeFlow: epiActiveFlow, messages: [] };
  };

  await h.view.emit("select-reply", { replyId: blankReplyId, label: "⬜ EM BRANCO" });

  assert.deepEqual(h.chatCalls.at(-1), ["text", { text: "", replyId: blankReplyId }]);
  assert.equal(h.store.getState().messages.some(message => message.role === "user" && message.text === "⬜ EM BRANCO"), false);
  assert.equal(h.store.getState().messages.some(message => message.role === "user" && message.text === ""), false);
});

test("criação de provisão responde forma de pagamento vazia em silêncio e não mostra EM BRANCO", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.chatCalls.length = 0;
  const activeFlow = { id: "payment_provision", title: "CRIAR UMA PROVISÃO DE PAGAMENTO" };
  const blankReplyId = "payment_provision_form_blank";
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "QUAL FLUXO DESEJA INICIAR?",
    options: [{ id: "create_payment_provision", reply: "create_payment_provision", label: "CRIAR UMA PROVISÃO DE PAGAMENTO" }],
  }]);
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "create_payment_provision") return {
      status: "processed",
      activeFlow,
      messages: [{
        type: "poll",
        question: "QUAL É A FORMA DE PAGAMENTO?",
        options: [{ id: blankReplyId, reply: blankReplyId, label: "0 - ⬜ EM BRANCO" }],
      }],
    };
    assert.equal(payload.replyId, blankReplyId);
    return {
      status: "processed",
      activeFlow,
      messages: [{ type: "poll", question: "QUAL É A DATA PREVISTA?", options: [] }],
    };
  };

  await h.view.emit("select-reply", {
    replyId: "create_payment_provision",
    label: "CRIAR UMA PROVISÃO DE PAGAMENTO",
  });

  assert.deepEqual(h.chatCalls, [
    ["text", { text: "CRIAR UMA PROVISÃO DE PAGAMENTO", replyId: "create_payment_provision" }],
    ["text", { replyId: blankReplyId, omitText: true }],
  ]);
  const messages = h.store.getState().messages;
  assert.equal(messages.some(message => /QUAL É A FORMA DE PAGAMENTO/i.test(message.question || "")), false);
  assert.equal(messages.some(message => message.role === "user" && /EM BRANCO/i.test(message.text || "")), false);
  assert.equal(messages.at(-1)?.question, "QUAL É A DATA PREVISTA?");
});

test("falha ao selecionar forma vazia exige sincronização e retoma a seleção sem texto", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.chatCalls.length = 0;
  const activeFlow = { id: "payment_provision", title: "CRIAR UMA PROVISÃO DE PAGAMENTO" };
  const blankReplyId = "payment_provision_form_blank";
  let blankAttempts = 0;
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "QUAL FLUXO DESEJA INICIAR?",
    options: [{ id: "create_payment_provision", reply: "create_payment_provision", label: "CRIAR UMA PROVISÃO DE PAGAMENTO" }],
  }]);
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "create_payment_provision") return {
      status: "processed",
      activeFlow,
      messages: [{
        type: "poll",
        question: "QUAL É A FORMA DE PAGAMENTO?",
        options: [{ id: blankReplyId, reply: blankReplyId, label: "0 - ⬜ EM BRANCO" }],
      }],
    };
    if (payload.replyId === blankReplyId) {
      blankAttempts += 1;
      if (blankAttempts === 1) {
        throw Object.assign(new Error("resposta automática sem confirmação"), { code: "NETWORK_UNCERTAIN" });
      }
      return {
        status: "processed",
        activeFlow,
        messages: [{ type: "poll", question: "QUAL É A DATA PREVISTA?", options: [] }],
      };
    }
    if (payload.replyId === "input_continue") return {
      status: "processed",
      activeFlow,
      messages: [{
        type: "poll",
        question: "QUAL É A FORMA DE PAGAMENTO?",
        options: [{ id: blankReplyId, reply: blankReplyId, label: "0 - ⬜ EM BRANCO" }],
      }],
    };
    assert.equal(payload.replyId, blankReplyId);
    return {
      status: "processed",
      activeFlow,
      messages: [{ type: "poll", question: "QUAL É A DATA PREVISTA?", options: [] }],
    };
  };

  await h.view.emit("select-reply", {
    replyId: "create_payment_provision",
    label: "CRIAR UMA PROVISÃO DE PAGAMENTO",
  });

  assert.equal(h.store.getState().activeFlow.id, "payment_provision");
  assert.equal(h.store.getState().messages.at(-1)?.type, "text");
  assert.doesNotMatch(h.store.getState().messages.at(-1)?.text || "", /FORMA DE PAGAMENTO|EM BRANCO/i);
  assert.equal(h.view.renders.at(-1).recoveryUncertain, true);
  assert.match(h.view.renders.at(-1).error, /Retomar conversa/i);
  await h.view.emit("draft-changed", { value: "EM BRANCO" });
  await h.view.emit("send-text");
  assert.equal(h.chatCalls.length, 2, "o compositor não deve enviar antes da sincronização");
  await h.view.emit("retry-session");

  assert.deepEqual(h.chatCalls.map(([, payload]) => payload.replyId), [
    "create_payment_provision", blankReplyId, "input_continue", blankReplyId,
  ]);
  assert.equal(h.chatCalls.at(-1)[1].omitText, true);
  assert.equal(h.view.renders.at(-1).error, null);
  assert.equal(h.view.renders.at(-1).recoveryUncertain, false);
  assert.equal(h.store.getState().activeFlow.id, "payment_provision");
  assert.equal(h.store.getState().messages.at(-1)?.question, "QUAL É A DATA PREVISTA?");
});

test("retomar não repete a forma vazia quando a VM já avançou", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "payment_provision", title: "CRIAR UMA PROVISÃO DE PAGAMENTO" };
  const blankReplyId = "payment_provision_form_blank";
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "QUAL FLUXO DESEJA INICIAR?",
    options: [{ id: "create_payment_provision", reply: "create_payment_provision", label: "CRIAR UMA PROVISÃO DE PAGAMENTO" }],
  }]);
  h.chatCalls.length = 0;
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "create_payment_provision") return {
      status: "processed", activeFlow,
      messages: [{ type: "poll", question: "QUAL É A FORMA DE PAGAMENTO?", options: [
        { id: blankReplyId, reply: blankReplyId, label: "0 - ⬜ EM BRANCO" },
      ] }],
    };
    if (payload.replyId === blankReplyId) throw Object.assign(new Error("gateway sem confirmação"), { status: 502 });
    assert.equal(payload.replyId, "input_continue");
    return { status: "processed", activeFlow, messages: [{ type: "poll", question: "QUAL É A DATA PREVISTA?", options: [] }] };
  };

  await h.view.emit("select-reply", { replyId: "create_payment_provision", label: "CRIAR UMA PROVISÃO DE PAGAMENTO" });
  await h.view.emit("retry-session");

  assert.deepEqual(h.chatCalls.map(([, payload]) => payload.replyId), [
    "create_payment_provision", blankReplyId, "input_continue",
  ]);
  assert.equal(h.store.getState().messages.at(-1)?.question, "QUAL É A DATA PREVISTA?");
});

test("não autoenvia a opção vazia de forma de pagamento fora da criação de provisão", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.chatCalls.length = 0;
  const activeFlow = { id: "launch", title: "EFETUAR LANÇAMENTO" };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "QUAL FLUXO DESEJA INICIAR?",
    options: [{ id: "create_launch", reply: "create_launch", label: "EFETUAR LANÇAMENTO" }],
  }]);
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    return {
      status: "processed",
      activeFlow,
      messages: [{
        type: "poll",
        question: "QUAL É A FORMA DE PAGAMENTO?",
        options: [{ id: "launch_blank", reply: "launch_blank", label: "0 - ⬜ EM BRANCO" }],
      }],
    };
  };

  await h.view.emit("select-reply", { replyId: "create_launch", label: "EFETUAR LANÇAMENTO" });

  assert.deepEqual(h.chatCalls, [["text", { text: "EFETUAR LANÇAMENTO", replyId: "create_launch" }]]);
  assert.equal(h.store.getState().messages.at(-1)?.question, "QUAL É A FORMA DE PAGAMENTO?");
});

test("selecionar todos os EPI marca e desmarca o lote sem alterar a quantidade personalizada", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([epiProductPoll([
    epiOption(612, "CAPACETE"), epiOption(613, "LUVA", "PAR"),
  ])], { activeFlow: epiActiveFlow });
  const chatCallsBeforeSelection = h.chatCalls.length;

  await h.view.emit("epi-product-select-all", { productIds: ["612", "613"], selected: true });
  assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, ["612", "613"]);
  await h.view.emit("epi-product-select-all", { productIds: ["612", "613"], selected: false });
  assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, []);
  assert.equal(h.chatCalls.length, chatCallsBeforeSelection);
});

test("selecionar todos os EPI rejeita o lote inteiro quando há descrição repetida", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([epiProductPoll([
    epiOption(612, "CAPACETE"), epiOption(613, "CAPACETE"),
  ])], { activeFlow: epiActiveFlow });

  await h.view.emit("epi-product-select-all", { productIds: ["612", "613"], selected: true });
  assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, []);
  assert.match(h.view.renders.at(-1).error, /descrições repetidas/);
});

test("troca de conta limpa seleções, produto pendente e itens EPI da conta anterior", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const first = epiOption(612, "CAPACETE");
  const second = epiOption(613, "LUVA", "PAR");
  const third = epiOption(614, "ÓCULOS");
  const nextAccountFlow = { ...epiActiveFlow, contextId: "epi-delivery-account-2" };
  h.store.ingestRemoteMessages([epiProductPoll([first, second, third])], { activeFlow: epiActiveFlow });
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "612") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiQuantityPoll()] };
    if (payload.text === "7") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiMorePoll()] };
    if (payload.replyId === "yes") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiProductPoll([third])] };
    if (payload.replyId === "614") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiQuantityPoll()] };
    if (payload.replyId === "input_continue") {
      return { status: "processed", activeFlow: nextAccountFlow, messages: [epiProductPoll([first, second, third])] };
    }
    return { status: "processed", activeFlow: nextAccountFlow, messages: [epiMorePoll()] };
  };

  await h.view.emit("epi-product-selection-changed", { productId: "613", selected: true });
  await h.view.emit("select-reply", { replyId: "612", label: first.label });
  await h.view.emit("draft-changed", { value: "7" });
  await h.view.emit("send-text");
  await h.view.emit("select-reply", { replyId: "614", label: third.label });
  assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, ["613"]);

  h.auth.signIn = async () => ({ homeAccountId: "a2", name: "Outra conta" });
  await h.view.emit("sign-in");

  assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, []);
  await h.view.emit("epi-product-selection-changed", { productId: "612", selected: true });
  await h.view.emit("epi-product-selection-changed", { productId: "613", selected: true });
  assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, ["612", "613"]);

  h.store.ingestRemoteMessages([epiQuantityPoll()], { activeFlow: nextAccountFlow });
  await h.view.emit("draft-changed", { value: "1e3" });
  await h.view.emit("send-text");
  assert.equal(h.chatCalls.filter(([, payload]) => payload.text === "1e3").length, 1);

  h.store.ingestRemoteMessages([epiProductPoll([first, second])], { activeFlow: nextAccountFlow });
  await h.view.emit("epi-product-selection-changed", { productId: "612", selected: true });
  await h.view.emit("sign-out");
  assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, []);
});

test("retry da seleção EPI continua da quantidade pendente sem reenviar itens confirmados", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const first = epiOption(612, "CAPACETE");
  const second = epiOption(613, "LUVA", "PAR");
  h.store.ingestRemoteMessages([epiProductPoll([first, second])], { activeFlow: epiActiveFlow });
  let quantityAttempts = 0;
  let failOnce = true;
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "612") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiQuantityPoll()] };
    if (payload.replyId === "yes") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiProductPoll([second])] };
    if (payload.replyId === "613") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiQuantityPoll()] };
    if (payload.text === "1") {
      quantityAttempts += 1;
      if (quantityAttempts === 2 && failOnce) {
        failOnce = false;
        throw new Error("falha transitória após selecionar o segundo EPI");
      }
      return { status: "processed", activeFlow: epiActiveFlow, messages: [epiMorePoll()] };
    }
    if (payload.replyId === "no") {
      return { status: "processed", activeFlow: epiActiveFlow, messages: [{ type: "text", text: "PDF GERADO" }] };
    }
    throw new Error(`Resposta EPI inesperada no retry: ${JSON.stringify(payload)}`);
  };

  await h.view.emit("epi-product-selection-changed", { productId: "612", selected: true });
  await h.view.emit("epi-product-selection-changed", { productId: "613", selected: true });
  await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });
  assert.match(h.view.renders.at(-1).error, /falha transitória/);

  const itemReplies = h.chatCalls
    .filter(([, payload]) => ["612", "613"].includes(payload.replyId))
    .map(([, payload]) => payload.replyId);
  assert.deepEqual(itemReplies, ["612", "613"]);
  assert.equal(quantityAttempts, 2);
  await h.view.emit("draft-changed", { value: "1" });
  await h.view.emit("send-text");
  assert.equal(quantityAttempts, 3);
  assert.match(h.store.getState().messages.at(-1).text, /PDF GERADO/);
});

test("retry EPI após falha no SIM reconcilia item gravado antes de avançar", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const first = epiOption(612, "CAPACETE");
  const second = epiOption(613, "LUVA", "PAR");
  const snapshot = (stage, items, pendingProduct = null) => ({
    ...epiActiveFlow,
    epiDelivery: { stage: `document_signing_epi_${stage}`, pendingProduct, items },
  });
  h.store.ingestRemoteMessages([epiProductPoll([first, second])], { activeFlow: snapshot("product", []) });
  let quantityAttempts = 0;
  let yesAttempts = 0;
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "612") return {
      status: "processed",
      activeFlow: snapshot("quantity", [], { description: "CAPACETE", unit: "UN" }),
      messages: [epiQuantityPoll()],
    };
    if (payload.text === "1") {
      quantityAttempts += 1;
      const items = quantityAttempts === 1
        ? [{ description: "CAPACETE", quantity: "1", unit: "UN" }]
        : [
          { description: "CAPACETE", quantity: "1", unit: "UN" },
          { description: "LUVA", quantity: "1", unit: "PAR" },
        ];
      return { status: "processed", activeFlow: snapshot("more", items), messages: [epiMorePoll()] };
    }
    if (payload.replyId === "yes") {
      yesAttempts += 1;
      if (yesAttempts === 1) throw new Error("falha transitória no avanço SIM");
      return {
        status: "processed",
        activeFlow: snapshot("product", [{ description: "CAPACETE", quantity: "1", unit: "UN" }]),
        messages: [epiProductPoll([second])],
      };
    }
    if (payload.replyId === "613") return {
      status: "processed",
      activeFlow: snapshot("quantity", [{ description: "CAPACETE", quantity: "1", unit: "UN" }], { description: "LUVA", unit: "PAR" }),
      messages: [epiQuantityPoll()],
    };
    if (payload.replyId === "no") return {
      status: "processed",
      activeFlow: snapshot("more", [
        { description: "CAPACETE", quantity: "1", unit: "UN" },
        { description: "LUVA", quantity: "1", unit: "PAR" },
      ]),
      messages: [{ type: "text", text: "PDF GERADO" }],
    };
    throw new Error(`Resposta EPI inesperada após falha no SIM: ${JSON.stringify(payload)}`);
  };

  await h.view.emit("epi-product-selection-changed", { productId: "612", selected: true });
  await h.view.emit("epi-product-selection-changed", { productId: "613", selected: true });
  await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });

  assert.match(h.view.renders.at(-1).error, /falha transitória no avanço SIM/);
  assert.equal(h.store.getState().activeFlow.epiDelivery.stage, "document_signing_epi_more");
  assert.deepEqual(h.store.getState().activeFlow.epiDelivery.items, [
    { description: "CAPACETE", quantity: "1", unit: "UN" },
  ]);
  assert.match(h.store.getState().messages.at(-1).question, /DESEJA APONTAR OUTRO PRODUTO EPI/);

  await h.view.emit("select-reply", { replyId: "yes", label: "✅ SIM" });

  assert.deepEqual(h.chatCalls.filter(([, payload]) => ["612", "613"].includes(payload.replyId)).map(([, payload]) => payload.replyId), ["612", "613"]);
  assert.equal(quantityAttempts, 2);
  assert.equal(yesAttempts, 2);
  assert.match(h.store.getState().messages.at(-1).text, /PDF GERADO/);
});

for (const scenario of [
  { name: "produto não processado", action: "product", processed: false, recoveryStage: "product" },
  { name: "produto processado com resposta perdida", action: "product", processed: true, recoveryStage: "quantity" },
  { name: "quantidade não processada", action: "quantity", processed: false, recoveryStage: "quantity" },
  { name: "quantidade processada com resposta perdida", action: "quantity", processed: true, recoveryStage: "more" },
  { name: "SIM não processado", action: "yes", processed: false, recoveryStage: "more" },
  { name: "SIM processado com resposta perdida", action: "yes", processed: true, recoveryStage: "product" },
]) {
  test(`recovery EPI reconcilia sem duplicar envio: ${scenario.name}`, async t => {
    const h = makeHarness();
    t.after(() => h.controller.stop());
    await h.controller.start();
    const first = epiOption(612, "CAPACETE");
    const second = epiOption(613, "LUVA", "PAR");
    let serverStage = "product";
    let pendingProduct = null;
    const serverItems = [];
    let failureInjected = false;
    const stageSnapshot = () => ({
      ...epiActiveFlow,
      epiDelivery: {
        stage: `document_signing_epi_${serverStage}`,
        pendingProduct,
        items: serverItems.map(item => ({ ...item })),
      },
    });
    const stageMessages = () => {
      if (serverStage === "product") {
        const remaining = serverItems.some(item => item.description === "CAPACETE") ? [second] : [first, second];
        return [epiProductPoll(remaining)];
      }
      if (serverStage === "quantity") return [epiQuantityPoll()];
      return [epiMorePoll()];
    };
    const maybeLoseResponse = action => {
      if (failureInjected || scenario.action !== action) return false;
      failureInjected = true;
      return true;
    };
    const commitPendingQuantity = () => {
      serverItems.push({
        description: pendingProduct.description,
        quantity: "1",
        unit: pendingProduct.unit,
      });
      pendingProduct = null;
      serverStage = "more";
    };
    h.store.ingestRemoteMessages([epiProductPoll([first, second])], { activeFlow: stageSnapshot() });
    h.client.sendText = async payload => {
      h.chatCalls.push(["text", payload]);
      if (payload.replyId === "input_continue") {
        return { status: "processed", activeFlow: stageSnapshot(), messages: stageMessages() };
      }
      if (payload.replyId === "612" || payload.replyId === "613") {
        const action = "product";
        const loseResponse = payload.replyId === "612" && maybeLoseResponse(action);
        if (!loseResponse || scenario.processed) {
          pendingProduct = payload.replyId === "612"
            ? { description: "CAPACETE", unit: "UN" }
            : { description: "LUVA", unit: "PAR" };
          serverStage = "quantity";
        }
        if (loseResponse) throw new Error("resposta de seleção perdida");
        return { status: "processed", activeFlow: stageSnapshot(), messages: [epiQuantityPoll()] };
      }
      if (payload.text === "1") {
        const loseResponse = maybeLoseResponse("quantity");
        if (!loseResponse || scenario.processed) commitPendingQuantity();
        if (loseResponse) throw new Error("resposta de quantidade perdida");
        return { status: "processed", activeFlow: stageSnapshot(), messages: [epiMorePoll()] };
      }
      if (payload.replyId === "yes") {
        const loseResponse = maybeLoseResponse("yes");
        if (!loseResponse || scenario.processed) {
          pendingProduct = null;
          serverStage = "product";
        }
        if (loseResponse) throw new Error("resposta SIM perdida");
        return { status: "processed", activeFlow: stageSnapshot(), messages: stageMessages() };
      }
      if (payload.replyId === "no") {
        serverStage = "product";
        return {
          status: "processed",
          activeFlow: null,
          messages: [{ type: "poll", question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.", options: [] }],
        };
      }
      throw new Error(`Resposta EPI inesperada no cenário ${scenario.name}: ${JSON.stringify(payload)}`);
    };

    await h.view.emit("epi-product-selection-changed", { productId: "612", selected: true });
    await h.view.emit("epi-product-selection-changed", { productId: "613", selected: true });
    await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });
    assert.match(h.view.renders.at(-1).error, /resposta .* perdida/);

    await h.view.emit("retry-session");
    assert.equal(h.store.getState().activeFlow.epiDelivery.stage, `document_signing_epi_${scenario.recoveryStage}`);
    await h.view.emit("retry-session");
    assert.equal(h.store.getState().activeFlow.epiDelivery.stage, `document_signing_epi_${scenario.recoveryStage}`);
    if (scenario.recoveryStage === "product" && scenario.action === "yes" && scenario.processed) {
      // A recovered product-stage snapshot means the lost SIM already committed.
      await h.view.emit("epi-product-selection-changed", { productId: "613", selected: false });
      await h.view.emit("epi-product-selection-changed", { productId: "613", selected: true });
      assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, ["613"]);
      await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });
    } else if (scenario.recoveryStage === "product") {
      await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });
    } else if (scenario.recoveryStage === "quantity") {
      await h.view.emit("draft-changed", { value: "1" });
      await h.view.emit("send-text");
    } else {
      await h.view.emit("select-reply", { replyId: "yes", label: "✅ SIM" });
    }

    const sent = h.chatCalls
      .filter(([, payload]) => payload.replyId !== "input_continue")
      .map(([, payload]) => payload);
    const countProduct = id => sent.filter(payload => payload.replyId === id).length;
    const countQuantities = () => sent.filter(payload => payload.text === "1" && !payload.replyId).length;
    const countYes = () => sent.filter(payload => payload.replyId === "yes").length;
    assert.equal(countProduct("612"), scenario.action === "product" && !scenario.processed ? 2 : 1);
    assert.equal(countProduct("613"), 1);
    assert.equal(countQuantities(), scenario.action === "quantity" && !scenario.processed ? 3 : 2);
    assert.equal(countYes(), scenario.action === "yes" && !scenario.processed ? 2 : 1);
    assert.deepEqual(serverItems, [
      { description: "CAPACETE", quantity: "1", unit: "UN" },
      { description: "LUVA", quantity: "1", unit: "PAR" },
    ]);
    assert.match(h.store.getState().messages.at(-1).question, /PDF GERADO/);
  });
}

test("PDF EPI combina quantidade personalizada pelo botão com checkbox em quantidade 1", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const buttonProduct = epiOption(612, "CAPACETE");
  const checkboxProduct = epiOption(613, "LUVA", "PAR");
  const epiFlowSnapshot = (stage, items, pendingProduct = null) => ({
    ...epiActiveFlow,
    epiDelivery: { stage: `document_signing_epi_${stage}`, pendingProduct, items },
  });
  h.store.ingestRemoteMessages([epiProductPoll([buttonProduct, checkboxProduct])], { activeFlow: epiActiveFlow });
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "612") return {
      status: "processed",
      activeFlow: epiFlowSnapshot("quantity", [], { description: "CAPACETE", unit: "UN" }),
      messages: [epiQuantityPoll()],
    };
    if (payload.text === "4") return {
      status: "processed",
      activeFlow: epiFlowSnapshot("more", [{ description: "CAPACETE", quantity: "4", unit: "UN" }]),
      messages: [epiMorePoll()],
    };
    if (payload.replyId === "yes") return {
      status: "processed",
      activeFlow: epiFlowSnapshot("product", [{ description: "CAPACETE", quantity: "4", unit: "UN" }]),
      messages: [epiProductPoll([checkboxProduct])],
    };
    if (payload.replyId === "613") return {
      status: "processed",
      activeFlow: epiFlowSnapshot("quantity", [{ description: "CAPACETE", quantity: "4", unit: "UN" }], { description: "LUVA", unit: "PAR" }),
      messages: [epiQuantityPoll()],
    };
    if (payload.text === "1") return {
      status: "processed",
      activeFlow: epiFlowSnapshot("more", [
        { description: "CAPACETE", quantity: "4", unit: "UN" },
        { description: "LUVA", quantity: "1", unit: "PAR" },
      ]),
      messages: [epiMorePoll()],
    };
    if (payload.replyId === "no") return {
      status: "processed",
      activeFlow: epiActiveFlow,
      messages: [{ type: "poll", question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.", options: [] }],
    };
    throw new Error(`Resposta EPI inesperada: ${JSON.stringify(payload)}`);
  };

  await h.view.emit("epi-product-selection-changed", { productId: "613", selected: true });
  await h.view.emit("select-reply", { replyId: "612", label: buttonProduct.label });
  await h.view.emit("draft-changed", { value: "4" });
  await h.view.emit("send-text");
  assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, ["613"]);
  await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });

  const sent = h.chatCalls.filter(([, payload]) => payload.replyId !== "input_continue").map(([, payload]) => payload);
  assert.deepEqual(sent.map(payload => payload.replyId), ["612", undefined, "yes", "613", undefined, "no"]);
  assert.deepEqual(sent.map(payload => payload.text), [buttonProduct.label, "4", "✅ SIM", checkboxProduct.label, "1", "❌ NÃO"]);
});

test("descrição EPI repetida com unidade diferente mantém a quantidade escolhida pelo botão", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const buttonProduct = epiOption(612, "Capacete  de Segurança", "UN");
  const duplicateCheckbox = epiOption(613, "CAPACETE DE SEGURANÇA", "CX");
  h.store.ingestRemoteMessages([epiProductPoll([buttonProduct, duplicateCheckbox])], { activeFlow: epiActiveFlow });
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "612") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiQuantityPoll()] };
    if (payload.text === "7") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiMorePoll()] };
    if (payload.replyId === "yes") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiProductPoll([duplicateCheckbox])] };
    if (payload.replyId === "navigation_back") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiMorePoll()] };
    if (payload.replyId === "no") return {
      status: "processed",
      activeFlow: epiActiveFlow,
      messages: [{ type: "poll", question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.", options: [] }],
    };
    throw new Error(`Resposta EPI inesperada: ${JSON.stringify(payload)}`);
  };

  await h.view.emit("epi-product-selection-changed", { productId: "613", selected: true });
  await h.view.emit("select-reply", { replyId: "612", label: buttonProduct.label });
  await h.view.emit("draft-changed", { value: "7" });
  await h.view.emit("send-text");

  assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, []);
  await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });
  const sent = h.chatCalls.filter(([, payload]) => payload.replyId !== "input_continue");
  assert.deepEqual(sent.map(([, payload]) => payload.replyId), ["612", undefined, "yes", "navigation_back", "no"]);
  assert.equal(sent.some(([, payload]) => payload.replyId === "613"), false);
});

test("quantidade EPI fora dos limites do gerador do PDF não é enviada à VM", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const product = epiOption(612, "CAPACETE");
  h.store.ingestRemoteMessages([epiProductPoll([product])], { activeFlow: epiActiveFlow });
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "612") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiQuantityPoll()] };
    throw new Error("Quantidade incompatível chegou ao backend: " + payload.text);
  };

  await h.view.emit("select-reply", { replyId: "612", label: product.label });
  for (const value of ["1e3", "0,0000001", "1000000000000000", "-1"]) {
    await h.view.emit("draft-changed", { value });
    await h.view.emit("send-text");
  }

  assert.deepEqual(h.chatCalls.filter(([, payload]) => payload.replyId !== "input_continue").map(([, payload]) => payload.replyId), ["612"]);
  assert.match(h.view.renders.at(-1).error, /quantidade.*PDF|PDF.*quantidade/i);
  assert.match(h.store.getState().messages.at(-1).question, /QUANTIDADE/);
});

test("voltar da quantidade EPI retorna ao catálogo sem validar navegação como quantidade", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const product = epiOption(612, "CAPACETE");
  h.store.ingestRemoteMessages([epiProductPoll([product])], { activeFlow: epiActiveFlow });
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "612") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiQuantityPoll()] };
    if (payload.replyId === "navigation_back") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiProductPoll([product])] };
    throw new Error(`Resposta EPI inesperada: ${JSON.stringify(payload)}`);
  };

  await h.view.emit("select-reply", { replyId: "612", label: product.label });
  await h.view.emit("select-reply", { replyId: "navigation_back", label: "↩️ RETORNAR À PERGUNTA ANTERIOR" });

  assert.deepEqual(h.chatCalls.filter(([, payload]) => payload.replyId !== "input_continue").map(([, payload]) => payload.replyId), ["612", "navigation_back"]);
  assert.match(h.store.getState().messages.at(-1).question, /PRODUTO EPI/);
  assert.equal(h.view.renders.at(-1).error, null);
});

test('casinha abandona a quantidade EPI sem tratá-la como resposta numérica', async t => {
  const h = makeHarness({ historyMode: 'current-step' });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const resumedFlow = {
    ...epiActiveFlow,
    epiDelivery: {
      stage: 'document_signing_epi_quantity',
      pendingProduct: { description: 'CAPACETE', unit: 'UN' },
      items: [],
    },
  };
  h.store.ingestRemoteMessages([epiQuantityPoll()], { activeFlow: resumedFlow });
  const sent = [];
  h.client.sendText = async payload => {
    sent.push(payload.replyId);
    assert.equal(payload.replyId, 'portal_confirm_main_menu');
    return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
      activeFlow: null, messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }] };
  };

  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu', label: '🏠 RETORNAR AO MENU INICIAL' }), true);
  assert.deepEqual(sent, ['portal_confirm_main_menu']);
  assert.equal(h.store.getState().activeFlow, null);
});

test("quantidade retomada usa o estágio EPI ativo para aplicar limites do PDF", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const resumedFlow = {
    ...epiActiveFlow,
    epiDelivery: {
      stage: "document_signing_epi_quantity",
      pendingProduct: { description: "CAPACETE", unit: "UN" },
      items: [{ description: "BOTINA", quantity: "2", unit: "PAR" }],
    },
  };
  h.store.ingestRemoteMessages([epiQuantityPoll()], { activeFlow: resumedFlow });

  await h.view.emit("draft-changed", { value: "1e3" });
  await h.view.emit("send-text");

  assert.equal(h.chatCalls.filter(([, payload]) => payload.text === "1e3").length, 0);
  assert.match(h.view.renders.at(-1).error, /quantidade.*PDF|PDF.*quantidade/i);
});

test("itens EPI ativos deduplicam descrições sem acento como no PDF", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = {
    ...epiActiveFlow,
    epiDelivery: {
      stage: "document_signing_epi_product",
      pendingProduct: null,
      items: [{ description: "Café", quantity: "2", unit: "UN" }],
    },
  };
  h.store.ingestRemoteMessages([epiProductPoll([epiOption(612, "CAFE", "CX")])], { activeFlow });

  await h.view.emit("epi-product-selection-changed", { productId: "612", selected: true });

  assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, []);
  assert.match(h.view.renders.at(-1).error, /descrições repetidas/);
});

test("itens EPI ativos contam para o limite de 100 linhas do PDF", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = {
    ...epiActiveFlow,
    epiDelivery: {
      stage: "document_signing_epi_product",
      pendingProduct: null,
      items: Array.from({ length: 100 }, (_, index) => ({
        description: `PRODUTO ${index + 1}`, quantity: "1", unit: "UN",
      })),
    },
  };
  h.store.ingestRemoteMessages([epiProductPoll([epiOption(612, "CAPACETE")])], { activeFlow });

  await h.view.emit("epi-product-selection-changed", { productId: "612", selected: true });

  assert.deepEqual(h.view.renders.at(-1).epiSelectedProductIds, []);
  assert.match(h.view.renders.at(-1).error, /no máximo 100 itens/);
});

test("último EPI escolhido pelo botão volta à lista vazia com FINALIZAR e conclui o PDF", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const product = epiOption(612, "CAPACETE");
  h.store.ingestRemoteMessages([epiProductPoll([product])], { activeFlow: epiActiveFlow });
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "612") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiQuantityPoll()] };
    if (payload.text === "2") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiMorePoll()] };
    if (payload.replyId === "yes") return {
      status: "epi_product_unavailable",
      activeFlow: epiActiveFlow,
      messages: [{ type: "text", text: "❌ NÃO HÁ PRODUTOS EPI ATIVOS CADASTRADOS." }],
    };
    if (payload.replyId === "navigation_back") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiMorePoll()] };
    if (payload.replyId === "no") return {
      status: "processed",
      activeFlow: epiActiveFlow,
      messages: [{ type: "poll", question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.", options: [] }],
    };
    throw new Error("Resposta EPI inesperada: " + JSON.stringify(payload));
  };

  await h.view.emit("select-reply", { replyId: "612", label: product.label });
  await h.view.emit("draft-changed", { value: "2" });
  await h.view.emit("send-text");

  assert.equal(h.store.getState().messages.at(-1).options[0].reply, "document_line_finalize");
  await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });
  const sent = h.chatCalls.filter(([, payload]) => payload.replyId !== "input_continue");
  assert.deepEqual(sent.map(([, payload]) => payload.replyId), ["612", undefined, "yes", "navigation_back", "no"]);
  assert.match(h.store.getState().messages.at(-1).question, /PDF GERADO/);
});

test("finalizar lote EPI não apresenta perguntas intermediárias nem comandos automáticos", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const first = epiOption(612, "CAPACETE");
  const last = epiOption(613, "LUVA", "PAR");
  const snapshot = (stage, items, pendingProduct = null) => ({
    ...epiActiveFlow,
    epiDelivery: { stage: `document_signing_epi_${stage}`, pendingProduct, items },
  });
  const committedFirst = { description: "CAPACETE", quantity: "1", unit: "UN" };
  const committedLast = { description: "LUVA", quantity: "1", unit: "PAR" };
  h.store.ingestRemoteMessages([epiProductPoll([first, last])], { activeFlow: snapshot("product", []) });
  let quantityAttempts = 0;
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "612") return {
      status: "processed", activeFlow: snapshot("quantity", [], { description: "CAPACETE", unit: "UN" }),
      messages: [epiQuantityPoll()],
    }
    if (payload.replyId === "613") return {
      status: "processed", activeFlow: snapshot("quantity", [committedFirst], { description: "LUVA", unit: "PAR" }),
      messages: [epiQuantityPoll()],
    }
    if (payload.text === "1") {
      quantityAttempts += 1;
      const items = quantityAttempts === 1 ? [committedFirst] : [committedFirst, committedLast];
      return { status: "processed", activeFlow: snapshot("more", items), messages: [epiMorePoll()] };
    }
    if (payload.replyId === "yes") return {
      status: "processed", activeFlow: snapshot("product", [committedFirst]), messages: [epiProductPoll([last])],
    };
    if (payload.replyId === "no") return {
      status: "processed",
      activeFlow: snapshot("more", [committedFirst, committedLast]),
      messages: [{ type: "poll", question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.", options: [] }],
    };
    throw new Error(`Resposta EPI inesperada: ${JSON.stringify(payload)}`);
  };

  await h.view.emit("epi-product-selection-changed", { productId: "612", selected: true });
  await h.view.emit("epi-product-selection-changed", { productId: "613", selected: true });
  const batchStartRender = h.view.renders.length;
  await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });

  const renderedMessages = h.view.renders.flatMap(render => render.messages || []);
  assert.equal(renderedMessages.some(message => /QUAL A QUANTIDADE|DESEJA APONTAR OUTRO PRODUTO EPI/i.test(message.question || "")), false);
  assert.equal(h.store.getState().messages.some(message => message.role === "user"), false);
  assert.match(h.store.getState().messages.at(-1).question, /PDF GERADO/);
  const batchProductRenders = h.view.renders.slice(batchStartRender).filter(render => (
    !render.messages?.some(message => /PDF GERADO/.test(message.question || ""))
    && render.messages?.some(message => /QUAL PRODUTO EPI FOI ENTREGUE/.test(message.question || ""))
  ));
  assert.ok(batchProductRenders.length > 0);
  for (const render of batchProductRenders) assert.deepEqual(render.epiSelectedProductIds, ["612", "613"]);
});

test("selecionar todos os produtos EPI finaliza sem tentar avançar para catálogo vazio", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const first = epiOption(612, "CAPACETE");
  const last = epiOption(613, "LUVA", "PAR");
  h.store.ingestRemoteMessages([epiProductPoll([first, last])], { activeFlow: epiActiveFlow });
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "612") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiQuantityPoll()] };
    if (payload.replyId === "613") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiQuantityPoll()] };
    if (payload.text === "1") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiMorePoll()] };
    if (payload.replyId === "yes") return { status: "processed", activeFlow: epiActiveFlow, messages: [epiProductPoll([last])] };
    if (payload.replyId === "no") return {
      status: "processed",
      activeFlow: epiActiveFlow,
      messages: [{ type: "poll", question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.", options: [] }],
    };
    throw new Error("Resposta EPI inesperada: " + JSON.stringify(payload));
  };

  await h.view.emit("epi-product-selection-changed", { productId: "612", selected: true });
  await h.view.emit("epi-product-selection-changed", { productId: "613", selected: true });
  await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });
  const sent = h.chatCalls.filter(([, payload]) => payload.replyId !== "input_continue").map(([, payload]) => payload);
  assert.deepEqual(sent.map(payload => payload.replyId), ["612", undefined, "yes", "613", undefined, "no"]);
  assert.deepEqual(sent.filter(payload => payload.text === "1").map(payload => payload.text), ["1", "1"]);
  assert.match(h.store.getState().messages.at(-1).question, /PDF GERADO/);
});

for (const scenario of [
  {
    name: "comprovante de pagamento",
    productQuestion: "📦 QUAL PRODUTO FOI PAGO?",
    moreQuestion: "DESEJA APONTAR OUTRO PRODUTO?",
    firstProduct: { id: "3", reply: "3", label: "3 - ARGAMASSA" },
    nextProduct: { id: "4", reply: "4", label: "4 - GESSO" },
  },
  {
    name: "entrega de EPI",
    productQuestion: "📦 🦺 QUAL PRODUTO EPI FOI ENTREGUE?",
    moreQuestion: "DESEJA APONTAR OUTRO PRODUTO EPI?",
    firstProduct: { id: "612", reply: "612", label: "612 - CAPACETE DE SEGURANÇA (UN)" },
    nextProduct: { id: "629", reply: "629", label: "629 - PROTETOR SOLAR (UN)" },
  },
]) {
  test(`mantém FINALIZAR funcional na próxima lista de produtos do ${scenario.name}`, async t => {
    const h = makeHarness();
    t.after(() => h.controller.stop());
    await h.controller.start();
    const activeFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS" };
    const morePoll = () => ({
      type: "poll",
      question: scenario.moreQuestion,
      options: [
        { id: "yes", reply: "yes", label: "✅ SIM" },
        { id: "no", reply: "no", label: "❌ NÃO" },
      ],
    });
    h.store.ingestRemoteMessages([{
      type: "poll",
      question: scenario.productQuestion,
      options: [scenario.firstProduct],
    }], { activeFlow });
    h.client.sendText = async payload => {
      h.chatCalls.push(["text", payload]);
      if (payload.replyId === scenario.firstProduct.reply) {
        return { status: "processed", activeFlow, messages: [morePoll()] };
      }
      if (payload.replyId === "yes") {
        return {
          status: "processed",
          activeFlow,
          messages: [{
            type: "poll",
            question: scenario.productQuestion,
            options: [scenario.nextProduct],
          }],
        };
      }
      if (payload.replyId === "navigation_back") {
        return { status: "processed", activeFlow, messages: [morePoll()] };
      }
      if (payload.replyId === "no") {
        return {
          status: "processed",
          activeFlow,
          messages: [{
            type: "poll",
            question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.",
            options: [{ id: "document_signing_draw_signature", label: "✍️ ASSINAR NA TELA" }],
          }],
        };
      }
      throw new Error(`Resposta inesperada: ${JSON.stringify(payload)}`);
    };

    await h.view.emit("select-reply", {
      replyId: scenario.firstProduct.reply,
      label: scenario.firstProduct.label,
    });

    const productPoll = h.store.getState().messages.at(-1);
    assert.deepEqual(productPoll.options.map(option => option.id), [
      "document_line_finalize",
      scenario.nextProduct.id,
    ]);

    await h.view.emit("select-reply", {
      replyId: "document_line_finalize",
      label: "✅ FINALIZAR",
    });

    assert.deepEqual(
      h.chatCalls.filter(([, payload]) => payload.replyId !== "input_continue").map(([, payload]) => payload.replyId),
      [scenario.firstProduct.reply, "yes", "navigation_back", "no"],
    );
    assert.equal(h.store.getState().messages.at(-1).question, "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.");
  });
}

test("restaura FINALIZAR ao reabrir o app na lista seguinte de produtos", { concurrency: false }, async t => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const records = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) { return records.get(key) ?? null; },
      setItem(key, value) { records.set(key, String(value)); },
      removeItem(key) { records.delete(key); },
    },
  });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  });

  const activeFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS", contextId: "documento-123" };
  const productPoll = {
    type: "poll",
    question: "📦 🦺 QUAL PRODUTO EPI FOI ENTREGUE?",
    options: [{ id: "629", reply: "629", label: "629 - PROTETOR SOLAR (UN)" }],
  };
  const morePoll = {
    type: "poll",
    question: "DESEJA APONTAR OUTRO PRODUTO EPI?",
    options: [
      { id: "yes", reply: "yes", label: "✅ SIM" },
      { id: "no", reply: "no", label: "❌ NÃO" },
    ],
  };

  const first = makeHarness();
  await first.controller.start();
  first.store.ingestRemoteMessages([productPoll], { activeFlow });
  first.client.sendText = async payload => {
    first.chatCalls.push(["text", payload]);
    if (payload.replyId === "629") return { status: "processed", activeFlow, messages: [morePoll] };
    if (payload.replyId === "yes") return { status: "processed", activeFlow, messages: [productPoll] };
    throw new Error(`Resposta inesperada: ${JSON.stringify(payload)}`);
  };
  await first.view.emit("select-reply", { replyId: "629", label: "629 - PROTETOR SOLAR (UN)" });
  first.controller.stop();

  const reopened = makeHarness();
  t.after(() => reopened.controller.stop());
  reopened.client.sendText = async payload => {
    reopened.chatCalls.push(["text", payload]);
    if (payload.replyId === "input_continue") return { status: "processed", activeFlow, messages: [productPoll] };
    if (payload.replyId === "navigation_back") return { status: "processed", activeFlow, messages: [morePoll] };
    if (payload.replyId === "no") {
      return {
        status: "processed",
        activeFlow,
        messages: [{
          type: "poll",
          question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.",
          options: [{ id: "document_signing_draw_signature", label: "✍️ ASSINAR NA TELA" }],
        }],
      };
    }
    throw new Error(`Resposta inesperada: ${JSON.stringify(payload)}`);
  };

  await reopened.controller.start();
  assert.deepEqual(reopened.store.getState().messages.at(-1).options.map(option => option.id), [
    "document_line_finalize",
    "629",
  ]);

  await reopened.view.emit("select-reply", {
    replyId: "document_line_finalize",
    label: "✅ FINALIZAR",
  });

  assert.deepEqual(
    reopened.chatCalls.map(([, payload]) => payload.replyId),
    ["input_continue", "navigation_back", "no"],
  );
});

test("não restaura FINALIZAR quando a VM omite o contexto do documento", { concurrency: false }, async t => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const records = new Map([["energetico.document-line-selection:a1", JSON.stringify({
    contextId: "documento-anterior",
    productKind: "epi",
    finalizeOption: { id: "no", reply: "no", label: "❌ NÃO" },
  })]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) { return records.get(key) ?? null; },
      setItem(key, value) { records.set(key, String(value)); },
      removeItem(key) { records.delete(key); },
    },
  });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  });

  const h = makeHarness();
  t.after(() => h.controller.stop());
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "input_continue") {
      return {
        status: "processed",
        activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
        messages: [{
          type: "poll",
          question: "📦 🦺 QUAL PRODUTO EPI FOI ENTREGUE?",
          options: [{ id: "629", reply: "629", label: "629 - PROTETOR SOLAR (UN)" }],
        }],
      };
    }
    throw new Error(`Resposta inesperada: ${JSON.stringify(payload)}`);
  };

  await h.controller.start();

  assert.deepEqual(h.store.getState().messages.at(-1).options.map(option => option.id), ["629"]);
});

test("apagar a busca durante uma resposta restaura a lista completa", async t => {
  const h = makeHarness({ databaseFilterDebounceMs: 1 });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS" };
  const filterPoll = options => ({
    type: "poll",
    question: "QUAL O PRODUTO?",
    databaseFilter: true,
    databaseFilterKey: "product",
    options,
  });
  h.store.ingestRemoteMessages([filterPoll([{ id: "3", label: "ARGAMASSA", reply: "3" }])], { activeFlow });
  const firstResponse = deferred();
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    if (payload.replyId === "filter_clear") {
      return { status: "processed", activeFlow, messages: [filterPoll([{ id: "3", label: "ARGAMASSA", reply: "3" }])] };
    }
    return firstResponse.promise;
  };

  await h.view.emit("draft-changed", { value: "are" });
  await h.view.emit("database-filter-changed", { value: "are", filterKey: "product" });
  await new Promise(resolve => setTimeout(resolve, 10));
  await h.view.emit("draft-changed", { value: "" });
  await h.view.emit("database-filter-changed", { value: "", filterKey: "product" });
  firstResponse.resolve({
    status: "processed",
    activeFlow,
    messages: [filterPoll([{ id: "5", label: "AREIA MÉDIA", reply: "5" }])],
  });
  await new Promise(resolve => setTimeout(resolve, 80));

  assert.deepEqual(payloads, [
    { text: "are", replyId: "filter_query" },
    { text: "Limpar filtro", replyId: "filter_clear" },
  ]);
  assert.equal(h.store.getState().draft, "");
  assert.equal(h.store.getState().messages.at(-1).options[0].label, "ARGAMASSA");
});

test("três palavras aguardam o envio manual e então limpam o campo", async t => {
  const h = makeHarness({ databaseFilterDebounceMs: 1 });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "flow", title: "FLUXO" };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "QUAL O FORNECEDOR?",
    databaseFilter: true,
    databaseFilterKey: "supplier",
    options: [{ id: "1", label: "FORNECEDOR", reply: "1" }],
  }], { activeFlow });
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    return {
      status: "processed",
      activeFlow,
      messages: [{
        type: "poll",
        question: "QUAL O FORNECEDOR?",
        databaseFilter: true,
        databaseFilterKey: "supplier",
        options: [{ id: "2", label: "EMPRESA DE TESTE LTDA", reply: "2" }],
      }],
    };
  };

  await h.view.emit("draft-changed", { value: "empresa de teste" });
  await h.view.emit("database-filter-changed", { value: "empresa de teste", filterKey: "supplier" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(payloads, []);
  assert.equal(h.store.getState().draft, "empresa de teste");

  await h.view.emit("send-text", {});
  assert.deepEqual(payloads, [{ text: "empresa de teste", replyId: "filter_query" }]);
  assert.equal(h.store.getState().draft, "");
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function sharedFile(id) {
  const file = new File(["pdf"], `${id}.pdf`, { type: "application/pdf" });
  Object.defineProperty(file, "sourceId", { value: id });
  return file;
}

test("compartilhamento confirmado atualiza finalizar do documento mesmo sem nova pergunta", async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const h = makeHarness({ historyMode: 'current-step', view: createChatView(root) });
  t.after(() => { h.controller.stop(); h.view.destroy(); dom.window.close(); });
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  const activeFlow = { id: 'document', title: 'ADICIONAR UM NOVO DOCUMENTO', contextId: 'shared-document' };
  const prompt = {
    id: 'first-document-attachment', type: 'poll',
    question: '📎 ENVIE O PRIMEIRO ANEXO DO DOCUMENTO. DEPOIS DE CADA ENVIO, VOCÊ PODERÁ ADICIONAR MAIS ANEXOS OU FINALIZAR.',
    options: [{ id: 'attachment_upload_continue', label: '📎 ENVIAR ANEXO' }],
  };
  h.store.ingestRemoteMessages([prompt], { activeFlow, attachments: [] });
  h.store.setDraft('texto preservado');
  const attachments = [{ id: 'shared-confirmed', fileName: 'whatsapp-teste.pdf', mimeType: 'application/pdf', size: 3, mediaUrl: '/api/portal-media/shared-confirmed' }];
  const file = sharedFile('whatsapp-teste');
  Object.defineProperty(file, 'confirmedResult', { value: { status: 'processed', messages: [], activeFlow, attachments } });
  const inbox = [file];
  h.native.importSharedItems = async () => inbox;
  h.native.discardSharedItem = async id => { h.discarded.push(id); inbox.length = 0; };
  const before = h.chatCalls.length;
  await resume();
  assert.equal(h.chatCalls.length, before, 'receber o arquivo confirmado não reenvia bytes nem finaliza');
  assert.deepEqual(h.discarded, ['whatsapp-teste']);
  assert.equal(h.store.getState().attachments.length, 1);
  assert.equal(h.store.getState().draft, 'texto preservado');
  const finish = root.querySelector('.chat-choice-list [data-action="finish-flow"]');
  assert.ok(finish, 'a mensagem oferece finalizar sem abrir o seletor de arquivos');
  assert.equal(finish.disabled, false);
  assert.match(root.querySelector('.chat-bubble').textContent, /1 JÁ ADICIONADO/);
  assert.doesNotMatch(root.querySelector('.chat-bubble').textContent, /PRIMEIRO ANEXO/);

  h.client.sendText = async payload => {
    h.chatCalls.push(['text', payload]);
    return { status: 'processed', activeFlow, messages: [{ type: 'text', text: 'Qual é a descrição do documento?' }], attachments };
  };
  finish.click();
  for (let attempt = 0; attempt < 20 && !/Qual é a descrição/.test(root.textContent); attempt++)
    await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.chatCalls.at(-1), ['text', { text: 'FINALIZAR' }]);
  assert.match(root.textContent, /Qual é a descrição do documento/);
  assert.equal(h.store.getState().attachments.length, 1);
  assert.equal(root.querySelector('.chat-choice-list [data-action="finish-flow"]'), null);
});

test("finalizar documento respeita a opção e o bloqueio enviados pelo servidor", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: 'document', title: 'ADICIONAR UM NOVO DOCUMENTO' };
  const message = { type: 'poll', question: 'Envie os anexos do documento.', options: [
    { id: 'attachment_upload_continue', label: 'ENVIAR ANEXO' },
    { id: 'finish_attachments', label: '✅ FINALIZAR', disabled: true },
  ] };
  h.store.ingestRemoteMessages([message], { activeFlow });
  const before = h.chatCalls.length;
  assert.equal(await h.view.emit('finish-flow'), false);
  assert.equal(h.chatCalls.length, before);
  h.store.ingestRemoteMessages([{ ...message, options: message.options.map(option => ({ ...option, disabled: false })) }], { activeFlow });
  await h.view.emit('finish-flow');
  assert.deepEqual(h.chatCalls.at(-1), ['text', { text: '✅ FINALIZAR', replyId: 'finish_attachments' }]);
});

for (const status of ['pending', 'failed', 'sending']) {
  test(`documento com compartilhado confirmado e outro anexo ${status} não finaliza`, async t => {
    const h = makeHarness();
    t.after(() => h.controller.stop());
    await h.controller.start();
    h.store.ingestRemoteMessages([{
      type: 'poll', question: 'ENVIE O PRIMEIRO ANEXO DO DOCUMENTO.',
      options: [{ id: 'attachment_upload_continue', label: 'ENVIAR ANEXO' }],
    }], { activeFlow: { id: 'document', title: 'ADICIONAR UM NOVO DOCUMENTO' },
      attachments: [{ id: 'ready', fileName: 'confirmado.pdf', mimeType: 'application/pdf', size: 3, mediaUrl: '/api/portal-media/ready' }] });
    h.store.queueFiles([new File(['pdf'], 'segundo.pdf', { type: 'application/pdf' })]);
    const id = h.store.getState().pendingFiles[0].id;
    if (status === 'failed') h.store.markFileError(id, new Error('Falha de conexão'));
    if (status === 'sending') h.store.beginFile(id);
    const markup = renderChatMarkup(h.view.renders.at(-1));
    const dom = new JSDOM(markup);
    assert.ok(dom.window.document.querySelector('.chat-choice-list [data-action="finish-flow"]'));
    if (status === 'sending') assert.equal(dom.window.document.querySelector('.chat-choice-list [data-action="finish-flow"]').disabled, true);
    dom.window.close();
    const before = h.chatCalls.length;
    assert.equal(await h.view.emit('finish-flow'), false);
    assert.equal(h.chatCalls.length, before);
    assert.equal(h.store.getState().attachments.length, 1);
    assert.equal(h.store.getState().pendingFiles.length, 1);
  });
}

test("lixeira de documento pendente exige confirmação antes de enviar exclusão", async t => {
  const h = makeHarness();
  t.after(() => { h.controller.stop(); });
  await h.controller.start();
  const initialCalls = h.chatCalls.length;

  await h.view.emit("select-reply", {
    replyId: "pending_document_delete:262",
    label: "Excluir documento 262",
  });
  assert.equal(h.chatCalls.length, initialCalls);

  await h.view.emit("select-reply", {
    replyId: "pending_document_delete_confirmed:262",
    label: "Excluir documento 262",
  });
  assert.equal(h.chatCalls.at(-1)[0], "text");
  assert.equal(h.chatCalls.at(-1)[1].replyId, "pending_document_delete_confirmed:262");
});

test("finalizar anexos envia o comando literal para avançar a pergunta", async () => {
  const h = makeHarness();
  await h.controller.start();

  await h.view.emit("finish-flow");

  assert.deepEqual(h.chatCalls.at(-1), ["text", { text: "FINALIZAR" }]);
  h.controller.stop();
});

test("finalizar diário usa a opção atual da VM e preserva os quatro anexos até a junção", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "construction_diary_fill", title: "DIÁRIO DE OBRAS" };
  const attachments = Array.from({ length: 4 }, (_, index) => ({
    id: `photo-${index}`, fileName: `foto-${index}.jpg`, mimeType: "image/jpeg",
    mediaUrl: `/api/portal-media/photo-${index}`,
  }));
  h.store.ingestRemoteMessages([{ type: "poll", question: "ENVIE UMA FOTO OU UM PDF.", options: [
    { id: "attachment_upload_continue", label: "ENVIAR ANEXO" },
    { id: "finish-id", reply: "server-finish", label: "✅ FINALIZAR" },
  ] }], { activeFlow });
  h.store.syncAttachments(attachments);
  h.client.getAttachments = async () => attachments;
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload);
    return { status: "processed", activeFlow, attachments, messages: [{
      type: "poll", question: "COMO DESEJA ORGANIZAR OS ANEXOS?",
      options: [{ id: "merge-photos", label: "JUNTAR FOTOS" }],
    }] };
  };
  await h.view.emit("finish-flow");
  assert.equal(calls.length, 1);
  const { onProgress, progressSignal, ...reply } = calls[0];
  assert.deepEqual(reply, { text: "✅ FINALIZAR", replyId: "server-finish" });
  assert.equal(typeof onProgress, "function");
  assert.equal(progressSignal.aborted, true, "a consulta opcional termina junto com a resposta");
  assert.equal(h.store.getState().attachments.length, 4);
  assert.equal(h.store.getState().messages.at(-1).question, "COMO DESEJA ORGANIZAR OS ANEXOS?");
});

test("finalizar diário informa quando a VM não avançou e mantém os anexos", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "construction_diary_fill", title: "DIÁRIO DE OBRAS" };
  const poll = { type: "poll", question: "ENVIE UMA FOTO OU UM PDF.", options: [
    { id: "attachment_upload_continue", label: "ENVIAR ANEXO" },
    { id: "abandon_construction_diary", label: "ABANDONAR DIÁRIO DE OBRAS" },
  ] };
  const attachments = [{ id: "photo", fileName: "foto.jpg", mediaUrl: "/api/portal-media/photo" }];
  h.store.ingestRemoteMessages([poll], { activeFlow });
  h.store.syncAttachments(attachments);
  h.client.getAttachments = async () => attachments;
  h.client.sendText = async () => ({ status: "processed", activeFlow, attachments, messages: [poll] });
  await h.view.emit("finish-flow");
  assert.equal(h.store.getState().attachments.length, 1);
  assert.match(h.view.renders.at(-1).error, /VM.*não avançou.*anexos.*preservados/i);
});

test("diário preenchido limpa o PDF antigo antes de selecionar outro diário", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRA" };
  const oldPdf = { id: "diary-202-pdf", fileName: "DIARIO-DE-OBRA-202-FOTOS.pdf",
    mimeType: "application/pdf", mediaUrl: "/api/portal-media/diary-202-pdf" };
  h.store.ingestRemoteMessages([{ type: "poll", question: "CONFIRME O DIÁRIO DE OBRAS", options: [] }], { activeFlow });
  h.store.syncAttachments([oldPdf]);
  let remoteAttachments = [oldPdf];
  h.client.getAttachments = async () => remoteAttachments;
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    remoteAttachments = [];
    return { status: "processed", activeFlow, attachments: [], results: [{
      status: "awaiting_next_construction_diary", sharepoint_item_id: 202,
    }], messages: [
      { type: "text", text: "DIÁRIO DE OBRA PREENCHIDO: ID 202" },
      { type: "poll", question: "DESEJA PREENCHER MAIS ALGUM?", options: [{ id: "205", label: "205" }] },
    ] };
  };

  h.store.setDraft("CONFIRMAR");
  assert.equal(await h.view.emit("send-text"), true);
  assert.deepEqual(h.store.getState().attachments, []);
  assert.equal(await h.view.emit("select-reply", { label: "205", replyId: "205" }), true);
  assert.deepEqual(h.chatCalls.slice(-2), [
    ["text", { text: "CONFIRMAR" }],
    ["text", { text: "205", replyId: "205" }],
  ]);
  assert.equal(h.view.renders.at(-1).error, null);
});

test("finalizar aceita os quatro anexos quando a VM renova IDs após outra pergunta", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "construction_diary_fill", title: "DIÁRIO DE OBRAS" };
  const old = Array.from({ length: 4 }, (_, index) => ({ id: `old-${index}`,
    fileName: `foto-${index}.jpg`, mimeType: "image/jpeg", size: 100 + index,
    mediaUrl: `/api/portal-media/old-${index}`,
  }));
  const current = old.map((attachment, index) => ({ ...attachment, id: `new-${index}`,
    mediaUrl: `/api/portal-media/new-${index}`,
  }));
  h.store.ingestRemoteMessages([{ type: "poll", question: "ENVIE UMA FOTO OU UM PDF.",
    options: [{ id: "attachment_upload_continue", label: "ENVIAR ANEXO" }],
  }], { activeFlow });
  h.store.syncAttachments(old);
  h.client.getAttachments = async () => current;
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload);
    return { status: "processed", activeFlow, attachments: current, messages: [{
      type: "poll", question: "COMO DESEJA COMPRIMIR OS ARQUIVOS?", options: [],
    }] };
  };
  await h.view.emit("finish-flow");
  assert.deepEqual(calls, [{ text: "FINALIZAR" }]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), current.map(item => item.id));
  assert.equal(h.view.renders.at(-1).error, null);
});

for (const ambiguous of [false, true]) {
  test(`finalizar não aceita anexo ${ambiguous ? "ambíguo" : "ausente"} após renovação de IDs`, async t => {
    const h = makeHarness();
    t.after(() => h.controller.stop());
    await h.controller.start();
    const original = { id: "old", fileName: "foto.jpg", mimeType: "image/jpeg", size: 100,
      mediaUrl: "/api/portal-media/old" };
    h.store.syncAttachments([original]);
    h.client.getAttachments = async () => ambiguous ? ["new-1", "new-2"].map(id => ({
      ...original, id, mediaUrl: `/api/portal-media/${id}`,
    })) : [{ ...original, id: "new", fileName: "outra.jpg", mediaUrl: "/api/portal-media/new" }];
    const count = h.chatCalls.length;
    assert.equal(await h.view.emit("finish-flow"), false);
    assert.equal(h.chatCalls.length, count);
    assert.equal(h.store.getState().attachments[0].id, "old");
    assert.match(h.view.renders.at(-1).error, /não confirmou todos os anexos/i);
  });
}

test("dois cliques em finalizar durante conferência dos anexos enviam uma única finalização", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const attachment = { id: "photo", fileName: "foto.jpg", mediaUrl: "/api/portal-media/photo" };
  h.store.syncAttachments([attachment]);
  const snapshot = deferred();
  h.client.getAttachments = () => snapshot.promise;
  const first = h.view.emit("finish-flow");
  const second = h.view.emit("finish-flow");
  snapshot.resolve([attachment]);
  await Promise.all([first, second]);
  assert.equal(h.chatCalls.filter(([kind, payload]) => kind === "text" && payload.text === "FINALIZAR").length, 1);
});

test("finalizar respeita opção desativada pela VM", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{ type: "poll", question: "ENVIE UMA FOTO OU UM PDF.", options: [
    { id: "attachment_upload_continue", label: "ENVIAR ANEXO" },
    { id: "server-finish", label: "FINALIZAR", disabled: true },
  ] }], { activeFlow: { id: "construction_diary_fill", title: "DIÁRIO DE OBRAS" } });
  const before = h.chatCalls.length;
  assert.equal(await h.view.emit("finish-flow"), false);
  assert.equal(h.chatCalls.length, before);
});

test("fluxo ativo agenda lembrete nativo ao sair do aplicativo", async () => {
  const h = makeHarness();
  let onBackground;
  const scheduled = [];
  let cancelled = 0;
  h.native.onResume = async (_onResume, background) => {
    onBackground = background;
    return () => {};
  };
  h.native.scheduleFlowReminder = async details => {
    scheduled.push(details);
    return true;
  };
  h.native.cancelFlowReminder = async () => { cancelled += 1; };
  h.client.sendText = async payload => ({
    status: "processed",
    messages: [{ type: "text", text: "Pergunta" }],
    activeFlow: { id: "task", title: "ADICIONAR UMA NOVA TAREFA" },
  });

  await h.controller.start();
  assert.equal(typeof onBackground, "function");
  await onBackground();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduled.length, 1);
  assert.match(scheduled[0].body, /ADICIONAR UMA NOVA TAREFA/);
  await h.view.emit("sign-out");
  assert.ok(cancelled >= 2, "o lembrete deve ser cancelado ao voltar ou sair");
  h.controller.stop();
});

function provisionCooldownHarness(t, values = new Map()) {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
  });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  });
  return (accountId = 'cooldown-user', view) => {
    const h = makeHarness({ account: { homeAccountId: accountId, name: 'Bernardo' }, view });
    h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: '306', supplier: 'VIVO' }] });
    t.after(() => h.controller.stop());
    return h;
  };
}

test('provisões automáticas persistem o intervalo de 30 minutos ao reiniciar o app', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T12:00:00Z') });
  const create = provisionCooldownHarness(t);
  const first = create();
  await first.controller.start();
  assert.equal(first.view.renders.at(-1).pendingProvisions.rows[0].id, '306');
  first.controller.stop();

  t.mock.timers.setTime(new Date('2026-10-05T12:29:59.999Z').getTime());
  const before = create();
  await before.controller.start();
  assert.equal(before.view.renders.at(-1).pendingProvisions, null);
  before.controller.stop();

  t.mock.timers.setTime(new Date('2026-10-05T12:30:00Z').getTime());
  const boundary = create();
  await boundary.controller.start();
  assert.equal(boundary.view.renders.at(-1).pendingProvisions.rows[0].id, '306');
  boundary.controller.stop();
  const immediate = create();
  await immediate.controller.start();
  assert.equal(immediate.view.renders.at(-1).pendingProvisions, null);
});

test('provisões voltam no retorno ao app após 30 minutos mesmo depois do X', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T12:00:00Z') });
  const h = provisionCooldownHarness(t)();
  await h.controller.start();
  await h.view.emit('dismiss-pending-provisions');
  t.mock.timers.setTime(new Date('2026-10-05T12:29:59Z').getTime());
  await h.controller.handleForeground();
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  t.mock.timers.setTime(new Date('2026-10-05T12:30:00Z').getTime());
  await h.controller.handleForeground();
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows[0].id, '306');
});

test('mascote abre provisões durante o intervalo sem adiar a próxima abertura automática', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T12:00:00Z') });
  const create = provisionCooldownHarness(t);
  const first = create();
  await first.controller.start();
  first.controller.stop();
  t.mock.timers.setTime(new Date('2026-10-05T12:20:00Z').getTime());
  const manual = create();
  await manual.controller.start();
  assert.equal(manual.view.renders.at(-1).pendingProvisions, null);
  assert.equal(await manual.view.emit('open-pending-provisions'), true);
  assert.equal(manual.view.renders.at(-1).pendingProvisions.rows[0].id, '306');
  manual.controller.stop();
  t.mock.timers.setTime(new Date('2026-10-05T12:30:00Z').getTime());
  const automatic = create();
  await automatic.controller.start();
  assert.equal(automatic.view.renders.at(-1).pendingProvisions.rows[0].id, '306');
});

for (const choice of ['always', '2h', 'today']) test(`intervalo automático preserva a escolha de lembrete ${choice}`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T12:00:00Z') });
  const create = provisionCooldownHarness(t);
  const first = create();
  await first.controller.start();
  await first.view.emit('close-pending-provisions');
  await first.view.emit('pending-provisions-reminder-choice', { value: choice });
  first.controller.stop();
  t.mock.timers.setTime(new Date('2026-10-05T12:10:00Z').getTime());
  const early = create();
  await early.controller.start();
  assert.equal(early.view.renders.at(-1).pendingProvisions, null);
  early.controller.stop();
  t.mock.timers.setTime(new Date('2026-10-05T12:30:00Z').getTime());
  const later = create();
  await later.controller.start();
  if (choice === 'always') assert.equal(later.view.renders.at(-1).pendingProvisions.rows[0].id, '306');
  else assert.equal(later.view.renders.at(-1).pendingProvisions, null);
});

test('intervalo de provisões não é compartilhado entre contas', async t => {
  const create = provisionCooldownHarness(t);
  const first = create('account-one');
  await first.controller.start();
  first.controller.stop();
  const second = create('account-two');
  await second.controller.start();
  assert.equal(second.view.renders.at(-1).pendingProvisions.rows[0].id, '306');
});

test('consulta vazia ou falha não consome o intervalo automático de provisões', async t => {
  const create = provisionCooldownHarness(t);
  for (const result of [() => ({ due: false, rows: [] }), () => { throw new Error('Offline'); }]) {
    const h = create();
    h.client.getPendingProvisionSnapshot = async () => result();
    await h.controller.start();
    assert.equal(h.view.renders.at(-1).pendingProvisions, null);
    h.controller.stop();
  }
  const success = create();
  await success.controller.start();
  assert.equal(success.view.renders.at(-1).pendingProvisions.rows[0].id, '306');
});

test('armazenamento bloqueado não impede início nem intervalo de provisões na mesma sessão', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T12:00:00Z') });
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('Storage blocked', 'SecurityError'); },
  });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  });
  const h = makeHarness();
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: '306', supplier: 'VIVO' }] });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows[0].id, '306');
  await h.view.emit('dismiss-pending-provisions');
  t.mock.timers.setTime(new Date('2026-10-05T12:29:59Z').getTime());
  await h.controller.handleForeground();
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  t.mock.timers.setTime(new Date('2026-10-05T12:30:00Z').getTime());
  await h.controller.handleForeground();
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows[0].id, '306');
});

test('retorno respeita abertura automática mais recente de outra janela da mesma conta', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T12:00:00Z') });
  const create = provisionCooldownHarness(t);
  const first = create();
  await first.controller.start();
  await first.view.emit('dismiss-pending-provisions');
  t.mock.timers.setTime(new Date('2026-10-05T12:31:00Z').getTime());
  const second = create();
  await second.controller.start();
  assert.equal(second.view.renders.at(-1).pendingProvisions.rows[0].id, '306');
  second.controller.stop();
  t.mock.timers.setTime(new Date('2026-10-05T13:00:00Z').getTime());
  await first.controller.handleForeground();
  assert.equal(first.view.renders.at(-1).pendingProvisions, null);
  t.mock.timers.setTime(new Date('2026-10-05T13:01:00Z').getTime());
  await first.controller.handleForeground();
  assert.equal(first.view.renders.at(-1).pendingProvisions.rows[0].id, '306');
});

test('popup real fica fechado após reiniciar no intervalo e o mascote continua funcionando', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T12:00:00Z') });
  const create = provisionCooldownHarness(t);
  const first = create();
  await first.controller.start();
  first.controller.stop();
  t.mock.timers.setTime(new Date('2026-10-05T12:01:00Z').getTime());
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  const h = create('cooldown-user', view);
  t.after(() => { h.controller.stop(); view.destroy(); dom.window.close(); });
  await h.controller.start();
  assert.equal(root.querySelector('[data-pending-provisions-dialog]'), null);
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [
    { id: 'group_pending', reply: 'group_pending', label: '⏳ PENDÊNCIAS (47)' },
  ] }], { activeFlow: null });
  root.querySelector('[data-action="open-pending-provisions"]').click();
  for (let attempt = 0; attempt < 50 && !root.querySelector('[data-pending-provisions-dialog]'); attempt++)
    await new Promise(resolve => setImmediate(resolve));
  assert.match(root.querySelector('[data-pending-provisions-dialog]').textContent, /VIVO/);
  root.querySelector('[data-action="dismiss-pending-provisions"]').click();
  assert.equal(root.querySelector('[data-pending-provisions-dialog]'), null);
  t.mock.timers.setTime(new Date('2026-10-05T12:30:00Z').getTime());
  await h.controller.handleForeground();
  assert.match(root.querySelector('[data-pending-provisions-dialog]').textContent, /VIVO/);
});

test("abre provisões vencidas e aplica o adiamento de duas horas ao fechar", async () => {
  const h = makeHarness();
  const scheduled = [];
  h.client.getPendingProvisionSnapshot = async () => ({
    due: true,
    rows: [{ supplier: "Fornecedor A", dueDate: "11/09/2026", product: "Material", total: "R$ 120,00" }],
  });
  h.native.scheduleProvisionReminder = async details => { scheduled.push(details); return true; };
  h.native.cancelProvisionReminder = async () => {};

  await h.controller.start();
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 1);
  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, false);
  await h.view.emit("close-pending-provisions");
  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, true);
  await h.view.emit("pending-provisions-reminder-choice", { value: "2h" });
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 2 * 60 * 60 * 1000);
  h.controller.stop();
});

test("avisa notas sem lançamento uma vez ao abrir e não ao navegar", async t => {
  const h = makeHarness();
  let reads = 0;
  h.client.getPendingNotesSnapshot = async () => {
    reads++;
    return { count: 1, rows: [{ id: "13", supplier: "Terceiro", label: "13 - Terceiro" }] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(h.view.renders.at(-1).pendingNotes.rows[0].id, "13");
  await h.view.emit("dismiss-pending-notes");
  assert.equal(h.view.renders.at(-1).pendingNotes, null);
  await h.view.emit("select-reply", { replyId: "action_pending" });
  await h.controller.handleForeground();
  assert.equal(h.view.renders.at(-1).pendingNotes, null);
  assert.equal(reads, 1);
});

test("lápis da nota seleciona o pedido existente e entrega a pergunta de pagamento ao usuário", async t => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const h = makeHarness({ view: createChatView(root) });
  const { calls, replies } = configurePendingNoteWorkflow(h);
  t.after(() => { h.controller.stop(); h.view.destroy(); dom.window.close(); });
  await h.controller.start();
  const edit = root.querySelector('[data-action="launch-pending-note"][data-order-id="13"]');
  assert.ok(edit);
  edit.click();
  for (let attempt = 0; attempt < 30 && root.querySelector('[data-pending-notes-dialog]'); attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.deepEqual(calls, ["input_continue", ...replies]);
  assert.match(h.store.getState().messages.at(-1).question, /DATA DE PAGAMENTO PREVISTO/);
  assert.equal(root.querySelector('[data-pending-notes-dialog]'), null);
});

test("lápis envia ID numérico se o pedido ficou fora da primeira página de opções", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, { orderOffscreen: true });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), true);
  assert.deepEqual(calls, ["input_continue", "group_supplies", "action_supply_launches", "action_launch",
    "choice:pedido_lancamento:2", "choice:tipo_lancamento:2", undefined]);
  assert.match(h.store.getState().messages.at(-1).question, /DATA DE PAGAMENTO PREVISTO/);
});

test("lápis segue o submenu e a modalidade singular definidos em workflow_config.json", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h);
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), true,
    h.view.renders.at(-1).error);
  assert.deepEqual(calls, ["input_continue", "group_supplies", "action_supply_launches", "action_launch",
    "choice:pedido_lancamento:2", "choice:tipo_lancamento:2", "choice:pedido_existente_lancamento:13"]);
  assert.match(h.store.getState().messages.at(-1).question, /DATA DE PAGAMENTO PREVISTO/);
  assert.equal(h.view.renders.at(-1).pendingNotes, null);
});

test("lápis não confunde Efetuar Lançamento de Gastos Pessoais com o submenu de Suprimentos", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, { initial: "personal" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), true,
    h.view.renders.at(-1).error);
  assert.deepEqual(calls, ["input_continue", "portal_confirm_main_menu", "group_supplies",
    "action_supply_launches", "action_launch", "choice:pedido_lancamento:2", "choice:tipo_lancamento:2",
    "choice:pedido_existente_lancamento:13"]);
  assert.equal(calls.includes("action_personal_expense_launch"), false);
});

test("lápis exige confirmação humana antes de sair de Assinar documentos", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, { initial: "document" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  assert.deepEqual(calls, ["input_continue", "portal_confirm_main_menu"]);
  assert.match(h.view.renders.at(-1).error, /Confirme na conversa/);
});

test("lápis não abandona diário de obras automaticamente", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, { initial: "diary" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  assert.deepEqual(calls, ["input_continue", "abandon_construction_diary"]);
  assert.match(h.view.renders.at(-1).error, /Confirme na conversa/);
});

test("falha em cada transição preserva popup e erro real; retry retoma a etapa da VM", async t => {
  for (const failAt of pendingNoteWorkflowScreens().replies) {
    const h = makeHarness();
    const { calls } = configurePendingNoteWorkflow(h, { failAt });
    t.after(() => h.controller.stop());
    await h.controller.start();
    assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false, failAt);
    assert.equal(h.view.renders.at(-1).pendingNotes?.rows[0].id, "13", failAt);
    assert.match(h.view.renders.at(-1).error, /Falha real da VM/, failAt);
    assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), true, failAt);
    assert.match(h.store.getState().messages.at(-1).question, /DATA DE PAGAMENTO PREVISTO/, failAt);
    assert.equal(calls.includes("portal_confirm_main_menu"), false, failAt);
  }
});

test("resposta perdida após a VM avançar permite retomar sem repetir escolha", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, {
    failAt: "choice:tipo_lancamento:2", advanceBeforeFailure: true,
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  assert.equal(h.view.renders.at(-1).pendingNotes?.rows[0].id, "13");
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), true);
  assert.equal(calls.filter(id => id === "choice:tipo_lancamento:2").length, 1);
  assert.equal(calls.at(-1), "choice:pedido_existente_lancamento:13");
});

test("data de outro lançamento é abandonada antes de abrir a nota 13", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, { initial: "date" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), true);
  assert.deepEqual(calls, ["input_continue", "portal_confirm_main_menu", ...pendingNoteWorkflowScreens().replies]);
  assert.equal(h.view.renders.at(-1).pendingNotes, null);
});

test("modalidade já escolhida em NOVO PEDIDO é abandonada antes da nota 13", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, { initial: "new-order-modality" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), true);
  assert.deepEqual(calls, ["input_continue", "portal_confirm_main_menu", ...pendingNoteWorkflowScreens().replies]);
  assert.equal(h.view.renders.at(-1).pendingNotes, null);
});

test("resposta perdida após enviar ID 13 aceita data somente após ressincronizar a VM", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, {
    failAt: "choice:pedido_existente_lancamento:13", advanceBeforeFailure: true,
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  assert.equal(h.view.renders.at(-1).pendingNotes?.rows[0].id, "13");
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), true);
  assert.equal(calls.filter(id => id === "choice:pedido_existente_lancamento:13").length, 1);
  assert.equal(calls.at(-1), "input_continue");
  assert.equal(h.view.renders.at(-1).pendingNotes, null);
});

test("retry não aceita data quando outro dispositivo selecionou pedido 14 após envio incerto de 13", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, {
    failAt: "choice:pedido_existente_lancamento:13", advanceBeforeFailure: true,
    selectedOrderId: "14",
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  assert.equal(h.view.renders.at(-1).pendingNotes?.rows[0].id, "13");
  assert.equal(calls.filter(id => id === "choice:pedido_existente_lancamento:13").length, 1);
});

test("retry não aceita data sem ID de pedido verificado no estado retornado", async t => {
  const h = makeHarness();
  configurePendingNoteWorkflow(h, {
    failAt: "choice:pedido_existente_lancamento:13", advanceBeforeFailure: true,
    selectedOrderId: null,
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  assert.equal(h.view.renders.at(-1).pendingNotes?.rows[0].id, "13");
});

test("resposta imediata de data não fecha popup se VM selecionou outro ID", async t => {
  const h = makeHarness();
  configurePendingNoteWorkflow(h, { selectedOrderId: "14" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  assert.equal(h.view.renders.at(-1).pendingNotes?.rows[0].id, "13");
  assert.match(h.view.renders.at(-1).error, /não confirmou a seleção do pedido 13/i);
});

test("resposta perdida não aceita data se contexto da VM não avançou depois do ID 13", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, {
    failAt: "choice:pedido_existente_lancamento:13", advanceBeforeFailure: true,
    dateContextUnchanged: true,
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  assert.equal(h.view.renders.at(-1).pendingNotes?.rows[0].id, "13");
  assert.equal(calls.at(-1), "input_continue");
});

test("fechar popup limpa prova anterior e nova sessão reinicia o pedido do zero", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, {
    failAt: "choice:pedido_existente_lancamento:13", advanceBeforeFailure: true,
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  await h.view.emit("dismiss-pending-notes");
  await h.view.emit("sign-in");
  assert.equal(h.view.renders.at(-1).pendingNotes?.rows[0].id, "13");
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), true);
  assert.deepEqual(calls.slice(-7), ["portal_confirm_main_menu", ...pendingNoteWorkflowScreens().replies]);
  assert.equal(h.view.renders.at(-1).pendingNotes, null);
});

test("X durante resposta pendente do ID 13 invalida a tentativa em andamento", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h);
  const send = h.client.sendText;
  let release;
  const responseHeld = new Promise(resolve => { release = resolve; });
  h.client.sendText = async payload => {
    const response = await send(payload);
    if (payload.replyId === "choice:pedido_existente_lancamento:13") await responseHeld;
    return response;
  };
  t.after(() => { release?.(); h.controller.stop(); });
  await h.controller.start();
  const attempt = h.view.emit("launch-pending-note", { orderId: "13" });
  for (let i = 0; i < 30 && !calls.includes("choice:pedido_existente_lancamento:13"); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(calls.includes("choice:pedido_existente_lancamento:13"));
  await h.view.emit("dismiss-pending-notes");
  release();
  assert.equal(await attempt, false);
  await h.view.emit("sign-in");
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), true);
  assert.deepEqual(calls.slice(-7), ["portal_confirm_main_menu", ...pendingNoteWorkflowScreens().replies]);
  assert.equal(h.view.renders.at(-1).pendingNotes, null);
});

test("X durante verificação assíncrona de anexos impede envio tardio à VM", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h);
  let releaseVerification;
  let verificationStarted;
  const started = new Promise(resolve => { verificationStarted = resolve; });
  const held = new Promise(resolve => { releaseVerification = resolve; });
  t.after(() => { releaseVerification?.([]); h.controller.stop(); });
  await h.controller.start();
  const attachment = { id: "file-1", fileName: "nota.pdf", mediaUrl: "/api/portal-media/file-1" };
  h.store.syncAttachments([attachment]);
  h.client.getAttachments = () => { verificationStarted(); return held; };

  const attempt = h.view.emit("launch-pending-note", { orderId: "13" });
  await started;
  await h.view.emit("dismiss-pending-notes");
  releaseVerification([attachment]);

  assert.equal(await attempt, false);
  assert.deepEqual(calls, ["input_continue"]);
  assert.equal(h.view.renders.at(-1).pendingNotes, null);
});

test("logout limpa prova anterior e novo login reinicia o pedido do zero", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, {
    failAt: "choice:pedido_existente_lancamento:13", advanceBeforeFailure: true,
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  await h.view.emit("sign-out");
  await h.view.emit("sign-in");
  assert.equal(h.view.renders.at(-1).pendingNotes?.rows[0].id, "13");
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), true);
  assert.deepEqual(calls.slice(-7), ["portal_confirm_main_menu", ...pendingNoteWorkflowScreens().replies]);
  assert.equal(h.view.renders.at(-1).pendingNotes, null);
});

test("etapa inesperada não some com popup nem vira erro genérico de data", async t => {
  const h = makeHarness();
  const { calls } = configurePendingNoteWorkflow(h, { wrongStage: 2 });
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("launch-pending-note", { orderId: "13" }), false);
  assert.deepEqual(calls, ["input_continue", "group_supplies", "action_supply_launches"]);
  assert.equal(h.view.renders.at(-1).pendingNotes?.rows[0].id, "13");
  assert.doesNotMatch(h.view.renders.at(-1).error, /data de pagamento previsto/i);
  assert.match(h.view.renders.at(-1).error, /Efetuar Lançamento|action_launch|submenu/i);
});

test("abre o popup com próximos vencimentos mesmo sem provisões vencidas", async t => {
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    loadUpcomingPayments: async () => [{ id: "306", dueDate: "2026-10-01", supplier: "COFER" }],
    listAttachments: async () => [], downloadAttachment: async () => new Blob(),
  }) });
  t.after(() => h.controller.stop());
  h.client.getPendingProvisionSnapshot = async () => ({ due: false, rows: [] });
  await h.controller.start();
  assert.equal(h.view.renders.at(-1).pendingProvisions?.due, true);
  assert.deepEqual(h.view.renders.at(-1).pendingProvisions?.rows.map(row => row.id), ["306"]);
});

test("confere totais dos vencidos por ID no SharePoint e oculta valores não conferidos quando a consulta falha", async t => {
  let fail = false;
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    loadUpcomingPayments: async options => { assert.equal(options.includeOverdue, true); if (fail) throw new Error("offline"); return [{ id: "306", supplier: "REPETIDO", total: 1250 }, { id: "307", supplier: "FUTURO", total: 2671 }]; },
    listAttachments: async () => [], downloadAttachment: async () => new Blob(),
  }) });
  t.after(() => h.controller.stop());
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "ORIGINAL", total: "120", quantity: "10" }] });
  await h.controller.start();
  assert.deepEqual(h.view.renders.at(-1).pendingProvisions.rows.map(row => row.supplier), ["ORIGINAL", "FUTURO"]);
  assert.deepEqual(h.view.renders.at(-1).pendingProvisions.rows.map(row => row.total), [1250, 2671]);
  await h.view.emit("sign-out");
  fail = true;
  await h.view.emit("sign-in");
  assert.deepEqual(h.view.renders.at(-1).pendingProvisions.rows.map(row => row.supplier), ["ORIGINAL"]);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows[0].total, "");
  assert.equal(h.view.renders.at(-1).pendingProvisions.totalsUnavailable, true);
  assert.equal(h.view.renders.at(-1).pendingProvisions.upcomingUnavailable, true);
});

test("mantém o vencimento editado nos próximos dois dias e remove somente a partir do terceiro", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-30T15:00:00Z") });
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    listAttachments: async () => [], downloadAttachment: async () => new Blob(), updateDueDate: async () => {},
  }) });
  t.after(() => h.controller.stop());
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [
    { id: "306", dueDate: "2026-09-30" }, { id: "307", dueDate: "2026-09-30" },
  ] });
  await h.controller.start();
  await h.view.emit("edit-pending-provision-due-date", { paymentId: "306" });
  await h.view.emit("save-pending-provision-due-date", { paymentId: "306", value: "02/10/2026" });
  assert.deepEqual(h.view.renders.at(-1).pendingProvisions.rows.map(row => row.id), ["306", "307"]);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows[0].dueDate, "02/10/2026");
  await h.view.emit("edit-pending-provision-due-date", { paymentId: "306" });
  await h.view.emit("save-pending-provision-due-date", { paymentId: "306", value: "03/10/2026" });
  assert.deepEqual(h.view.renders.at(-1).pendingProvisions.rows.map(row => row.id), ["307"]);
});

test("editor de vencimento não troca o dia brasileiro pelo prefixo UTC", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", dueDate: "2026-10-02T01:00:00Z" }] });
  await h.controller.start();
  await h.view.emit("edit-pending-provision-due-date", { paymentId: "306" });
  assert.equal(h.view.renders.at(-1).pendingProvisionDateEditValue, "01/10/2026");
});

test("consulta futura sem resposta não impede exibir os vencidos depois de oito segundos", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let markReadStarted;
  const readStarted = new Promise(resolve => { markReadStarted = resolve; });
  let signal;
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    loadUpcomingPayments: async options => { signal = options.signal; markReadStarted(); return new Promise(() => {}); },
    listAttachments: async () => [], downloadAttachment: async () => new Blob(),
  }) });
  t.after(() => h.controller.stop());
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306" }] });
  const start = h.controller.start();
  await readStarted;
  t.mock.timers.tick(8_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).pendingProvisions?.rows[0].id, "306");
  assert.equal(h.view.renders.at(-1).pendingProvisions?.upcomingUnavailable, true);
  assert.equal(signal.aborted, true);
  await start;
});

test("retomar após meia-noite atualiza o popup aberto sem reabrir lembretes nem repetir a consulta", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T02:59:00Z") });
  const h = makeHarness();
  t.after(() => h.controller.stop());
  let resume, reads = 0;
  h.native.onResume = async callback => { resume = callback; return () => {}; };
  h.client.getPendingProvisionSnapshot = async () => { reads++; return { due: true, rows: [{ id: "306", dueDate: "2026-10-01" }] }; };
  await h.controller.start();
  assert.equal(h.view.renders.at(-1).pendingProvisions.today, "2026-09-30");
  t.mock.timers.setTime(new Date("2026-10-01T03:01:00Z").getTime());
  await resume();
  assert.equal(h.view.renders.at(-1).pendingProvisions.today, "2026-10-01");
  assert.equal(reads, 1);
  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, false);
});

test("atualização da cor após meia-noite preserva consultas de anexos em andamento", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T02:59:00Z") });
  let resolveAttachments;
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    listAttachments: async () => new Promise(resolve => { resolveAttachments = resolve; }),
    downloadAttachment: async () => new Blob(),
  }) });
  t.after(() => h.controller.stop());
  let resume;
  h.native.onResume = async callback => { resume = callback; return () => {}; };
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", dueDate: "2026-10-01" }] });
  await h.controller.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).pendingProvisionAttachments["306"].status, "loading");
  t.mock.timers.setTime(new Date("2026-10-01T03:01:00Z").getTime());
  await resume();
  resolveAttachments([{ fileName: "test.pdf" }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).pendingProvisionAttachments["306"].status, "available");
});

test("edita somente o vencimento da provisão escolhida e remove da lista quando passa a vencer no futuro", async t => {
  const writes = [];
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    listAttachments: async () => [],
    downloadAttachment: async () => new Blob(),
    uploadAttachment: async () => {},
    updateDueDate: async (id, date) => { writes.push([id, date]); },
  }) });
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [
    { id: "306", supplier: "DIBRITA", dueDate: "2026-09-23T03:00:00Z" },
    { id: "307", supplier: "OUTRO", dueDate: "2026-09-23T03:00:00Z" },
  ] });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(await h.view.emit("edit-pending-provision-due-date", { paymentId: "306" }), true);
  assert.equal(h.view.renders.at(-1).pendingProvisionDateEditPaymentId, "306");
  assert.equal(h.view.renders.at(-1).pendingProvisionDateEditValue, "23/09/2026");
  assert.equal(await h.view.emit("save-pending-provision-due-date", { paymentId: "306", value: "25/09/2099" }), true);

  assert.deepEqual(writes, [["306", "2099-09-25"]]);
  assert.deepEqual(h.view.renders.at(-1).pendingProvisions.rows.map(row => row.id), ["307"]);
  assert.equal(h.view.renders.at(-1).pendingProvisionDateEditPaymentId, "");
});

test("não tenta gravar vencimento inválido e mantém a tela de correção aberta", async t => {
  let writes = 0;
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    listAttachments: async () => [], downloadAttachment: async () => new Blob(),
    uploadAttachment: async () => {}, updateDueDate: async () => { writes += 1; },
  }) });
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA", dueDate: "2026-09-23T03:00:00Z" }] });
  t.after(() => h.controller.stop());
  await h.controller.start();

  await h.view.emit("edit-pending-provision-due-date", { paymentId: "306" });
  assert.equal(await h.view.emit("save-pending-provision-due-date", { paymentId: "306", value: "31/02/2026" }), false);

  assert.equal(writes, 0);
  assert.equal(h.view.renders.at(-1).pendingProvisionDateEditPaymentId, "306");
  assert.match(h.view.renders.at(-1).pendingProvisionDateEditError, /data|existe/i);
});

test("envia vários anexos ao SharePoint e mantém apenas o arquivo que falhou para retry", async t => {
  const uploaded = [];
  let failSecondOnce = true;
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    listAttachments: async () => [
      { fileName: "antigo.pdf", mimeType: "application/pdf", size: 12 },
      ...uploaded.map(file => ({ fileName: file.name, mimeType: file.type, size: file.size })),
    ],
    downloadAttachment: async () => new Blob(["conteúdo"], { type: "application/pdf" }),
    uploadAttachment: async (id, file) => {
      assert.equal(id, "306");
      if (file.name === "segundo.pdf" && failSecondOnce) { failSecondOnce = false; throw new Error("Falha temporária"); }
      uploaded.push(file);
    },
    updateDueDate: async () => {},
  }) });
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
  const first = new File(["um"], "primeiro.pdf", { type: "application/pdf" });
  const second = new File(["dois"], "segundo.pdf", { type: "application/pdf" });
  h.native.pickDocuments = async () => [first, second];
  t.after(() => h.controller.stop());
  await h.controller.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await h.view.emit("toggle-pending-provision-attachments", { paymentId: "306" }), true);
  await h.view.emit("pick-pending-provision-attachments", { paymentId: "306" });
  assert.deepEqual(h.view.renders.at(-1).pendingProvisionUploads["306"].items.map(item => item.fileName), ["primeiro.pdf", "segundo.pdf"]);

  assert.equal(await h.view.emit("send-pending-provision-attachments", { paymentId: "306" }), false);
  assert.deepEqual(uploaded.map(file => file.name), ["primeiro.pdf"]);
  assert.deepEqual(h.view.renders.at(-1).pendingProvisionUploads["306"].items.map(item => item.fileName), ["segundo.pdf"]);

  assert.equal(await h.view.emit("send-pending-provision-attachments", { paymentId: "306" }), true);
  assert.deepEqual(uploaded.map(file => file.name), ["primeiro.pdf", "segundo.pdf"]);
  assert.deepEqual(h.view.renders.at(-1).pendingProvisionUploads["306"].items, []);
  assert.deepEqual(h.view.renders.at(-1).pendingProvisionAttachments["306"].items.map(item => item.fileName), [
    "antigo.pdf", "primeiro.pdf", "segundo.pdf",
  ]);
});

test("remove somente o arquivo repetido selecionado pelo identificador da fila", async t => {
  const h = makeHarness({ pendingProvisionAttachmentsDataFactory: async () => ({
    listAttachments: async () => [{ fileName: "anterior.pdf", size: 1 }],
    downloadAttachment: async () => new Blob(),
    uploadAttachment: async () => {},
    updateDueDate: async () => {},
  }) });
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
  h.native.pickDocuments = async () => [
    new File(["um"], "duplicado.pdf", { type: "application/pdf" }),
    new File(["dois"], "duplicado.pdf", { type: "application/pdf" }),
  ];
  t.after(() => h.controller.stop());
  await h.controller.start();
  await new Promise(resolve => setImmediate(resolve));
  await h.view.emit("toggle-pending-provision-attachments", { paymentId: "306" });
  await h.view.emit("pick-pending-provision-attachments", { paymentId: "306" });

  const [first, duplicate] = h.view.renders.at(-1).pendingProvisionUploads["306"].items;
  assert.notEqual(first.id, duplicate.id);
  assert.equal(first.status, "ready");
  assert.equal(duplicate.status, "conflict");
  await h.view.emit("remove-pending-provision-upload", { paymentId: "306", uploadId: duplicate.id });

  assert.deepEqual(h.view.renders.at(-1).pendingProvisionUploads["306"].items.map(item => ({ id: item.id, status: item.status })), [
    { id: first.id, status: "ready" },
  ]);
});

test("o check sai do menu de Suprimentos, abre Pendências e inicia a baixa do pagamento escolhido", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({
    due: true,
    rows: [{ id: "306", supplier: "DIBRITA", dueDate: "23/09/2026", product: "DIBRITA 01 · 122", total: "R$ 1.220,00" }],
  });
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === "input_continue") return {
      status: "processed",
      activeFlow: { id: "group_supplies", title: "📦 SUPRIMENTOS" },
      messages: [{
        type: "poll",
        question: "📦 SUPRIMENTOS — QUAL FLUXO VOCÊ DESEJA INICIAR?",
        options: [
          { id: "new_document", reply: "new_document", label: "📄 LANÇAMENTOS" },
          { id: "pending_payment_settlement", reply: "pending_payment_settlement", label: "💰 BAIXAR PAGAMENTO AGENDADO" },
        ],
      }],
    };
    if (payload.replyId === "portal_confirm_main_menu") return {
      status: "processed",
      activeFlow: null,
      resetConversation: true,
      messages: [{
        type: "poll",
        question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?",
        options: [{ id: "group_pending", reply: "group_pending", label: "⏳ PENDÊNCIAS (47)" }],
      }],
    };
    if (payload.replyId === "group_pending") return {
      status: "processed",
      activeFlow: null,
      messages: [{
        type: "poll",
        question: "⏳ PENDÊNCIAS — ESCOLHA O TIPO",
        options: [{ id: "pending_payment_provisions", reply: "pending_payment_provisions", label: "💳 PROVISÕES PGTO PENDENTES (1)" }],
      }],
    };
    if (payload.replyId === "pending_payment_provisions") return {
      status: "processed",
      activeFlow: null,
      messages: [{
        type: "poll",
        question: "💳 PROVISÕES PGTO PENDENTES — QUAL GRUPO DE PROVISÕES DESEJA VER?",
        options: [{ id: "pending_payment_settlement", reply: "pending_payment_settlement", label: "💰 BAIXAR PAGAMENTO AGENDADO" }],
      }],
    };
    if (payload.replyId === "pending_payment_settlement") return {
      status: "processed",
      activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{
        type: "poll",
        question: "💳 QUAL PAGAMENTO AGENDADO FOI PAGO?",
        options: [{ id: "306", reply: "306", label: "306 - DIBRITA (23/09/2026) - TODOS (R$ 1.220,00)" }],
      }],
    };
    if (payload.replyId === "306") return {
      status: "processed",
      activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "💰 DESEJA MANTER O VALOR DE QTD COMO 10?", options: [] }],
    };
    throw new Error(`resposta inesperada: ${payload.replyId}`);
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  const started = await h.view.emit("settle-pending-provision", { paymentId: "306" });
  assert.equal(started, true, JSON.stringify({ calls, error: h.view.renders.at(-1).error }));
  assert.deepEqual(calls.map(call => call.replyId), [
    "input_continue", "portal_confirm_main_menu", "group_pending", "pending_payment_provisions", "pending_payment_settlement", "306",
  ]);
  assert.match(h.view.renders.at(-1).messages.at(-1).question, /QTD como 10/i);
});

test("o check em Pendências atravessa Provisões pgto pendentes antes de baixar o item", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({
    due: true,
    rows: [{ id: "306", supplier: "DIBRITA", dueDate: "23/09/2026" }],
  });
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === "input_continue") return {
      status: "processed", activeFlow: null,
      messages: [{ type: "poll", question: "⏳ PENDÊNCIAS (47)\nESCOLHA O TIPO DE PENDÊNCIA QUE DESEJA CONSULTAR.", options: [
        { id: "pending_payment_provisions", reply: "pending_payment_provisions", label: "💳 PROVISÕES PGTO PENDENTES (1)" },
        { id: "pending_pathologies", reply: "pending_pathologies", label: "PATOLOGIAS (2)" },
      ] }],
    };
    if (payload.replyId === "pending_payment_provisions") return {
      status: "processed", activeFlow: null,
      messages: [{ type: "poll", question: "💳 PROVISÕES PGTO PENDENTES\nQUAL GRUPO DE PROVISÕES DESEJA VER?", options: [
        { id: "pending_payment_settlement", reply: "pending_payment_settlement", label: "💰 BAIXAR PAGAMENTO AGENDADO" },
        { id: "pending_payment_provisions_due", reply: "pending_payment_provisions_due", label: "PROVISÕES VENCIDAS / VENCEM HOJE" },
      ] }],
    };
    if (payload.replyId === "pending_payment_settlement") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "QUAL PAGAMENTO AGENDADO FOI PAGO?", options: [
        { id: "306", reply: "306", label: "306 - DIBRITA (23/09/2026)" },
      ] }],
    };
    if (payload.replyId === "306") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "DESEJA MANTER O VALOR DE QTD COMO 10?", options: [] }],
    };
    throw new Error(`resposta inesperada: ${payload.replyId}`);
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  const started = await h.view.emit("settle-pending-provision", { paymentId: "306" });

  assert.equal(started, true, h.view.renders.at(-1).error);
  assert.deepEqual(calls, ["input_continue", "pending_payment_provisions", "pending_payment_settlement", "306"]);
  assert.match(h.view.renders.at(-1).messages.at(-1).question, /QTD COMO 10/i);
});

test("toque real no check da provisão em Pendências chega à pergunta de QTD", async t => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const h = makeHarness({ view: createChatView(root) });
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === "input_continue") return {
      status: "processed", activeFlow: null,
      messages: [{ type: "poll", question: "⏳ PENDÊNCIAS (47)\nESCOLHA O TIPO DE PENDÊNCIA QUE DESEJA CONSULTAR.", options: [
        { id: "pending_payment_provisions", reply: "pending_payment_provisions", label: "💳 PROVISÕES PGTO PENDENTES (1)" },
      ] }],
    };
    if (payload.replyId === "pending_payment_provisions") return {
      status: "processed", activeFlow: null,
      messages: [{ type: "poll", question: "PROVISÕES PGTO PENDENTES", options: [
        { id: "pending_payment_settlement", reply: "pending_payment_settlement", label: "💰 BAIXAR PAGAMENTO AGENDADO" },
      ] }],
    };
    if (payload.replyId === "pending_payment_settlement") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "QUAL PAGAMENTO AGENDADO FOI PAGO?", options: [
        { id: "306", reply: "306", label: "306 - DIBRITA" },
      ] }],
    };
    if (payload.replyId === "306") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "DESEJA MANTER O VALOR DE QTD COMO 10?", options: [] }],
    };
    throw new Error(`resposta inesperada: ${payload.replyId}`);
  };
  t.after(() => { h.controller.stop(); dom.window.close(); });
  await h.controller.start();

  const button = root.querySelector('[data-action="settle-pending-provision"][data-payment-id="306"]');
  assert.ok(button, "o check do pagamento deve estar visível");
  button.click();
  for (let attempt = 0; attempt < 100 && !/DESEJA MANTER O VALOR DE QTD COMO 10/i.test(root.textContent); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  assert.deepEqual(calls, ["input_continue", "pending_payment_provisions", "pending_payment_settlement", "306"]);
  assert.match(root.textContent, /DESEJA MANTER O VALOR DE QTD COMO 10/i);
  assert.equal(root.querySelector('[data-action="settle-pending-provision"]'), null);
});

test("o check também navega para Pendências quando a tela atual é o menu de Demandas", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === "input_continue") return {
      status: "processed",
      activeFlow: null,
      messages: [{
        type: "poll",
        question: "👉 📋 DEMANDAS\\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
        options: [{ id: "add_task", reply: "add_task", label: "📝 ADICIONAR UMA NOVA TAREFA" }],
      }],
    };
    if (payload.replyId === "portal_confirm_main_menu") return {
      status: "processed", activeFlow: null, resetConversation: true,
      messages: [{ type: "poll", question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?", options: [
        { id: "group_pending", reply: "group_pending", label: "⏳ PENDÊNCIAS (47)" },
      ] }],
    };
    if (payload.replyId === "group_pending") return {
      status: "processed", activeFlow: null,
      messages: [{ type: "poll", question: "PENDÊNCIAS — ESCOLHA O TIPO", options: [
        { id: "pending_payment_settlement", reply: "pending_payment_settlement", label: "💰 BAIXAR PAGAMENTO AGENDADO" },
      ] }],
    };
    if (payload.replyId === "pending_payment_settlement") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "QUAL PAGAMENTO AGENDADO FOI PAGO?", options: [
        { id: "306", reply: "306", label: "306 - DIBRITA" },
      ] }],
    };
    if (payload.replyId === "306") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "DESEJA MANTER O VALOR DE QTD COMO 10?", options: [] }],
    };
    throw new Error(`resposta inesperada: ${payload.replyId}`);
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  const started = await h.view.emit("settle-pending-provision", { paymentId: "306" });

  assert.equal(started, true, JSON.stringify({ calls: calls.map(call => call.replyId), error: h.view.renders.at(-1).error }));
  assert.deepEqual(calls.map(call => call.replyId), [
    "input_continue", "portal_confirm_main_menu", "group_pending", "pending_payment_settlement", "306",
  ]);
  assert.match(h.view.renders.at(-1).messages.at(-1).question, /QTD como 10/i);
});

test("o check abandona o formulário atual e inicia a baixa da provisão selecionada sem novo clique", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === "input_continue") return {
      status: "processed",
      activeFlow: { id: "payment_provision_attachments", title: "ADICIONAR ANEXOS A UMA PROVISÃO DE PAGAMENTO" },
      messages: [{ type: "poll", question: "A QUAL PROVISÃO DE PAGAMENTO DESEJA ADICIONAR ANEXOS?", options: [{ id: "306", label: "306 - DIBRITA" }] }],
    };
    if (payload.replyId === "portal_confirm_main_menu") return {
      status: "processed",
      activeFlow: { id: "payment_provision_attachments", title: "ADICIONAR ANEXOS A UMA PROVISÃO DE PAGAMENTO" },
      messages: [{
        type: "poll",
        question: "DESEJA CRIAR UM RASCUNHO DO FLUXO ATUAL E IR PARA O MENU PRINCIPAL?",
        options: [
          { id: "portal_draft_exit_save", label: "SIM, CRIAR RASCUNHO" },
          { id: "portal_draft_exit_discard", label: "NÃO, ELIMINAR FORMULÁRIO" },
        ],
      }],
    };
    if (payload.replyId === "portal_draft_exit_discard") return {
      status: "processed", activeFlow: null, resetConversation: true,
      messages: [{ type: "poll", question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?", options: [
        { id: "group_pending", reply: "group_pending", label: "PENDÊNCIAS" },
      ] }],
    };
    if (payload.replyId === "group_pending") return {
      status: "processed", activeFlow: null,
      messages: [{ type: "poll", question: "PENDÊNCIAS — ESCOLHA O TIPO", options: [
        { id: "pending_payment_settlement", reply: "pending_payment_settlement", label: "BAIXAR PAGAMENTO AGENDADO" },
      ] }],
    };
    if (payload.replyId === "pending_payment_settlement") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement" },
      messages: [{ type: "poll", question: "QUAL PAGAMENTO AGENDADO FOI PAGO?", options: [
        { id: "306", reply: "306", label: "306 - DIBRITA" },
      ] }],
    };
    if (payload.replyId === "306") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement" },
      messages: [{ type: "poll", question: "DESEJA MANTER O VALOR DE QTD COMO 10?", options: [] }],
    };
    throw new Error(`resposta inesperada: ${payload.replyId}`);
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  h.store.setDraft("texto do formulário que será abandonado");
  assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "306" }), true);
  assert.deepEqual(calls.map(call => call.replyId), [
    "input_continue", "portal_confirm_main_menu", "portal_draft_exit_discard",
    "group_pending", "pending_payment_settlement", "306",
  ]);
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  assert.match(h.view.renders.at(-1).messages.at(-1).question, /QTD COMO 10/i);
  assert.equal(h.store.getState().draft, "");
  assert.equal(h.view.renders.some(state => state.messages.some(message => /RASCUNHO DO FLUXO ATUAL/.test(message.question || ""))), false);
});

test("o check não abandona nenhum fluxo após sair, trocar de conta ou encerrar o app durante a resposta", async t => {
  for (const end of ["sign-out", "switch-account", "stop"]) await t.test(end, async t => {
    const h = makeHarness();
    const calls = [];
    let releaseExit;
    let exitStarted;
    const started = new Promise(resolve => { exitStarted = resolve; });
    const delayed = new Promise(resolve => { releaseExit = resolve; });
    h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
    h.client.sendText = async payload => {
      calls.push(payload.replyId);
      if (payload.replyId === "input_continue") return {
        status: "processed", activeFlow: { id: "task_create", contextId: "original-task" },
        messages: [{ type: "poll", question: "QUAL É A DESCRIÇÃO DA TAREFA?", options: [] }],
      };
      if (payload.replyId === "portal_confirm_main_menu") {
        exitStarted();
        await delayed;
        return {
          status: "processed", activeFlow: { id: "task_create", contextId: "original-task" },
          messages: [{ type: "poll", question: "TEM CERTEZA QUE DESEJA ABANDONAR ESTE FLUXO?", options: [
            { id: "portal_draft_exit_discard", label: "SIM, ABANDONAR" },
            { id: "portal_draft_exit_cancel", label: "NÃO, CONTINUAR" },
          ] }],
        };
      }
      return { status: "processed", activeFlow: null, resetConversation: true,
        messages: [{ type: "poll", question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?", options: [] }] };
    };
    t.after(() => { releaseExit(); h.controller.stop(); });
    await h.controller.start();
    const settling = h.view.emit("settle-pending-provision", { paymentId: "306" });
    await started;
    if (end === "stop") h.controller.stop();
    else {
      await h.view.emit("sign-out");
      if (end === "switch-account") await h.view.emit("sign-in");
    }
    const callsBeforeRelease = [...calls];
    releaseExit();
    assert.equal(await settling, false);
    assert.deepEqual(calls, callsBeforeRelease, "a resposta da sessão antiga não dispara abandono nem baixa em outra sessão");
    assert.ok(!calls.includes("portal_draft_exit_discard"));
    assert.ok(!calls.includes("306"));
  });
});

test("o check em um fluxo de anexos retoma a baixa quando a VM libera o menu sem rascunho", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === "input_continue") return {
      status: "processed",
      activeFlow: { id: "payment_provision_attachments", title: "ADICIONAR ANEXOS A UMA PROVISÃO DE PAGAMENTO" },
      messages: [{ type: "poll", question: "A QUAL PROVISÃO DE PAGAMENTO DESEJA ADICIONAR ANEXOS?", options: [{ id: "306", label: "306 - DIBRITA" }] }],
    };
    if (payload.replyId === "portal_confirm_main_menu") return {
      status: "processed", activeFlow: null, resetConversation: true,
      messages: [{ type: "poll", question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?", options: [{ id: "group_pending", reply: "group_pending", label: "⏳ PENDÊNCIAS (47)" }] }],
    };
    if (payload.replyId === "group_pending") return {
      status: "processed", activeFlow: null,
      messages: [{ type: "poll", question: "PENDÊNCIAS — ESCOLHA O TIPO", options: [{ id: "pending_payment_settlement", reply: "pending_payment_settlement", label: "BAIXAR PAGAMENTO AGENDADO" }] }],
    };
    if (payload.replyId === "pending_payment_settlement") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "QUAL PAGAMENTO AGENDADO FOI PAGO?", options: [{ id: "306", reply: "306", label: "306 - DIBRITA" }] }],
    };
    if (payload.replyId === "306") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "DESEJA MANTER O VALOR DE QTD COMO 10?", options: [{ id: "keep", reply: "keep", label: "SIM, MANTER" }] }],
    };
    throw new Error(`resposta inesperada: ${payload.replyId}`);
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "306" }), true);
  assert.deepEqual(calls.map(call => call.replyId), ["input_continue", "portal_confirm_main_menu", "group_pending", "pending_payment_settlement", "306"]);
  assert.match(h.view.renders.at(-1).messages.at(-1).question, /QTD como 10/i);
});

test("o check reconhece o fluxo ativo de anexos mesmo quando a resposta mais recente não é um poll", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === "input_continue") return {
      status: "processed",
      activeFlow: { id: "payment_provision_attachments", title: "ADICIONAR ANEXOS A UMA PROVISÃO DE PAGAMENTO" },
      messages: [{ type: "text", text: "Aguardando a seleção dos anexos da provisão." }],
    };
    if (payload.replyId === "portal_confirm_main_menu") return {
      status: "processed", activeFlow: null, resetConversation: true,
      messages: [{ type: "poll", question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?", options: [
        { id: "group_pending", reply: "group_pending", label: "⏳ PENDÊNCIAS (47)" },
      ] }],
    };
    if (payload.replyId === "group_pending") return {
      status: "processed", activeFlow: null,
      messages: [{ type: "poll", question: "PENDÊNCIAS — ESCOLHA O TIPO", options: [
        { id: "pending_payment_settlement", reply: "pending_payment_settlement", label: "💰 BAIXAR PAGAMENTO AGENDADO" },
      ] }],
    };
    if (payload.replyId === "pending_payment_settlement") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "QUAL PAGAMENTO AGENDADO FOI PAGO?", options: [
        { id: "306", reply: "306", label: "306 - DIBRITA" },
      ] }],
    };
    if (payload.replyId === "306") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "DESEJA MANTER O VALOR DE QTD COMO 10?", options: [] }],
    };
    throw new Error(`resposta inesperada: ${payload.replyId}`);
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  const started = await h.view.emit("settle-pending-provision", { paymentId: "306" });

  assert.equal(started, true, JSON.stringify({ calls: calls.map(call => call.replyId), error: h.view.renders.at(-1).error }));
  assert.deepEqual(calls.map(call => call.replyId), [
    "input_continue", "portal_confirm_main_menu", "group_pending", "pending_payment_settlement", "306",
  ]);
  assert.match(h.view.renders.at(-1).messages.at(-1).question, /QTD como 10/i);
});

test("o check não inicia baixa quando a VM não conclui a saída do formulário", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === "input_continue") return {
      status: "processed",
      activeFlow: { id: "group_supplies", title: "📦 SUPRIMENTOS" },
      messages: [{
        type: "poll",
        question: "📦 SUPRIMENTOS — QUAL FLUXO VOCÊ DESEJA INICIAR?",
        options: [{ id: "new_document", label: "📄 LANÇAMENTOS" }],
      }],
    };
    if (payload.replyId === "portal_confirm_main_menu") return {
      status: "processed",
      activeFlow: { id: "launch_create", title: "LANÇAMENTOS" },
      messages: [{
        type: "poll",
        question: "DESEJA CRIAR UM RASCUNHO DO FLUXO ATUAL E IR PARA O MENU PRINCIPAL?",
        options: [
          { id: "portal_draft_exit_save", label: "SIM, CRIAR RASCUNHO" },
          { id: "portal_draft_exit_discard", label: "NÃO, ELIMINAR FORMULÁRIO" },
        ],
      }],
    };
    if (payload.replyId === "portal_draft_exit_discard") return {
      status: "processed", activeFlow: { id: "launch_create", title: "LANÇAMENTOS" },
      messages: [{ type: "poll", question: "QUAL É A DATA?", options: [] }],
    };
    throw new Error("A baixa não deve iniciar antes de sair do formulário.");
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "306" }), false);
  assert.deepEqual(calls.map(call => call.replyId), ["input_continue", "portal_confirm_main_menu", "portal_draft_exit_discard"]);
  assert.match(h.view.renders.at(-1).error, /não confirmou.*menu principal/i);
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
});

test("toque no check fecha o popup antes da rede e abandona o diário sem postar para abrir a baixa", async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const h = makeHarness({ view: createChatView(root) });
  const calls = [];
  let releaseExit;
  const exitGate = new Promise(resolve => { releaseExit = resolve; });
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === "input_continue") return {
      status: "processed", activeFlow: { id: "construction_diary_fill" },
      messages: [{ type: "poll", question: "QUAL É A DESCRIÇÃO DO DIÁRIO?", options: [] }],
    };
    if (payload.replyId === "abandon_construction_diary") {
      await exitGate;
      return {
        status: "processed", activeFlow: { id: "construction_diary_fill" },
        messages: [{ type: "poll", question: "DESEJA POSTAR COMO PENDENTE OU SAIR SEM POSTAR AGORA?", options: [
          { id: "diary_partial_save_yes", label: "POSTAR COMO PENDENTE" },
          { id: "diary_partial_save_no", label: "SAIR SEM POSTAR AGORA" },
        ] }],
      };
    }
    if (payload.replyId === "diary_partial_save_no") return {
      status: "processed", activeFlow: null, resetConversation: true,
      messages: [{ type: "poll", question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?", options: [
        { id: "group_pending", label: "PENDÊNCIAS" },
      ] }],
    };
    if (payload.replyId === "group_pending") return {
      status: "processed", activeFlow: null,
      messages: [{ type: "poll", question: "PENDÊNCIAS", options: [
        { id: "pending_payment_settlement", label: "BAIXAR PAGAMENTO AGENDADO" },
      ] }],
    };
    if (payload.replyId === "pending_payment_settlement") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement" },
      messages: [{ type: "poll", question: "QUAL PAGAMENTO AGENDADO FOI PAGO?", options: [{ id: "306", label: "306 - DIBRITA" }] }],
    };
    if (payload.replyId === "306") return {
      status: "processed", activeFlow: { id: "scheduled_payment_settlement" },
      messages: [{ type: "poll", question: "DESEJA MANTER O VALOR DE QTD COMO 10?", options: [] }],
    };
    throw new Error(`Resposta inesperada (não deve postar diário ou pagamento): ${payload.replyId}`);
  };
  t.after(() => { releaseExit(); h.controller.stop(); dom.window.close(); });
  await h.controller.start();
  const check = root.querySelector('[data-action="settle-pending-provision"][data-payment-id="306"]');
  assert.ok(check);
  check.click();
  assert.equal(root.querySelector('[data-action="settle-pending-provision"]'), null, "fecha o popup imediatamente, antes da resposta da VM");
  assert.match(root.textContent, /DIÁRIO|Carregando|Aguarde/i, "não deixa uma tela vazia durante a transição");
  check.click();
  releaseExit();
  for (let attempt = 0; attempt < 100 && !/QTD COMO 10/i.test(root.textContent); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(calls, ["input_continue", "abandon_construction_diary", "diary_partial_save_no", "group_pending", "pending_payment_settlement", "306"]);
  assert.match(root.textContent, /QTD COMO 10/i);
  assert.doesNotMatch(root.textContent, /Confirme na conversa|solicite a baixa novamente/i);
});

test("o check seleciona o pagamento pelo ID, chega a QTD e preserva a continuação da baixa", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({
    due: true,
    rows: [{ id: "306", supplier: "DIBRITA", dueDate: "23/09/2026", product: "DIBRITA 01 · 122", total: "R$ 1.220,00" }],
  });
  h.client.sendText = async payload => {
    if (payload.replyId === "input_continue") return {
      status: "processed",
      activeFlow: { id: "pending_provisions", title: "PENDÊNCIAS" },
      messages: [{
        type: "poll",
        question: "⏳ PENDÊNCIAS — ESCOLHA O TIPO",
        options: [{ id: "settle", reply: "settle", label: "💰 BAIXAR PAGAMENTO AGENDADO" }],
      }],
    };
    calls.push(payload);
    if (calls.length === 1) {
      return {
        status: "processed",
        activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
        messages: [
          { type: "text", text: "Documento processado com sucesso." },
          {
            type: "poll",
            question: "💳 QUAL PAGAMENTO AGENDADO FOI PAGO?",
            options: [
              { id: "305", reply: "305", label: "305 - Outro fornecedor" },
              { id: "306", reply: "306", label: "306 - DIBRITA (23/09/2026) - TODOS (R$ 1.220,00)" },
            ],
          },
        ],
      };
    }
    if (calls.length === 2) return {
      status: "processed",
      activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{
        type: "poll",
        question: "💰 DESEJA MANTER O VALOR DE QTD COMO 10?",
        options: [{ id: "keep", reply: "keep", label: "✅ SIM, MANTER" }],
      }],
    };
    return {
      status: "processed",
      activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "QUAL A DATA DO PAGAMENTO?", options: [] }],
    };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  const started = await h.view.emit("settle-pending-provision", { paymentId: "306" });

  assert.equal(started, true);
  assert.deepEqual(calls.map(call => call.replyId), ["settle", "306"]);
  assert.match(h.view.renders.at(-1).messages.at(-1).question, /QTD como 10/i);

  await h.view.emit("select-reply", { replyId: "keep", label: "✅ SIM, MANTER" });
  assert.deepEqual(calls.map(call => call.replyId), ["settle", "306", "keep"]);
  assert.match(h.view.renders.at(-1).messages.at(-1).question, /DATA DO PAGAMENTO/i);
});

test("o check pula diretamente para QTD quando a lista de pagamentos já está aberta", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({
    due: true,
    rows: [{ id: "306", supplier: "DIBRITA", dueDate: "23/09/2026" }],
  });
  h.client.sendText = async payload => {
    if (payload.replyId === "input_continue") return {
      status: "processed",
      activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{
        type: "poll",
        question: "QUAL PAGAMENTO AGENDADO FOI PAGO?",
        options: [{ id: "306", reply: "306", label: "306 - DIBRITA (23/09/2026)" }],
      }],
    };
    calls.push(payload);
    return {
      status: "processed",
      activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "DESEJA MANTER O VALOR DE QTD COMO 10?", options: [] }],
    };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "306" }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].replyId, "306");
  assert.match(h.view.renders.at(-1).messages.at(-1).question, /QTD como 10/i);
});

test("o check não reutiliza uma opção de baixa que só aparece em um poll antigo", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === "input_continue") return {
      status: "processed",
      activeFlow: { id: "pending_provisions", title: "PENDÊNCIAS" },
      messages: [{
        type: "poll",
        question: "⏳ PENDÊNCIAS",
        options: [{ id: "settle", reply: "settle", label: "💰 BAIXAR PAGAMENTO AGENDADO" }],
      }],
    };
    return { status: "processed", activeFlow: { id: "other", title: "OUTRO FLUXO" }, messages: [] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.controller.sendText("A pergunta atual não é uma escolha de pagamento."), true);
  const callsAfterEmptyResponse = calls.length;

  assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "306" }), false);
  assert.equal(calls.length, callsAfterEmptyResponse + 1);
  assert.equal(calls.at(-1).replyId, "portal_confirm_main_menu");
});

test("o check não usa poll de baixa de outro fluxo mesmo quando a pergunta parece compatível", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
  h.client.sendText = async payload => {
    calls.push(payload);
    return payload.replyId === "input_continue" ? {
      status: "processed",
      activeFlow: { id: "accounts_payable", title: "CONTAS A PAGAR" },
      messages: [{
        type: "poll",
        question: "QUAL PAGAMENTO AGENDADO FOI PAGO?",
        options: [{ id: "306", reply: "306", label: "306 - DIBRITA" }],
      }],
    }
    : { status: "processed", activeFlow: { id: "accounts_payable", title: "CONTAS A PAGAR" }, messages: [] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "306" }), false);
  assert.deepEqual(calls.map(call => call.replyId), ["input_continue", "portal_confirm_main_menu"]);
});

test("o check não escolhe quando a VM devolve IDs de pagamento ambíguos", async t => {
  const h = makeHarness();
  const calls = [];
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "DIBRITA" }] });
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === "input_continue") return {
      status: "processed",
      activeFlow: { id: "pending_provisions", title: "PENDÊNCIAS" },
      messages: [{ type: "poll", question: "PENDÊNCIAS", options: [
        { id: "settle", reply: "settle", label: "BAIXAR PAGAMENTO AGENDADO" },
      ] }],
    };
    if (payload.replyId === "settle") return {
      status: "processed",
      activeFlow: { id: "scheduled_payment_settlement", title: "BAIXAR PAGAMENTO AGENDADO" },
      messages: [{ type: "poll", question: "QUAL PAGAMENTO AGENDADO FOI PAGO?", options: [
        { id: "306", reply: "306", label: "306 - DIBRITA" },
        { id: "306", reply: "306", label: "306 - DIBRITA (duplicado)" },
      ] }],
    };
    return { status: "processed", messages: [] };
  };
  t.after(() => h.controller.stop());
  await h.controller.start();

  assert.equal(await h.view.emit("settle-pending-provision", { paymentId: "306" }), false);
  assert.deepEqual(calls.map(call => call.replyId), ["input_continue", "settle"]);
  assert.match(h.view.renders.at(-1).error, /não encontrei o pagamento 306/i);
});

test("mascote do menu reabre provisões pelo popup real após fechar o lembrete sem navegar na VM", async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const h = makeHarness({ view: createChatView(root), pendingProvisionAttachmentsDataFactory: async () => ({
    loadUpcomingPayments: async () => [{ id: '306', supplier: 'VIVO', product: 'TARIFA DE INTERNET', dueDate: '2026-10-04', total: 89.99 }],
    listAttachments: async () => [], downloadAttachment: async () => new Blob(),
  }) });
  t.after(() => { h.controller.stop(); h.view.destroy(); dom.window.close(); });
  let reads = 0;
  h.client.getPendingProvisionSnapshot = async () => { reads++; return { due: true, rows: [{ id: '306', supplier: 'VIVO' }] }; };
  await h.controller.start();
  root.querySelector('[data-action="dismiss-pending-provisions"]').click();
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [
    { id: 'group_pending', reply: 'group_pending', label: '⏳ PENDÊNCIAS (47)' },
  ] }], { activeFlow: null });
  const before = h.chatCalls.length;
  const shortcut = root.querySelector('[data-action="open-pending-provisions"]');
  assert.ok(shortcut);
  shortcut.click();
  assert.equal(root.querySelector('[data-action="open-pending-provisions"]').disabled, true);
  for (let attempt = 0; attempt < 50 && !root.querySelector('[data-pending-provisions-dialog]'); attempt++) await new Promise(resolve => setImmediate(resolve));
  const popup = root.querySelector('[data-pending-provisions-dialog]');
  assert.ok(popup);
  assert.match(popup.textContent, /Provisões de pagamento pendentes/);
  assert.match(popup.textContent, /VIVO/);
  assert.match(popup.textContent, /89,99/);
  assert.equal(reads, 2);
  assert.equal(h.chatCalls.length, before);
});

test("abertura manual ignora adiamento sem alterar a preferência e deduplica cliques concorrentes", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  const scheduled = [];
  h.native.scheduleProvisionReminder = async details => { scheduled.push(details); return true; };
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: '306', supplier: 'VIVO' }] });
  await h.controller.start();
  await h.view.emit('close-pending-provisions');
  await h.view.emit('pending-provisions-reminder-choice', { value: '2h' });
  const read = deferred();
  let reads = 0;
  h.client.getPendingProvisionSnapshot = () => { reads++; return read.promise; };
  const first = h.view.emit('open-pending-provisions');
  const second = h.view.emit('open-pending-provisions');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).pendingProvisionOpening, true);
  assert.equal(reads, 1);
  read.resolve({ due: true, rows: [{ id: '307', supplier: 'PETRANET' }] });
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows[0].supplier, 'PETRANET');
  assert.equal(h.view.renders.at(-1).pendingProvisionOpening, false);
  await h.view.emit('dismiss-pending-provisions');
  await h.controller.handleForeground();
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  assert.equal(reads, 1);
  assert.equal(scheduled.length, 1);
});

test("abertura manual sem pendências mostra popup vazio e falha de consulta permite tentar novamente", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.client.getPendingProvisionSnapshot = async () => { throw new Error('Offline'); };
  assert.equal(await h.view.emit('open-pending-provisions'), false);
  assert.match(h.view.renders.at(-1).error, /não foi possível consultar.*provisões/i);
  h.client.getPendingProvisionSnapshot = async () => ({ due: false, rows: [] });
  assert.equal(await h.view.emit('open-pending-provisions'), true);
  const state = h.view.renders.at(-1);
  assert.equal(state.error, null);
  const dom = new JSDOM(renderChatMarkup(state));
  t.after(() => dom.window.close());
  const popup = dom.window.document.querySelector('[data-pending-provisions-dialog]');
  assert.ok(popup);
  assert.match(popup.textContent, /nenhuma provisão/i);
});

for (const end of ['stop', 'sign-out']) test(`consulta manual atrasada não reabre provisões após ${end}`, async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const read = deferred();
  h.client.getPendingProvisionSnapshot = () => read.promise;
  const opening = h.view.emit('open-pending-provisions');
  await new Promise(resolve => setImmediate(resolve));
  if (end === 'stop') h.controller.stop(); else await h.view.emit('sign-out');
  const renderCount = h.view.renders.length;
  read.resolve({ due: true, rows: [{ id: '306', supplier: 'OUTRA SESSÃO' }] });
  assert.equal(await opening, false);
  assert.equal(h.view.renders.length, renderCount);
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
});

test("nova sessão não herda o indicador ocupado da consulta manual anterior", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const oldRead = deferred();
  h.client.getPendingProvisionSnapshot = () => oldRead.promise;
  const opening = h.view.emit('open-pending-provisions');
  await new Promise(resolve => setImmediate(resolve));
  await h.view.emit('sign-out');
  h.client.getPendingProvisionSnapshot = async () => ({ due: false, rows: [] });
  await h.view.emit('sign-in');
  assert.equal(h.view.renders.at(-1).pendingProvisionOpening, false);
  oldRead.resolve({ due: true, rows: [{ id: 'old', supplier: 'CONTA ANTIGA' }] });
  assert.equal(await opening, false);
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  assert.equal(await h.view.emit('open-pending-provisions'), true);
});

test("atalho captura o menu no clique e não abre após navegação durante a consulta automática", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }], { activeFlow: null });
  const autoRead = deferred();
  let reads = 0;
  h.client.getPendingProvisionSnapshot = () => { reads++; return autoRead.promise; };
  const foreground = h.controller.handleForeground();
  await new Promise(resolve => setImmediate(resolve));
  const opening = h.view.emit('open-pending-provisions');
  await new Promise(resolve => setImmediate(resolve));
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'OUTRO MENU', options: [] }], { activeFlow: null });
  autoRead.resolve({ due: false, rows: [] });
  await foreground;
  assert.equal(await opening, false);
  assert.equal(reads, 1);
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  assert.equal(h.view.renders.at(-1).pendingProvisionOpening, false);
});

for (const waitingAuto of [false, true]) test(`consulta manual tem prazo, libera retry e ignora resposta tardia (automática=${waitingAuto})`, async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const oldRead = deferred();
  h.client.getPendingProvisionSnapshot = () => oldRead.promise;
  const foreground = waitingAuto ? h.controller.handleForeground() : null;
  await new Promise(resolve => setImmediate(resolve));
  const opening = h.view.emit('open-pending-provisions');
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(30_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).pendingProvisionOpening, false);
  assert.equal(await opening, false);
  assert.match(h.view.renders.at(-1).error, /demorou.*tentar novamente/i);
  h.client.getPendingProvisionSnapshot = async () => ({ due: false, rows: [] });
  assert.equal(await h.view.emit('open-pending-provisions'), true);
  await h.view.emit('dismiss-pending-provisions');
  oldRead.resolve({ due: true, rows: [{ id: 'old', supplier: 'RESPOSTA ATRASADA' }] });
  await foreground;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
});

test("timeout de provisões após navegar libera a espera sem inserir erro na nova tela", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }], { activeFlow: null });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const oldRead = deferred();
  h.client.getPendingProvisionSnapshot = () => oldRead.promise;
  const opening = h.view.emit('open-pending-provisions');
  await new Promise(resolve => setImmediate(resolve));
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'OUTRO MENU', options: [] }], { activeFlow: null });
  t.mock.timers.tick(30_000);
  assert.equal(await opening, false);
  assert.equal(h.view.renders.at(-1).pendingProvisionOpening, false);
  assert.equal(h.view.renders.at(-1).error, null);
  oldRead.resolve({ due: true, rows: [{ id: 'old' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
});

test("o X fecha provisões sem perguntar o intervalo nem reabrir nesta sessão", async () => {
  const h = makeHarness();
  let snapshotReads = 0;
  h.client.getPendingProvisionSnapshot = async () => {
    snapshotReads += 1;
    return {
      due: true,
      rows: [{ supplier: "Fornecedor A", dueDate: "11/09/2026" }],
    };
  };

  await h.controller.start();
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 1);

  await h.view.emit("dismiss-pending-provisions");

  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, false);
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  await h.controller.handleForeground();
  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, false);
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  assert.equal(snapshotReads, 1);
  h.controller.stop();
});

test("o primeiro toque no X fecha o popup sem abrir as opções de lembrete no iPhone", async t => {
  const dom = new JSDOM('<div id="app"></div>', { url: "https://example.test/" });
  const root = dom.window.document.querySelector("#app");
  const store = createConversationStore();
  const view = createChatView(root);
  const controller = createAppController({
    store,
    view,
    auth: { initialize: async () => ({ homeAccountId: "iphone", name: "Bernardo" }) },
    native: { importSharedItems: async () => [] },
    client: {
      sendText: async () => ({ status: "processed", messages: [] }),
      getPendingProvisionSnapshot: async () => ({
        due: true,
        rows: [{ supplier: "Fornecedor A", dueDate: "18/09/2026" }],
      }),
    },
  });
  t.after(() => {
    controller.stop();
    view.destroy();
    dom.window.close();
  });

  await controller.start();
  const close = root.querySelector('[data-action="dismiss-pending-provisions"]');
  assert.ok(close);
  const pointerDown = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperties(pointerDown, {
    isPrimary: { value: true },
    pointerType: { value: "touch" },
  });
  close.dispatchEvent(pointerDown);

  const pointerUp = new dom.window.Event("pointerup", { bubbles: true, cancelable: true });
  Object.defineProperties(pointerUp, {
    isPrimary: { value: true },
    pointerType: { value: "touch" },
  });
  close.dispatchEvent(pointerUp);

  assert.equal(root.querySelector("[data-pending-provisions-dialog]"), null);
  assert.equal(root.querySelector('[data-action="pending-provisions-reminder-choice"]'), null);
});

test("lembrar provisões em duas horas fecha a escolha na integração real", async t => {
  const dom = new JSDOM('<div id="app"></div>', { url: "https://example.test/" });
  const root = dom.window.document.querySelector("#app");
  const store = createConversationStore();
  const view = createChatView(root);
  const scheduled = [];
  const controller = createAppController({
    store,
    view,
    auth: { initialize: async () => ({ homeAccountId: "iphone-reminder", name: "Bernardo" }) },
    native: {
      importSharedItems: async () => [],
      scheduleProvisionReminder: async details => { scheduled.push(details); return true; },
      cancelProvisionReminder: async () => {},
    },
    client: {
      sendText: async () => ({ status: "processed", messages: [] }),
      getPendingProvisionSnapshot: async () => ({
        due: true,
        rows: [{ supplier: "Fornecedor A", dueDate: "18/09/2026" }],
      }),
    },
  });
  t.after(() => {
    controller.stop();
    view.destroy();
    dom.window.close();
  });

  await controller.start();
  const settings = root.querySelector('[data-action="close-pending-provisions"]');
  assert.ok(settings);
  settings.click();

  const twoHours = root.querySelector('[data-action="pending-provisions-reminder-choice"][data-value="2h"]');
  assert.ok(twoHours);
  twoHours.click();

  assert.equal(root.querySelector("[data-pending-provisions-dialog]"), null);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 2 * 60 * 60 * 1000);
});

test("cancelar o lembrete de provisões fecha somente a escolha e preserva a lista", async () => {
  const h = makeHarness();
  h.client.getPendingProvisionSnapshot = async () => ({
    due: true,
    rows: [{ supplier: "Fornecedor A", dueDate: "11/09/2026" }],
  });

  await h.controller.start();
  await h.view.emit("close-pending-provisions");
  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, true);
  await h.view.emit("cancel-pending-provisions-reminder");
  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, false);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 1);
  h.controller.stop();
});

test("a opção de não lembrar hoje expira quando muda a data local", async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T12:00:00Z') });
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
  });
  try {
    const h = makeHarness();
    h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ supplier: "Fornecedor A" }] });
    await h.controller.start();
    await h.view.emit("close-pending-provisions");
    await h.view.emit("pending-provisions-reminder-choice", { value: "today" });
    assert.equal(h.view.renders.at(-1).pendingProvisions, null);
    t.mock.timers.setTime(new Date('2026-10-06T12:00:00Z').getTime());
    await h.controller.handleForeground();
    assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 1);
    h.controller.stop();
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previousStorage });
  }
});

for (const endSession of ["sign-out", "stop"]) {
  for (const fails of [false, true]) {
    test(`retomada ignora ${fails ? "erro" : "arquivo"} atrasado após ${endSession}`, async () => {
      const h = makeHarness();
      let resume;
      h.native.onResume = async handler => { resume = handler; return () => {}; };
      await h.controller.start();
      const read = deferred();
      h.native.importSharedItems = () => read.promise;
      const pending = resume();
      await new Promise(resolve => setImmediate(resolve));
      if (endSession === "stop") h.controller.stop();
      else await h.view.emit("sign-out");
      const renderCount = h.view.renders.length;
      if (fails) read.reject(new Error("Erro da conta anterior"));
      else read.resolve([sharedFile("conta-anterior")]);
      await pending;
      try {
        assert.deepEqual(h.store.getState().pendingFiles, []);
        assert.equal(h.view.renders.length, renderCount, "resultado obsoleto não deve renderizar");
        if (endSession === "sign-out") {
          await h.view.emit("sign-in");
          assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), []);
        }
      } finally { h.controller.stop(); }
    });
  }
}

test("novo retorno durante upload envia também o segundo compartilhamento", async () => {
  const h = makeHarness();
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  const inbox = new Map([["primeiro", sharedFile("primeiro")]]);
  const uploadStarted = deferred(), uploadFinished = deferred();
  h.native.importSharedItems = async () => [...inbox.values()];
  h.native.discardSharedItem = async id => { inbox.delete(id); };
  const sendFile = h.client.sendFile;
  h.client.sendFile = async file => {
    if (file.sourceId === "primeiro") { uploadStarted.resolve(); await uploadFinished.promise; }
    return sendFile(file);
  };
  const pending = resume();
  await uploadStarted.promise;
  inbox.set("segundo", sharedFile("segundo"));
  const next = resume();
  uploadFinished.resolve();
  try {
    await Promise.all([pending, next]);
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "primeiro.pdf"], ["file", "segundo.pdf"]]);
    assert.equal(inbox.size, 0);
    assert.deepEqual(h.store.getState().pendingFiles, []);
  } finally { h.controller.stop(); }
});

test("sair antes da leitura agendada impede reintroduzir anexo privado", async () => {
  const h = makeHarness();
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  h.native.importSharedItems = async () => [sharedFile("sessao-encerrada")];
  const pending = resume();
  await h.view.emit("sign-out");
  try {
    await pending;
    assert.deepEqual(h.store.getState().pendingFiles, []);
  } finally { h.controller.stop(); }
});

test("retorno da nova conta é processado após descartar leitura da sessão anterior", async () => {
  const h = makeHarness();
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  const oldRead = deferred(), reading = deferred();
  h.native.importSharedItems = () => { reading.resolve(); return oldRead.promise; };
  const oldResume = resume();
  await reading.promise;
  await h.view.emit("sign-out");
  await h.view.emit("sign-in");
  h.native.importSharedItems = async () => [sharedFile("conta-nova")];
  const newResume = resume();
  oldRead.resolve([sharedFile("conta-antiga")]);
  try {
    await Promise.all([oldResume, newResume]);
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "conta-nova.pdf"]]);
    assert.deepEqual(h.store.getState().pendingFiles, []);
  } finally { h.controller.stop(); }
});

test("retorno durante retomada inicial da VM recebe compartilhamento sem nova ativação", async () => {
  const h = makeHarness();
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  const conversationStarted = deferred(), conversationFinished = deferred();
  const sendText = h.client.sendText;
  h.client.sendText = async payload => {
    conversationStarted.resolve();
    await conversationFinished.promise;
    return sendText(payload);
  };
  const starting = h.controller.start();
  await conversationStarted.promise;
  h.native.importSharedItems = async () => [sharedFile("durante-inicio")];
  const resumed = resume?.();
  conversationFinished.resolve();
  try {
    await starting;
    await resumed;
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "durante-inicio.pdf"]]);
  } finally { h.controller.stop(); }
});

test("retorno sem conta preserva compartilhamento e envia após entrar", async () => {
  const h = makeHarness({ account: null });
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  h.native.importSharedItems = async () => [sharedFile("sem-conta")];
  try {
    await resume();
    assert.equal(h.store.getState().pendingFiles.length, 1);
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), []);
    await h.view.emit("sign-in");
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "sem-conta.pdf"]]);
  } finally { h.controller.stop(); }
});

test("início sem sessão não bloqueia a tela de login esperando a caixa nativa", async () => {
  const h = makeHarness({ account: null });
  h.native.importSharedItems = () => new Promise(() => {});
  try {
    await h.controller.start();
    assert.equal(h.view.renders.at(-1).sessionStatus, "signed-out");
  } finally { h.controller.stop(); }
});

test("início não bloqueia a tela de login se o observador Android não responder", async () => {
  const h = makeHarness({ account: null });
  h.native.onResume = () => new Promise(() => {});
  try {
    const completed = await Promise.race([
      h.controller.start().then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 100)),
    ]);
    assert.equal(completed, true);
    assert.equal(h.view.renders.at(-1).sessionStatus, "signed-out");
  } finally { h.controller.stop(); }
});

test("início deixa o login disponível enquanto a sessão armazenada é verificada", async () => {
  const h = makeHarness({ account: null, authTimeoutMs: 20 });
  h.auth.initialize = () => new Promise(() => {});
  const starting = h.controller.start();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.view.renders.at(-1).sessionStatus, "signed-out");
    await starting;
  } finally { h.controller.stop(); }
});

test("início não bloqueia a tela de login se a sessão Microsoft não responder", async () => {
  const h = makeHarness({ account: null, authTimeoutMs: 20 });
  h.auth.initialize = () => new Promise(() => {});
  let cancelled = 0;
  h.auth.cancelSignIn = async () => { cancelled++; };
  try {
    const completed = await Promise.race([
      h.controller.start().then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 100)),
    ]);
    assert.equal(completed, true);
    assert.equal(h.view.renders.at(-1).sessionStatus, "signed-out");
    assert.equal(cancelled, 1, "o timeout deve liberar a inicialização nativa antes do próximo toque");
  } finally { h.controller.stop(); }
});

test("login não fica preso em verificando sessão se o retorno Microsoft não responder", async () => {
  const h = makeHarness({ account: null, authSignInTimeoutMs: 20 });
  h.auth.signIn = () => new Promise(() => {});
  let cancelled = 0;
  h.auth.cancelSignIn = async () => { cancelled++; };
  try {
    await h.controller.start();
    const completed = await Promise.race([
      h.view.emit("sign-in").then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 100)),
    ]);
    assert.equal(completed, true);
    assert.equal(h.view.renders.at(-1).sessionStatus, "signed-out");
    assert.equal(cancelled, 1, "o timeout deve cancelar a chamada nativa pendente");
  } finally { h.controller.stop(); }
});

test("login importa anexo recebido antes da autenticação", async () => {
  const h = makeHarness({ account: null });
  h.native.importSharedItems = async () => [sharedFile("antes-do-login")];
  try {
    await h.controller.start();
    await h.view.emit("sign-in");
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "antes-do-login.pdf"]]);
  } finally { h.controller.stop(); }
});

test("retornar do WhatsApp importa e envia novo anexo sem reiniciar o app", async () => {
  const h = makeHarness({ historyMode: "current-step" });
  let resume;
  let removedListener = false;
  h.native.onResume = async handler => { resume = handler; return () => { removedListener = true; }; };
  await h.controller.start();
  try {
    h.store.setDraft("Texto ainda não enviado");
    const file = new File(["pdf"], "whatsapp.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "sourceId", { value: "whatsapp-1" });
    h.native.importSharedItems = async () => [file];
    assert.equal(typeof resume, "function", "o app deve observar a volta ao primeiro plano");
    await resume();
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "whatsapp.pdf"]]);
    assert.deepEqual(h.discarded, ["whatsapp-1"]);
    assert.equal(h.store.getState().draft, "Texto ainda não enviado");
    assert.equal(h.store.getState().pendingFiles.length, 0);
    assert.equal(h.store.getState().messages.at(-1).text, "Recebi whatsapp.pdf");
  } finally { h.controller.stop(); }
  assert.equal(removedListener, true);
});

test("eventos simultâneos de retorno não enviam o mesmo compartilhamento duas vezes", async () => {
  const h = makeHarness();
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  try {
    const file = new File(["pdf"], "whatsapp.pdf");
    Object.defineProperty(file, "sourceId", { value: "whatsapp-1" });
    h.native.importSharedItems = async () => [file];
    assert.equal(typeof resume, "function");
    await Promise.all([resume(), resume(), resume()]);
    assert.equal(h.chatCalls.filter(call => call[0] === "file").length, 1);
  } finally { h.controller.stop(); }
});

test("retorno com falha de envio remove o arquivo e não apaga a caixa compartilhada", async () => {
  const h = makeHarness();
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  try {
    const file = new File(["pdf"], "whatsapp.pdf");
    Object.defineProperty(file, "sourceId", { value: "whatsapp-1" });
    h.native.importSharedItems = async () => [file];
    h.client.sendFile = async () => { throw new Error("offline"); };
    assert.equal(typeof resume, "function");
    await resume();
    assert.deepEqual(h.store.getState().pendingFiles, []);
    assert.match(h.store.getState().error, /whatsapp\.pdf não foi enviado e foi removido da lista/);
    assert.deepEqual(h.discarded, []);
  } finally { h.controller.stop(); }
});

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

test("prosseguir sem anexo envia apenas a continuação da etapa preservada", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.syncAttachments([{
    id: "expired-temporary",
    fileName: "Comprovante_20260920_014255.pdf",
    mimeType: "application/pdf",
    mediaUrl: "/api/portal-media/expired-temporary",
  }]);
  harness.client.getAttachments = async () => [];
  harness.store.ingestRemoteMessages([{
    type: "poll",
    question: "⚠️ UM ANEXO TEMPORÁRIO NÃO ESTÁ MAIS DISPONÍVEL. OS DADOS DO FORMULÁRIO FORAM PRESERVADOS. REENVIE O ARQUIVO: Comprovante_20260920_014255.pdf",
    options: [{ id: "attachment_upload_continue", label: "📎 ENVIAR ANEXO" }],
  }], { activeFlow: { id: "launch", title: "EFETUAR LANÇAMENTO" } });
  harness.chatCalls.length = 0;

  await harness.view.emit("select-reply", {
    replyId: "attachment_upload_skip",
    label: "➡️ PROSSEGUIR SEM ANEXO",
  });

  assert.deepEqual(harness.chatCalls, [["text", { text: "", replyId: "input_continue" }]]);
  assert.deepEqual(harness.store.getState().attachments, []);
  harness.controller.stop();
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
  assert.match(renderChatMarkup(harness.view.renders.at(-1)), /Anexos \(1\)/);
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

test('ao abrir identifica o fluxo ativo e permite resumo em imagem sem substituir pergunta ou rascunho', async t => {
  const h = makeHarness({ historyMode: 'current-step' });
  t.after(() => h.controller.stop());
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
  h.native.previewMedia = async (source, name, options) => { previews.push([await previewSource(source),name,options]); };
  await h.view.emit('show-summary');
  assert.equal(previews.length, 1);
  assert.equal(previews[0][1], 'resumo.png');
  assert.equal(previews[0][2]?.layout, 'flow-summary');
  assert.equal(h.store.getState().messages, messages);
  assert.equal(h.store.getState().draft, 'Rascunho em andamento');
});

test('resumos automáticos para confirmação e imagens reabertas recebem layout pelo nome gerado', async t => {
  const h = makeHarness({ historyMode: 'current-step' });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const previews = [];
  const original = new Blob(['png original'], { type: 'image/png' });
  h.client.fetchMedia = async () => original;
  h.native.previewMedia = async (source, name, options) => { previews.push({ blob: await previewSource(source), name, options }); };
  for (const [index, name, status] of [[1,'resumo-lancamento.png','awaiting_confirmation'], [2,'RESUMO-documentos.PNG','awaiting_confirmation'], [3,'foto.png','processed']]) {
    h.client.sendText = async () => ({ status: 'processed', activeFlow: { id: 'task', title: 'TAREFA' }, results: [{ status }], messages: [{ id: `media-${index}`, type: 'image', mediaUrl: '/api/portal-media/synthetic', fileName: name }] });
    await h.controller.sendText('Avançar');
    const message = h.store.getState().messages.find(item => item.fileName === name);
    assert.ok(message, 'a imagem automática permanece na confirmação');
    await h.view.emit('open-media', { messageId: message.id });
    const preview = previews.at(-1);
    assert.equal(preview.blob, original);
    assert.equal(preview.name, name);
    assert.equal(preview.options?.layout, index < 3 ? 'flow-summary' : undefined);
  }
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

test('casinha descarta o fluxo mesmo com campos vazios e texto de filtro', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = {
    id: 'task', title: 'EFETUAR LANÇAMENTO', contextId: 'ctx-empty',
    rows: [{ label: 'FORNECEDOR', value: 'Em branco' }, { label: 'OBS', value: '   ' }],
  };
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === 'portal_confirm_main_menu') {
      return { status: 'processed', activeFlow, messages: [{ type: 'poll', question: 'Deseja deixar como rascunho?', options: [
        { id: 'portal_draft_exit_save', label: 'SIM, SALVAR COMO RASCUNHO' },
        { id: 'portal_draft_exit_discard', label: 'NÃO, SAIR SEM SALVAR' },
      ] }] };
    }
    assert.equal(payload.replyId, 'portal_draft_exit_discard');
    return { status: 'processed', returned_to_main_menu: true, resetConversation: true, activeFlow: null,
      messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'Filtrar fornecedor', databaseFilterKey: 'supplier', options: [
    { id: 'navigation_main_menu', label: 'RETORNAR AO MENU INICIAL' },
  ] }], { activeFlow });
  h.store.setDraft('Swi');
  h.store.syncAttachments([{
    id: 'read-only-source', fileName: 'consulta.pdf', mimeType: 'application/pdf', size: 123,
    mediaUrl: '/api/portal-media/read-only-source', readOnly: true,
  }]);

  await h.view.emit('select-reply', { label: 'RETORNAR AO MENU INICIAL', replyId: 'navigation_main_menu' });

  assert.deepEqual(calls.map(call => call.replyId), ['input_continue', 'portal_confirm_main_menu', 'portal_draft_exit_discard']);
  assert.equal(h.store.getState().activeFlow, null);
  assert.deepEqual(h.store.getState().attachments, []);
  assert.equal(h.store.getState().draft, '');
  assert.match(h.store.getState().messages.at(-1).question, /QUAL ÁREA VOCÊ DESEJA ACESSAR/);
});

test('casinha abandona provisão pendente sem mostrar confirmação e limpa anexos já vinculados', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = { id: 'payment_provision', title: 'CRIAR UMA PROVISÃO DE PAGAMENTO', contextId: 'provision-1' };
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === 'portal_confirm_main_menu') return {
      status: 'processed', activeFlow,
      messages: [{ type: 'poll', question: 'TEM CERTEZA QUE DESEJA ABANDONAR ESTE FLUXO?', options: [
        { id: 'portal_draft_exit_discard', label: 'SIM, ABANDONAR' },
        { id: 'portal_draft_exit_cancel', label: 'NÃO, CONTINUAR' },
      ] }],
    };
    assert.equal(payload.replyId, 'portal_draft_exit_discard');
    return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
      activeFlow: null, attachments: [],
      messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }] };
  };
  await h.controller.start();
  const before = calls.length;
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'QUAL É O VALOR?', options: [
    { id: 'navigation_main_menu', label: 'RETORNAR AO MENU INICIAL' },
  ] }], { activeFlow });
  h.store.syncAttachments([{ id: 'file-1', fileName: 'conta.pdf', mediaUrl: '/api/portal-media/file-1', existing: true }]);
  h.store.setDraft('2000');

  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu', label: '🏠 RETORNAR AO MENU INICIAL' }), true);

  assert.deepEqual(calls.slice(before), ['portal_confirm_main_menu', 'portal_draft_exit_discard']);
  assert.equal(h.store.getState().activeFlow, null);
  assert.equal(h.store.getState().messages.at(-1).question, 'QUAL ÁREA VOCÊ DESEJA ACESSAR?');
  assert.deepEqual(h.store.getState().attachments, []);
  assert.equal(h.store.getState().draft, '');
  assert.equal(h.view.renders.some(render => render.messages?.some(message => /ABANDONAR ESTE FLUXO/.test(message.question || ''))), false);
});

test('casinha sai mesmo com anexo ainda na fila e sem conferir anexos do formulário', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = { id: 'payment_provision', title: 'CRIAR UMA PROVISÃO DE PAGAMENTO' };
  const calls = [];
  h.client.getAttachments = async () => { throw new Error('consulta de anexos indisponível'); };
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
      activeFlow: null, attachments: [],
      messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }] };
  };
  await h.controller.start();
  const before = calls.length;
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'QUAL É O VALOR?', options: [] }], { activeFlow });
  h.store.syncAttachments([{ id: 'confirmed-1', fileName: 'antigo.pdf', mediaUrl: '/api/portal-media/confirmed-1', existing: true }]);
  h.store.queueFiles([Object.assign(new Blob(['novo'], { type: 'application/pdf' }), { name: 'novo.pdf' })]);

  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu', label: '🏠 RETORNAR AO MENU INICIAL' }), true);
  assert.deepEqual(calls.slice(before), ['portal_confirm_main_menu']);
  assert.equal(h.store.getState().activeFlow, null);
  assert.deepEqual(h.store.getState().pendingFiles.map(item => item.file.name), ['novo.pdf']);
  assert.deepEqual(h.store.getState().attachments, []);
});

async function homeAttachmentHarness(t, { failTransfer = false } = {}) {
  const h = makeHarness({ historyMode: 'current-step' });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const flow = { id: 'launch', contextId: 'home-carry', title: 'EFETUAR LANÇAMENTO' };
  const fresh = { id: 'novo', fileName: 'nao-submetido.pdf', mimeType: 'application/pdf', mediaUrl: '/api/portal-media/novo', size: 123 };
  const existing = { id: 'antigo', fileName: 'ja-gravado.pdf', mimeType: 'application/pdf', mediaUrl: '/api/portal-media/antigo', existing: true };
  const readOnly = { id: 'somente-leitura', fileName: 'outro-gravado.pdf', mediaUrl: '/api/portal-media/somente-leitura', readOnly: true };
  const transferPrompt = { status: 'processed', activeFlow: { ...flow, contextId: 'transfer-confirmation', homeAttachmentTransfer: { requestId: 'home-selection', contextId: flow.contextId, attachmentIds: [fresh.id] } }, attachments: [fresh, existing, readOnly], messages: [{ type: 'poll', question: 'TEM CERTEZA QUE DESEJA ABANDONAR ESTE FLUXO? OS ANEXOS SERÃO TRANSFERIDOS PARA O PRÓXIMO FLUXO.', options: [{ id: 'portal_transfer_draft_discard', label: 'SIM, TRANSFERIR' }, { id: 'portal_transfer_cancel', label: 'NÃO, CONTINUAR' }] }] };
  const menu = { status: 'processed', returned_to_main_menu: true, resetConversation: true, activeFlow: null, attachments: [fresh, existing, readOnly], results: [{ status: 'awaiting_action', portal_transfer_decision: 'transfer', stage: 'choosing_group' }], messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }] };
  let transferred = false;
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === 'portal_transfer_attachments') {
      assert.deepEqual(payload.homeAttachmentIds, [fresh.id]);
      assert.equal(payload.expectedContextId, flow.contextId);
      return transferPrompt;
    }
    if (payload.replyId === 'portal_transfer_draft_discard') {
      assert.deepEqual(payload.homeTransferReceipt, transferPrompt.activeFlow.homeAttachmentTransfer);
      if (failTransfer) { failTransfer = false; throw new Error('rede interrompida'); }
      transferred = true;
      return menu;
    }
    if (payload.replyId === 'input_continue') return transferred ? menu : transferPrompt;
    if (payload.replyId === 'group_supplies') return { ...menu, attachments: [] };
    if (payload.replyId === 'new_launch') return { status: 'processed', activeFlow: { id: 'launch', contextId: 'next', title: 'EFETUAR LANÇAMENTO' }, attachments: [], messages: [{ type: 'poll', question: 'QUAL OPERAÇÃO?', options: [] }] };
    if (payload.replyId === 'submit') return { status: 'processed', resetConversation: true, activeFlow: null, attachments: [fresh], results: [{ status: 'completed' }], messages: [{ type: 'text', text: 'LANÇAMENTO GRAVADO' }] };
    throw new Error(`resposta inesperada: ${payload.replyId}`);
  };
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'QUAL O VALOR?', options: [] }], { activeFlow: flow });
  h.store.syncAttachments([fresh, existing, readOnly]);
  h.store.setDraft('não enviar este texto');
  return { ...h, calls };
}

test('casinha não confirma transferência de servidor antigo sem recibo seletivo', async t => {
  const h = await homeAttachmentHarness(t);
  const send = h.client.sendText;
  h.client.sendText = async payload => {
    const response = await send(payload);
    if (payload.replyId === 'portal_transfer_attachments') delete response.activeFlow.homeAttachmentTransfer;
    return response;
  };
  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu' }), false);
  assert.deepEqual(h.calls, ['portal_transfer_attachments']);
  assert.equal(h.store.getState().attachments.length, 3);
});

test('reabrir app restaura anexos novos retidos no menu remoto sem marcadores locais', async t => {
  const h = makeHarness({ historyMode: 'current-step' });
  t.after(() => h.controller.stop());
  h.client.sendText = async () => ({
    status: 'processed', activeFlow: null, results: [{ status: 'awaiting_action', stage: 'choosing_group' }],
    messages: [{ type: 'poll', question: 'ANEXO(S) RECEBIDO(S), DESEJA UTILIZAR ELES EM QUAL FLUXO?', options: [] }],
    attachments: [
      { id: 'novo', fileName: 'pendente.pdf', mediaUrl: '/api/portal-media/novo' },
      { id: 'velho', fileName: 'gravado.pdf', mediaUrl: '/api/portal-media/velho', existing: true },
    ],
  });
  await h.controller.start();
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ['pendente.pdf']);
});

test('casinha transfere apenas anexos novos sem postar nem mostrar confirmação', async t => {
  const h = await homeAttachmentHarness(t);
  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu' }), true);
  assert.deepEqual(h.calls, ['portal_transfer_attachments', 'portal_transfer_draft_discard']);
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ['nao-submetido.pdf']);
  assert.equal(h.store.getState().activeFlow, null);
  assert.equal(h.store.getState().draft, '');
  assert.match(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(1\)/);
  assert.equal(h.view.renders.some(state => state.messages.some(message => message.options?.some(option => option.id === 'portal_transfer_draft_discard'))), false);
});

test('casinha conserva anexos pelos menus e retomada até o novo fluxo e consome na postagem', async t => {
  const h = await homeAttachmentHarness(t);
  await h.view.emit('select-reply', { replyId: 'navigation_main_menu' });
  await h.view.emit('retry-session');
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ['nao-submetido.pdf']);
  await h.view.emit('select-reply', { replyId: 'group_supplies', label: 'SUPRIMENTOS' });
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ['nao-submetido.pdf']);
  await h.view.emit('select-reply', { replyId: 'new_launch', label: 'LANÇAMENTO' });
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ['nao-submetido.pdf']);
  assert.equal(h.store.getState().activeFlow.contextId, 'next');
  await h.view.emit('select-reply', { replyId: 'submit', label: 'SUBMETER' });
  assert.deepEqual(h.store.getState().attachments, []);
});

test('casinha retoma transferência interrompida sem apagar arquivos locais', async t => {
  const h = await homeAttachmentHarness(t, { failTransfer: true });
  h.store.queueFiles([Object.assign(new Blob(['pendente']), { name: 'local-pendente.txt' })]);
  h.store.queueFiles([Object.assign(new Blob(['assinatura']), { name: 'assinatura-oculta.png' })], { hideFromAttachmentTray: true });
  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu' }), false);
  assert.equal(h.store.getState().attachments.length, 3);
  await h.view.emit('retry-session');
  assert.deepEqual(h.calls, ['portal_transfer_attachments', 'portal_transfer_draft_discard', 'input_continue', 'portal_transfer_draft_discard']);
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ['nao-submetido.pdf']);
  assert.deepEqual(h.store.getState().pendingFiles.map(item => item.file.name), ['local-pendente.txt']);
});

test('casinha reconhece origem existing de respostas antigas como anexo já submetido', async t => {
  const h = makeHarness({ historyMode: 'current-step' });
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.syncAttachments([{ id: 'old', fileName: 'gravado.pdf', mediaUrl: '/api/portal-media/old', origin: 'existing' }]);
  h.client.sendText = async payload => {
    assert.equal(payload.replyId, 'portal_confirm_main_menu');
    return { status: 'processed', returned_to_main_menu: true, activeFlow: null, messages: [], attachments: [] };
  };
  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu' }), true);
  assert.deepEqual(h.store.getState().attachments, []);
});

test('retomar em outro contexto encerra a transferência antes da postagem', async t => {
  const h = await homeAttachmentHarness(t);
  await h.view.emit('select-reply', { replyId: 'navigation_main_menu' });
  const send = h.client.sendText;
  h.client.sendText = async payload => payload.replyId === 'input_continue'
    ? { status: 'processed', activeFlow: { id: 'launch', title: 'EFETUAR LANÇAMENTO', contextId: 'outra-postagem' }, attachments: [], messages: [{ type: 'poll', question: 'CONFIRMAR LANÇAMENTO?', options: [] }] }
    : payload.replyId === 'submit'
      ? { status: 'processed', resetConversation: true, attachments: [], results: [{ status: 'completed' }], messages: [{ type: 'text', text: 'GRAVADO' }] }
      : send(payload);
  await h.view.emit('retry-session');
  await h.view.emit('select-reply', { replyId: 'submit', label: 'SUBMETER' });
  assert.deepEqual(h.store.getState().attachments, []);
});

test('casinha retoma automaticamente mesmo se perder a resposta inicial da transferência', async t => {
  const h = await homeAttachmentHarness(t);
  const send = h.client.sendText;
  h.client.sendText = async payload => {
    const result = await send(payload);
    if (payload.replyId === 'portal_transfer_attachments') {
      const error = new Error('resposta perdida'); error.code = 'NETWORK_UNCERTAIN'; throw error;
    }
    return result;
  };
  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu' }), false);
  assert.equal(await h.view.emit('retry-session'), true);
  assert.equal(h.store.getState().activeFlow, null);
  assert.equal(h.store.getState().draft, '');
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ['nao-submetido.pdf']);
  assert.deepEqual(h.calls, ['portal_transfer_attachments', 'input_continue', 'portal_transfer_draft_discard']);
});

test('retomada após transferência com envelope choosing_group limpa texto mas mantém arquivos', async t => {
  const h = await homeAttachmentHarness(t);
  const send = h.client.sendText;
  let menu;
  h.client.sendText = async payload => {
    if (payload.replyId === 'input_continue' && menu) return { ...menu, returned_to_main_menu: undefined, resetConversation: undefined, portal_transfer_decision: undefined,
      results: [{ status: 'awaiting_action', stage: 'choosing_group' }], messages: [{ type: 'poll', question: 'ANEXO(S) RECEBIDO(S), DESEJA UTILIZAR ELES EM QUAL FLUXO?', options: [] }] };
    const result = await send(payload);
    if (payload.replyId === 'portal_transfer_draft_discard') { menu = result; const error = new Error('resposta perdida'); error.code = 'NETWORK_UNCERTAIN'; throw error; }
    return result;
  };
  h.store.queueFiles([Object.assign(new Blob(['local']), { name: 'local.txt' })]);
  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu' }), false);
  assert.equal(await h.view.emit('retry-session'), true);
  assert.equal(h.store.getState().draft, '');
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ['nao-submetido.pdf']);
  assert.deepEqual(h.store.getState().pendingFiles.map(item => item.file.name), ['local.txt']);
});

for (const phase of ['request', 'confirmation']) {
  test(`casinha não transfere anexos para outra conta após sair durante ${phase}`, async t => {
    const h = await homeAttachmentHarness(t);
    const send = h.client.sendText;
    let release, reached;
    const waiting = new Promise(resolve => { reached = resolve; });
    h.client.sendText = async payload => {
      if (payload.replyId === (phase === 'request' ? 'portal_transfer_attachments' : 'portal_transfer_draft_discard')) {
        const result = await send(payload);
        reached();
        await new Promise(resolve => { release = resolve; });
        return result;
      }
      return send(payload);
    };
    const navigation = h.view.emit('select-reply', { replyId: 'navigation_main_menu' });
    await waiting;
    await h.view.emit('sign-out');
    release();
    assert.equal(await navigation, false);
    assert.deepEqual(h.store.getState().attachments, []);
    assert.equal(h.store.getState().activeText, null);
    if (phase === 'request') assert.deepEqual(h.calls, ['portal_transfer_attachments']);
  });
}

test('casinha retenta o descarte pendente sem reenviar a saída inicial após falha', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = { id: 'payment_provision', title: 'CRIAR UMA PROVISÃO DE PAGAMENTO' };
  const calls = [];
  let failedOnce = false;
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === 'input_continue') return { status: 'processed', activeFlow,
      messages: [failedOnce
        ? { type: 'poll', question: 'TEM CERTEZA QUE DESEJA ABANDONAR ESTE FLUXO?', options: [
          { id: 'portal_draft_exit_discard', label: 'SIM, ABANDONAR' },
          { id: 'portal_draft_exit_cancel', label: 'NÃO, CONTINUAR' },
        ] }
        : { type: 'poll', question: 'QUAL É O VALOR?', options: [] }] };
    if (payload.replyId === 'portal_confirm_main_menu') return { status: 'processed', activeFlow,
      messages: [{ type: 'poll', question: 'TEM CERTEZA QUE DESEJA ABANDONAR ESTE FLUXO?', options: [
        { id: 'portal_draft_exit_discard', label: 'SIM, ABANDONAR' },
        { id: 'portal_draft_exit_cancel', label: 'NÃO, CONTINUAR' },
      ] }] };
    assert.equal(payload.replyId, 'portal_draft_exit_discard');
    if (!failedOnce) { failedOnce = true; throw new Error('falha temporária'); }
    return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
      activeFlow: null, messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }] };
  };
  await h.controller.start();
  const before = calls.length;

  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu', label: '🏠 RETORNAR AO MENU INICIAL' }), false);
  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu', label: '🏠 RETORNAR AO MENU INICIAL' }), false);
  assert.equal(await h.view.emit('retry-session'), true);
  assert.deepEqual(calls.slice(before), ['portal_confirm_main_menu', 'portal_draft_exit_discard', 'input_continue', 'portal_draft_exit_discard']);
  assert.equal(h.store.getState().messages.at(-1).question, 'QUAL ÁREA VOCÊ DESEJA ACESSAR?');
  assert.equal(h.view.renders.some(render => render.messages?.some(message => /ABANDONAR ESTE FLUXO/.test(message.question || ''))), false);
});

test('retomar conversa no menu elimina descarte antigo antes da próxima casinha', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = { id: 'payment_provision', title: 'CRIAR UMA PROVISÃO DE PAGAMENTO', contextId: 'provision-resume' };
  const calls = [];
  let discarded = false;
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === 'input_continue') return discarded
      ? { status: 'processed', returned_to_main_menu: true, resetConversation: true,
        activeFlow: null, messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }] }
      : { status: 'processed', activeFlow, messages: [{ type: 'poll', question: 'QUAL É O VALOR?', options: [] }] };
    if (payload.replyId === 'portal_confirm_main_menu') return discarded
      ? { status: 'processed', returned_to_main_menu: true, resetConversation: true,
        activeFlow: null, messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }] }
      : { status: 'processed', activeFlow,
        messages: [{ type: 'poll', question: 'TEM CERTEZA QUE DESEJA ABANDONAR ESTE FLUXO?', options: [
          { id: 'portal_draft_exit_discard', label: 'SIM, ABANDONAR' },
          { id: 'portal_draft_exit_cancel', label: 'NÃO, CONTINUAR' },
        ] }] };
    assert.equal(payload.replyId, 'portal_draft_exit_discard');
    discarded = true;
    const error = new Error('resposta perdida'); error.code = 'NETWORK_UNCERTAIN'; throw error;
  };
  await h.controller.start();
  const before = calls.length;
  h.store.setDraft('2000');
  h.store.queueFiles([Object.assign(new Blob(['comprovante'], { type: 'application/pdf' }), { name: 'comprovante.pdf' })]);

  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu', label: '🏠 RETORNAR AO MENU INICIAL' }), false);
  assert.equal(await h.view.emit('retry-session'), true);
  assert.equal(h.store.getState().activeFlow, null);
  assert.equal(h.store.getState().draft, '');
  assert.deepEqual(h.store.getState().pendingFiles.map(item => item.file.name), ['comprovante.pdf']);
  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu', label: '🏠 RETORNAR AO MENU INICIAL' }), true);
  assert.deepEqual(calls.slice(before), ['portal_confirm_main_menu', 'portal_draft_exit_discard', 'input_continue', 'portal_confirm_main_menu']);
});

test('casinha não apaga o texto nem informa sucesso se a VM não retornar ao menu', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = { id: 'payment_provision', title: 'CRIAR UMA PROVISÃO DE PAGAMENTO' };
  h.client.sendText = async payload => {
    if (payload.replyId === 'input_continue') return { status: 'processed', activeFlow,
      messages: [{ type: 'poll', question: 'QUAL É O VALOR?', options: [] }] };
    return { status: 'processed', activeFlow,
      messages: [{ type: 'poll', question: 'AINDA NO FORMULÁRIO', options: [] }] };
  };
  await h.controller.start();
  h.store.setDraft('2000');

  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_main_menu', label: '🏠 RETORNAR AO MENU INICIAL' }), false);
  assert.equal(h.store.getState().activeFlow.id, 'payment_provision');
  assert.equal(h.store.getState().draft, '2000');
  assert.match(h.view.renders.at(-1).error || '', /menu principal/i);
});

test('seta ao sair do fluxo abandona sem confirmação e retorna ao menu', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = { id: 'payment_provision', title: 'CRIAR UMA PROVISÃO DE PAGAMENTO', contextId: 'provision-2' };
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    if (payload.replyId === 'navigation_back') return {
      status: 'processed', activeFlow,
      messages: [{ type: 'poll', question: 'TEM CERTEZA QUE DESEJA ABANDONAR ESTE FLUXO?', options: [
        { reply: 'portal_draft_exit_discard', label: 'SIM, ABANDONAR' },
        { reply: 'portal_draft_exit_cancel', label: 'NÃO, CONTINUAR' },
      ] }],
    };
    assert.equal(payload.replyId, 'portal_draft_exit_discard');
    return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
      activeFlow: null, messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }] };
  };
  await h.controller.start();
  const before = calls.length;
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'PRIMEIRA PERGUNTA', options: [
    { id: 'navigation_back', label: 'RETORNAR' },
  ] }], { activeFlow });

  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_back', label: '↩️ RETORNAR À PERGUNTA ANTERIOR' }), true);
  assert.deepEqual(calls.slice(before), ['navigation_back', 'portal_draft_exit_discard']);
  assert.equal(h.store.getState().messages.at(-1).question, 'QUAL ÁREA VOCÊ DESEJA ACESSAR?');
  assert.equal(h.view.renders.some(render => render.messages?.some(message => /ABANDONAR ESTE FLUXO/.test(message.question || ''))), false);
});

test('seta dentro do fluxo volta à pergunta anterior sem descartar o formulário', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = { id: 'payment_provision', title: 'CRIAR UMA PROVISÃO DE PAGAMENTO', contextId: 'provision-3' };
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload.replyId);
    return { status: 'processed', activeFlow,
      messages: [{ type: 'poll', question: 'QUAL É O FORNECEDOR?', options: [] }] };
  };
  await h.controller.start();
  const before = calls.length;
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'QUAL É O VALOR?', options: [
    { id: 'navigation_back', label: 'RETORNAR' },
  ] }], { activeFlow });

  assert.equal(await h.view.emit('select-reply', { replyId: 'navigation_back', label: '↩️ RETORNAR À PERGUNTA ANTERIOR' }), true);
  assert.deepEqual(calls.slice(before), ['navigation_back']);
  assert.equal(h.store.getState().activeFlow.id, 'payment_provision');
  assert.equal(h.store.getState().messages.at(-1).question, 'QUAL É O FORNECEDOR?');
});

test('casinha descarta fluxo preenchido sem pedir para salvar rascunho', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = {
    id: 'task', title: 'EFETUAR LANÇAMENTO', contextId: 'ctx-1',
    rows: [{ label: 'OBRA', value: 'Obra A' }],
  };
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === 'portal_confirm_main_menu') {
      return { status: 'processed', activeFlow, messages: [{ type: 'poll', question: 'Deseja deixar como rascunho?', options: [
        { id: 'portal_draft_exit_save', label: 'SIM, SALVAR COMO RASCUNHO' },
        { id: 'portal_draft_exit_discard', label: 'NÃO, SAIR SEM SALVAR' },
      ] }] };
    }
    assert.equal(payload.replyId, 'portal_draft_exit_discard');
    return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
      activeFlow: null,
      messages: [{ type: 'poll', question: 'MENU PRINCIPAL', options: [] }] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'Pergunta do fluxo', options: [
    { id: 'navigation_main_menu', label: 'RETORNAR AO MENU INICIAL' },
  ] }], { activeFlow });
  assert.ok(h.store.getState().activeFlow);
  await h.view.emit('select-reply', { label: 'RETORNAR AO MENU INICIAL', replyId: 'navigation_main_menu' });
  assert.deepEqual(calls.map(call => call.replyId), ['input_continue', 'portal_confirm_main_menu', 'portal_draft_exit_discard']);
  assert.equal(h.store.getState().activeFlow, null);
  assert.equal(h.store.getState().messages.at(-1).question, 'MENU PRINCIPAL');
  assert.equal(h.view.renders.at(-1).recoveryReference, null);
  assert.doesNotMatch(renderChatMarkup(h.view.renders.at(-1)), /Rascunho da conversa anterior/);
});

test('casinha descarta linhas de lançamento sem mostrar pergunta de rascunho', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = {
    id: 'launch', title: 'EFETUAR LANÇAMENTO', contextId: 'ctx-launch',
    launches: {
      id: 'batch-1', currency: 'BRL', count: 1, total: '25', totalDisplay: 'R$ 25,00',
      lines: [{
        index: 1, product: 'AREIA', unit: 'M³', quantity: '1', unitPrice: '25', unitPriceDisplay: 'R$ 25,00',
        freight: '0', freightDisplay: 'R$ 0,00', total: '25', totalDisplay: 'R$ 25,00',
        details: { supplier: 'Fornecedor A', stage: 'Alvenaria', branch: 'Filial 004', account: 'Conta 1' },
      }],
    },
  };
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === 'portal_confirm_main_menu') {
      return { status: 'processed', activeFlow, messages: [{ type: 'poll', question: 'Deseja deixar como rascunho?', options: [
        { id: 'portal_draft_exit_save', label: 'SIM, SALVAR COMO RASCUNHO' },
        { id: 'portal_draft_exit_discard', label: 'NÃO, SAIR SEM SALVAR' },
      ] }] };
    }
    assert.equal(payload.replyId, 'portal_draft_exit_discard');
    return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
      activeFlow: null, messages: [{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [] }] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'Confirme a linha', options: [
    { id: 'navigation_main_menu', label: 'RETORNAR AO MENU INICIAL' },
  ] }], { activeFlow });

  await h.view.emit('select-reply', { label: 'RETORNAR AO MENU INICIAL', replyId: 'navigation_main_menu' });

  assert.deepEqual(calls.map(call => call.replyId), ['input_continue', 'portal_confirm_main_menu', 'portal_draft_exit_discard']);
  assert.equal(h.store.getState().activeFlow, null);
  assert.equal(h.store.getState().messages.at(-1).question, 'QUAL ÁREA VOCÊ DESEJA ACESSAR?');
});

for (const decision of ['portal_draft_exit_save', 'portal_draft_exit_discard']) {
  test(`ao sair para o menu (${decision === 'portal_draft_exit_save' ? 'salvar' : 'descartar'}), limpa a lista de anexos do fluxo`, async () => {
    const h = makeHarness({ historyMode: 'current-step' });
    const activeFlow = { id: 'document', title: 'ADICIONAR UM NOVO DOCUMENTO', contextId: 'ctx-attachments' };
    h.client.sendText = async payload => {
      if (payload.replyId === 'portal_confirm_main_menu') {
        return { status: 'processed', activeFlow, messages: [{ type: 'poll', question: 'Deseja deixar como rascunho?', options: [
          { id: 'portal_draft_exit_save', label: 'CRIAR RASCUNHO' },
          { id: 'portal_draft_exit_discard', label: 'ELIMINAR FORMULÁRIO' },
        ] }] };
      }
      return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
        activeFlow: null, messages: [{ type: 'poll', question: 'MENU PRINCIPAL', options: [] }] };
    };
    await h.controller.start();
    h.store.ingestRemoteMessages([{ type: 'poll', question: 'Qual documento?', options: [
      { id: 'navigation_main_menu', label: 'RETORNAR AO MENU INICIAL' },
    ] }], { activeFlow });
    h.store.syncAttachments([{ id: 'flow-file', fileName: 'contrato.pdf', mimeType: 'application/pdf', size: 123, mediaUrl: '/api/portal-media/flow-file', existing: true }]);
    assert.equal(h.store.getState().attachments.length, 1);

    await h.view.emit('select-reply', { label: 'RETORNAR AO MENU INICIAL', replyId: 'navigation_main_menu' });
    await h.view.emit('select-reply', { label: decision === 'portal_draft_exit_save' ? 'CRIAR RASCUNHO' : 'ELIMINAR FORMULÁRIO', replyId: decision });

    assert.deepEqual(h.store.getState().attachments, [], 'o menu principal não pode herdar anexos do fluxo anterior');
    assert.doesNotMatch(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(/);
  });
}

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

test("anexo grande abre a prévia de compactação depois de ser confirmado", async () => {
  const h = makeHarness();
  const largeFile = { name: "comprovante.pdf", size: 6_400_000, type: "application/pdf" };
  h.native.pickDocuments = async () => [largeFile];
  h.client.sendFile = async file => ({
    status: "processed",
    messages: [{ type: "text", text: `Recebi ${file.name}` }],
    activeFlow: { id: "asset", title: "CADASTRAR IMOBILIZADO" },
    attachments: [{
      id: "large-attachment",
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      mediaUrl: "/api/portal-media/large-attachment",
    }],
  });
  h.client.compressAttachment = async attachmentId => {
    h.chatCalls.push(["compress-attachment", attachmentId]);
    return {
      status: "processed",
      messages: [{
        type: "poll",
        question: "Deseja usar a versão compactada?",
        options: [
          { id: "attachment_compression_use", reply: "attachment_compression_use", label: "SIM" },
          { id: "attachment_compression_keep", reply: "attachment_compression_keep", label: "NÃO" },
        ],
      }],
      attachments: [{
        id: "large-attachment",
        fileName: largeFile.name,
        mimeType: largeFile.type,
        size: 1_200_000,
        mediaUrl: "/api/portal-media/large-attachment",
      }],
    };
  };
  await h.controller.start();
  await h.view.emit("pick-files");

  assert.deepEqual(h.chatCalls.filter(call => call[0] === "compress-attachment"), [
    ["compress-attachment", "large-attachment"],
  ]);
  const compressionPrompt = h.store.getState().messages.at(-1);
  assert.match(compressionPrompt?.question || "", /versão compactada/);
  assert.deepEqual(compressionPrompt?.attachment_compression_preview, {
    original: {
      id: "large-attachment",
      fileName: "comprovante.pdf",
      mimeType: "application/pdf",
      size: 6_400_000,
      mediaUrl: "/api/portal-media/large-attachment",
    },
    compressed: {
      id: "large-attachment",
      fileName: "comprovante.pdf",
      mimeType: "application/pdf",
      size: 1_200_000,
      mediaUrl: "/api/portal-media/large-attachment",
    },
  });
  h.controller.stop();
});

for (const [phase, options] of [
  ["oferta", ["compress_attachments_yes", "compress_attachments_no", "compress_all_attachments"]],
  ["nível", ["compression_level_low", "compression_level_medium", "compression_level_high", "compression_level_very_high", "compress_attachments_no"]],
  ["prévia", ["use_compressed_attachment", "request_intermediate_attachment", "use_original_attachment"]],
  ["prévia intermediária", ["use_intermediate_attachment", "use_compressed_attachment", "use_original_attachment"]],
  ["portal", ["attachment_compression_level_high", "attachment_compression_use_original"]],
]) for (const receipt of [false, true]) {
  test(`upload aceito com ${phase} de compressão ${receipt ? "após recibo" : "direta"} não inicia outra compactação nem exibe falso erro`, async t => {
    const h = makeHarness({ historyMode: "current-step" });
    t.after(() => h.controller.stop());
    await h.controller.start();
    const file = { name: "documento-pesado.pdf", size: 12_800_000, type: "application/pdf" };
    const attachment = { id: "accepted", fileName: file.name, mimeType: file.type, size: file.size, mediaUrl: "/api/portal-media/accepted" };
    const activeFlow = { id: "supplies", title: "SUPRIMENTOS", contextId: "supplies:upload" };
    const prompt = { type: "poll", question: "ANEXO 1/2 — DESEJA COMPRIMIR?", options: options.map(id => ({ id, reply: id, label: id })) };
    h.native.pickDocuments = async () => [file];
    h.client.sendFile = async () => ({ status: "processed", activeFlow, attachments: [attachment],
      messages: receipt ? [{ type: "text", text: "Anexo recebido com sucesso." }, prompt] : [prompt] });
    h.client.compressAttachment = async id => {
      h.chatCalls.push(["compress-attachment", id]);
      throw new Error("O anexo não está mais disponível neste fluxo");
    };
    await h.view.emit("pick-files");
    if (receipt) await new Promise(resolve => setTimeout(resolve, 1050));
    assert.equal(h.view.renders.some(state => Boolean(state.error)), false, "a second compression must not turn a successful upload into an error");
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "compress-attachment"), []);
    assert.equal(h.store.getState().pendingFiles.length, 0);
    assert.equal(h.store.getState().attachments.length, 1);
    assert.equal(h.store.getState().attachments[0].id, attachment.id);
    assert.equal(h.store.getState().activeFlow.contextId, activeFlow.contextId);
    assert.equal(h.store.getState().messages.at(-1).question, prompt.question);
    assert.deepEqual(h.store.getState().messages.at(-1).options, prompt.options);
    if (phase !== "portal") {
      const replyId = options.find(id => /(?:_no|original_attachment)$/.test(id));
      await h.view.emit("select-reply", { replyId, label: "MANTER ORIGINAL" });
      assert.deepEqual(h.chatCalls.at(-1), ["text", { text: "MANTER ORIGINAL", replyId }]);
    }
  });
}

test("compactação manual de anexo realmente indisponível continua exibindo o erro", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow: { id: "supplies", title: "SUPRIMENTOS" }, attachments: [
    { id: "missing", fileName: "indisponivel.pdf", mimeType: "application/pdf", size: 8_000_000, mediaUrl: "/api/portal-media/missing" },
  ] });
  h.client.compressAttachment = async () => { throw new Error("O anexo não está mais disponível neste fluxo"); };
  assert.equal(await h.view.emit("compress-attachment", { fileId: "missing" }), false);
  assert.match(h.view.renders.at(-1).error, /O anexo não está mais disponível neste fluxo/);
});

test("upload pesado que realmente falhou continua exibindo o erro e não oferece compactação", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.native.pickDocuments = async () => [{ name: "falhou.pdf", size: 12_800_000, type: "application/pdf" }];
  h.client.sendFile = async () => { throw new Error("Falha real no envio"); };
  h.client.compressAttachment = async () => { h.chatCalls.push(["compress-attachment"]); };
  await h.view.emit("pick-files");
  assert.equal(h.store.getState().attachments.length, 0);
  assert.match(h.view.renders.at(-1).error, /Falha real no envio/);
  assert.deepEqual(h.chatCalls.filter(call => call[0] === "compress-attachment"), []);
});

test("menu de níveis aguarda a escolha sem inventar prévia e mostra o candidato escolhido", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const original = { id: "original", fileName: "nota.pdf", mimeType: "application/pdf", size: 8_000_000, mediaUrl: "/media/original" };
  const activeFlow = { id: "launch", title: "EFETUAR LANÇAMENTO", contextId: "launch:attachments" };
  const levelOptions = ["low", "medium", "high", "very_high"].map(level => ({
    id: `attachment_compression_level_${level}`, reply: `attachment_compression_level_${level}`, label: level,
  }));
  levelOptions.push({ id: "attachment_compression_use_original", label: "MANTER ORIGINAL" });
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original] });
  h.chatCalls.length = 0;
  h.client.compressAttachment = async id => {
    h.chatCalls.push(["compress-attachment", id]);
    return { status: "processed", activeFlow, attachments: [original], messages: [{
      type: "poll", question: "Escolha o nível de compressão", options: levelOptions,
    }] };
  };
  const preview = {
    original,
    compressed: { ...original, id: "candidate", size: 400_000, mediaUrl: "/media/candidate" },
  };
  h.client.chooseAttachmentCompression = async choice => {
    h.chatCalls.push(["choose-compression", choice]);
    return { status: "processed", activeFlow, attachments: [original], messages: [{
      type: "poll", question: "Deseja usar a versão comprimida?", attachment_compression_preview: preview,
      options: [
        { id: "attachment_compression_use_compressed", reply: "attachment_compression_use_compressed", label: "Usar comprimida" },
        { id: "attachment_compression_use_original", reply: "attachment_compression_use_original", label: "Usar original" },
      ],
    }] };
  };
  await h.view.emit("compress-attachment", { fileId: "original" });
  const menu = h.store.getState().messages.at(-1);
  assert.deepEqual(menu.options, levelOptions);
  assert.equal(menu.attachment_compression_preview, undefined);
  assert.equal(h.store.getState().attachments[0].size, 8_000_000);
  assert.equal(h.store.getState().activeFlow.contextId, "launch:attachments");
  await h.view.emit("select-reply", { replyId: levelOptions[3].reply, label: levelOptions[3].label });
  assert.deepEqual(h.chatCalls.filter(call => ["compress-attachment", "choose-compression", "text"].includes(call[0])), [
    ["compress-attachment", "original"], ["choose-compression", "attachment_compression_level_very_high"],
  ]);
  assert.deepEqual(h.store.getState().messages.at(-1).attachment_compression_preview, preview);
  assert.equal(h.store.getState().activeFlow.contextId, "launch:attachments");
  assert.equal(h.store.getState().attachments[0].size, 8_000_000);
});

test("níveis genéricos de compressão no upload seguem a resposta normal do fluxo", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.client.chooseAttachmentCompression = async () => { throw new Error("Não deve chamar ação de anexo"); };
  await h.view.emit("select-reply", { replyId: "compression_level_high", label: "ALTA — até 1 MB; redução mínima de 80%" });
  assert.deepEqual(h.chatCalls.at(-1), ["text", { text: "ALTA — até 1 MB; redução mínima de 80%", replyId: "compression_level_high" }]);
});

const compressionFlow = { id: "order_attachment", title: "ADICIONAR UM ANEXO A UM PEDIDO", contextId: "pedido:425" };
const compressionFlowPrompt = { type: "poll", question: "COMO DESEJA PROSSEGUIR COM OS ANEXOS?", options: [
  { id: "input_continue", reply: "input_continue", label: "FINALIZAR ANEXOS" },
  { id: "flow_summary", reply: "flow_summary", label: "VER RESUMO" },
] };
const compressionOriginal = { id: "original", fileName: "nota.pdf", mimeType: "application/pdf", size: 6_400_000, mediaUrl: "/api/portal-media/original" };
const compressionLevelPrompt = { type: "poll", question: "Escolha o nível de compressão", options: [
  { id: "attachment_compression_level_high", label: "ALTA COMPRESSÃO" },
  { id: "attachment_compression_use_original", label: "MANTER ORIGINAL" },
] };
const compressionPreviewPrompt = { type: "poll", question: "Qual versão deseja usar?", options: [
  { id: "attachment_compression_use_compressed", label: "USAR COMPRIMIDA" },
  { id: "attachment_compression_use_original", label: "USAR ORIGINAL" },
] };

for (const choice of ["attachment_compression_use_original", "attachment_compression_keep", "attachment_compression_use_compressed", "attachment_compression_use"]) {
  test(`compressão ${choice}: retorna à pergunta pendente sem responder ou postar o pedido`, async t => {
    const h = makeHarness({ historyMode: "current-step" });
    t.after(() => h.controller.stop());
    await h.controller.start();
    h.store.ingestRemoteMessages([compressionFlowPrompt], { activeFlow: compressionFlow, attachments: [compressionOriginal] });
    h.store.setDraft("observação ainda não enviada");
    h.client.compressAttachment = async () => ({ status: "processed", messages: [compressionLevelPrompt] });
    const selected = choice.endsWith("compressed") || choice === "attachment_compression_use"
      ? { ...compressionOriginal, id: "selected-compressed", size: 800_000, mediaUrl: "/api/portal-media/compressed" }
      : { ...compressionOriginal, id: "selected-original" };
    h.client.chooseAttachmentCompression = async value => value.startsWith("attachment_compression_level_")
      ? { status: "processed", messages: [compressionPreviewPrompt] }
      : { status: "processed", messages: [{ type: "text", text: selected.size === 800_000 ? "📎 Anexo comprimido selecionado." : "📎 Anexo original mantido." }], attachments: [selected] };
    await h.view.emit("compress-attachment", { fileId: compressionOriginal.id });
    if (choice !== "attachment_compression_use_original") {
      await h.view.emit("select-reply", { replyId: "attachment_compression_level_high", label: "ALTA COMPRESSÃO" });
      assert.equal(h.store.getState().messages.at(-1).question, "Qual versão deseja usar?", "a prévia ainda exige confirmação da versão");
    }
    h.chatCalls.length = 0;
    assert.equal(await h.view.emit("select-reply", { replyId: choice, label: "ESCOLHER VERSÃO" }), true);
    const state = h.store.getState();
    assert.equal(state.messages.at(-1).question, "COMO DESEJA PROSSEGUIR COM OS ANEXOS?");
    assert.deepEqual(state.messages.at(-1).options.map(option => option.id), ["input_continue", "flow_summary"]);
    assert.deepEqual(state.activeFlow, compressionFlow);
    assert.equal(state.draft, "observação ainda não enviada");
    assert.equal(state.attachments.length, 1);
    assert.equal(state.attachments[0].id, selected.id, "não deve restaurar a versão antiga junto da pergunta");
    assert.equal(state.attachments[0].size, selected.size);
    const dom = new JSDOM(renderChatMarkup(h.view.renders.at(-1)));
    assert.equal(dom.window.document.querySelector('[data-reply-id="input_continue"]')?.disabled, false);
    assert.equal(dom.window.document.querySelector('[data-reply-id^="attachment_compression_"]'), null);
    assert.deepEqual(h.chatCalls.filter(call => ["text", "file"].includes(call[0])), [], "a compressão não é uma resposta ao formulário nem um novo upload");
  });
}

test("compressão automática após upload retorna à pergunta anterior quando o recibo contém só aviso", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([compressionFlowPrompt], { activeFlow: compressionFlow });
  h.native.pickDocuments = async () => [{ name: "nota.pdf", type: "application/pdf", size: 6_400_000 }];
  h.client.sendFile = async () => ({ status: "processed", activeFlow: compressionFlow,
    messages: [{ type: "text", text: "Anexo recebido." }], attachments: [compressionOriginal] });
  h.client.compressAttachment = async () => ({ status: "processed", messages: [compressionLevelPrompt] });
  h.client.chooseAttachmentCompression = async () => ({ status: "processed", messages: [{ type: "text", text: "📎 Anexo original mantido." }] });
  await h.view.emit("pick-files");
  assert.equal(h.store.getState().messages.at(-1).question, "Escolha o nível de compressão");
  await h.view.emit("select-reply", { replyId: "attachment_compression_use_original", label: "MANTER ORIGINAL" });
  assert.equal(h.store.getState().messages.at(-1).question, "COMO DESEJA PROSSEGUIR COM OS ANEXOS?");
  assert.equal(h.store.getState().attachments[0].id, "original");
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

for (const nextPrompt of [
  { type: "poll", question: "DESEJA POSTAR OS ANEXOS?", options: [{ id: "post", label: "POSTAR" }] },
  { type: "text", text: "QUAL A DATA DO DOCUMENTO?" },
]) test(`compressão automática mantém a escolha visível antes de retomar ${nextPrompt.type}`, async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop()); await h.controller.start();
  h.store.ingestRemoteMessages([compressionFlowPrompt], { activeFlow: compressionFlow });
  h.native.pickDocuments = async () => [{ name: "nota.pdf", type: "application/pdf", size: 6_400_000 }];
  h.client.sendFile = async () => ({ status: "processed", activeFlow: compressionFlow,
    messages: [{ type: "text", text: "📎 ANEXO RECEBIDO." }, nextPrompt], attachments: [compressionOriginal] });
  h.client.compressAttachment = async () => ({ status: "processed", messages: [compressionLevelPrompt] });
  h.client.chooseAttachmentCompression = async choice => choice === "attachment_compression_level_high"
    ? { status: "processed", messages: [compressionPreviewPrompt] }
    : { status: "processed", messages: [{ type: "text", text: "Anexo comprimido selecionado." }] };
  await h.view.emit("pick-files");
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.equal(h.store.getState().messages.at(-1).question, "Escolha o nível de compressão", "o temporizador do recibo de upload não pode esconder escolhas pendentes");
  assert.equal(await h.view.emit("select-reply", { replyId: "attachment_compression_level_high", label: "ALTA COMPRESSÃO" }), true);
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.equal(h.store.getState().messages.at(-1).question, "Qual versão deseja usar?");
  assert.equal(await h.view.emit("select-reply", { replyId: "attachment_compression_use_compressed", label: "USAR COMPRIMIDA" }), true);
  const restored = h.store.getState().messages.at(-1);
  assert.equal(restored.type, nextPrompt.type);
  assert.equal(restored.question || restored.text, nextPrompt.question || nextPrompt.text, "deve retomar a próxima pergunta autoritativa, não a anterior ao upload");
});

test("compressão respeita a nova pergunta devolvida pela VM em vez de restaurar a anterior", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop()); await h.controller.start();
  h.store.ingestRemoteMessages([compressionFlowPrompt], { activeFlow: compressionFlow, attachments: [compressionOriginal] });
  h.client.compressAttachment = async () => ({ status: "processed", messages: [compressionLevelPrompt] });
  h.client.chooseAttachmentCompression = async () => ({ status: "processed", messages: [
    { type: "text", text: "Anexo original mantido." }, { type: "poll", question: "DESEJA POSTAR?", options: [{ id: "post", label: "POSTAR" }] },
  ] });
  await h.view.emit("compress-attachment", { fileId: "original" });
  await h.view.emit("select-reply", { replyId: "attachment_compression_use_original", label: "MANTER ORIGINAL" });
  assert.equal(h.store.getState().messages.at(-1).question, "DESEJA POSTAR?");
  assert.equal(h.store.getState().messages.some(message => message.question === compressionFlowPrompt.question), false);
});

test("compressão repetida com histórico completo retoma a pergunta atual, não um menu antigo", async t => {
  const h = makeHarness({ historyMode: "full" });
  t.after(() => h.controller.stop()); await h.controller.start();
  h.store.ingestRemoteMessages([compressionFlowPrompt], { activeFlow: compressionFlow, attachments: [compressionOriginal] });
  h.client.compressAttachment = async () => ({ status: "processed", messages: [compressionLevelPrompt] });
  h.client.chooseAttachmentCompression = async () => ({ status: "processed", messages: [{ type: "text", text: "Anexo original mantido." }] });
  for (const question of ["COMO DESEJA PROSSEGUIR COM OS ANEXOS?", "DESEJA FAZER UMA OBSERVAÇÃO?"]) {
    h.store.ingestRemoteMessages([{ ...compressionFlowPrompt, question }], { activeFlow: compressionFlow });
    await h.view.emit("compress-attachment", { fileId: "original" });
    await h.view.emit("select-reply", { replyId: "attachment_compression_use_original", label: "MANTER ORIGINAL" });
    assert.equal(h.store.getState().messages.at(-1).question, question);
  }
});

test("compressão com erro permite tentar a escolha novamente e só depois retorna ao fluxo", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop()); await h.controller.start();
  h.store.ingestRemoteMessages([compressionFlowPrompt], { activeFlow: compressionFlow, attachments: [compressionOriginal] });
  h.client.compressAttachment = async () => ({ status: "processed", messages: [compressionLevelPrompt] });
  h.client.chooseAttachmentCompression = async () => { throw new Error("Falha temporária da compressão"); };
  await h.view.emit("compress-attachment", { fileId: "original" });
  assert.equal(await h.view.emit("select-reply", { replyId: "attachment_compression_use_original", label: "MANTER ORIGINAL" }), false);
  assert.equal(h.store.getState().messages.at(-1).question, "Escolha o nível de compressão");
  assert.equal(h.store.getState().attachments[0].size, 6_400_000);
  h.client.chooseAttachmentCompression = async () => ({ status: "processed", messages: [{ type: "text", text: "Anexo original mantido." }] });
  assert.equal(await h.view.emit("select-reply", { replyId: "attachment_compression_use_original", label: "MANTER ORIGINAL" }), true);
  assert.equal(h.store.getState().messages.at(-1).question, "COMO DESEJA PROSSEGUIR COM OS ANEXOS?");
});

for (const result of [
  { resetConversation: true, activeFlow: null },
  { activeFlow: null, results: [{ status: "completed" }] },
  { activeFlow: { ...compressionFlow, contextId: "pedido:426" } },
]) test(`compressão não ressuscita o formulário anterior em ${JSON.stringify(result)}`, async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop()); await h.controller.start();
  h.store.ingestRemoteMessages([compressionFlowPrompt], { activeFlow: compressionFlow, attachments: [compressionOriginal] });
  h.client.compressAttachment = async () => ({ status: "processed", messages: [compressionLevelPrompt] });
  h.client.chooseAttachmentCompression = async () => ({ status: "processed", ...result, messages: [{ type: "text", text: "Outro estado confirmado." }] });
  await h.view.emit("compress-attachment", { fileId: "original" });
  await h.view.emit("select-reply", { replyId: "attachment_compression_use_original", label: "MANTER ORIGINAL" });
  assert.equal(h.store.getState().messages.at(-1).text, "Outro estado confirmado.");
  assert.equal(h.store.getState().messages.some(message => message.question === compressionFlowPrompt.question), false);
});

for (const outcome of ["success", "failure"]) {
  test(`compressão ${outcome}: resposta antiga não reaparece após sair e entrar na mesma conta`, async t => {
    const sameAccount = { homeAccountId: "same", name: "QA" };
    const h = makeHarness({ historyMode: "current-step", account: sameAccount });
    t.after(() => h.controller.stop()); await h.controller.start();
    h.auth.signIn = async () => sameAccount;
    h.store.ingestRemoteMessages([compressionFlowPrompt], { activeFlow: compressionFlow, attachments: [compressionOriginal] });
    h.client.compressAttachment = async () => ({ status: "processed", messages: [compressionLevelPrompt] });
    let finish;
    h.client.chooseAttachmentCompression = () => new Promise((resolve, reject) => {
      finish = () => outcome === "success" ? resolve({ status: "processed", messages: [{ type: "text", text: "aviso da sessão antiga" }] }) : reject(new Error("erro da sessão antiga"));
    });
    await h.view.emit("compress-attachment", { fileId: "original" });
    const pending = h.view.emit("select-reply", { replyId: "attachment_compression_use_original", label: "MANTER ORIGINAL" });
    await h.view.emit("sign-out"); await h.view.emit("sign-in");
    h.store.ingestRemoteMessages([{ type: "poll", question: "NOVA SESSÃO", options: [] }], { activeFlow: null });
    finish();
    assert.equal(await pending, false);
    assert.equal(h.store.getState().messages.at(-1).question, "NOVA SESSÃO");
    assert.ok(!h.view.renders.some(state => String(state.error || "").includes("erro da sessão antiga")));
  });
}

test("arquivos soltos no chat usam a mesma fila de envio dos anexos selecionados", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const files = [
    new File(["pdf"], "arrastado.pdf", { type: "application/pdf" }),
    new File(["foto"], "arrastada.jpg", { type: "image/jpeg" }),
  ];

  await h.view.emit("files-dropped", { files });

  assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [
    ["file", "arrastado.pdf"],
    ["file", "arrastada.jpg"],
  ]);
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test("arquivo de áudio no Diário de Obras vira texto técnico e não é enviado como anexo", async t => {
  const h = makeHarness();
  const transcripts = [];
  h.client.transcribeAudio = async file => {
    transcripts.push(file.name);
    return "Eu fiz a concretagem da laje grande. Eu conferi o nível.";
  };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "DIGITE AS ATIVIDADES EXECUTADAS",
    options: [],
  }], { activeFlow: { id: "construction_task", title: "PREENCHER DIÁRIO DE OBRAS" } });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const audio = new File(["audio"], "atividade.m4a", { type: "audio/mp4" });

  await h.view.emit("files-dropped", { files: [audio] });

  assert.deepEqual(transcripts, ["atividade.m4a"]);
  assert.equal(h.chatCalls.some(call => call[0] === "file"), false);
  assert.equal(h.store.getState().draft, "Execução de concretagem da laje grande. Verificação de nível.");
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test("áudio recebido pelo compartilhamento no Diário de Obras vira texto técnico", async t => {
  const h = makeHarness();
  let resume;
  const transcripts = [];
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  h.client.transcribeAudio = async file => {
    transcripts.push(file.name);
    return "Foi realizada a conferência da armação.";
  };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "DIGITE AS ATIVIDADES EXECUTADAS",
    options: [],
  }], { activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } });
  t.after(() => h.controller.stop());
  await h.controller.start();

  const audio = new File(["audio"], "AUDIO-2026-09-28-17-50-14.m4a", { type: "audio/mp4" });
  Object.defineProperty(audio, "sourceId", { value: "shared-audio-1" });
  h.native.importSharedItems = async () => [audio];
  await resume();

  assert.deepEqual(transcripts, ["AUDIO-2026-09-28-17-50-14.m4a"]);
  assert.equal(h.chatCalls.some(call => call[0] === "file"), false);
  assert.equal(h.store.getState().draft, "Foi realizada a conferência da armação.");
  assert.equal(h.store.getState().pendingFiles.length, 0);
  assert.deepEqual(h.discarded, ["shared-audio-1"]);
});

test("falha ao transcrever áudio preserva o arquivo pendente", async t => {
  const h = makeHarness();
  h.client.transcribeAudio = async () => { throw new Error("Serviço de transcrição indisponível"); };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "INFORME AS OBSERVAÇÕES",
    options: [],
  }], { activeFlow: { id: "construction_task", title: "PREENCHER DIÁRIO DE OBRAS" } });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const audio = new File(["audio"], "observacao.ogg", { type: "audio/ogg" });

  const accepted = await h.view.emit("files-dropped", { files: [audio] });

  assert.equal(accepted, false);
  assert.equal(h.store.getState().pendingFiles.length, 1);
  assert.equal(h.store.getState().pendingFiles[0].status, "failed");
  assert.match(h.view.renders.at(-1)?.error || "", /indisponível/i);
  assert.equal(h.chatCalls.some(call => call[0] === "file"), false);
});

test("assinatura desenhada entra na fila de anexos e é enviada pela VM", async () => {
  const h = makeHarness();
  await h.controller.start();
  const file = new File(["png"], "assinatura-desenhada.png", { type: "image/png" });
  await h.view.emit("signature-captured", { file });
  assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "assinatura-desenhada.png"]]);
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test("assinatura capturada não aparece como anexo separado na bandeja", async () => {
  const h = makeHarness();
  h.client.sendFile = async file => ({
    status: "processed",
    messages: [{ type: "text", text: "Assinatura recebida" }],
    attachments: [
      { id: "documento", fileName: "contrato.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/documento" },
      { id: "assinatura", fileName: file.name, mimeType: file.type, size: file.size, mediaUrl: "/assinatura" },
    ],
  });
  await h.controller.start();
  const file = new File(["png"], "assinatura-desenhada.png", { type: "image/png" });
  await h.view.emit("signature-captured", { file });

  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["contrato.pdf"]);
  const markup = renderChatMarkup(h.view.renders.at(-1));
  const attachmentTray = markup.slice(markup.indexOf('<div class="chat-file-tray">'));
  assert.doesNotMatch(attachmentTray, /assinatura-desenhada\.png/);
  h.controller.stop();
});

test("primeira assinatura desenhada abre o posicionamento sem exigir um segundo envio", async () => {
  const h = makeHarness();
  const fetched = [];
  h.client.fetchMedia = async item => {
    fetched.push(item.id);
    return new Blob([item.id], {
      type: item.mimeType || (item.fileName.endsWith(".pdf") ? "application/pdf" : "image/png"),
    });
  };
  h.client.sendFile = async file => ({
    status: "processed",
    messages: [{ type: "text", text: "Assinatura recebida" }],
    activeFlow: {
      id: "document_signing",
      title: "ASSINAR DOCUMENTOS",
      documentSigningPlacement: { stage: "document_signing_waiting_position" },
    },
    attachments: [
      { id: "documento", fileName: "contrato.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/documento" },
      { id: "assinatura", fileName: file.name, mimeType: file.type, size: file.size, mediaUrl: "/assinatura" },
    ],
  });
  await h.controller.start();

  const file = new File(["png"], "assinatura-desenhada.png", { type: "image/png" });
  await h.view.emit("signature-captured", { file });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(h.store.getState().activeFlow.documentSigningPlacement, {
    stage: "document_signing_waiting_position",
    scope: null,
    document: {
      id: "documento",
      fileName: "contrato.pdf",
      mimeType: "application/pdf",
      mediaUrl: "/documento",
    },
    signature: {
      id: "assinatura",
      fileName: "assinatura-desenhada.png",
      mimeType: "image/png",
      mediaUrl: "/assinatura",
    },
  });
  assert.deepEqual(fetched.sort(), ["assinatura", "documento"]);
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["contrato.pdf"]);
  h.controller.stop();
});

test("comprovante gerado preserva o PDF fonte ao enviar a prévia assinada", () => {
  assert.equal(
    shouldRemoveSignedSource("payment-source", true),
    false,
  );
  assert.equal(shouldRemoveSignedSource("tray-source", false), true);
  assert.equal(shouldRemoveSignedSource("", false), false);
});

test("assina PDF da bandeja, abre o posicionamento e só substitui o original após confirmar o assinado", async () => {
  const signedCalls = [];
  const h = makeHarness({
    signPdfAttachment: async input => {
      signedCalls.push(input);
      return new Blob(["signed-pdf"], { type: "application/pdf" });
    },
  });
  const activeFlow = { id: "task", title: "ADICIONAR UMA NOVA TAREFA" };
  const original = { id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/report" };
  const refreshedOriginal = { ...original, id: "report-v2", mediaUrl: "/report-v2" };
  const uploaded = { id: "signed", fileName: "relatorio-assinado.pdf", mimeType: "application/pdf", size: 2400, mediaUrl: "/signed" };
  h.client.fetchMedia = async item => {
    h.chatCalls.push(["media", item.id]);
    return new Blob(["original-pdf"], { type: "application/pdf" });
  };
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    return {
      status: "processed",
      messages: [
        { type: "text", text: "📎 ANEXO RECEBIDO. Continue preenchendo o formulário." },
        { type: "text", text: "Qual é a próxima informação?" },
      ],
      activeFlow,
      attachments: [refreshedOriginal, uploaded],
    };
  };
  h.client.deleteAttachment = async id => {
    h.chatCalls.push(["delete-attachment", id]);
    return { status: "processed", messages: [], activeFlow, attachments: [uploaded] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original] });
  h.chatCalls.length = 0;

  const signature = new File(["png"], "assinatura-desenhada.png", { type: "image/png" });
  await h.view.emit("signature-captured", { file: signature, fileId: "report" });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.deepEqual(h.chatCalls, [["media", "report"]], "a assinatura não deve ser enviada à etapa da tarefa");

  await h.view.emit("signature-placement-position", { point: { page: 1, x: 0.5, y: 0.65, scale: 0.2 } });

  assert.equal(signedCalls.length, 1);
  assert.equal(signedCalls[0].point.scale, 0.2);
  assert.equal(signedCalls[0].documentBlob.type, "application/pdf");
  assert.equal(signedCalls[0].signatureBlob, signature);
  assert.deepEqual(h.chatCalls, [
    ["media", "report"],
    ["file", "relatorio-assinado.pdf"],
    ["delete-attachment", "report-v2"],
  ]);
  assert.equal(h.store.getState().activeFlow.id, "task");
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["relatorio-assinado.pdf"]);
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("assina PDF já existente no documento pendente sem excluir o original do SharePoint", async t => {
  const signedCalls = [];
  const h = makeHarness({ signPdfAttachment: async input => {
    signedCalls.push(input);
    return new Blob(["signed-pdf"], { type: "application/pdf" });
  } });
  t.after(() => h.controller.stop());
  const activeFlow = { id: "pending_document_attachment", title: "DOCUMENTOS PENDENTES" };
  const original = { id: "rhid", fileName: "PONTO-RHID-17-2026-09.pdf", mimeType: "application/pdf", mediaUrl: "/rhid", existing: true, readOnly: true, signerName: "CLEITON CESAR NONATO" };
  const uploaded = { id: "signed", fileName: "PONTO-RHID-17-2026-09-assinado.pdf", mimeType: "application/pdf", mediaUrl: "/signed", size: 2400 };
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    return { status: "processed", messages: [], activeFlow, attachments: [original, { ...uploaded, size: file.size }] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original] });
  h.chatCalls.length = 0;
  await h.view.emit("signature-captured", {
    file: new File(["png"], "assinatura.png", { type: "image/png" }), fileId: "rhid",
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.equal(h.view.renders.at(-1).signaturePlacement.signerName, "CLEITON CESAR NONATO");
  assert.deepEqual(h.chatCalls, [["media", "rhid"]], "nenhum arquivo deve ser enviado antes da escolha do local");
  await h.view.emit("signature-placement-position", { point: { page: 1, x: 0.72, y: 0.84, scale: 0.5 } });
  assert.deepEqual(signedCalls[0].point, { page: 1, x: 0.72, y: 0.84, scale: 0.5 });
  assert.equal(signedCalls[0].signerName, "CLEITON CESAR NONATO");
  assert.deepEqual(h.chatCalls, [["media", "rhid"], ["file", "PONTO-RHID-17-2026-09-assinado.pdf"]]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ["rhid", "signed"]);
  assert.equal(h.store.getState().activeFlow.id, "pending_document_attachment");
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  assert.equal(h.view.renders.at(-1).error, null);
});

test("assinatura usa horário e protocolo do servidor e só envia PDF após preservar evidência", async t => {
  const signedCalls = [];
  const evidenceCalls = [];
  const h = makeHarness({ signPdfAttachment: async input => {
    signedCalls.push(input);
    return new Blob(["signed-pdf"], { type: "application/pdf" });
  } });
  t.after(() => h.controller.stop());
  const id = "fedcba9876543210fedcba9876543210";
  const activeFlow = { id: "pending_document_attachment", title: "DOCUMENTOS PENDENTES" };
  const original = { id: "rhid", fileName: "ponto.pdf", mimeType: "application/pdf", mediaUrl: "/rhid", existing: true };
  h.client.prepareSignatureEvidence = async input => {
    evidenceCalls.push(["prepare", input]);
    return { id, signedAt: "2026-10-03T23:00:00Z", sourceSha256: "a".repeat(64) };
  };
  h.client.confirmSignatureEvidence = async input => {
    evidenceCalls.push(["confirm", input]);
    assert.equal(h.chatCalls.filter(call => call[0] === "file").length, 0);
    return { id, status: "confirmed", finalSha256: "b".repeat(64) };
  };
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    return { status: "processed", messages: [], activeFlow, attachments: [original, { id: "signed", fileName: file.name, size: file.size, mimeType: file.type }] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original] });
  await h.view.emit("signature-captured", { file: new File(["png"], "assinatura.png", { type: "image/png" }), fileId: "rhid" });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).signaturePlacement.signedAt, "2026-10-03T23:00:00Z");
  assert.equal(h.view.renders.at(-1).signaturePlacement.signature.blob.signatureEvidence.id, id);
  await h.view.emit("signature-placement-position", { point: { page: 1, x: 0.6, y: 0.4, scale: 0.5 } });
  assert.equal(signedCalls[0].integrityId, id);
  assert.equal(signedCalls[0].signedAt, "2026-10-03T23:00:00Z");
  assert.equal(evidenceCalls[1][1].documentBlob.size, 10);
  assert.equal(evidenceCalls[1][1].recordId, id);
  assert.equal(h.chatCalls.filter(call => call[0] === "file").length, 1);
});

test('captura pública preserva traçado e imagem antes de assinar e enviar o PDF', async t => {
  const order = [], id = 'a'.repeat(32), verificationUrl = `https://example.com/assinaturas/${id}/${'b'.repeat(64)}`;
  const h = makeHarness({ signPdfAttachment: async input => { order.push('sign'); assert.equal(input.verificationUrl, verificationUrl); return new Blob(['signed'], { type: 'application/pdf' }); } });
  t.after(() => h.controller.stop());
  const evidence = { id, signedAt: '2026-10-10T20:00:00Z', sourceSha256: 'c'.repeat(64), verificationUrl };
  h.client.prepareSignatureEvidence = async input => { assert.equal(input.publicVerification, true); order.push('prepare'); return evidence; };
  const trace = { version: 1, mode: 'live', durationMs: 10, truncated: false, strokes: [{ input: 'pen', points: [{ x: 0.2, y: 0.4, t: 0, pressure: 0.5 }, { x: 0.5, y: 0.3, t: 10 }] }] };
  h.client.captureSignatureEvidence = async input => {
    order.push('capture'); assert.equal(input.recordId, id);
    const { inkSha256, inkImageBase64, ...received } = input.capture;
    assert.deepEqual(received, trace); assert.match(inkSha256, /^[a-f0-9]{64}$/);
    assert.equal(Buffer.from(inkImageBase64, 'base64').toString(), 'png');
    return evidence;
  };
  h.client.confirmSignatureEvidence = async () => { order.push('confirm'); return { id, status: 'confirmed' }; };
  const activeFlow = { id: 'pending_document_attachment' }, original = { id: 'rhid', fileName: 'ponto.pdf', mimeType: 'application/pdf', mediaUrl: '/rhid', existing: true };
  h.client.sendFile = async file => { order.push('send'); return { status: 'processed', messages: [], activeFlow, attachments: [original, { id: 'signed', fileName: file.name, mimeType: file.type, size: file.size }] }; };
  await h.controller.start(); h.store.ingestRemoteMessages([], { activeFlow, attachments: [original] });
  const file = new File(['png'], 'assinatura.png', { type: 'image/png' });
  Object.defineProperty(file, 'signatureTrace', { value: trace });
  await h.view.emit('signature-captured', { file, fileId: 'rhid' });
  for (let n = 0; n < 100 && h.view.renders.at(-1).signaturePlacement?.status !== 'ready'; n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, 'ready');
  assert.deepEqual(order, ['prepare', 'capture']);
  await h.view.emit('signature-placement-position', { point: { page: 1, x: 0.6, y: 0.4, scale: 0.5 } });
  assert.deepEqual(order, ['prepare', 'capture', 'sign', 'confirm', 'send']);
});

test("falha no registro de integridade conserva original e bloqueia envio da cópia", async t => {
  const h = makeHarness({ signPdfAttachment: async () => new Blob(["signed-pdf"], { type: "application/pdf" }) });
  t.after(() => h.controller.stop());
  const original = { id: "rhid", fileName: "ponto.pdf", mimeType: "application/pdf", mediaUrl: "/rhid", existing: true };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow: { id: "pending_document_attachment" }, attachments: [original] });
  await h.view.emit("signature-captured", { file: new File(["png"], "assinatura.png", { type: "image/png" }), fileId: "rhid" });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  h.client.confirmSignatureEvidence = async () => { throw new Error("Registro de integridade indisponível"); };
  assert.equal(await h.view.emit("signature-placement-position", { point: { page: 1, x: 0.5, y: 0.5, scale: 0.5 } }), false);
  assert.equal(h.chatCalls.filter(call => call[0] === "file").length, 0);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ["rhid"]);
  assert.match(h.view.renders.at(-1).error, /integridade/);
  assert.match(h.view.renders.at(-1).signaturePlacement.error, /integridade/);
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
});

test("posição sem PDF pronto falha fechada e não assina pelo comando legado", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow: { id: "document_signing", documentSigningPlacement: { stage: "document_signing_waiting_position" } }, attachments: [] });
  h.chatCalls.length = 0;
  assert.equal(await h.view.emit("signature-placement-position", { point: { page: 1, x: 0.5, y: 0.5, scale: 0.5 } }), false);
  assert.deepEqual(h.chatCalls, []);
  assert.match(h.view.renders.at(-1).error, /integridade|carregamento/);
});

test("editar assinatura de PDF concluído redesenha localmente sem reabrir workflow", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  let opened;
  h.view.openSignaturePad = id => { opened = id; return true; };
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    id: "old", type: "document", fileName: "contrato-assinado.pdf", mediaUrl: "/old",
    signatureEdit: { document: { id: "source", fileName: "contrato.pdf", mediaUrl: "/source" }, signature: { id: "ink", fileName: "assinatura.png", mediaUrl: "/ink" } },
  }], { activeFlow: null, attachments: [] });
  await h.view.emit("resize-signature", { messageId: "old" });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  h.chatCalls.length = 0;
  await h.view.emit("signature-placement-edit");
  assert.equal(opened, "signature-local-document");
  assert.deepEqual(h.chatCalls, []);
  const ink = new File(["new-png"], "nova-assinatura.png", { type: "image/png" });
  await h.view.emit("signature-captured", { file: ink, fileId: opened });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.equal(h.view.renders.at(-1).signaturePlacement.signature.blob, ink);
  assert.deepEqual(h.chatCalls, []);
});

test("substitui o PDF da bandeja incluindo o carimbo de Bernardo", async () => {
  const signedCalls = [];
  const h = makeHarness({
    signPdfAttachment: async input => {
      signedCalls.push(input);
      return new Blob(["signed-with-stamp"], { type: "application/pdf" });
    },
  });
  const activeFlow = { id: "task", title: "ADICIONAR UMA NOVA TAREFA" };
  const original = { id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/report" };
  const refreshedOriginal = { ...original, id: "report-v2", mediaUrl: "/report-v2" };
  const uploaded = { id: "signed", fileName: "relatorio-assinado.pdf", mimeType: "application/pdf", size: 2400, mediaUrl: "/signed" };
  h.client.fetchMedia = async item => {
    h.chatCalls.push(["media", item.id]);
    return new Blob([item.id], { type: item.id === "report" ? "application/pdf" : "image/png" });
  };
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    return { status: "processed", messages: [], activeFlow, attachments: [refreshedOriginal, uploaded] };
  };
  h.client.deleteAttachment = async id => {
    h.chatCalls.push(["delete-attachment", id]);
    return { status: "processed", messages: [], activeFlow, attachments: [uploaded] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original] });
  h.chatCalls.length = 0;

  await h.view.emit("signature-captured", {
    file: new File(["png"], "assinatura-desenhada.png", { type: "image/png" }),
    fileId: "report",
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const stamp = new Blob(["stamp"], { type: "image/png" });
  await h.view.emit("signature-placement-stamp", {
    stampBlob: stamp,
    stampPoint: { page: 1, x: 0.5, y: 0.7, scale: 0.8 },
  });
  await h.view.emit("signature-placement-position", {
    point: { page: 1, x: 0.5, y: 0.2, scale: 0.8 },
  });

  assert.equal(signedCalls.length, 1);
  assert.equal(signedCalls[0].stampBlob, stamp);
  assert.deepEqual(signedCalls[0].stampPoint, { page: 1, x: 0.5, y: 0.7, scale: 0.8 });
  assert.deepEqual(h.chatCalls, [["media", "report"], ["file", "relatorio-assinado.pdf"], ["delete-attachment", "report-v2"]]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["relatorio-assinado.pdf"]);
  h.controller.stop();
});

test("mantém o processamento original da VM ao assinar pela bandeja no fluxo dedicado", async () => {
  const h = makeHarness();
  const activeFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS" };
  const original = { id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/report" };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original] });
  h.chatCalls.length = 0;

  await h.view.emit("signature-captured", {
    file: new File(["png"], "assinatura-desenhada.png", { type: "image/png" }),
    fileId: "report",
  });

  assert.deepEqual(h.chatCalls, [["file", "assinatura-desenhada.png"]]);
  h.controller.stop();
});

test("preserva o PDF original quando a VM não confirma o documento assinado", async () => {
  const h = makeHarness({
    signPdfAttachment: async () => new Blob(["signed-pdf"], { type: "application/pdf" }),
  });
  const activeFlow = { id: "task", title: "ADICIONAR UMA NOVA TAREFA" };
  const original = { id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/report" };
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    throw new Error("upload indisponível");
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original] });
  h.chatCalls.length = 0;

  await h.view.emit("signature-captured", {
    file: new File(["png"], "assinatura-desenhada.png", { type: "image/png" }),
    fileId: "report",
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  await h.view.emit("signature-placement-position", { point: { page: 1, x: 0.5, y: 0.65, scale: 0.8 } });

  assert.deepEqual(h.chatCalls.map(call => call[0]), ["media", "file"]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["relatorio.pdf"]);
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.match(h.view.renders.at(-1).error, /não foi confirmado|indisponível/i);
  h.controller.stop();
});

test("avisa quando PDFs originais idênticos impedem identificar qual deve ser retirado", async () => {
  const h = makeHarness({
    signPdfAttachment: async () => new Blob(["signed-pdf"], { type: "application/pdf" }),
  });
  const activeFlow = { id: "task", title: "ADICIONAR UMA NOVA TAREFA" };
  const original = { id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/report" };
  const duplicate = { ...original, id: "report-copy", mediaUrl: "/report-copy" };
  const refreshedOriginal = { ...original, id: "report-v2", mediaUrl: "/report-v2" };
  const refreshedDuplicate = { ...duplicate, id: "report-copy-v2", mediaUrl: "/report-copy-v2" };
  const uploaded = { id: "signed", fileName: "relatorio-assinado.pdf", mimeType: "application/pdf", size: 2400, mediaUrl: "/signed" };
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    return { status: "processed", messages: [], activeFlow, attachments: [refreshedOriginal, refreshedDuplicate, uploaded] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original, duplicate] });
  h.chatCalls.length = 0;

  await h.view.emit("signature-captured", {
    file: new File(["png"], "assinatura-desenhada.png", { type: "image/png" }),
    fileId: "report",
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  await h.view.emit("signature-placement-position", { point: { page: 1, x: 0.5, y: 0.65, scale: 0.8 } });

  assert.deepEqual(h.chatCalls.map(call => call[0]), ["media", "file"]);
  assert.match(String(h.view.renders.at(-1).error || ""), /original.*não pôde ser identificado|originais idênticos/i);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ["report-v2", "report-copy-v2", "signed"]);
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("snapshot do fluxo de assinatura também oculta a assinatura na bandeja", async () => {
  const h = makeHarness();
  await h.controller.start();
  const activeFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: {
      stage: "document_signing_waiting_position",
      signature: {
        id: "assinatura",
        fileName: "assinatura-desenhada.png",
        mediaUrl: "/assinatura",
      },
    },
  };
  h.store.ingestRemoteMessages([], {
    activeFlow,
    attachments: [
      { id: "documento", fileName: "contrato.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/documento" },
      { id: "assinatura", fileName: "assinatura-desenhada.png", mimeType: "image/png", size: 3, mediaUrl: "/assinatura" },
    ],
  });

  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["contrato.pdf"]);
  h.controller.stop();
});

test("carrega o PDF e envia a página e o ponto escolhido no posicionamento da assinatura", async () => {
  let signedInput;
  const h = makeHarness({ signPdfAttachment: async input => {
    signedInput = input;
    return new Blob(["signed-pdf"], { type: "application/pdf" });
  } });
  const fetched = [];
  h.client.fetchMedia = async item => {
    fetched.push(item.id);
    return new Blob([item.id], { type: item.id === "documento" ? "application/pdf" : "image/png" });
  };
  await h.controller.start();
  const activeFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: {
      stage: "document_signing_waiting_position",
    },
  };
  h.store.ingestRemoteMessages([], {
    activeFlow,
    attachments: [
      { id: "documento", fileName: "contrato.pdf", mimeType: "application/pdf", mediaUrl: "/api/portal-media/documento" },
      { id: "assinatura", fileName: "assinatura.png", mimeType: "image/png", mediaUrl: "/api/portal-media/assinatura" },
    ],
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fetched.sort(), ["assinatura", "documento"]);
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");

  let request;
  h.client.sendFile = async file => {
    request = file;
    return { status: "processed", activeFlow: { id: "document_signing" }, messages: [{ type: "text", text: "Assinatura posicionada" }], attachments: [{ id: "signed", fileName: file.name, size: file.size, mimeType: file.type }] };
  };
  await h.view.emit("signature-placement-position", { point: { page: 2, x: 0.25, y: 0.75, scale: 1.4 } });
  assert.equal(request.name, "contrato-assinado.pdf");
  assert.deepEqual(signedInput.point, { page: 2, x: 0.25, y: 0.75, scale: 1.4 });
  assert.equal(signedInput.integrityId, "0123456789abcdef0123456789abcdef");
  h.controller.stop();
});

test("adiciona a assinatura de Bernardo ao PDF que já contém a assinatura de outra pessoa", async () => {
  const signedCalls = [];
  const h = makeHarness({
    signPdfAttachment: async input => {
      signedCalls.push(input);
      return new Blob(["pdf-com-duas-assinaturas"], { type: "application/pdf" });
    },
  });
  const activeFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: {
      stage: "document_signing_waiting_position",
      document: { id: "epi-pdf", fileName: "entrega-epi.pdf", mimeType: "application/pdf", mediaUrl: "/epi-pdf" },
      signature: { id: "assinatura-fornecedor", fileName: "assinatura-fornecedor.png", mimeType: "image/png", mediaUrl: "/assinatura-fornecedor" },
    },
  };
  h.client.fetchMedia = async item => new Blob([item.id], {
    type: item.id === "epi-pdf" ? "application/pdf" : "image/png",
  });
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    return {
      status: "processed",
      activeFlow: null,
      resetConversation: true,
      messages: [{ type: "text", text: "Documento com as duas assinaturas recebido." }],
      results: [{ status: "document_signed" }],
      uploadedName: file.name,
    };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [] });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  h.chatCalls.length = 0;

  const stamp = new Blob(["assinatura-bernardo"], { type: "image/png" });
  await h.view.emit("signature-placement-stamp", {
    stampBlob: stamp,
    stampPoint: { page: 1, x: 0.7, y: 0.3, scale: 0.8 },
  });
  await h.view.emit("signature-placement-position", {
    point: { page: 1, x: 0.35, y: 0.7, scale: 0.8 },
  });

  assert.equal(signedCalls.length, 1);
  assert.equal(signedCalls[0].signatureBlob.type, "image/png");
  assert.equal(signedCalls[0].stampBlob, stamp);
  assert.deepEqual(signedCalls[0].stampPoint, { page: 1, x: 0.7, y: 0.3, scale: 0.8 });
  assert.deepEqual(h.chatCalls, [["file", "entrega-epi-assinado.pdf"]]);
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("substitui localmente um PDF do fluxo dedicado quando o carimbo é adicionado", async () => {
  const signedCalls = [];
  const h = makeHarness({
    signPdfAttachment: async input => {
      signedCalls.push(input);
      return new Blob(["signed-with-stamp"], { type: "application/pdf" });
    },
  });
  const activeFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: { stage: "document_signing_waiting_position" },
  };
  const original = { id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/report" };
  const uploaded = { id: "signed", fileName: "relatorio-assinado.pdf", mimeType: "application/pdf", size: 2400, mediaUrl: "/signed" };
  h.client.fetchMedia = async item => new Blob([item.id], {
    type: item.id === "report" ? "application/pdf" : "image/png",
  });
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    return { status: "processed", messages: [], activeFlow: { id: activeFlow.id, title: activeFlow.title }, attachments: [original, uploaded] };
  };
  h.client.deleteAttachment = async id => {
    h.chatCalls.push(["delete-attachment", id]);
    return { status: "processed", messages: [], activeFlow: { id: activeFlow.id, title: activeFlow.title }, attachments: [uploaded] };
  };
  const queuedItems = [];
  const unsubscribe = h.store.subscribe(state => {
    queuedItems.push(...state.pendingFiles);
  });
  await h.controller.start();
  h.store.ingestRemoteMessages([], {
    activeFlow,
    attachments: [
      original,
      { id: "signature", fileName: "assinatura.png", mimeType: "image/png", size: 3, mediaUrl: "/signature" },
    ],
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  h.chatCalls.length = 0;

  const stamp = new Blob(["stamp"], { type: "image/png" });
  await h.view.emit("signature-placement-stamp", {
    stampBlob: stamp,
    stampPoint: { page: 1, x: 0.5, y: 0.7, scale: 0.8 },
  });
  await h.view.emit("signature-placement-position", {
    point: { page: 1, x: 0.5, y: 0.2, scale: 0.8 },
  });

  assert.equal(signedCalls.length, 1);
  assert.equal(signedCalls[0].stampBlob, stamp);
  assert.deepEqual(h.chatCalls, [["file", "relatorio-assinado.pdf"], ["delete-attachment", "report"]]);
  assert.equal(queuedItems.at(-1).hideFromAttachmentTray, true);
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["relatorio-assinado.pdf"]);
  unsubscribe();
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("anexo confirmado agenda lembrete de cinco minutos e o cancela ao postar", async () => {
  const h = makeHarness();
  const scheduled = [];
  let cancelled = 0;
  h.native.scheduleAttachmentReminder = async details => {
    scheduled.push(details);
    return true;
  };
  h.native.cancelAttachmentReminder = async () => { cancelled += 1; };
  h.client.sendFile = async file => ({
    status: "processed",
    messages: [{ type: "text", text: `Recebi ${file.name}` }],
    attachments: [{
      id: "attachment-1",
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      mediaUrl: "https://vm.test/attachment-1",
    }],
  });

  await h.controller.start();
  h.store.queueFiles([new File(["pdf"], "documento.pdf", { type: "application/pdf" })]);
  const fileId = h.store.getState().pendingFiles[0].id;
  assert.equal(await h.controller.uploadFile(fileId), true);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 5 * 60 * 1000);
  assert.equal(scheduled[0].body, "Anexo recebido há 5 minutos sem postagem");

  await h.controller.sendText("continuar");
  assert.ok(cancelled >= 1, "qualquer postagem deve cancelar o lembrete do anexo");
  h.controller.stop();
});

test("upload concluído não deixa o anexo postado na bandeja", async () => {
  const h = makeHarness();
  let cancelled = 0;
  h.native.cancelAttachmentReminder = async () => { cancelled += 1; };
  h.client.sendFile = async file => ({
    status: "processed",
    returned_to_main_menu: true,
    messages: [{ type: "text", text: `Documento ${file.name} postado.` }],
    attachments: [{
      id: "posted-upload",
      fileName: file.name,
      mimeType: file.type,
      mediaUrl: "/api/portal-media/posted-upload",
    }],
  });

  await h.controller.start();
  h.store.queueFiles([new File(["pdf"], "postado.pdf", { type: "application/pdf" })]);
  const fileId = h.store.getState().pendingFiles[0].id;
  assert.equal(await h.controller.uploadFile(fileId), true);
  assert.deepEqual(h.store.getState().attachments, []);
  assert.ok(cancelled >= 1);
  h.controller.stop();
});

test("upload que devolve o menu sem marcador de reset não mantém o anexo postado", async () => {
  const h = makeHarness();
  h.client.sendFile = async file => ({
    status: "processed",
    activeFlow: { id: "document", title: "ADICIONAR UM NOVO DOCUMENTO" },
    messages: [{ type: "poll", question: "📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?", options: [] }],
    attachments: [{
      id: "posted-with-menu",
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      mediaUrl: "/api/portal-media/posted-with-menu",
    }],
  });

  await h.controller.start();
  h.store.queueFiles([new File(["pdf"], "postado-menu.pdf", { type: "application/pdf" })]);
  const fileId = h.store.getState().pendingFiles[0].id;
  assert.equal(await h.controller.uploadFile(fileId), true);
  assert.equal(h.store.getState().activeFlow, null);
  assert.deepEqual(h.store.getState().attachments, []);
  h.controller.stop();
});

test("inicialização e retorno ao app não consultam a galeria delegada retirada", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  const calls = [];
  h.client.getDelegatedTasks = async () => {
    calls.push("retired-read");
    return { rows: [] };
  };
  await h.controller.start();
  await h.controller.handleForeground();
  assert.deepEqual(calls, []);
  assert.equal(h.view.renders.at(-1).delegatedTasks, undefined);
});

test("eventos antigos da galeria delegada não concluem tarefas nem gravam uma nova ordenação", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  const writes = [];
  h.client.getDelegatedTasks = async () => ({ rows: [{ id: '501', task: 'Enviar contrato' }] });
  h.client.completeDelegatedTask = async id => { writes.push(id); return {}; };
  await h.controller.start();
  await h.view.emit('complete-delegated-task', { taskId: '501' });
  await h.view.emit('delegated-tasks-reordered', { order: ['501'] });
  assert.deepEqual(writes, []);
  assert.equal(h.view.renders.at(-1).delegatedTasks, undefined);
});

test("ações da prévia permitem editar assinatura ou voltar para a escolha", async () => {
  const h = makeHarness();
  h.client.fetchMedia = async item => new Blob([item.id], {
    type: item.id === "documento" ? "application/pdf" : "image/png",
  });
  await h.controller.start();
  const activeFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: { stage: "document_signing_waiting_position" },
  };
  h.store.ingestRemoteMessages([], {
    activeFlow,
    attachments: [
      { id: "documento", fileName: "contrato.pdf", mimeType: "application/pdf", mediaUrl: "/documento" },
      { id: "assinatura", fileName: "assinatura.png", mimeType: "image/png", mediaUrl: "/assinatura" },
    ],
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  let request;
  h.client.sendText = async payload => {
    request = payload;
    return { status: "processed", activeFlow, messages: [{ type: "text", text: "Escolha" }] };
  };
  await h.view.emit("signature-placement-edit");
  assert.equal(request.replyId, "document_signing_edit_signature");
  await h.view.emit("signature-placement-close");
  assert.equal(request.replyId, "document_signing_position_back");
  h.controller.stop();
});

test("retornar ao menu na tela final da assinatura funciona sem fluxo ativo local", async () => {
  const h = makeHarness({ historyMode: "current-step" });
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload);
    return {
      status: "processed",
      activeFlow: null,
      resetConversation: true,
      returned_to_main_menu: true,
      messages: [{ type: "poll", question: "MENU PRINCIPAL", options: [] }],
    };
  };
  await h.controller.start();
  calls.length = 0;
  h.store.ingestRemoteMessages([{
    type: "document",
    fileName: "contrato-ASSINADO.pdf",
    caption: "✍️ DOCUMENTO ASSINADO — ASSINATURA APLICADA EM UM ÚNICO LOCAL",
    mediaUrl: "/signed",
  }], { activeFlow: null, resetConversation: true });
  await h.view.emit("select-reply", {
    label: "🏠 RETORNAR AO MENU INICIAL",
    replyId: "navigation_main_menu",
  });
  assert.equal(calls.at(-1).replyId, "portal_confirm_main_menu");
  h.controller.stop();
});

test("reabre o PDF gerado para alterar tamanho e posição sem voltar ao menu", async () => {
  const h = makeHarness();
  const fetched = [];
  h.client.fetchMedia = async item => {
    fetched.push(item.id || item.mediaUrl);
    return new Blob([String(item.id || item.mediaUrl)], {
      type: String(item.fileName || "").endsWith(".pdf") ? "application/pdf" : "image/png",
    });
  };
  h.client.sendText = async () => {
    throw new Error("não deve enviar uma resposta para o menu");
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    id: "signed-pdf-local",
    type: "document",
    fileName: "contrato-ASSINADO.pdf",
    mediaUrl: "/signed",
    caption: "DOCUMENTO ASSINADO",
    signatureEdit: {
      document: { id: "original-pdf", fileName: "contrato.pdf", mediaUrl: "/pdf" },
      signature: { id: "signature", fileName: "assinatura.png", mediaUrl: "/signature" },
    },
  }], { activeFlow: null, attachments: [] });
  await h.view.emit("resize-signature", { messageId: "signed-pdf-local" });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.deepEqual(fetched.sort(), ["original-pdf", "signature"]);
  await h.view.emit("signature-placement-close");
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("voltar e ajustar assinatura do comprovante abre as fontes enviadas na lista de anexos", async () => {
  let signedInput;
  const h = makeHarness({ signPdfAttachment: async input => {
    signedInput = input;
    return new Blob(["signed-pdf"], { type: "application/pdf" });
  } });
  const fetched = [];
  const replyIds = [];
  h.client.fetchMedia = async item => {
    fetched.push(item.id);
    return new Blob([String(item.id)], {
      type: String(item.fileName || "").endsWith(".pdf") ? "application/pdf" : "image/png",
    });
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "CONFIRA A PRÉVIA DO PDF E CONFIRME O CADASTRO.",
    options: [{
      id: "document_signing_payment_adjust",
      reply: "document_signing_payment_adjust",
      label: "VOLTAR E AJUSTAR ASSINATURA",
    }],
  }], {
    activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
  });
  h.client.sendText = async payload => {
    replyIds.push(payload.replyId);
    if (payload.replyId === "document_signing_payment_adjust") {
      return {
        status: "processed",
        messages: [{ type: "text", text: "ASSINATURA RECEBIDA. TOQUE NO PDF." }],
        activeFlow: {
          id: "document_signing",
          title: "ASSINAR DOCUMENTOS",
          documentSigningPlacement: {
            stage: "document_signing_waiting_position",
            preserveSource: true,
            document: { fileName: "COMPROVANTE-PAGAMENTO.pdf" },
            signature: { fileName: "assinatura-desenhada.png" },
          },
        },
        attachments: [
          {
            id: "payment-source",
            fileName: "COMPROVANTE-PAGAMENTO.pdf",
            mimeType: "application/pdf",
            size: 1200,
            mediaUrl: "/api/portal-media/payment-source",
          },
          {
            id: "payment-signature",
            fileName: "assinatura-desenhada.png",
            mimeType: "image/png",
            size: 300,
            mediaUrl: "/api/portal-media/payment-signature",
          },
        ],
      };
    }
    assert.match(payload.replyId, /^document_signing_position_point:/);
    return {
      status: "processed",
      messages: [{
        type: "document",
        fileName: "COMPROVANTE-PAGAMENTO-assinado.pdf",
        mimeType: "application/pdf",
        mediaUrl: "/api/portal-media/payment-preview",
      }],
      activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
      attachments: [{
        id: "payment-source",
        fileName: "COMPROVANTE-PAGAMENTO.pdf",
        mimeType: "application/pdf",
        size: 1200,
        mediaUrl: "/api/portal-media/payment-source",
      }],
    };
  };

  await h.view.emit("select-reply", {
    replyId: "document_signing_payment_adjust",
    label: "VOLTAR E AJUSTAR ASSINATURA",
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.equal(h.store.getState().activeFlow.documentSigningPlacement.preserveSource, true);
  assert.deepEqual(fetched.sort(), ["payment-signature", "payment-source"]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ["payment-source"]);
  assert.equal(h.view.renders.at(-1).error, null);

  h.client.sendFile = async file => ({
    status: "processed", messages: [{ type: "document", fileName: file.name, mimeType: file.type, mediaUrl: "/api/portal-media/payment-preview" }],
    activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
    attachments: [h.store.getState().attachments[0], { id: "signed", fileName: file.name, size: file.size, mimeType: file.type }],
  });
  await h.view.emit("signature-placement-position", {
    point: { page: 1, x: 0.5, y: 0.7, scale: 0.8 },
  });

  assert.deepEqual(replyIds, ["document_signing_payment_adjust"]);
  assert.deepEqual(signedInput.point, { page: 1, x: 0.5, y: 0.7, scale: 0.8 });
  assert.equal(h.chatCalls.some(call => call[0] === "delete-attachment"), false);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ["payment-source"]);
  assert.equal(h.view.renders.at(-1).error, null);
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("não abre PDF homônimo quando a fonte declarada do reposicionamento é ambígua", async () => {
  const h = makeHarness();
  const fetched = [];
  h.client.fetchMedia = async item => {
    fetched.push(item.id);
    return new Blob([String(item.id)], { type: item.mimeType });
  };
  await h.controller.start();

  h.store.ingestRemoteMessages([{ type: "text", text: "ASSINATURA RECEBIDA. TOQUE NO PDF." }], {
    activeFlow: {
      id: "document_signing",
      title: "ASSINAR DOCUMENTOS",
      documentSigningPlacement: {
        stage: "document_signing_waiting_position",
        document: { fileName: "COMPROVANTE-PAGAMENTO.pdf" },
        signature: { fileName: "assinatura-desenhada.png" },
      },
    },
    attachments: [
      {
        id: "payment-source-old",
        fileName: "COMPROVANTE-PAGAMENTO.pdf",
        mimeType: "application/pdf",
        mediaUrl: "/api/portal-media/payment-source-old",
      },
      {
        id: "payment-source-new",
        fileName: "COMPROVANTE-PAGAMENTO.pdf",
        mimeType: "application/pdf",
        mediaUrl: "/api/portal-media/payment-source-new",
      },
      {
        id: "payment-signature",
        fileName: "assinatura-desenhada.png",
        mimeType: "image/png",
        mediaUrl: "/api/portal-media/payment-signature",
      },
    ],
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(fetched, []);
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("ao confirmar novo posicionamento, fecha o editor e mostra o documento gerado", async () => {
  let signedInput;
  const h = makeHarness({ signPdfAttachment: async input => {
    signedInput = input;
    return new Blob(["signed-pdf"], { type: "application/pdf" });
  } });
  h.client.fetchMedia = async item => new Blob([String(item.mediaUrl || item.id)], {
    type: String(item.fileName || "").endsWith(".pdf") ? "application/pdf" : "image/png",
  });
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    id: "signed-pdf-local",
    type: "document",
    fileName: "contrato-ASSINADO.pdf",
    mediaUrl: "/signed-old",
    caption: "DOCUMENTO ASSINADO",
    signatureEdit: {
      document: { id: "original-pdf", fileName: "contrato.pdf", mediaUrl: "/pdf-old" },
      signature: { id: "signature", fileName: "assinatura.png", mediaUrl: "/signature-old" },
    },
  }], { activeFlow: null, attachments: [] });
  await h.view.emit("resize-signature", { messageId: "signed-pdf-local" });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");

  let request;
  h.client.sendText = async payload => {
    request = payload;
    return {
      status: "processed",
      activeFlow: null,
      messages: [{
        id: "signed-pdf-new",
        type: "document",
        fileName: "contrato-NOVO-ASSINADO.pdf",
        mediaUrl: "/signed-new",
        caption: "DOCUMENTO ASSINADO NOVAMENTE",
        signatureEdit: {
          document: { id: "original-pdf", fileName: "contrato.pdf", mediaUrl: "/pdf-old" },
          signature: { id: "signature", fileName: "assinatura.png", mediaUrl: "/signature-old" },
        },
      }],
    };
  };

  await h.view.emit("signature-placement-position", {
    point: { page: 2, x: 0.25, y: 0.75, scale: 1.4 },
  });

  assert.equal(request, undefined, "editar PDF concluído não envia respostas ao workflow encerrado");
  assert.deepEqual(signedInput.point, { page: 2, x: 0.25, y: 0.75, scale: 1.4 });
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  assert.equal(h.view.renders.at(-1).messages.at(-1).fileName, "contrato-assinado.pdf");
  assert.equal(h.view.renders.at(-1).messages.at(-1).mediaUrl, "/api/portal-media/confirmed");
  assert.equal(h.chatCalls.filter(call => call[0] === "file").length, 0);
  h.controller.stop();
});

test("ao editar a assinatura após redimensionar, usa a nova assinatura devolvida pela VM", async () => {
  const h = makeHarness();
  const fetched = [];
  h.client.fetchMedia = async item => {
    fetched.push(item.mediaUrl || item.id);
    return new Blob([String(item.id || item.mediaUrl)], {
      type: String(item.fileName || "").endsWith(".pdf") ? "application/pdf" : "image/png",
    });
  };
  await h.controller.start();
  const previousFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: {
      stage: "document_signing_waiting_position",
      document: { id: "documento", fileName: "contrato-antigo.pdf", mediaUrl: "/pdf-antigo" },
      signature: { id: "assinatura", fileName: "assinatura-antiga.png", mediaUrl: "/assinatura-antiga" },
    },
  };
  h.store.ingestRemoteMessages([{
    id: "signed-pdf-local",
    type: "document",
    fileName: "contrato-ASSINADO.pdf",
    mediaUrl: "/signed",
    caption: "DOCUMENTO ASSINADO",
    signatureEdit: {
      document: previousFlow.documentSigningPlacement.document,
      signature: previousFlow.documentSigningPlacement.signature,
    },
  }], {
    activeFlow: previousFlow,
    attachments: [
      { id: "documento", fileName: "contrato-antigo.pdf", mimeType: "application/pdf", mediaUrl: "/pdf-antigo" },
      { id: "assinatura", fileName: "assinatura-antiga.png", mimeType: "image/png", mediaUrl: "/assinatura-antiga" },
    ],
  });
  await h.view.emit("resize-signature", { messageId: "signed-pdf-local" });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).signaturePlacement.signature.fileName, "assinatura-antiga.png");

  const activeFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: {
      stage: "document_signing_waiting_position",
      document: { id: "documento", fileName: "contrato-novo.pdf", mediaUrl: "/pdf-novo" },
      signature: { id: "assinatura", fileName: "assinatura-nova.png", mediaUrl: "/assinatura-nova" },
    },
  };
  h.client.sendText = async payload => {
    assert.equal(payload.replyId, "document_signing_edit_signature");
    return {
      status: "processed",
      activeFlow,
      attachments: [
        { id: "documento", fileName: "contrato-novo.pdf", mimeType: "application/pdf", mediaUrl: "/pdf-novo" },
        { id: "assinatura", fileName: "assinatura-nova.png", mimeType: "image/png", mediaUrl: "/assinatura-nova" },
      ],
      messages: [{ type: "text", text: "Envie a nova assinatura." }],
    };
  };

  await h.view.emit("signature-placement-edit");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.equal(h.view.renders.at(-1).signaturePlacement.signature.fileName, "assinatura-nova.png");
  assert.ok(fetched.includes("/assinatura-nova"));
  assert.equal(fetched.includes("/assinatura-antiga"), true);
  h.controller.stop();
});

test("redimensionar sem fonte local preserva a conversa e não navega para o menu", async () => {
  const h = makeHarness();
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload);
    throw new Error("não deve enviar comando para um fluxo encerrado");
  };
  await h.controller.start();
  calls.length = 0;
  h.store.ingestRemoteMessages([{
    id: "signed-without-source",
    type: "document",
    fileName: "contrato-ASSINADO.pdf",
    caption: "DOCUMENTO ASSINADO",
    signatureEditAvailable: true,
  }], { activeFlow: null, attachments: [] });
  await h.view.emit("resize-signature", { messageId: "signed-without-source" });
  assert.deepEqual(calls, []);
  assert.match(String(h.view.renders.at(-1).error || ""), /fonte.*disponível/i);
  h.controller.stop();
});

test("não deixa o posicionamento preso em Carregando quando a mídia demora", async () => {
  const h = makeHarness({ mediaLoadTimeoutMs: 5 });
  h.client.fetchMedia = () => new Promise(() => {});
  await h.controller.start();
  h.store.ingestRemoteMessages([], {
    activeFlow: {
      id: "document_signing",
      title: "ASSINAR DOCUMENTOS",
      documentSigningPlacement: { stage: "document_signing_waiting_position" },
    },
    attachments: [
      { id: "documento", fileName: "contrato.pdf", mimeType: "application/pdf", mediaUrl: "/api/portal-media/documento" },
      { id: "assinatura", fileName: "assinatura.png", mimeType: "image/png", mediaUrl: "/api/portal-media/assinatura" },
    ],
  });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "error");
  assert.match(h.view.renders.at(-1).signaturePlacement.error, /tempo|demorou/i);
  h.controller.stop();
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

test("envia vários anexos em série e remove o que falhou da bandeja", async () => {
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
  assert.deepEqual(harness.store.getState().pendingFiles, []);
  assert.match(harness.view.renders.at(-1).error, /b\.pdf não foi enviado e foi removido da lista/);
});

test("não deixa anexo visualmente confirmado quando a VM não confirma o snapshot", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.queueFiles([{ name: "sem-confirmacao.jpg", size: 10, type: "image/jpeg" }]);
  const [item] = harness.store.getState().pendingFiles;
  harness.client.sendFile = async () => ({
    status: "processed",
    messages: [{ type: "text", text: "Anexo recebido" }],
    attachments: [],
  });
  harness.client.getAttachments = async () => [];

  const sent = await harness.controller.uploadFile(item.id);

  assert.equal(sent, false);
  assert.equal(harness.store.getState().attachments.length, 0);
  assert.deepEqual(harness.store.getState().pendingFiles, []);
  assert.equal(harness.store.getState().messages.some(message => message.text === "Anexo recebido"), false);

  harness.store.setDraft("responder sem o anexo");
  const beforeTextCalls = harness.chatCalls.filter(call => call[0] === "text").length;
  assert.equal(await harness.controller.sendText(), true);
  assert.equal(harness.chatCalls.filter(call => call[0] === "text").length, beforeTextCalls + 1);
  harness.controller.stop();
});

test("bloqueia a submissão se um anexo da bandeja desapareceu da VM", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.syncAttachments([{
    id: "stale-attachment",
    fileName: "diario.jpg",
    mimeType: "image/jpeg",
    size: 10,
    mediaUrl: "/api/portal-media/stale-attachment",
  }]);
  harness.client.getAttachments = async () => [];
  harness.store.setDraft("Concluir diário");

  const sent = await harness.controller.sendText();

  assert.equal(sent, false);
  assert.deepEqual(harness.chatCalls.filter(call => call[0] === "text"), [
    ["text", { text: "", replyId: "input_continue" }],
  ]);
  assert.deepEqual(harness.store.getState().attachments.map(item => item.id), ["stale-attachment"]);
  assert.match(harness.view.renders.at(-1).error, /não confirmou .*anexos|bloqueada|mantidos/i);
  harness.controller.stop();
});

test("cadastro incorporado não valida anexos do fluxo pai como se fossem do cadastro", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  const parentFlow = { id: "launch", title: "EFETUAR LANÇAMENTO" };
  const parentAttachment = {
    id: "parent-file",
    fileName: "comprovante.pdf",
    mimeType: "application/pdf",
    size: 42,
    mediaUrl: "/api/portal-media/parent-file",
  };
  harness.store.ingestRemoteMessages([], { activeFlow: parentFlow, attachments: [parentAttachment] });
  let snapshots = 0;
  harness.client.getAttachments = async () => {
    snapshots += 1;
    return snapshots === 1 ? [parentAttachment] : [];
  };
  let sends = 0;
  harness.client.sendText = async () => {
    sends += 1;
    if (sends === 1) {
      return {
        status: "processed",
        messages: [{ type: "text", text: "CADASTRAR FORNECEDOR" }],
        activeFlow: { id: "supply_supplier_registration", title: "CADASTRAR FORNECEDOR" },
        attachments: [],
      };
    }
    return {
      status: "processed",
      messages: [{ type: "text", text: "Fluxo principal retomado" }],
      activeFlow: parentFlow,
      attachments: [parentAttachment],
    };
  };

  assert.equal(await harness.controller.sendText("Cadastrar fornecedor", "register_supplier"), true);
  assert.deepEqual(harness.store.getState().attachments, []);
  assert.equal(await harness.controller.sendText("Fornecedor Exemplo"), true);
  assert.equal(snapshots, 1, "o anexo do fluxo pai não deve ser validado contra o cadastro secundário");
  assert.deepEqual(harness.store.getState().attachments.map(item => item.id), ["parent-file"]);
  assert.equal(harness.store.getState().error, null);
  harness.controller.stop();
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
  assert.match(markup, /Relatório.*disponível\./s);
  assert.match(markup, /O que deseja fazer agora\?/);
  assert.match(markup, /Menu inicial/);
  assert.deepEqual(harness.store.getState().messages.map(message => message.type), ["text", "document", "poll"]);

  await harness.view.emit("open-media", { messageId: "report" });
  assert.deepEqual(harness.exported, [[9, "relatório.pdf"]]);
  assert.deepEqual(harness.chatCalls.at(-1), ["media", "report"]);
});

test("envia DD/ como DD para preservar a regra de data parcial", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.ingestRemoteMessages([{
    type: "text",
    text: "Qual é a data da compra do imobilizado?",
  }]);
  harness.store.setDraft("15/");

  await harness.controller.sendText();

  assert.deepEqual(harness.chatCalls.at(-1), ["text", { text: "15" }]);
  harness.controller.stop();
});

test("envia DD/MM/ como DD/MM e mantém a data completa intacta", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.ingestRemoteMessages([{
    type: "text",
    text: "Informe a data de vencimento no formato DD/MM/AAAA.",
  }]);

  harness.store.setDraft("15/09/");
  await harness.controller.sendText();
  assert.deepEqual(harness.chatCalls.at(-1), ["text", { text: "15/09" }]);

  harness.store.ingestRemoteMessages([{
    type: "text",
    text: "Informe a data de vencimento no formato DD/MM/AAAA.",
  }]);
  harness.store.setDraft("15/09/2026");
  await harness.controller.sendText();
  assert.deepEqual(harness.chatCalls.at(-1), ["text", { text: "15/09/2026" }]);
  harness.controller.stop();
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
  harness.native.previewMedia = async (source, name) => previews.push([await previewSource(source), name]);
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

test("encaminha apenas o anexo selecionado com nome e conteúdo originais", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  const exported = [];
  h.client.fetchMedia = async item => new Blob([item.id], { type: "image/jpeg" });
  h.native.exportMedia = async (blob, name) => exported.push([name, await blob.text()]);
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.syncAttachments([
    { id: "old", fileName: "antiga.jpg", mediaUrl: "/api/old", existing: true, readOnly: true },
    { id: "new", fileName: "nova.jpg", mediaUrl: "/api/new" },
  ]);
  h.store.setDraft("Rascunho");

  assert.equal(await h.view.emit("share-attachment", { fileId: "old" }), true);
  assert.deepEqual(exported, [["antiga.jpg", "old"]]);
  assert.equal(h.store.getState().draft, "Rascunho");
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ["old", "new"]);
});

test("retorno do Atalho atualiza somente anexos e entrega mídia remota ao visualizador", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  const previews = [];
  harness.native.previewMedia = async (source, name) => previews.push([await previewSource(source), name]);
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

test('eliminar todos confirma a ação e preserva anexos existentes em fluxo ativo', async () => {
  const h = makeHarness();
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow: {
    id: 'task', title: 'EDITAR DIÁRIO', allowBulkAttachmentDelete: true,
  } });
  h.store.syncAttachments([
    { id: 'old', fileName: 'existente.jpg', mediaUrl: '/api/portal-media/old', existing: true, readOnly: true },
    { id: 'new', fileName: 'novo.jpg', mediaUrl: '/api/portal-media/new' },
  ]);
  h.client.deleteAllAttachments = async () => {
    h.chatCalls.push(['delete-all-attachments']);
    return { status: 'processed', messages: [], attachments: [
      { id: 'old', fileName: 'existente.jpg', mediaUrl: '/api/portal-media/old', existing: true, readOnly: true },
    ] };
  };
  const previousConfirm = globalThis.confirm;
  const prompts = [];
  globalThis.confirm = prompt => { prompts.push(prompt); return true; };
  try {
    await h.view.emit('delete-all-attachments');
  } finally {
    globalThis.confirm = previousConfirm;
    h.controller.stop();
  }
  assert.deepEqual(prompts, ['TEM CERTEZA QUE DESEJA DELETAR TODOS OS ANEXOS DESSE FLUXO?']);
  assert.deepEqual(h.chatCalls.at(-1), ['delete-all-attachments']);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ['old']);
});

test('compactação renova o id do anexo quando a bandeja ficou com snapshot antigo', async () => {
  const h = makeHarness();
  await h.controller.start();
  h.store.syncAttachments([{
    id: 'id-antigo', fileName: 'foto.jpg', mimeType: 'image/jpeg', size: 2048,
    mediaUrl: '/api/portal-media/antigo',
  }]);
  h.client.getAttachments = async () => [{
    id: 'id-atual', fileName: 'foto.jpg', mimeType: 'image/jpeg', size: 2500,
    mediaUrl: '/api/portal-media/atual',
  }];
  h.client.compressAttachment = async id => {
    h.chatCalls.push(['compress-attachment', id]);
    return { status: 'processed', messages: [], attachments: [{
      id: 'id-atual', fileName: 'foto.jpg', mimeType: 'image/jpeg', size: 900,
      mediaUrl: '/api/portal-media/comprimido',
    }] };
  };
  await h.view.emit('compress-attachment', { fileId: 'id-antigo' });
  assert.deepEqual(h.chatCalls.at(-1), ['compress-attachment', 'id-atual']);
  assert.equal(h.store.getState().attachments[0].size, 900);
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

test("data prevista vira primeira opção recomendada na data efetivamente paga em lançamentos comuns e múltiplos", async t => {
  const cases = [
    { name: "lançamento comum", title: "EFETUAR LANÇAMENTO", answer: "31/12/2099", replyId: null, expectedId: "", expectedLabel: "31/12/2099" },
    { name: "lançamento múltiplo", title: "LANÇAMENTO MÚLTIPLO", answer: "31/12/2099", replyId: null, expectedId: "", expectedLabel: "31/12/2099" },
    { name: "hoje sem botão duplicado", title: "EFETUAR LANÇAMENTO", answer: "📅 HOJE", replyId: "today", expectedId: "today" },
    { name: "ontem sem botão duplicado", title: "LANÇAMENTO MÚLTIPLO", answer: "🔴 📆 ONTEM", replyId: "yesterday", expectedId: "yesterday" },
    { name: "data prevista em branco", title: "EFETUAR LANÇAMENTO", answer: "⬜ EM BRANCO", replyId: "blank", expectedId: null },
  ];

  for (const scenario of cases) await t.test(scenario.name, async tCase => {
    const h = makeHarness({ historyMode: "current-step" });
    tCase.after(() => h.controller.stop());
    await h.controller.start();
    const activeFlow = { id: "launch", title: scenario.title, contextId: "launch-date-step" };
    h.store.ingestRemoteMessages([{
      type: "poll",
      question: "📅 QUAL É A DATA DE PAGAMENTO PREVISTO?",
      options: [
        { id: "blank", label: "⬜ EM BRANCO" },
        { id: "yesterday", label: "🔴 📆 ONTEM" },
        { id: "today", label: "📅 HOJE" },
        { id: "tomorrow", label: "🔵 AMANHÃ" },
        { id: "other", label: "👈 OUTRA DATA" },
      ],
    }], { activeFlow });
    h.client.sendText = async payload => {
      assert.equal(payload.text, scenario.answer);
      if (scenario.replyId) assert.equal(payload.replyId, scenario.replyId);
      else assert.equal(payload.replyId, undefined);
      return {
        status: "processed",
        activeFlow,
        messages: [{
          type: "poll",
          question: "📅 QUAL É A DATA DE PAGAMENTO EFETUADO?",
          options: [
            { id: "blank", label: "⬜ EM BRANCO" },
            { id: "yesterday", label: "🔴 📆 ONTEM" },
            { id: "today", label: "📅 HOJE" },
            { id: "tomorrow", label: "🔵 AMANHÃ" },
            { id: "other", label: "👈 OUTRA DATA" },
          ],
        }],
      };
    };

    if (scenario.replyId) await h.view.emit("select-reply", { replyId: scenario.replyId, label: scenario.answer });
    else {
      h.store.setDraft(scenario.answer);
      await h.view.emit("send-text");
    }

    const options = h.store.getState().messages.at(-1).options;
    if (scenario.expectedId === null) {
      assert.equal(options.some(option => option.recommendedDate === true), false);
      assert.equal(options.length, 5);
    } else {
      const recommendation = options.find(option => option.recommendedDate === true);
      assert.ok(recommendation);
      assert.equal(String(recommendation.id || recommendation.reply || ""), scenario.expectedId);
      if (scenario.expectedLabel) assert.equal(recommendation.label, scenario.expectedLabel);
      if (scenario.expectedId) assert.equal(options.length, 5);
      else {
        assert.equal(options.length, 6);
        assert.equal(options[0], recommendation);
      }
    }
  });
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
  harness.native.previewMedia = async source => { previewText = await (await previewSource(source)).text(); };
  await harness.view.emit("open-file", { fileId: "file" });
  assert.equal(previewText, "renovado");
  assert.equal(harness.chatCalls.length, 1);
});

test("ao digitar outra data no LOG o controlador solicita e exibe somente o novo relatório", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  await harness.controller.start();
  harness.store.ingestRemoteMessages([{
    type: "poll",
    question: "LOG DE AÇÕES — 08/09/2026",
    options: [{ id: "audit_log_row:old", label: "1 • TAREFAS • CRIADO • 10:00" }],
  }]);
  harness.client.sendText = async payload => {
    assert.equal(payload.text, "07/09/2026");
    return { status: "processed", messages: [{
      type: "poll",
      question: "LOG DE AÇÕES — 07/09/2026",
      options: [{ id: "audit_log_row:new", label: "2 • TAREFAS • EDITADO • 11:00" }],
    }] };
  };
  harness.store.setDraft("07/09/2026");
  await harness.controller.sendText();
  const state = harness.store.getState();
  assert.equal(state.messages.length, 1);
  assert.match(state.messages[0].question, /07\/09\/2026/);
  assert.equal(state.messages[0].options[0].id, "audit_log_row:new");
  harness.controller.stop();
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

function pendingDiaryHarness(t, rows = [{ id: "17", status: "PENDENTE", date: "2026-09-30", branch: "Obra A", responsible: "Bernardo" }]) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-30T18:00:00Z") });
  let reads = 0;
  const data = { async loadSnapshot() { reads++; return { rows }; } };
  const h = makeHarness({ pendingConstructionDiaryDataFactory: async () => data });
  t.after(() => h.controller.stop());
  return { ...h, data, reads: () => reads };
}

test("lembra diários pendentes a partir das 15h de Brasília sem provisões", async t => {
  const h = pendingDiaryHarness(t);
  await h.controller.start();
  assert.equal(h.reads(), 1);
  assert.deepEqual(h.view.renders.at(-1).pendingConstructionDiaries.rows.map(row => row.id), ["17"]);
});

test("não consulta diários antes das 15h e consulta ao voltar ao app depois desse horário", async t => {
  const h = pendingDiaryHarness(t);
  t.mock.timers.setTime(new Date("2026-09-30T17:59:59Z").getTime());
  await h.controller.start();
  assert.equal(h.reads(), 0);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
  t.mock.timers.setTime(new Date("2026-09-30T18:00:00Z").getTime());
  await h.controller.handleForeground();
  assert.equal(h.reads(), 1);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries.rows.length, 1);
});

test("não abre o lembrete de diários sem registros pendentes", async t => {
  const h = pendingDiaryHarness(t, []);
  await h.controller.start();
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
});

test("diários aguardam o X do popup de provisões", async t => {
  const h = pendingDiaryHarness(t);
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306", supplier: "Fornecedor A" }] });
  await h.controller.start();
  assert.ok(h.view.renders.at(-1).pendingProvisions);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
  assert.equal(h.reads(), 1);
  await h.view.emit("dismiss-pending-provisions");
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries.rows.length, 1);
});

test("diários aguardam a escolha do adiamento de provisões sem sobrepor a configuração", async t => {
  const h = pendingDiaryHarness(t);
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: "306" }] });
  await h.controller.start();
  await h.view.emit("close-pending-provisions");
  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, true);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
  await h.view.emit("cancel-pending-provisions-reminder");
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
  await h.view.emit("close-pending-provisions");
  await h.view.emit("pending-provisions-reminder-choice", { value: "2h" });
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries.rows.length, 1);
});

test("fechar diários mantém o chat e não repete o aviso na mesma sessão", async t => {
  const h = pendingDiaryHarness(t);
  await h.controller.start();
  assert.equal(await h.view.emit("dismiss-pending-construction-diaries"), true);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
  await h.controller.handleForeground();
  assert.equal(h.reads(), 1);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
});

test("resposta de diários da sessão anterior não reaparece após sair", async t => {
  const h = pendingDiaryHarness(t);
  await h.controller.start();
  let resolveRead;
  h.data.loadSnapshot = () => new Promise(resolve => { resolveRead = resolve; });
  const refresh = h.controller.handleForeground();
  for (let i = 0; i < 20 && !resolveRead; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof resolveRead, "function");
  await h.view.emit("sign-out");
  resolveRead({ rows: [{ id: "999", status: "PENDENTE" }] });
  await refresh;
  assert.equal(h.view.renders.at(-1).sessionStatus, "signed-out");
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
});

test("falha de consulta dos diários preserva o chat e pode ser tentada ao retornar", async t => {
  const h = pendingDiaryHarness(t);
  h.data.loadSnapshot = async () => { throw new Error("rede indisponível"); };
  await h.controller.start();
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
  assert.equal(h.view.renders.at(-1).error, null);
  h.data.loadSnapshot = async () => ({ rows: [{ id: "17", status: "PENDENTE" }] });
  await h.controller.handleForeground();
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries.rows.length, 1);
});

test("lembrete de diários ao retornar funciona sem consultar a galeria delegada retirada", async t => {
  const h = pendingDiaryHarness(t);
  t.mock.timers.setTime(new Date("2026-09-30T17:00:00Z").getTime());
  await h.controller.start();
  let retiredReads = 0;
  h.client.getDelegatedTasks = async () => { retiredReads += 1; return { rows: [] }; };
  t.mock.timers.setTime(new Date("2026-09-30T18:00:00Z").getTime());
  await h.controller.handleForeground();
  assert.equal(retiredReads, 0);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries?.rows.length, 1);
});

test("retorno ao app remove o aviso quando os diários deixam de estar pendentes", async t => {
  const h = pendingDiaryHarness(t);
  await h.controller.start();
  h.data.loadSnapshot = async () => ({ rows: [{ id: "17", status: "POSTADO" }] });
  await h.controller.handleForeground();
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
});

test("resposta antiga de diários não substitui a lista do novo login", async t => {
  const h = pendingDiaryHarness(t);
  await h.controller.start();
  let resolveOld;
  h.data.loadSnapshot = () => new Promise(resolve => { resolveOld = resolve; });
  const refresh = h.controller.handleForeground();
  for (let i = 0; i < 20 && !resolveOld; i++) await new Promise(resolve => setImmediate(resolve));
  await h.view.emit("sign-out");
  h.data.loadSnapshot = async () => ({ rows: [{ id: "27", status: "PENDENTE" }] });
  await h.view.emit("sign-in");
  resolveOld({ rows: [{ id: "999", status: "PENDENTE" }] });
  await refresh;
  assert.equal(h.view.renders.at(-1).account.homeAccountId, "a2");
  assert.deepEqual(h.view.renders.at(-1).pendingConstructionDiaries.rows.map(row => row.id), ["27"]);
});

test("retornos simultâneos consultam os diários uma única vez", async t => {
  const h = pendingDiaryHarness(t);
  await h.controller.start();
  let resolveRead, reads = 0;
  h.data.loadSnapshot = () => { reads++; return new Promise(resolve => { resolveRead = resolve; }); };
  const first = h.controller.handleForeground(), second = h.controller.handleForeground();
  for (let i = 0; i < 20 && !resolveRead; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  resolveRead({ rows: [{ id: "17", status: "PENDENTE" }] });
  await Promise.all([first, second]);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries.rows.length, 1);
});

test("consulta de diários obtém o consentimento SharePoint e tenta o token novamente", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-30T18:00:00Z") });
  let tokens = 0, consents = 0;
  const h = makeHarness({ pendingConstructionDiaryDataFactory: async ({ tokenProvider }) => ({
    async loadSnapshot() {
      assert.equal(await tokenProvider(["Sites.Read.All"]), "graph-token");
      return { rows: [{ id: "17", status: "PENDENTE" }] };
    },
  }) });
  h.auth.getToken = async scopes => {
    assert.deepEqual(scopes, ["Sites.Read.All"]);
    if (++tokens === 1) throw Object.assign(new Error("consentimento necessário"), { code: "AUTH_REQUIRED" });
    return "graph-token";
  };
  h.auth.authorize = async () => { consents++; };
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(consents, 1);
  assert.equal(tokens, 2);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries.rows.length, 1);
});

test("consentimento dos diários é compartilhado com provisões ao retomar o app", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-30T18:00:00Z") });
  let needConsent = false, consents = 0, resolveConsent;
  const h = makeHarness({
    pendingConstructionDiaryDataFactory: async ({ tokenProvider }) => ({ loadSnapshot: async () => {
      await tokenProvider(["Sites.Read.All"]); return { rows: [{ id: "17", status: "PENDENTE" }] };
    } }),
    pendingProvisionAttachmentsDataFactory: async ({ tokenProvider }) => ({
      listAttachments: async () => [], downloadAttachment: async () => new Blob(),
      loadUpcomingPayments: async () => { await tokenProvider(["Sites.Read.All"]); return []; },
    }),
  });
  h.auth.getToken = async () => {
    if (needConsent) throw Object.assign(new Error("consentimento necessário"), { code: "AUTH_REQUIRED" });
    return "graph-token";
  };
  const consent = new Promise(resolve => { resolveConsent = resolve; });
  h.auth.authorize = async () => { consents++; await consent; };
  t.after(() => { needConsent = false; resolveConsent(); h.controller.stop(); });
  await h.controller.start();
  needConsent = true;
  const first = h.controller.handleForeground();
  for (let i = 0; i < 20 && !consents; i++) await new Promise(resolve => setImmediate(resolve));
  h.client.getPendingProvisionSnapshot = async () => ({ due: false, rows: [] });
  const second = h.controller.handleForeground();
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(consents, 1);
  needConsent = false; resolveConsent();
  await Promise.all([first, second]);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries.rows.length, 1);
});

test("consulta de diários lenta é cancelada e pode ser refeita sem bloquear o chat", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date("2026-09-30T18:00:00Z") });
  let signal;
  const data = { loadSnapshot: options => { signal = options.signal; return new Promise(() => {}); } };
  const h = makeHarness({ pendingConstructionDiaryDataFactory: async () => data });
  t.after(() => h.controller.stop());
  const start = h.controller.start();
  for (let i = 0; i < 20 && !signal; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(signal);
  t.mock.timers.tick(8_000);
  await start;
  assert.equal(signal.aborted, true);
  assert.equal(h.view.renders.at(-1).sessionStatus, "authenticated");
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
  data.loadSnapshot = async () => ({ rows: [{ id: "17", status: "PENDENTE" }] });
  await h.controller.handleForeground();
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries.rows.length, 1);
});

function diaryPopupConversation(h, { selectedId = '17', failSelection = false, picker = false } = {}) {
  const menu = (reply, question = 'MENU PRINCIPAL', flow = null) => ({ status: 'processed', activeFlow: flow,
    messages: [{ type: 'poll', question, options: [{ id: reply, reply, label: reply }] }] });
  const selector = () => ({ status: 'processed', activeFlow: { id: 'construction_diary_fill', title: 'PREENCHER DIÁRIO DE OBRA', contextId: 'diary-picker', rows: [] },
    messages: [{ type: 'poll', question: '🏗️ QUAL DIÁRIO DE OBRA PENDENTE DESEJA PREENCHER?',
      options: [{ id: 'choice:diario_obra_pendente:17', reply: 'choice:diario_obra_pendente:17', label: '17 - Obra A' }] }] });
  let current = picker ? selector() : menu('group_construction_stage');
  h.client.sendText = async payload => {
    h.chatCalls.push(['text', payload]);
    if (payload.replyId === 'input_continue') return current;
    if (payload.replyId === 'group_construction_stage') current = menu('action_construction_diary_section', 'ETAPA OBRA', { id: 'menu:choosing_action' });
    else if (payload.replyId === 'action_construction_diary_section') current = menu('action_fill_construction_diary', 'QUAL OPERAÇÃO DE DIÁRIO DE OBRAS?', { id: 'menu:choosing_subaction' });
    else if (payload.replyId === 'action_fill_construction_diary') current = selector();
    else if (payload.replyId === 'choice:diario_obra_pendente:17' || payload.text === '29') {
      if (failSelection) throw new Error('Servidor indisponível');
      current = { status: 'processed', activeFlow: { id: 'construction_diary_fill', title: 'PREENCHER DIÁRIO DE OBRA', contextId: 'diary-selected',
        rows: [{ label: 'ID', value: selectedId }] },
        messages: [{ type: 'poll', question: 'QUAL É O TIPO DO DIÁRIO DE OBRA?', options: [] }] };
    } else throw new Error(`Resposta inesperada: ${JSON.stringify(payload)}`);
    return current;
  };
}

test('ícone do lembrete inicia o diário daquele ID pela seleção completa da VM', async t => {
  const h = pendingDiaryHarness(t);
  diaryPopupConversation(h);
  await h.controller.start();
  h.chatCalls.length = 0;
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '17' }), true);
  assert.deepEqual(h.chatCalls.map(([, p]) => p.replyId), ['input_continue', 'group_construction_stage',
    'action_construction_diary_section', 'action_fill_construction_diary', 'choice:diario_obra_pendente:17']);
  assert.equal(h.store.getState().activeFlow.rows.find(r => r.label === 'ID').value, '17');
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
});

test('seleciona por ID diário pendente fora da página visível sem escolher o primeiro item', async t => {
  const h = pendingDiaryHarness(t, [{ id: '29', status: 'PENDENTE' }]);
  diaryPopupConversation(h, { selectedId: '29' });
  await h.controller.start();
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '29' }), true);
  assert.deepEqual(h.chatCalls.at(-1), ['text', { text: '29' }]);
});

test('não fecha o lembrete quando a VM abre um ID diferente do diário tocado', async t => {
  const h = pendingDiaryHarness(t);
  diaryPopupConversation(h, { selectedId: '19' });
  await h.controller.start();
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '17' }), false);
  assert.ok(h.view.renders.at(-1).pendingConstructionDiaries);
  assert.match(h.view.renders.at(-1).pendingConstructionDiaryError, /17/);
});

test('falha na seleção mantém o popup e permite tentar novamente pelo estado atual', async t => {
  const h = pendingDiaryHarness(t);
  diaryPopupConversation(h, { failSelection: true });
  await h.controller.start();
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '17' }), false);
  assert.ok(h.view.renders.at(-1).pendingConstructionDiaries);
  diaryPopupConversation(h, { picker: true });
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '17' }), true);
});

test('não envia comandos para diário que não pertence ao lembrete', async t => {
  const h = pendingDiaryHarness(t);
  diaryPopupConversation(h);
  await h.controller.start();
  h.chatCalls.length = 0;
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '99' }), false);
  assert.deepEqual(h.chatCalls, []);

});

test('ícone não descarta outro formulário nem anexos para abrir um diário', async t => {
  const h = pendingDiaryHarness(t);
  h.client.sendText = async payload => {
    h.chatCalls.push(['text', payload]);
    return { status: 'processed', activeFlow: { id: 'launch', contextId: 'another-form', rows: [] },
      messages: [{ type: 'poll', question: 'QUAL É A DATA?', options: [] }] };
  };
  await h.controller.start();
  h.chatCalls.length = 0;
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '17' }), false);
  assert.deepEqual(h.chatCalls.map(([, p]) => p.replyId), ['input_continue']);
  assert.ok(h.view.renders.at(-1).pendingConstructionDiaries);
  assert.match(h.view.renders.at(-1).pendingConstructionDiaryError, /formulário/i);
});

test('duplo toque envia a seleção uma vez e impede fechar durante a abertura do diário', async t => {
  const h = pendingDiaryHarness(t);
  diaryPopupConversation(h);
  await h.controller.start();
  h.chatCalls.length = 0;
  const original = h.client.sendText;
  let release;
  h.client.sendText = async payload => {
    if (payload.replyId === 'input_continue') await new Promise(resolve => { release = resolve; });
    return original(payload);
  };
  const filling = h.view.emit('fill-pending-construction-diary', { diaryId: '17' });
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '17' }), false);
  assert.equal(await h.view.emit('dismiss-pending-construction-diaries'), false);
  release();
  assert.equal(await filling, true);
  assert.equal(h.chatCalls.filter(([, p]) => p.replyId === 'choice:diario_obra_pendente:17').length, 1);
});

test('resposta atrasada após logout não abre o diário nem restaura seu lembrete', async t => {
  const h = pendingDiaryHarness(t);
  diaryPopupConversation(h);
  await h.controller.start();
  const original = h.client.sendText;
  let release;
  h.client.sendText = async payload => {
    if (payload.replyId === 'input_continue') await new Promise(resolve => { release = resolve; });
    return original(payload);
  };
  h.chatCalls.length = 0;
  const filling = h.view.emit('fill-pending-construction-diary', { diaryId: '17' });
  await h.view.emit('sign-out');
  release();
  assert.equal(await filling, false);
  assert.deepEqual(h.chatCalls.map(([, p]) => p.replyId), ['input_continue']);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaryFillingId, '');
});


test('não inicia um diário enquanto o popup de provisões estiver aberto', async t => {
  const h = pendingDiaryHarness(t);
  diaryPopupConversation(h);
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: '306' }] });
  await h.controller.start();
  assert.ok(h.view.renders.at(-1).pendingProvisions);
  h.chatCalls.length = 0;
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '17' }), false);
  assert.deepEqual(h.chatCalls, []);
});

test('não perde texto ainda não enviado ao tocar no ícone do diário', async t => {
  const h = pendingDiaryHarness(t);
  diaryPopupConversation(h);
  await h.controller.start();
  h.store.setDraft('Anotação ainda não enviada');
  h.chatCalls.length = 0;
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '17' }), false);
  assert.equal(h.store.getState().draft, 'Anotação ainda não enviada');
  assert.deepEqual(h.chatCalls, []);
  assert.match(h.view.renders.at(-1).pendingConstructionDiaryError, /não enviado/);
});

test('retoma o mesmo diário confirmado pelo campo ID sem selecioná-lo novamente', async t => {
  const h = pendingDiaryHarness(t);
  diaryPopupConversation(h);
  await h.controller.start();
  h.client.sendText = async payload => {
    h.chatCalls.push(['text', payload]);
    return { status: 'processed', activeFlow: { id: 'construction_diary_fill', title: 'PREENCHER DIÁRIO DE OBRA',
      contextId: 'already-selected-diary-17', rows: [{ label: 'ID', value: '17' }] },
      messages: [{ type: 'poll', question: 'INDIQUE AS ATIVIDADES EXECUTADAS', options: [] }] };
  };
  h.chatCalls.length = 0;
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '17' }), true);
  assert.deepEqual(h.chatCalls.map(([, p]) => p.replyId), ['input_continue']);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
});

test('nova tentativa ressincroniza seleção recebida pela VM após NETWORK_UNCERTAIN', async t => {
  const h = pendingDiaryHarness(t);
  diaryPopupConversation(h);
  await h.controller.start();
  const original = h.client.sendText;
  let lost = true;
  h.client.sendText = async payload => {
    const result = await original(payload);
    if (lost && payload.replyId === 'choice:diario_obra_pendente:17') {
      lost = false;
      const error = new Error('Resposta interrompida'); error.code = 'NETWORK_UNCERTAIN'; throw error;
    }
    return result;
  };
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '17' }), false);
  assert.ok(h.view.renders.at(-1).pendingConstructionDiaries);
  const callsBefore = h.chatCalls.length;
  assert.equal(await h.view.emit('fill-pending-construction-diary', { diaryId: '17' }), true);
  assert.deepEqual(h.chatCalls.slice(callsBefore).map(([, p]) => p.replyId), ['input_continue']);
  assert.equal(h.view.renders.at(-1).pendingConstructionDiaries, null);
});

test('seta da provisão expande e recolhe a filial quando não existem anexos', async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ id: '306', branch: 'Obra A' }] });
  await h.controller.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).pendingProvisionAttachments['306'].status, 'empty');
  assert.equal(await h.view.emit('toggle-pending-provision-attachments', { paymentId: '306' }), true);
  assert.equal(h.view.renders.at(-1).pendingProvisionExpandedPaymentId, '306');
  assert.equal(await h.view.emit('toggle-pending-provision-attachments', { paymentId: '306' }), true);
  assert.equal(h.view.renders.at(-1).pendingProvisionExpandedPaymentId, '');
  assert.equal(await h.view.emit('toggle-pending-provision-attachments', { paymentId: '999' }), false);
});


test("folha de Novo Pedido abre página local sem enviar opção à VM e limpa a sessão", async t => {
 let opened=0,destroyed=0,assertSession;
 const h=makeHarness({supplierPayrollDataFactory:async options=>{assertSession=options.assertSession;assert.equal(await options.tokenProvider(['Sites.Read.All']), 'token');return {};},supplierPayrollFactory:async()=>({open:async()=>{opened++;},destroy:()=>{destroyed++;}})});
 t.after(()=>h.controller.stop());await h.controller.start();
 const poll={type:'poll',question:'COMO DESEJA EFETUAR O LANÇAMENTO?',options:[{id:'choice:tipo_lancamento:2',label:'LANÇAMENTO MÚLTIPLO'}]};
 const activeFlow={id:'launch',title:'EFETUAR LANÇAMENTO',rows:[{label:'TIPO DE PEDIDO',value:'NOVO PEDIDO'}]};h.store.ingestRemoteMessages([poll],{activeFlow});
 const before=h.chatCalls.length;assert.equal(await h.view.emit('select-reply',{replyId:'action_supplier_payroll_launch'}),true,JSON.stringify({error:h.view.renders.at(-1).error,flow:h.store.getState().activeFlow,messages:h.store.getState().messages.map(m=>({type:m.type,question:m.question,options:m.options}))}));assert.equal(opened,1);assert.equal(h.chatCalls.length,before);
 h.controller.stop();assert.equal(destroyed,1);assert.throws(assertSession,/sessão/i);
});
test("folha não abre fora de Novo Pedido",async t=>{
 let opened=0;const h=makeHarness({supplierPayrollFactory:async()=>{opened++;return{};}});t.after(()=>h.controller.stop());await h.controller.start();
 assert.equal(await h.view.emit('select-reply',{replyId:'action_supplier_payroll_launch'}),false);assert.equal(opened,0);
});

test('vale-alimentação abre tela local sem enviar resposta à VM e encerra na troca de sessão', async t => {
 let opened=0,destroyed=0,assertSession,sessionKey;
 const h=makeHarness({mealVoucherDataFactory:async options=>{assertSession=options.assertSession;return {prepare:async()=>{}};},mealVoucherFactory:async options=>{sessionKey=options.sessionKey;return {open:async()=>{opened++;},destroy:()=>{destroyed++;}};}});
 t.after(()=>h.controller.stop());await h.controller.start();
 const poll={type:'poll',question:'COMO DESEJA EFETUAR O LANÇAMENTO?',options:[{id:'choice:tipo_lancamento:2',label:'LANÇAMENTO MÚLTIPLO'}]};
 h.store.ingestRemoteMessages([poll],{activeFlow:{id:'launch',title:'EFETUAR LANÇAMENTO',rows:[{label:'TIPO DE PEDIDO',value:'NOVO PEDIDO'}]}});
 const before=h.chatCalls.length;
 assert.equal(await h.view.emit('select-reply',{replyId:'action_meal_voucher_launch'}),true,JSON.stringify({error:h.view.renders.at(-1).error,flow:h.store.getState().activeFlow,messages:h.store.getState().messages.map(m=>({type:m.type,question:m.question,options:m.options}))}));
 assert.equal(opened,1);assert.equal(h.chatCalls.length,before);assert.ok(sessionKey);
 h.controller.stop();assert.equal(destroyed,1);assert.throws(assertSession,/sessão/i);
});

function openPayrollMenu(h) {
  h.store.ingestRemoteMessages([{ type: "poll", question: "COMO DESEJA EFETUAR O LANÇAMENTO?", options: [{ id: "choice:tipo_lancamento:2", label: "LANÇAMENTO MÚLTIPLO" }] }], { activeFlow: { id: "launch", title: "EFETUAR LANÇAMENTO", rows: [{ label: "TIPO DE PEDIDO", value: "NOVO PEDIDO" }] } });
}

test("BUSCAR da folha usa seletores nativos sem enviar anexos ao chat e rejeita sessão encerrada", async t => {
  let options;
  const h = makeHarness({
    supplierPayrollDataFactory: async () => ({}),
    supplierPayrollFactory: async value => { options = value; return { open() {}, destroy() {} }; },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  openPayrollMenu(h);
  await h.view.emit("select-reply", { replyId: "action_supplier_payroll_launch" });
  const photo = new File(["photo"], "telefone.png", { type: "image/png" });
  const file = new File(["pdf"], "telefone.pdf", { type: "application/pdf" });
  const sources = [];
  h.native.pickPhotos = async () => { sources.push("photo"); return [photo]; };
  h.native.pickDocuments = async () => { sources.push("file"); return [file]; };
  const before = h.chatCalls.length;
  assert.deepEqual(await options.pickReceiptAttachments("photo"), [photo]);
  assert.deepEqual(await options.pickReceiptAttachments("file"), [file]);
  assert.deepEqual(sources, ["photo", "file"]);
  await assert.rejects(options.pickReceiptAttachments("unknown"), /tipo/i);
  assert.equal(h.chatCalls.length, before);
  assert.equal(h.store.getState().pendingFiles.length, 0);
  assert.equal(h.store.getState().attachments.length, 0);
  h.native.pickDocuments = async () => [];
  assert.deepEqual(await options.pickReceiptAttachments("file"), []);
  let resolve;
  h.native.pickDocuments = () => new Promise(r => { resolve = r; });
  const pending = options.pickReceiptAttachments("file");
  h.controller.stop();
  resolve([file]);
  await assert.rejects(pending, /sessão/i);
  assert.equal(h.chatCalls.length, before);
});

test("BUSCAR normaliza MIME genérico de PDF e foto nativos sem alterar bytes nem aceitar tipo incompatível", async t => {
  let options;
  const h = makeHarness({
    supplierPayrollDataFactory: async () => ({}),
    supplierPayrollFactory: async value => { options = value; return { open() {}, destroy() {} }; },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  openPayrollMenu(h);
  await h.view.emit("select-reply", { replyId: "action_supplier_payroll_launch" });
  const files = [
    new File(["pdf bytes"], "nativo.pdf", {type:"application/octet-stream",lastModified:123}),
    new File(["jpeg bytes"], "nativo.jpeg", {type:"binary/octet-stream",lastModified:456}),
    new File(["incompatible"], "incompativel.pdf", {type:"text/html"}),
  ];
  h.native.pickDocuments = async () => files;
  const selected = await options.pickReceiptAttachments("file");
  assert.deepEqual(selected.map(f => validateAttachment(f).valid), [true, true, false]);
  assert.deepEqual(selected.map(f => f.name), files.map(f => f.name));
  assert.deepEqual(selected.map(f => f.lastModified), files.map(f => f.lastModified));
  assert.deepEqual(await Promise.all(selected.map(f => f.text())), ["pdf bytes","jpeg bytes","incompatible"]);
  assert.equal(selected[2], files[2], "MIME explícito incompatível não deve ser disfarçado");
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test("folha lê comprovantes apenas da bandeja vigente sem consumir anexos", async t => {
  let options;
  const h = makeHarness({
    supplierPayrollDataFactory: async () => ({}),
    supplierPayrollFactory: async value => { options = value; return { open() {}, destroy() {} }; },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  openPayrollMenu(h);
  h.store.syncAttachments([{ id: "remote", fileName: "recibo.jpeg", mimeType: "image/jpeg", mediaUrl: "/api/portal-media/remote" }]);
  await h.view.emit("select-reply", { replyId: "action_supplier_payroll_launch" });
  assert.equal(typeof options.getReceiptAttachments, "function");
  assert.equal(typeof options.readReceiptAttachment, "function");
  assert.deepEqual(options.getReceiptAttachments().map(a => a.id), ["attachment:remote"]);
  h.client.fetchMedia = async () => new Blob(["jpeg"], { type: "image/jpeg" });
  const file = await options.readReceiptAttachment("attachment:remote");
  assert.equal(file.name, "recibo.jpeg");
  assert.equal(file.type, "image/jpeg");
  assert.equal(await file.text(), "jpeg");
  assert.equal(h.store.getState().attachments.length, 1);
  const local = new File(["local"], "local.pdf", { type: "application/pdf" });
  h.store.queueFiles([local]);
  h.store.queueFiles([new File(["secret"], "hidden.pdf")], { hideFromAttachmentTray: true });
  const available = options.getReceiptAttachments();
  assert.deepEqual(available.map(a => a.fileName), ["recibo.jpeg", "local.pdf"]);
  const localFile = await options.readReceiptAttachment(available[1].id);
  assert.equal(await localFile.text(), "local");
  assert.equal(h.store.getState().pendingFiles.length, 2);
  h.client.fetchMedia = async () => new Blob(["jpeg"], { type: "application/octet-stream" });
  const generic = await options.readReceiptAttachment("attachment:remote");
  assert.equal(generic.type, "image/jpeg");
  assert.equal(validateAttachment(generic).valid, true);
  h.store.syncAttachments([{ id: "remote", fileName: "recibo.jpeg", mediaUrl: "/api/portal-media/remote" }]);
  assert.equal(validateAttachment(await options.readReceiptAttachment("attachment:remote")).valid, true);
  h.client.fetchMedia = async () => new Blob(["html"], { type: "text/html" });
  assert.equal(validateAttachment(await options.readReceiptAttachment("attachment:remote")).valid, false);
  await assert.rejects(options.readReceiptAttachment("external"), /bandeja/i);
  let resolve;
  h.client.fetchMedia = () => new Promise(r => { resolve = r; });
  const pending = options.readReceiptAttachment("attachment:remote");
  h.store.syncAttachments([]);
  resolve(new Blob(["old"]));
  await assert.rejects(pending, /bandeja/i);
  h.store.syncAttachments([{ id: "other", fileName: "outro.pdf", mediaUrl: "/api/portal-media/other" }]);
  const afterLogout = options.readReceiptAttachment("attachment:other");
  h.controller.stop();
  resolve(new Blob(["late"]));
  await assert.rejects(afterLogout, /sessão/i);
  assert.throws(options.getReceiptAttachments, /sessão/i);
});

test("casinha da folha pede o menu principal pela navegação direta do aplicativo", async t => {
  let home;
  const h = makeHarness({
    supplierPayrollDataFactory: async () => ({}),
    supplierPayrollFactory: async options => {
      home = options.onHome;
      return { open() {}, destroy() {} };
    },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  openPayrollMenu(h);
  await h.view.emit('select-reply', { replyId: 'action_supplier_payroll_launch' });
  assert.equal(typeof home, 'function', 'folha recebe o caminho real para o menu');
  const replies = [];
  h.client.sendText = async payload => {
    replies.push(payload.replyId);
    return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
      activeFlow: null, messages: [{ type: 'poll', question: 'MENU PRINCIPAL', options: [{ id: 'group_supplies', label: 'SUPRIMENTOS' }] }] };
  };
  assert.equal(await home(), true);
  assert.deepEqual(replies, ['portal_confirm_main_menu']);
  assert.equal(h.store.getState().activeFlow, null);
  assert.match(h.store.getState().messages.at(-1).question, /MENU PRINCIPAL/);
});

test("folha autoriza antes de abrir e não redireciona após iniciar preenchimento", async t => {
  let provider, prepared = false, grants = 0, expired = false;
  const h = makeHarness({
    supplierPayrollDataFactory: async options => {
      provider = options.tokenProvider;
      return { prepare: async () => { await provider(["Sites.ReadWrite.All"]); prepared = true; } };
    },
    supplierPayrollFactory: async () => {
      assert.equal(prepared, true, "o formulário só pode abrir depois da autorização");
      return { open: async () => {}, destroy() {} };
    },
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.auth.getToken = async () => {
    if (!grants || expired) throw Object.assign(new Error("autorize"), { code: "AUTH_REQUIRED" });
    return "token";
  };
  h.auth.authorize = async (_scopes, options) => { assert.equal(options.resumeAction, "action_supplier_payroll_launch"); grants++; };
  openPayrollMenu(h);
  assert.equal(await h.view.emit("select-reply", { replyId: "action_supplier_payroll_launch" }), true);
  assert.equal(grants, 1);
  expired = true;
  await assert.rejects(provider(["Sites.ReadWrite.All"]), error => error.code === "AUTH_REQUIRED");
  assert.equal(grants, 1, "falha tardia deve preservar a página sem iniciar redirecionamento");
});

test("token da folha obtido depois de sair não permite enviar gravação", async t => {
  let provider, resolveToken;
  const h = makeHarness({
    supplierPayrollDataFactory: async options => { provider = options.tokenProvider; return {}; },
    supplierPayrollFactory: async () => ({ open: async () => {}, destroy() {} }),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  openPayrollMenu(h);
  await h.view.emit("select-reply", { replyId: "action_supplier_payroll_launch" });
  h.auth.getToken = () => new Promise(resolve => { resolveToken = resolve; });
  const writes = [];
  const pending = provider(["Sites.ReadWrite.All"]).then(token => writes.push(token));
  const rejected = assert.rejects(pending, /sessão.*encerrada/i);
  await h.view.emit("sign-out");
  resolveToken("old-token");
  await rejected;
  assert.deepEqual(writes, []);
});

test("galerias de cadastro abrem localmente com anexos e preservam o menu", async t => {
  const entries = [
    ["action_asset_gallery", "asset"],
    ["action_asset_function_gallery", "assetFunction"],
    ["action_asset_product_gallery", "assetProduct"],
    ["action_asset_group_gallery", "assetGroup"],
    ["action_work_diary_gallery", "workDiary"],
    ["action_quote_gallery", "quotes"],
    ["action_contract_gallery", "contracts"],
    ["action_contract_line_gallery", "contractLines"],
    ["action_measurement_gallery", "measurements"],
    ["action_measurement_line_gallery", "measurementLines"],
    ["action_stage_demonstrative_gallery", "stageDemonstratives"],
    ["action_construction_stage_gallery", "constructionStages"],
    ["action_recurring_tasks_gallery", "recurringTasks"],
    ["action_delegated_tasks_gallery", "delegatedTasks"],
  ];
  const opened = [], destroyed = [], previews = [];
  const h = makeHarness({
    registrationGalleryDataFactory: async ({ kind }) => ({ kind }),
    registrationGalleryFactory: async ({ kind, data, openMediaCollection }) => {
      assert.equal(data.kind, kind);
      assert.equal(typeof openMediaCollection, "function");
      await openMediaCollection([{ fileName: `${kind}.pdf`, source: "conteúdo" }]);
      return { open() { opened.push(kind); }, destroy() { destroyed.push(kind); } };
    },
  });
  h.native.previewMediaCollection = items => { previews.push(items); };
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;
  for (const [replyId] of entries) assert.equal(await h.view.emit("select-reply", { replyId }), true);
  assert.deepEqual(opened, entries.map(([, kind]) => kind));
  assert.equal(previews.length, entries.length);
  assert.equal(h.chatCalls.length, before);
  h.controller.stop();
  assert.deepEqual(destroyed.sort(), entries.map(([, kind]) => kind).sort());
});

test("cabeçalho Energético abre RHID de hoje em São Paulo com carregamento e sem PDF automático", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-03T01:30:00Z") });
  const h = makeHarness();
  const opened = [], requested = [], previews = [];
  h.view.openRhidAttendanceToday = options => { opened.push(options); return true; };
  h.client.getRhidAttendanceReport = async date => {
    assert.deepEqual(opened, [{ date: "2026-10-02" }]);
    requested.push(date);
    return { date, rows: [] };
  };
  h.native.previewMedia = (...args) => previews.push(args);
  t.after(() => h.controller.stop());
  await h.controller.start();
  assert.equal(await h.view.emit("open-rhid-attendance-today"), true);
  assert.deepEqual(requested, ["2026-10-02"]);
  assert.equal(h.store.getState().messages.at(-1).detail_table.reportDate, "2026-10-02");
  assert.equal(previews.length, 0);
});

test("retorno da autenticação Microsoft reabre as doze novas galerias", async t => {
  for (const [action, expectedKind] of [
    ["action_asset_gallery", "asset"], ["action_asset_function_gallery", "assetFunction"],
    ["action_asset_product_gallery", "assetProduct"], ["action_asset_group_gallery", "assetGroup"],
    ["action_work_diary_gallery", "workDiary"], ["action_quote_gallery", "quotes"],
    ["action_contract_gallery", "contracts"], ["action_contract_line_gallery", "contractLines"],
    ["action_measurement_gallery", "measurements"], ["action_measurement_line_gallery", "measurementLines"],
    ["action_stage_demonstrative_gallery", "stageDemonstratives"], ["action_construction_stage_gallery", "constructionStages"],
  ]) {
    const opened = [];
    const h = makeHarness({
      registrationGalleryDataFactory: async () => ({}),
      registrationGalleryFactory: async ({ kind }) => ({ open() { opened.push(kind); }, destroy() {} }),
    });
    h.auth.consumePendingAction = () => action;
    t.after(() => h.controller.stop());
    await h.controller.start();
    assert.deepEqual(opened, [expectedKind]);
    h.controller.stop();
  }
});

test("atalho RHID mantém o erro na página sem substituir conversa quando consulta falha", async t => {
  const h = makeHarness();
  const states = [];
  h.view.openRhidAttendanceToday = () => true;
  h.view.setRhidAttendanceReportStatus = state => states.push(state);
  h.client.getRhidAttendanceReport = async () => { throw new Error("consulta indisponível"); };
  t.after(() => h.controller.stop());
  await h.controller.start();
  const messages = h.store.getState().messages;
  assert.equal(await h.view.emit("open-rhid-attendance-today"), false);
  assert.equal(h.store.getState().messages, messages);
  assert.equal(states[0].busy, true);
  assert.match(states.at(-1).error, /consulta indisponível/);
});

test("sair durante consulta RHID limpa carregamento e permite nova consulta sem resposta antiga", async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const h = makeHarness({ view });
  const pending = [];
  h.client.getRhidAttendanceReport = date => new Promise(resolve => pending.push({ date, resolve }));
  t.after(() => { h.controller.stop(); view.destroy(); dom.window.close(); });
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
  await h.controller.start();
  root.querySelector('.chat-header [data-action="open-rhid-attendance-today"]').click();
  await settle();
  assert.equal(pending.length, 1);
  root.querySelector('[data-action="sign-out"]').click();
  root.querySelector('[data-action="confirm-sign-out"]').click();
  await settle();
  root.querySelector('[data-action="sign-in"]').click();
  await settle();
  assert.equal(root.querySelector('.chat-rhid-report-loading'), null);
  const shortcut = root.querySelector('.chat-header [data-action="open-rhid-attendance-today"]');
  assert.equal(shortcut.disabled, false);
  shortcut.click();
  await settle();
  assert.equal(pending.length, 2);
  pending[0].resolve({ date: pending[0].date, rows: [{ NOME_COLABORADOR: "ANTIGO" }] });
  await settle();
  assert.ok(root.querySelector('.chat-rhid-report-loading'));
  assert.doesNotMatch(root.textContent, /ANTIGO/);
  pending[1].resolve({ date: pending[1].date, rows: [{ NOME_COLABORADOR: "ATUAL" }] });
  await settle();
  assert.ok(root.querySelector('.chat-rhid-attendance-report'));
  assert.match(root.textContent, /ATUAL/);
});

test("galeria em criação não abre nem apaga nova requisição após reentrar na mesma conta", async t => {
  const account = { homeAccountId: "same", name: "Bernardo" };
  const factories = [], opened = [], destroyed = [];
  const h = makeHarness({ account,
    registrationGalleryDataFactory: async () => ({}),
    registrationGalleryFactory: () => new Promise(resolve => factories.push(resolve)),
  });
  h.auth.signIn = async () => account;
  t.after(() => h.controller.stop());
  await h.controller.start();
  const first = h.view.emit("select-reply", { replyId: "action_asset_gallery" });
  await new Promise(resolve => setImmediate(resolve));
  await h.view.emit("sign-out");
  await h.view.emit("sign-in");
  const second = h.view.emit("select-reply", { replyId: "action_asset_gallery" });
  await new Promise(resolve => setImmediate(resolve));
  factories[0]({ open() { opened.push("old"); }, destroy() { destroyed.push("old"); } });
  assert.equal(await first, false);
  const duplicate = h.view.emit("select-reply", { replyId: "action_asset_gallery" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(factories.length, 2, "a finalização antiga deve preservar a requisição nova");
  factories[1]({ open() { opened.push("new"); }, destroy() { destroyed.push("new"); } });
  assert.equal(await second, true);
  assert.equal(await duplicate, true);
  assert.deepEqual(opened, ["new"]);
  assert.deepEqual(destroyed, ["old"]);
});

test("token de galeria recebido após sair não permite gravação com a sessão antiga", async t => {
  let provider, resolveToken;
  const h = makeHarness({
    registrationGalleryDataFactory: async options => { provider = options.tokenProvider; return {}; },
    registrationGalleryFactory: async () => ({ open() {}, destroy() {} }),
  });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("select-reply", { replyId: "action_contract_gallery" });
  h.auth.getToken = () => new Promise(resolve => { resolveToken = resolve; });
  const writes = [];
  const pending = provider(["Sites.ReadWrite.All"]).then(token => writes.push(token));
  const rejected = assert.rejects(pending, /sessão.*encerrada/i);
  await h.view.emit("sign-out");
  resolveToken("old-gallery-token");
  await rejected;
  assert.deepEqual(writes, []);
});

test('cargos abre uma vez, consulta na sessão e destrói ao sair',async t=>{
 let opens=0,destroys=0,token;const h=makeHarness({cargosDataFactory:async({tokenProvider})=>({loadSnapshot:async()=>{token=await tokenProvider(['Sites.Read.All']);return {rows:[]};}}),cargosFactory:async({data})=>({open:async()=>{opens++;await data.loadSnapshot();},destroy(){destroys++;}})});
 t.after(()=>h.controller.stop());await h.controller.start();await Promise.all([h.view.emit('open-cargos-table'),h.view.emit('open-cargos-table')]);assert.equal(opens,1);assert.ok(token);h.controller.stop();assert.equal(destroys,1);
});
test('cargos não ressuscita depois de encerrar a sessão',async()=>{
 let finish,opens=0,destroys=0;const h=makeHarness({cargosDataFactory:async()=>({}),cargosFactory:()=>new Promise(r=>{finish=r;})});await h.controller.start();const pending=h.view.emit('open-cargos-table');await new Promise(r=>setImmediate(r));h.controller.stop();finish({open(){opens++;},destroy(){destroys++;}});await pending;assert.equal(opens,0);assert.equal(destroys,1);
});
