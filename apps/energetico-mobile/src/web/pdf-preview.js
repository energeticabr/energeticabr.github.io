const MAX_CANVAS_PIXELS = 4_000_000;
const MAX_CANVAS_SIDE = 4096;
const MAX_PDF_BYTES = 60_000_000;

async function loadLocalPdfJs() {
  // The legacy build includes browser compatibility polyfills for older iPhones.
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/** A single cancellable canvas: page changes release the previous page's resources. */
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
  toolbar.setAttribute("aria-label", "Navegação do PDF");
  const button = (action, text) => {
    const node = element("button", "attachment-preview-pdf-button", text);
    node.type = "button";
    node.dataset.pdfAction = action;
    node.disabled = true;
    return node;
  };
  const previous = button("previous", "Anterior");
  const next = button("next", "Próxima");
  const zoomOut = button("zoom-out", "−");
  const zoomIn = button("zoom-in", "+");
  zoomOut.setAttribute("aria-label", "Reduzir PDF");
  zoomIn.setAttribute("aria-label", "Ampliar PDF");
  const pageLabel = element("output", "attachment-preview-pdf-page", "Carregando PDF…");
  pageLabel.setAttribute("aria-live", "polite");
  toolbar.append(previous, pageLabel, next, zoomOut, zoomIn);
  const viewport = element("div", "attachment-preview-pdf-viewport");
  const canvas = element("canvas", "attachment-preview-pdf-canvas");
  canvas.setAttribute("role", "img");
  viewport.append(canvas);
  root.append(toolbar, viewport);
  container.append(root);
  let destroyed = false;
  let loadingTask = null;
  let pdf = null;
  let currentPage = null;
  let renderTask = null;
  let pageNumber = 1;
  let zoom = 1;
  let busy = true;

  function updateButtons() {
    previous.disabled = busy || pageNumber <= 1;
    next.disabled = busy || !pdf || pageNumber >= pdf.numPages;
    zoomOut.disabled = busy || zoom <= 0.75;
    zoomIn.disabled = busy || zoom >= 3;
  }

  async function render(number) {
    if (destroyed) return;
    busy = true;
    updateButtons();
    root.setAttribute("aria-busy", "true");
    currentPage?.cleanup();
    currentPage = null;
    // Reset before acquiring another page to avoid retaining two page surfaces.
    canvas.width = canvas.height = 0;
    const page = await pdf.getPage(number);
    if (destroyed) { page.cleanup(); return; }
    currentPage = page;
    const natural = page.getViewport({ scale: 1 });
    if (!(natural.width > 0 && natural.height > 0 && Number.isFinite(natural.width + natural.height))) throw new Error("Dimensões de página inválidas.");
    const availableWidth = Math.max(1, viewport.clientWidth ? viewport.clientWidth - 8 : (container.clientWidth || 360) - 32);
    const displayScale = (availableWidth / natural.width) * zoom;
    const displayed = page.getViewport({ scale: displayScale });
    const outputRatio = Math.min(
      Math.max(1, Number(pixelRatio) || 1), 2,
      MAX_CANVAS_SIDE / displayed.width,
      MAX_CANVAS_SIDE / displayed.height,
      Math.sqrt(MAX_CANVAS_PIXELS / (displayed.width * displayed.height)),
    );
    const scaled = page.getViewport({ scale: displayScale * outputRatio });
    canvas.width = Math.max(1, Math.floor(scaled.width));
    canvas.height = Math.max(1, Math.floor(scaled.height));
    canvas.style.width = `${Math.floor(displayed.width)}px`;
    canvas.style.height = `${Math.floor(displayed.height)}px`;
    canvas.setAttribute("aria-label", `Página ${number} de ${pdf.numPages} do PDF`);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("O navegador não oferece canvas para este PDF.");
    // Only page graphics are rendered: no links, forms, scripts, or embedded HTML.
    renderTask = page.render({ canvasContext: context, viewport: scaled, annotationMode: 0 });
    try {
      await renderTask.promise;
    } finally {
      renderTask = null;
      if (destroyed) page.cleanup();
    }
    if (destroyed) return;
    pageNumber = number;
    pageLabel.textContent = `Página ${number} de ${pdf.numPages}`;
    viewport.scrollTop = viewport.scrollLeft = 0;
    busy = false;
    root.setAttribute("aria-busy", "false");
    updateButtons();
  }

  function changePage(number, nextZoom = zoom) {
    if (busy || destroyed || !pdf || number < 1 || number > pdf.numPages) return;
    zoom = nextZoom;
    render(number).catch(error => {
      if (destroyed) return;
      busy = false;
      root.setAttribute("aria-busy", "false");
      updateButtons();
      onError(error);
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    signal?.removeEventListener("abort", destroy);
    renderTask?.cancel();
    if (!renderTask) currentPage?.cleanup();
    canvas.width = canvas.height = 0;
    root.remove();
    // destroy() also terminates the dedicated worker and pending document requests.
    if (loadingTask) Promise.resolve(loadingTask.destroy()).catch(() => {});
    pdf = null;
  }

  previous.addEventListener("click", () => changePage(pageNumber - 1));
  next.addEventListener("click", () => changePage(pageNumber + 1));
  zoomOut.addEventListener("click", () => changePage(pageNumber, Math.max(0.75, zoom - 0.25)));
  zoomIn.addEventListener("click", () => changePage(pageNumber, Math.min(3, zoom + 0.25)));
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
    await render(1);
  })().catch(error => { if (!destroyed) throw error; });

  return Object.freeze({ ready, destroy });
}
