import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chooseInternalGroup, chooseLatestBuild } from "../scripts/attach-testflight-build.mjs";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");

test("workflow separa validação gratuita da distribuição automática e manual", async () => {
  const workflow = await read("../../../.github/workflows/energetico-ios.yml");

  assert.match(workflow, /^permissions:\s*\n\s+contents: read/m);
  assert.match(workflow, /workflow_dispatch:[\s\S]*distribute:[\s\S]*type: boolean/);
  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(workflow, /PlugIns\/ShareExtension\.appex/);
  assert.match(workflow, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
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

test("associacao do TestFlight escolhe a build ENERGETICO mais recente e o grupo interno", () => {
  const build = chooseLatestBuild([
    { id: "old", attributes: { version: "255", uploadedDate: "2026-09-08T20:00:00Z", expired: false } },
    { id: "new", attributes: { version: "256", uploadedDate: "2026-09-09T02:19:00Z", expired: false } },
    { id: "expired", attributes: { version: "257", uploadedDate: "2026-09-09T03:00:00Z", expired: true } },
  ]);
  assert.equal(build.id, "new");
  assert.equal(chooseInternalGroup([
    { id: "external", attributes: { name: "ENERGETICO Validacao", isInternal: false } },
    { id: "internal", attributes: { name: "ENERGETICO Validacao", isInternal: true } },
  ]).id, "internal");
});
