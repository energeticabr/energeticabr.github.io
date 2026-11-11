import { createDdaSyncSession } from './dda-sync-session.js';

/** Reuses the durable bank protocol with a separate queue, storage and receipt copy. */
export function createSicoobSyncSession({ client, ...options }) {
  return createDdaSyncSession({ ...options, source: 'sicoob', client: {
    refreshDda: options => client.refreshSicoob(options),
    getDdaRefreshStatus: (id, options) => client.getSicoobRefreshStatus(id, options),
    getDdaRefreshPending: options => client.getSicoobRefreshPending(options),
    acknowledgeDdaRefresh: (id, options) => client.acknowledgeSicoobRefresh(id, options),
  } });
}
