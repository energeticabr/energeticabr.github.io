// Keep this shared orientation helper loadable in a plain browser, including
// pages served without a bundler/import map. Capacitor installs its runtime
// globally; resolve the plugin only when a native screen requests orientation.
const nativeScreenOrientation = {
  async lock(options) { return (await import('@capacitor/screen-orientation')).ScreenOrientation.lock(options); },
};

// CSS can rotate a report, but only native orientation rotates the OS keyboard.
// Share one native lock across reports and camera players. Serialize bridge
// calls so a late lock cannot overtake a close or player replacement.
export function createReportOrientationController({
  isNative = () => globalThis.Capacitor?.isNativePlatform?.() === true,
  screenOrientation = nativeScreenOrientation,
} = {}) {
  const documents = new Map();
  const transitions = new Set();
  let requested = 'portrait', applied = 'portrait', pending = Promise.resolve();

  function update() {
    const reportVisible = transitions.size > 0 || [...documents.values()].some(({ roots }) =>
      [...roots].some(root => root.isConnected && !root.closest('[hidden]')));
    const cameraPlayerVisible = [...documents.values()].some(({ cameraRoots }) =>
      [...cameraRoots].some(root => root.isConnected && root.querySelector('.cameras-player')));
    const orientation = reportVisible ? 'landscape' : cameraPlayerVisible ? 'any' : 'portrait';
    if (orientation === requested) return pending;
    requested = orientation;
    pending = pending.then(() => {
      // An earlier bridge call can outlive several opens/closes. Reconcile
      // with the latest visibility rather than replaying obsolete rotations.
      if (requested === applied) return;
      applied = requested;
      // Reports control their orientation; cameras follow the device sensor
      // only while a player is open. Every other screen remains portrait.
      return screenOrientation.lock({ orientation: applied });
    }).catch(() => {
      // The system may deny rotation (e.g. tablet multitasking). Keep the CSS
      // fallback usable and restore portrait on close when the system allows it.
    });
    return pending;
  }

  function bindRoot(root, collectionName) {
    if (!isNative()) return Object.freeze({ update() {}, destroy() {} });
    const doc = root.ownerDocument;
    let entry = documents.get(doc), destroyed = false;
    if (!entry) {
      const observer = new doc.defaultView.MutationObserver(update);
      observer.observe(doc.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'],
      });
      entry = { roots: new Set(), cameraRoots: new Set(), observer };
      documents.set(doc, entry);
    }
    const roots = entry[collectionName];
    roots.add(root);
    update();
    return Object.freeze({
      update() { if (!destroyed) return update(); },
      destroy() {
        if (destroyed) return pending;
        destroyed = true;
        roots.delete(root);
        if (!entry.roots.size && !entry.cameraRoots.size) {
          entry.observer.disconnect();
          documents.delete(doc);
        }
        return update();
      },
    });
  }

  return Object.freeze({
    // Navigation closes the source before asynchronously building its neighbor.
    // Retain landscape across that gap, without rotating a browser or a route
    // that did not already own native report orientation.
    beginTransition() {
      if (requested !== 'landscape') return () => pending;
      const transition = {};
      transitions.add(transition);
      return () => {
        if (!transitions.delete(transition)) return pending;
        return update();
      };
    },
    bind(root) { return bindRoot(root, 'roots'); },
    bindCameraPlayer(root) { return bindRoot(root, 'cameraRoots'); },
  });
}

export const reportOrientation = createReportOrientationController();
