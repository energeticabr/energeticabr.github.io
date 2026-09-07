// Several canvases stay alive while the user scrolls. A lower per-page cap
// avoids Safari/iOS dropping the whole preview when a PDF has many pages.
const MAX_CANVAS_PIXELS = 2_000_000;
const MAX_CANVAS_SIDE = 4096;
const MAX_PDF_BYTES = 60_000_000;

function formatBytes(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size;
  let unit = "B";
  for (const candidate of units) {
    value /= 1024;
    unit = candidate;
    if (value < 1024 || candidate === units.at(-1)) break;
  }
  const rounded = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${Number(rounded).toLocaleString("pt-BR")} ${unit}`;
}

function pageCountLabel(count) {
  return count === 1 ? "1 página" : `${count} páginas`;
}

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
  const viewport = element("div", "attachment-preview-pdf-viewport");
  viewport.setAttribute("aria-label", "Páginas do PDF; deslize para baixo para continuar");
  viewport.setAttribute("role", "document");
  root.append(viewport);
  container.append(root);

  let destroyed = false;
  let loadingTask = null;
  let pdf = null;
  let renderTask = null;
  let renderGeneration = 0;
  let busy = true;
  let renderedCanvases = [];

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
    const displayScale = availableWidth / natural.width;
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
    } catch (error) {
      canvas.width = canvas.height = 0;
      wrapper.remove();
      throw error;
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
    root.setAttribute("aria-busy", "true");
    renderTask?.cancel();
    clearRenderedPages();
    let failedPages = 0;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      try {
        const page = await pdf.getPage(number);
        if (!(await renderPage(page, number, generation))) return;
      } catch (error) {
        if (destroyed || generation !== renderGeneration || error?.name === "RenderingCancelledException") return;
        failedPages += 1;
        const wrapper = element("div", "attachment-preview-pdf-page attachment-preview-pdf-page--error");
        wrapper.dataset.pageNumber = String(number);
        wrapper.append(element("p", "attachment-preview-pdf-page-error", `Não foi possível mostrar a página ${number}.`));
        viewport.append(wrapper);
      }
    }
    if (destroyed || generation !== renderGeneration) return;
    viewport.scrollTop = viewport.scrollLeft = 0;
    root.dataset.failedPages = String(failedPages);
    busy = false;
    root.setAttribute("aria-busy", "false");
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

  return Object.freeze({
    ready,
    destroy,
    getSummary: () => {
      if (!pdf) return "";
      const failed = Number(root.dataset.failedPages || 0);
      const warning = failed > 0
        ? ` • ${failed} ${failed === 1 ? "página não pôde ser exibida" : "páginas não puderam ser exibidas"}`
        : "";
      return `${pageCountLabel(pdf.numPages)} • ${formatBytes(blob.size)}${warning}`;
    },
  });
}
