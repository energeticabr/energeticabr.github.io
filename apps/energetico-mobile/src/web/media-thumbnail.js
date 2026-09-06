const MAX_PDF_BYTES = 60_000_000;
const MAX_THUMBNAIL_SIDE = 520;
let pdfJsPromise;

async function loadPdfJs() {
  pdfJsPromise ||= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfJsPromise;
}

function kind(blob, fileName) {
  const type = String(blob.type || "").toLowerCase().split(";")[0];
  const extension = String(fileName || "").toLowerCase().split(".").at(-1);
  if (type === "application/pdf" || extension === "pdf") return "pdf";
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "bmp", "tif", "tiff"].includes(extension)) return "image";
  return null;
}

export async function createMediaThumbnail(blob, fileName, { documentRef = globalThis.document, urlApi = globalThis.URL } = {}) {
  const type = kind(blob, fileName);
  if (!type) return null;
  if (type === "image") return urlApi.createObjectURL(blob);
  if (blob.size > MAX_PDF_BYTES) return null;
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), enableXfa: false });
  try {
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(1, MAX_THUMBNAIL_SIDE / Math.max(natural.width, natural.height));
    const viewport = page.getViewport({ scale: Math.max(.1, scale) });
    const canvas = documentRef.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    await page.render({ canvasContext: context, viewport, annotationMode: 0 }).promise;
    const thumb = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .82));
    return thumb ? urlApi.createObjectURL(thumb) : null;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}
