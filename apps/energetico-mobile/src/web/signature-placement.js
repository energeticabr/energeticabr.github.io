const MAX_CANVAS_PIXELS = 2_000_000;
const MAX_CANVAS_SIDE = 4096;
const MAX_PDF_BYTES = 30 * 1024 * 1024;

function bounded(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

function pageNumber(value, total) {
  const number = Number(value);
  if (!Number.isInteger(number)) return 1;
  return Math.max(1, Math.min(total, number));
}

function pointFromEvent(canvas, event) {
  const rect = canvas.getBoundingClientRect?.() || {};
  const width = Math.max(1, Number(rect.width) || Number(canvas.clientWidth) || canvas.width || 1);
  const height = Math.max(1, Number(rect.height) || Number(canvas.clientHeight) || canvas.height || 1);
  return {
    x: bounded((Number(event.clientX) - (Number(rect.left) || 0)) / width),
    y: bounded(1 - ((Number(event.clientY) - (Number(rect.top) || 0)) / height)),
  };
}

function element(documentRef, tag, className, text) {
  const node = documentRef.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function loadLocalPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/**
 * Renders one PDF page at a time with a draggable signature preview.
 * Coordinates are normalized to the selected page, with y measured from the
 * lower-left so the same point can be applied safely by the PDF generator.
 */
export function createSignaturePlacement({
  documentBlob,
  signatureBlob,
  container,
  documentRef = globalThis.document,
  urlApi = globalThis.URL,
  selection = null,
  loadPdfJs = loadLocalPdfJs,
  onPoint = () => {},
  signal,
} = {}) {
  if (!container?.append || !documentRef?.createElement) throw new TypeError("Contêiner de posicionamento inválido.");
  const root = element(documentRef, "section", "signature-placement-pdf");
  root.setAttribute("aria-label", "Prévia do documento para posicionar a assinatura");
  const toolbar = element(documentRef, "div", "signature-placement-toolbar");
  const previous = element(documentRef, "button", "signature-placement-page-button", "‹");
  previous.type = "button";
  previous.dataset.signaturePlacementPage = "previous";
  previous.setAttribute("aria-label", "Página anterior");
  const label = element(documentRef, "span", "signature-placement-page-label", "Página 1 de 1");
  label.dataset.role = "signature-placement-page";
  const next = element(documentRef, "button", "signature-placement-page-button", "›");
  next.type = "button";
  next.dataset.signaturePlacementPage = "next";
  next.setAttribute("aria-label", "Próxima página");
  toolbar.append(previous, label, next);
  const viewport = element(documentRef, "div", "signature-placement-viewport");
  viewport.setAttribute("aria-label", "Página do PDF; toque ou arraste a assinatura");
  root.append(toolbar, viewport);
  container.append(root);

  let destroyed = false;
  let loadingTask = null;
  let pdf = null;
  let renderTask = null;
  let renderGeneration = 0;
  let currentPage = 1;
  let point = selection && Number.isFinite(Number(selection.x)) && Number.isFinite(Number(selection.y))
    ? { page: Number(selection.page) || 1, x: bounded(selection.x), y: bounded(selection.y) }
    : null;
  let signatureUrl = "";
  let activeCanvas = null;
  let activeMarker = null;
  let dragging = false;

  function updateToolbar() {
    if (!pdf) return;
    label.textContent = `Página ${currentPage} de ${pdf.numPages}`;
    previous.disabled = currentPage <= 1;
    next.disabled = currentPage >= pdf.numPages;
    root.dataset.pageNumber = String(currentPage);
  }

  function markerPoint() {
    if (point && point.page === currentPage) return point;
    return { x: 0.5, y: 0.14 };
  }

  function updateMarker(nextPoint, { emit = true } = {}) {
    const local = nextPoint ? { x: bounded(nextPoint.x), y: bounded(nextPoint.y) } : markerPoint();
    if (activeMarker) {
      activeMarker.hidden = false;
      activeMarker.style.left = `${local.x * 100}%`;
      activeMarker.style.bottom = `${local.y * 100}%`;
    }
    if (emit) {
      point = { page: currentPage, ...local };
      onPoint({ ...point });
    }
  }

  function clearPage() {
    renderTask?.cancel?.();
    renderTask = null;
    if (activeCanvas) activeCanvas.width = activeCanvas.height = 0;
    activeCanvas = null;
    activeMarker = null;
    viewport.replaceChildren();
  }

  function positionFromEvent(event) {
    if (!activeCanvas) return null;
    return pointFromEvent(activeCanvas, event);
  }

  function addMarker(page, canvas) {
    const marker = element(documentRef, "div", "signature-placement-marker");
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", "Assinatura; arraste para reposicionar");
    if (signatureUrl) {
      const image = element(documentRef, "img", "signature-placement-marker__image");
      image.alt = "Assinatura enviada";
      image.src = signatureUrl;
      image.draggable = false;
      marker.append(image);
    }
    marker.addEventListener("pointerdown", event => {
      if (destroyed) return;
      dragging = true;
      event.preventDefault?.();
      event.stopPropagation?.();
      marker.setPointerCapture?.(event.pointerId);
    });
    marker.addEventListener("pointermove", event => {
      if (!dragging || destroyed) return;
      event.preventDefault?.();
      updateMarker(positionFromEvent(event));
    });
    const release = event => {
      if (!dragging) return;
      dragging = false;
      marker.releasePointerCapture?.(event.pointerId);
    };
    marker.addEventListener("pointerup", release);
    marker.addEventListener("pointercancel", release);
    page.append(marker);
    canvas.addEventListener("click", event => {
      if (destroyed || dragging) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      updateMarker(positionFromEvent(event));
    });
    activeCanvas = canvas;
    activeMarker = marker;
    updateMarker(null, { emit: false });
  }

  async function renderCurrentPage() {
    if (!pdf || destroyed) return;
    const generation = ++renderGeneration;
    clearPage();
    updateToolbar();
    const page = await pdf.getPage(currentPage);
    if (destroyed || generation !== renderGeneration) {
      page.cleanup?.();
      return;
    }
    const natural = page.getViewport({ scale: 1 });
    if (!(natural.width > 0 && natural.height > 0 && Number.isFinite(natural.width + natural.height))) {
      page.cleanup?.();
      throw new Error("Dimensões de página inválidas.");
    }
    const availableWidth = Math.max(1, viewport.clientWidth
      ? viewport.clientWidth - 8 : (container.clientWidth || 360) - 24);
    const displayScale = availableWidth / natural.width;
    const outputRatio = Math.min(
      Math.max(1, Number(globalThis.devicePixelRatio) || 1), 2,
      MAX_CANVAS_SIDE / Math.max(1, displayScale * natural.width),
      MAX_CANVAS_SIDE / Math.max(1, displayScale * natural.height),
      Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, displayScale * displayScale * natural.width * natural.height)),
    );
    const displayed = page.getViewport({ scale: displayScale });
    const scaled = page.getViewport({ scale: displayScale * outputRatio });
    const wrapper = element(documentRef, "div", "signature-placement-page");
    wrapper.dataset.pageNumber = String(currentPage);
    const canvas = element(documentRef, "canvas", "signature-placement-canvas");
    canvas.width = Math.max(1, Math.floor(scaled.width));
    canvas.height = Math.max(1, Math.floor(scaled.height));
    canvas.style.width = `${Math.floor(displayed.width)}px`;
    canvas.style.height = `${Math.floor(displayed.height)}px`;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Página ${currentPage} de ${pdf.numPages}`);
    wrapper.append(canvas);
    viewport.append(wrapper);
    activeCanvas = canvas;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      page.cleanup?.();
      throw new Error("O navegador não oferece canvas para este PDF.");
    }
    renderTask = page.render({ canvasContext: context, viewport: scaled, annotationMode: 0 });
    try {
      await renderTask.promise;
    } finally {
      renderTask = null;
      page.cleanup?.();
    }
    if (destroyed || generation !== renderGeneration) {
      canvas.width = canvas.height = 0;
      wrapper.remove();
      return;
    }
    addMarker(wrapper, canvas);
    root.dataset.renderedPages = "1";
  }

  async function selectPage(value) {
    if (!pdf || destroyed) return;
    const nextPage = pageNumber(value, pdf.numPages);
    if (nextPage === currentPage) return;
    currentPage = nextPage;
    updateToolbar();
    try {
      await renderCurrentPage();
    } catch (error) {
      if (!destroyed) viewport.replaceChildren(element(documentRef, "p", "signature-placement-page-error", "Não foi possível mostrar esta página."));
      throw error;
    }
  }

  previous.addEventListener("click", () => { void selectPage(currentPage - 1); });
  next.addEventListener("click", () => { void selectPage(currentPage + 1); });

  const ready = (async () => {
    if (destroyed) return;
    if (!documentBlob || typeof documentBlob.arrayBuffer !== "function") throw new Error("Documento indisponível para posicionamento.");
    if (!signatureBlob || typeof signatureBlob.arrayBuffer !== "function") throw new Error("Assinatura indisponível para posicionamento.");
    if (Number(documentBlob.size) > MAX_PDF_BYTES) throw new Error("Este PDF é muito grande para a pré-visualização. Reduza o arquivo e tente novamente.");
    if (typeof urlApi?.createObjectURL === "function") signatureUrl = urlApi.createObjectURL(signatureBlob);
    const pdfjs = await loadPdfJs();
    if (destroyed) return;
    const data = new Uint8Array(await documentBlob.arrayBuffer());
    if (destroyed) return;
    const assetBase = new URL("pdfjs/", new URL(import.meta.env?.BASE_URL || "./", documentRef.baseURI));
    loadingTask = pdfjs.getDocument({
      data,
      ownerDocument: documentRef,
      cMapUrl: new URL("cmaps/", assetBase).href,
      standardFontDataUrl: new URL("standard_fonts/", assetBase).href,
      wasmUrl: new URL("wasm/", assetBase).href,
      iccUrl: new URL("iccs/", assetBase).href,
      cMapPacked: true,
      enableXfa: false,
      canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
    });
    pdf = await loadingTask.promise;
    if (destroyed) return;
    currentPage = pageNumber(point?.page || 1, pdf.numPages);
    updateToolbar();
    await renderCurrentPage();
  })();
  ready.catch(error => {
    if (destroyed) return;
    root.dataset.loadError = "true";
    viewport.replaceChildren(element(
      documentRef,
      "p",
      "signature-placement-pdf-error",
      error?.message || "Não foi possível abrir este PDF.",
    ));
  });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    renderGeneration += 1;
    signal?.removeEventListener?.("abort", destroy);
    renderTask?.cancel?.();
    clearPage();
    root.remove();
    if (loadingTask) Promise.resolve(loadingTask.destroy?.()).catch(() => {});
    if (signatureUrl) urlApi?.revokeObjectURL?.(signatureUrl);
    pdf = null;
  }

  signal?.addEventListener?.("abort", destroy, { once: true });
  if (signal?.aborted) destroy();
  return Object.freeze({
    ready,
    destroy,
    getPoint: () => (point ? { ...point } : null),
    getSummary: () => pdf ? `${pdf.numPages === 1 ? "1 página" : `${pdf.numPages} páginas`} • ${documentBlob.size} bytes` : "",
  });
}
