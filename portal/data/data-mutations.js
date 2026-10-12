// Shared by Graph clients and controller-injected services. Notify before a
// write and when it settles: the server may commit even if the response is lost.
const listeners = new Set();
export function subscribeDataMutations(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notifyDataMutation() {
  for (const listener of listeners) {
    try { listener(); } catch { /* Observers must not affect a write's result. */ }
  }
}
