export function createNavigationFeedback() {
  let pending;
  const set = feedback => {
    if (!feedback?.entityId || !feedback?.message) return;
    pending = Object.freeze({ entityId: String(feedback.entityId), message: String(feedback.message) });
  };
  const consume = entityId => {
    if (!pending || pending.entityId !== String(entityId)) return undefined;
    const current = { message: pending.message };
    pending = undefined;
    return Object.freeze(current);
  };
  return Object.freeze({ set, consume });
}
