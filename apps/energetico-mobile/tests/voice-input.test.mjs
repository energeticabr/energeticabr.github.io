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

test("falha do serviço SpeechRecognition não é apresentada como permissão do microfone desativada", async () => {
  FakeRecognition.instances = [];
  const errors = [];
  const controller = createVoiceInputController({
    getRecognition: () => FakeRecognition,
    ensureAudioPermission: async () => true,
    onError: message => errors.push(message),
  });

  controller.start();
  await Promise.resolve();
  await Promise.resolve();
  FakeRecognition.instances[0].emitError("service-not-allowed");

  assert.match(errors[0], /serviço de ditado/i);
  assert.doesNotMatch(errors[0], /microfone.*bloqueado|autorize o microfone/i);
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
  assert.equal(controller.isPending(), true);
  assert.equal(FakeRecognition.instances.length, 0);
  resolvePermission(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(FakeRecognition.instances.length, 1);
  assert.equal(FakeRecognition.instances[0].started, 1);
  assert.equal(controller.isPending(), false);
  controller.stop();
  controller.destroy();
});

test("cancelar enquanto o gravador aguarda o áudio não inicia gravação", async () => {
  FakeMediaRecorder.instances = [];
  let resolveStream;
  let tracksStopped = 0;
  const stream = { getTracks: () => [{ stop: () => { tracksStopped += 1; } }] };
  const waitingStream = new Promise(resolve => { resolveStream = resolve; });
  const controller = createVoiceInputController({
    getRecognition: () => null,
    getRecorder: () => FakeMediaRecorder,
    getAudioStream: () => waitingStream,
  });

  controller.start();
  assert.equal(controller.isPending(), true);
  controller.cancel();
  resolveStream(stream);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(FakeMediaRecorder.instances.length, 0);
  assert.equal(tracksStopped, 1);
  assert.equal(controller.isPending(), false);
  controller.destroy();
});

test("resposta atrasada de captação cancelada não inicia a próxima gravação", async () => {
  FakeMediaRecorder.instances = [];
  const resolvers = [];
  const stopped = [];
  const controller = createVoiceInputController({
    getRecognition: () => null,
    getRecorder: () => FakeMediaRecorder,
    getAudioStream: () => new Promise(resolve => { resolvers.push(resolve); }),
  });

  controller.start();
  controller.cancel();
  controller.start();
  resolvers[0]({ getTracks: () => [{ stop: () => stopped.push("old") }] });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(FakeMediaRecorder.instances.length, 0);
  assert.deepEqual(stopped, ["old"]);

  resolvers[1]({ getTracks: () => [{ stop: () => stopped.push("new") }] });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(FakeMediaRecorder.instances.length, 1);
  controller.destroy();
});

test("autorização atrasada cancelada não inicia reconhecimento da tentativa nova", async () => {
  FakeRecognition.instances = [];
  const resolvers = [];
  const controller = createVoiceInputController({
    getRecognition: () => FakeRecognition,
    ensureAudioPermission: () => new Promise(resolve => { resolvers.push(resolve); }),
  });

  controller.start();
  controller.cancel();
  controller.start();
  resolvers[0](true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(FakeRecognition.instances.length, 0);

  resolvers[1](true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(FakeRecognition.instances.length, 1);
  controller.destroy();
});

test("evento atrasado do reconhecimento cancelado não altera a nova tentativa", () => {
  FakeRecognition.instances = [];
  let draft = "";
  const controller = createVoiceInputController({
    getDraft: () => draft,
    setDraft: value => { draft = value; },
    getRecognition: () => FakeRecognition,
  });

  controller.start();
  const oldRecognition = FakeRecognition.instances[0];
  controller.cancel();
  controller.start();
  oldRecognition.emitResult([result("Antigo", true)]);
  oldRecognition.emitError("no-speech");
  assert.equal(controller.isActive(), true);
  assert.equal(draft, "");

  FakeRecognition.instances[1].emitResult([result("Novo", true)]);
  assert.equal(draft, "Novo");
  controller.destroy();
});

test("resultado final entregue após soltar o microfone permanece no rascunho", () => {
  class DelayedRecognition {
    static instance = null;
    constructor() { DelayedRecognition.instance = this; }
    start() { this.onstart?.(); }
    stop() {}
    emitResult(results) { this.onresult?.({ resultIndex: 0, results }); }
  }
  let draft = "";
  const controller = createVoiceInputController({
    getDraft: () => draft,
    setDraft: value => { draft = value; },
    getRecognition: () => DelayedRecognition,
  });

  controller.start();
  const recognition = DelayedRecognition.instance;
  controller.stop();
  recognition.emitResult([result("Concretagem da laje", true)]);
  recognition.onend?.();

  assert.equal(draft, "Concretagem da laje");
  controller.destroy();
});

test("não inicia nova captação antes do resultado final da anterior", () => {
  class DelayedRecognition {
    static instances = [];
    constructor() { DelayedRecognition.instances.push(this); }
    start() { this.onstart?.(); }
    stop() {}
    emit(text) {
      this.onresult?.({ resultIndex: 0, results: [result(text, true)] });
    }
  }
  let draft = "";
  const controller = createVoiceInputController({
    getDraft: () => draft,
    setDraft: value => { draft = value; },
    getRecognition: () => DelayedRecognition,
  });

  controller.start();
  const first = DelayedRecognition.instances[0];
  controller.stop();
  assert.equal(controller.isPending(), true);
  assert.equal(controller.start(), false);
  first.emit("Concretagem da laje");
  first.onend?.();
  assert.equal(draft, "Concretagem da laje");
  assert.equal(controller.isPending(), false);
  assert.equal(controller.start(), true);
  assert.equal(DelayedRecognition.instances.length, 2);
  controller.destroy();
});

test("libera o microfone se o reconhecimento não informa o fim", () => {
  class SilentRecognition {
    static instance = null;
    constructor() { SilentRecognition.instance = this; }
    start() { this.onstart?.(); }
    stop() {}
    emit(text) { this.onresult?.({ resultIndex: 0, results: [result(text, true)] }); }
  }
  let expire;
  let draft = "";
  const controller = createVoiceInputController({
    getRecognition: () => SilentRecognition,
    getDraft: () => draft,
    setDraft: value => { draft = value; },
    scheduleStopFallback: callback => { expire = callback; return 1; },
    clearStopFallback: () => {},
  });

  controller.start();
  controller.stop();
  assert.equal(controller.isPending(), true);
  expire();
  assert.equal(controller.isPending(), false);
  SilentRecognition.instance.emit("fala atrasada");
  assert.equal(draft, "");
  assert.equal(controller.start(), true);
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

test("prefere gravar e transcrever quando a plataforma pede o caminho de áudio", async () => {
  FakeRecognition.instances = [];
  FakeMediaRecorder.instances = [];
  let draft = "";
  let permissionChecks = 0;
  const stream = { getTracks: () => [{ stop() {} }] };
  const controller = createVoiceInputController({
    getDraft: () => draft,
    setDraft: value => { draft = value; },
    getRecognition: () => FakeRecognition,
    getRecorder: () => FakeMediaRecorder,
    getAudioStream: async () => stream,
    preferRecorder: true,
    ensureAudioPermission: async () => { permissionChecks += 1; return true; },
    transcribeAudio: async () => "Concretagem da laje concluída",
  });

  assert.equal(controller.start(), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(FakeRecognition.instances.length, 0, "não deve escolher o reconhecimento nativo de fala");
  assert.equal(FakeMediaRecorder.instances[0].started, 1, "deve capturar áudio para transcrição");
  assert.equal(permissionChecks, 0, "a própria captura deve solicitar o acesso no gesto do usuário");

  await controller.stop();
  assert.equal(draft, "Concretagem da laje concluída");
  controller.destroy();
});

test("cancelar transcrição pendente libera botão e ignora resultado tardio", async () => {
  FakeMediaRecorder.instances = [];
  let finishTranscription;
  let draft = "";
  const controller = createVoiceInputController({
    getDraft: () => draft,
    setDraft: value => { draft = value; },
    getRecognition: () => null,
    getRecorder: () => FakeMediaRecorder,
    getAudioStream: async () => ({ getTracks: () => [{ stop() {} }] }),
    transcribeAudio: () => new Promise(resolve => { finishTranscription = resolve; }),
  });

  controller.start();
  await Promise.resolve();
  await Promise.resolve();
  const stopped = controller.stop();
  await Promise.resolve();
  assert.equal(controller.isPending(), true);
  controller.cancel();
  assert.equal(controller.isPending(), false);
  finishTranscription("Eu fiz a concretagem da laje");
  await stopped;
  assert.equal(draft, "");
  controller.destroy();
});
