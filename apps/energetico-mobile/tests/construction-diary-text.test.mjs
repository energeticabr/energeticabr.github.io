import test from "node:test";
import assert from "node:assert/strict";

import * as voiceInput from "../src/ui/voice-input.js";

test("normaliza transcrição para registro técnico de diário de obras", () => {
  assert.equal(typeof voiceInput.normalizeConstructionDiaryText, "function");

  const result = voiceInput.normalizeConstructionDiaryText(
    "Bom dia, eu fiz a concretagem da laje. Nós usamos 10 sacos de cimento, né."
  );

  assert.equal(
    result,
    "Execução de concretagem da laje. Utilização de 10 sacos de cimento."
  );
  assert.doesNotMatch(result, /\b(eu|nós|meu|minha|nosso|nossa)\b/i);
});

test("preserva dados objetivos e não cria texto quando a transcrição está vazia", () => {
  assert.equal(
    voiceInput.normalizeConstructionDiaryText("Aplicação de argamassa no banheiro às 14:30."),
    "Aplicação de argamassa no banheiro às 14:30."
  );
  assert.equal(
    voiceInput.normalizeConstructionDiaryText("Nos materiais recebidos, foram identificadas duas avarias."),
    "Nos materiais recebidos, foram identificadas duas avarias."
  );
  assert.equal(voiceInput.normalizeConstructionDiaryText("  \n  "), "");
});
