import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import {
  attachLatestTestFlightBuild,
  chooseInternalGroup,
  chooseLatestBuild,
} from "../scripts/attach-testflight-build.mjs";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8")
  .then(value => value.replace(/\r\n/g, "\n"));

test("workflow mantém validação gratuita antes da distribuição TestFlight", async () => {
  const workflow = await read("../../../.github/workflows/energetico-ios.yml");
  const testflightJob = workflow.match(/\n  testflight:\n([\s\S]*?)\n  testflight-attach-existing:/)?.[1] || "";

  assert.match(workflow, /^permissions:\s*\n\s+contents: read/m);
  assert.match(workflow, /workflow_dispatch:[\s\S]*distribute:[\s\S]*type: boolean/);
  assert.match(workflow, /runs-on: macos-26/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(workflow, /PlugIns\/ShareExtension\.appex/);
  assert.ok(testflightJob, "job TestFlight ausente");
  assert.match(testflightJob, /needs:\s*\n\s*- web-tests\s*\n\s*- ios-simulator/);
  assert.match(testflightJob, /environment: app-store-connect/);
  assert.match(workflow, /sync_testflight_testers:[\s\S]*type: boolean/);
  assert.match(workflow, /testflight_allowed_emails:[\s\S]*bernardonotini@energeticabr\.com/);
  const testerJob = workflow.match(/\n  testflight-testers:\n([\s\S]*)$/)?.[1] || "";
  assert.match(testerJob, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.sync_testflight_testers == true \}\}/);
  assert.match(testerJob, /node scripts\/manage-testflight-testers\.mjs/);
  assert.match(workflow, /Validar credenciais Apple preexistentes/);
});

test("TestFlight distribui main validada e respeita os controles manuais", async () => {
  const workflow = await read("../../../.github/workflows/energetico-ios.yml");
  const job = workflow.match(/\n  testflight:\n([\s\S]*?)\n  testflight-attach-existing:/)?.[1] || "";
  const condition = job.match(/^    if: \$\{\{ (.*) \}\}$/m)?.[1];
  assert.ok(condition, "condição de distribuição ausente");
  for (const [event_name, ref, inputs, expected] of [
    ["push", "refs/heads/main", {}, true],
    ["push", "refs/heads/feat/energetico-ios-chat", {}, false],
    ["pull_request", "refs/pull/185/merge", { distribute: true }, false],
    ["workflow_dispatch", "refs/heads/main", { distribute: true }, true],
    ["workflow_dispatch", "refs/heads/main", { distribute: false }, false],
    ["workflow_dispatch", "refs/heads/main", { submit_app_store: true, distribute: false }, false],
    ["schedule", "refs/heads/main", {}, false],
  ]) {
    const actual = Boolean(runInNewContext(condition, { github: { event_name, ref }, inputs }, { timeout: 100 }));
    assert.equal(actual, expected, `${event_name} ${ref}: ${JSON.stringify(inputs)}`);
  }
  const review = workflow.match(/\n  app-store-review:\n([\s\S]*?)\n  web-tests:/)?.[1] || "";
  const reviewCondition = review.match(/^    if: \$\{\{ (.*) \}\}$/m)?.[1];
  assert.ok(reviewCondition, "condição de revisão App Store ausente");
  assert.equal(Boolean(runInNewContext(reviewCondition, {
    github: { event_name: "push" }, inputs: {},
  }, { timeout: 100 })), false);
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
  assert.match(releaseJob, /needs: \[signature-gesture-lock, auth-smoke-test\]/);
  assert.match(releaseJob, /needs\.signature-gesture-lock\.result == 'success'/);
  assert.match(releaseJob, /ENERGETICO_ANDROID_KEYSTORE_BASE64/);
  assert.match(releaseJob, /bundleRelease/);
  assert.match(releaseJob, /app-release\.aab/);
});

test("falha de rede do smoke test Microsoft não bloqueia o AAB interno", async () => {
  const workflow = await read("../../../.github/workflows/energetico-android.yml");
  const releaseJob = workflow.match(/\n  play-store-aab:\n([\s\S]*)$/)?.[1] || "";

  assert.match(releaseJob, /if: \$\{\{ always\(\)/);
  assert.match(releaseJob, /needs\.auth-smoke-test\.result/);
  assert.match(releaseJob, /Resultado do smoke test Android/);
  assert.match(releaseJob, /tracks: internal/);
});

test("workflow publica automaticamente o AAB na faixa de teste interno quando a credencial da Play existe", async () => {
  const workflow = await read("../../../.github/workflows/energetico-android.yml");
  const releaseJob = workflow.match(/\n  play-store-aab:\n([\s\S]*)$/)?.[1] || "";

  assert.match(releaseJob, /GOOGLE_PLAY_SERVICE_ACCOUNT_JSON/);
  assert.match(releaseJob, /r0adkll\/upload-google-play@v1/);
  assert.match(releaseJob, /packageName: br\.com\.energetica\.energetico/);
  assert.match(releaseJob, /tracks: internal/);
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

test("associacao do TestFlight confirma o vínculo após timeout da Apple", async () => {
  let groupReads = 0;
  const build = {
    id: "build-301",
    attributes: { version: "301", uploadedDate: "2026-09-18T16:00:00Z", expired: false, processingState: "VALID" },
  };
  const client = {
    async request(method, path) {
      if (method === "GET" && path.startsWith("/v1/builds?")) return { data: [build] };
      if (method === "GET" && path.endsWith("/buildBetaDetail")) {
        return { data: { attributes: { internalBuildState: "READY_FOR_BETA_TESTING" } } };
      }
      if (method === "GET" && path.startsWith("/v1/betaGroups?")) {
        return { data: [{ id: "group-1", attributes: { name: "ENERGETICO Validacao", isInternal: true } }] };
      }
      if (method === "GET" && path === "/v1/builds/build-301?include=betaGroups") {
        groupReads += 1;
        return { data: { id: build.id, relationships: { betaGroups: { data: groupReads > 1 ? [{ type: 'betaGroups', id: 'group-1' }] : [] } } } };
      }
      if (method === "POST" && path.endsWith("/relationships/builds")) {
        throw new Error("The operation was aborted due to timeout");
      }
      throw new Error(`Requisição inesperada: ${method} ${path}`);
    },
  };

  const result = await attachLatestTestFlightBuild(client);

  assert.equal(result.status, "ATTACHED_AFTER_TIMEOUT");
  assert.equal(result.build, "301");
  assert.equal(groupReads, 2);
});

for (const linked of [true,false]) test(`TestFlight checks the selected build relationship and ${linked?'keeps an existing association':'confirms a new association'}`,async()=>{
  let attached=linked,posts=0,relationshipReads=0;
  const build={id:'ready-build',attributes:{version:'302',processingState:'VALID',expired:false}};
  const client={async request(method,path,payload){
    if(method==='GET'&&path.startsWith('/v1/builds?'))return{data:[build]};
    if(method==='GET'&&path.endsWith('/buildBetaDetail'))return{data:{attributes:{internalBuildState:'READY_FOR_BETA_TESTING'}}};
    if(method==='GET'&&path.startsWith('/v1/betaGroups?'))return{data:[{id:'internal-group',attributes:{name:'ENERGETICO Validacao',isInternalGroup:true}}]};
    if(method==='GET'&&path==='/v1/builds/ready-build?include=betaGroups'){
      relationshipReads++;return{data:{id:build.id,relationships:{betaGroups:{data:attached?[{type:'betaGroups',id:'internal-group'}]:[]}}}};
    }
    if(method==='POST'&&path==='/v1/betaGroups/internal-group/relationships/builds'){
      assert.deepEqual(payload,{data:[{type:'builds',id:build.id}]});posts++;attached=true;return{};
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  }};
  const result=await attachLatestTestFlightBuild(client);
  assert.equal(result.status,linked?'ALREADY_ATTACHED':'ATTACHED');assert.equal(posts,linked?0:1);
  assert.equal(relationshipReads,linked?1:2);
});

for(const paging of [{total:51},{nextCursor:'next-page'}])test(`TestFlight rejects a partial build group relationship before writing: ${JSON.stringify(paging)}`,async()=>{
  let posts=0;
  const build={id:'paged-build',attributes:{version:'303',processingState:'VALID',expired:false}};
  const client={async request(method,path){
    if(method==='POST'){posts++;return{};}
    if(path.startsWith('/v1/builds?'))return{data:[build]};
    if(path.endsWith('/buildBetaDetail'))return{data:{attributes:{internalBuildState:'READY_FOR_BETA_TESTING'}}};
    if(path.startsWith('/v1/betaGroups?'))return{data:[{id:'target-group',attributes:{name:'ENERGETICO Validacao',isInternalGroup:true}}]};
    if(path==='/v1/builds/paged-build?include=betaGroups')return{data:{id:build.id,relationships:{betaGroups:{
      data:Array.from({length:50},(_,i)=>({type:'betaGroups',id:`other-${i}`})),meta:{paging}
    }}}};
    throw new Error('Unexpected request');
  }};
  await assert.rejects(attachLatestTestFlightBuild(client),/incompleta/);
  assert.equal(posts,0);
});
