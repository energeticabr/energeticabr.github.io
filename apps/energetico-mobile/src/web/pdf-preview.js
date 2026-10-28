import { createPinchZoom } from "./pinch-zoom.js";
import { beginLoadingTask } from "../ui/loading-task.js";
import { readDdaCopyAction, positionDdaCopyButton } from './dda-pdf-copy.js';
import { copyDdaText } from '../ui/dda-card.js';

// Several canvases stay alive while the user scrolls. A lower per-page cap
// avoids Safari/iOS dropping the whole preview when a PDF has many pages.
const MAX_CANVAS_PIXELS = 2_000_000;
const MAX_CANVAS_SIDE = 4096;
const MAX_PDF_BYTES = 60_000_000;
const WINDOWED_PAGE_THRESHOLD = 12;

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

/** Renders a scrollable document, or a complete page with report navigation. */
export function createPdfPreview({
  blob,
  container,
  documentRef = globalThis.document,
  signal,
  loadPdfJs = loadLocalPdfJs,
  pixelRatio = globalThis.devicePixelRatio || 1,
  fit = 'width',
  navigation = 'paged',
  initialPage = 1,
  pageFilter = () => true,
  onPageChange = () => {},
  onError = () => {},
  onProgress,
  onDdaCopyReady = () => {},
} = {}) {
  const element = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const root = element("section", "attachment-preview-pdf");
  root.dataset.fit = fit;
  const continuous = fit !== 'page' || navigation === 'scroll';
  root.dataset.navigation = continuous ? 'scroll' : 'paged';
  const viewport = element("div", "attachment-preview-pdf-viewport");
  const surface = element("div", "attachment-preview-pdf-surface");
  viewport.setAttribute("aria-label", "Páginas do PDF; deslize para baixo ou use dois dedos para ampliar");
  viewport.setAttribute("role", "document");
  viewport.append(surface);
  root.append(viewport);
  let pageNavigation = null, previousPageButton = null, nextPageButton = null, pageStatus = null;
  let pageNumbers = [], pageIndex = 0;
  if (fit === 'page' && !continuous) {
    viewport.setAttribute('aria-label', 'Página inteira do PDF; use Anterior e Próxima ou dois dedos para ampliar');
    pageNavigation = element('nav', 'attachment-preview-pdf-navigation');
    pageNavigation.setAttribute('aria-label', 'Páginas do relatório');pageNavigation.hidden = true;
    previousPageButton = element('button', '', '‹ Anterior');nextPageButton = element('button', '', 'Próxima ›');
    previousPageButton.type = nextPageButton.type = 'button';
    previousPageButton.dataset.pdfAction = 'previous-page';nextPageButton.dataset.pdfAction = 'next-page';
    pageStatus = element('span');pageStatus.dataset.pdfPageStatus = '';pageStatus.setAttribute('aria-live', 'polite');
    pageNavigation.append(previousPageButton, pageStatus, nextPageButton);root.append(pageNavigation);
    previousPageButton.addEventListener('click', () => movePage(-1));nextPageButton.addEventListener('click', () => movePage(1));
  } else if (fit === 'page') {
    pageStatus = element('p', 'attachment-preview-pdf-position');
    pageStatus.dataset.pdfPageStatus = '';pageStatus.setAttribute('aria-live', 'polite');root.append(pageStatus);
  }
  container.append(root);
  const copyNotice = element('p', 'attachment-preview-dda-copy-notice');
  copyNotice.setAttribute('role', 'status');root.append(copyNotice);
  let ddaAction = null, ddaRead = null, copyPending = false;
  async function copyDdaBarcode() {
    if (destroyed || !ddaAction || copyPending) return false;
    copyPending = true;
    try {
      await copyDdaText(documentRef, ddaAction.barcode);
      if (!destroyed) copyNotice.textContent = 'Código de barras copiado (44 dígitos).';
      return true;
    } catch {
      if (!destroyed) copyNotice.textContent = 'Não foi possível copiar. Use outro leitor para selecionar o código.';
      return false;
    } finally { copyPending = false; }
  }

  let destroyed = false;
  let loadingTask = null;
  let pdf = null;
  let renderTask = null;
  let renderGeneration = 0;
  let busy = true;
  let renderedCanvases = [];
  let windowed = false, slotsReady = false, pageSlots = [], pendingPageIndex = null, windowTask = null;
  const failedPageNumbers = new Set();
  const windowRef = documentRef.defaultView;
  let resizeObserver = null;
  let fittedSize = '';
  let reportedPage = null;
  const viewportSize = () => `${viewport.clientWidth}:${viewport.clientHeight}`;
  let progressDetail = { phase: 'prepared' };
  const progress = beginLoadingTask(value => onProgress?.({ ...value, ...progressDetail }), {
    signal, isCurrent: () => !destroyed,
  });
  const reportProgress = (completed, detail) => {
    progressDetail = detail;
    // Import, read, parse, page discovery, and the requested page renders.
    progress.units(completed, 5);
  };
  function finishProgress(generation) {
    if (destroyed || generation !== renderGeneration || busy || viewportSize() !== fittedSize || pendingPageIndex !== null) return;
    if (!renderedCanvases.length) { progress.stop(); return; }
    if (Number(root.dataset.failedPages || 0) > 0) {
      progressDetail = { ...progressDetail, phase: 'partial', failedPages: Number(root.dataset.failedPages) };
      progress.acquired();
      progress.stop();
      return;
    }
    progress.acquired();
    progressDetail = { ...progressDetail, phase: 'ready' };
    progress.complete();
  }

  function visiblePageIndex() {
    const bounds = viewport.getBoundingClientRect();
    const bottom = bounds.bottom ?? bounds.top + viewport.clientHeight;
    let mostVisible = 0, index = pageIndex;
    for (const node of surface.children) {
      const pageBounds = node.getBoundingClientRect();
      const visible = Math.max(0, Math.min(bottom, pageBounds.bottom) - Math.max(bounds.top, pageBounds.top));
      if (visible > mostVisible) { mostVisible = visible; index = pageNumbers.indexOf(Number(node.dataset.pageNumber)); }
    }
    return index;
  }

  function getCurrentPage() {
    if (destroyed || busy) return null;
    // A resize changes intersections before the canvases are refitted. Keep
    // the last stable employee and disable signing until its page is restored.
    if (fit === 'page' && viewportSize() !== fittedSize) return null;
    if (continuous) {
      pageIndex = visiblePageIndex();
    }
    const number = pageNumbers[pageIndex] || 1;
    return !destroyed && !busy && renderedCanvases.some(canvas => Number(canvas.parentElement?.dataset.pageNumber) === number) ? number : null;
  }

  function showCurrentPage() {
    if (destroyed) return;
    if (windowed && slotsReady && viewportSize() === fittedSize) {
      if (continuous) pageIndex = visiblePageIndex();
      if (windowIndices(pageIndex).some(index => !pageSlots[index].node.querySelector('canvas') && !failedPageNumbers.has(pageSlots[index].number))) {
        void queuePageWindow().catch(error => { if (!destroyed) onError(error); });
      }
    }
    if (!continuous) {
      pageNavigation.hidden = pageNumbers.length <= 1;
      previousPageButton.disabled = pageIndex <= 0;
      nextPageButton.disabled = pageIndex >= pageNumbers.length - 1;
      for (const node of surface.children) node.hidden = Number(node.dataset.pageNumber) !== pageNumbers[pageIndex];
      viewport.scrollTop = viewport.scrollLeft = 0;
    }
    const currentPage = getCurrentPage();
    if (pageStatus) pageStatus.textContent = `${pageIndex + 1} de ${pageNumbers.length}`;
    if (currentPage !== reportedPage) { reportedPage = currentPage; onPageChange(currentPage); }
  }
  viewport.addEventListener('scroll', showCurrentPage, { passive: true });
  function movePage(delta) {
    if (destroyed || busy) return;
    pageIndex = Math.max(0, Math.min(pageNumbers.length - 1, pageIndex + delta));showCurrentPage();
  }

  function applyZoom(value, { previousZoom = 1, midpoint, ratio = 1 } = {}) {
    const bounded = Math.min(4, Math.max(1, Number(value) || 1));
    const viewportWidth = Math.max(1, viewport.clientWidth || container.clientWidth || 360);
    if (windowed) {
      for (const slot of pageSlots) {
        slot.node.style.height = `${Math.round(slot.height * bounded)}px`;
        slot.node.style.width = bounded > 1 ? `${Math.max(viewportWidth, slot.width * bounded)}px` : '';
      }
    }
    const canvases = [...surface.querySelectorAll(".attachment-preview-pdf-canvas")];
    let surfaceWidth = viewportWidth;
    for (const canvas of canvases) {
      const baseWidth = Number(canvas.dataset.baseWidth || parseFloat(canvas.style.width)) || 1;
      const baseHeight = Number(canvas.dataset.baseHeight || parseFloat(canvas.style.height)) || 1;
      const width = baseWidth * bounded;
      const height = baseHeight * bounded;
      canvas.style.width = `${Math.round(width)}px`;
      canvas.style.height = `${Math.round(height)}px`;
      const copyButton = canvas.parentElement?.querySelector('.attachment-preview-dda-copy-overlay');
      if (copyButton && ddaAction) positionDdaCopyButton(copyButton, canvas, ddaAction.rect);
      if (canvas.parentElement) canvas.parentElement.style.width = `${Math.max(viewportWidth, width)}px`;
      surfaceWidth = Math.max(surfaceWidth, width);
    }
    surface.style.width = bounded > 1 ? `${Math.round(surfaceWidth)}px` : "";
    if (bounded <= 1) {
      for (const canvas of canvases) if (canvas.parentElement) canvas.parentElement.style.width = "";
    }
    if (bounded !== previousZoom && midpoint && ratio > 0) {
      const bounds = viewport.getBoundingClientRect?.() || { left: 0, top: 0 };
      const x = Number(midpoint.clientX) - Number(bounds.left || 0);
      const y = Number(midpoint.clientY) - Number(bounds.top || 0);
      viewport.scrollLeft = Math.max(0, (viewport.scrollLeft + x) * ratio - x);
      viewport.scrollTop = Math.max(0, (viewport.scrollTop + y) * ratio - y);
    }
  }

  const pinchZoom = createPinchZoom({ element: viewport, documentRef, onZoom: applyZoom });

  function clearRenderedPages() {
    // Include a canvas whose render promise is still pending, not just the
    // completed pages. A quick close/reopen must not double graphics memory.
    for (const canvas of surface.querySelectorAll('canvas')) canvas.width = canvas.height = 0;
    renderedCanvases = [];
    surface.replaceChildren();
    slotsReady = false; pageSlots = []; pendingPageIndex = null;
  }

  async function renderPage(page, number, generation, existingWrapper) {
    const natural = page.getViewport({ scale: 1 });
    if (!(natural.width > 0 && natural.height > 0 && Number.isFinite(natural.width + natural.height))) {
      throw new Error("Dimensões de página inválidas.");
    }
    const availableWidth = Math.max(1, viewport.clientWidth
      ? viewport.clientWidth - 8 : (container.clientWidth || 360) - 32);
    const availableHeight = Math.max(1, viewport.clientHeight - 8);
    const displayScale = fit === 'page' && viewport.clientHeight > 0
      ? Math.min(availableWidth / natural.width, availableHeight / natural.height)
      : availableWidth / natural.width;
    const displayed = page.getViewport({ scale: displayScale });
    const outputRatio = Math.min(
      Math.max(1, Number(pixelRatio) || 1), 2,
      MAX_CANVAS_SIDE / displayed.width,
      MAX_CANVAS_SIDE / displayed.height,
      Math.sqrt(MAX_CANVAS_PIXELS / (displayed.width * displayed.height)),
    );
    const scaled = page.getViewport({ scale: displayScale * outputRatio });
    const wrapper = existingWrapper || element("div", "attachment-preview-pdf-page");
    wrapper.dataset.pageNumber = String(number);
    if (!continuous) wrapper.hidden = number !== pageNumbers[pageIndex];
    const canvas = element("canvas", "attachment-preview-pdf-canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Página ${number} de ${pdf.numPages} do PDF`);
    canvas.width = Math.max(1, Math.floor(scaled.width));
    canvas.height = Math.max(1, Math.floor(scaled.height));
    canvas.style.width = `${Math.floor(displayed.width)}px`;
    canvas.style.height = `${Math.floor(displayed.height)}px`;
    wrapper.append(canvas);
    if (!existingWrapper) surface.append(wrapper);
    canvas.dataset.baseWidth = String(Math.floor(displayed.width));
    canvas.dataset.baseHeight = String(Math.floor(displayed.height));
    if (destroyed || generation !== renderGeneration) {
      canvas.width = canvas.height = 0;
      if (existingWrapper) canvas.remove(); else wrapper.remove();
      page.cleanup();
      return false;
    }
    try {
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("O navegador não oferece canvas para este PDF.");
      renderTask = page.render({ canvasContext: context, viewport: scaled, annotationMode: 0 });
      await renderTask.promise;
      if (pdf.numPages === 1 && !destroyed && generation === renderGeneration) {
        ddaRead ||= readDdaCopyAction(page);
        const action = await ddaRead;
        if (action && !destroyed && generation === renderGeneration) {
          ddaAction = action;
          const copyButton = element('button', 'attachment-preview-dda-copy-overlay');
          copyButton.type = 'button';copyButton.setAttribute('aria-label', 'Copiar linha digitável: copiar os 44 dígitos do código de barras');
          copyButton.title = 'Copiar código de barras (44 dígitos)';
          copyButton.addEventListener('click', () => { void copyDdaBarcode(); });
          wrapper.append(copyButton);positionDdaCopyButton(copyButton, canvas, action.rect);
          onDdaCopyReady(true);
        }
      }
    } catch (error) {
      canvas.width = canvas.height = 0;
      if (existingWrapper) canvas.remove(); else wrapper.remove();
      throw error;
    } finally {
      renderTask = null;
      page.cleanup();
    }
    if (destroyed || generation !== renderGeneration) {
      canvas.width = canvas.height = 0;
      if (existingWrapper) canvas.remove(); else wrapper.remove();
      return false;
    }
    renderedCanvases.push(canvas);
    return true;
  }

  function windowIndices(index) {
    if (!continuous) return index >= 0 && index < pageSlots.length ? [index] : [];
    const bounds = viewport.getBoundingClientRect(), bottom = bounds.bottom ?? bounds.top + viewport.clientHeight;
    const visible = pageSlots.map((slot, i) => ({ i, rect: slot.node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > bounds.top && rect.top < bottom)
      .map(({ i }) => i).sort((a, b) => Math.abs(a - index) - Math.abs(b - index));
    const candidates = [...new Set([index, ...visible, index - 1, index + 1])], indices = [];
    let pixels = 0;
    for (const candidate of candidates) {
      const slot = pageSlots[candidate]; if (!slot) continue;
      const cost = Math.min(MAX_CANVAS_PIXELS, (slot.width + 1) * (slot.height + 1) * Math.min(2, Math.max(1, Number(pixelRatio) || 1)) ** 2);
      if (pixels + cost > MAX_CANVAS_PIXELS * 3) continue;
      indices.push(candidate); pixels += cost;
    }
    return indices;
  }

  function queuePageWindow() {
    pendingPageIndex = pageIndex;
    if (windowTask) return windowTask;
    const generation = renderGeneration;
    windowTask = renderPageWindow(generation).finally(() => {
      windowTask = null;
      if (!destroyed && generation === renderGeneration) {
        if (pendingPageIndex !== null) void queuePageWindow().catch(error => { if (!destroyed) onError(error); });
        else refitPage();
      }
    });
    return windowTask;
  }

  async function renderPageWindow(generation) {
    busy = true; reportedPage = null; onPageChange(null); root.setAttribute('aria-busy', 'true');
    while (!destroyed && generation === renderGeneration && pendingPageIndex !== null) {
      const target = pendingPageIndex; pendingPageIndex = null;
      const indices = windowIndices(target), wanted = new Set(indices.map(index => pageSlots[index].number));
      let rendered = indices.filter(index => pageSlots[index].node.querySelector('canvas')).length;
      // Release backing stores BEFORE allocating another window. Removing a
      // canvas alone does not promptly free Safari's graphics memory.
      renderedCanvases = renderedCanvases.filter(canvas => {
        if (wanted.has(Number(canvas.parentElement?.dataset.pageNumber))) return true;
        canvas.width = canvas.height = 0; canvas.remove(); return false;
      });
      for (const index of indices) {
        if (destroyed || generation !== renderGeneration) return;
        if (pendingPageIndex !== null && pendingPageIndex !== target) break;
        const slot = pageSlots[index];
        if (slot.node.querySelector('canvas') || failedPageNumbers.has(slot.number)) continue;
        try {
          const page = await pdf.getPage(slot.number);
          if (destroyed || generation !== renderGeneration) { page.cleanup(); return; }
          if (!(await renderPage(page, slot.number, generation, slot.node))) return;
          reportProgress(4 + ++rendered / indices.length, {
            phase: 'render', renderedPages: rendered, totalPages: indices.length, documentPages: pdf.numPages,
          });
        } catch (error) {
          if (destroyed || generation !== renderGeneration || error?.name === 'RenderingCancelledException') return;
          const lastBounds = pageSlots.at(-1)?.node.getBoundingClientRect(), viewportBounds = viewport.getBoundingClientRect();
          const atEnd = continuous && lastBounds?.bottom <= viewportBounds.bottom + 1;
          const oldHeight = parseFloat(slot.node.style.height) || slot.height;
          failedPageNumbers.add(slot.number); slot.node.classList.add('attachment-preview-pdf-page--error');
          slot.node.replaceChildren(element('p', 'attachment-preview-pdf-page-error', `Não foi possível mostrar a página ${slot.number}.`));
          // A failed employee needs a full-height reachable slot, including
          // on tall phones where several landscape pages fit on screen.
          slot.height = Math.max(slot.height, 120, viewport.clientHeight - 8);
          slot.node.style.height = `${Math.round(slot.height * pinchZoom.getZoom())}px`;
          if (atEnd) viewport.scrollTop += parseFloat(slot.node.style.height) - oldHeight;
        }
      }
    }
    if (destroyed || generation !== renderGeneration) return;
    root.dataset.failedPages = String(failedPageNumbers.size);
    if (pinchZoom.getZoom() > 1) applyZoom(pinchZoom.getZoom());
    busy = false; root.setAttribute('aria-busy', 'false'); showCurrentPage();
    finishProgress(generation);
  }

  async function preparePageSlots(generation) {
    for (const number of pageNumbers) {
      let page, natural, failed = false;
      try {
        page = await pdf.getPage(number);
        if (destroyed || generation !== renderGeneration) return false;
        natural = page.getViewport({ scale: 1 });
        if (!(natural.width > 0 && natural.height > 0 && Number.isFinite(natural.width + natural.height))) throw new Error('Dimensões de página inválidas.');
      } catch (error) {
        if (destroyed || generation !== renderGeneration || error?.name === 'RenderingCancelledException') return false;
        failed = true; failedPageNumbers.add(number);
      } finally { page?.cleanup(); }
      const availableWidth = Math.max(1, viewport.clientWidth - 8), availableHeight = Math.max(120, viewport.clientHeight - 8);
      const scale = failed ? 1 : Math.min(availableWidth / natural.width, availableHeight / natural.height);
      const node = element('div', 'attachment-preview-pdf-page'); node.dataset.pageNumber = String(number);
      const width = failed ? availableWidth : Math.floor(natural.width * scale), height = failed ? availableHeight : Math.floor(natural.height * scale);
      node.style.height = `${height}px`;
      if (failed) { node.classList.add('attachment-preview-pdf-page--error'); node.append(element('p', 'attachment-preview-pdf-page-error', `Não foi possível mostrar a página ${number}.`)); }
      if (!continuous) node.hidden = number !== pageNumbers[pageIndex];
      surface.append(node); pageSlots.push({ node, number, width, height });
      reportProgress(3 + pageSlots.length / pageNumbers.length, {
        phase: 'page-sizes', preparedPages: pageSlots.length, totalPages: pageNumbers.length, documentPages: pdf.numPages,
      });
    }
    slotsReady = true;
    if (pinchZoom.getZoom() > 1) applyZoom(pinchZoom.getZoom());
    if (continuous) {
      const target = pageSlots[pageIndex]?.node;
      if (target) viewport.scrollTop = Math.max(0, target.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop);
    }
    return true;
  }

  async function renderAll(generation) {
    busy = true;
    reportedPage = null;
    onPageChange(null);
    fittedSize = viewportSize();
    root.setAttribute("aria-busy", "true");
    renderTask?.cancel();
    clearRenderedPages();
    if (windowed) {
      failedPageNumbers.clear();
      if (!(await preparePageSlots(generation))) return;
      await queuePageWindow();
      return;
    }
    reportProgress(4, { phase: 'pages', totalPages: pageNumbers.length, documentPages: pdf.numPages });
    let failedPages = 0;
    let rendered = 0;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      if (!pageFilter(number, pdf.numPages)) continue;
      try {
        const page = await pdf.getPage(number);
        if (!(await renderPage(page, number, generation))) return;
        reportProgress(4 + ++rendered / pageNumbers.length, {
          phase: 'render', renderedPages: rendered, totalPages: pageNumbers.length, documentPages: pdf.numPages,
        });
      } catch (error) {
        if (destroyed || generation !== renderGeneration || error?.name === "RenderingCancelledException") return;
        failedPages += 1;
        const wrapper = element("div", "attachment-preview-pdf-page attachment-preview-pdf-page--error");
        wrapper.dataset.pageNumber = String(number);
        // A full-page error slot keeps a failed last employee reachable: a
        // short placeholder would clamp scrolling onto the healthy neighbour.
        if (fit === 'page') wrapper.style.minHeight = `${Math.max(120, viewport.clientHeight - 8)}px`;
        if (!continuous) wrapper.hidden = number !== pageNumbers[pageIndex];
        wrapper.append(element("p", "attachment-preview-pdf-page-error", `Não foi possível mostrar a página ${number}.`));
        surface.append(wrapper);
      }
    }
    if (destroyed || generation !== renderGeneration) return;
    viewport.scrollTop = viewport.scrollLeft = 0;
    root.dataset.failedPages = String(failedPages);
    if (pinchZoom.getZoom() > 1) applyZoom(pinchZoom.getZoom());
    if (continuous) {
      const target = [...surface.children].find(node => Number(node.dataset.pageNumber) === pageNumbers[pageIndex]);
      if (target) viewport.scrollTop = Math.max(0, target.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop);
    }
    busy = false;
    showCurrentPage();
    root.setAttribute("aria-busy", "false");
    refitPage();
    finishProgress(generation);
  }

  function refitPage() {
    if (fit !== 'page' || destroyed || busy || !pdf || viewportSize() === fittedSize) return;
    // Render serially. Resizes during rendering are reconciled at its end,
    // so an orientation change cannot cancel or interleave PDF page tasks.
    void renderAll(++renderGeneration).catch(error => { if (!destroyed) onError(error); });
  }
  if (fit === 'page') {
    windowRef?.addEventListener('resize', refitPage);
    if (windowRef?.ResizeObserver) {
      resizeObserver = new windowRef.ResizeObserver(refitPage);
      resizeObserver.observe(viewport);
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    progress.stop();
    renderGeneration += 1;
    signal?.removeEventListener("abort", destroy);
    resizeObserver?.disconnect();
    windowRef?.removeEventListener('resize', refitPage);
    viewport.removeEventListener('scroll', showCurrentPage);
    pinchZoom.destroy();
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
    progress.prepared();
    const pdfjs = await loadPdfJs();
    if (destroyed) return;
    reportProgress(1, { phase: 'imported' });
    const data = new Uint8Array(await blob.arrayBuffer());
    if (destroyed) return;
    reportProgress(2, { phase: 'read' });
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
    reportProgress(3, { phase: 'parsed', totalPages: pdf.numPages, documentPages: pdf.numPages });
    if (destroyed) return;
    pageNumbers = Array.from({ length: pdf.numPages }, (_, i) => i + 1).filter(n => pageFilter(n, pdf.numPages));
    pageIndex = Math.max(0, pageNumbers.indexOf(initialPage));
    windowed = fit === 'page' && pageNumbers.length > WINDOWED_PAGE_THRESHOLD;
    renderGeneration += 1;
    try {
      await renderAll(renderGeneration);
    } catch (error) {
      if (!destroyed) throw error;
    }
  })().catch(error => { progress.stop(); throw error; });

  return Object.freeze({
    ready,
    destroy,
    getCurrentPage,
    copyDdaBarcode,
    hasRenderedPages: () => renderedCanvases.length > 0,
    hasRenderingErrors: () => Number(root.dataset.failedPages || 0) > 0,
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
