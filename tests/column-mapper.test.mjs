import assert from "node:assert/strict";
import test from "node:test";
import { ENTITIES } from "../portal/catalog/entities.js";
import {
  mapSharePointColumns,
  normalizeFormValues,
  sortAndFilterItems,
  validateFormValues,
} from "../portal/data/column-mapper.js";

const entity = Object.freeze({
  id: "clientes",
  uppercaseFields: Object.freeze(["Title", "NOME"]),
  messageFields: Object.freeze(["MENSAGEM"]),
  searchFields: Object.freeze(["Title", "NOME", "STATUS"]),
  statusFields: Object.freeze(["STATUS"]),
});

const columns = Object.freeze([
  { name: "ID", displayName: "ID", readOnly: true, number: {} },
  { name: "Created", displayName: "Criado", readOnly: true, dateTime: {} },
  { name: "LinkTitleNoMenu", displayName: "Item", readOnly: true, text: {} },
  { name: "ItemChildCount", displayName: "Itens filhos", readOnly: true, number: {} },
  { name: "FolderChildCount", displayName: "Pastas filhas", readOnly: true, number: {} },
  { name: "AppAuthor", displayName: "Criado pelo aplicativo", readOnly: true, personOrGroup: {} },
  { name: "AppEditor", displayName: "Editado pelo aplicativo", readOnly: true, personOrGroup: {} },
  { name: "_ModerationStatus", displayName: "Moderação", readOnly: true, number: {} },
  { name: "_CODIGO", displayName: "Código do negócio", text: {} },
  { name: "Title", displayName: "Nome", required: true, text: {} },
  { name: "OBSERVACAO", displayName: "Observação", text: { allowMultipleLines: true } },
  { name: "VALOR", displayName: "Valor", number: { decimalPlaces: "two", displayAs: "currency" } },
  { name: "ATIVO", displayName: "Ativo", boolean: {} },
  { name: "DATA", displayName: "Data", dateTime: { format: "dateOnly" } },
  { name: "MOMENTO", displayName: "Momento", dateTime: { format: "dateTime" } },
  { name: "STATUS", displayName: "Status", choice: { choices: ["PENDENTE", "FINALIZADO"] } },
  { name: "CLIENTE", displayName: "Cliente", lookup: {} },
  { name: "RESPONSAVEL", displayName: "Responsável", personOrGroup: {} },
  { name: "MENSAGEM", displayName: "Mensagem", text: { allowMultipleLines: true } },
  { name: "INTERNO", displayName: "Interno", hidden: true, text: {} },
  { name: "FORMULA", displayName: "Fórmula", readOnly: true, calculated: {} },
]);

function entityById(id) {
  return ENTITIES.find(candidate => candidate.id === id);
}

test("mapeia os tipos reais de coluna SharePoint e ignora os campos de sistema", () => {
  const mapped = mapSharePointColumns(columns, entity);

  assert.equal(mapped.some(column => column.name === "ID"), false);
  assert.equal(mapped.some(column => column.name === "Created"), false);
  assert.equal(mapped.some(column => column.name === "LinkTitleNoMenu"), false);
  assert.equal(mapped.some(column => column.name === "ItemChildCount"), false);
  assert.equal(mapped.some(column => column.name === "FolderChildCount"), false);
  assert.equal(mapped.some(column => column.name === "AppAuthor"), false);
  assert.equal(mapped.some(column => column.name === "AppEditor"), false);
  assert.equal(mapped.some(column => column.name === "_ModerationStatus"), false);
  assert.equal(mapped.some(column => column.name === "_CODIGO"), true, "campos de negocio com sublinhado nao podem sumir por heuristica ampla");
  assert.deepEqual(
    Object.fromEntries(mapped.map(column => [column.name, column.control])),
    {
      Title: "text",
      OBSERVACAO: "textarea",
      VALOR: "currency",
      ATIVO: "checkbox",
      DATA: "date",
      MOMENTO: "datetime-local",
      STATUS: "select",
      CLIENTE: "lookup",
      RESPONSAVEL: "person",
      MENSAGEM: "textarea",
      INTERNO: "text",
      FORMULA: "readonly",
      _CODIGO: "text",
    },
  );
  assert.equal(mapped.find(column => column.name === "Title").required, true);
  assert.equal(mapped.find(column => column.name === "INTERNO").hidden, true);
  assert.equal(mapped.find(column => column.name === "FORMULA").editable, false);
  assert.deepEqual(mapped.find(column => column.name === "STATUS").choices, ["PENDENTE", "FINALIZADO"]);
});

test("na edicao envia limpeza explicita e na criacao continua omitindo campos opcionais vazios", () => {
  const mapped = mapSharePointColumns(columns, entity);
  assert.deepEqual(
    normalizeFormValues({ OBSERVACAO: "", VALOR: "", DATA: "", CLIENTE: "", RESPONSAVEL: "" }, mapped, entity, { mode: "edit" }),
    { OBSERVACAO: null, VALOR: null, DATA: null, CLIENTELookupId: null, RESPONSAVELLookupId: null },
  );
  assert.deepEqual(
    normalizeFormValues({ OBSERVACAO: "", CLIENTE: "" }, mapped, entity, { mode: "create" }),
    {},
  );
});

test("relacionamentos usam valores Graph expandidos para exibir, pesquisar e ordenar", () => {
  const relationalEntity = { ...entity, searchFields: ["CLIENTE", "RESPONSAVEL"], statusFields: [] };
  const items = [
    { id: "1", fields: { CLIENTELookupId: 9, CLIENTELookupValue: "Residencial Bandeirante", RESPONSAVEL: { displayName: "Ana Silva", email: "ana@energeticabr.com" } } },
    { id: "2", fields: { CLIENTELookupId: 2, CLIENTELookupValue: "Alvorada", RESPONSAVELLookupId: 18, RESPONSAVELDisplayName: "Bruno Costa" } },
  ];
  const byPerson = sortAndFilterItems(items, relationalEntity, { search: "ana", sort: { field: "RESPONSAVEL", direction: "asc" } });
  const byLookup = sortAndFilterItems(items, relationalEntity, { search: "bandeirante", sort: { field: "CLIENTE", direction: "asc" } });
  assert.equal(byPerson.total, 1);
  assert.equal(byPerson.items[0].id, "1");
  assert.equal(byLookup.total, 1);
  assert.equal(byLookup.items[0].id, "1");
});

test("validacao impede identificadores relacionais invalidos antes do request", () => {
  const mapped = mapSharePointColumns(columns, entity);
  for (const value of ["1.5", "0", "-2", "ANA"]) {
    const result = validateFormValues({ Title: "ANA", CLIENTE: value, RESPONSAVEL: "17" }, mapped, entity, { mode: "create" });
    assert.ok(result.errors.CLIENTE, `deve recusar ${value}`);
  }
  const valid = validateFormValues({ Title: "ANA", CLIENTE: "42", RESPONSAVEL: "17" }, mapped, entity, { mode: "create" });
  assert.deepEqual(valid.errors, {});
  assert.deepEqual(valid.fields, { Title: "ANA", CLIENTELookupId: 42, RESPONSAVELLookupId: 17 });
});

test("normaliza cadastros para maiusculas mas preserva mensagens livres e converte valores estruturados", () => {
  const mapped = mapSharePointColumns(columns, entity);
  const payload = normalizeFormValues({
    Title: "Ana Maria",
    OBSERVACAO: "manter como digitado",
    VALOR: "1.234,50",
    ATIVO: true,
    DATA: "2026-08-26",
    MOMENTO: "2026-08-26T13:45",
    STATUS: "PENDENTE",
    CLIENTE: "42",
    RESPONSAVEL: "17",
    INTERNO: "oculto",
    FORMULA: "ignorar",
    MENSAGEM: "Olá, tudo Bem?",
  }, mapped, entity);

  assert.deepEqual(payload, {
    Title: "ANA MARIA",
    OBSERVACAO: "MANTER COMO DIGITADO",
    VALOR: 1234.5,
    ATIVO: true,
    DATA: "2026-08-26",
    MOMENTO: "2026-08-26T13:45:00",
    STATUS: "PENDENTE",
    CLIENTELookupId: 42,
    RESPONSAVELLookupId: 17,
    MENSAGEM: "Olá, tudo Bem?",
  });
});

test("lancamentos deriva uppercase para texto simples e multiline sem depender de uppercaseFields", () => {
  const lancamentos = entityById("lancamentos");
  const mapped = mapSharePointColumns([
    { name: "FORNECEDOR", displayName: "Fornecedor", text: {} },
    { name: "OBSERVA_x00c7__x00d5_ESENTREGA", displayName: "Observações entrega", text: { allowMultipleLines: true } },
  ], lancamentos);

  assert.deepEqual(normalizeFormValues({
    FORNECEDOR: "Construtora São José",
    OBSERVA_x00c7__x00d5_ESENTREGA: "Entregar após as 14h",
  }, mapped, lancamentos), {
    FORNECEDOR: "CONSTRUTORA SÃO JOSÉ",
    OBSERVA_x00c7__x00d5_ESENTREGA: "ENTREGAR APÓS AS 14H",
  });
});

test("diarios preserva somente nomes exatos de messageFields e normaliza os demais multilines", () => {
  const diarios = entityById("diarios-de-obras");
  const mapped = mapSharePointColumns([
    { name: "DESCRICAO", displayName: "Descrição", text: { allowMultipleLines: true } },
    { name: "OBSERVACOES", displayName: "Observações", multilineText: {} },
    { name: "ATIVIDADESEXECUTADAS", displayName: "Atividades executadas", text: { allowMultipleLines: true } },
  ], diarios);

  assert.deepEqual(normalizeFormValues({
    DESCRICAO: "Concretagem concluída com ressalva",
    OBSERVACOES: "Equipe pediu nova vistoria",
    ATIVIDADESEXECUTADAS: "Montagem do segundo pavimento",
  }, mapped, diarios), {
    DESCRICAO: "Concretagem concluída com ressalva",
    OBSERVACOES: "Equipe pediu nova vistoria",
    ATIVIDADESEXECUTADAS: "MONTAGEM DO SEGUNDO PAVIMENTO",
  });
});

test("Choice Lookup Person e tipos nao textuais nao sao convertidos para uppercase", () => {
  const lancamentos = entityById("lancamentos");
  const mapped = mapSharePointColumns([
    { name: "STATUS", displayName: "Status", choice: { choices: ["Em análise"] } },
    { name: "OBRA", displayName: "Obra", lookup: { listId: "obras", columnName: "Title" } },
    { name: "RESPONSAVEL", displayName: "Responsável", personOrGroup: { chooseFromType: "peopleOnly" } },
    { name: "VALOR", displayName: "Valor", number: { displayAs: "currency" } },
    { name: "DATA", displayName: "Data", dateTime: { format: "dateOnly" } },
    { name: "APROVADO", displayName: "Aprovado", boolean: {} },
  ], lancamentos);

  assert.deepEqual(normalizeFormValues({
    STATUS: "Em análise",
    OBRA: "42",
    RESPONSAVEL: "17",
    VALOR: "1.234,50",
    DATA: "2026-08-27",
    APROVADO: true,
  }, mapped, lancamentos), {
    STATUS: "Em análise",
    OBRALookupId: 42,
    RESPONSAVELLookupId: 17,
    VALOR: 1234.5,
    DATA: "2026-08-27",
    APROVADO: true,
  });
});

test("filtra por busca e status, ordena e pagina sem mutar os itens da lista", () => {
  const items = [
    { id: "1", fields: { Title: "BRUNO", NOME: "BRUNO", STATUS: "PENDENTE" } },
    { id: "2", fields: { Title: "ANA", NOME: "ANA", STATUS: "FINALIZADO" } },
    { id: "3", fields: { Title: "CARLA", NOME: "CARLA", STATUS: "PENDENTE" } },
  ];
  const result = sortAndFilterItems(items, entity, {
    search: "a",
    status: "PENDENTE",
    sort: { field: "Title", direction: "asc" },
    page: 1,
    pageSize: 1,
  });

  assert.equal(result.total, 1);
  assert.equal(result.pages, 1);
  assert.equal(result.items[0].id, "3");
  assert.equal(items[0].id, "1");
});
