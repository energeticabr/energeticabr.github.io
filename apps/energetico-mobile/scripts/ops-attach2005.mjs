import { createAppleClient } from './app-store-submission.mjs';
import { attachLatestTestFlightBuild } from './attach-testflight-build.mjs';

const target = Object.freeze({ build: '2012', appId: '6809887853', bundleId: 'br.com.energetica.energetico', group: 'ENERGETICO Validacao',
  mainRunId: '41084289925', mergeSha: '5af9c3db6ab8c0e6d4564bfd18465540b5f28639', sourceSha: '3ff4be30a218aac32505fa0f72f54870e7f9ea6f' });
if (process.env.APP_STORE_BUILD !== target.build) throw new Error('Recovery is restricted to build 2012.');
for (const [name, expected] of Object.entries({ TESTFLIGHT_EXPECTED_MAIN_RUN_ID: target.mainRunId,
  TESTFLIGHT_EXPECTED_MERGE_SHA: target.mergeSha, TESTFLIGHT_EXPECTED_SOURCE_SHA: target.sourceSha,
  TESTFLIGHT_EXPECTED_BUNDLE_ID: target.bundleId })) {
  if (process.env[name] !== expected) throw new Error(`Unexpected association provenance: ${name}.`);
}
console.log(JSON.stringify({ associationTarget: target }));
const client = createAppleClient(process.env, (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }));
const identity = await client.request('GET', `/v1/apps/${target.appId}`);
if (identity.data?.id !== target.appId || identity.data?.attributes?.bundleId !== target.bundleId) throw new Error('Unexpected Apple app identity.');
let targetBuildId = '', targetGroupId = '';
const scoped = {
  async request(method, path, payload) {
    const query = new URL(path, 'https://api.appstoreconnect.apple.com');
    if (query.origin !== 'https://api.appstoreconnect.apple.com') throw new Error('Unexpected Apple origin.');
    const buildQuery = method === 'GET' && query.pathname === '/v1/builds';
    const groupQuery = method === 'GET' && query.pathname === '/v1/betaGroups';
    const groupWrite = method === 'POST' && /^\/v1\/betaGroups\/([^/]+)\/relationships\/builds$/.exec(query.pathname);
    if (method !== 'GET' && !groupWrite) throw new Error('Unexpected Apple mutation blocked.');
    if (groupWrite) {
      if (!targetBuildId || !targetGroupId || groupWrite[1] !== targetGroupId || payload?.data?.length !== 1
        || payload.data[0]?.type !== 'builds' || payload.data[0]?.id !== targetBuildId) throw new Error('Unexpected build association blocked.');
      path = `/v1/builds/${targetBuildId}/relationships/betaGroups`;
      payload = { data: [{ type: 'betaGroups', id: groupWrite[1] }] };
    }
    if (buildQuery || groupQuery) {
      if (query.searchParams.get('filter[app]') !== target.appId) throw new Error('Unexpected Apple app filter.');
    }
    if (buildQuery) {
      query.searchParams.set('filter[version]', target.build);
      query.searchParams.set('limit', '5');
      path = query.pathname + query.search;
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await client.request(method, path, payload);
        if (buildQuery) targetBuildId = response.data?.find(build => build.attributes?.version === target.build)?.id || '';
        if (groupQuery) targetGroupId = response.data?.find(group => group.attributes?.name === target.group
          && (group.attributes.isInternal === true || group.attributes.isInternalGroup === true))?.id || targetGroupId;
        return response;
      } catch (error) {
        if (method !== 'GET' || attempt >= 3 || !/timeout|timed out|aborted/i.test(String(error?.message || error))) throw error;
        console.log(`Read timeout; retry ${attempt}/2.`);
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
    }
  },
};
const result = await attachLatestTestFlightBuild(scoped);
if (result.build !== target.build || result.buildId !== targetBuildId || result.group !== target.group || !targetGroupId) throw new Error('Unexpected association result.');
let verified = false;
for (let attempt = 1; attempt <= 40; attempt++) {
  const [build, beta] = await Promise.all([
    scoped.request('GET', `/v1/builds/${targetBuildId}?include=betaGroups`),
    scoped.request('GET', `/v1/builds/${targetBuildId}/buildBetaDetail`),
  ]);
  if (build.data?.id !== targetBuildId || build.data?.attributes?.version !== target.build
    || build.data?.attributes?.processingState !== 'VALID' || build.data?.attributes?.expired !== false) throw new Error('Exact build readback is not VALID and current.');
  const linked = build.data?.relationships?.betaGroups?.data?.some(group => group.type === 'betaGroups' && group.id === targetGroupId);
  const state = beta.data?.attributes?.internalBuildState;
  console.log(`Exact build ${target.build}: VALID; internal state ${state}; expected group linked=${linked}; readback ${attempt}/40.`);
  if (linked && state === 'IN_BETA_TESTING') { verified = true; break; }
  if (['PROCESSING_EXCEPTION', 'MISSING_EXPORT_COMPLIANCE', 'IN_EXPORT_COMPLIANCE_REVIEW', 'EXPIRED'].includes(state)) throw new Error(`Internal beta readback blocked: ${state}.`);
  if (attempt < 40) await new Promise(resolve => setTimeout(resolve, 30_000));
}
if (!verified) throw new Error('Exact build/group readback did not confirm IN_BETA_TESTING.');
console.log(JSON.stringify({ ...result, verified: { processingState: 'VALID', internalBuildState: 'IN_BETA_TESTING', groupId: targetGroupId }, provenance: target }));
