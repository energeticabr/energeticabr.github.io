export const CAMERA_STATUS_ALERTS_ENABLED_PREFIX = "energetico:camera-status-alerts-enabled:v1:";
const CAMERA_STATUS_CURSOR_PREFIX = "energetico:camera-status-alerts-cursor:v1:";

function accountStorageKey(prefix, accountKey) {
  const account = String(accountKey || "").trim();
  return account ? `${prefix}${encodeURIComponent(account)}` : "";
}

function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage; }
  catch { return null; }
}

export function cameraStatusAlertsEnabled(accountKey, storage) {
  const key = accountStorageKey(CAMERA_STATUS_ALERTS_ENABLED_PREFIX, accountKey);
  if (!key) return false;
  try { return resolveStorage(storage)?.getItem(key) === "1"; }
  catch { return false; }
}

export function setCameraStatusAlertsEnabled(accountKey, enabled, storage) {
  const key = accountStorageKey(CAMERA_STATUS_ALERTS_ENABLED_PREFIX, accountKey);
  if (!key) return false;
  try {
    const target = resolveStorage(storage);
    if (!target) return false;
    if (enabled) target.setItem(key, "1");
    else target.removeItem(key);
    return true;
  } catch { return false; }
}

function validCursor(value) {
  return value && /^[a-f0-9]{32}$/.test(value.generation || "")
    && Number.isSafeInteger(value.cursor) && value.cursor >= 0 ? value : null;
}

export function createCameraStatusNotifications({
  listEvents,
  notify,
  onAuthError,
  storage,
  intervalMs = 60_000,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
  documentRef = globalThis.document,
} = {}) {
  const cursorStorage = resolveStorage(storage);
  let accountKey = "";
  let timer = null;
  let currentRequest = null;
  let revision = 0;
  let visibilityListener = null;
  let active = false;
  let suspended = true;
  let resumePollQueued = false;
  const memoryCursors = new Map();
  const dirtyCursors = new Set();

  function readCursor(key) {
    const storageKey = accountStorageKey(CAMERA_STATUS_CURSOR_PREFIX, key);
    if (!storageKey) return null;
    const memory = validCursor(memoryCursors.get(storageKey));
    if (dirtyCursors.has(storageKey) && memory) return memory;
    try {
      const persisted = validCursor(cursorStorage ? JSON.parse(cursorStorage.getItem(storageKey) || "null") : null);
      if (persisted) return persisted;
    } catch { /* Use the in-memory cursor if storage is unavailable. */ }
    return memory;
  }

  function writeCursor(key, generation, cursor) {
    const storageKey = accountStorageKey(CAMERA_STATUS_CURSOR_PREFIX, key);
    if (!storageKey) return false;
    const value = { generation, cursor };
    memoryCursors.set(storageKey, value);
    try {
      if (!cursorStorage) throw new Error("Persistent storage unavailable");
      cursorStorage.setItem(storageKey, JSON.stringify(value));
      dirtyCursors.delete(storageKey);
    } catch { dirtyCursors.add(storageKey); }
    return true;
  }

  function clearTimer() {
    if (timer !== null) clearIntervalImpl?.(timer);
    timer = null;
  }

  function startTimer() {
    if (!active || suspended || timer !== null) return;
    timer = setIntervalImpl?.(() => { void poll(); }, Math.max(10_000, Number(intervalMs) || 60_000)) ?? null;
    timer?.unref?.();
  }

  function isCurrent(key, activeRevision) {
    return active && !suspended && accountKey === key && revision === activeRevision;
  }

  async function runPoll(key, activeRevision, controller) {
    try {
      if (!isCurrent(key, activeRevision) || typeof listEvents !== "function") return false;
      const previous = readCursor(key);
      let result = await listEvents({ ...(previous === null ? {} : { after: previous.cursor }),
        signal: controller.signal });
      if (!isCurrent(key, activeRevision) || controller.signal.aborted) return false;
      if (!Number.isSafeInteger(result?.cursor) || result.cursor < 0 || !Array.isArray(result.events)
        || result.events.length > 100 || !/^[a-f0-9]{32}$/.test(result?.generation || "")) return false;

      if (previous !== null && (previous.generation !== result.generation || result.cursor < previous.cursor)) {
        // A replacement queue may already contain multiple pages. An empty
        // cursor request asks the gateway for its current high-water baseline.
        result = await listEvents({ signal: controller.signal });
        if (!isCurrent(key, activeRevision) || controller.signal.aborted) return false;
        if (!Number.isSafeInteger(result?.cursor) || result.cursor < 0 || !Array.isArray(result.events)
          || result.events.length > 100 || !/^[a-f0-9]{32}$/.test(result?.generation || "")
          || result.events.length !== 0) return false;
        writeCursor(key, result.generation, result.cursor);
        return true;
      }

      if (previous === null) {
        writeCursor(key, result.generation, result.cursor);
        return true;
      }

      let cursor = previous.cursor;
      for (const event of result.events) {
        if (!isCurrent(key, activeRevision) || controller.signal.aborted) return false;
        if (!Number.isSafeInteger(event?.id) || event.id <= cursor) continue;
        if (typeof notify !== "function") return false;
        let notified = false;
        try {
          notified = await notify(event, {
            signal: controller.signal,
            isCurrent: () => isCurrent(key, activeRevision),
          });
        } catch { notified = false; }
        if (notified === true) {
          // The OS/browser may have accepted the notification just as the app
          // was suspended or signed out. Save the event to avoid posting it twice.
          cursor = event.id;
          writeCursor(key, result.generation, cursor);
        } else {
          return false;
        }
        if (!isCurrent(key, activeRevision) || controller.signal.aborted) return false;
      }
      if (!result.events.length || result.cursor > cursor) {
        writeCursor(key, result.generation, Math.max(cursor, result.cursor));
      }
      return true;
    } catch (error) {
      if (error?.status === 401 || error?.status === 403 || error?.code === "AUTH_REQUIRED") {
        stop();
        try { onAuthError?.(error); } catch { /* Authentication UI is owned by the app. */ }
      }
      return false;
    }
  }

  function poll() {
    const activeAccount = accountKey;
    const activeRevision = revision;
    if (!active || suspended || !activeAccount || typeof listEvents !== "function") return Promise.resolve(false);
    // Foreground and visibility events can arrive together. Share one in-flight
    // request instead of aborting a notification that is already being posted.
    if (currentRequest) return currentRequest.promise;
    const controller = new AbortController();
    const request = { controller, promise: null };
    currentRequest = request;
    request.promise = runPoll(activeAccount, activeRevision, controller).finally(() => {
      if (currentRequest === request) currentRequest = null;
    });
    return request.promise;
  }

  function suspend() {
    if (!active || suspended) return false;
    suspended = true;
    clearTimer();
    return true;
  }

  function resume() {
    if (!active) return false;
    suspended = false;
    startTimer();
    if (currentRequest) {
      if (!resumePollQueued) {
        resumePollQueued = true;
        currentRequest.promise.finally(() => {
          resumePollQueued = false;
          if (active && !suspended) void poll();
        });
      }
    } else {
      void poll();
    }
    return true;
  }

  function stop() {
    revision++;
    active = false;
    suspended = true;
    accountKey = "";
    clearTimer();
    if (visibilityListener) documentRef?.removeEventListener?.("visibilitychange", visibilityListener);
    visibilityListener = null;
    currentRequest?.controller.abort();
    currentRequest = null;
    resumePollQueued = false;
  }

  function start(nextAccountKey) {
    const normalizedAccountKey = String(nextAccountKey || "").trim();
    if (active && accountKey === normalizedAccountKey && normalizedAccountKey) {
      if (suspended && !documentRef?.hidden) resume();
      return true;
    }
    stop();
    accountKey = normalizedAccountKey;
    if (!accountKey || typeof listEvents !== "function") return false;
    active = true;
    visibilityListener = () => {
      if (documentRef?.hidden) suspend();
      else resume();
    };
    documentRef?.addEventListener?.("visibilitychange", visibilityListener);
    suspended = Boolean(documentRef?.hidden);
    if (!suspended) {
      startTimer();
      void poll();
    }
    return true;
  }

  return Object.freeze({ start, stop, suspend, resume, poll });
}
