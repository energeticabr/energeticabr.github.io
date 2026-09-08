import { createPrivateKey, sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const APP_ID = '6809887853';
const BUNDLE_ID = 'br.com.energetica.energetico';
const ORIGIN = 'https://api.appstoreconnect.apple.com';
const text = value => typeof value === 'string' && value.trim().length > 0;
const attr = value => value?.attributes || {};
const booleanAgeFields = ['advertising', 'gambling', 'healthOrWellnessTopics', 'lootBox', 'messagingAndChat', 'parentalControls', 'ageAssurance', 'unrestrictedWebAccess', 'userGeneratedContent'];
const frequencyAgeFields = ['alcoholTobaccoOrDrugUseOrReferences', 'contests', 'gamblingSimulated', 'gunsOrOtherWeapons', 'medicalOrTreatmentInformation', 'profanityOrCrudeHumor', 'sexualContentGraphicAndNudity', 'sexualContentOrNudity', 'horrorOrFearThemes', 'matureOrSuggestiveThemes', 'violenceCartoonOrFantasy', 'violenceRealisticProlongedGraphicOrSadistic', 'violenceRealistic'];

export function validateSelectors({ version, build }) {
  if (!/^\d{1,4}(?:\.\d{1,4}){0,2}$/.test(version || '')) throw new Error('Invalid App Store version selector.');
  if (!/^\d{1,10}(?:\.\d{1,4}){0,2}$/.test(build || '')) throw new Error('Invalid App Store build selector.');
}

function httpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export function validateSubmission(snapshot, selectors) {
  validateSelectors(selectors);
  const errors = [];
  const check = (ok, error) => { if (!ok) errors.push(error); };
  const app = attr(snapshot.app), version = attr(snapshot.version), build = attr(snapshot.build);
  check(snapshot.app?.id === APP_ID && app.bundleId === BUNDLE_ID, 'App identity must be ENERGETICO only.');
  check(version.platform === 'IOS' && version.versionString === selectors.version, 'Selected iOS version does not match.');
  check(['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(version.appStoreState), 'App Store version is not editable for submission.');
  check(version.releaseType === 'AFTER_APPROVAL', 'Expected existing releaseType AFTER_APPROVAL; no release setting was changed.');
  check(text(version.copyright), 'Missing copyright.');
  check(snapshot.buildAppId === APP_ID && snapshot.buildVersion === selectors.version && build.version === selectors.build, 'Selected build belongs to a different app or version.');
  check(build.processingState === 'VALID' && build.expired === false, 'Build must be VALID and not expired.');
  check(build.usesNonExemptEncryption === false || snapshot.encryptionDeclarationAttached === true, 'Build export compliance must be completed.');
  check(['DOES_NOT_USE_THIRD_PARTY_CONTENT', 'USES_THIRD_PARTY_CONTENT'].includes(app.contentRightsDeclaration), 'Missing contentRightsDeclaration.');

  const localizations = snapshot.localizations || [];
  check(localizations.some(item => attr(item).locale === app.primaryLocale), 'Missing primary App Store version localization.');
  for (const item of localizations) {
    const localized = attr(item), prefix = localized.locale || 'unknown locale';
    check(text(localized.description), `${prefix}: missing description.`);
    check(text(localized.keywords), `${prefix}: missing keywords.`);
    check(httpsUrl(localized.supportUrl), `${prefix}: missing HTTPS supportUrl.`);
    const complete = new Set((item.screenshotSets || []).filter(set => (set.screenshots || []).some(shot => attr(shot).assetDeliveryState?.state === 'COMPLETE')).map(set => attr(set).screenshotDisplayType));
    check(complete.has('APP_IPHONE_65') || complete.has('APP_IPHONE_69'), `${prefix}: missing processed iPhone 6.5/6.9 screenshots.`);
    check(complete.has('APP_IPAD_PRO_3GEN_129'), `${prefix}: missing processed iPad 13 screenshots.`);
    const info = (snapshot.infoLocalizations || []).find(info => attr(info).locale === localized.locale);
    check(httpsUrl(attr(info).privacyPolicyUrl), `${prefix}: missing HTTPS privacyPolicyUrl.`);
  }
  const age = attr(snapshot.age);
  for (const key of booleanAgeFields) check(typeof age[key] === 'boolean', `Missing age rating answer: ${key}.`);
  for (const key of frequencyAgeFields) check(['NONE', 'INFREQUENT_OR_MILD', 'FREQUENT_OR_INTENSE', 'INFREQUENT', 'FREQUENT'].includes(age[key]), `Missing age rating answer: ${key}.`);
  const review = attr(snapshot.review);
  for (const key of ['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail']) check(text(review[key]), `Missing review ${key}.`);
  check(review.demoAccountRequired === true, 'ENERGETICO requires a dedicated demo account for review.');
  for (const key of ['demoAccountName', 'demoAccountPassword']) check(text(review[key]), `Missing review ${key}; do not use corporate production credentials.`);
  check(snapshot.privacyVerifiedFor === `${selectors.version}:${selectors.build}`, 'App Privacy published responses must be verified for this version:build (APPLE_APP_PRIVACY_VERIFIED_FOR).');
  check(!(snapshot.submissions || []).some(item => attr(item).platform === 'IOS' && !['COMPLETE', 'CANCELED'].includes(attr(item).state)), 'An existing iOS review submission needs inspection; duplicate submission blocked.');
  return errors;
}

export function createAppleClient(env = process.env, fetcher = fetch) {
  for (const name of ['APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID', 'APPLE_API_PRIVATE_KEY_B64']) {
    if (!text(env[name])) throw new Error(`Missing credential: ${name}`);
  }
  const privateKey = createPrivateKey(Buffer.from(env.APPLE_API_PRIVATE_KEY_B64, 'base64'));
  function token() {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: env.APPLE_API_KEY_ID, typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: env.APPLE_API_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })).toString('base64url');
    const input = `${header}.${payload}`;
    return `${input}.${sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  }
  return {
    async request(method, path, payload) {
      const url = new URL(path, ORIGIN);
      if (url.origin !== ORIGIN || !url.pathname.startsWith('/v1/')) throw new Error('Untrusted Apple API URL blocked.');
      const response = await fetcher(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
      if (!response.ok) {
        // Apple errors can echo private field values. Do not print response bodies or requests.
        throw new Error(`Apple API ${method} ${url.pathname}: HTTP ${response.status}. Inspect App Store Connect for details.`);
      }
      return response.status === 204 ? {} : response.json();
    },
  };
}

async function list(client, path) {
  const items = [];
  const seen = new Set();
  while (path) {
    if (seen.has(path) || seen.size >= 30) throw new Error('Unexpected Apple pagination.');
    seen.add(path);
    const result = await client.request('GET', path);
    items.push(...(result.data || []));
    path = result.links?.next;
  }
  return items;
}

const one = (items, label) => {
  if (items.length !== 1) throw new Error(`Expected one ${label}; found ${items.length}. No changes made.`);
  return items[0];
};

async function optional(client, path) {
  try { return (await client.request('GET', path)).data; }
  catch (error) { if (/HTTP 404\./.test(error.message)) return null; throw error; }
}

export async function loadSnapshot(client, selectors, privacyVerifiedFor = '') {
  validateSelectors(selectors);
  const app = (await client.request('GET', `/v1/apps/${APP_ID}`)).data;
  if (app?.id !== APP_ID || attr(app).bundleId !== BUNDLE_ID) throw new Error('ENERGETICO app identity mismatch.');
  const version = one((await list(client, `/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&filter[versionString]=${encodeURIComponent(selectors.version)}`)).filter(item => attr(item).platform === 'IOS' && attr(item).versionString === selectors.version), 'matching iOS version');
  const builds = await list(client, `/v1/builds?filter[app]=${APP_ID}&filter[version]=${encodeURIComponent(selectors.build)}`);
  const candidates = [];
  for (const build of builds) {
    const preRelease = (await client.request('GET', `/v1/builds/${build.id}/preReleaseVersion`)).data;
    if (attr(build).version === selectors.build && attr(preRelease).version === selectors.version && attr(preRelease).platform === 'IOS') candidates.push(build);
  }
  const build = one(candidates, 'matching processed build');
  const buildApp = (await client.request('GET', `/v1/builds/${build.id}/app`)).data;
  const infos = await list(client, `/v1/apps/${APP_ID}/appInfos`);
  const info = one(infos.filter(item => ['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(attr(item).appStoreState)), 'editable app info');
  const localizations = await list(client, `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  for (const localized of localizations) {
    localized.screenshotSets = await list(client, `/v1/appStoreVersionLocalizations/${localized.id}/appScreenshotSets`);
    for (const set of localized.screenshotSets) set.screenshots = await list(client, `/v1/appScreenshotSets/${set.id}/appScreenshots`);
  }
  const review = await optional(client, `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`);
  const age = await optional(client, `/v1/appInfos/${info.id}/ageRatingDeclaration`);
  const infoLocalizations = await list(client, `/v1/appInfos/${info.id}/appInfoLocalizations`);
  const submissions = await list(client, `/v1/apps/${APP_ID}/reviewSubmissions`);
  let encryptionDeclarationAttached = false;
  if (attr(build).usesNonExemptEncryption !== false) {
    const declaration = await optional(client, `/v1/builds/${build.id}/appEncryptionDeclaration`);
    encryptionDeclarationAttached = attr(declaration).appEncryptionDeclarationState === 'APPROVED';
  }
  return { app, version, build, buildAppId: buildApp?.id, buildVersion: selectors.version, localizations, infoLocalizations, review, age, submissions, privacyVerifiedFor, encryptionDeclarationAttached };
}

export async function runSubmission({ snapshot, client, version, build, submit = false }) {
  const errors = validateSubmission(snapshot, { version, build });
  if (errors.length) throw new Error(`App Store preflight blocked:\n- ${errors.join('\n- ')}`);
  if (submit !== true) return { status: 'VALIDATED', appId: APP_ID, version, build };
  await client.request('PATCH', `/v1/appStoreVersions/${snapshot.version.id}/relationships/build`, { data: { type: 'builds', id: snapshot.build.id } });
  const created = await client.request('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } } });
  const submissionId = created.data.id;
  await client.request('POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: {
    reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
    appStoreVersion: { data: { type: 'appStoreVersions', id: snapshot.version.id } },
  } } });
  await client.request('PATCH', `/v1/reviewSubmissions/${submissionId}`, { data: { type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } } });
  const verified = await client.request('GET', `/v1/reviewSubmissions/${submissionId}`);
  const status = attr(verified.data).state;
  if (!['WAITING_FOR_REVIEW', 'IN_REVIEW', 'COMPLETE'].includes(status)) throw new Error(`Submission ${submissionId} returned state ${status || 'unknown'}; submission not confirmed. Inspect before retrying.`);
  return { status, appId: APP_ID, version, build, submissionId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const selectors = { version: process.env.APP_STORE_VERSION, build: process.env.APP_STORE_BUILD };
    validateSelectors(selectors);
    const client = createAppleClient();
    const snapshot = await loadSnapshot(client, selectors, process.env.APPLE_APP_PRIVACY_VERIFIED_FOR || '');
    const result = await runSubmission({ snapshot, client, ...selectors, submit: process.env.SUBMIT_APP_STORE === 'true' });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
