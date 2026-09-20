import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  extractLockedBlock,
  updateSignatureGestureLock,
  verifyManifestTransition,
  verifySignatureGestureLock,
} from "../scripts/signature-gesture-lock.mjs";

test("a trava permanente não aceita autorização textual para editar gestos", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "signature-lock-permanent-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  const manifestPath = path.join(root, "signature-gesture-lock.json");
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    blocks: [{ id: "arraste", path: "gesture.js", sha256: "0".repeat(64) }],
    lastAuthorizedChange: null,
  }));

  await assert.rejects(
    updateSignatureGestureLock({ root, manifestPath, authorization: "Pode alterar o desenho e o arraste da assinatura." }),
    /permanente|somente.*usuário|manual/i,
  );
});

test("a extração exige exatamente um par de marcadores e preserva o corpo", () => {
  const source = [
    "antes",
    "// SIGNATURE_GESTURE_LOCK_START: desenho",
    "const protegido = true;",
    "// SIGNATURE_GESTURE_LOCK_END: desenho",
    "depois",
  ].join("\n");
  assert.equal(extractLockedBlock(source, "desenho"), "const protegido = true;\n");
  assert.throws(
    () => extractLockedBlock(`${source}\n// SIGNATURE_GESTURE_LOCK_START: desenho\nx\n// SIGNATURE_GESTURE_LOCK_END: desenho`, "desenho"),
    /exatamente um bloco/i,
  );
  assert.equal(
    extractLockedBlock("/* SIGNATURE_GESTURE_LOCK_START: css */\ntouch-action: none;\n/* SIGNATURE_GESTURE_LOCK_END: css */", "css"),
    "touch-action: none;\n",
  );
});

test("a comparação histórica rejeita remoção, troca de caminho e qualquer alteração protegida", () => {
  const oldHash = "1".repeat(64);
  const newHash = "2".repeat(64);
  const request = "Pode alterar o arraste da assinatura.";
  const requestSha256 = createHash("sha256").update(request, "utf8").digest("hex");
  const previous = {
    version: 1,
    blocks: [{ id: "arraste", path: "gesture.js", sha256: oldHash }],
    lastAuthorizedChange: {
      request,
      requestSha256,
      approvedBlocks: { arraste: oldHash },
    },
  };
  const removed = {
    version: 1,
    blocks: [],
    lastAuthorizedChange: previous.lastAuthorizedChange,
  };
  assert.throws(() => verifyManifestTransition(previous, removed, {}), /blocos protegidos|permanente|manifesto/i);

  const moved = {
    version: 1,
    blocks: [{ id: "arraste", path: "outro.js", sha256: newHash }],
    lastAuthorizedChange: {
      request,
      requestSha256,
      approvedBlocks: { arraste: newHash },
    },
  };
  assert.throws(
    () => verifyManifestTransition(previous, moved, { arraste: newHash }),
    /caminho|estrutura|protegido|permanente/i,
  );

  const reused = {
    version: 1,
    blocks: [{ id: "arraste", path: "gesture.js", sha256: newHash }],
    lastAuthorizedChange: moved.lastAuthorizedChange,
  };
  assert.throws(() => verifyManifestTransition(previous, reused, { arraste: newHash }), /permanente|manual|protegido/i);
});

test("a verificação falha quando um bloco protegido diverge da impressão digital", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "signature-lock-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  const sourcePath = path.join(root, "gesture.js");
  const manifestPath = path.join(root, "signature-gesture-lock.json");
  await writeFile(sourcePath, "// SIGNATURE_GESTURE_LOCK_START: desenho\nconst valor = 1;\n// SIGNATURE_GESTURE_LOCK_END: desenho\n");
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    blocks: [{ id: "desenho", path: "gesture.js", sha256: "0".repeat(64) }],
    lastAuthorizedChange: null,
  }));

  await assert.rejects(
    verifySignatureGestureLock({ root, manifestPath }),
    /impressão digital divergente/i,
  );
});

test("a atualização automatizada nunca grava novas impressões, mesmo com pedido explícito", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "signature-lock-update-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  const sourcePath = path.join(root, "gesture.js");
  const manifestPath = path.join(root, "signature-gesture-lock.json");
  await writeFile(sourcePath, "// SIGNATURE_GESTURE_LOCK_START: arraste\nconst valor = 2;\n// SIGNATURE_GESTURE_LOCK_END: arraste\n");
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    blocks: [{ id: "arraste", path: "gesture.js", sha256: "0".repeat(64) }],
    lastAuthorizedChange: null,
  }));

  const request = "Pode alterar o arraste da assinatura no documento.";
  await assert.rejects(
    updateSignatureGestureLock({ root, manifestPath, authorization: request }),
    /permanente|somente.*usuário|manual/i,
  );
  assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), {
    version: 1,
    blocks: [{ id: "arraste", path: "gesture.js", sha256: "0".repeat(64) }],
    lastAuthorizedChange: null,
  });
});

test("o manifesto real protege todos os blocos críticos do desenho e do arraste", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const manifestPath = path.join(root, "signature-gesture-lock.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(
    manifest.blocks.map(block => block.id).sort(),
    [
      "signature-pad-canvas-sizing",
      "signature-pad-coordinates",
      "signature-pad-event-arbitration",
      "signature-pad-gesture-state",
      "signature-pad-lifecycle",
      "signature-pad-mount",
      "signature-pad-rendering",
      "signature-pad-touch-css",
      "signature-placement-coordinates",
      "signature-placement-event-arbitration",
      "signature-placement-gesture-state",
      "signature-placement-marker-bindings",
      "signature-placement-mount",
      "signature-placement-touch-css",
    ],
  );
  assert.equal(manifest.lastAuthorizedChange, null);
  await verifySignatureGestureLock({ root, manifestPath });
});

test("a linha de comando aceita o separador padrão repassado pelo pnpm", () => {
  const mobileRoot = path.resolve(import.meta.dirname, "..");
  const output = execFileSync(
    process.execPath,
    ["scripts/signature-gesture-lock.mjs", "--", "--base-ref", "HEAD"],
    { cwd: mobileRoot, encoding: "utf8" },
  );
  assert.match(output, /14 blocos intactos/);
});

test("a linha de comando falha fechada sem base no CI ou com base inexistente", () => {
  const mobileRoot = path.resolve(import.meta.dirname, "..");
  const script = path.join(mobileRoot, "scripts/signature-gesture-lock.mjs");
  const noBase = spawnSync(process.execPath, [script], {
    cwd: mobileRoot,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  assert.notEqual(noBase.status, 0);
  assert.match(noBase.stderr, /revisão-base válida/i);

  const missingBase = spawnSync(process.execPath, [script, "--base-ref", "ref-que-nao-existe"], {
    cwd: mobileRoot,
    encoding: "utf8",
  });
  assert.notEqual(missingBase.status, 0);
  assert.match(missingBase.stderr, /não existe ou não foi baixada/i);

  const update = spawnSync(process.execPath, [script, "--update", "--authorization", "Pode alterar o arraste da assinatura."], {
    cwd: mobileRoot,
    encoding: "utf8",
  });
  assert.notEqual(update.status, 0);
  assert.match(update.stderr, /permanente|somente.*usuário|manual/i);
});

test("o repositório obriga a trava nas instruções, scripts e pipelines móveis", async () => {
  const mobileRoot = path.resolve(import.meta.dirname, "..");
  const repositoryRoot = path.resolve(mobileRoot, "../..");
  const packageJson = JSON.parse(await readFile(path.join(mobileRoot, "package.json"), "utf8"));
  const agents = await readFile(path.join(repositoryRoot, "AGENTS.md"), "utf8");
  const workflow = await readFile(path.join(repositoryRoot, ".github/workflows/signature-gesture-lock.yml"), "utf8");
  const ios = await readFile(path.join(repositoryRoot, ".github/workflows/energetico-ios.yml"), "utf8");
  const android = await readFile(path.join(repositoryRoot, ".github/workflows/energetico-android.yml"), "utf8");

  assert.equal(packageJson.scripts["guard:signature-gestures"], "node scripts/signature-gesture-lock.mjs");
  assert.equal(packageJson.scripts["guard:signature-gestures:update"], undefined);
  assert.match(agents, /NÃO EDITE.*desenho.*arraste.*assinatura/is);
  assert.match(agents, /somente o usuário.*mudança protegida/is);
  assert.doesNotMatch(agents, /guard:signature-gestures:update/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.doesNotMatch(workflow, /\n\s+paths:/);
  for (const source of [workflow, ios, android]) {
    assert.match(source, /guard:signature-gestures/);
    assert.match(source, /--base-ref/);
    assert.match(source, /github\.event\.repository\.default_branch/);
  }
  const androidGuardJob = android.slice(android.indexOf("signature-gesture-lock:"), android.indexOf("auth-smoke-test:"));
  const androidAuthJob = android.slice(android.indexOf("auth-smoke-test:"), android.indexOf("debug-apk:"));
  const androidPlayJob = android.slice(android.indexOf("play-store-aab:"));
  assert.match(androidGuardJob, /guard:signature-gestures/);
  assert.match(androidAuthJob, /needs:\s*signature-gesture-lock/);
  assert.match(androidPlayJob, /needs:\s*\[signature-gesture-lock, auth-smoke-test\]/);
  assert.match(androidPlayJob, /needs\.signature-gesture-lock\.result == 'success'/);
  assert.equal((android.match(/Verificar trava dos gestos da assinatura/g) || []).length, 1);
});
