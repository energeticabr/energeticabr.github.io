export const CAMERA_STATUS_ALERTS_ENABLED_PREFIX = "energetico:camera-status-alerts-enabled:v1:";
const CAMERA_STATUS_CURSOR_PREFIX = "energetico:camera-status-alerts-cursor:v1:";

function accountStorageKey(prefix, accountKey) {
  const account = String(accountKey || "").trim();
  return account ? `${prefix}${encodeURIComponent(account)}` : "";
}

export function cameraStatusAlertsEnabled(accountKey, storage = globalThis.localStorage) {
  const key = accountStorageKey(CAMERA_STATUS_ALERTS_ENABLED_PREFIX, accountKey);
  if (!key || !storage) return false;
  try { return storage.getItem(key) === "1"; }
  catch { return false; }
}

export function setCameraStatusAlertsEnabled(accountKey, enabled, storage = globalThis.localStorage) {
  const key = accountStorageKey(CAMERA_STATUS_ALERTS_ENABLED_PREFIX, accountKey);
  if (!key || !storage) return false;
  try {
    if (enabled) storage.setItem(key, "1");
    else storage.removeItem(key);
    return true;
  } catch { return false; }
}

export function createCameraStatusNotifications({
  listEvents,
  notify,
  storage = globalThis.localStorage,
  intervalMs = 60_000,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
  documentRef = globalThis.document,
} = {}) {
  let accountKey = "";
  let timer = null;
  let currentRequest = null;
  let revision = 0;
  let visibilityListener = null;
  const memoryCursors = new Map();

  function readCursor(key) {
    const storageKey = accountStorageKey(CAMERA_STATUS_CURSOR_PREFIX, key);
    if (!storageKey) return null;
    try {
      const value = storage ? JSON.parse(storage.getItem(storageKey) || "null") : memoryCursors.get(storageKey);
      return value && /^[a-f0-9]{32}$/.test(value.generation || "")
        && Number.isSafeInteger(value.cursor) && value.cursor >= 0 ? value : memoryCursors.get(storageKey) || null;
    } catch { return memoryCursors.get(storageKey) || null; }
  }

  function writeCursor(key, generation, cursor) {
    const storageKey = accountStorageKey(CAMERA_STATUS_CURSOR_PREFIX, key);
    if (!storageKey) return false;
    const value = { generation, cursor };
    memoryCursors.set(storageKey, value);
    try { storage?.setItem(storageKey, JSON.stringify(value)); } catch { /* Session memory still prevents repeat alerts. */ }
    return true;
  }

  async function poll({ force = false } = {}) {
    const activeAccount = accountKey;
    const activeRevision = revision;
    if (!activeAccount || typeof listEvents !== "function") return false;
    if (currentRequest && !force) return false;
    if (currentRequest && force) currentRequest.abort();
    const controller = new AbortController();
    currentRequest = controller;
    try {
      const previous = readCursor(activeAccount);
      const result = await listEvents({ ...(previous === null ? {} : { after: previous.cursor }),
        signal: controller.signal });
      if (activeRevision !== revision || controller.signal.aborted) return false;
      if (!Number.isSafeInteger(result?.cursor) || result.cursor < 0 || !Array.isArray(result.events)
        || result.events.length > 100 || !/^[a-f0-9]{32}$/.test(result?.generation || "")) return false;
      if (previous === null || previous.generation !== result.generation || result.cursor < previous.cursor) {
        writeCursor(activeAccount, result.generation, result.cursor);
        return true;
      }
      let cursor = previous.cursor;
      for (const event of result.events) {
        if (activeRevision !== revision || controller.signal.aborted) return false;
        if (!Number.isSafeInteger(event?.id) || event.id <= cursor) continue;
        let notified;
        try { notified = await notify?.(event); } catch { notified = false; }
        if (notified === false) return false;
        if (activeRevision !== revision || controller.signal.aborted) return false;
        cursor = event.id;
        writeCursor(activeAccount, result.generation, cursor);
      }
      if (!result.events.length || result.cursor > cursor) {
        writeCursor(activeAccount, result.generation, Math.max(cursor, result.cursor));
      }
      return true;
    } catch {
      return false;
    } finally {
      if (currentRequest === controller) currentRequest = null;
    }
  }

  function stop() {
    revision++;
    accountKey = "";
    if (timer !== null) clearIntervalImpl?.(timer);
    timer = null;
    if (visibilityListener) documentRef?.removeEventListener?.("visibilitychange", visibilityListener);
    visibilityListener = null;
    currentRequest?.abort();
    currentRequest = null;
  }

  function start(nextAccountKey) {
    stop();
    accountKey = String(nextAccountKey || "").trim();
    if (!accountKey || typeof listEvents !== "function") return false;
    timer = setIntervalImpl?.(() => { void poll(); }, Math.max(10_000, Number(intervalMs) || 60_000)) ?? null;
    timer?.unref?.();
    visibilityListener = () => { if (!documentRef?.hidden) void poll({ force: true }); };
    documentRef?.addEventListener?.("visibilitychange", visibilityListener);
    void poll();
    return true;
  }

  return Object.freeze({ start, stop, poll });
}
