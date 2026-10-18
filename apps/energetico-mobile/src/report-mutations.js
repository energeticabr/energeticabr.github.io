import { notifyDataMutation } from '../../../portal/data/data-mutations.js';

const WRITES = new Set([
  'saveEditor', 'deleteItem', 'deleteDescription', 'updateItem', 'updateDueDate', 'uploadAttachment',
  'savePayment', 'saveSheet', 'save', 'post', 'linkPayroll',
  'sendText', 'sendFile', 'saveRhidAttendanceAdjustment', 'refreshRhidAttendance',
  'startRhidPendingValidation', 'completeDelegatedTask', 'uploadLaunchGalleryFile',
  'deleteAttachment', 'deleteAllAttachments', 'compressAttachment', 'chooseAttachmentCompression',
  'prepareSignatureEvidence', 'captureSignatureEvidence', 'confirmSignatureEvidence',
]);
const GALLERY_READS = new Set(['snapshot', 'detail', 'schema', 'attachment']);

// Proxy an empty facade, not the (often frozen) service itself, so methods can
// be decorated without violating frozen property invariants. Resolve methods
// on access to preserve injected services that install or replace them later.
export function observeReportMutations(source) {
  if (!source) return source;
  return new Proxy({}, {
    get(_target, method) {
      const operation = source[method];
      if (typeof operation !== 'function') return operation;
      return function (...args) {
        const menuNavigation = method === 'sendText' && args[0]?.replyId === 'portal_confirm_main_menu'
          && !args[0]?.text && !args[0]?.homeAttachmentIds?.length;
        if (menuNavigation || (!WRITES.has(method) && !(method === 'launchGalleryRequest' && !GALLERY_READS.has(args[0])))) {
          return operation.apply(source, args);
        }
        notifyDataMutation();
        try { return Promise.resolve(operation.apply(source, args)).finally(notifyDataMutation); }
        catch (error) { notifyDataMutation(); throw error; }
      };
    },
    ownKeys: () => Reflect.ownKeys(source),
    getOwnPropertyDescriptor: (_target, key) => Object.hasOwn(source, key)
      ? { configurable: true, enumerable: Object.getOwnPropertyDescriptor(source, key).enumerable } : undefined,
  });
}

export function observeReportMutationFactory(factory) {
  return async (...args) => observeReportMutations(await factory(...args));
}
