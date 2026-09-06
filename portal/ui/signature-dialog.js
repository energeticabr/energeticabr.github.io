import { escapeHtml } from "../core/utils.js";

const SIGNATURE_ENTITY_IDS = new Set([
  "lancamentos",
  "empreiteiros",
  "receitas",
  "descricoes-de-medicao",
]);

function contractContainsSignatureEvidence(value, seen = new WeakSet()) {
  if (typeof value === "string") return /MOSTRARASSINATURA|ASSINATURA/iu.test(value);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, child]) => (
    /MOSTRARASSINATURA|ASSINATURA/iu.test(key)
    || contractContainsSignatureEvidence(child, seen)
  ));
}

export function normalizeStoredSignature(value) {
  let candidate = String(value || "").trim();
  if (!candidate) return "";
  if (candidate.startsWith('"')) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") candidate = parsed.trim();
    } catch {
      return "";
    }
  }
  return /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/iu.test(candidate)
    ? candidate
    : "";
}

export function signatureGalleryEligible({ entity, contract, canEdit } = {}) {
  return canEdit === true
    && SIGNATURE_ENTITY_IDS.has(String(entity?.id || ""))
    && contractContainsSignatureEvidence(contract);
}

export function signatureActionMarkup({ entity, item, contract, canEdit } = {}) {
  if (!signatureGalleryEligible({ entity, contract, canEdit })) return "";
  const itemId = String(item?.id ?? "");
  const existing = normalizeStoredSignature(item?.fields?.ASSINATURA);
  const label = existing ? "Ver assinatura" : "Assinar";
  return `<button class="button-secondary entity-signature-action" type="button" data-signature-open="${escapeHtml(itemId)}" aria-label="${escapeHtml(`${label} do registro #${itemId}`)}">${label}</button>`;
}

export function signatureDialogMarkup({ item } = {}) {
  const itemId = String(item?.id ?? "");
  const existing = normalizeStoredSignature(item?.fields?.ASSINATURA);
  const existingMarkup = existing
    ? `<section class="signature-existing" data-signature-existing><h3>Assinatura atual</h3><img src="${escapeHtml(existing)}" alt="Assinatura atual do registro #${escapeHtml(itemId)}"></section>`
    : '<p class="signature-empty">Este registro ainda não possui assinatura.</p>';
  return `<dialog class="signature-dialog" data-signature-dialog aria-labelledby="signatureDialogTitle">
    <header class="signature-dialog-heading">
      <div><p class="page-eyebrow">Registro #${escapeHtml(itemId)}</p><h2 id="signatureDialogTitle">Assinatura manuscrita</h2></div>
      <button class="button-secondary" type="button" data-signature-cancel>Cancelar</button>
    </header>
    <div class="signature-dialog-content">
      ${existingMarkup}
      <section class="signature-pad"><h3>Nova assinatura</h3><canvas data-signature-canvas width="960" height="320" aria-label="Área para desenhar a assinatura"></canvas></section>
      <p class="signature-status" data-signature-status role="status" aria-live="polite"></p>
    </div>
    <footer class="signature-dialog-actions">
      <button class="button-secondary" type="button" data-signature-clear>Limpar</button>
      <button class="button-primary" type="button" data-signature-save>Gravar</button>
    </footer>
  </dialog>`;
}

export function bindSignatureCanvas(canvas) {
  if (!canvas || typeof canvas.getContext !== "function") throw new TypeError("A assinatura requer um canvas válido.");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("O navegador não disponibilizou o canvas de assinatura.");
  let drawing = false;
  let hasDrawing = false;

  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 3;
  context.strokeStyle = "#102d3c";

  const point = event => {
    const bounds = canvas.getBoundingClientRect();
    const scaleX = bounds.width > 0 ? canvas.width / bounds.width : 1;
    const scaleY = bounds.height > 0 ? canvas.height / bounds.height : 1;
    return {
      x: (Number(event.clientX) - bounds.left) * scaleX,
      y: (Number(event.clientY) - bounds.top) * scaleY,
    };
  };
  const start = event => {
    event.preventDefault?.();
    drawing = true;
    hasDrawing = true;
    const current = point(event);
    context.beginPath();
    context.moveTo(current.x, current.y);
    canvas.setPointerCapture?.(event.pointerId);
  };
  const move = event => {
    if (!drawing) return;
    event.preventDefault?.();
    const current = point(event);
    context.lineTo(current.x, current.y);
    context.stroke();
  };
  const stop = () => { drawing = false; };
  const listeners = [
    ["pointerdown", start],
    ["pointermove", move],
    ["pointerup", stop],
    ["pointercancel", stop],
    ["pointerleave", stop],
  ];
  listeners.forEach(([name, listener]) => canvas.addEventListener(name, listener));

  return Object.freeze({
    clear() {
      context.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawing = false;
      drawing = false;
    },
    hasDrawing: () => hasDrawing,
    destroy() {
      listeners.forEach(([name, listener]) => canvas.removeEventListener(name, listener));
    },
  });
}

function replacementItem(item, saved, storedSignature) {
  if (saved?.fields) return saved;
  return {
    ...item,
    ...(saved && typeof saved === "object" ? saved : {}),
    fields: { ...(item?.fields || {}), ASSINATURA: storedSignature },
  };
}

export function createSignatureDialog(host, options = {}) {
  const { entity, contract, item, repository, listId, onSaved, onClose } = options;
  if (!host) throw new TypeError("A assinatura requer um elemento de montagem.");
  if (!signatureGalleryEligible({ entity, contract, canEdit: options.canEdit })) return null;
  host.innerHTML = signatureDialogMarkup({ item });

  const dialog = host.querySelector?.("[data-signature-dialog]");
  const canvas = host.querySelector?.("[data-signature-canvas]");
  const clearButton = host.querySelector?.("[data-signature-clear]");
  const cancelButton = host.querySelector?.("[data-signature-cancel]");
  const saveButton = host.querySelector?.("[data-signature-save]");
  const status = host.querySelector?.("[data-signature-status]");
  if (!dialog || !canvas || !clearButton || !cancelButton || !saveButton || !status) {
    host.innerHTML = "";
    throw new Error("O diálogo de assinatura não pôde ser montado.");
  }

  const pad = bindSignatureCanvas(canvas);
  const state = { saving: false, error: "", closed: false };
  const setStatus = message => { status.textContent = message; };
  const clear = () => {
    if (state.saving || state.closed) return;
    pad.clear();
    state.error = "";
    setStatus("");
  };
  const close = () => {
    if (state.saving || state.closed) return;
    state.closed = true;
    pad.destroy();
    dialog.close?.();
    host.innerHTML = "";
    onClose?.();
  };
  const save = async () => {
    if (state.saving || state.closed) return undefined;
    if (typeof repository?.updateItem !== "function") {
      state.error = "A gravação da assinatura não está disponível.";
      setStatus(state.error);
      return undefined;
    }
    state.saving = true;
    state.error = "";
    saveButton.disabled = true;
    clearButton.disabled = true;
    cancelButton.disabled = true;
    setStatus("Gravando assinatura...");
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const storedSignature = JSON.stringify(dataUrl);
      const saved = await repository.updateItem(
        entity.siteKey,
        listId,
        item.id,
        { ASSINATURA: storedSignature },
        { eTag: item.eTag || item["@odata.etag"] },
      );
      if (state.closed) return undefined;
      const replacement = replacementItem(item, saved, storedSignature);
      await onSaved?.(replacement);
      if (state.closed) return replacement;
      state.saving = false;
      close();
      return replacement;
    } catch (error) {
      state.saving = false;
      state.error = error?.message || "Não foi possível gravar a assinatura no SharePoint.";
      saveButton.disabled = false;
      clearButton.disabled = false;
      cancelButton.disabled = false;
      setStatus(`${state.error} O desenho foi preservado; tente novamente.`);
      return undefined;
    }
  };

  clearButton.addEventListener("click", clear);
  cancelButton.addEventListener("click", close);
  saveButton.addEventListener("click", save);
  dialog.addEventListener?.("cancel", event => {
    event.preventDefault?.();
    close();
  });
  try { dialog.showModal?.(); } catch { dialog.setAttribute?.("open", ""); }

  return Object.freeze({
    clear,
    cancel: close,
    save,
    getState: () => Object.freeze({ ...state, hasDrawing: pad.hasDrawing() }),
    destroy() {
      if (!state.closed) {
        state.saving = false;
        close();
      }
    },
  });
}

export function bindSignatureGallery(galleryRoot, options = {}) {
  const buttons = [...(galleryRoot?.querySelectorAll?.("[data-signature-open]") || [])];
  const items = new Map((options.items || []).map(item => [String(item?.id ?? ""), item]));
  let activeDialog;
  let destroyed = false;
  const bindings = buttons.map(button => {
    const open = event => {
      event?.preventDefault?.();
      if (destroyed) return;
      const item = items.get(String(button.dataset?.signatureOpen || ""));
      if (!item) return;
      activeDialog?.destroy?.();
      activeDialog = createSignatureDialog(options.host, {
        ...options,
        item,
        onSaved: replacement => options.onSaved?.(replacement, item),
      });
    };
    button.addEventListener("click", open);
    return [button, open];
  });

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      bindings.forEach(([button, listener]) => button.removeEventListener("click", listener));
      activeDialog?.destroy?.();
      activeDialog = undefined;
    },
  });
}
