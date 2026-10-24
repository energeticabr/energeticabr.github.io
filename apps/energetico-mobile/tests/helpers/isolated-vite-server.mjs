import { createServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

// Concurrent fixtures with different Vite options must not invalidate each
// other's optimized dependencies with HTTP 504 "Outdated Optimize Dep".
export async function createIsolatedViteServer(options) {
  const temporaryRoot = resolve(tmpdir());
  const cacheDir = await mkdtemp(join(temporaryRoot, 'energetico-vite-'));
  async function cleanup() {
    if (dirname(resolve(cacheDir)) !== temporaryRoot || !basename(cacheDir).startsWith('energetico-vite-')) {
      throw new Error('Cache de teste fora da pasta temporária.');
    }
    await rm(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  }
  let server;
  try { server = await createServer({ ...options, cacheDir }); }
  catch (error) { await cleanup(); throw error; }
  const close = server.close.bind(server);
  server.close = async () => { try { await close(); } finally { await cleanup(); } };
  return server;
}
