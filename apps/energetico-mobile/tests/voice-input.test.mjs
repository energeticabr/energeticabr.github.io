import test from "node:test";
import assert from "node:assert/strict";

import { createVoiceInputController } from "../src/ui/voice-input.js";

class FakeRecognition {
  static instances = [];

  constructor() {
    this.started = 0;
    this.stopped = 0;
    FakeRecognition.instances.push(this);
  }

  start() {
    this.started += 1;
    this.onstart?.();
  }

  stop() {
    this.stopped += 1;
    this.onend?.();
  }

  emitResult(results, resultIndex = 0) {
    this.onresult?.({ resultIndex, results });
  }

  emitError(error = "not-allowed") {
    this.onerror?.({ error });
  }
}

class FakeMediaRecorder {
  static instances = [];

  constructor(stream, options = {}) {
    this.stream = stream;
    this.options = options;
    this.state = "inactive";
    this.started = 0;
    this.stopped = 0;
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.started += 1;
    this.state = "recording";
    this.onstart?.();
  }

  stop() {
    this.stopped += 1;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

function result(transcript, isFinal) {
  return Object.assign([{ transcript }], { isFinal });
}

test("transcrição por pressão acumula finais e exibe parcial sem enviar", () => {
  FakeRecognition.instances = [];
  let draft = "Atividade inicial";
  const states = [];
  const controller = createVoiceInputController({
    getDraft: () => draft,
    setDraft: value => { draft = value; },
    getRecognition: () => FakeRecognition,
    onStateChange: state => states.push(state),
  });

  assert.equal(controller.start(), true);
  const recognition = FakeRecognition.instances[0];
  assert.equal(recognition.lang, "pt-BR");
  assert.equal(recognition.continuous, true);
  assert.equal(recognition.interimResults, true);
  assert.equal(recognition.started, 1);
  assert.equal(controller.isActive(), true);

  recognition.emitResult([result(" lançar", false)]);
  assert.equal(draft, "Atividade inicial lançar");
  recognition.emitResult([result("Laje grande", true)], 0);
  assert.equal(draft, "Atividade inicial Laje grande");

  controller.stop();
  assert.equal(recognition.stopped, 1);
  assert.equal(controller.isActive(), false);
  assert.equal(draft, "Atividade inicial Laje grande");
  assert.equal(states.some(state => state.active === true), true);
  assert.equal(states.at(-1).active, false);
  controller.destroy();
});

test("ausência da API de reconhecimento não quebra o compositor", () => {
  const errors = [];
  const controller = createVoiceInputController({
    getDraft: () => "",
    setDraft: () => {},
    getRecognition: () => null,
    onError: message => errors.push(message),
  });

  assert.equal(controller.start(), false);
  assert.equal(controller.isActive(), false);
  assert.match(errors[0], /não está disponível/i);
  controller.destroy();
});

test("aguarda a permissão nativa antes de iniciar o reconhecimento", async () => {
  FakeRecognition.instances = [];
  let resolvePermission;
  const permission = new Promise(resolve => { resolvePermission = resolve; });
  const controller = createVoiceInputController({
    getDraft: () => "",
    setDraft: () => {},
    getRecognition: () => FakeRecognition,
    ensureAudioPermission: () => permission,
  });

  assert.equal(controller.start(), true);
  assert.equal(FakeRecognition.instances.length, 0);
  resolvePermission(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(FakeRecognition.instances.length, 1);
  assert.equal(FakeRecognition.instances[0].started, 1);
  controller.stop();
  controller.destroy();
});

test("grava e transcreve quando o WebView não oferece SpeechRecognition", async () => {
  FakeMediaRecorder.instances = [];
  let draft = "Atividade inicial";
  let capturedFile = null;
  const stoppedTracks = [];
  const stream = { getTracks: () => [{ stop: () => stoppedTracks.push(true) }] };
  const controller = createVoiceInputController({
    getDraft: () => draft,
    setDraft: value => { draft = value; },
    getRecognition: () => null,
    getRecorder: () => FakeMediaRecorder,
    getAudioStream: async () => stream,
    ensureAudioPermission: async () => true,
    transcribeAudio: async file => {
      capturedFile = file;
      return "laje de transição executada";
    },
  });

  assert.equal(controller.start(), true);
  await Promise.resolve();
  await Promise.resolve();
  const recorder = FakeMediaRecorder.instances[0];
  assert.equal(recorder.started, 1);
  assert.equal(controller.isActive(), true);

  await controller.stop();
  assert.equal(recorder.stopped, 1);
  assert.equal(controller.isActive(), false);
  assert.equal(draft, "Atividade inicial laje de transição executada");
  assert.equal(capturedFile?.type, "audio/webm");
  assert.equal(capturedFile?.name, "energetico-voice-input.webm");
  assert.deepEqual(stoppedTracks, [true]);
  controller.destroy();
});
