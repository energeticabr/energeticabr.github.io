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
  assert.equal(container.querySelector(".signature-placement-pdf")?.getAttribute("aria-busy"), "true");
  assert.match(container.textContent, /Carregando as páginas do documento/);
  await viewer.ready;
  const canvas = container.querySelector('[data-page-number="1"] canvas');
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 20, width: 300, height: 400 }),
  });
  canvas.dispatchEvent(new container.ownerDocument.defaultView.MouseEvent("click", {
    bubbles: true,
    clientX: 85,
    clientY: 120,
  }));
  assert.equal(container.querySelectorAll("canvas").length, 2);
  assert.deepEqual(point(), { page: 1, x: 0.25, y: 0.75 });
  assert.ok(container.querySelector(".signature-placement-marker"));
  assert.equal(container.querySelector(".signature-placement-pdf")?.getAttribute("aria-busy"), "false");
  assert.equal(container.querySelector(".signature-placement-pdf-loading"), null);
});

test("mostra todas as páginas em uma coluna vertical sem navegação lateral", async t => {
  const { viewer, container } = setup(t);
  await viewer.ready;
  assert.equal(container.querySelectorAll("canvas").length, 2);
  assert.deepEqual(
    [...container.querySelectorAll(".signature-placement-page")].map(page => page.dataset.pageNumber),
    ["1", "2"],
  );
  assert.equal(container.querySelectorAll("[data-signature-placement-page]").length, 0);
  assert.equal(container.querySelector(".signature-placement-viewport")?.getAttribute("aria-label"), "Páginas do PDF; toque ou arraste a assinatura");
});

test("exibe o retângulo com nome e data abaixo da assinatura", async t => {
  const { viewer, container } = setup(t, {
    signerName: "FORNECEDOR A",
    signedAt: "2026-09-13T18:45:00-03:00",
  });
  await viewer.ready;
  const caption = container.querySelector(".signature-placement-marker__caption");
  assert.ok(caption);
  assert.match(caption.textContent, /FORNECEDOR A/);
  assert.match(caption.textContent, /DATA\/HORA/);
});

test("adiciona o carimbo de Bernardo como camada independente e informa sua posição", async t => {
  const stampBlob = new Blob(["stamp"], { type: "image/png" });
  let stamp;
  const { viewer, container } = setup(t, {
    loadStampBlob: async () => stampBlob,
    onStamp: value => { stamp = value; },
  });
  await viewer.ready;

  assert.equal(typeof viewer.addBernardoStamp, "function");
  await viewer.addBernardoStamp();

  assert.ok(container.querySelector(".signature-placement-stamp-marker"));
  assert.equal(stamp.blob, stampBlob);
  assert.equal(stamp.point.page, 1);
  assert.ok(Number.isFinite(stamp.point.x));
  assert.ok(Number.isFinite(stamp.point.y));
});

test("toque em qualquer página move a assinatura para aquela página", async t => {
  const { viewer, container, point } = setup(t);
  await viewer.ready;
  const canvas = container.querySelector('[data-page-number="2"] canvas');
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 20, width: 300, height: 400 }),
  });
  canvas.dispatchEvent(new container.ownerDocument.defaultView.MouseEvent("click", {
    bubbles: true,
    clientX: 160,
    clientY: 220,
  }));
  assert.deepEqual(point(), { page: 2, x: 0.5, y: 0.5 });
  assert.equal(container.querySelector('[data-page-number="2"] .signature-placement-marker') !== null, true);
  assert.equal(container.querySelector('[data-page-number="1"] .signature-placement-marker'), null);
});

test("arrastar a assinatura altera o ponto e informa a página atual", async t => {
  const { viewer, container, documentRef, point } = setup(t);
  await viewer.ready;
  const page = container.querySelector('[data-page-number="1"]');
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

test("arrastar com toque continua funcionando quando o dedo sai do marcador", async t => {
  const { viewer, container, documentRef, point } = setup(t);
  await viewer.ready;
  const canvas = container.querySelector('[data-page-number="1"] canvas');
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 20, width: 300, height: 400 }),
  });
  const marker = container.querySelector(".signature-placement-marker");
  const touch = (type, clientX, clientY) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", {
      value: [{ identifier: 3, clientX, clientY }],
      configurable: true,
    });
    Object.defineProperty(event, "touches", {
      value: type === "touchend" ? [] : [{ identifier: 3, clientX, clientY }],
      configurable: true,
    });
    return event;
  };
  marker.dispatchEvent(touch("touchstart", 25, 40));
  documentRef.dispatchEvent(touch("touchmove", 160, 220));
  documentRef.dispatchEvent(touch("touchend", 160, 220));
  assert.deepEqual(point(), { page: 1, x: 0.5, y: 0.5 });
});

test("arrastar aceita pointerdown seguido de touchmove no iPhone", async t => {
  const { viewer, container, documentRef, point } = setup(t);
  await viewer.ready;
  const canvas = container.querySelector('[data-page-number="1"] canvas');
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 20, width: 300, height: 400 }),
  });
  const marker = container.querySelector(".signature-placement-marker");
  const pointerDown = new documentRef.defaultView.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    pointerId: 9,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 25,
    clientY: 40,
  })) Object.defineProperty(pointerDown, key, { value, configurable: true });
  const touch = (type, clientX, clientY) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", {
      value: [{ identifier: 9, clientX, clientY }],
      configurable: true,
    });
    Object.defineProperty(event, "touches", {
      value: type === "touchend" ? [] : [{ identifier: 9, clientX, clientY }],
      configurable: true,
    });
    return event;
  };

  marker.dispatchEvent(pointerDown);
  documentRef.dispatchEvent(touch("touchmove", 160, 220));
  documentRef.dispatchEvent(touch("touchend", 160, 220));
  documentRef.dispatchEvent(touch("touchmove", 250, 300));

  assert.deepEqual(point(), { page: 1, x: 0.5, y: 0.5 });
});

test("arrastar aceita touchstart seguido de pointermove no iPhone sem salto duplicado", async t => {
  const { viewer, container, documentRef, point } = setup(t);
  await viewer.ready;
  const canvas = container.querySelector('[data-page-number="1"] canvas');
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 20, width: 300, height: 400 }),
  });
  const marker = container.querySelector(".signature-placement-marker");
  const touch = (type, clientX, clientY) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", {
      value: [{ identifier: 3, clientX, clientY }], configurable: true,
    });
    Object.defineProperty(event, "touches", {
      value: [{ identifier: 3, clientX, clientY }], configurable: true,
    });
    return event;
  };
  const pointerMove = new documentRef.defaultView.Event("pointermove", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    pointerId: 9,
    pointerType: "touch",
    isPrimary: true,
    buttons: 0,
    clientX: 160,
    clientY: 220,
  })) Object.defineProperty(pointerMove, key, { value, configurable: true });

  marker.dispatchEvent(touch("touchstart", 25, 40));
  documentRef.dispatchEvent(pointerMove);
  documentRef.dispatchEvent(touch("touchmove", 290, 380));

  assert.deepEqual(
    point(),
    { page: 1, x: 0.5, y: 0.5 },
    "o pointermove deve assumir o arraste e o touchmove duplicado não pode deslocar novamente",
  );
});

test("arraste no PDF ignora pointermove sem coordenadas antes do touchmove válido", async t => {
  const { viewer, container, documentRef, point } = setup(t);
  await viewer.ready;
  const canvas = container.querySelector('[data-page-number="1"] canvas');
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 20, width: 300, height: 400 }),
  });
  const marker = container.querySelector(".signature-placement-marker");
  const pointer = (type, values = {}) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: 9,
      pointerType: "touch",
      isPrimary: true,
      buttons: 0,
      ...values,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };
  const touchMove = new documentRef.defaultView.Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(touchMove, "changedTouches", {
    value: [{ identifier: 3, clientX: 235, clientY: 320 }], configurable: true,
  });
  Object.defineProperty(touchMove, "touches", {
    value: [{ identifier: 3, clientX: 235, clientY: 320 }], configurable: true,
  });

  marker.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 25, clientY: 40 }));
  documentRef.dispatchEvent(pointer("pointermove"));
  documentRef.dispatchEvent(touchMove);

  assert.deepEqual(point(), { page: 1, x: 0.75, y: 0.25 });
});

test("segundo dedo não assume nem encerra o arraste híbrido no iPhone", async t => {
  const { viewer, container, documentRef, point } = setup(t);
  await viewer.ready;
  const canvas = container.querySelector('[data-page-number="1"] canvas');
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 20, width: 300, height: 400 }),
  });
  const marker = container.querySelector(".signature-placement-marker");
  const pointerDown = new documentRef.defaultView.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    pointerId: 9,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 25,
    clientY: 40,
  })) Object.defineProperty(pointerDown, key, { value, configurable: true });
  const touch = (type, changed, active) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", { value: changed, configurable: true });
    Object.defineProperty(event, "touches", { value: active, configurable: true });
    return event;
  };
  const primary = { identifier: 3, clientX: 160, clientY: 220 };
  const secondary = { identifier: 4, clientX: 250, clientY: 300 };

  marker.dispatchEvent(pointerDown);
  documentRef.dispatchEvent(touch("touchmove", [secondary], [primary, secondary]));
  documentRef.dispatchEvent(touch("touchend", [secondary], [primary]));
  documentRef.dispatchEvent(touch("touchmove", [primary], [primary]));
  documentRef.dispatchEvent(touch("touchend", [primary], []));

  assert.deepEqual(point(), { page: 1, x: 0.5, y: 0.5 });
});

test("segundo dedo não herda o arraste quando o dedo principal sai primeiro", async t => {
  const { viewer, container, documentRef, point } = setup(t);
  await viewer.ready;
  const canvas = container.querySelector('[data-page-number="1"] canvas');
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 20, width: 300, height: 400 }),
  });
  const marker = container.querySelector(".signature-placement-marker");
  const pointerDown = new documentRef.defaultView.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    pointerId: 9,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 25,
    clientY: 40,
  })) Object.defineProperty(pointerDown, key, { value, configurable: true });
  const touch = (type, changed, active) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", { value: changed, configurable: true });
    Object.defineProperty(event, "touches", { value: active, configurable: true });
    return event;
  };
  const primary = { identifier: 3, clientX: 30, clientY: 45 };
  const secondary = { identifier: 4, clientX: 250, clientY: 300 };

  marker.dispatchEvent(pointerDown);
  marker.dispatchEvent(touch("touchstart", [secondary], [primary, secondary]));
  documentRef.dispatchEvent(touch("touchend", [primary], [secondary]));
  documentRef.dispatchEvent(touch("touchmove", [{ ...secondary, clientX: 280 }], [{ ...secondary, clientX: 280 }]));

  assert.equal(point(), undefined, "o segundo dedo não pode herdar e mover a assinatura");
});

test("touchend direto após pointerdown não transfere o arraste ao dedo restante", async t => {
  const { viewer, container, documentRef, point } = setup(t);
  await viewer.ready;
  const marker = container.querySelector(".signature-placement-marker");
  const pointerDown = new documentRef.defaultView.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    pointerId: 9,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 25,
    clientY: 40,
  })) Object.defineProperty(pointerDown, key, { value, configurable: true });
  const touch = (type, changed, active) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", { value: changed, configurable: true });
    Object.defineProperty(event, "touches", { value: active, configurable: true });
    return event;
  };
  const primary = { identifier: 3, clientX: 30, clientY: 45 };
  const secondary = { identifier: 4, clientX: 250, clientY: 300 };

  marker.dispatchEvent(pointerDown);
  documentRef.dispatchEvent(touch("touchend", [primary], [secondary]));
  documentRef.dispatchEvent(touch("touchmove", [{ ...secondary, clientX: 280 }], [{ ...secondary, clientX: 280 }]));

  assert.equal(point(), undefined, "o touchend direto deve encerrar o dedo que iniciou o arraste");
});

test("aumentar e reduzir a assinatura preserva a proporção do marcador", async t => {
  const { viewer, container } = setup(t);
  await viewer.ready;
  const marker = container.querySelector(".signature-placement-marker");
  assert.equal(viewer.getScale(), 0.5);
  viewer.resizeSignature(0.4);
  assert.equal(viewer.getScale(), 0.9);
  assert.equal(marker.style.getPropertyValue("--signature-scale"), "0.9");
  viewer.resizeSignature(-0.9);
  assert.equal(viewer.getScale(), 0.2);
  assert.equal(marker.style.getPropertyValue("--signature-scale"), "0.2");
});

test("os botões de tamanho atuam sobre a última assinatura tocada", async t => {
  const stampBlob = new Blob(["stamp"], { type: "image/png" });
  const { viewer, container, documentRef } = setup(t, {
    loadStampBlob: async () => stampBlob,
  });
  await viewer.ready;
  await viewer.addBernardoStamp();
  assert.equal(viewer.getScale("bernardo"), 0.5);

  const userMarker = container.querySelector(".signature-placement-marker");
  const stampMarker = container.querySelector(".signature-placement-stamp-marker");
  stampMarker.dispatchEvent(new documentRef.defaultView.MouseEvent("pointerdown", {
    bubbles: true,
    clientX: 100,
    clientY: 100,
  }));
  stampMarker.dispatchEvent(new documentRef.defaultView.MouseEvent("pointerup", {
    bubbles: true,
    clientX: 100,
    clientY: 100,
  }));
  viewer.resizeSelected(0.2);
  assert.equal(viewer.getScale("bernardo"), 0.7);
  assert.equal(stampMarker.style.getPropertyValue("--stamp-scale"), "0.7");

  const canvas = container.querySelector('[data-page-number="1"] canvas');
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 10, top: 20, width: 300, height: 400 }),
  });
  canvas.dispatchEvent(new documentRef.defaultView.MouseEvent("click", {
    bubbles: true,
    clientX: 100,
    clientY: 100,
  }));
  viewer.resizeSelected(0.2);
  const currentUserMarker = container.querySelector(".signature-placement-marker");
  assert.equal(viewer.getScale("user"), 0.7);
  assert.equal(currentUserMarker.style.getPropertyValue("--signature-scale"), "0.7");
  assert.equal(stampMarker.style.getPropertyValue("--stamp-scale"), "0.7");
});

test("a pinça aumenta a assinatura selecionada e não a outra", async t => {
  const stampBlob = new Blob(["stamp"], { type: "image/png" });
  const { viewer, container, documentRef } = setup(t, {
    loadStampBlob: async () => stampBlob,
  });
  await viewer.ready;
  await viewer.addBernardoStamp();
  const userMarker = container.querySelector(".signature-placement-marker");
  const stampMarker = container.querySelector(".signature-placement-stamp-marker");
  const pointer = (type, pointerId, clientX, clientY, isPrimary = true) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId,
      pointerType: "touch",
      isPrimary,
      clientX,
      clientY,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  userMarker.dispatchEvent(pointer("pointerdown", 1, 100, 100));
  userMarker.dispatchEvent(pointer("pointerdown", 2, 200, 100, false));
  documentRef.dispatchEvent(pointer("pointermove", 2, 300, 100, false));
  documentRef.dispatchEvent(pointer("pointerup", 1, 100, 100));
  documentRef.dispatchEvent(pointer("pointerup", 2, 300, 100, false));

  assert.equal(viewer.getScale("user"), 1);
  assert.equal(userMarker.style.getPropertyValue("--signature-scale"), "1");
  assert.equal(viewer.getScale("bernardo"), 0.5);
  assert.equal(stampMarker.style.getPropertyValue("--stamp-scale"), "0.5");
});

test("a pinça por touch nativo mantém o alvo correto no iPhone", async t => {
  const { viewer, container, documentRef } = setup(t);
  await viewer.ready;
  const marker = container.querySelector(".signature-placement-marker");
  const touch = (type, changed, active) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", { value: changed, configurable: true });
    Object.defineProperty(event, "touches", { value: active, configurable: true });
    return event;
  };
  const first = { identifier: 11, clientX: 100, clientY: 100 };
  const second = { identifier: 12, clientX: 200, clientY: 100 };

  marker.dispatchEvent(touch("touchstart", [first], [first]));
  marker.dispatchEvent(touch("touchstart", [second], [first, second]));
  documentRef.dispatchEvent(touch("touchmove", [{ ...second, clientX: 300 }], [first, { ...second, clientX: 300 }]));
  documentRef.dispatchEvent(touch("touchend", [first], [second]));
  documentRef.dispatchEvent(touch("touchend", [second], []));

  assert.equal(viewer.getScale("user"), 1);
  assert.equal(marker.style.getPropertyValue("--signature-scale"), "1");
});

test("a pinça com os dedos juntos reduz a assinatura de Bernardo selecionada", async t => {
  const stampBlob = new Blob(["stamp"], { type: "image/png" });
  const { viewer, container, documentRef } = setup(t, {
    loadStampBlob: async () => stampBlob,
  });
  await viewer.ready;
  await viewer.addBernardoStamp();
  const stampMarker = container.querySelector(".signature-placement-stamp-marker");
  const pointer = (type, pointerId, clientX, clientY, isPrimary = true) => {
    const event = new documentRef.defaultView.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId,
      pointerType: "touch",
      isPrimary,
      clientX,
      clientY,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  stampMarker.dispatchEvent(pointer("pointerdown", 1, 100, 100));
  stampMarker.dispatchEvent(pointer("pointerdown", 2, 200, 100, false));
  documentRef.dispatchEvent(pointer("pointermove", 2, 150, 100, false));
  documentRef.dispatchEvent(pointer("pointerup", 1, 100, 100));
  documentRef.dispatchEvent(pointer("pointerup", 2, 150, 100, false));

  assert.equal(viewer.getScale("bernardo"), 0.25);
  assert.equal(stampMarker.style.getPropertyValue("--stamp-scale"), "0.25");
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
  assert.equal(container.querySelector(".signature-placement-pdf")?.getAttribute("aria-busy"), "false");
});
