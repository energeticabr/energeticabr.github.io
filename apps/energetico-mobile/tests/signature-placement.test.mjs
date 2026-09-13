import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createSignaturePlacement } from "../src/web/signature-placement.js";

function setup(t, options = {}) {
  const dom = new JSDOM("<div id=placement></div>", { url: "https://example.test/energetico/" });
  const documentRef = dom.window.document;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    drawImage() {},
  });
  const container = documentRef.querySelector("#placement");
  let point;
  const viewer = createSignaturePlacement({
    documentBlob: new Blob(["%PDF"], { type: "application/pdf" }),
    signatureBlob: new Blob(["png"], { type: "image/png" }),
    container,
    documentRef,
    loadPdfJs: async () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 2,
          async getPage(number) {
            return {
              getViewport: ({ scale }) => ({ width: 300 * scale, height: 400 * scale }),
              render: () => ({ promise: Promise.resolve(), cancel() {} }),
              cleanup() {},
              number,
            };
          },
        }),
        destroy() {},
      }),
    }),
    onPoint: value => { point = value; },
    ...options,
  });
  t.after(() => { viewer.destroy(); dom.window.close(); });
  return { viewer, container, documentRef, point: () => point };
}

test("renderiza as páginas do PDF e converte o toque em coordenadas proporcionais", async t => {
  const { viewer, container, point } = setup(t);
  await viewer.ready;
  const canvas = container.querySelector("canvas");
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 20, width: 300, height: 400 }),
  });
  canvas.dispatchEvent(new container.ownerDocument.defaultView.MouseEvent("click", {
    bubbles: true,
    clientX: 85,
    clientY: 120,
  }));
  assert.equal(container.querySelectorAll("canvas").length, 1);
  assert.deepEqual(point(), { page: 1, x: 0.25, y: 0.75 });
  assert.ok(container.querySelector(".signature-placement-marker"));
});

test("mantém somente uma página renderizada e permite navegar até outra página", async t => {
  const { viewer, container } = setup(t);
  await viewer.ready;
  assert.equal(container.querySelectorAll("canvas").length, 1);
  assert.equal(container.querySelector("[data-page-number]")?.dataset.pageNumber, "1");
  const next = container.querySelector('[data-signature-placement-page="next"]');
  next.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(container.querySelectorAll("canvas").length, 1);
  assert.equal(container.querySelector("[data-page-number]")?.dataset.pageNumber, "2");
});

test("arrastar a assinatura altera o ponto e informa a página atual", async t => {
  const { viewer, container, documentRef, point } = setup(t);
  await viewer.ready;
  const page = container.querySelector("[data-page-number]");
  const canvas = page.querySelector("canvas");
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 20, width: 300, height: 400 }),
  });
  const marker = container.querySelector(".signature-placement-marker");
  marker.dispatchEvent(new documentRef.defaultView.MouseEvent("pointerdown", {
    bubbles: true,
    clientX: 25,
    clientY: 40,
  }));
  marker.dispatchEvent(new documentRef.defaultView.MouseEvent("pointermove", {
    bubbles: true,
    clientX: 160,
    clientY: 220,
  }));
  marker.dispatchEvent(new documentRef.defaultView.MouseEvent("pointerup", {
    bubbles: true,
    clientX: 160,
    clientY: 220,
  }));
  assert.deepEqual(point(), { page: 1, x: 0.5, y: 0.5 });
});

test("mostra o erro do PDF no painel sem deixar uma área vazia", async t => {
  const { viewer, container } = setup(t, {
    loadPdfJs: async () => ({
      getDocument: () => ({ promise: Promise.reject(new Error("PDF inválido")), destroy() {} }),
    }),
  });
  await assert.rejects(viewer.ready, /PDF inválido/);
  assert.match(container.textContent, /PDF inválido/);
  assert.ok(container.querySelector(".signature-placement-pdf-error"));
});
