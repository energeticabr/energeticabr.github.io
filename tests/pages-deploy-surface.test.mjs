import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

test("o GitHub Pages publica somente a superficie do site e exclui artefatos internos", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");

  assert.match(workflow, /path:\s*_site/);
  assert.match(workflow, /cp\s+-R\s+assets\s+portal\s+_site\//);
  assert.match(workflow, /pnpm --dir apps\/energetico-mobile install --frozen-lockfile/);
  assert.match(workflow, /pnpm --dir apps\/energetico-mobile run build:pwa/);
  assert.match(workflow, /cp\s+-R\s+apps\/energetico-mobile\/dist-pwa\s+_site\/energetico/);
  assert.match(workflow, /cp\s+--\s+\*\.html\s+CNAME\s+robots\.txt\s+sitemap\.xml\s+\.nojekyll\s+_site\//);
  assert.doesNotMatch(workflow, /path:\s*\./);
});

test("o deploy aguarda a indexação do pacote exato desta tentativa", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  const wait = workflow.match(/- name: Wait for the uploaded Pages artifact\r?\n([\s\S]*?)(?=\r?\n      - name: Deploy)/);
  assert.ok(wait);
  const script = wait[1].split("          script: |")[1];
  const calls = [];
  const delays = [];
  const artifact = { id: 38, name: "github-pages-attempt-2", expired: false };
  const responses = [[], [{ ...artifact, id: 37 }], [artifact]];
  await runInNewContext(`(async () => {${script}})()`, {
    require: () => ({ setTimeout: async delay => { delays.push(delay); } }),
    context: { repo: { owner: "org", repo: "site" }, runId: 82 },
    process: { env: { PAGES_ARTIFACT_ID: "38", PAGES_ARTIFACT_NAME: artifact.name } },
    core: { info() {} },
    github: { rest: { actions: {
      listWorkflowRunArtifacts: async options => {
        calls.push(options);
        return { data: { artifacts: responses.shift() } };
      },
    } } },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.run_id === 82 && call.name === artifact.name));
  assert.deepEqual(delays, [5000, 5000, 20000]);
});
