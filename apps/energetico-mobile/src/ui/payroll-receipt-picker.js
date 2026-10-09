import { validateAttachment } from "../../../../portal/data/attachments.js";

let sequence = 0;
export function openPayrollReceiptPicker({
  root, label, files, getReceiptAttachments, readReceiptAttachment, pickReceiptAttachments, onConfirm, onClose,
}) {
  const doc = root.ownerDocument;
  const create = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const previousFocus = doc.activeElement;
  const background = [...root.children].map(node => [node, node.inert]);
  for (const [node] of background) node.inert = true;
  let closed = false, loading = false;
  const overlay = create("div", undefined, "payroll-receipt-overlay");
  overlay.setAttribute("data-receipt-picker", "");
  const panel = create("section", undefined, "payroll-receipt-dialog");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  const heading = create("h2", `Comprovantes — ${label}`);
  heading.id = `payroll-receipts-${++sequence}`;
  panel.setAttribute("aria-labelledby", heading.id);
  const info = create("p", "Selecione os arquivos enviados ao app ou use BUSCAR para adicionar uma foto ou arquivo do dispositivo.");
  const list = create("div", undefined, "payroll-receipt-options");
  const error = create("p", undefined, "supplier-payroll-error");
  error.setAttribute("data-receipt-error", "");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const actions = create("div", undefined, "payroll-receipt-actions");
  const cancel = create("button", "Cancelar", "supplier-payroll-button");
  cancel.type = "button";
  cancel.setAttribute("data-receipt-cancel", "");
  const search = create("button", "BUSCAR", "supplier-payroll-button");
  search.type = "button";
  search.setAttribute("data-receipt-search", "");
  search.setAttribute("aria-expanded", "false");
  const sources = create("div", undefined, "payroll-receipt-sources");
  sources.setAttribute("data-receipt-sources", "");
  sources.id = heading.id + "-sources";
  sources.hidden = true;
  search.setAttribute("aria-controls", sources.id);
  sources.append(create("p", "Deseja buscar uma foto ou um arquivo?"));
  const sourceActions = create("div", undefined, "payroll-receipt-source-actions");
  const sourceButtons = ["photo", "file"].map(kind => {
    const button = create("button", kind === "photo" ? "Foto" : "Arquivo", "supplier-payroll-button");
    button.type = "button";
    button.dataset.receiptSource = kind;
    button.addEventListener("click", () => pickFromDevice(kind));
    sourceActions.append(button);
    return button;
  });
  sources.append(sourceActions);
  const confirm = create("button", "Continuar", "supplier-payroll-button");
  confirm.type = "button";
  confirm.setAttribute("data-receipt-confirm", "");
  const checkboxes = [];
  const references = new Map();
  const deviceFiles = new Map();
  let localSequence = 0;
  const empty = create("p", "A bandeja de anexos está vazia. Use BUSCAR para adicionar um comprovante.");
  function addOption(item, { linked = false, selected = false, device = false } = {}) {
    const option = create("label", undefined, "payroll-receipt-option");
    const input = create("input");
    input.type = "checkbox";
    input.dataset.receiptId = String(item.id);
    input.disabled = linked;
    input.checked = selected;
    input.dataset.linked = String(linked);
    references.set(String(item.id), item);
    option.append(input, create("span", item.fileName + (linked ? " (já vinculado)" : device ? " (do dispositivo)" : "")));
    checkboxes.push(input);
    empty.remove();
    list.append(option);
  }
  function setBusy(value) {
    loading = value;
    search.disabled = value;
    for (const button of sourceButtons) button.disabled = value;
    for (const input of checkboxes) input.disabled = value || input.dataset.linked === "true";
    confirm.disabled = value || !checkboxes.some(input => !input.disabled);
    confirm.textContent = value ? "Carregando…" : "Continuar";
    panel.setAttribute("aria-busy", String(value));
  }
  function showError(cause) {
    error.textContent = cause?.message || "Não foi possível carregar o comprovante. Tente novamente.";
    error.hidden = false;
  }
  search.addEventListener("click", () => {
    if (closed || loading) return;
    sources.hidden = !sources.hidden;
    search.setAttribute("aria-expanded", String(!sources.hidden));
    if (!sources.hidden) sourceButtons[0].focus();
  });
  async function pickFromDevice(kind) {
    if (closed || loading) return;
    setBusy(true);
    error.hidden = true;
    try {
      if (typeof pickReceiptAttachments !== "function") throw new Error("A busca de comprovantes não está disponível neste dispositivo.");
      const picked = await pickReceiptAttachments(kind);
      if (closed) return;
      const candidates = Array.from(picked || []);
      const names = new Set([...files, ...deviceFiles.values()].map(file => file.name));
      for (const file of candidates) {
        const valid = validateAttachment(file);
        if (!valid.valid) throw new Error(valid.message);
        if (names.has(file.name)) throw new Error("Já existe um comprovante com esse nome na seleção ou na rubrica.");
        names.add(file.name);
      }
      for (const file of candidates) {
        const id = `device:${heading.id}:${++localSequence}`;
        deviceFiles.set(id, file);
        addOption({ id, fileName: file.name }, { selected: true, device: true });
      }
    } catch (cause) {
      if (!closed) showError(cause);
    } finally {
      if (!closed) {
        sources.hidden = true;
        search.setAttribute("aria-expanded", "false");
        setBusy(false);
        search.focus();
      }
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    for (const [node, inert] of background) node.inert = inert;
    previousFocus?.focus?.();
    onClose?.();
  }
  cancel.addEventListener("click", close);
  confirm.addEventListener("click", async () => {
    if (closed || loading) return;
    const selected = checkboxes.filter(input => input.checked && !input.disabled);
    if (!selected.length) return;
    setBusy(true);
    error.hidden = true;
    try {
      const candidates = [];
      const names = new Set(files.map(file => file.name));
      for (const input of selected) {
        const file = deviceFiles.get(input.dataset.receiptId)
          || await readReceiptAttachment(input.dataset.receiptId, references.get(input.dataset.receiptId));
        if (closed) return;
        const valid = validateAttachment(file);
        if (!valid.valid) throw new Error(valid.message);
        if (names.has(file.name)) throw new Error("Já existe um comprovante com esse nome na rubrica.");
        names.add(file.name);
        candidates.push(file);
      }
      const current = getReceiptAttachments();
      for (const input of selected) {
        if (deviceFiles.has(input.dataset.receiptId)) continue;
        const reference = references.get(input.dataset.receiptId);
        const latest = current.find(item => String(item.id) === input.dataset.receiptId);
        if (!latest || latest.fileName !== reference.fileName || latest.source !== reference.source)
          throw new Error("Um comprovante foi alterado ou removido da bandeja. Abra a seleção novamente.");
      }
      onConfirm(candidates);
      close();
    } catch (cause) {
      if (!closed) {
        showError(cause);
      }
    } finally {
      if (!closed) {
        setBusy(false);
      }
    }
  });
  try {
    const attachments = getReceiptAttachments();
    for (const item of attachments) {
      if (!item?.id || !item.fileName) continue;
      addOption(item, { linked: files.some(file => file.name === item.fileName) });
    }
    for (const file of files) {
      if (attachments.some(item => item.fileName === file.name)) continue;
      const id = `device:${heading.id}:${++localSequence}`;
      deviceFiles.set(id, file);
      addOption({ id, fileName: file.name }, { linked: true });
    }
    if (!checkboxes.length) {
      list.append(empty);
    }
  } catch (cause) {
    error.textContent = cause?.message || "Não foi possível consultar a bandeja.";
    error.hidden = false;
  }
  confirm.disabled = !checkboxes.some(input => !input.disabled);
  actions.append(cancel, search, confirm);
  panel.append(heading, info, list, sources, error, actions);
  overlay.append(panel);
  overlay.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key === "Tab") {
      event.stopPropagation();
      const controls = [...panel.querySelectorAll("button:not([disabled]),input:not([disabled])")]
        .filter(node => !node.closest("[hidden]"));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  root.append(overlay);
  (checkboxes.find(input => !input.disabled) || cancel).focus();
  return { close };
}
