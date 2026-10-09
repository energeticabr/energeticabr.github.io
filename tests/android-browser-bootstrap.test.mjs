import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/energetico-android.yml', import.meta.url), 'utf8');
const jobs = [...workflow.matchAll(/^  ([a-z][\w-]*):/gm)];

for (const id of ['debug-apk', 'play-store-aab']) {
  test(`${id} prepares the installed Chrome before real browser checks and keeps the full suite`, () => {
    const index = jobs.findIndex(match => match[1] === id);
    assert.notEqual(index, -1);
    const body = workflow.slice(jobs[index].index, jobs[index + 1]?.index ?? workflow.length);
    const prepare = body.indexOf('timeout 10s /usr/bin/google-chrome --version');
    const suite = body.indexOf('pnpm test');
    const readiness = body.indexOf('node --test tests/browser-layout-runner.test.mjs');
    assert.ok(prepare >= 0, 'the validated cold-start preparation must also run in the build job');
    assert.ok(suite > prepare, 'preparation must precede the unchanged full suite');
    if (readiness >= 0) assert.ok(readiness > prepare, 'preparation must precede the first browser startup');
    assert.ok(body.includes('pnpm build'), 'native web assets must still be built');
  });
}
