// Keep this shared report helper loadable in a plain browser, including pages
// served without a bundler/import map. Capacitor installs its runtime globally;
// resolve the plugin only when a native report actually requests rotation.
const nativeScreenOrientation = {
  async lock(options) { return (await import('@capacitor/screen-orientation')).ScreenOrientation.lock(options); },
};

// CSS can rotate a report, but only native orientation rotates the OS keyboard.
// Share one lock across all visible reports, including reports opened on top of
// another. Serialize the bridge calls so a late lock cannot overtake a close.
export function createReportOrientationController({
  isNative = () => globalThis.Capacitor?.isNativePlatform?.() === true,
  screenOrientation = nativeScreenOrientation,
} = {}) {
  const documents = new Map();
  const transitions = new Set();
  let requested = false, applied = false, pending = Promise.resolve();

  function update() {
    const visible = transitions.size > 0 || [...documents.values()].some(({ roots }) =>
      [...roots].some(root => root.isConnected && !root.closest('[hidden]')));
    if (visible === requested) return pending;
    requested = visible;
    pending = pending.then(() => {
      // An earlier bridge call can outlive several opens/closes. Reconcile
      // with the latest visibility rather than replaying obsolete rotations.
      if (requested === applied) return;
      applied = requested;
      // HOME must return to portrait even if the phone is still held sideways.
      // Unlocking here lets the sensor rotate the menu and the next report again.
      return screenOrientation.lock({ orientation: applied ? 'landscape' : 'portrait' });
    }).catch(() => {
      // The system may deny rotation (e.g. tablet multitasking). Keep the CSS
      // fallback usable; still restore portrait on close because lock can change the
      // supported-orientation mask before a geometry request is rejected.
    });
    return pending;
  }

  return Object.freeze({
    // Navigation closes the source before asynchronously building its neighbor.
    // Retain an existing landscape request across that gap, without rotating a
    // browser or a route that did not already own native report orientation.
    beginTransition() {
      if (!requested) return () => pending;
      const transition = {};
      transitions.add(transition);
      return () => {
        if (!transitions.delete(transition)) return pending;
        return update();
      };
    },
    bind(root) {
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
