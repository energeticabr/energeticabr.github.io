import assert from "node:assert/strict";
import test from "node:test";

import {
  F21_RECURRENCE_OPTIONS,
  isF21RecurrenceDaysVisible,
  normalizeF21Recurrence,
  normalizeF21RecurrenceDays,
  normalizeF21RecurringExpenseRules,
} from "../portal/forms/despesas-recorrentes-powerapps-rules.js";
import { persistEntityRecord } from "../portal/forms/entity-submit.js";

test("F21 translates recurrence labels to the values stored by Power Apps", () => {
  assert.deepEqual(F21_RECURRENCE_OPTIONS, [
    { label: "Diário", value: "Day" },
    { label: "Semanal", value: "Week" },
    { label: "Mensal", value: "Month" },
    { label: "Anual", value: "Year" },
  ]);

  assert.equal(normalizeF21Recurrence("Diário"), "Day");
  assert.equal(normalizeF21Recurrence("Semanal"), "Week");
  assert.equal(normalizeF21Recurrence("Mensal"), "Month");
  assert.equal(normalizeF21Recurrence("Anual"), "Year");
});

test("F21 preserves recurrence values already stored in SharePoint", () => {
  for (const value of ["Day", "Week", "Month", "Year"]) {
    assert.equal(normalizeF21Recurrence(value), value);
  }
});

test("RECORRENCIADIAS is visible only while recurrence is blank", () => {
  assert.equal(isF21RecurrenceDaysVisible(), true);
  assert.equal(isF21RecurrenceDaysVisible(null), true);
  assert.equal(isF21RecurrenceDaysVisible(""), true);
  assert.equal(isF21RecurrenceDaysVisible("Diário"), false);
  assert.equal(isF21RecurrenceDaysVisible("Day"), false);
});

test("RECORRENCIADIAS is normalized as text and retained when hidden", () => {
  assert.equal(normalizeF21RecurrenceDays(), "");
  assert.equal(normalizeF21RecurrenceDays(null), "");
  assert.equal(normalizeF21RecurrenceDays(15), "15");
  assert.equal(normalizeF21RecurrenceDays(" 2, 16 e 30 "), "2, 16 e 30");

  assert.deepEqual(
    normalizeF21RecurringExpenseRules({
      RECORRENCIA: "Mensal",
      RECORRENCIADIAS: " 10 ",
    }),
    {
      RECORRENCIA: "Month",
      RECORRENCIADIAS: "10",
      recurrenceDaysVisible: false,
    },
  );
});

test("a gravação de F21 envia ao SharePoint a recorrência interna do Power Apps", async () => {
  const writes = [];
  await persistEntityRecord({
    async createItem(siteKey, listId, fields) {
      writes.push({ siteKey, listId, fields });
      return { id: "51", fields };
    },
  }, { id: "despesas-recorrentes", siteKey: "personal" }, { id: "despesas-list" }, {
    mode: "create",
    fields: { Title: "ALUGUEL", RECORRENCIA: "Mensal", RECORRENCIADIAS: " 10 " },
  });

  assert.deepEqual(writes[0], {
    siteKey: "personal",
    listId: "despesas-list",
    fields: { Title: "ALUGUEL", RECORRENCIA: "Month", RECORRENCIADIAS: "10" },
  });
});
