import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("o GitHub Pages publica somente a superficie do site e exclui artefatos internos", async () => {
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");

  assert.match(workflow, /path:\s*_site/);
  assert.match(workflow, /cp\s+-R\s+assets\s+portal\s+_site\//);
  assert.match(workflow, /cp\s+--\s+\*\.html\s+CNAME\s+robots\.txt\s+sitemap\.xml\s+\.nojekyll\s+_site\//);
  assert.doesNotMatch(workflow, /path:\s*\./);
});
