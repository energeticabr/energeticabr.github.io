import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { createPdfPreview } from "../src/web/pdf-preview.js";
import { installAppZoomGuard } from "../src/web/app-zoom-guard.js";

const tick = () => new Promise(resolve => setImmediate(resolve));

function scrollGeometry(container, documentRef) {
  const viewport = container.querySelector('.attachment-preview-pdf-viewport');
  Object.defineProperties(viewport, { clientWidth: { value: 360, configurable: true }, clientHeight: { value: 400, configurable: true } });
  viewport.getBoundingClientRect = () => ({ top: 20, bottom: 20 + viewport.clientHeight, left: 0, right: viewport.clientWidth, height: viewport.clientHeight });
  const original = documentRef.defaultView.HTMLElement.prototype.getBoundingClientRect;
  documentRef.defaultView.HTMLElement.prototype.getBoundingClientRect = function () {
    if (!this.matches('.attachment-preview-pdf-page')) return original.call(this);
    const index = [...this.parentElement.children].indexOf(this);
    const top = 20 + index * 424 - viewport.scrollTop;
    return { top, bottom: top + 400, left: 0, right: 360, height: 400 };
  };
  return viewport;
}

test("largura do PDF já reserva a barra vertical antes de desenhar a página", async () => {
  const css = await readFile(new URL("../src/web/attachment-preview.css", import.meta.url), "utf8");
  assert.match(css, /\.attachment-preview-pdf-viewport\s*\{[^}]*overflow-y:\s*scroll/);
});

test("prévia do PDF usa quase toda a viewport de tablets sem ficar gigante", async () => {
  const css = await readFile(new URL("../src/web/attachment-preview.css", import.meta.url), "utf8");
  assert.match(css, /\.attachment-preview-dialog\s*\{[^}]*width:\s*min\(1280px,\s*calc\(100vw\s*-\s*24px\)\)/s);
  assert.match(css, /\.attachment-preview-dialog\s*\{[^}]*height:\s*min\(1200px,\s*calc\(100dvh\s*-\s*24px\)\)/s);
  assert.match(css, /\.attachment-preview-dialog\s*\{[^}]*max-width:\s*calc\(100vw\s*-\s*24px\)/s);
  assert.match(css, /\.attachment-preview-dialog\s*\{[^}]*max-height:\s*calc\(100dvh\s*-\s*24px\)/s);
  assert.match(css, /@media\s*\(max-width:\s*600px\)[\s\S]*\.attachment-preview-dialog\s*\{[^}]*width:\s*100vw;[^}]*height:\s*100dvh/s);
});

test("prévia do PDF no celular remove o limite lateral herdado do tablet", async () => {
  const css = await readFile(new URL("../src/web/attachment-preview.css", import.meta.url), "utf8");
  assert.match(
    css,
    /@media\s*\(max-width:\s*600px\)[\s\S]*\.attachment-preview-dialog\s*\{[^}]*width:\s*100vw;[^}]*max-width:\s*100vw;[^}]*height:\s*100dvh;[^}]*max-height:\s*100dvh/s,
  );
});

function setup(t, { renderPage, ...options } = {}) {
  const dom = new JSDOM("<div id=pdf></div>", { url: "https://example.test/energetico/" });
  const documentRef = dom.window.document;
  const stopPageZoom = installAppZoomGuard(documentRef);
  const container = documentRef.querySelector("#pdf");
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  let destroyed = 0;
  let cleaned = 0;
  let input;
  const pdf = {
    numPages: 3,
    async getPage(number) {
      return {
        getViewport: ({ scale }) => ({ width: 600 * scale, height: 900 * scale }),
        render: context => renderPage?.(number, context) || { promise: Promise.resolve(), cancel() {} },
        cleanup() { cleaned++; },
      };
    },
  };
  const viewer = createPdfPreview({
    blob: new Blob(["%PDF-1.7"], { type: "application/pdf" }), container, documentRef,
    loadPdfJs: async () => ({ getDocument: options => { input = options; return { promise: Promise.resolve(pdf), destroy() { destroyed++; return Promise.resolve(); } }; } }),
    ...options,
  });
  t.after(() => { viewer.destroy(); stopPageZoom(); dom.window.close(); });
  return { viewer, container, documentRef, input: () => input, destroyed: () => destroyed, cleaned: () => cleaned };
}

test("PDF abre todas as páginas em uma coluna rolável", async t => {
  const { viewer, container, cleaned, input } = setup(t);
  await viewer.ready;
  assert.equal(container.querySelectorAll("canvas").length, 3);
  assert.equal(container.querySelectorAll("[data-page-number]").length, 3);
  assert.equal(container.querySelector(".attachment-preview-pdf-toolbar"), null);
  assert.equal(container.querySelector('[data-pdf-action="zoom-in"]'), null);
  assert.equal(container.querySelector('[data-pdf-action="zoom-out"]'), null);
  assert.match(container.querySelector(".attachment-preview-pdf-viewport").getAttribute("aria-label"), /deslize para baixo/);
  assert.equal(viewer.getSummary(), "3 páginas • 8 B");
  assert.ok(cleaned() >= 3);
  assert.deepEqual(Array.from(input().data), [37, 80, 68, 70, 45, 49, 46, 55]);
  assert.equal(input().enableXfa, false);
  assert.equal(new URL(input().cMapUrl).origin, "https://example.test");
});

test("PDF cabe na largura interna disponível do celular antes de ampliar", async t => {
  const { viewer, container } = setup(t);
  Object.defineProperty(container, "clientWidth", { value: 390 });
  Object.defineProperty(container.querySelector(".attachment-preview-pdf-viewport"), "clientWidth", { value: 349 });
  await viewer.ready;
  assert.ok(parseFloat(container.querySelector("canvas").style.width) <= 349);
});
test('report PDF fits the complete page in a landscape viewport without panning',async t=>{
 const {viewer,container}=setup(t,{fit:'page'});
 const viewport=container.querySelector('.attachment-preview-pdf-viewport');
 Object.defineProperty(viewport,'clientWidth',{value:960});Object.defineProperty(viewport,'clientHeight',{value:420});
 await viewer.ready;
 for(const canvas of container.querySelectorAll('canvas')){
  assert.ok(parseFloat(canvas.style.width)<=960);
  assert.ok(parseFloat(canvas.style.height)<=412,'the bottom of the page, including signatures, must be visible');
 }
});
test('whole-page reports navigate one complete page at a time without dragging through partial pages',async t=>{
 const {viewer,container,documentRef}=setup(t,{fit:'page'});await viewer.ready;
 const pages=[...container.querySelectorAll('[data-page-number]')];
 assert.deepEqual(pages.filter(p=>!p.hidden).map(p=>p.dataset.pageNumber),['1']);
 const next=container.querySelector('[data-pdf-action="next-page"]'),previous=container.querySelector('[data-pdf-action="previous-page"]');
 assert.equal(previous.disabled,true);next.click();assert.deepEqual(pages.filter(p=>!p.hidden).map(p=>p.dataset.pageNumber),['2']);
 assert.match(container.querySelector('[data-pdf-page-status]').textContent,/2 de 3/);
 next.click();assert.equal(next.disabled,true);previous.click();assert.deepEqual(pages.filter(p=>!p.hidden).map(p=>p.dataset.pageNumber),['2']);
 documentRef.defaultView.dispatchEvent(new documentRef.defaultView.Event('resize'));await tick();assert.match(container.querySelector('[data-pdf-page-status]').textContent,/2 de 3/);
});

test('report preview restores a requested employee page and exposes actual page navigation for signing',async t=>{
 const {viewer,container}=setup(t,{fit:'page',initialPage:2});await viewer.ready;
 assert.deepEqual([...container.querySelectorAll('[data-page-number]')].filter(p=>!p.hidden).map(p=>p.dataset.pageNumber),['2']);
 assert.equal(viewer.getCurrentPage(),2);container.querySelector('[data-pdf-action="next-page"]').click();assert.equal(viewer.getCurrentPage(),3);
 container.querySelector('[data-pdf-action="previous-page"]').click();assert.equal(viewer.getCurrentPage(),2);
});
test('whole-page PDF fit recalculates after phone rotation and releases its resize listener',async t=>{
 const {viewer,container,documentRef}=setup(t,{fit:'page'});
 const viewport=container.querySelector('.attachment-preview-pdf-viewport');let width=360,height=600;
 Object.defineProperty(viewport,'clientWidth',{get:()=>width});Object.defineProperty(viewport,'clientHeight',{get:()=>height});
 await viewer.ready;width=760;height=240;documentRef.defaultView.dispatchEvent(new documentRef.defaultView.Event('resize'));
 await tick();await tick();
 assert.ok(parseFloat(container.querySelector('canvas').style.height)<=232);
 viewer.destroy();documentRef.defaultView.dispatchEvent(new documentRef.defaultView.Event('resize'));await tick();assert.equal(container.children.length,0);
});

// Hiding sibling pages or leaving signing pinned to page 1 breaks vertical RHID reading.
test('continuous whole-page report exposes every page and follows scrolling without next buttons', async t => {
  const changes = [];
  const { viewer, container, documentRef } = setup(t, { fit: 'page', navigation: 'scroll', onPageChange: page => changes.push(page) });
  const viewport = scrollGeometry(container, documentRef);
  await viewer.ready;
  assert.deepEqual([...container.querySelectorAll('[data-page-number]')].filter(page => !page.hidden).map(page => page.dataset.pageNumber), ['1', '2', '3']);
  assert.equal(container.querySelector('[data-pdf-action="next-page"]'), null);
  assert.equal(container.querySelector('[data-pdf-action="previous-page"]'), null);
  assert.equal(viewer.getCurrentPage(), 1);
  viewport.scrollTop = 424;
  viewport.dispatchEvent(new documentRef.defaultView.Event('scroll'));
  assert.equal(viewer.getCurrentPage(), 2);
  assert.equal(changes.at(-1), 2);
  viewport.scrollTop = 848;
  viewport.dispatchEvent(new documentRef.defaultView.Event('scroll'));
  assert.equal(viewer.getCurrentPage(), 3);
  assert.equal(changes.at(-1), 3);
  const count = changes.length;
  viewer.destroy();
  viewport.dispatchEvent(new documentRef.defaultView.Event('scroll'));
  assert.equal(changes.length, count, 'closing releases the scroll callback');
});

// Reopening a signed employee and rotating must not move signing to another employee.
test('continuous report restores the requested page on opening and after a refit', async t => {
  const { viewer, container, documentRef } = setup(t, { fit: 'page', navigation: 'scroll', initialPage: 2 });
  const viewport = scrollGeometry(container, documentRef);
  await viewer.ready;
  assert.equal(viewport.scrollTop, 424);
  assert.equal(viewer.getCurrentPage(), 2);
  viewport.scrollTop = 848;
  viewport.dispatchEvent(new documentRef.defaultView.Event('scroll'));
  Object.defineProperty(viewport, 'clientHeight', { value: 350 });
  documentRef.defaultView.dispatchEvent(new documentRef.defaultView.Event('resize'));
  await tick(); await tick();
  assert.equal(viewer.getCurrentPage(), 3);
  assert.equal(viewport.scrollTop, 848);
});

test('rotation preserves the last visible employee even when new geometry favours the previous page', async t => {
  const { viewer, container, documentRef } = setup(t, { fit: 'page', navigation: 'scroll' });
  const viewport = scrollGeometry(container, documentRef);
  Object.defineProperty(viewport, 'clientHeight', { value: 600 });
  await viewer.ready;
  viewport.scrollTop = 300;
  viewport.dispatchEvent(new documentRef.defaultView.Event('scroll'));
  assert.equal(viewer.getCurrentPage(), 2);
  Object.defineProperty(viewport, 'clientWidth', { value: 760 });
  Object.defineProperty(viewport, 'clientHeight', { value: 200 });
  documentRef.defaultView.dispatchEvent(new documentRef.defaultView.Event('resize'));
  await tick(); await tick();
  assert.equal(viewer.getCurrentPage(), 2, 'orientation must not change the employee selected for signing');
  assert.equal(viewport.scrollTop, 424);
});

test('pending viewport changes disable signing and cannot overwrite the tracked employee before refitting', async t => {
  const changes = [];
  const { viewer, container, documentRef } = setup(t, { fit: 'page', navigation: 'scroll', onPageChange: page => changes.push(page) });
  const viewport = scrollGeometry(container, documentRef);
  Object.defineProperty(viewport, 'clientHeight', { value: 600 });
  await viewer.ready;
  viewport.scrollTop = 300;
  viewport.dispatchEvent(new documentRef.defaultView.Event('scroll'));
  assert.equal(viewer.getCurrentPage(), 2);
  Object.defineProperty(viewport, 'clientHeight', { value: 200 });
  assert.equal(viewer.getCurrentPage(), null, 'stale page geometry cannot be used for signing');
  viewport.dispatchEvent(new documentRef.defaultView.Event('scroll'));
  assert.equal(changes.at(-1), null);
  documentRef.defaultView.dispatchEvent(new documentRef.defaultView.Event('resize'));
  assert.equal(viewer.getCurrentPage(), null, 'signing remains disabled while rendering');
  await tick(); await tick();
  assert.equal(viewer.getCurrentPage(), 2);
  assert.equal(changes.at(-1), 2);
});

test('a failed last employee page keeps signing disabled even with actual browser scroll limits', async t => {
  const changes = [];
  const { viewer, container, documentRef } = setup(t, { fit: 'page', navigation: 'scroll', initialPage: 2,
    pageFilter: number => number <= 2, onPageChange: page => changes.push(page),
    renderPage: number => number === 2 ? { promise: Promise.reject(new Error('damaged')), cancel() {} } : undefined });
  const viewport = container.querySelector('.attachment-preview-pdf-viewport');
  Object.defineProperties(viewport, { clientWidth: { value: 360 }, clientHeight: { value: 600 } });
  viewport.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 });
  const heightOf = node => node.matches('.attachment-preview-pdf-page--error')
    ? Math.max(120, parseFloat(node.style.minHeight) || 0) : parseFloat(node.querySelector('canvas').style.height);
  let scrollTop = 0;
  Object.defineProperty(viewport, 'scrollTop', { get: () => scrollTop, set: value => {
    const pages = [...container.querySelectorAll('[data-page-number]')];
    const total = pages.reduce((sum, node) => sum + heightOf(node), 0) + Math.max(0, pages.length - 1) * 24;
    scrollTop = Math.min(Math.max(0, value), Math.max(0, total - viewport.clientHeight));
  } });
  const original = documentRef.defaultView.HTMLElement.prototype.getBoundingClientRect;
  documentRef.defaultView.HTMLElement.prototype.getBoundingClientRect = function () {
    if (!this.matches('.attachment-preview-pdf-page')) return original.call(this);
    const pages = [...this.parentElement.children], index = pages.indexOf(this);
    const top = pages.slice(0, index).reduce((sum, node) => sum + heightOf(node) + 24, 0) - viewport.scrollTop;
    return { top, bottom: top + heightOf(this), height: heightOf(this) };
  };
  await viewer.ready;
  assert.equal(viewer.getCurrentPage(), null, 'a short failed last page must not select its healthy neighbour');
  assert.equal(changes.at(-1), null);
  assert.match(container.querySelector('[data-pdf-page-status]').textContent, /2 de 2/);
});

// Failed pages cannot borrow the neighbouring employee's rendered canvas for signing.
test('scrolling to a failed report page disables signing and scrolling back restores it', async t => {
  const changes = [];
  const { viewer, container, documentRef } = setup(t, { fit: 'page', navigation: 'scroll', onPageChange: page => changes.push(page),
    renderPage: number => number === 2 ? { promise: Promise.reject(new Error('damaged')), cancel() {} } : undefined });
  const viewport = scrollGeometry(container, documentRef);
  await viewer.ready;
  viewport.scrollTop = 424; viewport.dispatchEvent(new documentRef.defaultView.Event('scroll'));
  assert.equal(viewer.getCurrentPage(), null);
  assert.equal(changes.at(-1), null);
  viewport.scrollTop = 0; viewport.dispatchEvent(new documentRef.defaultView.Event('scroll'));
  assert.equal(viewer.getCurrentPage(), 1);
  assert.equal(changes.at(-1), 1);
});

test("PDF amplia ao afastar dois dedos no visualizador", async t => {
  const { viewer, container, documentRef } = setup(t);
  await viewer.ready;
  const viewport = container.querySelector(".attachment-preview-pdf-viewport");
  const initialWidth = parseFloat(container.querySelector("canvas").style.width);
  Object.defineProperty(viewport, "getBoundingClientRect", { value: () => ({ left: 0, top: 0 }) });
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
  viewport.dispatchEvent(pointer("pointerdown", 1, 100, 300));
  viewport.dispatchEvent(pointer("pointerdown", 2, 200, 300));
  viewport.dispatchEvent(pointer("pointermove", 2, 300, 300));
  assert.ok(parseFloat(container.querySelector("canvas").style.width) > initialWidth);
});

test("PDF mantém canvas abaixo de 4 milhões de pixels e libera memória ao destruir", async t => {
  const { viewer, container, destroyed } = setup(t, { pixelRatio: 4 });
  Object.defineProperty(container, "clientWidth", { value: 8000 });
  await viewer.ready;
  const canvas = container.querySelector("canvas");
  assert.ok(canvas.width * canvas.height <= 4_000_000);
  assert.ok(canvas.width <= 4096 && canvas.height <= 4096);
  viewer.destroy();
  assert.equal(canvas.width * canvas.height, 0);
  assert.equal(container.children.length, 0);
  assert.equal(destroyed(), 1);
});

test("fechamento durante renderização cancela tarefa e não mostra erro", async t => {
  let cancelCount = 0;
  let errors = 0;
  const abort = new AbortController();
  const { viewer, container, destroyed } = setup(t, { signal: abort.signal, onError: () => errors++, renderPage: () => {
    let reject;
    return { promise: new Promise((resolve, fail) => { reject = fail; }), cancel() { cancelCount++; reject(Object.assign(new Error("cancelado"), { name: "RenderingCancelledException" })); } };
  } });
  await tick();
  abort.abort();
  await viewer.ready;
  assert.equal(cancelCount, 1);
  assert.equal(destroyed(), 1);
  assert.equal(container.children.length, 0);
  assert.equal(errors, 0);
});

test("fechar antes da biblioteca chegar impede iniciar leitura ou worker", async t => {
  let resolveLibrary;
  let created = 0;
  const { viewer, container } = setup(t, { loadPdfJs: () => new Promise(resolve => { resolveLibrary = resolve; }) });
  viewer.destroy();
  resolveLibrary({ getDocument() { created++; } });
  await viewer.ready;
  assert.equal(created, 0);
  assert.equal(container.children.length, 0);
});

test("PDF inválido rejeita prontidão para a janela exibir a alternativa", async t => {
  const { viewer } = setup(t, { loadPdfJs: async () => ({ getDocument: () => ({ promise: Promise.reject(new Error("Invalid PDF")), destroy() {} }) }) });
  await assert.rejects(viewer.ready, /Invalid PDF/);
});

test("erro em uma página não fecha o PDF e sinaliza somente a página afetada", async t => {
  const { viewer, container } = setup(t, { renderPage: number => {
    if (number === 2) return { promise: Promise.reject(new Error("Página danificada")), cancel() {} };
  } });
  await viewer.ready;
  assert.equal(container.querySelectorAll("canvas").length, 2);
  assert.match(container.querySelector(".attachment-preview-pdf-page--error").textContent, /página 2/i);
  assert.match(viewer.getSummary(), /1 página não pôde ser exibida/);
});
