export const COMPLETION_RECEIPT_DURATION_MS = 1500;

/** Returns a cancellation function owned by the displayed receipt. */
export function scheduleCompletionDismiss(dismiss) {
  const timer = setTimeout(dismiss, COMPLETION_RECEIPT_DURATION_MS);
  timer?.unref?.();
  return () => clearTimeout(timer);
}
