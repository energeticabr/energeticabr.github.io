import { createPinchZoom } from "./pinch-zoom.js";

let nextPreviewId = 0;

function previewKind(blob, fileName) {
  const type = String(blob.type || "").toLowerCase().split(";")[0];
  const extension = fileName.toLowerCase().split(".").at(-1);
  if (["html", "htm", "svg", "svgz", "xml"].includes(extension) || /html|svg|xml/.test(type)) return "unsupported";
  if (type === "application/pdf" || extension === "pdf") return "pdf";
  if (/^image\/(jpeg|png|gif|webp|avif|heic|heif|bmp|tiff)$/.test(type)
    || ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "bmp", "tif", "tiff"].includes(extension)) return "image";
  if (/^video\//.test(type)
    || ["mp4", "mov", "m4v", "webm", "ogv", "avi", "mkv", "3gp"].includes(extension)) return "video";
  if (/^audio\//.test(type)
    || ["mp3", "m4a", "wav", "ogg", "oga", "aac", "flac"].includes(extension)) return "audio";
  if (["text/plain", "text/csv"].includes(type) || ["txt", "csv"].includes(extension)) return "text";
  return "unsupported";
}

function desktopBrowserCanEmbedPdf(documentRef, navigatorRef) {
  const userAgent = String(navigatorRef?.userAgent || "");
  if (!documentRef?.createElement || /Android|iPhone|iPad|iPod|jsdom|Node\.js/i.test(userAgent)) return false;
  return /Windows NT|Macintosh|X11|Linux x86_64/i.test(userAgent);
}

async function hasPdfHeader(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return bytes.length === 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}

/** Owns a dialog outside the chat DOM. open() shows it before any asynchronous work. */
export function createAttachmentPreview({
  documentRef = globalThis.document,
  urlApi = globalThis.URL,
  exportMedia,
  loadPdfPreview = () => import("./pdf-preview.js"),
  readText = blob => blob.text(),
  maxTextBytes = 1_048_576,
  navigatorRef = documentRef?.defaultView?.navigator || globalThis.navigator,
  canEmbedPdf = () => desktopBrowserCanEmbedPdf(documentRef, navigatorRef),
} = {}) {
  const element = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const dialog = element("dialog", "attachment-preview-dialog");
  const title = element("h2", "attachment-preview-title");
  title.id = `attachment-preview-title-${++nextPreviewId}`;
  dialog.setAttribute("aria-labelledby", title.id);
  const header = element("header", "attachment-preview-header");
  const closeButton = element("button", "attachment-preview-close", "Fechar");
  closeButton.type = "button";
  closeButton.autofocus = true;
  header.append(title, closeButton);
  const content = element("div", "attachment-preview-content");
  const status = element("p", "attachment-preview-status");
  status.setAttribute("role", "status");
  const footer = element("footer", "attachment-preview-footer");
  const backButton = element("button", "attachment-preview-back", "Voltar ao chat");
  const exportButton = element("button", "attachment-preview-export");
  const forwardIcon = documentRef.createElementNS("http://www.w3.org/2000/svg", "svg");
  forwardIcon.setAttribute("viewBox", "0 0 24 24");
  forwardIcon.setAttribute("aria-hidden", "true");
  forwardIcon.setAttribute("focusable", "false");
  forwardIcon.setAttribute("fill", "none");
  forwardIcon.setAttribute("stroke", "currentColor");
  forwardIcon.setAttribute("stroke-width", "2");
  forwardIcon.setAttribute("stroke-linecap", "round");
  forwardIcon.setAttribute("stroke-linejoin", "round");
  const forwardGlyph = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
  forwardGlyph.setAttribute("d", "M12 15V2m0 0L7.5 6.5M12 2l4.5 4.5M5 10H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1");
  forwardIcon.append(forwardGlyph);
  exportButton.append(forwardIcon, element("span", "", "ENCAMINHAR"));
  backButton.type = exportButton.type = "button";
  exportButton.dataset.previewAction = "export";
  const collectionNav = element("div", "attachment-preview-collection-nav");
  const previousButton = element("button", "attachment-preview-collection-previous", "‹ Anterior");
  const collectionStatus = element("span", "attachment-preview-collection-status");
  const nextButton = element("button", "attachment-preview-collection-next", "Próximo ›");
  previousButton.type = nextButton.type = "button";
  previousButton.dataset.previewAction = "previous";
  collectionStatus.dataset.previewAction = "collection-status";
  nextButton.dataset.previewAction = "next";
  collectionNav.append(previousButton, collectionStatus, nextButton);
  footer.append(collectionNav, backButton, exportButton);
  dialog.append(header, content, status, footer);
  documentRef.body.append(dialog);
  let active = null;
  let returnFocus = null;
  let destroyed = false;
  let collection = null;

  function updateCollectionNavigation() {
    const hasCollection = Boolean(collection?.items?.length);
    collectionNav.hidden = !hasCollection;
    if (!hasCollection) return;
    const last = collection.items.length - 1;
    previousButton.disabled = collection.index <= 0;
    nextButton.disabled = collection.index >= last;
    collectionStatus.textContent = `${collection.index + 1} de ${collection.items.length}`;
  }

  function release() {
    if (!active) return;
    const previous = active;
    active = null;
    previous.abort.abort();
    previous.pdf?.destroy();
    previous.zoom?.destroy();
    previous.urls.forEach(url => urlApi.revokeObjectURL(url));
    previous.urls.clear();
    content.replaceChildren();
    exportButton.disabled = true;
  }

  function finishClosed() {
    release();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function close() {
    release();
    collection = null;
    updateCollectionNavigation();
    if (dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    finishClosed();
  }

  function explain(session, message) {
    if (active !== session) return;
    session.zoom?.destroy();
    session.zoom = null;
    content.replaceChildren(element("p", "attachment-preview-explanation", message));
    status.textContent = "Use ENCAMINHAR para acessar o arquivo original.";
  }

  async function showNativePdf(session) {
    if (!session.blob || !canEmbedPdf(session.blob, session.fileName) || !(await hasPdfHeader(session.blob))) return false;
    if (active !== session) return false;
    const pdfBlob = String(session.blob.type || "").toLowerCase().split(";")[0] === "application/pdf"
      ? session.blob
      : new Blob([session.blob], { type: "application/pdf" });
    const href = urlApi.createObjectURL(pdfBlob);
    session.urls.add(href);
    const frame = element("iframe", "attachment-preview-pdf-native");
    frame.title = session.fileName;
    frame.src = href;
    content.replaceChildren(frame);
    status.textContent = "PDF aberto no leitor do navegador.";
    return true;
  }

  async function openOne(blobOrPromise, fileName = "arquivo") {
    if (destroyed) throw new Error("O visualizador já foi encerrado.");
    if (!dialog.open) returnFocus = documentRef.activeElement;
    release();
    const session = { abort: new AbortController(), urls: new Set(), blob: null, pdf: null, zoom: null, kind: null, fileName: String(fileName || "arquivo") };
    active = session;
    title.textContent = session.fileName;
    updateCollectionNavigation();
    status.textContent = "Carregando arquivo…";
    exportButton.disabled = true;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else { dialog.setAttribute("open", ""); dialog.setAttribute("aria-modal", "true"); }
    }
    closeButton.focus({ preventScroll: true });
    try {
      const blob = typeof blobOrPromise?.then === "function" ? await blobOrPromise : blobOrPromise;
      if (active !== session) return;
      if (!blob || typeof blob.slice !== "function" || typeof blob.arrayBuffer !== "function") throw new Error("Arquivo inválido.");
      session.blob = blob;
      exportButton.disabled = typeof exportMedia !== "function";
      const kind = previewKind(blob, session.fileName);
      session.kind = kind;
      if (kind === "image") {
        const img = element("img", "attachment-preview-image");
        let imageBaseWidth = 0;
        let imageBaseHeight = 0;
        const captureImageBaseSize = () => {
          if (imageBaseWidth > 0 && imageBaseHeight > 0) return true;
          const naturalWidth = Number(img.naturalWidth);
          const naturalHeight = Number(img.naturalHeight);
          const bounds = img.getBoundingClientRect?.() || {};
          const nextBaseWidth = Number(bounds.width) > 0
            ? Number(bounds.width)
            : naturalWidth > 0
              ? Math.min(naturalWidth, Math.max(1, content.clientWidth || 360))
              : 0;
          const nextBaseHeight = Number(bounds.height) > 0
            ? Number(bounds.height)
            : naturalWidth > 0 && naturalHeight > 0 && nextBaseWidth > 0
              ? naturalHeight * (nextBaseWidth / naturalWidth)
              : 0;
          if (!(nextBaseWidth > 0) || !(nextBaseHeight > 0)) return false;
          imageBaseWidth = nextBaseWidth;
          imageBaseHeight = nextBaseHeight;
          return true;
        };
        const applyImageZoom = zoom => {
          if (!captureImageBaseSize()) return false;
          img.style.maxWidth = "none";
          img.style.maxHeight = "none";
          img.style.width = `${Math.round(imageBaseWidth * zoom)}px`;
          img.style.height = `${Math.round(imageBaseHeight * zoom)}px`;
          return true;
        };
        img.alt = session.fileName;
        const href = urlApi.createObjectURL(blob);
        session.urls.add(href);
        img.addEventListener("load", () => {
          if (active !== session) return;
          captureImageBaseSize();
          const pendingZoom = session.zoom?.getZoom?.() || 1;
          if (pendingZoom !== 1) applyImageZoom(pendingZoom);
          status.textContent = "Imagem pronta.";
        }, { once: true });
        img.addEventListener("error", () => {
          if (active !== session) return;
          urlApi.revokeObjectURL(href);
          session.urls.delete(href);
          explain(session, "Este navegador não conseguiu mostrar esta imagem. Você pode abri-la em outro app.");
        }, { once: true });
        img.src = href;
        content.append(img);
        session.zoom = createPinchZoom({
          element: content,
          documentRef,
          onZoom: (zoom, { previousZoom = 1, midpoint, ratio = 1 }) => {
            if (!applyImageZoom(zoom)) return;
            if (midpoint && zoom !== previousZoom && ratio > 0) {
              const contentBounds = content.getBoundingClientRect?.() || { left: 0, top: 0 };
              const x = Number(midpoint.clientX) - Number(contentBounds.left || 0);
              const y = Number(midpoint.clientY) - Number(contentBounds.top || 0);
              content.scrollLeft = Math.max(0, (content.scrollLeft + x) * ratio - x);
              content.scrollTop = Math.max(0, (content.scrollTop + y) * ratio - y);
            }
          },
        });
        status.textContent = "Carregando imagem…";
      } else if (kind === "video" || kind === "audio") {
        const media = element(kind, `attachment-preview-${kind}`);
        media.controls = true;
        media.preload = "metadata";
        if (kind === "video") media.playsInline = true;
        const href = urlApi.createObjectURL(blob);
        session.urls.add(href);
        media.addEventListener("loadedmetadata", () => {
          if (active === session) status.textContent = kind === "video" ? "Vídeo pronto." : "Áudio pronto.";
        }, { once: true });
        media.addEventListener("error", () => {
          if (active !== session) return;
          urlApi.revokeObjectURL(href);
          session.urls.delete(href);
          explain(session, `Este navegador não conseguiu reproduzir este ${kind === "video" ? "vídeo" : "áudio"}. Você pode abri-lo em outro app.`);
        }, { once: true });
        media.src = href;
        content.append(media);
        status.textContent = `Carregando ${kind === "video" ? "vídeo" : "áudio"}…`;
      } else if (kind === "text") {
        const text = await readText(blob.slice(0, maxTextBytes));
        if (active !== session) return;
        content.append(element("pre", "attachment-preview-text", text));
        status.textContent = blob.size > maxTextBytes ? "Exibindo apenas o início do arquivo. Salve o original para ler tudo." : "Arquivo pronto.";
      } else if (kind === "pdf") {
        const { createPdfPreview } = await loadPdfPreview();
        if (active !== session) return;
        session.pdf = createPdfPreview({
          blob, container: content, documentRef, signal: session.abort.signal,
          onError: () => explain(session, "Não foi possível mostrar esta página do PDF. Tente abrir o arquivo em outro app."),
        });
        await session.pdf.ready;
        if (active === session) status.textContent = session.pdf.getSummary?.() || "";
      } else {
        explain(session, "Este tipo de arquivo precisa de outro app para visualização. O arquivo original está disponível para abrir ou salvar.");
      }
    } catch {
      if (active !== session) return;
      session.pdf?.destroy();
      session.pdf = null;
      if (session.kind === "pdf") {
        try {
          if (await showNativePdf(session)) return;
        } catch {
          // Continue to the explicit download fallback below.
        }
      }
      explain(session, session.blob
        ? "Não foi possível mostrar este arquivo. Se o PDF tiver senha ou estiver danificado, tente abri-lo em outro app."
        : "Não foi possível carregar este arquivo. Feche esta janela e tente novamente no chat.");
      if (!session.blob) status.textContent = "O arquivo ainda não está disponível para salvar.";
    }
  }

  async function open(blobOrPromise, fileName = "arquivo") {
    collection = null;
    updateCollectionNavigation();
    return openOne(blobOrPromise, fileName);
  }

  async function openCollection(items) {
    const normalized = (Array.isArray(items) ? items : [])
      .map(item => ({ source: item?.source, fileName: String(item?.fileName || "arquivo") }))
      .filter(item => item.source != null);
    if (!normalized.length) throw new Error("Nenhum anexo disponível.");
    collection = { items: normalized, index: 0 };
    updateCollectionNavigation();
    return openOne(normalized[0].source, normalized[0].fileName);
  }

  async function moveCollection(delta) {
    if (!collection) return;
    const index = collection.index + delta;
    if (index < 0 || index >= collection.items.length) return;
    collection.index = index;
    updateCollectionNavigation();
    const item = collection.items[index];
    await openOne(item.source, item.fileName);
  }

  previousButton.addEventListener("click", () => { void moveCollection(-1); });
  nextButton.addEventListener("click", () => { void moveCollection(1); });
  updateCollectionNavigation();

  closeButton.addEventListener("click", close);
  backButton.addEventListener("click", close);
  dialog.addEventListener("click", event => {
    // A click whose target is the dialog itself came from the native backdrop
    // in browsers that expose HTMLDialogElement.showModal(). Controls and
    // content remain interactive because they have a different event target.
    if (event.target === dialog) close();
  });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => { if (!dialog.open) finishClosed(); });
  exportButton.addEventListener("click", async () => {
    const session = active;
    if (!session?.blob || typeof exportMedia !== "function") return;
    exportButton.disabled = true;
    try {
      await exportMedia(session.blob, session.fileName);
    } catch (error) {
      if (active === session && error?.name !== "AbortError") status.textContent = "Não foi possível abrir ou salvar. Tente novamente.";
    } finally {
      if (active === session) exportButton.disabled = false;
    }
  });

  return Object.freeze({ open, openCollection, close, destroy() { if (destroyed) return; close(); dialog.remove(); destroyed = true; } });
}
