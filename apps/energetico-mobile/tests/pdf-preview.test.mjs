import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { createPdfPreview } from "../src/web/pdf-preview.js";

const tick = () => new Promise(resolve => setImmediate(resolve));

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
  t.after(() => { viewer.destroy(); dom.window.close(); });
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
