import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  formatDateTime,
  normalizeCadastroValue,
  normalizeEmail,
} from "../portal/core/utils.js";

test("normaliza e-mail e cadastros sem alterar mensagens", () => {
  assert.equal(normalizeEmail("  Bernardo@Notini.COM "), "bernardo@notini.com");
  assert.equal(normalizeCadastroValue("  Ouro Preto "), "OURO PRETO");
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
});

test("formata data e hora brasileiras e informa valores ausentes", () => {
  const formatted = formatDateTime("2026-08-26T14:30:00Z", "pt-BR");
  assert.match(formatted, /26\/08\/2026/);
  assert.match(formatted, /\d{2}:\d{2}/);
  assert.equal(formatDateTime("", "pt-BR"), "Nao informado");
  assert.equal(formatDateTime("data invalida", "pt-BR"), "Nao informado");
});
