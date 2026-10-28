import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';

const workflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
const script = workflow.match(/          script: \|\r?\n([\s\S]*?)(?=\r?\n      - name:)/)[1]
  .split(/\r?\n/).map(line => line.slice(12)).join('\n');
const NOW = Date.parse('2026-10-28T20:00:00Z');
const date = hours => new Date(NOW - hours * 3_600_000).toISOString();

function deployment(id, runId, { age = 1, completedAge = age, attempt = 1, history = false, ...runFields } = {}) {
  const sha = `sha-${runId}`;
  const log = `https://github.com/owner/site/actions/runs/${runId}/job/${id}`;
  return {
    record: { id, sha, ref: 'main', environment: 'github-pages', created_at: date(age), updated_at: date(completedAge) },
    statuses: [{ state: 'success', created_at: date(completedAge), updated_at: date(completedAge), log_url: log, target_url: log }],
    run: { id: runId, head_sha: sha, head_branch: 'main', path: '.github/workflows/pages.yml', run_attempt: attempt,
      status: 'completed', conclusion: 'success', created_at: date(age), updated_at: date(completedAge), run_started_at: date(age), ...runFields },
    artifacts: [{ id, name: history ? 'energetico-web-assets' : 'github-pages', expired: false, created_at: date(age), updated_at: date(age) }],
  };
}

async function select(entries, { legacyRuns = [] } = {}) {
  const commands = [], requests = [], outputs = new Map();
  const actions = {
    listWorkflowRuns: async () => ({ data: { workflow_runs: legacyRuns } }),
    getWorkflowRun: async ({ run_id }) => {
      requests.push(['run', run_id]);
      return { data: entries.find(entry => entry.run.id === run_id).run };
    },
    listWorkflowRunArtifacts: async ({ run_id }) => ({ data: { artifacts: entries.find(entry => entry.run.id === run_id).artifacts } }),
  };
  const repos = {
    listDeployments: async ({ environment, per_page, page = 1 }) => {
      assert.equal(environment, 'github-pages');
      assert.equal(per_page, 30);
      requests.push(['page', page]);
      return { data: entries.slice((page - 1) * per_page, page * per_page).map(entry => entry.record) };
    },
    listDeploymentStatuses: async ({ deployment_id, per_page, page = 1 }) => ({
      data: entries.find(entry => entry.record.id === deployment_id).statuses.slice((page - 1) * per_page, page * per_page),
    }),
  };
  const require = name => {
    if (name === 'node:path') return path;
    if (name === 'node:fs') return { mkdirSync() {} };
    if (name === 'node:child_process') return { execFileSync: (file, args) => commands.push({ file, args: [...args] }) };
    throw new Error(`Unexpected dependency: ${name}`);
  };
  await runInNewContext(`(async () => {${script}\n})()`, {
    require, github: { rest: { actions, repos } }, context: { repo: { owner: 'owner', repo: 'site' }, runId: 99999 },
    core: { setOutput: (key, value) => outputs.set(key, value), info() {}, warning() {} },
    Date: class extends Date { static now() { return NOW; } },
  });
  return { sources: JSON.parse(outputs.get('sources')), commands, requests };
}

test('uses the latest successful deployment of an old rerun, outside the latest 30 created runs', async () => {
  const pending = deployment(301, 301, { age: 0.1 });
  pending.statuses[0].state = 'in_progress';
  const newerRun = deployment(300, 300, { age: 1, completedAge: 0.8, history: true });
  const rerun = deployment(100, 100, { age: 2, completedAge: 0.2, attempt: 2, history: true, created_at: date(240) });
  const legacyRuns = [newerRun.run, ...Array.from({ length: 29 }, (_, index) => deployment(400 + index, 400 + index).run)];
  const { sources, commands } = await select([pending, newerRun, rerun], { legacyRuns });
  assert.deepEqual(sources, [{ dir: path.resolve('.previous-energetico', '100'), id: 'sha-100-100-2', createdAt: date(0.2) }]);
  assert.deepEqual(commands, [{ file: 'gh', args: ['run', 'download', '100', '--repo', 'owner/site', '--name', 'energetico-web-assets', '--dir', path.resolve('.previous-energetico', '100')] }]);
});

test('paginates deployments past 30 unsuccessful attempts to find a successful rerun', async () => {
  const pending = Array.from({ length: 30 }, (_, index) => {
    const entry = deployment(500 - index, 500 - index);
    entry.statuses[0].state = 'failure';
    return entry;
  });
  const rerun = deployment(100, 100, { age: 2, attempt: 3, history: true, created_at: date(240) });
  const { sources, requests } = await select([...pending, rerun]);
  assert.equal(sources[0]?.id, 'sha-100-100-3');
  assert.ok(requests.some(([kind, page]) => kind === 'page' && page === 2));
});

test('bootstraps legacy graphs until the most recent history archive, using successful dates and attempt IDs', async () => {
  const latest = deployment(30, 30, { age: 1, completedAge: 0.5, attempt: 2, created_at: date(240) });
  const history = deployment(20, 20, { age: 2, history: true });
  history.artifacts.unshift({ id: 2000, name: 'github-pages', expired: false, created_at: date(2), updated_at: date(2) });
  const older = deployment(10, 10, { age: 3, history: true });
  const { sources, commands } = await select([latest, history, older]);
  assert.deepEqual(sources, [
    { dir: path.join(path.resolve('.previous-energetico', '30'), 'energetico'), createdAt: date(0.5), id: 'sha-30-30-2' },
    { dir: path.resolve('.previous-energetico', '20'), createdAt: date(2), id: 'sha-20-20-1' },
  ]);
  assert.deepEqual(commands.map(command => command.file), ['gh', 'tar', 'gh']);
  assert.deepEqual(commands[1].args, ['-xf', path.join(path.resolve('.previous-energetico', '30'), 'artifact.tar'), '-C', path.resolve('.previous-energetico', '30')]);
});

test('keeps at most eight legacy sources, skipping expired artifacts and duplicate run attempts', async () => {
  const expired = deployment(100, 100, { age: 0.1 });
  expired.artifacts[0].expired = true;
  const entries = Array.from({ length: 10 }, (_, index) => deployment(90 - index, 90 - index, { age: index + 1 }));
  const duplicate = { ...entries[0], record: { ...entries[0].record, id: 99 } };
  const { sources, commands } = await select([expired, duplicate, ...entries]);
  assert.equal(sources.length, 8);
  assert.deepEqual(sources.map(source => source.id), ['sha-90-90-1', 'sha-89-89-1', 'sha-88-88-1', 'sha-87-87-1', 'sha-86-86-1', 'sha-85-85-1', 'sha-84-84-1', 'sha-83-83-1']);
  assert.equal(commands.filter(command => command.file === 'gh').length, 8);
});

test('requires a successful Pages workflow deployment, including success behind an inactive status', async () => {
  const foreign = deployment(100, 100, { path: '.github/workflows/other.yml' });
  const branch = deployment(90, 90, { head_branch: 'feature' });
  const invalid = deployment(80, 80);
  invalid.statuses[0].log_url = 'https://evil.test/owner/site/actions/runs/80/job/80';
  const old = deployment(70, 70, { age: 169 });
  const valid = deployment(60, 60, { age: 2, history: true });
  valid.statuses.unshift({ state: 'inactive', created_at: date(0.5) });
  const { sources } = await select([foreign, branch, invalid, valid, old]);
  assert.deepEqual(sources.map(source => source.id), ['sha-60-60-1']);
});

test('does not use an older successful deployment with artifacts overwritten by a later failed attempt', async () => {
  const overwritten = deployment(30, 30, { age: 2, completedAge: 1 });
  overwritten.run.run_attempt = 2;
  overwritten.run.run_started_at = date(0.5);
  overwritten.run.conclusion = 'failure';
  overwritten.artifacts[0].created_at = date(0.4);
  const valid = deployment(20, 20, { age: 3, history: true });
  const { sources } = await select([overwritten, valid]);
  assert.deepEqual(sources.map(source => source.id), ['sha-20-20-1']);
});

test('a first deployment with no previous successful deployments produces no sources or commands', async () => {
  const { sources, commands } = await select([]);
  assert.deepEqual(sources, []);
  assert.deepEqual(commands, []);
});

test('uses a successful status updated_at and target_url when its optional fields are absent', async () => {
  const entry = deployment(30, 30, { age: 2, completedAge: 1, history: true });
  delete entry.statuses[0].created_at;
  delete entry.statuses[0].log_url;
  const { sources } = await select([entry]);
  assert.equal(sources[0]?.createdAt, '2026-10-28T19:00:00.000Z');
});

test('keeps the seven-day boundary but never restores artifacts from a different attempt', async () => {
  const wrongAttempt = deployment(40, 40, { age: 1, attempt: 2, history: true });
  wrongAttempt.artifacts[0].created_at = date(2);
  const boundary = deployment(30, 30, { age: 168, history: true });
  const expired = deployment(20, 20, { age: 169, history: true });
  const { sources } = await select([wrongAttempt, boundary, expired]);
  assert.deepEqual(sources.map(source => source.id), ['sha-30-30-1']);
});

test('the preserve step gives each redeployment attempt a distinct cohort ID', async () => {
  const step = workflow.split('      - name: Preserve complete assets for already open Energético sessions')[1].split('\n      - name:')[0];
  const envLines = step.split(/\r?\n/).filter(line => /^          [A-Z_]+: /.test(line));
  const body = step.match(/          node --input-type=module <<'NODE'\r?\n([\s\S]*?)          NODE/)[1]
    .replace(/^          import .*;\r?\n/m, '');
  const ids = [];
  for (const attempt of [1, 2]) {
    const values = { 'github.sha': 'same-sha', 'github.run_id': '123', 'github.run_attempt': String(attempt), 'steps.previous-assets.outputs.sources': '[]' };
    const env = Object.fromEntries(envLines.map(line => {
      const [, key, value] = line.match(/^          ([A-Z_]+): (.*)$/);
      return [key, value.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => values[key])];
    }));
    await runInNewContext(`(async () => {${body}\n})()`, {
      process: { env }, console: { log() {} },
      preserveEnergeticoAssets: async options => { ids.push(options.buildId); return { cohorts: [], totalFiles: 1 }; },
    });
  }
  assert.deepEqual(ids, ['same-sha-123-1', 'same-sha-123-2']);
});
