import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const controllerURL = new URL("../ios/ShareExtension/ShareViewController.swift", import.meta.url);

// Wiring guards complement the executable Swift progress cases in native-share.
test("compartilhamento nativo coloca o percentual abaixo do mascote antes do título", async () => {
  const controller = await readFile(controllerURL, "utf8");
  assert.match(controller, /private let progressHeader = SharedUploadProgressHeader\(\)/);
  assert.match(controller, /arrangedSubviews: \[\s*progressHeader, titleLabel/);
});

test("compartilhamento nativo mede bytes sem trocar o envio de arquivo por uma cópia em memória", async () => {
  const controller = await readFile(controllerURL, "utf8");
  assert.match(controller, /SharedUploadProgressDelegate/);
  assert.match(controller, /URLSession\.shared\.upload\(for: request, fromFile: fileURL, delegate: delegate\)/);
  assert.match(controller, /recordSentBytes\(id: item\.id, totalBytesSent: totalBytesSent\)/);
  assert.match(controller, /guard !self\.isCancelled, !self\.extensionCompleted/);
});

test("compartilhamento nativo só confirma progresso após salvar o recibo e o estado", async () => {
  const controller = await readFile(controllerURL, "utf8");
  assert.match(controller, /saveConfirmedResponse\(id: item\.id, data: response\)[\s\S]*updateState\(id: item\.id, state: "uploaded"\)[\s\S]*uploadProgress\?\.confirm\(id: item\.id\)/);
  assert.match(controller, /SharedUploadProgress\([\s\S]*stagedItems\.map[\s\S]*hasPreparationFailures: !stagingFailures\.isEmpty/);
});

test("os executores nativos do CI não entram na descoberta automática dos testes Node da publicação web", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/energetico-ios.yml", import.meta.url), "utf8");
  const runners = [...workflow.matchAll(/node (scripts\/[^\s]+\.mjs)/g)]
    .map((match) => match[1]).filter((path) => path.includes("native-share"));
  assert.equal(runners.length, 2);
  for (const runner of runners) {
    assert.doesNotMatch(runner, /(?:^|\/)test-[^/]+\.mjs$/);
    await readFile(new URL(`../${runner}`, import.meta.url), "utf8");
  }
});
