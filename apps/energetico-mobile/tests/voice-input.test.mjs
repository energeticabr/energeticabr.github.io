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
