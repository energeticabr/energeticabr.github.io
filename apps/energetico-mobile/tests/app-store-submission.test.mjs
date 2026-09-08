import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';

// Removing the read-only default, identity guard, or completeness gate must fail these tests.
const modulePath = new URL('../scripts/app-store-submission.mjs', import.meta.url);
const api = await import(modulePath).catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});

test('submission automation exposes a preflight and bounded submission entry point', () => {
  assert.equal(typeof api.validateSubmission, 'function');
  assert.equal(typeof api.runSubmission, 'function');
});

function ready() {
  return {
    app: { id: '6809887853', attributes: { bundleId: 'br.com.energetica.energetico', primaryLocale: 'pt-BR', contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' } },
    version: { id: 'version-id', attributes: { platform: 'IOS', versionString: '1.0', appStoreState: 'PREPARE_FOR_SUBMISSION', copyright: '2026 Example', releaseType: 'AFTER_APPROVAL' } },
    build: { id: 'build-id', attributes: { version: '6', processingState: 'VALID', expired: false, usesNonExemptEncryption: false } },
    buildAppId: '6809887853', buildVersion: '1.0',
    localizations: [{ attributes: { locale: 'pt-BR', description: 'App description', keywords: 'obra', supportUrl: 'https://example.com/support' }, screenshotSets: [
      { attributes: { screenshotDisplayType: 'APP_IPHONE_65' }, screenshots: [{ attributes: { assetDeliveryState: { state: 'COMPLETE' } } }] },
      { attributes: { screenshotDisplayType: 'APP_IPAD_PRO_3GEN_129' }, screenshots: [{ attributes: { assetDeliveryState: { state: 'COMPLETE' } } }] },
    ] }],
    infoLocalizations: [{ attributes: { locale: 'pt-BR', privacyPolicyUrl: 'https://example.com/privacy' } }],
    age: { attributes: Object.fromEntries([
      ...['advertising', 'gambling', 'healthOrWellnessTopics', 'lootBox', 'messagingAndChat', 'parentalControls', 'ageAssurance', 'unrestrictedWebAccess', 'userGeneratedContent'].map(key => [key, false]),
      ...['alcoholTobaccoOrDrugUseOrReferences', 'contests', 'gamblingSimulated', 'gunsOrOtherWeapons', 'medicalOrTreatmentInformation', 'profanityOrCrudeHumor', 'sexualContentGraphicAndNudity', 'sexualContentOrNudity', 'horrorOrFearThemes', 'matureOrSuggestiveThemes', 'violenceCartoonOrFantasy', 'violenceRealisticProlongedGraphicOrSadistic', 'violenceRealistic'].map(key => [key, 'NONE']),
    ]) },
    review: { attributes: { contactFirstName: 'Review', contactLastName: 'Contact', contactPhone: '+5511999999999', contactEmail: 'review@example.com', demoAccountRequired: true, demoAccountName: 'isolated-demo', demoAccountPassword: 'test-only' } },
    privacyVerifiedFor: '1.0:6', submissions: [],
  };
}
const options = { version: '1.0', build: '6' };

test('complete metadata validates without reporting review credentials', { skip: !api.validateSubmission }, () => {
  const result = api.validateSubmission(ready(), options);
  assert.deepEqual(result, []);
});

test('missing mandatory inputs are aggregated instead of permitting submission', { skip: !api.validateSubmission }, () => {
  const snapshot = ready();
  snapshot.localizations[0].screenshotSets = [];
  snapshot.review.attributes.demoAccountPassword = '';
  snapshot.review.attributes.contactEmail = '';
  snapshot.age.attributes.messagingAndChat = null;
  snapshot.infoLocalizations[0].attributes.privacyPolicyUrl = '';
  snapshot.privacyVerifiedFor = '';
  const errors = api.validateSubmission(snapshot, options).join('\n');
  for (const expected of ['iPhone', 'iPad', 'demoAccountPassword', 'contactEmail', 'messagingAndChat', 'privacyPolicyUrl', 'App Privacy']) assert.ok(errors.includes(expected), expected);
  assert.ok(!errors.includes('isolated-demo'));
});

test('foreign app, wrong build, malformed selectors and unreleased processing cannot pass', { skip: !api.validateSubmission }, () => {
  for (const mutate of [
    value => value.app.id = '999',
    value => value.app.attributes.bundleId = 'other.app',
    value => value.buildAppId = '999',
    value => value.build.attributes.version = '7',
    value => value.buildVersion = '2.0',
    value => value.build.attributes.processingState = 'PROCESSING',
    value => value.build.attributes.expired = true,
    value => value.version.attributes.releaseType = 'MANUAL',
    value => value.privacyVerifiedFor = '1.0:5',
  ]) {
    const snapshot = ready(); mutate(snapshot);
    assert.ok(api.validateSubmission(snapshot, options).length > 0);
  }
  assert.throws(() => api.validateSubmission(ready(), { version: '../apps', build: '6' }), /version/i);
});

test('default validation never sends writes even with complete inputs', { skip: !api.runSubmission }, async () => {
  const client = { request() { throw new Error('Unexpected write'); } };
  const result = await api.runSubmission({ snapshot: ready(), client, ...options });
  assert.equal(result.status, 'VALIDATED');
});

test('explicit submission with missing information fails before any remote write', { skip: !api.runSubmission }, async () => {
  const snapshot = ready(); snapshot.review.attributes.demoAccountPassword = '';
  const client = { request() { throw new Error('Unexpected write'); } };
  await assert.rejects(api.runSubmission({ snapshot, client, submit: true, ...options }), /demoAccountPassword/);
});

test('explicit complete submission binds exact build and version then verifies Apple state', { skip: !api.runSubmission }, async () => {
  const calls = [];
  const client = { async request(method, path, payload) {
    calls.push({ method, path, payload });
    if (path === '/v1/reviewSubmissions' && method === 'POST') return { data: { id: 'submission-id' } };
    if (path === '/v1/reviewSubmissions/submission-id' && method === 'GET') return { data: { id: 'submission-id', attributes: { state: 'WAITING_FOR_REVIEW' } } };
    return { data: {} };
  } };
  const result = await api.runSubmission({ snapshot: ready(), client, submit: true, ...options });
  assert.equal(result.status, 'WAITING_FOR_REVIEW');
  assert.deepEqual(calls.map(call => [call.method, call.path]), [
    ['PATCH', '/v1/appStoreVersions/version-id/relationships/build'],
    ['POST', '/v1/reviewSubmissions'], ['POST', '/v1/reviewSubmissionItems'],
    ['PATCH', '/v1/reviewSubmissions/submission-id'], ['GET', '/v1/reviewSubmissions/submission-id'],
  ]);
  assert.deepEqual(calls[0].payload, { data: { type: 'builds', id: 'build-id' } });
  assert.equal(calls[1].payload.data.relationships.app.data.id, '6809887853');
  assert.equal(calls[2].payload.data.relationships.appStoreVersion.data.id, 'version-id');
  assert.deepEqual(calls[3].payload.data.attributes, { submitted: true });
});

test('an existing pending submission prevents duplicate or mixed review submissions', { skip: !api.runSubmission }, async () => {
  const snapshot = ready();
  snapshot.submissions = [{ id: 'existing', attributes: { state: 'READY_FOR_REVIEW', platform: 'IOS' } }];
  const client = { request() { throw new Error('Unexpected write'); } };
  await assert.rejects(api.runSubmission({ snapshot, client, submit: true, ...options }), /existing|existente/i);
});

test('Apple transport signs ES256 requests and never forwards credentials to another origin', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const env = { APPLE_API_KEY_ID: 'test-key-id', APPLE_API_ISSUER_ID: 'test-issuer', APPLE_API_PRIVATE_KEY_B64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') };
  const requests = [];
  const client = api.createAppleClient(env, async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ data: { id: '6809887853' } }) };
  });
  await client.request('GET', '/v1/apps/6809887853');
  const request = requests[0];
  assert.equal(request.url.origin, 'https://api.appstoreconnect.apple.com');
  assert.equal(request.options.redirect, 'error');
  const token = request.options.headers.Authorization.slice('Bearer '.length).split('.');
  assert.equal(JSON.parse(Buffer.from(token[1], 'base64url')).aud, 'appstoreconnect-v1');
  assert.equal(verify('sha256', Buffer.from(token.slice(0, 2).join('.')), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(token[2], 'base64url')), true);
  await assert.rejects(client.request('GET', 'https://example.com/v1/apps'), /Untrusted/);
  assert.equal(requests.length, 1);
});

test('Apple error responses cannot leak echoed demo passwords or tokens into logs', async () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const env = { APPLE_API_KEY_ID: 'test-key-id', APPLE_API_ISSUER_ID: 'test-issuer', APPLE_API_PRIVATE_KEY_B64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') };
  const client = api.createAppleClient(env, async () => ({ ok: false, status: 409, json: async () => ({ errors: [{ detail: 'PRIVATE_DEMO_PASSWORD' }] }) }));
  await assert.rejects(client.request('POST', '/v1/reviewSubmissions', { data: {} }), error => {
    assert.match(error.message, /HTTP 409/);
    assert.ok(!error.message.includes('PRIVATE_DEMO_PASSWORD'));
    return true;
  });
});

test('snapshot resolves exact app/version/build and paginated metadata using GET only', async () => {
  const fixture = ready();
  fixture.version.attributes.appStoreState = 'PREPARE_FOR_SUBMISSION';
  const resources = {
    '/v1/apps/6809887853': fixture.app,
    '/v1/apps/6809887853/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.0': [fixture.version],
    '/v1/builds?filter[app]=6809887853&filter[version]=6': [fixture.build],
    '/v1/builds/build-id/preReleaseVersion': { attributes: { version: '1.0', platform: 'IOS' } },
    '/v1/builds/build-id/app': fixture.app,
    '/v1/apps/6809887853/appInfos': [{ id: 'info-id', attributes: { appStoreState: 'PREPARE_FOR_SUBMISSION' } }],
    '/v1/appStoreVersions/version-id/appStoreVersionLocalizations': [{ id: 'locale-id', attributes: fixture.localizations[0].attributes }],
    '/v1/appStoreVersionLocalizations/locale-id/appScreenshotSets': [{ id: 'set-id', attributes: { screenshotDisplayType: 'APP_IPHONE_65' } }],
    '/v1/appScreenshotSets/set-id/appScreenshots': [{ attributes: { assetDeliveryState: { state: 'COMPLETE' } } }],
    '/v1/appStoreVersions/version-id/appStoreReviewDetail': fixture.review,
    '/v1/appInfos/info-id/ageRatingDeclaration': fixture.age,
    '/v1/appInfos/info-id/appInfoLocalizations': [],
    'https://api.appstoreconnect.apple.com/v1/appInfos/info-id/appInfoLocalizations?cursor=next': fixture.infoLocalizations,
    '/v1/apps/6809887853/reviewSubmissions': [],
  };
  const client = { async request(method, path) {
    assert.equal(method, 'GET');
    assert.ok(Object.hasOwn(resources, path), `Unexpected endpoint ${path}`);
    return { data: structuredClone(resources[path]), ...(path === '/v1/appInfos/info-id/appInfoLocalizations' ? { links: { next: 'https://api.appstoreconnect.apple.com/v1/appInfos/info-id/appInfoLocalizations?cursor=next' } } : {}) };
  } };
  const snapshot = await api.loadSnapshot(client, options, '1.0:6');
  assert.equal(snapshot.buildAppId, '6809887853');
  assert.equal(snapshot.localizations[0].screenshotSets[0].screenshots[0].attributes.assetDeliveryState.state, 'COMPLETE');
  assert.ok(api.validateSubmission(snapshot, options).some(message => message.includes('iPad')));
});
