let nextPreviewId = 0;

function previewKind(blob, fileName) {
  const type = String(blob.type || "").toLowerCase().split(";")[0];
  const extension = fileName.toLowerCase().split(".").at(-1);
  if (["html", "htm", "svg", "svgz", "xml"].includes(extension) || /html|svg|xml/.test(type)) return "unsupported";
  if (type === "application/pdf" || extension === "pdf") return "pdf";
  if (/^image\/(jpeg|png|gif|webp|avif|heic|heif|bmp|tiff)$/.test(type)
    || ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "bmp", "tif", "tiff"].includes(extension)) return "image";
  if (["text/plain", "text/csv"].includes(type) || ["txt", "csv"].includes(extension)) return "text";
  return "unsupported";
}

/** Owns a dialog outside the chat DOM. open() shows it before any asynchronous work. */
export function createAttachmentPreview({
  documentRef = globalThis.document,
  urlApi = globalThis.URL,
  exportMedia,
  loadPdfPreview = () => import("./pdf-preview.js"),
  readText = blob => blob.text(),
  maxTextBytes = 1_048_576,
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
  const exportButton = element("button", "attachment-preview-export", "Abrir em outro app / salvar");
  backButton.type = exportButton.type = "button";
  exportButton.dataset.previewAction = "export";
  footer.append(backButton, exportButton);
  dialog.append(header, content, status, footer);
  documentRef.body.append(dialog);
  let active = null;
  let returnFocus = null;
  let destroyed = false;

  function release() {
    if (!active) return;
    const previous = active;
    active = null;
    previous.abort.abort();
    previous.pdf?.destroy();
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
    if (dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    finishClosed();
  }

  function explain(session, message) {
    if (active !== session) return;
    content.replaceChildren(element("p", "attachment-preview-explanation", message));
    status.textContent = "Use Abrir em outro app / salvar para acessar o arquivo original.";
  }

  async function open(blobOrPromise, fileName = "arquivo") {
    if (destroyed) throw new Error("O visualizador já foi encerrado.");
    if (!dialog.open) returnFocus = documentRef.activeElement;
    release();
    const session = { abort: new AbortController(), urls: new Set(), blob: null, pdf: null, fileName: String(fileName || "arquivo") };
    active = session;
    title.textContent = session.fileName;
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
      if (kind === "image") {
        const img = element("img", "attachment-preview-image");
        img.alt = session.fileName;
        const href = urlApi.createObjectURL(blob);
        session.urls.add(href);
        img.addEventListener("load", () => { if (active === session) status.textContent = "Imagem pronta."; }, { once: true });
        img.addEventListener("error", () => {
          if (active !== session) return;
          urlApi.revokeObjectURL(href);
          session.urls.delete(href);
          explain(session, "Este navegador não conseguiu mostrar esta imagem. Você pode abri-la em outro app.");
        }, { once: true });
        img.src = href;
        content.append(img);
        status.textContent = "Carregando imagem…";
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
        if (active === session) status.textContent = "PDF aberto. Deslize para baixo para ver as demais páginas.";
      } else {
        explain(session, "Este tipo de arquivo precisa de outro app para visualização. O arquivo original está disponível para abrir ou salvar.");
      }
    } catch {
      if (active !== session) return;
      session.pdf?.destroy();
      session.pdf = null;
      explain(session, session.blob
        ? "Não foi possível mostrar este arquivo. Se o PDF tiver senha ou estiver danificado, tente abri-lo em outro app."
        : "Não foi possível carregar este arquivo. Feche esta janela e tente novamente no chat.");
      if (!session.blob) status.textContent = "O arquivo ainda não está disponível para salvar.";
    }
  }

  closeButton.addEventListener("click", close);
  backButton.addEventListener("click", close);
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

  return Object.freeze({ open, close, destroy() { if (destroyed) return; close(); dialog.remove(); destroyed = true; } });
}
