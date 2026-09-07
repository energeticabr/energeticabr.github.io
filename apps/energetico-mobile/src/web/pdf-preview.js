const MAX_CANVAS_PIXELS = 4_000_000;
const MAX_CANVAS_SIDE = 4096;
const MAX_PDF_BYTES = 60_000_000;

async function loadLocalPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/** Renders every page into one vertically scrollable document. */
export function createPdfPreview({
  blob,
  container,
  documentRef = globalThis.document,
  signal,
  loadPdfJs = loadLocalPdfJs,
  pixelRatio = globalThis.devicePixelRatio || 1,
  onError = () => {},
} = {}) {
  const element = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const root = element("section", "attachment-preview-pdf");
  const toolbar = element("div", "attachment-preview-pdf-toolbar");
  toolbar.setAttribute("aria-label", "Controles do PDF");
  const zoomOut = element("button", "attachment-preview-pdf-button", "−");
  const zoomIn = element("button", "attachment-preview-pdf-button", "+");
  zoomOut.type = zoomIn.type = "button";
  zoomOut.dataset.pdfAction = "zoom-out";
  zoomIn.dataset.pdfAction = "zoom-in";
  zoomOut.setAttribute("aria-label", "Reduzir PDF");
  zoomIn.setAttribute("aria-label", "Ampliar PDF");
  zoomOut.disabled = zoomIn.disabled = true;
  const pageLabel = element("output", "attachment-preview-pdf-page", "Carregando PDF…");
  pageLabel.setAttribute("aria-live", "polite");
  toolbar.append(pageLabel, zoomOut, zoomIn);
  const viewport = element("div", "attachment-preview-pdf-viewport");
  viewport.setAttribute("aria-label", "Páginas do PDF; deslize para baixo para continuar");
  viewport.setAttribute("role", "document");
  root.append(toolbar, viewport);
  container.append(root);

  let destroyed = false;
  let loadingTask = null;
  let pdf = null;
  let renderTask = null;
  let renderGeneration = 0;
  let zoom = 1;
  let busy = true;
  let renderedCanvases = [];

  function updateButtons() {
    zoomOut.disabled = busy || zoom <= 0.75;
    zoomIn.disabled = busy || zoom >= 3;
  }

  function clearRenderedPages() {
    for (const canvas of renderedCanvases) canvas.width = canvas.height = 0;
    renderedCanvases = [];
    viewport.replaceChildren();
  }

  async function renderPage(page, number, generation) {
    const natural = page.getViewport({ scale: 1 });
    if (!(natural.width > 0 && natural.height > 0 && Number.isFinite(natural.width + natural.height))) {
      throw new Error("Dimensões de página inválidas.");
    }
    const availableWidth = Math.max(1, viewport.clientWidth
      ? viewport.clientWidth - 8 : (container.clientWidth || 360) - 32);
    const displayScale = (availableWidth / natural.width) * zoom;
    const displayed = page.getViewport({ scale: displayScale });
    const outputRatio = Math.min(
      Math.max(1, Number(pixelRatio) || 1), 2,
      MAX_CANVAS_SIDE / displayed.width,
      MAX_CANVAS_SIDE / displayed.height,
      Math.sqrt(MAX_CANVAS_PIXELS / (displayed.width * displayed.height)),
    );
    const scaled = page.getViewport({ scale: displayScale * outputRatio });
    const wrapper = element("div", "attachment-preview-pdf-page");
    wrapper.dataset.pageNumber = String(number);
    const canvas = element("canvas", "attachment-preview-pdf-canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Página ${number} de ${pdf.numPages} do PDF`);
    canvas.width = Math.max(1, Math.floor(scaled.width));
    canvas.height = Math.max(1, Math.floor(scaled.height));
    canvas.style.width = `${Math.floor(displayed.width)}px`;
    canvas.style.height = `${Math.floor(displayed.height)}px`;
    wrapper.append(canvas);
    viewport.append(wrapper);
    if (destroyed || generation !== renderGeneration) {
      canvas.width = canvas.height = 0;
      wrapper.remove();
      page.cleanup();
      return false;
    }
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("O navegador não oferece canvas para este PDF.");
    renderTask = page.render({ canvasContext: context, viewport: scaled, annotationMode: 0 });
    try {
      await renderTask.promise;
    } finally {
      renderTask = null;
      page.cleanup();
    }
    if (destroyed || generation !== renderGeneration) {
      canvas.width = canvas.height = 0;
      wrapper.remove();
      return false;
    }
    renderedCanvases.push(canvas);
    return true;
  }

  async function renderAll(generation) {
    busy = true;
    updateButtons();
    root.setAttribute("aria-busy", "true");
    renderTask?.cancel();
    clearRenderedPages();
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      if (!(await renderPage(page, number, generation))) return;
    }
    if (destroyed || generation !== renderGeneration) return;
    viewport.scrollTop = viewport.scrollLeft = 0;
    pageLabel.textContent = `${pdf.numPages} páginas • deslize para baixo`;
    busy = false;
    root.setAttribute("aria-busy", "false");
    updateButtons();
  }

  function restartRender() {
    const generation = ++renderGeneration;
    renderAll(generation).catch(error => {
      if (destroyed || generation !== renderGeneration || error?.name === "RenderingCancelledException") return;
      busy = false;
      root.setAttribute("aria-busy", "false");
      updateButtons();
      onError(error);
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    renderGeneration += 1;
    signal?.removeEventListener("abort", destroy);
    renderTask?.cancel();
    clearRenderedPages();
    root.remove();
    if (loadingTask) Promise.resolve(loadingTask.destroy()).catch(() => {});
    pdf = null;
  }

  zoomOut.addEventListener("click", () => { if (!busy && zoom > 0.75) { zoom -= 0.25; restartRender(); } });
  zoomIn.addEventListener("click", () => { if (!busy && zoom < 3) { zoom += 0.25; restartRender(); } });
  signal?.addEventListener("abort", destroy, { once: true });
  if (signal?.aborted) destroy();

  const ready = (async () => {
    if (destroyed) return;
    if (blob.size > MAX_PDF_BYTES) throw new Error("Este PDF é muito grande para a pré-visualização.");
    const pdfjs = await loadPdfJs();
    if (destroyed) return;
    const data = new Uint8Array(await blob.arrayBuffer());
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
    if (destroyed) { pdf = null; return; }
    renderGeneration += 1;
    try {
      await renderAll(renderGeneration);
    } catch (error) {
      if (!destroyed) throw error;
    }
  })();

  return Object.freeze({ ready, destroy });
}
