import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preserveEnergeticoAssets } from '../scripts/preserve-energetico-assets.mjs';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const DAY = 86_400_000;
const A = 'assets/index-AAAAAAAA.js';
const B = 'assets/report-BBBBBBBB.js';
const C = 'assets/shared-CCCCCCCC.js';
const D = 'assets/index-DDDDDDDD.js';
const E = 'assets/report-EEEEEEEE.css';
const runFile = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/preserve-energetico-assets.mjs', import.meta.url));
const cohort = (id, age, files) => ({ id, createdAt: new Date(NOW - age * DAY).toISOString(), files });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'energetico-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function app(name, files, cohorts) {
    const dir = join(root, name);
    await mkdir(join(dir, 'assets'), { recursive: true });
    for (const [file, bytes] of Object.entries(files)) await writeFile(join(dir, file), bytes);
    if (cohorts) await writeFile(join(dir, 'asset-history.json'), JSON.stringify({ version: 1, cohorts }));
    return dir;
  }
  return { root, app };
}

const history = async dir => JSON.parse(await readFile(join(dir, 'asset-history.json'), 'utf8'));
const assets = async dir => (await readdir(join(dir, 'assets'))).sort();

test('first deployment records only flat hashed current assets and returns logging totals', async t => {
  const { app } = await fixture(t);
  const currentDir = await app('new', { [A]: 'entry', [B]: 'report', 'assets/readme.txt': 'ignore', 'assets/report-BBBBBBBB.js.map': 'ignore' });
  const result = await preserveEnergeticoAssets({ currentDir, buildId: 'new', now: NOW });
  assert.deepEqual((await history(currentDir)).cohorts, [cohort('new', 0, [A, B])]);
  assert.equal(result.totalBytes, 11);
  assert.equal(result.totalFiles, 2);
  assert.equal(result.copiedFiles, 0);
  assert.equal(result.retainedCohorts, 1);
});

test('retains the complete previous graph including entry, lazy chunks, CSS, and images', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: 'old entry', [B]: 'old report', [C]: 'shared', [E]: 'css', 'assets/logo-FFFFFFFF.png': 'image', 'assets/report-BBBBBBBB.js.map': 'map', 'assets/unhashed.js': 'ignore' });
  const currentDir = await app('new', { [D]: 'new entry', [C]: 'shared' });
  const result = await preserveEnergeticoAssets({ currentDir, previousDir, previousDate: '2026-10-27T12:00:00Z', buildId: 'new', now: NOW });
  const records = (await history(currentDir)).cohorts;
  assert.deepEqual(records[0], cohort('new', 0, [D, C].sort()));
  assert.equal(records[1].createdAt, '2026-10-27T12:00:00.000Z');
  assert.deepEqual(records[1].files, [A, B, C, E, 'assets/logo-FFFFFFFF.png'].sort());
  assert.equal(result.copiedFiles, 4);
  assert.equal(await readFile(join(currentDir, B), 'utf8'), 'old report');
  assert.ok(!(await assets(currentDir)).some(file => file.endsWith('.map') || file === 'unhashed.js'));
});

test('merges multiple legacy runs using their own IDs and dates, newest first', async t => {
  const { app } = await fixture(t);
  const old = await app('old', { [A]: 'aaa', [C]: 'shared' });
  const recent = await app('recent', { [B]: 'bbb', [C]: 'shared' });
  const currentDir = await app('new', { [D]: 'dddd' });
  const result = await preserveEnergeticoAssets({ currentDir, buildId: 'new', now: NOW, previousDirs: [
    { dir: old, id: 'run-1', createdAt: '2026-10-25T12:00:00Z' },
    { dir: recent, id: 'run-2', createdAt: '2026-10-27T12:00:00Z' },
  ] });
  assert.deepEqual((await history(currentDir)).cohorts, [cohort('new', 0, [D]), cohort('run-2', 1, [B, C]), cohort('run-1', 3, [A, C])]);
  assert.equal(result.totalBytes, 16);
  assert.equal(result.totalFiles, 4);
  assert.equal(result.copiedFiles, 3);
});

test('history ages take precedence over artifact dates and unrecorded assets do not become a fresh cohort', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: 'expired', [B]: 'recent', [C]: 'orphan' }, [cohort('expired', 8, [A]), cohort('recent', 2, [B])]);
  const currentDir = await app('new', { [D]: 'new' });
  const result = await preserveEnergeticoAssets({ currentDir, previousDirs: [{ dir: previousDir, id: 'artifact', createdAt: new Date(NOW).toISOString() }], buildId: 'new', now: NOW });
  assert.deepEqual((await history(currentDir)).cohorts, [cohort('new', 0, [D]), cohort('recent', 2, [B])]);
  assert.deepEqual(await assets(currentDir), ['index-DDDDDDDD.js', 'report-BBBBBBBB.js']);
  assert.equal(result.droppedCohorts, 1);
});

test('a cohort at the age limit survives, and a later deployment never renews its timestamp', async t => {
  const { app } = await fixture(t);
  const old = await app('old', { [A]: 'old' }, [cohort('old', 7, [A])]);
  const middle = await app('middle', { [B]: 'middle' });
  await preserveEnergeticoAssets({ currentDir: middle, previousDir: old, buildId: 'middle', now: NOW });
  assert.equal((await history(middle)).cohorts[1].createdAt, cohort('old', 7, [A]).createdAt);
  const currentDir = await app('new', { [D]: 'new' });
  await preserveEnergeticoAssets({ currentDir, previousDir: middle, buildId: 'new', now: NOW + 1 });
  assert.deepEqual((await history(currentDir)).cohorts.map(c => c.id), ['new', 'middle']);
  assert.ok(!(await assets(currentDir)).includes('index-AAAAAAAA.js'));
});

test('budget counts the file union once and keeps whole cohorts newest first', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: '111', [B]: '2222', [C]: '33', [E]: '444444' }, [cohort('oldest', 3, [A, C]), cohort('large', 2, [E, C]), cohort('recent', 1, [B, C])]);
  const currentDir = await app('new', { [D]: '55555', [C]: '33' });
  const result = await preserveEnergeticoAssets({ currentDir, previousDir, buildId: 'new', now: NOW, maxBytes: 14 });
  assert.deepEqual((await history(currentDir)).cohorts.map(c => c.id), ['new', 'recent', 'oldest']);
  assert.equal(result.totalBytes, 14);
  assert.equal(result.droppedCohorts, 1);
  assert.deepEqual(await assets(currentDir), ['index-AAAAAAAA.js', 'index-DDDDDDDD.js', 'report-BBBBBBBB.js', 'shared-CCCCCCCC.js']);
});

test('the current graph is retained even when it alone exceeds the byte limit', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: 'older' }, [cohort('old', 1, [A])]);
  const currentDir = await app('new', { [D]: 'current' });
  const result = await preserveEnergeticoAssets({ currentDir, previousDir, buildId: 'new', now: NOW, maxBytes: 1 });
  assert.equal(result.totalBytes, 7);
  assert.deepEqual((await history(currentDir)).cohorts, [cohort('new', 0, [D])]);
});

test('duplicate cohort IDs from artifacts merge without duplicating files or changing their age', async t => {
  const { app } = await fixture(t);
  const records = [cohort('same', 2, [A, C])];
  const one = await app('one', { [A]: 'entry', [C]: 'shared' }, records);
  const two = await app('two', { [A]: 'entry', [C]: 'shared' }, records);
  const currentDir = await app('new', { [D]: 'new' });
  const result = await preserveEnergeticoAssets({ currentDir, buildId: 'new', now: NOW, previousDirs: [{ dir: one }, { dir: two }] });
  assert.deepEqual((await history(currentDir)).cohorts, [cohort('new', 0, [D]), ...records]);
  assert.equal(result.copiedFiles, 2);
  assert.equal(result.retainedCohorts, 2);
});

test('redeploying the same build preserves its original creation date', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [D]: 'same' }, [cohort('same', 4, [D])]);
  const currentDir = await app('new', { [D]: 'same' });
  await preserveEnergeticoAssets({ currentDir, previousDir, buildId: 'same', now: NOW });
  assert.deepEqual((await history(currentDir)).cohorts, [cohort('same', 4, [D])]);
});

test('an identical rerun does not put retained old files into the current build cohort', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: 'old' }, [cohort('old', 1, [A])]);
  const currentDir = await app('new', { [D]: 'new' });
  await preserveEnergeticoAssets({ currentDir, previousDir, buildId: 'new', now: NOW });
  await preserveEnergeticoAssets({ currentDir, buildId: 'new', now: NOW + DAY });
  assert.deepEqual((await history(currentDir)).cohorts, [cohort('new', 0, [D]), cohort('old', 1, [A])]);
});

test('a missing referenced retained asset aborts without recording an incomplete deployment', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: 'entry' }, [cohort('old', 1, [A, B])]);
  const currentDir = await app('new', { [D]: 'new' });
  await assert.rejects(preserveEnergeticoAssets({ currentDir, previousDir, buildId: 'new', now: NOW }), /missing.*report-BBBBBBBB/i);
  await assert.rejects(readFile(join(currentDir, 'asset-history.json')), { code: 'ENOENT' });
  assert.deepEqual(await assets(currentDir), ['index-DDDDDDDD.js']);
});

test('missing assets belonging only to expired cohorts do not prevent deployment', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', {}, [cohort('expired', 8, [B])]);
  const currentDir = await app('new', { [D]: 'new' });
  await preserveEnergeticoAssets({ currentDir, previousDir, buildId: 'new', now: NOW });
  assert.deepEqual((await history(currentDir)).cohorts, [cohort('new', 0, [D])]);
});

test('identical asset filenames with different bytes fail across any two prior directories', async t => {
  const { app } = await fixture(t);
  const one = await app('one', { [A]: 'one' }, [cohort('one', 1, [A])]);
  const two = await app('two', { [A]: 'two' }, [cohort('two', 2, [A])]);
  const currentDir = await app('new', { [D]: 'new' });
  await assert.rejects(preserveEnergeticoAssets({ currentDir, buildId: 'new', now: NOW, previousDirs: [{ dir: one }, { dir: two }] }), /different bytes|collision/i);
});

test('collision with a current asset fails instead of overwriting the new build', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: 'old' }, [cohort('old', 1, [A])]);
  const currentDir = await app('new', { [A]: 'new' });
  await assert.rejects(preserveEnergeticoAssets({ currentDir, previousDir, buildId: 'new', now: NOW }), /different bytes|collision/i);
  assert.equal(await readFile(join(currentDir, A), 'utf8'), 'new');
});

for (const badPath of ['../outside.js', 'assets/../outside.js', '/assets/a-AAAAAAAA.js', 'https://evil.test/a-AAAAAAAA.js', 'assets\\a-AAAAAAAA.js', 'assets/nested/a-AAAAAAAA.js', 'assets/a-AAAAAAAA.js.map', 'assets/a-AAAAAAAA.js:secret']) {
  test(`rejects unsafe or non-retainable history path: ${badPath}`, async t => {
    const { app } = await fixture(t);
    const previousDir = await app('old', {}, [cohort('old', 1, [badPath])]);
    const currentDir = await app('new', { [D]: 'new' });
    await assert.rejects(preserveEnergeticoAssets({ currentDir, previousDir, buildId: 'new', now: NOW }), /asset.*path|invalid.*file/i);
  });
}

test('malformed history fails closed rather than reseeding all assets as fresh', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: 'old' });
  await writeFile(join(previousDir, 'asset-history.json'), '{broken');
  const currentDir = await app('new', { [D]: 'new' });
  await assert.rejects(preserveEnergeticoAssets({ currentDir, previousDir, previousDate: new Date(NOW).toISOString(), buildId: 'new', now: NOW }), /history/i);
});

test('legacy archives require an original timestamp and reject future timestamps', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: 'old' });
  const currentDir = await app('new', { [D]: 'new' });
  for (const previousDate of [undefined, 'bad', '2027-01-01T00:00:00Z']) {
    await assert.rejects(preserveEnergeticoAssets({ currentDir, previousDir, previousDate, buildId: 'new', now: NOW }), /timestamp|date/i);
  }
});

test('duplicate build IDs with different graph membership fail rather than merging partial graphs', async t => {
  const { app } = await fixture(t);
  const one = await app('one', { [A]: 'entry' }, [cohort('same', 1, [A])]);
  const two = await app('two', { [B]: 'report' }, [cohort('same', 1, [B])]);
  const currentDir = await app('new', { [D]: 'new' });
  await assert.rejects(preserveEnergeticoAssets({ currentDir, buildId: 'new', now: NOW, previousDirs: [{ dir: one }, { dir: two }] }), /cohort|graph/i);
});

test('symlinked assets directories cannot read or write outside a deployment root', async t => {
  const { app, root } = await fixture(t);
  const outside = await app('outside', { [A]: 'outside' });
  const previousDir = join(root, 'old');
  await mkdir(previousDir);
  await symlink(join(outside, 'assets'), join(previousDir, 'assets'), 'junction');
  const currentDir = await app('new', { [D]: 'new' });
  await assert.rejects(preserveEnergeticoAssets({ currentDir, previousDir, previousDate: '2026-10-27T12:00:00Z', buildId: 'new', now: NOW }), /symbolic|symlink/i);
});

test('symlinked history cannot supply metadata from outside the deployment', async t => {
  const { app, root } = await fixture(t);
  const previousDir = await app('old', { [A]: 'old' });
  const outside = join(root, 'outside-history.json');
  await writeFile(outside, JSON.stringify({ version: 1, cohorts: [cohort('old', 1, [A])] }));
  try { await symlink(outside, join(previousDir, 'asset-history.json'), 'file'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('file symlinks require Windows Developer Mode'); throw error; }
  const currentDir = await app('new', { [D]: 'new' });
  await assert.rejects(preserveEnergeticoAssets({ currentDir, previousDir, buildId: 'new', now: NOW }), /symbolic|symlink/i);
});

test('CLI supports first deploy and legacy --previous compatibility, and rejects unknown flags', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: 'old' });
  const currentDir = await app('new', { [D]: 'new' });
  const first = await runFile(process.execPath, [script, '--current', currentDir, '--build', 'new']);
  assert.equal(JSON.parse(first.stdout).retainedCohorts, 1);
  const nextDir = await app('next', { [B]: 'next' });
  await runFile(process.execPath, [script, '--current', nextDir, '--previous', previousDir, '--previous-date', new Date().toISOString(), '--build', 'next']);
  assert.equal(await readFile(join(nextDir, A), 'utf8'), 'old');
  await assert.rejects(runFile(process.execPath, [script, '--current', nextDir, '--build', 'next', '--typo', 'x']), error => error.code === 1 && /unknown/i.test(error.stderr));
});

test('a retained lazy report resolves its original entry and shares the live session without evaluating the new entry', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', {
    'assets/index-AAAAAAAA.mjs': 'export const session = { conversation: ["draft"], files: ["invoice.pdf"] };',
    'assets/report-BBBBBBBB.mjs': 'export { session } from "./index-AAAAAAAA.mjs";',
  });
  const currentDir = await app('new', { 'assets/index-DDDDDDDD.mjs': 'throw new Error("new bootstrap must not execute");' });
  await preserveEnergeticoAssets({ currentDir, previousDirs: [{ dir: previousDir, id: 'old', createdAt: '2026-10-27T12:00:00Z' }], buildId: 'new', now: NOW });
  const live = await import(pathToFileURL(join(currentDir, 'assets/index-AAAAAAAA.mjs')));
  const report = await import(pathToFileURL(join(currentDir, 'assets/report-BBBBBBBB.mjs')));
  assert.equal(report.session, live.session);
  assert.deepEqual(report.session, { conversation: ['draft'], files: ['invoice.pdf'] });
});

test('repeated deployments keep growth bounded and do not refresh the oldest graph date', async t => {
  const { app } = await fixture(t);
  let previousDir;
  for (let day = 0; day < 6; day++) {
    const currentDir = await app(`day-${day}`, { [`assets/entry-${String(day).padStart(8, '0')}.js`]: 'x' });
    const result = await preserveEnergeticoAssets({ currentDir, previousDir, buildId: `run-${day}`, now: NOW + day * DAY, maxAgeMs: 2 * DAY, maxBytes: 3 });
    assert.ok(result.totalBytes <= 3);
    assert.equal((await assets(currentDir)).length, Math.min(day + 1, 3));
    previousDir = currentDir;
  }
  assert.deepEqual((await history(previousDir)).cohorts.map(c => c.id), ['run-5', 'run-4', 'run-3']);
  assert.equal((await history(previousDir)).cohorts[2].createdAt, '2026-10-31T12:00:00.000Z');
});

test('rerunning a merged current directory prunes expired copies without resetting cohort dates', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: 'old' }, [cohort('old', 7, [A])]);
  const currentDir = await app('new', { [D]: 'new' });
  await preserveEnergeticoAssets({ currentDir, previousDir, buildId: 'new', now: NOW });
  await preserveEnergeticoAssets({ currentDir, buildId: 'new', now: NOW + DAY });
  assert.deepEqual(await assets(currentDir), ['index-DDDDDDDD.js']);
  assert.deepEqual((await history(currentDir)).cohorts, [cohort('new', 0, [D])]);
});

test('previousDirs takes precedence over compatibility inputs', async t => {
  const { app } = await fixture(t);
  const currentDir = await app('new', { [D]: 'new' });
  await preserveEnergeticoAssets({ currentDir, previousDirs: [], previousDir: 'does-not-exist', buildId: 'new', now: NOW });
  assert.deepEqual((await history(currentDir)).cohorts, [cohort('new', 0, [D])]);
});

test('inconsistent dates for an otherwise identical cohort use the oldest original timestamp', async t => {
  const { app } = await fixture(t);
  const one = await app('one', { [A]: 'same' }, [cohort('same', 3, [A])]);
  const two = await app('two', { [A]: 'same' }, [cohort('same', 1, [A])]);
  const currentDir = await app('new', { [D]: 'new' });
  await preserveEnergeticoAssets({ currentDir, previousDirs: [{ dir: one }, { dir: two }], buildId: 'new', now: NOW });
  assert.deepEqual((await history(currentDir)).cohorts[1], cohort('same', 3, [A]));
});

test('numeric GitHub run IDs normalize to strings and deduplicate existing history IDs', async t => {
  const { app } = await fixture(t);
  const legacy = await app('legacy', { [A]: 'same' });
  const recorded = await app('recorded', { [A]: 'same' }, [cohort('123456789', 1, [A])]);
  const currentDir = await app('new', { [D]: 'new' });
  await preserveEnergeticoAssets({ currentDir, buildId: 'new', now: NOW, previousDirs: [
    { dir: legacy, id: 123456789, createdAt: '2026-10-27T12:00:00Z' }, { dir: recorded },
  ] });
  assert.deepEqual((await history(currentDir)).cohorts, [cohort('new', 0, [D]), cohort('123456789', 1, [A])]);
});

test('an incomplete cohort that already exceeds the budget is excluded as a whole', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: 'too large' }, [cohort('old', 1, [A, B])]);
  const currentDir = await app('new', { [D]: 'x' });
  await preserveEnergeticoAssets({ currentDir, previousDir, buildId: 'new', now: NOW, maxBytes: 1 });
  assert.deepEqual(await assets(currentDir), ['index-DDDDDDDD.js']);
});

test('invalid calendar dates cannot keep legacy cohorts young', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', { [A]: 'old' });
  const currentDir = await app('new', { [D]: 'new' });
  await assert.rejects(preserveEnergeticoAssets({ currentDir, previousDir, previousDate: '2026-02-30T12:00:00Z', buildId: 'new', now: NOW }), /date|timestamp/i);
});

test('a directory masquerading as a hashed file is rejected', async t => {
  const { app } = await fixture(t);
  const previousDir = await app('old', {});
  await mkdir(join(previousDir, A));
  const currentDir = await app('new', { [D]: 'new' });
  await assert.rejects(preserveEnergeticoAssets({ currentDir, previousDir, previousDate: '2026-10-27T12:00:00Z', buildId: 'new', now: NOW }), /regular file/i);
});

test('a symlinked hashed file is rejected before its target can be read', async t => {
  const { app, root } = await fixture(t);
  const previousDir = await app('old', {});
  const outside = join(root, 'outside');
  await mkdir(outside);
  await symlink(outside, join(previousDir, A), 'junction');
  const currentDir = await app('new', { [D]: 'new' });
  await assert.rejects(preserveEnergeticoAssets({ currentDir, previousDir, previousDate: '2026-10-27T12:00:00Z', buildId: 'new', now: NOW }), /symbolic|symlink/i);
});

test('symlinked parent directories cannot bypass the deployment root checks', async t => {
  const { app, root } = await fixture(t);
  const outside = await app('outside/old', { [A]: 'old' });
  await symlink(join(root, 'outside'), join(root, 'linked'), 'junction');
  const currentDir = await app('new', { [D]: 'new' });
  assert.ok(outside);
  await assert.rejects(preserveEnergeticoAssets({ currentDir, previousDir: join(root, 'linked', 'old'), previousDate: '2026-10-27T12:00:00Z', buildId: 'new', now: NOW }), /symbolic|symlink/i);
});

for (const data of [{ cohorts: [] }, { version: 2, cohorts: [] }, { version: 1, cohorts: {} }, { version: 1, cohorts: [{ id: 'old', createdAt: '2026-10-27T12:00:00Z', files: [A, A] }] }]) {
  test(`invalid history structure fails closed: ${JSON.stringify(data)}`, async t => {
    const { app } = await fixture(t);
    const previousDir = await app('old', { [A]: 'old' });
    await writeFile(join(previousDir, 'asset-history.json'), JSON.stringify(data));
    const currentDir = await app('new', { [D]: 'new' });
    await assert.rejects(preserveEnergeticoAssets({ currentDir, previousDir, buildId: 'new', now: NOW }), /history/i);
  });
}
