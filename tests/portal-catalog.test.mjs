import assert from "node:assert/strict";
import test from "node:test";
import { MODULES } from "../portal/catalog/modules.js";
import { ENTITIES, entitiesForModule } from "../portal/catalog/entities.js";

const REQUIRED_MODULE_IDS = [
  "dashboard",
  "suprimentos",
  "demandas",
  "comercial",
  "financeiro",
  "rh-obras",
  "patrimonio-locacoes",
  "auditoria-compliance",
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
    for (const action of ["view", "create", "edit", "delete", "approve"]) {
      assert.equal(typeof entity.capabilities[action], "boolean", `${entity.id}.${action} deve ser booleano`);
    }
    assert.equal(entity.capabilities.view, true, `${entity.id} deve poder ser visualizada`);
  }
});

test("o catalogo cobre cada fonte do inventario e preserva o site corporativo para tickets e comunicacoes", () => {
  const sourceOwners = new Map();

  for (const source of INVENTORY_SOURCES) {
    const owners = ENTITIES.filter(entity => entity.listNames.includes(source));
    assert.equal(owners.length, 1, `fonte do inventario precisa de um unico dono: ${source}`);
    sourceOwners.set(source, owners[0]);
  }

  for (const source of ["TICKETS CLIENTES", "TICKET MOVIMENTACOES", "COMUNICACOES CLIENTES", "COMUNICACAO MOVIMENTACOES"]) {
    assert.equal(sourceOwners.get(source).siteKey, "company");
  }
});

test("entitiesForModule retorna somente entidades do modulo solicitado", () => {
  const demands = entitiesForModule("demandas");
  assert.ok(Object.isFrozen(demands));
  assert.ok(demands.length > 0);
  assert.ok(demands.every(entity => entity.moduleId === "demandas"));
  assert.deepEqual(entitiesForModule("modulo-ausente"), []);
});
