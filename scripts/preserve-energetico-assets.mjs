import { constants } from 'node:fs';
import { copyFile, lstat, open, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HISTORY = 'asset-history.json';
const HASHED_FILE = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9][A-Za-z0-9.]*$/u;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isHashedFile = name => HASHED_FILE.test(name) && !/\.map$/i.test(name);

function buildName(id) {
  if (Number.isSafeInteger(id) && id >= 0) id = String(id);
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error('Invalid cohort build ID');
  return id;
}

function timestamp(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error('An original ISO creation timestamp is required for each legacy graph');
  }
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > now) throw new Error(`Invalid or future creation date: ${value}`);
  return new Date(time).toISOString();
}

function assetPath(file) {
  if (typeof file !== 'string' || !file.startsWith('assets/') || !isHashedFile(file.slice(7))) {
    throw new Error(`Invalid asset path: ${String(file)}`);
  }
  return file;
}

async function regularFile(file) {
  const stat = await lstat(file);
  if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${file}`);
  if (!stat.isFile()) throw new Error(`Expected a regular file: ${file}`);
  return stat;
}

async function directory(input) {
  if (typeof input !== 'string' || !input || /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(input) || /^file:/i.test(input)) {
    throw new Error('Expected a local deployment directory');
  }
  const dir = resolve(input);
  // Check ancestors too: lstat of the final path alone would follow a linked parent.
  for (let part = dir; ; part = dirname(part)) {
    const stat = await lstat(part);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${part}`);
    if (!stat.isDirectory()) throw new Error(`Expected a directory: ${part}`);
    if (dirname(part) === part) break;
  }
  return dir;
}

async function digest(file) {
  await regularFile(file);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`Expected a regular file: ${file}`);
    const hash = createHash('sha256');
    for await (const bytes of handle.createReadStream({ autoClose: false })) hash.update(bytes);
    return hash.digest('hex');
  } finally { await handle.close(); }
}

async function inventory(dir) {
  const assetDir = await directory(join(dir, 'assets'));
  const files = new Map();
  for (const name of (await readdir(assetDir)).sort(compare)) {
    const fullPath = join(assetDir, name);
    const stat = await regularFile(fullPath);
    if (isHashedFile(name)) files.set(`assets/${name}`, { fullPath, size: stat.size, digest: await digest(fullPath) });
  }
  return files;
}

async function readHistory(dir, now) {
  const file = join(dir, HISTORY);
  try { await regularFile(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let data;
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try { data = JSON.parse(await handle.readFile('utf8')); }
  catch (error) { throw new Error(`Invalid asset history in ${file}: ${error.message}`); }
  finally { await handle.close(); }
  if (data?.version !== 1 || !Array.isArray(data.cohorts)) throw new Error(`Invalid asset history in ${file}`);
  return data.cohorts.map(cohort => {
    if (!cohort || !Array.isArray(cohort.files)) throw new Error(`Invalid cohort in asset history: ${file}`);
    const files = cohort.files.map(assetPath).sort(compare);
    if (new Set(files).size !== files.length) throw new Error(`Duplicate asset path in history: ${file}`);
    return { id: buildName(cohort.id), createdAt: timestamp(cohort.createdAt, now), files };
  });
}

/**
 * Keep complete immutable build graphs, never a report from another app version.
 * History schema: { version: 1, cohorts: [{ id, createdAt: ISO, files: ['assets/...'] }] }.
 * previousDirs takes precedence over the single-directory compatibility options.
 * Returned retainedCohorts/totalFiles/totalBytes include the mandatory current build.
 */
export async function preserveEnergeticoAssets({
  currentDir, previousDir, previousDirs, buildId, now = Date.now(), previousDate,
  maxAgeMs = 7 * 86_400_000, maxBytes = 256 * 1024 * 1024,
} = {}) {
  buildId = buildName(buildId);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(maxAgeMs) || maxAgeMs < 0
    || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid retention time or byte limits');
  const current = await directory(currentDir);
  const currentAssets = await inventory(current);
  const currentHistory = await readHistory(current, now);
  const allFiles = new Map();
  const caseNames = new Map();
  function register(files) {
    for (const [file, asset] of files) {
      const folded = file.toLowerCase();
      if (caseNames.has(folded) && caseNames.get(folded) !== file) throw new Error(`Asset filename case collision: ${file}`);
      caseNames.set(folded, file);
      const existing = allFiles.get(file);
      if (existing && (existing.size !== asset.size || existing.digest !== asset.digest)) throw new Error(`Asset collision: different bytes for ${file}`);
      if (!existing) allFiles.set(file, asset);
    }
  }
  register(currentAssets);

  const cohorts = new Map();
  function addCohort(cohort) {
    const existing = cohorts.get(cohort.id);
    if (existing) {
      if (JSON.stringify(existing.files) !== JSON.stringify(cohort.files)) throw new Error(`Conflicting complete graph for cohort ${cohort.id}`);
      // The oldest date wins if archives disagree; a repeat must never extend TTL.
      if (cohort.createdAt < existing.createdAt) existing.createdAt = cohort.createdAt;
    } else cohorts.set(cohort.id, { ...cohort, files: [...cohort.files] });
  }
  for (const cohort of currentHistory || []) addCohort(cohort);
  let currentCohort;
  if (currentHistory) {
    currentCohort = cohorts.get(buildId);
    if (!currentCohort) throw new Error('Current directory history belongs to a different build; use a fresh build directory');
    const recordedFiles = new Set(currentHistory.flatMap(cohort => cohort.files));
    for (const file of currentAssets.keys()) if (!recordedFiles.has(file)) throw new Error(`Unrecorded asset in current history: ${file}`);
  } else {
    currentCohort = { id: buildId, createdAt: new Date(now).toISOString(), files: [...currentAssets.keys()].sort(compare) };
    if (!currentCohort.files.length) throw new Error('The current build has no content-hashed assets');
  }

  const previous = previousDirs === undefined
    ? (previousDir === undefined ? [] : [{ dir: previousDir, createdAt: previousDate }]) : previousDirs;
  if (!Array.isArray(previous)) throw new Error('previousDirs must be an array');
  const scanned = new Map();
  for (const source of previous) {
    if (!source || typeof source !== 'object') throw new Error('Invalid previous directory descriptor');
    const dir = await directory(source.dir);
    if (dir === current) throw new Error('Previous and current deployment directories must differ');
    let artifact = scanned.get(dir);
    if (!artifact) {
      artifact = { files: await inventory(dir), history: await readHistory(dir, now) };
      scanned.set(dir, artifact);
      register(artifact.files);
    }
    if (artifact.history) {
      for (const cohort of artifact.history) addCohort(cohort);
    } else {
      const createdAt = timestamp(source.createdAt, now);
      addCohort({ id: buildName(source.id ?? `legacy-${Date.parse(createdAt)}`), createdAt, files: [...artifact.files.keys()].sort(compare) });
    }
  }
  addCohort(currentCohort);
  currentCohort = cohorts.get(buildId);

  const selectedFiles = new Set();
  let totalBytes = 0;
  function required(file) {
    const asset = allFiles.get(file);
    if (!asset) throw new Error(`Missing referenced asset: ${file}`);
    return asset;
  }
  // The current graph must come from the current build, not be repaired from history.
  for (const file of currentCohort.files) {
    if (!currentAssets.has(file)) throw new Error(`Missing current build asset: ${file}`);
    selectedFiles.add(file);
    totalBytes += required(file).size;
  }
  const retained = [currentCohort];
  const older = [...cohorts.values()].filter(cohort => cohort.id !== buildId)
    .sort((a, b) => compare(b.createdAt, a.createdAt) || compare(a.id, b.id));
  for (const cohort of older) {
    if (now - Date.parse(cohort.createdAt) > maxAgeMs) continue;
    let extraBytes = 0;
    for (const file of cohort.files) {
      const asset = allFiles.get(file);
      if (asset && !selectedFiles.has(file)) extraBytes += asset.size;
    }
    if (extraBytes > 0 && totalBytes + extraBytes > maxBytes) continue;
    for (const file of cohort.files) required(file);
    retained.push(cohort);
    totalBytes += extraBytes;
    for (const file of cohort.files) selectedFiles.add(file);
  }

  // Validate the entire selection before changing the deployment directory.
  let copiedFiles = 0, copiedBytes = 0;
  for (const file of [...selectedFiles].sort(compare)) {
    if (currentAssets.has(file)) continue;
    const source = required(file);
    await regularFile(source.fullPath);
    const destination = join(current, file);
    await copyFile(source.fullPath, destination, constants.COPYFILE_EXCL);
    if (await digest(destination) !== source.digest) throw new Error(`Asset changed while copying: ${file}`);
    copiedFiles++;
    copiedBytes += source.size;
  }
  // Only an explicit rerun can have previously copied assets to prune.
  for (const file of currentAssets.keys()) {
    if (!selectedFiles.has(file)) {
      await regularFile(join(current, file));
      await unlink(join(current, file));
    }
  }
  const temp = join(current, `.${HISTORY}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify({ version: 1, cohorts: retained }, null, 2)}\n`, { flag: 'wx' });
    await rename(temp, join(current, HISTORY));
  } finally {
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return {
    currentFiles: currentCohort.files.length, copiedFiles, copiedBytes,
    totalFiles: selectedFiles.size, totalBytes,
    retainedCohorts: retained.length, droppedCohorts: cohorts.size - retained.length,
    cohorts: retained,
  };
}

async function main(args) {
  const flags = new Map([['--current', 'currentDir'], ['--previous', 'previousDir'], ['--build', 'buildId'], ['--previous-date', 'previousDate']]);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = flags.get(args[index]);
    if (!key) throw new Error(`Unknown argument: ${args[index]}`);
    if (!args[index + 1] || args[index + 1].startsWith('--') || Object.hasOwn(options, key)) throw new Error(`Missing or repeated argument: ${args[index]}`);
    options[key] = args[index + 1];
  }
  console.log(JSON.stringify(await preserveEnergeticoAssets(options)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`Asset retention failed: ${error.message}`);
    process.exitCode = 1;
  });
}
