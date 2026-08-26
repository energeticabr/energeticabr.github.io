import assert from "node:assert/strict";
import test from "node:test";

import {
  POWERAPPS_ARTIFACTS,
  POWERAPPS_CONNECTED_FLOWS,
  POWERAPPS_INVENTORY_SOURCES,
  POWERAPPS_SHAREPOINT_SOURCES,
  artifactsForEntity,
  artifactsForFlow,
  artifactsForModule,
  coverageSummary,
  sourceCoverage,
  unmappedSharePointSources,
} from "../portal/catalog/powerapps-matrix.js";

const ALLOWED_ACTIONS = new Set([
  "view",
  "create",
  "edit",
  "delete",
  "submit",
  "execute-flow",
  "navigate",
]);

test("a matriz preserva os 129 artefatos da exportacao e distingue telas de arquivos sistemicos", () => {
  assert.equal(POWERAPPS_ARTIFACTS.length, 129);
  assert.equal(new Set(POWERAPPS_ARTIFACTS.map(entry => entry.artifact)).size, 129);

  const summary = coverageSummary();
  assert.deepEqual(
    { artifacts: summary.artifacts, screens: summary.screens, system: summary.system },
    { artifacts: 129, screens: 127, system: 2 },
  );

  assert.deepEqual(
    POWERAPPS_ARTIFACTS.filter(entry => entry.kind === "system").map(entry => entry.artifact).sort(),
    ["App.pa.yaml", "_EditorState.pa.yaml"],
  );
});

test("cada linha tem evidencia, fontes exatas, acoes seguras e estado de cobertura explicito", () => {
  for (const entry of POWERAPPS_ARTIFACTS) {
    assert.ok(Object.isFrozen(entry), `${entry.artifact} precisa ser imutavel`);
    assert.match(entry.artifact, /\.pa\.yaml$/);
    assert.ok(["screen", "system"].includes(entry.kind));
    assert.ok(["mapped", "partial", "gap", "not-applicable"].includes(entry.coverage));
    assert.ok(Array.isArray(entry.sources));
    assert.ok(Array.isArray(entry.entityIds));
    assert.ok(Array.isArray(entry.actions));
    assert.ok(Array.isArray(entry.flows));
    assert.ok(Array.isArray(entry.operations));
    assert.ok(Object.isFrozen(entry.sources));
    assert.ok(Object.isFrozen(entry.entityIds));
    assert.ok(Object.isFrozen(entry.actions));
    assert.ok(Object.isFrozen(entry.flows));
    assert.ok(Object.isFrozen(entry.operations));
    assert.equal(new Set(entry.sources).size, entry.sources.length);
    assert.equal(new Set(entry.actions).size, entry.actions.length);
    for (const action of entry.actions) assert.ok(ALLOWED_ACTIONS.has(action), `${entry.artifact}: ${action}`);
    for (const operation of entry.operations) {
      assert.ok(Object.isFrozen(operation));
      assert.ok(entry.sources.includes(operation.source));
      assert.ok(Array.isArray(operation.actions));
      assert.ok(Object.isFrozen(operation.actions));
      assert.ok(operation.actions.includes("view"));
      for (const action of operation.actions) assert.ok(ALLOWED_ACTIONS.has(action));
      assert.ok(Array.isArray(operation.evidence));
      assert.ok(Object.isFrozen(operation.evidence));
      assert.ok(operation.evidence.length > 0);
    }
    if (entry.coverage === "gap" || entry.coverage === "partial") {
      assert.ok(entry.gapReason, `${entry.artifact} precisa explicar a lacuna`);
    }
  }
});

test("as 53 fontes do inventario possuem um unico resultado de cobertura sem fundir listas distintas", () => {
  assert.equal(POWERAPPS_INVENTORY_SOURCES.length, 53);
  assert.equal(new Set(POWERAPPS_INVENTORY_SOURCES).size, 53);
  assert.equal(new Set(POWERAPPS_SHAREPOINT_SOURCES).size, POWERAPPS_SHAREPOINT_SOURCES.length);

  for (const source of POWERAPPS_INVENTORY_SOURCES) {
    const result = sourceCoverage(source);
    assert.equal(result.source, source);
    assert.ok(["mapped", "gap"].includes(result.coverage));
    if (result.coverage === "mapped") assert.ok(result.entityId);
    if (result.coverage === "gap") assert.ok(result.reason);
  }
});

test("as 34 conexoes de fluxo permanecem inventariadas mesmo sem chamada em tela", () => {
  assert.equal(POWERAPPS_CONNECTED_FLOWS.length, 34);
  assert.equal(new Set(POWERAPPS_CONNECTED_FLOWS).size, 34);
  for (const flow of ["CHECKLIST", "CONTRATOS", "EMISSÃODIÁRIODEOBRAS"]) {
    assert.ok(POWERAPPS_CONNECTED_FLOWS.includes(flow));
  }
  for (const entry of POWERAPPS_ARTIFACTS) {
    for (const flow of entry.flows) assert.ok(POWERAPPS_CONNECTED_FLOWS.includes(flow));
  }

  const contractScreens = artifactsForFlow("CONTRATOS");
  assert.ok(Object.isFrozen(contractScreens));
  assert.ok(contractScreens.some(entry => entry.artifact === "F32- CADASTRO CONTRATO EMPREITEIRO.pa.yaml"));
  assert.deepEqual(artifactsForFlow("FLUXO INEXISTENTE"), []);
});

test("fluxos representativos permanecem ligados as fontes e operacoes comprovadas na exportacao", () => {
  const byArtifact = new Map(POWERAPPS_ARTIFACTS.map(entry => [entry.artifact, entry]));

  const commercialCreate = byArtifact.get("F44- APONTAMENTOS COMERCIAIS.pa.yaml");
  assert.ok(commercialCreate.sources.includes("APONTAMENTOSCOMERCIAIS"));
  assert.ok(commercialCreate.actions.includes("create"));

  const commercialHistory = byArtifact.get("G25- HISTÓRICO APONTAMENTO COMERCIAL.pa.yaml");
  assert.ok(commercialHistory.sources.includes("APONTAMENTOSCOMERCIAIS"));
  assert.ok(commercialHistory.actions.includes("delete"));

  const contractCreate = byArtifact.get("F32- CADASTRO CONTRATO EMPREITEIRO.pa.yaml");
  assert.ok(contractCreate.sources.includes("EMPREITEIRO"));
  assert.ok(contractCreate.actions.includes("submit"));

  const measurementLines = byArtifact.get("G49 - HISTÓRICO LINHAS MEDIÇÃO.pa.yaml");
  assert.ok(measurementLines.sources.includes("LINHASMEDICAO"));
  assert.ok(measurementLines.actions.includes("delete"));

  const anonymousScreen = byArtifact.get("Screen13.pa.yaml");
  assert.ok(anonymousScreen);
  assert.ok(["partial", "gap", "mapped"].includes(anonymousScreen.coverage));
});

test("consultas do catalogo retornam recortes imutaveis e mantem lacunas visiveis", () => {
  const commercial = artifactsForModule("comercial");
  assert.ok(Object.isFrozen(commercial));
  assert.ok(commercial.length > 0);
  assert.ok(commercial.every(entry => entry.moduleId === "comercial"));

  const clients = artifactsForEntity("clientes");
  assert.ok(Object.isFrozen(clients));
  assert.ok(clients.some(entry => entry.artifact === "F27- CADASTRO CLIENTE.pa.yaml"));
  assert.ok(clients.every(entry => entry.entityIds.includes("clientes")));

  const gaps = unmappedSharePointSources();
  assert.ok(Object.isFrozen(gaps));
  for (const source of [
    "APONTAMENTOSCOMERCIAIS",
    "LINHACONTRATO",
    "LINHASMEDICAO",
    "SACPATOLOGIAS",
  ]) {
    assert.ok(gaps.includes(source), `${source} precisa permanecer visivel como lacuna`);
  }

  const ambiguousDocuments = POWERAPPS_ARTIFACTS.find(
    entry => entry.artifact === "F29- CADASTRO DOCUMENTOS_2.pa.yaml",
  );
  assert.equal(ambiguousDocuments.moduleId, null);
  assert.ok(["partial", "gap"].includes(ambiguousDocuments.coverage));
  assert.match(ambiguousDocuments.gapReason, /módulo funcional/i);
});
