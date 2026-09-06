import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");

test("workflow separa validação gratuita da distribuição manual", async () => {
  const workflow = await read("../../../.github/workflows/energetico-ios.yml");

  assert.match(workflow, /^permissions:\s*\n\s+contents: read/m);
  assert.match(workflow, /workflow_dispatch:[\s\S]*distribute:[\s\S]*type: boolean/);
  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(workflow, /PlugIns\/ShareExtension\.appex/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.distribute == true/);
  assert.match(workflow, /Validar credenciais Apple preexistentes/);
});

test("pacote documenta o limite sem gastos e a aceitação no iPhone", async () => {
  const distribution = await read("../DISTRIBUTION.md");
  const acceptance = await read("../ACCEPTANCE.md");

  assert.match(distribution, /não compra/i);
  assert.match(distribution, /Apple Developer/i);
  assert.match(distribution, /TestFlight/i);
  assert.match(acceptance, /BUILD_READY_SIGNING_BLOCKED/);
  assert.match(acceptance, /falha de rede/i);
  assert.match(acceptance, /Compartilhar/i);
});
