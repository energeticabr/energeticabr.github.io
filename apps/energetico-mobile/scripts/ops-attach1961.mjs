import { createAppleClient } from './app-store-submission.mjs';
import { attachLatestTestFlightBuild } from './attach-testflight-build.mjs';

if (process.env.APP_STORE_BUILD !== '1961') throw new Error('Recovery is restricted to build 1961.');
const client = createAppleClient(process.env, (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }));
let targetBuildId = '';
const scoped = {
  async request(method, path, payload) {
    const groupWrite = method === 'POST' && /^\/v1\/betaGroups\/([^/]+)\/relationships\/builds$/.exec(path);
    if (groupWrite) {
      if (!targetBuildId || payload?.data?.length !== 1 || payload.data[0]?.id !== targetBuildId) throw new Error('Unexpected build association blocked.');
      path = `/v1/builds/${targetBuildId}/relationships/betaGroups`;
      payload = { data: [{ type: 'betaGroups', id: groupWrite[1] }] };
    }
    if (method === 'GET' && path.startsWith('/v1/builds?')) {
      const query = new URL(path, 'https://api.appstoreconnect.apple.com');
      query.searchParams.set('filter[version]', '1961');
      query.searchParams.set('limit', '5');
      path = query.pathname + query.search;
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await client.request(method, path, payload);
        if (method === 'GET' && path.startsWith('/v1/builds?')) targetBuildId = response.data?.find(build => build.attributes?.version === '1961')?.id || '';
        return response;
      } catch (error) {
        if (method !== 'GET' || attempt >= 3 || !/timeout|timed out|aborted/i.test(String(error?.message || error))) throw error;
        console.log(`Read timeout; retry ${attempt}/2.`);
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
    }
  },
};
console.log(JSON.stringify(await attachLatestTestFlightBuild(scoped)));
