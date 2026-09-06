import { validateAttachment } from "../chat/file-policy.js";

function safeFileName(value) {
  return String(value || "arquivo")
    .replace(/[\\/:*?"<>|\r\n]/g, "-")
    .slice(0, 180) || "arquivo";
}

export function selectBrowserFiles({ documentRef, accept = "", capture = "", multiple = false }) {
  if (!documentRef?.createElement || !documentRef.body?.append) {
    throw new Error("O navegador não oferece seleção de arquivos.");
  }
  return new Promise(resolve => {
    const input = documentRef.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    if (capture) input.setAttribute("capture", capture);
    input.hidden = true;
    const finish = files => {
      input.remove();
      resolve(Array.from(files || []));
    };
    input.addEventListener("change", () => finish(input.files), { once: true });
    input.addEventListener("cancel", () => finish([]), { once: true });
    documentRef.body.append(input);
    input.click();
  });
}

export function createBrowserPorts({
  documentRef = globalThis.document,
  navigatorRef = globalThis.navigator,
  urlApi = globalThis.URL,
  FileCtor = globalThis.File,
  selectFiles = options => selectBrowserFiles({ documentRef, ...options }),
} = {}) {
  async function validatedSelection(options) {
    const files = Array.from(await selectFiles(options) || []);
    files.forEach(file => validateAttachment(file));
    return files;
  }

  async function capturePhoto() {
    return validatedSelection({ accept: "image/*", capture: "environment", multiple: false });
  }

  async function pickDocuments() {
    return validatedSelection({ accept: "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt", multiple: true });
  }

  async function exportMedia(blob, fileName) {
    const name = safeFileName(fileName);
    const file = new FileCtor([blob], name, { type: blob.type || "application/octet-stream" });
    if (navigatorRef?.share && navigatorRef?.canShare?.({ files: [file] })) {
      await navigatorRef.share({ title: name, files: [file] });
      return "shared";
    }
    const href = urlApi.createObjectURL(blob);
    try {
      const anchor = documentRef.createElement("a");
      anchor.href = href;
      anchor.download = name;
      documentRef.body.append(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      urlApi.revokeObjectURL(href);
    }
    return "downloaded";
  }

  return Object.freeze({
    capturePhoto,
    pickDocuments,
    importSharedItems: async () => [],
    discardSharedItem: async () => false,
    exportMedia,
  });
}
