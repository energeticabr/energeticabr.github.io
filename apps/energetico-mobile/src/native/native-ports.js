import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

import { validateAttachment } from "../chat/file-policy.js";
import { DocumentPicker, ShareInbox } from "./plugins.js";

export class NativePermissionError extends Error {
  constructor(message = "Permissão negada pelo iPhone.") {
    super(message);
    this.name = "NativePermissionError";
    this.code = "NATIVE_PERMISSION_DENIED";
  }
}

function isCancellation(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code.includes("cancel") || message.includes("cancelled") || message.includes("canceled");
}

function normalizeNativeError(error) {
  if (isCancellation(error)) return null;
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  if (code.includes("permission") || message.includes("denied") || message.includes("permiss")) {
    return new NativePermissionError();
  }
  return error instanceof Error ? error : new Error("O iPhone não concluiu a operação.");
}

function base64ToBytes(value) {
  const decoded = globalThis.atob(String(value || ""));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return globalThis.btoa(binary);
}

async function blobToBase64(blob) {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

function makeFile(blob, metadata, { FileCtor, randomUUID }) {
  const id = String(metadata.id || randomUUID());
  const type = String(metadata.type || blob.type || "application/octet-stream");
  const name = String(metadata.name || `arquivo-${id}`);
  const file = new FileCtor([blob], name, { type, lastModified: Date.now() });
  Object.defineProperties(file, {
    id: { value: id, enumerable: true },
    sourceId: { value: metadata.sourceId || null, enumerable: true },
    confirmedResult: { value: metadata.confirmedResult || null, enumerable: true },
  });
  validateAttachment(file);
  return file;
}

export function createNativePorts({
  camera = Camera,
  documentPicker = DocumentPicker,
  filesystem = Filesystem,
  shareInbox = ShareInbox,
  share = Share,
  fetchImpl = globalThis.fetch,
  FileCtor = globalThis.File,
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)
    || (() => `${Date.now()}-${Math.random().toString(16).slice(2)}`),
  cacheDirectory = Directory.Cache,
} = {}) {
  if (typeof FileCtor !== "function") throw new TypeError("O dispositivo não oferece arquivos compatíveis.");

  async function capturePhoto() {
    try {
      const photo = await camera.getPhoto({
        quality: 85,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
        correctOrientation: true,
        saveToGallery: false,
      });
      const source = photo.webPath || photo.path;
      if (!source) throw new Error("A câmera não devolveu a foto.");
      const response = await fetchImpl(source);
      if (!response.ok) throw new Error("Não foi possível ler a foto tirada.");
      const blob = await response.blob();
      const id = String(randomUUID());
      const format = String(photo.format || "jpeg").toLowerCase();
      return [makeFile(blob, {
        id,
        name: `foto-${id}.${format}`,
        type: blob.type || `image/${format}`,
      }, { FileCtor, randomUUID })];
    } catch (error) {
      const normalized = normalizeNativeError(error);
      if (!normalized) return [];
      throw normalized;
    }
  }

  async function dataToBlob(data, type) {
    if (data instanceof Blob) return data;
    if (data?.blob instanceof Blob) return data.blob;
    return new Blob([base64ToBytes(data)], { type });
  }

  async function pickDocuments() {
    try {
      const result = await documentPicker.pick({ multiple: true });
      const files = [];
      for (const item of result?.items || []) {
        validateAttachment({ name: item.name, size: item.size, type: item.type });
        const contents = item.data
          ? { data: item.data }
          : await filesystem.readFile({ path: item.uri });
        const blob = await dataToBlob(contents.data, item.type || "application/octet-stream");
        files.push(makeFile(blob, {
          id: item.id || randomUUID(),
          name: item.name,
          type: item.type,
        }, { FileCtor, randomUUID }));
      }
      return files;
    } catch (error) {
      const normalized = normalizeNativeError(error);
      if (!normalized) return [];
      throw normalized;
    }
  }

  async function importSharedItems() {
    const result = await shareInbox.list();
    const files = [];
    for (const item of result?.items || []) {
      validateAttachment({ name: item.name, size: item.size, type: item.type });
      const contents = await shareInbox.read({ id: item.id });
      const blob = await dataToBlob(contents.data, item.type || "application/octet-stream");
      files.push(makeFile(blob, {
        id: item.id,
        sourceId: item.id,
        name: item.name,
        type: item.type,
        confirmedResult: item.confirmedResult,
      }, { FileCtor, randomUUID }));
    }
    return files;
  }

  async function discardSharedItem(id) {
    if (!String(id || "").trim()) throw new Error("Identificador compartilhado inválido.");
    await shareInbox.remove({ id: String(id) });
  }

  async function exportMedia(blob, fileName) {
    const safeName = String(fileName || "arquivo")
      .replace(/[\\/:*?"<>|\r\n]/g, "-")
      .slice(0, 180);
    const written = await filesystem.writeFile({
      path: safeName,
      data: await blobToBase64(blob),
      directory: cacheDirectory,
      recursive: true,
    });
    await share.share({ title: safeName, files: [written.uri] });
    return written.uri;
  }

  return Object.freeze({
    capturePhoto,
    pickDocuments,
    importSharedItems,
    discardSharedItem,
    exportMedia,
  });
}
