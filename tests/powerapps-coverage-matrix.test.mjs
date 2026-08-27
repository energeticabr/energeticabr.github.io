import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as powerAppsMatrix from "../portal/catalog/powerapps-matrix.js";

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
import { ENTITIES } from "../portal/catalog/entities.js";

const ALLOWED_ACTIONS = new Set([
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "submit",
  "execute-flow",
  "navigate",
]);

const MANIFEST_PATH = new URL("./fixtures/powerapps-export-manifest.json", import.meta.url);
const DOC_PATH = new URL("../docs/portal/powerapps-coverage-matrix.md", import.meta.url);
const EXPORT_MANIFEST = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

const MUTATION_ACTIONS = Object.freeze(["create", "edit", "delete", "approve"]);

function existingExportRoot() {
  const candidates = [
    process.env.POWERAPPS_EXPORT_ROOT,
    path.join(
      os.homedir(),
      "OneDrive - energetica",
      "Documents",
      "New project",
      "whatsapp-sharepoint-oci",
      "tmp",
      "powerapps-form-audit-20260815",
      "src",
    ),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function existingSupplementalRoot() {
  const candidates = [
    process.env.POWERAPPS_SUPPLEMENTAL_EXPORT_ROOT,
    path.join(
      os.homedir(),
      "OneDrive - energetica",
      "Documents",
      "New project",
      "powerapps_debug_verify_publish",
    ),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

test("o manifesto independente comprova os artefatos e as evidencias criticas da exportacao", () => {
  const baseFiles = EXPORT_MANIFEST.baseExport.artifacts;
  assert.equal(baseFiles.length, 129);
  assert.equal(new Set(baseFiles.map(entry => entry.name)).size, 129);
  assert.equal(
    sha256(baseFiles.map(entry => `${entry.name}:${entry.sha256}`).join("\n")),
    EXPORT_MANIFEST.baseExport.artifactsSha256,
  );

  for (const finding of Object.values(EXPORT_MANIFEST.criticalEvidence)) {
    for (const evidence of finding.evidence) {
      assert.equal(sha256(evidence.value), evidence.sha256, `${finding.artifact}: ${evidence.kind}`);
    }
  }

  const exportRoot = existingExportRoot();
  if (exportRoot) {
    for (const artifact of baseFiles) {
      const content = fs.readFileSync(path.join(exportRoot, "Src", artifact.name));
      assert.equal(sha256(content), artifact.sha256, artifact.name);
    }
    assert.equal(
      sha256(fs.readFileSync(path.join(exportRoot, "References", "DataSources.json"))),
      EXPORT_MANIFEST.baseExport.dataSourcesSha256,
    );
  }

  const supplementalRoot = existingSupplementalRoot();
  if (supplementalRoot) {
    for (const artifact of EXPORT_MANIFEST.supplementalExport.trackedArtifacts) {
      const content = fs.readFileSync(path.join(supplementalRoot, "Src", artifact.name));
      assert.equal(sha256(content), artifact.sha256, artifact.name);
    }
  }
});

test("a matriz rastreia a exportacao base e a tela suplementar de entrega EPI", () => {
  const expectedArtifacts = [
    ...EXPORT_MANIFEST.baseExport.artifacts.map(entry => entry.name),
    EXPORT_MANIFEST.criticalEvidence.epiDelivery.artifact,
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const actualArtifacts = POWERAPPS_ARTIFACTS.map(entry => entry.artifact)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  assert.deepEqual(actualArtifacts, expectedArtifacts);
  assert.equal(POWERAPPS_ARTIFACTS.length, 130);
  assert.equal(new Set(POWERAPPS_ARTIFACTS.map(entry => entry.artifact)).size, 130);

  const summary = coverageSummary();
  assert.deepEqual(
    { artifacts: summary.artifacts, screens: summary.screens, system: summary.system },
    { artifacts: 130, screens: 128, system: 2 },
  );

  assert.deepEqual(
    POWERAPPS_ARTIFACTS.filter(entry => entry.kind === "system").map(entry => entry.artifact).sort(),
    ["App.pa.yaml", "_EditorState.pa.yaml"],
  );
});

test("E11 comprova edicao de LANCAMENTOTAREFAS por SubmitForm", () => {
  const expected = EXPORT_MANIFEST.criticalEvidence.editTask;
  assert.ok(expected.evidence.some(item => item.value === "DataSource: =LANCAMENTOTAREFAS"));
  assert.ok(expected.evidence.some(item => item.value === "=SubmitForm('FORM.TAREFA_1')"));

  const entry = POWERAPPS_ARTIFACTS.find(item => item.artifact === expected.artifact);
  const operation = entry.operations.find(item => item.source === "LANCAMENTOTAREFAS");
  assert.ok(entry.actions.includes("edit"));
  assert.ok(operation.actions.includes("edit"));
  assert.ok(operation.evidence.includes("SubmitForm:FORM.TAREFA_1"));
});

test("entrega EPI fica rastreada como tela de RH com fontes e fluxo documental", () => {
  const expected = EXPORT_MANIFEST.criticalEvidence.epiDelivery;
  assert.ok(expected.evidence.some(item => item.kind === "document-flow"));
  assert.ok(expected.evidence.some(item => item.kind === "navigation"));

  const entry = POWERAPPS_ARTIFACTS.find(item => item.artifact === expected.artifact);
  assert.equal(entry.moduleId, "rh-obras");
  assert.ok(entry.sources.includes("FORNECEDORES"));
  assert.ok(entry.sources.includes("CADASTROPRODUTO"));
  assert.ok(entry.flows.includes("LANCAMENTOSHTML"));
  assert.ok(entry.actions.includes("execute-flow"));

  const documentation = fs.readFileSync(DOC_PATH, "utf8");
  assert.match(documentation, /powerapps_debug_verify_publish/);
  assert.match(documentation, /COMPROVANTE ENTREGA EPI\.pa\.yaml/);
  assert.match(documentation, /entrega de EPI e documento/i);
  assert.match(documentation, /tests\/fixtures\/powerapps-export-manifest\.json/);
  assert.ok(documentation.includes(EXPORT_MANIFEST.baseExport.artifactsSha256));
});

test("cada linha tem evidencia, fontes exatas, acoes seguras e estado de cobertura explicito", () => {
  for (const entry of POWERAPPS_ARTIFACTS) {
    assert.ok(Object.isFrozen(entry), `${entry.artifact} precisa ser imutavel`);
    assert.match(entry.artifact, /\.pa\.yaml$/);
    assert.ok([
      "base:powerapps-form-audit-20260815",
      "supplemental:powerapps_debug_verify_publish",
    ].includes(entry.origin));
    assert.ok(["screen", "system"].includes(entry.kind));
    assert.ok(["mapped", "partial", "gap", "not-applicable"].includes(entry.coverage));
    assert.ok(Array.isArray(entry.sources));
    assert.ok(Array.isArray(entry.entityIds));
    assert.ok(Array.isArray(entry.actions));
    assert.ok(Array.isArray(entry.capabilities));
    assert.ok(Array.isArray(entry.flows));
    assert.ok(Array.isArray(entry.operations));
    assert.ok(Object.isFrozen(entry.sources));
    assert.ok(Object.isFrozen(entry.entityIds));
    assert.ok(Object.isFrozen(entry.actions));
    assert.ok(Object.isFrozen(entry.capabilities));
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

test("cada uma das 82 fontes SharePoint possui entidade propria e operacoes rastreaveis", () => {
  assert.equal(POWERAPPS_SHAREPOINT_SOURCES.length, 82);
  assert.deepEqual(unmappedSharePointSources(), []);

  const additionalSources = new Set(
    POWERAPPS_SHAREPOINT_SOURCES.filter(source => !POWERAPPS_INVENTORY_SOURCES.includes(source)),
  );
  assert.equal(additionalSources.size, 31);
  const owners = new Map();
  for (const source of POWERAPPS_SHAREPOINT_SOURCES) {
    const matches = ENTITIES.filter(entity => entity.listNames.includes(source));
    assert.equal(matches.length, 1, `${source} precisa de uma entidade exata e exclusiva`);
    if (additionalSources.has(source)) {
      assert.equal(matches[0].listNames.length, 1, `${source} nao pode ser alias de outra lista`);
    }
    assert.equal(sourceCoverage(source).entityId, matches[0].id);
    owners.set(source, matches[0].id);
  }
  assert.equal(
    new Set([...additionalSources].map(source => owners.get(source))).size,
    additionalSources.size,
  );

  for (const entry of POWERAPPS_ARTIFACTS) {
    for (const operation of entry.operations) {
      assert.ok(operation.entityId, `${entry.artifact}: ${operation.source} sem entidade`);
      assert.equal(operation.entityId, owners.get(operation.source));
      assert.ok(entry.entityIds.includes(operation.entityId));
    }
  }
});

test("a matriz expoe evidencia de mutacao imutavel e fechada para as 82 fontes", () => {
  assert.equal(typeof powerAppsMatrix.mutationEvidenceForSource, "function");

  const expectedExamples = new Map([
    ["FORNECEDORES", { create: true, edit: true, delete: true, approve: false }],
    ["TICKETS CLIENTES", { create: false, edit: true, delete: true, approve: false }],
    ["TICKET MOVIMENTACOES", { create: false, edit: true, delete: true, approve: false }],
    ["PROVISÃO PGTOS", { create: true, edit: true, delete: true, approve: false }],
  ]);

  for (const source of POWERAPPS_SHAREPOINT_SOURCES) {
    const evidence = powerAppsMatrix.mutationEvidenceForSource(source);
    assert.ok(Object.isFrozen(evidence), `${source} precisa de evidencia imutavel`);
    assert.deepEqual(Object.keys(evidence), MUTATION_ACTIONS);
    for (const action of MUTATION_ACTIONS) {
      assert.equal(typeof evidence[action], "boolean", `${source}.${action} precisa ser booleano`);
    }
  }

  for (const [source, expected] of expectedExamples) {
    assert.deepEqual(powerAppsMatrix.mutationEvidenceForSource(source), expected, source);
  }

  assert.deepEqual(
    powerAppsMatrix.mutationEvidenceForSource("FONTE SEM EVIDENCIA"),
    { create: false, edit: false, delete: false, approve: false },
  );
});

test("as 31 entidades adicionais expoem somente capacidades comprovadas", () => {
  const additionalSources = POWERAPPS_SHAREPOINT_SOURCES
    .filter(source => !POWERAPPS_INVENTORY_SOURCES.includes(source));
  const supportedCapabilities = ["view", "create", "edit", "delete"];

  for (const source of additionalSources) {
    const owner = ENTITIES.find(entity => entity.listNames.includes(source));
    const observed = new Set(POWERAPPS_ARTIFACTS
      .flatMap(entry => entry.operations)
      .filter(operation => operation.source === source)
      .flatMap(operation => operation.actions));

    for (const capability of supportedCapabilities) {
      assert.equal(
        owner.capabilities[capability],
        observed.has(capability),
        `${source}.${capability} precisa refletir apenas evidencia literal`,
      );
    }
    assert.equal(owner.capabilities.approve, false, `${source}.approve nao foi comprovado`);
    assert.equal(owner.available, observed.has("view"), `${source}.available precisa acompanhar view`);
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

test("consultas do catalogo retornam recortes imutaveis e mantem ambiguidades visiveis", () => {
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
  assert.deepEqual(gaps, []);

  const ambiguousDocuments = POWERAPPS_ARTIFACTS.find(
    entry => entry.artifact === "F29- CADASTRO DOCUMENTOS_2.pa.yaml",
  );
  assert.equal(ambiguousDocuments.moduleId, null);
  assert.ok(["partial", "gap"].includes(ambiguousDocuments.coverage));
  assert.match(ambiguousDocuments.gapReason, /módulo funcional/i);
});
