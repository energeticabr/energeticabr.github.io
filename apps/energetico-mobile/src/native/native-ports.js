import { Camera, CameraResultType, CameraSource, MediaTypeSelection } from "@capacitor/camera";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";

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
  app = App,
  localNotifications = LocalNotifications,
  fetchImpl = globalThis.fetch,
  FileCtor = globalThis.File,
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)
    || (() => `${Date.now()}-${Math.random().toString(16).slice(2)}`),
  cacheDirectory = Directory.Cache,
} = {}) {
  if (typeof FileCtor !== "function") throw new TypeError("O dispositivo não oferece arquivos compatíveis.");

  async function readMediaBlob(media, fallbackType = "image/jpeg") {
    const sources = [media?.webPath, media?.uri, media?.path].filter(Boolean);
    let lastError = null;
    for (const source of sources) {
      try {
        const response = await fetchImpl(source);
        if (!response.ok) throw new Error("Não foi possível ler a mídia selecionada.");
        return await response.blob();
      } catch (error) {
        lastError = error;
      }
    }
    const path = media?.path || media?.uri;
    if (path) {
      try {
        const contents = await filesystem.readFile({ path });
        return dataToBlob(contents.data, media?.metadata?.format ? `image/${media.metadata.format}` : fallbackType);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Não foi possível ler a mídia selecionada.");
  }

  function mediaFormat(media, blob, fallback = "jpeg") {
    return String(media?.metadata?.format || media?.format || fallback).toLowerCase().replace(/^\./, "")
      || String(blob?.type || "").split("/").at(-1)
      || fallback;
  }

  async function capturePhoto() {
    try {
      const photo = typeof camera.takePhoto === "function"
        ? await camera.takePhoto({ quality: 85, correctOrientation: true, saveToGallery: false })
        : await camera.getPhoto({
          quality: 85,
          resultType: CameraResultType.Uri,
          source: CameraSource.Camera,
          correctOrientation: true,
          saveToGallery: false,
        });
      const blob = await readMediaBlob(photo);
      const id = String(randomUUID());
      const format = mediaFormat(photo, blob);
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

  async function pickPhotos() {
    try {
      const result = typeof camera.chooseFromGallery === "function"
        ? await camera.chooseFromGallery({
          mediaType: MediaTypeSelection.Photo,
          allowMultipleSelection: true,
          limit: 20,
          quality: 85,
          correctOrientation: true,
        })
        : await camera.pickImages({ quality: 85, correctOrientation: true, limit: 20 });
      const files = [];
      const items = result?.results || result?.photos || [];
      for (const item of items) {
        const blob = await readMediaBlob(item);
        const id = String(randomUUID());
        const format = mediaFormat(item, blob);
        files.push(makeFile(blob, {
          id,
          name: `foto-${id}.${format}`,
          type: blob.type || `image/${format}`,
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
      // The extension stages bytes before the user presses Add. Do not submit
      // an unapproved selection just because the containing app became active.
      if (item.state === "staged") continue;
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

  const flowReminderId = 74501;
  const provisionReminderId = 74502;

  async function scheduleFlowReminder({ title = "", body = "", delayMs = 300_000 } = {}) {
    if (typeof localNotifications?.schedule !== "function") return false;
    try {
      const checked = typeof localNotifications.checkPermissions === "function"
        ? await localNotifications.checkPermissions()
        : { display: "granted" };
      const permissions = checked?.display === "prompt"
        && typeof localNotifications.requestPermissions === "function"
        ? await localNotifications.requestPermissions()
        : checked;
      if (permissions?.display && permissions.display !== "granted") return false;
      await localNotifications.cancel({ notifications: [{ id: flowReminderId }] }).catch(() => {});
      await localNotifications.schedule({
        notifications: [{
          id: flowReminderId,
          title: String(title || "Energético"),
          body: String(body || "O fluxo está aguardando finalização."),
          schedule: { at: new Date(Date.now() + Math.max(1_000, Number(delayMs) || 300_000)) },
          extra: { kind: "active-flow-reminder" },
        }],
      });
      return true;
    } catch {
      return false;
    }
  }

  async function cancelFlowReminder() {
    if (typeof localNotifications?.cancel !== "function") return false;
    try {
      await localNotifications.cancel({ notifications: [{ id: flowReminderId }] });
      return true;
    } catch {
      return false;
    }
  }

  async function scheduleProvisionReminder({ title = "Energético", body = "Há provisões de pagamento vencidas ou com vencimento hoje.", delayMs = 7_200_000 } = {}) {
    if (typeof localNotifications?.schedule !== "function") return false;
    try {
      const checked = typeof localNotifications.checkPermissions === "function"
        ? await localNotifications.checkPermissions()
        : { display: "granted" };
      const permissions = checked?.display === "prompt"
        && typeof localNotifications.requestPermissions === "function"
        ? await localNotifications.requestPermissions()
        : checked;
      if (permissions?.display && permissions.display !== "granted") return false;
      await localNotifications.cancel({ notifications: [{ id: provisionReminderId }] }).catch(() => {});
      await localNotifications.schedule({
        notifications: [{
          id: provisionReminderId,
          title: String(title || "Energético"),
          body: String(body || "Há provisões de pagamento pendentes."),
          schedule: { at: new Date(Date.now() + Math.max(1_000, Number(delayMs) || 7_200_000)) },
          extra: { kind: "pending-provision-reminder" },
        }],
      });
      return true;
    } catch {
      return false;
    }
  }

  async function cancelProvisionReminder() {
    if (typeof localNotifications?.cancel !== "function") return false;
    try {
      await localNotifications.cancel({ notifications: [{ id: provisionReminderId }] });
      return true;
    } catch {
      return false;
    }
  }

  return Object.freeze({
    async onResume(handler, onBackground) {
      const listener = await app.addListener("appStateChange", event => {
        if (event.isActive) return handler();
        return onBackground?.();
      });
      return () => listener.remove();
    },
    capturePhoto,
    pickPhotos,
    pickDocuments,
    importSharedItems,
    discardSharedItem,
    exportMedia,
    scheduleFlowReminder,
    cancelFlowReminder,
    scheduleProvisionReminder,
    cancelProvisionReminder,
  });
}
