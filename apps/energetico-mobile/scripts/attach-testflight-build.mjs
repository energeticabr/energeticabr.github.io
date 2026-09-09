import { pathToFileURL } from 'node:url';
import { createAppleClient } from './app-store-submission.mjs';

const APP_ID = '6809887853';
const BUNDLE_ID = 'br.com.energetica.energetico';
const GROUP_NAME = 'ENERGETICO Validacao';
const BUILD_NUMBER = process.env.APP_STORE_BUILD || '';
const MAX_ATTEMPTS = Number(process.env.TESTFLIGHT_MAX_ATTEMPTS || 40);
const POLL_MS = Number(process.env.TESTFLIGHT_POLL_MS || 30_000);

const attr = value => value?.attributes || {};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function list(client, path) {
  const result = [];
  const seen = new Set();
  while (path) {
    if (seen.has(path) || seen.size >= 30) throw new Error('Unexpected Apple pagination.');
    seen.add(path);
    const page = await client.request('GET', path);
    result.push(...(page.data || []));
    path = page.links?.next;
  }
  return result;
}

export function chooseLatestBuild(builds, buildNumber = BUILD_NUMBER) {
  return builds
    .filter(build => attr(build).expired !== true && (!buildNumber || String(attr(build).version) === String(buildNumber)))
    .sort((a, b) => String(attr(b).uploadedDate || '').localeCompare(String(attr(a).uploadedDate || '')))[0];
}

export function chooseInternalGroup(groups, name = GROUP_NAME) {
  return groups.find(group => attr(group).name === name && attr(group).isInternal === true)
    || groups.find(group => attr(group).name === name);
}

async function findLatestBuild(client) {
  // App Store Connect uses `version` for the numeric build number (for example,
  // 256), not for the marketing version (for example, 1.0). The app filter and
  // upload ordering are therefore the reliable selectors for the latest upload.
  const builds = await list(client, `/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate`);
  const build = chooseLatestBuild(builds);
  return build;
}

async function waitForComplete(client) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const build = await findLatestBuild(client);
    if (!build) {
      console.log(`Build ${BUILD_NUMBER || 'mais recente'} ainda não apareceu na Apple; tentativa ${attempt}/${MAX_ATTEMPTS}.`);
      if (attempt < MAX_ATTEMPTS) await sleep(POLL_MS);
      continue;
    }
    const state = attr(build).processingState || 'UNKNOWN';
    console.log(`Build ${attr(build).version} (${build.id}) em ${state}; tentativa ${attempt}/${MAX_ATTEMPTS}.`);
    if (state === 'VALID') return build;
    if (['FAILED', 'INVALID'].includes(state)) throw new Error(`A Apple marcou a build como ${state}; verifique os detalhes no App Store Connect.`);
    if (attempt < MAX_ATTEMPTS) await sleep(POLL_MS);
  }
  throw new Error('A build permaneceu em processamento dentro do limite automático; nenhuma associação foi feita.');
}

export async function attachLatestTestFlightBuild(client) {
  const build = await waitForComplete(client);
  const groups = await list(client, `/v1/betaGroups?filter[app]=${APP_ID}`);
  const group = chooseInternalGroup(groups);
  if (!group) throw new Error(`Grupo interno ${GROUP_NAME} não encontrado; nenhuma associação foi feita.`);
  const attached = await list(client, `/v1/betaGroups/${group.id}/builds`);
  if (attached.some(item => item.id === build.id)) {
    return { status: 'ALREADY_ATTACHED', build: attr(build).version, buildId: build.id, group: attr(group).name };
  }
  await client.request('POST', `/v1/betaGroups/${group.id}/relationships/builds`, {
    data: [{ type: 'builds', id: build.id }],
  });
  return { status: 'ATTACHED', build: attr(build).version, buildId: build.id, group: attr(group).name };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await attachLatestTestFlightBuild(createAppleClient());
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
