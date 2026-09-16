import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chooseInternalGroup, chooseLatestBuild } from "../scripts/attach-testflight-build.mjs";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");

test("workflow separa validação gratuita da distribuição manual", async () => {
  const workflow = await read("../../../.github/workflows/energetico-ios.yml");
  const testflightJob = workflow.match(/\n  testflight:\n([\s\S]*?)\n  testflight-attach-existing:/)?.[1] || "";

  assert.match(workflow, /^permissions:\s*\n\s+contents: read/m);
  assert.match(workflow, /workflow_dispatch:[\s\S]*distribute:[\s\S]*type: boolean/);
  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(workflow, /PlugIns\/ShareExtension\.appex/);
  assert.ok(testflightJob, "job TestFlight ausente");
  assert.match(testflightJob, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.distribute == true \}\}/);
  assert.doesNotMatch(testflightJob, /github\.event_name == 'push'/);
  assert.match(workflow, /sync_testflight_testers:[\s\S]*type: boolean/);
  assert.match(workflow, /testflight_allowed_emails:[\s\S]*bernardonotini@energeticabr\.com/);
  const testerJob = workflow.match(/\n  testflight-testers:\n([\s\S]*)$/)?.[1] || "";
  assert.match(testerJob, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.sync_testflight_testers == true \}\}/);
  assert.match(testerJob, /node scripts\/manage-testflight-testers\.mjs/);
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

test("APK Android só é gerado após validar o login e o canal da VM", async () => {
  const workflow = await read("../../../.github/workflows/energetico-android.yml");
  const apkJob = workflow.match(/\n  debug-apk:\n([\s\S]*)$/)?.[1] || "";

  assert.match(workflow, /Confirmar acesso do Android à VM/);
  assert.match(workflow, /https:\/\/localhost/);
  assert.match(workflow, /\/api\/portal-chat/);
  assert.match(workflow, /Confirmar abertura do login Microsoft/);
  assert.match(apkJob, /needs: auth-smoke-test/);
});

test("workflow Android gera AAB de release assinado para o teste da Play Store", async () => {
  const workflow = await read("../../../.github/workflows/energetico-android.yml");
  const releaseJob = workflow.match(/\n  play-store-aab:\n([\s\S]*)$/)?.[1] || "";

  assert.ok(releaseJob, "job de AAB da Play Store ausente");
  assert.match(releaseJob, /needs: auth-smoke-test/);
  assert.match(releaseJob, /ENERGETICO_ANDROID_KEYSTORE_BASE64/);
  assert.match(releaseJob, /bundleRelease/);
  assert.match(releaseJob, /app-release\.aab/);
});

test("workflow publica automaticamente o AAB na faixa de testes fechados quando a credencial da Play existe", async () => {
  const workflow = await read("../../../.github/workflows/energetico-android.yml");
  const releaseJob = workflow.match(/\n  play-store-aab:\n([\s\S]*)$/)?.[1] || "";

  assert.match(releaseJob, /GOOGLE_PLAY_SERVICE_ACCOUNT_JSON/);
  assert.match(releaseJob, /r0adkll\/upload-google-play@v1/);
  assert.match(releaseJob, /packageName: br\.com\.energetica\.energetico/);
  assert.match(releaseJob, /tracks: alpha/);
  assert.match(releaseJob, /app-release\.aab/);
});

test("associacao do TestFlight escolhe a build ENERGETICO mais recente e o grupo interno", () => {
  const build = chooseLatestBuild([
    { id: "old", attributes: { version: "255", uploadedDate: "2026-09-08T20:00:00Z", expired: false } },
    { id: "new", attributes: { version: "256", uploadedDate: "2026-09-09T02:19:00Z", expired: false } },
    { id: "expired", attributes: { version: "257", uploadedDate: "2026-09-09T03:00:00Z", expired: true } },
  ]);
  assert.equal(build.id, "new");
  assert.equal(chooseInternalGroup([
    { id: "external", attributes: { name: "ENERGETICO Validacao", isInternalGroup: false } },
    { id: "internal", attributes: { name: "ENERGETICO Validacao", isInternalGroup: true } },
  ]).id, "internal");
});
