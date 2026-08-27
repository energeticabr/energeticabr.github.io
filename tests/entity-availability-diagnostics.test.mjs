import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { entityAvailabilityDiagnostic } from "../portal/ui/entity-page.js";

test("o diagnostico diferencia sessao Microsoft, permissao, lista ausente e conexao", () => {
  assert.deepEqual(entityAvailabilityDiagnostic({ availability: "forbidden", error: { status: 401, code: "interaction_required" } }), {
    code: "interaction_required",
    message: "Sua sessão Microsoft precisa ser renovada. Saia e entre novamente para consultar esta lista.",
  });
  assert.match(entityAvailabilityDiagnostic({ availability: "forbidden", error: { status: 403, code: "accessDenied" } }).message, /não tem permissão Microsoft/i);
  assert.match(entityAvailabilityDiagnostic({ availability: "missing" }).message, /não foi localizada/i);
  assert.match(entityAvailabilityDiagnostic({ availability: "error", error: { name: "TypeError", message: "Failed to fetch" } }).message, /conexão/i);
});

test("a nova tentativa limpa metadados em cache antes de consultar novamente", async () => {
  const source = await readFile(new URL("../portal/ui/entity-page.js", import.meta.url), "utf8");

  assert.match(source, /data-entity-retry[\s\S]*?repository\.clearCache\?\.\(\)/);
  assert.match(source, /data-entity-retry[\s\S]*?pageCache\.clear\(\)/);
});
