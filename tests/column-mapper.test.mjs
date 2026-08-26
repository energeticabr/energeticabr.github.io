import assert from "node:assert/strict";
import test from "node:test";
import {
  mapSharePointColumns,
  normalizeFormValues,
  sortAndFilterItems,
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

test("mapeia os tipos reais de coluna SharePoint e ignora os campos de sistema", () => {
  const mapped = mapSharePointColumns(columns, entity);

  assert.equal(mapped.some(column => column.name === "ID"), false);
  assert.equal(mapped.some(column => column.name === "Created"), false);
  assert.equal(mapped.some(column => column.name === "LinkTitleNoMenu"), false);
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
    },
  );
  assert.equal(mapped.find(column => column.name === "Title").required, true);
  assert.equal(mapped.find(column => column.name === "INTERNO").hidden, true);
  assert.equal(mapped.find(column => column.name === "FORMULA").editable, false);
  assert.deepEqual(mapped.find(column => column.name === "STATUS").choices, ["PENDENTE", "FINALIZADO"]);
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
    OBSERVACAO: "manter como digitado",
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
