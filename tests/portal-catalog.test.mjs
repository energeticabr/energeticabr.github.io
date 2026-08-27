import assert from "node:assert/strict";
import test from "node:test";
import { MODULES } from "../portal/catalog/modules.js";
import { ENTITIES, entitiesForModule, OPERATIONAL_CAPABILITY_OVERRIDES } from "../portal/catalog/entities.js";
import { mutationEvidenceForSource } from "../portal/catalog/powerapps-matrix.js";
import { POWERAPPS_ARTIFACTS, POWERAPPS_SHAREPOINT_SOURCES } from "../portal/catalog/powerapps-matrix.js";

const REQUIRED_MODULE_IDS = [
  "dashboard",
  "suprimentos",
  "demandas",
  "comercial",
  "financeiro",
  "rh-obras",
  "patrimonio-locacoes",
  "auditoria-compliance",
  "relatorios",
  "usuarios-acessos",
];

const INVENTORY_SOURCES = [
  "LANCAMENTOS",
  "CADASTROTIPOMATERIAL",
  "CADASTROURGÊNCIA",
  "CADASTROUNIDADEMEDIDA",
  "FUNCAOIMOBILIZADO",
  "CONCLUIDOLANCAMENTOS",
  "DEMONSTRATIVOETAPA",
  "DESPESASRECORRENTES",
  "DESCRICAOMEDICOES",
  "DIÁRIO DE OBRAS",
  "DESCRITIVOPRESENCA",
  "EMPREITEIRO",
  "FILIAIS",
  "FORNECEDORES",
  "GRUPO IMOBILIZADOS",
  "IMOBILIZADOS",
  "LANCAMENTOOBRA",
  "LANCAMENTOS AUDITORIA",
  "MENSAGEM PROGRAMADA",
  "PROFISSÃO",
  "PROVISÃO PGTOS",
  "SUBFAMÍLIA",
  "TAREFASDELEGADAS",
  "TIPO DE TRANSACAO",
  "TIPOINCONSISTENCIA",
  "TIPOS AUDITORIA",
  "CADASTROIMOBILIZADO",
  "CADASTROGRUPO",
  "CADASTRODIFICULDADE",
  "CADASTROCONTA",
  "CADASTROCIDADE",
  "CADASTRO TIPO DOCUMENTO",
  "CADASTRO IMPACTO",
  "CADASTRO FAMÍLIA_1",
  "CADASTRO CLIENTE_1",
  "ATIVIDADE EXECUTADA",
  "ATIVIDADE",
  "APONTAMENTOSFUNCIONARIOS",
  "ARQUIVOLANCAMENTOS",
  "APONTAMENTO DE PRESENÇA",
  "CADASTROTAREFAS",
  "CADASTROSUBFAMÍLIA",
  "CADASTROPRODUTO",
  "GRUPO",
  "LANCAMENTOCOMPRAS",
  "CORRETOR",
  "IMOVEL CADASTRADO",
  "LANCAMENTOTAREFAS",
  "LANÇAMENTORECEITA",
  "TICKETS CLIENTES",
  "TICKET MOVIMENTACOES",
  "COMUNICACOES CLIENTES",
  "COMUNICACAO MOVIMENTACOES",
];

const REMOVED_CUSTOMER_SERVICE_SOURCES = new Set([
  "TICKETS CLIENTES",
  "TICKET MOVIMENTACOES",
  "COMUNICACOES CLIENTES",
  "COMUNICACAO MOVIMENTACOES",
]);

const ENTITY_KEYS = [
  "id",
  "moduleId",
  "title",
  "siteKey",
  "listNames",
  "capabilities",
  "searchFields",
  "statusFields",
  "uppercaseFields",
  "messageFields",
  "available",
];

test("o catalogo define os modulos administrativos uma unica vez", () => {
  assert.ok(Object.isFrozen(MODULES));
  assert.deepEqual(MODULES.map(module => module.id), REQUIRED_MODULE_IDS);
  assert.equal(new Set(MODULES.map(module => module.id)).size, MODULES.length);
});

test("as entidades tem identificadores, modulos e metadados completos", () => {
  const moduleIds = new Set(MODULES.map(module => module.id));
  assert.ok(Object.isFrozen(ENTITIES));
  assert.equal(new Set(ENTITIES.map(entity => entity.id)).size, ENTITIES.length);

  for (const entity of ENTITIES) {
    assert.ok(Object.isFrozen(entity));
    assert.match(entity.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(moduleIds.has(entity.moduleId));
    for (const key of ENTITY_KEYS) assert.ok(key in entity, `${entity.id} nao possui ${key}`);
    assert.equal(typeof entity.title, "string");
    assert.ok(entity.title.length > 0);
    assert.ok(["personal", "company"].includes(entity.siteKey));
    for (const key of ["listNames", "searchFields", "statusFields", "uppercaseFields", "messageFields"]) {
      assert.ok(Array.isArray(entity[key]), `${entity.id}.${key} deve ser uma lista`);
      assert.ok(Object.isFrozen(entity[key]), `${entity.id}.${key} deve ser imutavel`);
    }
    assert.ok(entity.listNames.length > 0, `${entity.id} precisa de aliases de lista`);
    assert.ok(Object.isFrozen(entity.capabilities));
    assert.equal(typeof entity.available, "boolean", `${entity.id}.available deve ser booleano`);
    for (const action of ["view", "create", "edit", "delete", "approve"]) {
      assert.equal(typeof entity.capabilities[action], "boolean", `${entity.id}.${action} deve ser booleano`);
    }
    assert.equal(entity.capabilities.view, entity.available, `${entity.id}.view deve acompanhar available`);
  }
});

test("o catalogo preserva o inventario e nao expoe as quatro fontes removidas", () => {
  for (const source of INVENTORY_SOURCES) {
    const owners = ENTITIES.filter(entity => entity.listNames.includes(source));
    if (REMOVED_CUSTOMER_SERVICE_SOURCES.has(source)) {
      assert.equal(owners.length, 0, `fonte removida nao pode ter tela administrativa: ${source}`);
      continue;
    }
    assert.equal(owners.length, 1, `fonte do inventario precisa de um unico dono: ${source}`);
  }
});

test("entitiesForModule retorna somente entidades do modulo solicitado", () => {
  const demands = entitiesForModule("demandas");
  assert.ok(Object.isFrozen(demands));
  assert.ok(demands.length > 0);
  assert.ok(demands.every(entity => entity.moduleId === "demandas"));
  assert.ok(demands.every(entity => entity.available));
  assert.deepEqual(entitiesForModule("modulo-ausente"), []);
});

test("as quatro fontes conectadas sem tela propria aparecem como galerias somente para consulta", () => {
  const expected = new Map([
    ["registros-mensais", "rh-obras"],
    ["associacoes-de-aluguel", "patrimonio-locacoes"],
    ["produtos-de-aluguel", "patrimonio-locacoes"],
    ["tarefas-de-aluguel", "patrimonio-locacoes"],
  ]);

  for (const [entityId, moduleId] of expected) {
    const entity = ENTITIES.find(candidate => candidate.id === entityId);
    assert.ok(entity, entityId);
    assert.equal(entity.available, true, `${entityId} precisa aparecer no portal`);
    assert.deepEqual(entity.capabilities, {
      view: true,
      create: false,
      edit: false,
      delete: false,
      approve: false,
    });
    assert.equal(
      entitiesForModule(moduleId).some(candidate => candidate.id === entityId),
      true,
      `${entityId} precisa aparecer no modulo ${moduleId}`,
    );
  }
});

test("as 79 fontes remanescentes da matriz refletem as mutacoes sem elevacao indevida", () => {
  const mutationActions = ["create", "edit", "delete", "approve"];
  const observedBySource = new Map(POWERAPPS_SHAREPOINT_SOURCES.map(source => [source, new Set()]));

  for (const operation of POWERAPPS_ARTIFACTS.flatMap(entry => entry.operations)) {
    const observed = observedBySource.get(operation.source);
    if (!observed) continue;
    for (const action of operation.actions) {
      if (mutationActions.includes(action)) observed.add(action);
    }
  }

  const provenMutations = [...observedBySource.entries()]
    .flatMap(([source, actions]) => [...actions].map(action => `${source}.${action}`));
  assert.equal(provenMutations.length, 181, "a evidencia auditada de mutacoes mudou");

  const sourceOwners = new Set();
  const divergences = [];
  for (const source of POWERAPPS_SHAREPOINT_SOURCES) {
    const owners = ENTITIES.filter(entity => entity.listNames.includes(source));
    if (REMOVED_CUSTOMER_SERVICE_SOURCES.has(source)) {
      assert.equal(owners.length, 0, `${source} nao pode possuir tela administrativa`);
      continue;
    }
    assert.equal(owners.length, 1, `${source} precisa de uma entidade proprietaria`);
    const owner = owners[0];
    sourceOwners.add(owner.id);
    const observed = observedBySource.get(source);
    for (const action of mutationActions) {
      const expected = observed.has(action) || OPERATIONAL_CAPABILITY_OVERRIDES[owner.id]?.[action] === true;
      const actual = owner.capabilities[action] === true;
      if (actual !== expected) divergences.push(`${source}.${action}: esperado=${expected} atual=${actual}`);
    }
  }

  assert.equal(sourceOwners.size, 79, "cada fonte remanescente precisa de uma entidade exclusiva");
  assert.deepEqual(divergences, [], `${divergences.length} mutacoes divergem da evidencia literal`);

  for (const entity of ENTITIES.filter(candidate => !candidate.listNames.some(source => observedBySource.has(source)))) {
    for (const action of mutationActions) {
      assert.equal(entity.capabilities[action], false, `${entity.id}.${action} nao possui evidencia na matriz`);
    }
  }
});

test("fornecedores e programacao de pagamentos seguem a evidencia literal", () => {
  const expected = new Map([
    ["fornecedores", { create: true, edit: true, delete: true, approve: false }],
    ["provisoes-de-pagamento", { create: true, edit: true, delete: true, approve: false }],
  ]);

  for (const [entityId, capabilities] of expected) {
    const entity = ENTITIES.find(candidate => candidate.id === entityId);
    assert.ok(entity, entityId);
    assert.deepEqual(
      Object.fromEntries(Object.keys(capabilities).map(action => [action, entity.capabilities[action]])),
      capabilities,
      entityId,
    );
  }
});

test("cada nome de lista preserva sua própria evidência antes da resolução física", () => {
  for (const entity of ENTITIES) {
    assert.ok(Object.isFrozen(entity.listCapabilityEvidence), entity.id);
    assert.deepEqual(
      entity.listCapabilityEvidence.map(evidence => evidence.listName),
      entity.listNames,
      entity.id,
    );
    for (const evidence of entity.listCapabilityEvidence) {
      assert.ok(Object.isFrozen(evidence));
      assert.ok(Object.isFrozen(evidence.capabilities));
      const expected = mutationEvidenceForSource(evidence.listName);
      for (const action of ["create", "edit", "delete", "approve"]) {
        assert.equal(evidence.capabilities[action], expected[action], `${entity.id}:${evidence.listName}.${action}`);
      }
    }
  }
});
