// Keep this shared report helper loadable in a plain browser, including pages
// served without a bundler/import map. Capacitor installs its runtime globally;
// resolve the plugin only when a native report actually requests rotation.
const nativeScreenOrientation = {
  async lock(options) { return (await import('@capacitor/screen-orientation')).ScreenOrientation.lock(options); },
  async unlock() { return (await import('@capacitor/screen-orientation')).ScreenOrientation.unlock(); },
};

// CSS can rotate a report, but only native orientation rotates the OS keyboard.
// Share one lock across all visible reports, including reports opened on top of
// another. Serialize the bridge calls so a late lock cannot overtake a close.
export function createReportOrientationController({
  isNative = () => globalThis.Capacitor?.isNativePlatform?.() === true,
  screenOrientation = nativeScreenOrientation,
} = {}) {
  const documents = new Map();
  let requested = false, applied = false, pending = Promise.resolve();

  function update() {
    const visible = [...documents.values()].some(({ roots }) =>
      [...roots].some(root => root.isConnected && !root.closest('[hidden]')));
    if (visible === requested) return pending;
    requested = visible;
    pending = pending.then(() => {
      // An earlier bridge call can outlive several opens/closes. Reconcile
      // with the latest visibility rather than replaying obsolete rotations.
      if (requested === applied) return;
      applied = requested;
      return applied ? screenOrientation.lock({ orientation: 'landscape' }) : screenOrientation.unlock();
    }).catch(() => {
      // The system may deny rotation (e.g. tablet multitasking). Keep the CSS
      // fallback usable; still unlock on close because lock can change the
      // supported-orientation mask before a geometry request is rejected.
    });
    return pending;
  }

  return Object.freeze({ bind(root) {
    if (!isNative()) return Object.freeze({ update() {}, destroy() {} });
    const doc = root.ownerDocument;
    let entry = documents.get(doc), destroyed = false;
    if (!entry) {
      const observer = new doc.defaultView.MutationObserver(update);
      observer.observe(doc.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'],
      });
      entry = { roots: new Set(), observer };
      documents.set(doc, entry);
    }
    entry.roots.add(root);
    update();
    return Object.freeze({
      update() { if (!destroyed) return update(); },
      destroy() {
        if (destroyed) return pending;
        destroyed = true;
        entry.roots.delete(root);
        if (!entry.roots.size) { entry.observer.disconnect(); documents.delete(doc); }
        return update();
      },
    });
  } });
}

export const reportOrientation = createReportOrientationController();
