export const MAX_UPLOAD_BYTES = 60_000_000;

const BLOCKED_EXTENSIONS = new Set([
  "apk", "bat", "cmd", "com", "cpl", "dll", "dmg", "exe", "hta", "jar", "js",
  "lnk", "msi", "pkg", "pl", "ps1", "py", "pyw", "rb", "reg", "scr", "sh",
  "vbe", "vbs", "wsf", "wsh",
]);

const BLOCKED_MIME_TYPES = new Set([
  "application/x-dosexec",
  "application/x-executable",
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-sh",
  "text/x-python",
  "text/x-shellscript",
]);

export function validateAttachment(file, { maxBytes = MAX_UPLOAD_BYTES } = {}) {
  if (!file || typeof file.size !== "number" || !Number.isFinite(file.size) || file.size <= 0) {
    throw new Error("O arquivo selecionado está vazio.");
  }
  if (file.size > maxBytes) {
    throw new Error("O arquivo ultrapassa o limite de 60 MB.");
  }

  const fileName = String(file.name || "").trim();
  if (!fileName || fileName.length > 180 || /[\r\n]/.test(fileName)) {
    throw new Error("O nome do arquivo é inválido.");
  }

  const extension = fileName.includes(".") ? fileName.split(".").at(-1).toLowerCase() : "";
  const mimeType = String(file.type || "application/octet-stream").trim().toLowerCase();
  if (BLOCKED_EXTENSIONS.has(extension) || BLOCKED_MIME_TYPES.has(mimeType)) {
    throw new Error("Tipo de arquivo não permitido.");
  }

  return fileName;
}
