import { createAppleClient } from './app-store-submission.mjs';
import { attachLatestTestFlightBuild } from './attach-testflight-build.mjs';

if (process.env.APP_STORE_BUILD !== '1936') throw new Error('Recovery is restricted to build 1936.');
const client = createAppleClient(process.env, (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }));
const scoped = {
  async request(method, path, payload) {
    if (method === 'GET' && path.startsWith('/v1/builds?')) {
      const query = new URL(path, 'https://api.appstoreconnect.apple.com');
      query.searchParams.set('filter[version]', '1936');
      query.searchParams.set('limit', '5');
      path = query.pathname + query.search;
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await client.request(method, path, payload);
      } catch (error) {
        if (method !== 'GET' || attempt >= 3 || !/timeout|timed out|aborted/i.test(String(error?.message || error))) throw error;
        console.log(`Read timeout; retry ${attempt}/2.`);
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
    }
  },
};
console.log(JSON.stringify(await attachLatestTestFlightBuild(scoped)));
