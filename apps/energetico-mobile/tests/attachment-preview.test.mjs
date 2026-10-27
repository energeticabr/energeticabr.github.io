import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createAttachmentPreview } from "../src/web/attachment-preview.js";
import { createPdfPreview } from "../src/web/pdf-preview.js";
import { installAppZoomGuard } from "../src/web/app-zoom-guard.js";
import { createAttachmentPreviewController } from '../../../portal/ui/attachments-panel.js';

function setup(t, options = {}) {
  const dom = new JSDOM('<main><textarea>rascunho preservado</textarea><section id="messages">Conversa</section></main>');
  const documentRef = dom.window.document;
  const stopPageZoom = installAppZoomGuard(documentRef);
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event("close"));
  };
  const revoked = [];
  let urlCount = 0;
  const preview = createAttachmentPreview({
    documentRef,
    urlApi: { createObjectURL: () => `blob:preview-${++urlCount}`, revokeObjectURL: url => revoked.push(url) },
    ...options,
  });
  t.after(() => { preview.destroy(); stopPageZoom(); dom.window.close(); });
  return { preview, documentRef, dom, revoked };
}

function setupAppendPreview(t, options = {}) {
  return setup(t, {
    loadPdfPreview: async () => ({ createPdfPreview: () => ({ ready: Promise.resolve(), destroy() {} }) }),
    ...options,
  });
}

function chooseAppend(documentRef, mode) {
  const button = documentRef.querySelector('[data-preview-action="append-pages"]');
  assert.ok(button, "a prévia autorizada deve oferecer o botão +");
  assert.equal(button.hidden, false);
  button.click();
  const menu = documentRef.querySelector('.attachment-preview-append-menu');
  assert.equal(menu.hidden, false);
  menu.querySelector(`[data-preview-action="append-${mode}"]`).click();
}

const afterPreviewAction = () => new Promise(resolve => setImmediate(resolve));

test('append menu offers files before camera and waits for a choice before invoking the scoped handler', async t => {
  let calls = 0;
  const { preview, documentRef } = setupAppendPreview(t);
  await preview.open(new Blob(['image'], { type: 'image/jpeg' }), 'foto.jpg', { onAppendPages: () => { calls++; return null; } });
  const header = documentRef.querySelector('.attachment-preview-header');
  const button = header.querySelector('[data-preview-action="append-pages"]');
  assert.ok(button, 'o botão + pertence ao cabeçalho');
  assert.equal(button.hidden, false);
  assert.equal(button.textContent.trim(), '+');
  assert.match(button.getAttribute('aria-label'), /páginas|anexos/i);
  assert.equal(button.getAttribute('aria-haspopup'), 'menu');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  button.click();
  const menu = documentRef.getElementById(button.getAttribute('aria-controls'));
  assert.equal(menu.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...menu.querySelectorAll('[role="menuitem"]')].map(item => item.textContent), ['📎 ADICIONAR ANEXOS', '📷 FOTO/ ESCANEAR']);
  assert.equal(calls, 0);
  documentRef.querySelector('.attachment-preview-content').click();
  assert.equal(menu.hidden, true, 'tocar fora do menu preserva a prévia');
  assert.equal(documentRef.querySelector('dialog').open, true);
});

for (const mode of ['files', 'camera']) test(`append ${mode} passes the current file and replaces it only with the confirmed PDF`, async t => {
  const original = new Blob(['original'], { type: mode === 'files' ? 'application/pdf' : 'image/jpeg' });
  const name = mode === 'files' ? 'original.pdf' : 'original.jpg';
  const replacement = new Blob(['%PDF-merged'], { type: 'application/pdf' });
  const calls = [], exported = [];
  const { preview, documentRef } = setupAppendPreview(t, { exportMedia: (blob, fileName) => { exported.push({ blob, fileName }); } });
  await preview.open(original, name, { onAppendPages: async (selectedMode, context) => {
    calls.push({ mode: selectedMode, ...context });
    return { blob: replacement, fileName: 'acrescido.pdf' };
  } });
  chooseAppend(documentRef, mode);
  await afterPreviewAction();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, mode);
  assert.equal(calls[0].blob, original);
  assert.equal(calls[0].fileName, name);
  assert.equal(typeof calls[0].signal?.aborted, 'boolean');
  assert.equal(typeof calls[0].onProgress, 'function');
  assert.equal(documentRef.querySelector('h2').textContent, 'acrescido.pdf');
  assert.equal(documentRef.querySelector('dialog').open, true);
  documentRef.querySelector('[data-preview-action="export"]').click();
  await afterPreviewAction();
  assert.deepEqual(exported, [{ blob: replacement, fileName: 'acrescido.pdf' }]);
});

test('repeat appends use the newly confirmed PDF and retain close and return-focus ownership', async t => {
  const original = new Blob(['image'], { type: 'image/png' });
  const first = new Blob(['%PDF-first'], { type: 'application/pdf' });
  const second = new Blob(['%PDF-second'], { type: 'application/pdf' });
  const calls = [];
  let closed = 0, focusResolved = 0;
  const { preview, documentRef } = setupAppendPreview(t);
  const draft = documentRef.querySelector('textarea');
  draft.focus();
  await preview.open(original, 'foto.png', {
    onClose: () => { closed++; },
    resolveReturnFocus: () => { focusResolved++; return draft; },
    onAppendPages: async (mode, { blob, fileName }) => {
      calls.push({ mode, blob, fileName });
      return calls.length === 1 ? { blob: first, fileName: 'primeiro.pdf' } : { blob: second, fileName: 'segundo.pdf' };
    },
  });
  chooseAppend(documentRef, 'files'); await afterPreviewAction();
  assert.equal(closed, 0, 'substituir o conteúdo não encerra a prévia');
  chooseAppend(documentRef, 'camera'); await afterPreviewAction();
  assert.deepEqual(calls, [
    { mode: 'files', blob: original, fileName: 'foto.png' },
    { mode: 'camera', blob: first, fileName: 'primeiro.pdf' },
  ]);
  assert.equal(documentRef.querySelector('h2').textContent, 'segundo.pdf');
  assert.equal(closed, 0);
  assert.equal(focusResolved, 0);
  preview.close();
  assert.equal(closed, 1);
  assert.equal(focusResolved, 1);
  assert.equal(documentRef.activeElement, draft);
  assert.equal(draft.value, 'rascunho preservado');
});

for (const cancellation of ['null', 'AbortError']) test(`append cancellation via ${cancellation} retains the original and allows another choice`, async t => {
  const calls = [];
  const { preview, documentRef, dom, revoked } = setupAppendPreview(t);
  const original = new Blob(['image'], { type: 'image/jpeg' });
  await preview.open(original, 'foto.jpg', { onAppendPages: async (mode, context) => {
    calls.push({ mode, ...context });
    if (cancellation === 'AbortError') throw new DOMException('Cancelado', 'AbortError');
    return null;
  } });
  const image = documentRef.querySelector('.attachment-preview-image');
  image.dispatchEvent(new dom.window.Event('load'));
  const previousStatus = documentRef.querySelector('.attachment-preview-status').textContent;
  chooseAppend(documentRef, 'files'); await afterPreviewAction();
  assert.equal(documentRef.querySelector('.attachment-preview-image'), image);
  assert.deepEqual(revoked, []);
  assert.equal(documentRef.querySelector('h2').textContent, 'foto.jpg');
  assert.equal(documentRef.querySelector('.attachment-preview-status').textContent, previousStatus);
  calls[0].onProgress({ percent: 100 });
  assert.equal(documentRef.querySelector('.attachment-preview-status').textContent, previousStatus, 'progresso tardio não reativa o carregamento');
  chooseAppend(documentRef, 'camera'); await afterPreviewAction();
  assert.deepEqual(calls.map(call => [call.mode, call.blob, call.fileName]), [['files', original, 'foto.jpg'], ['camera', original, 'foto.jpg']]);
});

test('an append error leaves the original visible and retry still uses that original', async t => {
  const original = new Blob(['image'], { type: 'image/jpeg' });
  const replacement = new Blob(['%PDF-confirmed'], { type: 'application/pdf' });
  const calls = [];
  const { preview, documentRef, dom, revoked } = setupAppendPreview(t);
  await preview.open(original, 'foto.jpg', { onAppendPages: async (mode, context) => {
    calls.push({ mode, ...context });
    if (calls.length === 1) throw new Error('Servidor indisponível');
    return { blob: replacement, fileName: 'confirmado.pdf' };
  } });
  const image = documentRef.querySelector('.attachment-preview-image');
  chooseAppend(documentRef, 'files'); await afterPreviewAction();
  const status = documentRef.querySelector('.attachment-preview-status');
  assert.equal(documentRef.querySelector('.attachment-preview-image'), image);
  assert.deepEqual(revoked, []);
  assert.match(status.textContent, /Servidor indisponível/);
  assert.match(status.textContent, /tente novamente/i);
  assert.equal(status.querySelector('.app-loading__spinner'), null);
  const errorStatus = status.textContent;
  image.dispatchEvent(new dom.window.Event('load'));
  calls[0].onProgress({ percent: 100 });
  assert.equal(status.textContent, errorStatus, 'eventos antigos não apagam o erro da tentativa');
  chooseAppend(documentRef, 'files'); await afterPreviewAction();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].blob, original);
  assert.equal(documentRef.querySelector('h2').textContent, 'confirmado.pdf');
  assert.deepEqual(revoked, ['blob:preview-1']);
});

test('a stale append context explains how to reopen and retires only that preview append action', async t => {
  const original = new Blob(['original'], { type: 'image/jpeg' });
  const exported = [];
  const { preview, documentRef, revoked } = setupAppendPreview(t, {
    exportMedia: blob => { exported.push(blob); },
  });
  await preview.open(original, 'original.jpg', { onAppendPages: async () => {
    throw Object.assign(new Error('O fluxo deste anexo mudou. Feche esta prévia e abra o anexo novamente na bandeja.'),
      { code: 'ATTACHMENT_PREVIEW_STALE' });
  } });
  const image = documentRef.querySelector('.attachment-preview-image');
  chooseAppend(documentRef, 'files'); await afterPreviewAction();
  assert.match(documentRef.querySelector('.attachment-preview-status').textContent, /abra.*novamente/);
  assert.doesNotMatch(documentRef.querySelector('.attachment-preview-status').textContent, /tente novamente no botão/i);
  assert.equal(documentRef.querySelector('[data-preview-action="append-pages"]').hidden, true);
  assert.equal(documentRef.activeElement, documentRef.querySelector('.attachment-preview-close'),
    'a retired append action leaves keyboard focus on the visible close control');
  assert.equal(documentRef.querySelector('.attachment-preview-image'), image);
  assert.deepEqual(revoked, []);
  assert.equal(documentRef.querySelector('dialog').open, true);
  documentRef.querySelector('[data-preview-action="export"]').click(); await afterPreviewAction();
  assert.deepEqual(exported, [original]);
  await preview.open(original, 'original.jpg', { onAppendPages: async () => null });
  assert.equal(documentRef.querySelector('[data-preview-action="append-pages"]').hidden, false);
});

test('cancelled append restores the image readiness received while the choice was pending', async t => {
  let finish;
  const { preview, documentRef, dom } = setupAppendPreview(t);
  await preview.open(new Blob(['image'], { type: 'image/png' }), 'foto.png', { onAppendPages: () => new Promise(resolve => { finish = resolve; }) });
  chooseAppend(documentRef, 'files');
  documentRef.querySelector('.attachment-preview-image').dispatchEvent(new dom.window.Event('load'));
  finish(null); await afterPreviewAction();
  assert.equal(documentRef.querySelector('.attachment-preview-status [role="progressbar"]').textContent, '100%');
  assert.equal(documentRef.querySelector('.attachment-preview-status .app-loading__spinner'), null);
});

test('a malformed or non-PDF append result retains the original and offers retry', async t => {
  const { preview, documentRef, revoked } = setupAppendPreview(t);
  for (const result of [{ fileName: 'invalido.pdf' }, { blob: new Blob(['image'], { type: 'image/png' }), fileName: 'invalido.png' }]) {
    await preview.open(new Blob(['image'], { type: 'image/jpeg' }), 'original.jpg', { onAppendPages: async () => result });
    const image = documentRef.querySelector('.attachment-preview-image');
    const revokedBefore = [...revoked];
    chooseAppend(documentRef, 'files'); await afterPreviewAction();
    assert.equal(documentRef.querySelector('.attachment-preview-image'), image);
    assert.equal(documentRef.querySelector('h2').textContent, 'original.jpg');
    assert.deepEqual(revoked, revokedBefore);
    assert.match(documentRef.querySelector('.attachment-preview-status').textContent, /PDF|inválido/i);
    assert.equal(documentRef.querySelector('[data-preview-action="append-pages"]').disabled, false);
  }
});

test('busy append excludes duplicate choices, keeps Close available and caps progress until confirmation', async t => {
  let finish, context, calls = 0;
  const { preview, documentRef, dom } = setupAppendPreview(t);
  await preview.open(new Blob(['image'], { type: 'image/png' }), 'foto.png', { onAppendPages: (_mode, options) => {
    calls++; context = options;
    return new Promise(resolve => { finish = resolve; });
  } });
  chooseAppend(documentRef, 'files');
  const button = documentRef.querySelector('[data-preview-action="append-pages"]');
  const status = documentRef.querySelector('.attachment-preview-status');
  assert.equal(button.disabled, true);
  assert.equal(documentRef.querySelector('.attachment-preview-close').disabled, false);
  assert.equal(status.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '33');
  assert.ok(status.querySelector('.app-loading__spinner'));
  documentRef.querySelector('[data-preview-action="append-camera"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(calls, 1);
  context.onProgress({ percent: null });
  assert.equal(status.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '33');
  context.onProgress({ percent: 45 });
  assert.equal(status.querySelector('[role="progressbar"]').textContent, '48%');
  context.onProgress({ percent: 100 });
  documentRef.querySelector('.attachment-preview-image').dispatchEvent(new dom.window.Event('load'));
  assert.equal(status.querySelector('[role="progressbar"]').textContent, '66%');
  assert.equal(documentRef.querySelector('h2').textContent, 'foto.png');
  finish({ blob: new Blob(['%PDF-confirmed'], { type: 'application/pdf' }), fileName: 'confirmado.pdf' });
  await afterPreviewAction();
  assert.equal(documentRef.querySelector('h2').textContent, 'confirmado.pdf');
  assert.equal(button.disabled, false);
  assert.equal(status.querySelector('[role="progressbar"]').textContent, '100%');
});

for (const closing of [true, false]) for (const outcome of ['success', 'error']) test(`append ignores late ${outcome} after ${closing ? 'Close' : 'opening a different preview'}`, async t => {
  let finish, fail, context;
  const { preview, documentRef } = setupAppendPreview(t);
  await preview.open(new Blob(['image'], { type: 'image/png' }), 'antigo.png', { onAppendPages: (_mode, options) => {
    context = options;
    return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  } });
  chooseAppend(documentRef, 'camera');
  if (closing) documentRef.querySelector('.attachment-preview-close').click();
  else await preview.open(new Blob(['atual'], { type: 'text/plain' }), 'atual.txt');
  assert.equal(context.signal.aborted, true);
  const status = documentRef.querySelector('.attachment-preview-status');
  const previousStatus = status.textContent;
  context.onProgress({ percent: 100 });
  if (outcome === 'success') finish({ blob: new Blob(['%PDF-stale'], { type: 'application/pdf' }), fileName: 'obsoleto.pdf' });
  else fail(new Error('erro obsoleto'));
  await afterPreviewAction();
  assert.equal(status.textContent, previousStatus);
  assert.equal(documentRef.querySelector('dialog').open, !closing);
  assert.doesNotMatch(documentRef.querySelector('dialog').textContent, /obsoleto/);
  if (!closing) {
    assert.equal(documentRef.querySelector('h2').textContent, 'atual.txt');
    assert.equal(documentRef.querySelector('pre').textContent, 'atual');
  }
});

test('append action is absent in ordinary gallery, report and collection previews and does not leak from a previous open', async t => {
  let calls = 0;
  const { preview, documentRef } = setupAppendPreview(t);
  const pdf = new Blob(['%PDF'], { type: 'application/pdf' });
  await preview.open(pdf, 'autorizado.pdf', { onAppendPages: () => { calls++; return null; } });
  assert.equal(documentRef.querySelector('[data-preview-action="append-pages"]')?.hidden, false);
  for (const open of [
    () => preview.open(pdf, 'galeria.pdf'),
    () => preview.open(pdf, 'relatorio.pdf', { layout: 'report-pdf' }),
    () => preview.openCollection([{ source: pdf, fileName: 'colecao.pdf' }]),
  ]) {
    await open();
    assert.equal(documentRef.querySelector('[data-preview-action="append-pages"]').hidden, true);
    documentRef.querySelector('[data-preview-action="append-files"]').click();
    documentRef.querySelector('[data-preview-action="append-camera"]').click();
  }
  assert.equal(calls, 0);
});

test('append action waits for its source and rejects media or unsupported types even with a handler', async t => {
  let finish, calls = 0;
  const { preview, documentRef } = setupAppendPreview(t);
  const onAppendPages = () => { calls++; return null; };
  const opening = preview.open(new Promise(resolve => { finish = resolve; }), 'carregando.pdf', { onAppendPages });
  assert.equal(documentRef.querySelector('[data-preview-action="append-pages"]')?.hidden, true);
  finish(new Blob(['%PDF'], { type: 'application/pdf' })); await opening;
  assert.equal(documentRef.querySelector('[data-preview-action="append-pages"]').hidden, false);
  for (const [name, type] of [['a.mp4', 'video/mp4'], ['a.mp3', 'audio/mpeg'], ['a.txt', 'text/plain'], ['a.svg', 'image/svg+xml']]) {
    await preview.open(new Blob(['data'], { type }), name, { onAppendPages });
    assert.equal(documentRef.querySelector('[data-preview-action="append-pages"]').hidden, true);
    documentRef.querySelector('[data-preview-action="append-files"]').click();
  }
  assert.equal(calls, 0);
});

test('append menu supports arrow navigation and Escape without closing the preview', async t => {
  const { preview, documentRef, dom } = setupAppendPreview(t);
  await preview.open(new Blob(['%PDF'], { type: 'application/pdf' }), 'a.pdf', { onAppendPages: async () => null });
  const button = documentRef.querySelector('[data-preview-action="append-pages"]');
  assert.ok(button);
  button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  const files = documentRef.querySelector('[data-preview-action="append-files"]');
  const camera = documentRef.querySelector('[data-preview-action="append-camera"]');
  assert.equal(documentRef.activeElement, files);
  files.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(documentRef.activeElement, camera);
  camera.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(documentRef.querySelector('.attachment-preview-append-menu').hidden, true);
  assert.equal(documentRef.activeElement, button);
  assert.equal(documentRef.querySelector('dialog').open, true);
});

test('measured attachment loader uses actual download bytes and waits for PDF rendering before 100%', async t => {
  let progress, finishDownload, finishPdf;
  const { preview, documentRef } = setup(t, { loadPdfPreview: async () => ({ createPdfPreview: () => ({
    ready: new Promise(resolve => { finishPdf = resolve; }), destroy() {},
  }) }) });
  const pending = preview.open(({ onProgress }) => {
    progress = onProgress;
    return new Promise(resolve => { finishDownload = resolve; });
  }, 'large.pdf');
  const percent = () => documentRef.querySelector('.attachment-preview-status [role="progressbar"]');
  assert.equal(percent()?.getAttribute('aria-valuenow'), '33');
  assert.ok(percent().parentElement.querySelector('.app-loading__spinner'));
  progress({ loaded: 4, total: 8, percent: 50 });
  assert.equal(percent().textContent, '50%');
  progress({ loaded: 8, total: 8, percent: 100 });
  finishDownload(new Blob(['%PDF'], { type: 'application/pdf' }));
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(percent().getAttribute('aria-valuenow'), '66');
  assert.equal(documentRef.querySelector('.attachment-preview-sign').disabled, true);
  finishPdf(); await pending;
  assert.equal(percent().getAttribute('aria-valuenow'), '100');
  assert.equal(documentRef.querySelector('.attachment-preview-status .app-loading__spinner'), null);
  assert.doesNotThrow(() => progress({ percent: 20, loaded: 2, total: 10 }));
  assert.equal(percent().getAttribute('aria-valuenow'), '100');
});

test('a real PDF with no rendered pages never reports 100%', async t => {
  const pdf = { numPages: 1, getPage: async () => { throw new Error('page failed'); } };
  const { preview, documentRef, dom } = setup(t, { loadPdfPreview: async () => ({ createPdfPreview: options => createPdfPreview({ ...options,
    loadPdfJs: async () => ({ getDocument: () => ({ promise: Promise.resolve(pdf), destroy: async () => {} }) }) }) }) });
  dom.reconfigure({ url: 'https://example.test/energetico/' });
  await preview.open(new Blob(['%PDF'], { type: 'application/pdf' }), 'unrenderable.pdf');
  assert.equal(documentRef.querySelectorAll('canvas').length, 0);
  assert.ok(documentRef.querySelector('.attachment-preview-pdf-page--error'));
  assert.equal(documentRef.querySelector('[aria-valuenow="100"]'), null);
  assert.equal(documentRef.querySelector('.app-loading__spinner'), null);
  assert.match(documentRef.querySelector('.attachment-preview-status').textContent, /não pôde ser exibida/);
});

for (const kind of ['video', 'audio']) test(`${kind} waits for decoded data rather than metadata before reporting 100%`, async t => {
  const { preview, documentRef, dom } = setup(t);
  await preview.open(new Blob(['media'], { type: `${kind}/mp4` }), kind === 'audio' ? 'audio.m4a' : 'video.mp4');
  const media = documentRef.querySelector(kind);
  media.dispatchEvent(new dom.window.Event('loadedmetadata'));
  assert.equal(documentRef.querySelector('[role="progressbar"]').textContent, '66%');
  media.dispatchEvent(new dom.window.Event('loadeddata'));
  assert.equal(documentRef.querySelector('[role="progressbar"]').textContent, '100%');
});

test('a media error cannot be followed by a stale completion event', async t => {
  const { preview, documentRef, dom } = setup(t);
  await preview.open(new Blob(['media'], { type: 'video/mp4' }), 'broken.mp4');
  const media = documentRef.querySelector('video');
  media.dispatchEvent(new dom.window.Event('error'));
  media.dispatchEvent(new dom.window.Event('loadeddata'));
  assert.equal(documentRef.querySelector('[aria-valuenow="100"]'), null);
  assert.match(documentRef.querySelector('dialog').textContent, /não conseguiu reproduzir/);
});

test('closing or replacing the attachment aborts its download and ignores its late progress', async t => {
  const { preview, documentRef } = setup(t);
  let firstProgress, firstSignal, finishFirst;
  const first = preview.open(({ onProgress, signal }) => { firstProgress = onProgress; firstSignal = signal; return new Promise(resolve => { finishFirst = resolve; }); }, 'old.txt');
  const second = preview.open(new Promise(() => {}), 'new.txt');
  assert.equal(firstSignal?.aborted, true);
  firstProgress({ percent: 95, loaded: 95, total: 100 });
  assert.equal(documentRef.querySelector('[role="progressbar"]').textContent, '33%');
  finishFirst(new Blob(['old'], { type: 'text/plain' })); await first;
  assert.equal(documentRef.querySelector('h2').textContent, 'new.txt');
  preview.close();
  assert.equal(documentRef.querySelector('dialog').open, false);
  void second;
});

test('attachments inside gallery editors use the app loader, retain collection navigation and cancel only their own preview', async t => {
  const { preview, documentRef } = setup(t), downloads = [];
  let finish, downloadOptions;
  const editor = createAttachmentPreviewController({ documentRef, files: [{ name: 'one.txt', type: 'text/plain' }, { name: 'two.txt', type: 'text/plain' }], actions: {
    canView: () => true,
    downloadAttachment(name, options) { downloads.push(name); downloadOptions = options; return new Promise(resolve => { finish = resolve; }); },
  } });
  t.after(() => editor.cleanup());
  await editor.open(1);
  assert.equal(documentRef.querySelector('dialog').open, true);
  assert.equal(documentRef.querySelector('h2').textContent, 'two.txt');
  assert.deepEqual(downloads, ['two.txt']);
  downloadOptions.onProgress({ percent: 50 });
  assert.equal(documentRef.querySelector('[role="progressbar"]').textContent, '50%');
  finish(new Blob(['second'], { type: 'text/plain' }));
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(documentRef.querySelector('[role="progressbar"]').textContent, '100%');
  documentRef.querySelector('[data-preview-action="previous"]').click();
  assert.deepEqual(downloads, ['two.txt', 'one.txt']);
  assert.equal(documentRef.querySelector('h2').textContent, 'one.txt');
  const previousSignal = downloadOptions.signal;
  await preview.open(new Blob(['other'], { type: 'text/plain' }), 'other.txt');
  assert.equal(previousSignal.aborted, true);
  editor.cleanup();
  assert.equal(documentRef.querySelector('dialog').open, true, 'closing an old editor cannot close a newer tray preview');
  assert.equal(documentRef.querySelector('h2').textContent, 'other.txt');
  finish(new Blob(['late'], { type: 'text/plain' }));
});

test('measured unknown attachment size keeps completed stages and real bytes without inventing a total', async t => {
  const { preview, documentRef } = setup(t);
  let progress, fail;
  const pending = preview.open(({ onProgress }) => { progress = onProgress; return new Promise((_, reject) => { fail = reject; }); }, 'unavailable.pdf');
  progress({ percent: null, loaded: 200, total: null });
  const badge = documentRef.querySelector('[role="progressbar"]');
  assert.equal(badge.getAttribute('aria-valuenow'), '33');
  assert.equal(badge.textContent, '33%');
  assert.match(badge.getAttribute('aria-label'), /etapas/i);
  assert.match(documentRef.querySelector('.app-loading__text').textContent, /200/);
  assert.match(documentRef.querySelector('.app-loading__text').textContent, /total não informado/i);
  fail(new Error('offline')); await pending;
  assert.equal(documentRef.querySelector('[role="progressbar"]'), null);
  assert.match(documentRef.querySelector('.attachment-preview-status').textContent, /não está disponível/);
  assert.doesNotThrow(() => progress({ percent: 100 }));
  assert.equal(documentRef.querySelector('[role="progressbar"]'), null);
});

test('measured attachment preparation accepts PDF parse and render callbacks but ignores stale completion', async t => {
  let report, finish;
  const { preview, documentRef } = setup(t, { loadPdfPreview: async () => ({ createPdfPreview: ({ onProgress }) => {
    report = onProgress;
    return { ready: new Promise(resolve => { finish = resolve; }), destroy() {} };
  } }) });
  const pending = preview.open(new Blob(['%PDF'], { type: 'application/pdf' }), 'pages.pdf');
  await afterPreviewAction();
  const badge = () => documentRef.querySelector('[role="progressbar"]');
  assert.equal(badge().getAttribute('aria-valuenow'), '66');
  assert.equal(typeof report, 'function');
  report({ percent: 50, phase: 'parsed' });
  assert.equal(badge().getAttribute('aria-valuenow'), '82');
  report({ percent: 75, phase: 'render', renderedPages: 1, totalPages: 2 });
  assert.equal(badge().getAttribute('aria-valuenow'), '90');
  report({ percent: 100, phase: 'ready' });
  assert.equal(badge().getAttribute('aria-valuenow'), '99');
  finish(); await pending;
  assert.equal(badge().getAttribute('aria-valuenow'), '100');
  const next = preview.open(new Promise(() => {}), 'next.txt');
  report({ percent: 100 });
  assert.equal(badge().getAttribute('aria-valuenow'), '33');
  preview.close(); void next;
});
for (const layout of ['report-pdf', 'flow-summary']) test(`${layout} has one emoji close and no duplicate return button, including loading and errors`, async t => {
  const { preview, documentRef, dom } = setup(t, { loadPdfPreview: async () => ({ createPdfPreview: () => ({ ready: Promise.resolve(), destroy() {} }) }) });
  let resolve, closed = 0;
  const loading = preview.open(new Promise(done => { resolve = done; }), 'relatorio.pdf', { layout, returnLabel: 'Voltar ao relatório', onClose: () => closed++ });
  const dialog = documentRef.querySelector('dialog');
  const close = documentRef.querySelector('.attachment-preview-close');
  assert.equal(close.textContent, '❌');
  assert.equal(close.getAttribute('aria-label'), 'Fechar relatório');
  assert.equal(documentRef.querySelector('.attachment-preview-back').hidden, true);
  assert.equal([...dialog.querySelectorAll('button')].filter(button => !button.hidden && /Fechar|Voltar ao/.test(button.textContent)).length, 0);
  close.click();
  resolve(new Blob(['pdf'], { type: 'application/pdf' }));
  await loading;
  assert.equal(dialog.open, false);
  assert.equal(closed, 1);
  await preview.open(Promise.reject(new Error('Falha de consulta')), 'relatorio.pdf', { layout, onClose: () => closed++ });
  assert.equal(close.textContent, '❌');
  dialog.querySelector('.attachment-preview-content').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(dialog.open, true, 'um clique dentro mantém o relatório aberto');
  dialog.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(dialog.open, false);
  assert.equal(closed, 2);
  assert.equal(documentRef.querySelector('textarea').value, 'rascunho preservado');
  await preview.open(new Blob(['pdf'], { type: 'application/pdf' }), 'anexo.pdf');
  assert.equal(close.textContent, 'Fechar', 'o visualizador de anexos comum não muda');
  assert.equal(documentRef.querySelector('.attachment-preview-back').hidden, false);
});

test('report PDF requests whole-page fit without changing ordinary attachments',async t=>{
 const fits=[];const {preview}=setup(t,{loadPdfPreview:async()=>({createPdfPreview:options=>{fits.push(options.fit);return {ready:Promise.resolve(),destroy(){}};}})});
 const blob=new Blob(['pdf'],{type:'application/pdf'});
 await preview.open(blob,'presencas-rhid.pdf',{layout:'report-pdf'});assert.equal(fits[0],'page');
 await preview.open(blob,'outro.pdf');assert.equal(fits[1],'width');
});

test('PDF signature actions carry the displayed page rather than always the first employee',async t=>{
 const calls=[],starts=[];const {preview,documentRef}=setup(t,{loadPdfPreview:async()=>({createPdfPreview:options=>{starts.push(options.initialPage);return {ready:Promise.resolve(),destroy(){},getCurrentPage:()=>2};}})});
 await preview.open(new Blob(['pdf'],{type:'application/pdf'}),'mensal.pdf',{layout:'report-pdf',initialPage:2,onSign:input=>calls.push(input),onStamp:input=>calls.push(input)});
 documentRef.querySelector('[data-preview-action="sign"]').click();await new Promise(resolve=>setImmediate(resolve));
 documentRef.querySelector('[data-preview-action="stamp"]').click();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls.map(input=>input.page),[2,2]);assert.deepEqual(starts,[2]);
});

test('PDF signing stays disabled until a tracked page is ready and after viewer failure',async t=>{
 for(const canEmbed of [false,true]){
  const calls=[];const {preview,documentRef}=setup(t,{canEmbedPdf:()=>canEmbed,loadPdfPreview:async()=>{throw new Error('worker unavailable');}});
  await preview.open(new Blob(['%PDF-1.7'],{type:'application/pdf'}),'mensal.pdf',{layout:'report-pdf',onSign:input=>calls.push(input),onStamp:input=>calls.push(input)});
  for(const action of ['sign','stamp']){const button=documentRef.querySelector(`[data-preview-action="${action}"]`);assert.equal(button.disabled,true);button.click();}
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,0);
 }
 let finish,onError;const calls=[];
 const {preview,documentRef}=setup(t,{loadPdfPreview:async()=>({createPdfPreview:options=>{onError=options.onError;return {ready:new Promise(resolve=>{finish=resolve;}),destroy(){},getCurrentPage:()=>2};}})});
 const pending=preview.open(new Blob(['%PDF'],{type:'application/pdf'}),'mensal.pdf',{layout:'report-pdf',onSign:input=>calls.push(input)});
 await Promise.resolve();const button=documentRef.querySelector('[data-preview-action="sign"]');assert.equal(button.disabled,true);
 finish();await pending;assert.equal(button.disabled,false);
 onError(new Error('render failed'));assert.equal(button.disabled,true);button.click();assert.equal(calls.length,0);
});

test('real report viewer disables signing on failed pages, scrolling and pending refits',async t=>{
 let fails=true,height=600;const calls=[];
 const pdf={numPages:2,getPage:async number=>({getViewport:({scale})=>({width:600*scale,height:900*scale}),cleanup(){},render:()=>({promise:number===2&&fails?Promise.reject(new Error('page failed')):Promise.resolve(),cancel(){}})})};
 const {preview,documentRef,dom}=setup(t,{loadPdfPreview:async()=>({createPdfPreview:options=>createPdfPreview({...options,loadPdfJs:async()=>({getDocument:()=>({promise:Promise.resolve(pdf),destroy:async()=>{}})})})})});
 dom.reconfigure({url:'https://example.test/energetico/'});
 dom.window.HTMLCanvasElement.prototype.getContext=()=>({});
 Object.defineProperty(dom.window.HTMLElement.prototype,'clientHeight',{get(){return this.matches('.attachment-preview-pdf-viewport')?height:0;},configurable:true});
 const bounds=dom.window.HTMLElement.prototype.getBoundingClientRect;
 dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
  const viewport=documentRef.querySelector('.attachment-preview-pdf-viewport');
  if(this===viewport)return {top:0,bottom:height,height};
  if(this.matches('.attachment-preview-pdf-page')){const top=([...this.parentElement.children].indexOf(this))*620-viewport.scrollTop;return {top,bottom:top+600,height:600};}
  return bounds.call(this);
 };
 await preview.open(new Blob(['%PDF'],{type:'application/pdf'}),'mensal.pdf',{layout:'report-pdf',initialPage:2,onSign:input=>calls.push(input),onStamp:input=>calls.push(input)});
 const sign=documentRef.querySelector('[data-preview-action="sign"]'),stamp=documentRef.querySelector('[data-preview-action="stamp"]');
 assert.match(documentRef.querySelector('[data-page-number="2"]').textContent,/Não foi possível/);assert.equal(sign.disabled,true);assert.equal(stamp.disabled,true);
 assert.equal(documentRef.querySelector('[data-pdf-action="next-page"]'),null,'reports advance by scrolling');
 const viewport=documentRef.querySelector('.attachment-preview-pdf-viewport');
 viewport.scrollTop=0;viewport.dispatchEvent(new dom.window.Event('scroll'));assert.equal(sign.disabled,false);sign.click();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls.map(input=>input.page),[1]);
 viewport.scrollTop=620;viewport.dispatchEvent(new dom.window.Event('scroll'));assert.equal(sign.disabled,true);
 fails=false;height=590;dom.window.dispatchEvent(new dom.window.Event('resize'));assert.equal(sign.disabled,true);
 for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(sign.disabled,false);
 fails=true;height=400;dom.window.dispatchEvent(new dom.window.Event('resize'));assert.equal(sign.disabled,true);
 for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(sign.disabled,true);sign.click();assert.equal(calls.length,1);
});

test("report signature actions are opt-in, receive the current PDF and reset for another attachment", async t => {
  const calls = [];
  const { preview, documentRef } = setup(t, { loadPdfPreview: async () => ({ createPdfPreview: () => ({ ready: Promise.resolve(), destroy() {}, getCurrentPage: () => 1 }) }) });
  const blob = new Blob(["pdf"], { type: "application/pdf" });
  await preview.open(blob, "mensal.pdf", { layout: "report-pdf", onSign: input => calls.push(["employee", input]), onStamp: input => calls.push(["company", input]) });
  const sign = documentRef.querySelector('[data-preview-action="sign"]');
  const stamp = documentRef.querySelector('[data-preview-action="stamp"]');
  assert.ok(sign && stamp, "prévia oferece assinar e inserir Bernardo");
  assert.equal(sign.hidden, false);
  sign.click(); await new Promise(resolve => setImmediate(resolve));
  stamp.click(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(([role, input]) => [role, input.blob, input.fileName]), [["employee", blob, "mensal.pdf"], ["company", blob, "mensal.pdf"]]);
  await preview.open(blob, "outro.pdf");
  assert.equal(sign.hidden, true); assert.equal(stamp.hidden, true);
  sign.click(); stamp.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2, "outro anexo não herda ação do relatório");
});

test("abre antes de ler o arquivo e preserva conversa, rascunho, rolagem e foco ao fechar", async t => {
  let finishRead;
  const { preview, documentRef } = setup(t, { readText: () => new Promise(resolve => { finishRead = resolve; }) });
  const draft = documentRef.querySelector("textarea");
  const messages = documentRef.querySelector("#messages");
  messages.scrollTop = 231;
  draft.focus();
  const ready = preview.open(new Blob(["texto"], { type: "text/plain" }), "relatório.txt");
  assert.equal(documentRef.querySelector("dialog").open, true);
  assert.equal(documentRef.querySelector("h2").textContent, "relatório.txt");
  preview.close();
  finishRead("resposta atrasada");
  await ready;
  assert.equal(documentRef.querySelector("dialog").open, false);
  assert.equal(documentRef.querySelector("textarea"), draft);
  assert.equal(draft.value, "rascunho preservado");
  assert.equal(messages.scrollTop, 231);
  assert.equal(documentRef.activeElement, draft);
  assert.equal(documentRef.querySelector("dialog").textContent.includes("resposta atrasada"), false);
});

test("coleção de anexos abre o primeiro arquivo e permite avançar e voltar sem fechar o visualizador", async t => {
  const { preview, documentRef } = setup(t);
  await preview.openCollection([
    { source: new Blob(["primeiro"], { type: "text/plain" }), fileName: "primeiro.txt" },
    { source: new Blob(["segundo"], { type: "text/plain" }), fileName: "segundo.txt" },
  ]);
  const dialog = documentRef.querySelector("dialog");
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector("h2").textContent, "primeiro.txt");
  assert.equal(dialog.querySelector("[data-preview-action=previous]").disabled, true);
  assert.equal(dialog.querySelector("[data-preview-action=next]").disabled, false);
  assert.match(dialog.querySelector("[data-preview-action=collection-status]").textContent, /1 de 2/);
  dialog.querySelector("[data-preview-action=next]").click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dialog.querySelector("h2").textContent, "segundo.txt");
  assert.equal(dialog.querySelector("pre").textContent, "segundo");
  dialog.querySelector("[data-preview-action=previous]").click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dialog.querySelector("h2").textContent, "primeiro.txt");
});

test("imagem usa URL local e libera a anterior ao substituir e ao cancelar", async t => {
  const { preview, documentRef, dom, revoked } = setup(t);
  await preview.open(new Blob(["imagem"], { type: "image/jpeg" }), "foto.jpg");
  assert.equal(documentRef.querySelector("dialog img").src, "blob:preview-1");
  await preview.open(new Blob(["outra imagem"], { type: "image/png" }), "foto2.png");
  assert.deepEqual(revoked, ["blob:preview-1"]);
  documentRef.querySelector("dialog").dispatchEvent(new dom.window.Event("cancel", { cancelable: true }));
  assert.equal(documentRef.querySelector("dialog").open, false);
  assert.deepEqual(revoked, ["blob:preview-1", "blob:preview-2"]);
});

test("layout semântico chega à imagem, infere resumo gerado e não vaza para foto ou PDF", async t => {
  const { preview, documentRef } = setup(t, { loadPdfPreview: async () => ({ createPdfPreview: () => ({ ready: Promise.resolve(), destroy() {} }) }) });
  const dialog = documentRef.querySelector('dialog');
  const image = new Blob(['original'], { type: 'image/png' });
  await preview.open(image, 'arquivo.png', { layout: 'flow-summary' });
  assert.equal(dialog.dataset.layout, 'flow-summary', 'opção explícita chega a openOne');
  await preview.openCollection([{ source: image, fileName: 'RESUMO-tarefa.PNG' }, { source: image, fileName: 'foto.png' }]);
  assert.equal(dialog.dataset.layout, 'flow-summary', 'coleção reconhece resumo gerado');
  dialog.querySelector('[data-preview-action=next]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(dialog.dataset.layout, 'flow-summary', 'próxima foto mantém ajuste comum');
  for (const name of ['resumo-foto.jpg', 'meu-resumo-tarefa.png', 'resumo-.png']) {
    await preview.open(image, name);
    assert.notEqual(dialog.dataset.layout, 'flow-summary', 'fallback restrito ao PNG gerado');
  }
  await preview.open(new Blob(['pdf'], { type: 'application/pdf' }), 'relatorio.pdf');
  assert.notEqual(dialog.dataset.layout, 'flow-summary');
});

for (const type of ["", "application/octet-stream", "binary/octet-stream", "image/jpg", "image/pjpeg"]) {
  test(`JPEG com nome genérico e tipo ${type || "ausente"} abre como imagem e preserva o original`, async t => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])], { type });
    let displayed;
    let exported;
    const { preview, documentRef, revoked } = setup(t, {
      urlApi: { createObjectURL: blob => { displayed = blob; return "blob:jpeg"; }, revokeObjectURL: url => revoked.push(url) },
      exportMedia: (blob, name) => { exported = { blob, name }; },
    });
    await preview.open(jpeg, "imagem");
    assert.ok(documentRef.querySelector("dialog img"), "JPEG não deve cair na mensagem de formato não suportado");
    assert.equal(displayed.type, "image/jpeg");
    assert.deepEqual(new Uint8Array(await displayed.arrayBuffer()), new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]));
    documentRef.querySelector(".attachment-preview-export").click();
    assert.deepEqual(exported, { blob: jpeg, name: "imagem" });
    preview.close();
    assert.deepEqual(revoked, ["blob:jpeg"]);
  });
}

test("JPEG identificado só pela extensão recebe MIME de imagem para a prévia", async t => {
  let displayed;
  const { preview, documentRef } = setup(t, { urlApi: {
    createObjectURL: blob => { displayed = blob; return "blob:jpeg"; }, revokeObjectURL() {},
  } });
  await preview.open(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "application/octet-stream" }), "IMG_4722.JPEG");
  assert.ok(documentRef.querySelector("dialog img"));
  assert.equal(displayed.type, "image/jpeg");
});

test("detecção JPEG não promove conteúdo arbitrário nem formatos ativos a imagem", async t => {
  const { preview, documentRef } = setup(t);
  for (const [bytes, type, name] of [
    [[0xff, 0xd8], "application/octet-stream", "imagem"],
    [[0xff, 0xd8, 0, 0xe0], "", "imagem"],
    [[0xff, 0xd8, 0xff, 0xe0], "text/html", "imagem"],
    [[0xff, 0xd8, 0xff, 0xe0], "application/octet-stream", "arquivo.svg"],
  ]) {
    await preview.open(new Blob([new Uint8Array(bytes)], { type }), name);
    assert.equal(documentRef.querySelector("dialog img, dialog iframe"), null);
    assert.match(documentRef.querySelector(".attachment-preview-content").textContent, /outro app/);
  }
});

test("imagem amplia a partir de dimensões-base fixas sem acumular escala", async t => {
  const { preview, documentRef } = setup(t);
  const content = documentRef.querySelector(".attachment-preview-content");
  Object.defineProperties(content, {
    clientWidth: { value: 400 },
    clientHeight: { value: 400 },
    getBoundingClientRect: { value: () => ({ left: 0, top: 0 }) },
  });
  await preview.open(new Blob(["imagem"], { type: "image/jpeg" }), "foto.jpg");
  const image = documentRef.querySelector("dialog img");
  Object.defineProperties(image, {
    naturalWidth: { value: 800 },
    naturalHeight: { value: 600 },
    getBoundingClientRect: {
      value: () => ({
        width: parseFloat(image.style.width) || 400,
        height: parseFloat(image.style.height) || 300,
      }),
    },
  });
  image.dispatchEvent(new documentRef.defaultView.Event("load"));
  const pointer = (type, pointerId, clientX, clientY) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: pointerId },
      pointerType: { value: "touch" },
      isPrimary: { value: pointerId === 1 },
      clientX: { value: clientX },
      clientY: { value: clientY },
    });
    return event;
  };
  content.dispatchEvent(pointer("pointerdown", 1, 100, 200));
  content.dispatchEvent(pointer("pointerdown", 2, 200, 200));
  content.dispatchEvent(pointer("pointermove", 2, 250, 200));
  const intermediateWidth = parseFloat(image.style.width);
  content.dispatchEvent(pointer("pointermove", 2, 300, 200));
  const finalWidth = parseFloat(image.style.width);

  assert.ok(intermediateWidth > 500 && intermediateWidth < 550, "a primeira ampliação deve usar uma curva suave");
  assert.ok(finalWidth > 600 && finalWidth < 650, "a ampliação absoluta deve continuar partindo da largura-base de 400px");
});

test("primeira pinça do resumo usa a base visível após a altura do aviso de carregamento mudar", async t => {
  const { preview, documentRef } = setup(t);
  await preview.open(new Blob(["resumo"], { type: "image/png" }), "resumo-confirmacao.png");
  const image = documentRef.querySelector("dialog img");
  let visibleWidth = 100;
  Object.defineProperties(image, {
    naturalWidth: { value: 1000 }, naturalHeight: { value: 4000 },
    getBoundingClientRect: { value: () => ({ width: parseFloat(image.style.width) || visibleWidth,
      height: parseFloat(image.style.height) || visibleWidth * 4 }) },
  });
  image.dispatchEvent(new documentRef.defaultView.Event("load"));
  visibleWidth = 120;
  const content = documentRef.querySelector(".attachment-preview-content");
  const pointer = (type, pointerId, clientX) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true });
    Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: "touch" },
      clientX: { value: clientX }, clientY: { value: 100 } });
    return event;
  };
  content.dispatchEvent(pointer("pointerdown", 1, 100));
  content.dispatchEvent(pointer("pointerdown", 2, 200));
  content.dispatchEvent(pointer("pointermove", 2, 300));
  assert.ok(parseFloat(image.style.width) > 180 && parseFloat(image.style.width) < 192,
    "zoom deve usar os 120px agora visíveis, não a base antiga de 100px");
});

test("pinça antes do carregamento não fixa a imagem em uma base provisória de 1px", async t => {
  const { preview, documentRef } = setup(t);
  const content = documentRef.querySelector(".attachment-preview-content");
  Object.defineProperty(content, "clientWidth", { value: 400 });
  await preview.open(new Blob(["imagem"], { type: "image/jpeg" }), "foto.jpg");
  const image = documentRef.querySelector("dialog img");
  const pointer = (type, pointerId, clientX, clientY) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: pointerId },
      pointerType: { value: "touch" },
      clientX: { value: clientX },
      clientY: { value: clientY },
    });
    return event;
  };

  content.dispatchEvent(pointer("pointerdown", 1, 100, 200));
  content.dispatchEvent(pointer("pointerdown", 2, 200, 200));
  content.dispatchEvent(pointer("pointermove", 2, 300, 200));
  assert.equal(image.style.width, "", "sem dimensões reais a imagem não deve receber uma largura provisória");

  content.dispatchEvent(pointer("pointerup", 1, 100, 200));
  content.dispatchEvent(pointer("pointerup", 2, 300, 200));
  Object.defineProperties(image, {
    naturalWidth: { value: 800 },
    naturalHeight: { value: 600 },
    getBoundingClientRect: { value: () => ({ width: 400, height: 300 }) },
  });
  image.dispatchEvent(new documentRef.defaultView.Event("load"));

  assert.ok(
    parseFloat(image.style.width) > 600 && parseFloat(image.style.width) < 650,
    "ao carregar, a imagem deve aplicar uma vez o zoom pendente sobre a largura real de 400px",
  );
});

test("fecha o visualizador ao tocar no fundo do popup", async t => {
  const { preview, documentRef, dom } = setup(t);
  await preview.open(new Blob(["imagem"], { type: "image/jpeg" }), "foto.jpg");
  const dialog = documentRef.querySelector("dialog");
  dialog.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(dialog.open, false);
});

test("vídeo e áudio abrem em controles internos antes da opção de compartilhar", async t => {
  const { preview, documentRef, revoked } = setup(t, { exportMedia: () => {} });
  await preview.open(new Blob(["video"], { type: "video/mp4" }), "obra.mp4");
  const video = documentRef.querySelector("dialog video");
  assert.ok(video);
  assert.equal(video.controls, true);
  assert.equal(video.src, "blob:preview-1");
  await preview.open(new Blob(["audio"], { type: "audio/mpeg" }), "audio.mp3");
  assert.ok(documentRef.querySelector("dialog audio"));
  assert.deepEqual(revoked, ["blob:preview-1"]);
});

test("imagem não suportada oferece exportação explícita sem sair da conversa", async t => {
  let exported;
  const { preview, documentRef, dom, revoked } = setup(t, { exportMedia: (blob, name) => { exported = { blob, name }; return "shared"; } });
  const blob = new Blob(["heic"], { type: "image/heic" });
  await preview.open(blob, "obra.heic");
  documentRef.querySelector("dialog img").dispatchEvent(new dom.window.Event("error"));
  assert.match(documentRef.querySelector("dialog").textContent, /não conseguiu mostrar esta imagem/i);
  documentRef.querySelector('[data-preview-action="export"]').click();
  assert.deepEqual(exported, { blob, name: "obra.heic" });
  assert.equal(documentRef.querySelector("dialog").open, true);
  assert.deepEqual(revoked, ["blob:preview-1"]);
});

test("texto e CSV são texto escapado e a leitura é limitada", async t => {
  let readSize;
  const { preview, documentRef } = setup(t, { maxTextBytes: 12, readText: blob => { readSize = blob.size; return blob.text(); } });
  await preview.open(new Blob(['<img src=x onerror="alert(1)">'], { type: "text/csv" }), "itens.csv");
  assert.equal(readSize, 12);
  assert.equal(documentRef.querySelector("dialog pre").textContent, "<img src=x o");
  assert.equal(documentRef.querySelector("dialog img"), null);
  assert.match(documentRef.querySelector("dialog").textContent, /início do arquivo/i);
});

test("HTML, SVG e Office nunca criam documentos executáveis no visualizador", async t => {
  const { preview, documentRef } = setup(t, { exportMedia: () => {} });
  for (const [name, type] of [["a.html", "text/html"], ["a.svg", "image/svg+xml"], ["a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]]) {
    await preview.open(new Blob(["<script>alert(1)</script>"], { type }), name);
    assert.equal(documentRef.querySelector(".attachment-preview-content iframe, .attachment-preview-content object, .attachment-preview-content embed, .attachment-preview-content script, .attachment-preview-content svg, .attachment-preview-content img"), null);
    assert.match(documentRef.querySelector("dialog").textContent, /outro app/);
  }
});

test("fechar durante importação PDF impede criação tardia do visualizador", async t => {
  let resolveLoader;
  let created = 0;
  const { preview, documentRef } = setup(t, { loadPdfPreview: () => new Promise(resolve => { resolveLoader = resolve; }) });
  const ready = preview.open(new Blob(["%PDF"], { type: "application/pdf" }), "ata.pdf");
  assert.equal(documentRef.querySelector("dialog").open, true);
  preview.close();
  resolveLoader({ createPdfPreview: () => { created++; return { ready: Promise.resolve(), destroy() {} }; } });
  await ready;
  assert.equal(created, 0);
});

test("PDF mostra páginas e tamanho no rodapé, sem a mensagem de instrução", async t => {
  const { preview, documentRef } = setup(t, {
    loadPdfPreview: async () => ({ createPdfPreview: () => ({
      ready: Promise.resolve(),
      getSummary: () => "3 páginas • 12 KB",
      destroy() {},
    }) }),
  });
  await preview.open(new Blob(["%PDF"], { type: "application/pdf" }), "ata.pdf");
  const dialog = documentRef.querySelector("dialog");
  assert.equal(dialog.querySelector(".attachment-preview-status").textContent, "100% 3 páginas • 12 KB");
  assert.doesNotMatch(dialog.textContent, /PDF aberto|Deslize para baixo/);
  assert.match(dialog.querySelector(".attachment-preview-footer").textContent, /Voltar ao chat/);
  const forwardButton = dialog.querySelector(".attachment-preview-export");
  assert.equal(forwardButton.textContent.trim(), "ENCAMINHAR");
  assert.equal(forwardButton.dataset.previewAction, "export");
  assert.equal(forwardButton.querySelector('svg[aria-hidden="true"]')?.getAttribute("viewBox"), "0 0 24 24");
});

test("PDF da galeria pode ser adicionado à barra de anexos sem encaminhar o arquivo", async t => {
  const additions = [];
  const { preview, documentRef } = setup(t, {
    loadPdfPreview: async () => ({ createPdfPreview: () => ({
      ready: Promise.resolve(),
      getSummary: () => "1 página • 1 KB",
      destroy() {},
    }) }),
  });
  const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });
  const dialog = documentRef.querySelector("dialog");

  await preview.openCollection([{ source: pdf, fileName: "comprovante.pdf" }]);
  const addButton = dialog.querySelector('[data-preview-action="add-to-tray"]');
  assert.equal(addButton.hidden, true, "a ação não aparece fora da galeria autorizada");

  await preview.openCollection([{ source: pdf, fileName: "comprovante.pdf" }], {
    onAddToTray: async item => { additions.push(item); return true; },
  });

  assert.equal(addButton.hidden, false);
  assert.equal(addButton.textContent.trim(), "📎 BARRA");
  assert.equal(addButton.getAttribute("aria-label"), "Adicionar este anexo à barra");
  const backButton = dialog.querySelector(".attachment-preview-back");
  const forwardButton = dialog.querySelector(".attachment-preview-export");
  assert.ok(backButton.compareDocumentPosition(addButton) & documentRef.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(addButton.compareDocumentPosition(forwardButton) & documentRef.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);

  addButton.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(additions, [{
    blob: pdf,
    fileName: "comprovante.pdf",
    attachments: [{ source: pdf, fileName: "comprovante.pdf" }],
  }]);
  assert.equal(dialog.open, false, "depois de adicionar, o usuário retorna ao chat");
});

test("galeria com vários anexos pergunta se deve reutilizar todos ou somente o aberto", async t => {
  const selections = [];
  const { preview, documentRef } = setup(t, {
    readText: async blob => blob.text(),
  });
  const first = new Blob(["primeiro"], { type: "text/plain" });
  const second = new Blob(["segundo"], { type: "text/plain" });
  await preview.openCollection([
    { source: first, fileName: "primeiro.txt" },
    { source: Promise.resolve(second), fileName: "segundo.txt" },
  ], { onAddToTray: selection => { selections.push(selection); return true; } });
  const dialog = documentRef.querySelector("dialog");
  const addButton = dialog.querySelector('[data-preview-action="add-to-tray"]');
  const choice = dialog.querySelector(".attachment-preview-add-choice");

  addButton.click();
  assert.equal(choice.hidden, false);
  assert.match(choice.textContent, /todos os anexos|todos/i);
  assert.match(choice.textContent, /somente este|apenas/i);
  assert.equal(selections.length, 0, "a escolha vem antes de adicionar os arquivos");

  choice.querySelector('[data-preview-action="add-all"]')?.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(selections.length, 1);
  assert.deepEqual(selections[0].attachments.map(item => item.fileName), ["primeiro.txt", "segundo.txt"]);
  const selectedSources = await Promise.all(selections[0].attachments.map(item => item.source));
  assert.deepEqual(selectedSources, [first, second]);
  assert.equal(dialog.open, false);
});

test("em coleção com vários anexos o usuário pode reutilizar apenas o arquivo aberto", async t => {
  let selection;
  const { preview, documentRef } = setup(t);
  const first = new Blob(["primeiro"], { type: "text/plain" });
  const second = new Blob(["segundo"], { type: "text/plain" });
  await preview.openCollection([
    { source: first, fileName: "primeiro.txt" },
    { source: second, fileName: "segundo.txt" },
  ], { onAddToTray: value => { selection = value; return true; } });
  const dialog = documentRef.querySelector("dialog");
  dialog.querySelector('[data-preview-action="next"]').click();
  await new Promise(resolve => setImmediate(resolve));
  dialog.querySelector('[data-preview-action="add-to-tray"]').click();
  dialog.querySelector('[data-preview-action="add-current"]').click();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(selection.attachments.length, 1);
  assert.equal(selection.attachments[0].fileName, "segundo.txt");
  assert.equal(selection.attachments[0].source, second);
  assert.equal(dialog.open, false);
});

test("galeria permite adicionar qualquer tipo de anexo à barra", async t => {
  let added;
  const { preview, documentRef } = setup(t);
  const image = new Blob(["imagem"], { type: "image/jpeg" });
  await preview.openCollection([{ source: image, fileName: "foto.jpg" }], {
    onAddToTray: item => { added = item; return true; },
  });
  const button = documentRef.querySelector('[data-preview-action="add-to-tray"]');
  assert.equal(button.hidden, false);
  assert.equal(documentRef.querySelector(".attachment-preview-add-choice").hidden, true);
  button.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(added, {
    blob: image,
    fileName: "foto.jpg",
    attachments: [{ source: image, fileName: "foto.jpg" }],
  });
  assert.equal(documentRef.querySelector("dialog").open, false);
});

test("o CSS respeita o atributo hidden do botão de adicionar", () => {
  const css = readFileSync(new URL("../src/web/attachment-preview.css", import.meta.url), "utf8");
  assert.match(css, /\.attachment-preview-dialog\s+\.attachment-preview-add-to-tray\[hidden\]\s*\{\s*display:\s*none\s*;/);
  assert.match(css, /\.attachment-preview-dialog\s+\.attachment-preview-add-choice\[hidden\]\s*\{\s*display:\s*none\s*;/);
});

test("o botão de encaminhar tem um pouco mais de largura no layout móvel", () => {
  const css = readFileSync(new URL("../src/web/attachment-preview.css", import.meta.url), "utf8");
  const mobileStyles = css.match(/@media\s*\(max-width:\s*600px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(mobileStyles, /\.attachment-preview-dialog\s+\.attachment-preview-export\s*\{[^}]*flex-grow:\s*1\.5\s*;/);
});

test("trocar PDF cancela trabalho anterior e ignora erro tardio", async t => {
  let rejectRender;
  let disposed = 0;
  let signal;
  const { preview, documentRef } = setup(t, { loadPdfPreview: async () => ({ createPdfPreview: options => {
    signal = options.signal;
    return { ready: new Promise((resolve, reject) => { rejectRender = reject; }), destroy() { disposed++; } };
  } }) });
  const ready = preview.open(new Blob(["%PDF"], { type: "application/pdf" }), "ata.pdf");
  await Promise.resolve();
  await preview.open(new Blob(["novo"], { type: "text/plain" }), "atual.txt");
  rejectRender(new Error("erro antigo"));
  await ready;
  assert.equal(signal.aborted, true);
  assert.equal(disposed, 1);
  assert.equal(documentRef.querySelector("dialog pre").textContent, "novo");
  assert.equal(documentRef.querySelector("dialog").textContent.includes("erro antigo"), false);
});

test("falha de PDF mantém opção de exportar e voltar; destroy remove a janela", async t => {
  const { preview, documentRef } = setup(t, { exportMedia: () => {}, loadPdfPreview: async () => { throw new Error("falha"); } });
  await preview.open(new Blob(["%PDF"], { type: "application/pdf" }), "ata.pdf");
  assert.match(documentRef.querySelector("dialog").textContent, /não foi possível/i);
  assert.equal(documentRef.querySelector('[data-preview-action="export"]').disabled, false);
  preview.destroy();
  assert.equal(documentRef.querySelector("dialog"), null);
});

test("navegador desktop abre o PDF no leitor nativo quando o PDF.js falha", async t => {
  const { preview, documentRef, revoked } = setup(t, {
    exportMedia: () => {},
    canEmbedPdf: () => true,
    loadPdfPreview: async () => { throw new Error("worker indisponível"); },
  });
  await preview.open(new Blob(["%PDF-1.7"], { type: "application/pdf" }), "comprovante.pdf");

  const frame = documentRef.querySelector("iframe.attachment-preview-pdf-native");
  assert.ok(frame, "o leitor nativo do navegador deve substituir a mensagem de erro");
  assert.equal(frame.title, "comprovante.pdf");
  assert.equal(frame.src, "blob:preview-1");
  assert.equal(documentRef.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '82');
  frame.dispatchEvent(new documentRef.defaultView.Event('load'));
  assert.equal(documentRef.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '100');
  assert.match(documentRef.querySelector(".attachment-preview-status").textContent, /leitor do navegador/i);
  assert.doesNotMatch(documentRef.querySelector("dialog").textContent, /não foi possível mostrar este arquivo/i);

  preview.close();
  assert.deepEqual(revoked, ["blob:preview-1"]);
});

test("arquivo da rede abre janela imediatamente e só permite exportar depois de carregar", async t => {
  let resolveDownload;
  const { preview, documentRef } = setup(t, { exportMedia: () => {} });
  const ready = preview.open(new Promise(resolve => { resolveDownload = resolve; }), "resposta.txt");
  assert.equal(documentRef.querySelector("dialog").open, true);
  assert.equal(documentRef.querySelector('[data-preview-action="export"]').disabled, true);
  assert.ok(documentRef.querySelector('dialog .app-loading__mascot'));
  assert.ok(documentRef.querySelector('dialog .app-loading__spinner'));
  resolveDownload(new Blob(["resposta baixada"], { type: "text/plain" }));
  await ready;
  assert.equal(documentRef.querySelector("dialog pre").textContent, "resposta baixada");
  assert.equal(documentRef.querySelector('[data-preview-action="export"]').disabled, false);
  assert.equal(documentRef.querySelector('dialog .app-loading'), null);
});

test("erro da rede fica na janela e resposta atrasada após fechar não altera o chat", async t => {
  let rejectDownload;
  const { preview, documentRef } = setup(t, { exportMedia: () => {} });
  await preview.open(Promise.reject(new Error("offline")), "resposta.pdf");
  assert.match(documentRef.querySelector("dialog").textContent, /não foi possível carregar/i);
  assert.equal(documentRef.querySelector('[data-preview-action="export"]').disabled, true);
  const ready = preview.open(new Promise((resolve, reject) => { rejectDownload = reject; }), "outra.pdf");
  preview.close();
  rejectDownload(new Error("falha atrasada"));
  await ready;
  assert.equal(documentRef.querySelector("dialog").open, false);
  assert.equal(documentRef.querySelector("textarea").value, "rascunho preservado");
});
for (const numPages of [3, 30]) test(`outer PDF badge stays below 100 for a usable partial ${numPages}-page preview`, async t => {
  let renderError;
  const pdf = { numPages, async getPage(number) {
    return { getViewport: ({ scale }) => ({ width: 600 * scale, height: 900 * scale }), cleanup() {},
      render: () => ({ promise: number === 2 ? Promise.reject(new Error('damaged page')) : Promise.resolve(), cancel() {} }) };
  } };
  const { preview, documentRef, dom } = setup(t, {
    loadPdfPreview: async () => ({ createPdfPreview: options => {
      const viewer = createPdfPreview({ ...options,
        loadPdfJs: async () => ({ getDocument: () => ({ promise: Promise.resolve(pdf), destroy() {} }) }) });
      viewer.ready.catch(error => { renderError = error; });
      return viewer;
    } }),
  });
  dom.reconfigure({ url: 'https://example.test/energetico/' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    clientWidth: { configurable: true, get() { return this.matches('.attachment-preview-pdf-viewport') ? 360 : 0; } },
    clientHeight: { configurable: true, get() { return this.matches('.attachment-preview-pdf-viewport') ? 600 : 0; } },
  });
  await preview.open(new Blob(['%PDF'], { type: 'application/pdf' }), 'partial.pdf', { layout: 'report-pdf' });
  const badge = documentRef.querySelector('[role=progressbar]');
  assert.ok(badge, 'retain the measured partial badge beside the explanation: ' + documentRef.querySelector('.attachment-preview-status')?.textContent + ' / ' + documentRef.querySelector('.attachment-preview-explanation')?.textContent + ' / ' + renderError?.stack);
  assert.ok(Number(badge.getAttribute('aria-valuenow')) < 100);
  assert.ok(documentRef.querySelector('.attachment-preview-pdf-canvas'));
  assert.match(documentRef.querySelector('.attachment-preview-status').textContent, /parcial|não pôde/i);
});
