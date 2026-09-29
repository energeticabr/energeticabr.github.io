import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shareExtension = readFileSync(
  new URL("../ios/ShareExtension/ShareViewController.swift", import.meta.url),
  "utf8",
);

test("a extensão iOS deixa áudio na caixa compartilhada para o Energético transcrever", () => {
  assert.match(shareExtension, /audioExtensions/);
  assert.match(shareExtension, /let audioItems = stagedItems\.filter/);
  assert.match(shareExtension, /let uploadItems = stagedItems\.filter/);
  assert.match(shareExtension, /updateState\(id: item\.id, state: "needsAuthentication"\)/);
  assert.match(shareExtension, /O áudio foi recebido e será transcrito ao abrir o Energético/);
});
