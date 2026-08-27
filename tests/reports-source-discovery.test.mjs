import assert from "node:assert/strict";
import test from "node:test";
import { discoverReportEntities } from "../portal/reports/reports-page.js";

function entity(index) {
  return Object.freeze({
    id: `fonte-${String(index).padStart(2, "0")}`,
    siteKey: "company",
    listNames: [`LISTA ${index}`],
  });
}

function pause(milliseconds = 1) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

test("descobre todas as fontes com concorrencia limitada entre quatro e seis", async () => {
  const entities = Array.from({ length: 81 }, (_, index) => entity(index));
  const resolved = [];
  const columns = [];
  let active = 0;
  let maximumActive = 0;

  async function operation(log, value) {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await pause(2);
    log.push(value);
    active -= 1;
  }

  const repository = {
    async resolveList(_siteKey, names) {
      const index = Number(names[0].replace("LISTA ", ""));
      await operation(resolved, index);
      return { status: "resolved", id: `lista-${index}` };
    },
    async getColumns(_siteKey, listId) {
      const index = Number(listId.replace("lista-", ""));
      await operation(columns, index);
      return [];
    },
  };

  const result = await discoverReportEntities(repository, entities);

  assert.equal(maximumActive >= 4, true, `concorrencia maxima observada: ${maximumActive}`);
  assert.equal(maximumActive <= 6, true, `concorrencia maxima observada: ${maximumActive}`);
  assert.deepEqual([...resolved].sort((left, right) => left - right), Array.from({ length: 81 }, (_, index) => index));
  assert.deepEqual([...columns].sort((left, right) => left - right), Array.from({ length: 81 }, (_, index) => index));
  assert.deepEqual(result.map(source => source.id), entities.map(source => source.id));
  assert.ok(Object.isFrozen(result));
});

test("preserva a ordem original mesmo quando as fontes terminam fora de ordem", async () => {
  const entities = Array.from({ length: 12 }, (_, index) => entity(index));
  const repository = {
    async resolveList(_siteKey, names) {
      const index = Number(names[0].replace("LISTA ", ""));
      await pause(12 - index);
      return { status: "resolved", id: `lista-${index}` };
    },
    async getColumns() {
      await pause(1);
      return [];
    },
  };

  const result = await discoverReportEntities(repository, entities);

  assert.deepEqual(result.map(source => source.id), entities.map(source => source.id));
});

test("isola falhas e fontes ausentes sem interromper as demais", async () => {
  const entities = Array.from({ length: 10 }, (_, index) => entity(index));
  const columnCalls = [];
  const repository = {
    async resolveList(_siteKey, names) {
      const index = Number(names[0].replace("LISTA ", ""));
      if (index === 2) throw new Error("falha ao resolver");
      if (index === 4) return { status: "missing" };
      return { status: "resolved", id: `lista-${index}` };
    },
    async getColumns(_siteKey, listId) {
      const index = Number(listId.replace("lista-", ""));
      columnCalls.push(index);
      if (index === 6) throw new Error("falha nas colunas");
      return [];
    },
  };

  const result = await discoverReportEntities(repository, entities);

  assert.deepEqual(result.map(source => source.id), [
    "fonte-00",
    "fonte-01",
    "fonte-03",
    "fonte-05",
    "fonte-07",
    "fonte-08",
    "fonte-09",
  ]);
  assert.equal(columnCalls.includes(4), false);
  assert.equal(columnCalls.length, 8);
});
