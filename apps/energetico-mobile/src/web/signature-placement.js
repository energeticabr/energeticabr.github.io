import { createPdfPreview } from "./pdf-preview.js";

function bounded(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
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

function element(documentRef, tag, className) {
  const node = documentRef.createElement(tag);
  node.className = className;
  return node;
}

/**
 * Renders a PDF with a clickable signature preview over its pages.
 * Coordinates are normalized to the page: x/y are 0..1 from the lower-left.
 */
export function createSignaturePlacement({
  documentBlob,
  signatureBlob,
  container,
  documentRef = globalThis.document,
  urlApi = globalThis.URL,
  scope = null,
  selection = null,
  loadPdfJs,
  onPoint = () => {},
  signal,
} = {}) {
  if (!container?.append || !documentRef?.createElement) throw new TypeError("Contêiner de posicionamento inválido.");
  const root = element(documentRef, "section", "signature-placement-pdf");
  root.setAttribute("aria-label", "Prévia do documento para posicionar a assinatura");
  container.append(root);
  let destroyed = false;
  let pdf = null;
  let signatureUrl = "";
  let point = selection && Number.isFinite(Number(selection.x)) && Number.isFinite(Number(selection.y))
    ? { x: bounded(selection.x), y: bounded(selection.y) }
    : null;
  const markers = [];

  function setMarkers(nextPoint) {
    point = nextPoint ? { x: bounded(nextPoint.x), y: bounded(nextPoint.y) } : null;
    for (const marker of markers) {
      if (!point) {
        marker.hidden = true;
        continue;
      }
      marker.hidden = false;
      marker.style.left = `${point.x * 100}%`;
      marker.style.bottom = `${point.y * 100}%`;
    }
  }

  function addPageMarkers() {
    const pages = root.querySelectorAll(".attachment-preview-pdf-page");
    for (const page of pages) {
      page.classList.add("signature-placement-page");
      const canvas = page.querySelector("canvas");
      if (!canvas) continue;
      const marker = element(documentRef, "div", "signature-placement-marker");
      marker.hidden = true;
      marker.setAttribute("aria-hidden", "true");
      if (signatureUrl) {
        const image = element(documentRef, "img", "signature-placement-marker__image");
        image.alt = "Prévia da assinatura";
        image.src = signatureUrl;
        marker.append(image);
      }
      page.append(marker);
      markers.push(marker);
      canvas.addEventListener("click", event => {
        if (destroyed) return;
        event.preventDefault?.();
        event.stopPropagation?.();
        const nextPoint = pointFromEvent(canvas, event);
        setMarkers(nextPoint);
        onPoint({ ...nextPoint });
      });
    }
    setMarkers(point);
  }

  const ready = (async () => {
    if (destroyed) return;
    if (!documentBlob || typeof documentBlob.arrayBuffer !== "function") throw new Error("Documento indisponível para posicionamento.");
    if (!signatureBlob || typeof signatureBlob.arrayBuffer !== "function") throw new Error("Assinatura indisponível para posicionamento.");
    if (typeof urlApi?.createObjectURL === "function") {
      signatureUrl = urlApi.createObjectURL(signatureBlob);
    }
    pdf = createPdfPreview({
      blob: documentBlob,
      container: root,
      documentRef,
      loadPdfJs,
      pageFilter: (number, total) => scope !== "final" || number === total,
      signal,
    });
    await pdf.ready;
    if (destroyed) return;
    addPageMarkers();
  })();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    signal?.removeEventListener?.("abort", destroy);
    pdf?.destroy();
    if (signatureUrl) urlApi?.revokeObjectURL?.(signatureUrl);
    markers.length = 0;
    root.remove();
    pdf = null;
  }

  signal?.addEventListener?.("abort", destroy, { once: true });
  if (signal?.aborted) destroy();
  return Object.freeze({
    ready,
    destroy,
    getPoint: () => (point ? { ...point } : null),
    getSummary: () => pdf?.getSummary?.() || "",
  });
}
