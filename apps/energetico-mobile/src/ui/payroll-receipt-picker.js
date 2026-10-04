import { validateAttachment } from "../../../../portal/data/attachments.js";

let sequence = 0;
export function openPayrollReceiptPicker({
  root, label, files, getReceiptAttachments, readReceiptAttachment, onConfirm, onClose,
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
  const info = create("p", "Selecione os arquivos da bandeja de anexos do app.");
  const list = create("div", undefined, "payroll-receipt-options");
  const error = create("p", undefined, "supplier-payroll-error");
  error.setAttribute("data-receipt-error", "");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const actions = create("div", undefined, "payroll-receipt-actions");
  const cancel = create("button", "Cancelar", "supplier-payroll-button");
  cancel.type = "button";
  cancel.setAttribute("data-receipt-cancel", "");
  const confirm = create("button", "Confirmar", "supplier-payroll-button");
  confirm.type = "button";
  confirm.setAttribute("data-receipt-confirm", "");
  const checkboxes = [];
  const references = new Map();
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
    loading = true;
    confirm.disabled = true;
    confirm.textContent = "Carregando…";
    error.hidden = true;
    for (const input of checkboxes) input.disabled = true;
    try {
      const candidates = [];
      const names = new Set(files.map(file => file.name));
      for (const input of selected) {
        const file = await readReceiptAttachment(input.dataset.receiptId, references.get(input.dataset.receiptId));
        if (closed) return;
        const valid = validateAttachment(file);
        if (!valid.valid) throw new Error(valid.message);
        if (names.has(file.name)) throw new Error("Já existe um comprovante com esse nome na rubrica.");
        names.add(file.name);
        candidates.push(file);
      }
      const current = getReceiptAttachments();
      for (const input of selected) {
        const reference = references.get(input.dataset.receiptId);
        const latest = current.find(item => String(item.id) === input.dataset.receiptId);
        if (!latest || latest.fileName !== reference.fileName || latest.source !== reference.source)
          throw new Error("Um comprovante foi alterado ou removido da bandeja. Abra a seleção novamente.");
      }
      onConfirm(candidates);
      close();
    } catch (cause) {
      if (!closed) {
        error.textContent = cause?.message || "Não foi possível carregar o comprovante. Tente novamente.";
        error.hidden = false;
      }
    } finally {
      if (!closed) {
        loading = false;
        confirm.disabled = false;
        confirm.textContent = "Confirmar";
        for (const input of checkboxes) input.disabled = input.dataset.linked === "true";
      }
    }
  });
  try {
    const attachments = getReceiptAttachments();
    for (const item of attachments) {
      if (!item?.id || !item.fileName) continue;
      const option = create("label", undefined, "payroll-receipt-option");
      const input = create("input");
      input.type = "checkbox";
      input.dataset.receiptId = String(item.id);
      references.set(String(item.id), item);
      const linked = files.some(file => file.name === item.fileName);
      input.disabled = linked;
      input.dataset.linked = String(linked);
      option.append(input, create("span", item.fileName + (linked ? " (já vinculado)" : "")));
      checkboxes.push(input);
      list.append(option);
    }
    if (!checkboxes.length) {
      list.append(create("p", "A bandeja de anexos está vazia. Adicione os comprovantes na bandeja do app e volte para selecioná-los."));
    }
  } catch (cause) {
    error.textContent = cause?.message || "Não foi possível consultar a bandeja.";
    error.hidden = false;
  }
  confirm.disabled = !checkboxes.some(input => !input.disabled);
  actions.append(cancel, confirm);
  panel.append(heading, info, list, error, actions);
  overlay.append(panel);
  overlay.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key === "Tab") {
      event.stopPropagation();
      const controls = [...panel.querySelectorAll("button:not([disabled]),input:not([disabled])")];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  root.append(overlay);
  (checkboxes.find(input => !input.disabled) || cancel).focus();
  return { close };
}
