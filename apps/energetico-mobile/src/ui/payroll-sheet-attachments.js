import { validateAttachment } from "../../../../portal/data/attachments.js";
import { createAttachmentPresenter } from "../../../../portal/ui/attachments-panel.js";
import { openPayrollReceiptPicker } from "./payroll-receipt-picker.js";

/** Local staging only: uploads happen at the authenticated save boundary. */
export function bindPayrollSheetAttachments(form, context, { isBusy, getReceiptAttachments, readReceiptAttachment } = {}) {
  const doc = form.ownerDocument, files = [], saved = [];
  let disposed = false, picker = null;
  const abort = new AbortController();
  const presenter = createAttachmentPresenter({ documentRef: doc, windowRef: doc.defaultView });
  const element = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const tray = element("section", undefined, "payroll-sheet-attachments");
  tray.dataset.sheetAttachments = "";
  const title = element("h3", "📎 Anexos da folha");
  const info = element("p", "Para STATUS INATIVO, anexe o recibo de pagamento de salário da contabilidade assinado. Novos arquivos serão enviados ao SUBMETER.");
  const message = element("p"); message.setAttribute("role", "status"); message.hidden = true;
  const list = element("div", undefined, "payroll-sheet-attachment-list"); list.dataset.sheetAttachmentList = "";
  const inputLabel = element("label", "Adicionar arquivos", "dynamic-field");
  const input = element("input"); input.type = "file"; input.multiple = true; input.dataset.sheetAttachmentInput = "";
  input.accept = ".pdf,.jpg,.jpeg,.jfif,.png,.webp,.doc,.docx,.xls,.xlsx";
  inputLabel.append(input);
  tray.append(title, info, message, list, inputLabel);
  const setMessage = (text, error = false) => {
    if (disposed) return;
    message.textContent = text; message.hidden = !text;
    message.setAttribute("role", error ? "alert" : "status");
    message.classList.toggle("gallery-record-dialog-error", error);
  };
  const key = name => name.trim().toLocaleLowerCase("pt-BR");
  const button = (text, handler) => {
    const node = element("button", text); node.type = "button"; node.disabled = Boolean(isBusy?.());
    node.addEventListener("click", () => { if (!disposed && !isBusy?.()) void handler(); });
    return node;
  };
  function render() {
    if (disposed) return;
    list.replaceChildren();
    for (const file of [...saved, ...files]) {
      const pending = files.includes(file);
      const row = element("article", undefined, "payroll-sheet-attachment");
      const details = element("div");
      details.append(element("strong", file.name), element("small", pending ? "Será enviado ao SUBMETER" : "Salvo nesta folha"));
      const download = button("Baixar", async () => {
        try {
          const bytes = pending ? await file.arrayBuffer() : await context.sheetAttachments.read(file, { signal: abort.signal });
          if (!disposed) presenter.present({ bytes, name: file.name, type: file.type, mode: "download" });
        } catch (error) { setMessage(error.message, true); }
      });
      const actions = element("div", undefined, "payroll-sheet-attachment-actions"); actions.append(download);
      if (pending) {
        const remove = button("Remover", () => { files.splice(files.indexOf(file), 1); render(); });
        remove.dataset.sheetAttachmentRemove = ""; remove.setAttribute("aria-label", "Remover " + file.name);
        actions.append(remove);
      }
      row.append(details, actions); list.append(row);
    }
    if (!list.childElementCount) list.append(element("p", "Nenhum anexo adicionado."));
  }
  function add(selected) {
    if (disposed || isBusy?.()) return;
    try {
      const candidates = [...selected], names = new Set([...saved, ...files].map(file => key(file.name)));
      // Validate the entire batch before staging any of it.
      for (const file of candidates) {
        const validation = validateAttachment(file);
        if (!validation.valid) throw new Error(validation.message);
        if (names.has(key(validation.name))) throw new Error("Já existe um anexo com esse nome nesta folha.");
        names.add(key(validation.name));
      }
      files.push(...candidates); render(); setMessage("Arquivo(s) preparado(s) para envio.");
    } catch (error) { setMessage(error.message, true); }
  }
  const changed = () => { add(input.files || []); input.value = ""; };
  input.addEventListener("change", changed);
  if (typeof getReceiptAttachments === "function" && typeof readReceiptAttachment === "function") {
    const select = button("Selecionar da bandeja do app", () => {
      picker?.close();
      picker = openPayrollReceiptPicker({ root: tray, label: "IDFOLHA " + context.item.id, files: [...saved, ...files],
        getReceiptAttachments, readReceiptAttachment, onConfirm: add, onClose: () => { picker = null; } });
    });
    select.dataset.sheetAttachmentTray = ""; tray.append(select);
  }
  form.querySelector(".dynamic-form-actions").before(tray);
  render(); setMessage("Consultando anexos já salvos…");
  void context.sheetAttachments.list({ signal: abort.signal }).then(result => {
    if (disposed) return;
    saved.splice(0, saved.length, ...result); render(); setMessage("");
  }).catch(error => setMessage(error.message, true));
  return Object.freeze({
    changes: () => [...files],
    refresh: render,
    cleanup() { disposed = true; abort.abort(); picker?.close(); input.removeEventListener("change", changed); presenter.cleanup(); tray.remove(); },
  });
}
