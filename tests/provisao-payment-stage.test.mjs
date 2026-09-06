import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVISAO_PAYMENT_STAGE_LABELS,
  getProvisaoPaymentStageDefaults,
} from "../portal/forms/provisao-payment-stage.js";
import { formMarkup } from "../portal/ui/dynamic-form.js";

const TODAY = "2026-09-06";

const CASES = [
  ["EMPENHADO HOJE", TODAY, null, null],
  ["EMPENHADO E LIQUIDADO HOJE", TODAY, TODAY, null],
  ["LIQUIDADO HOJE", TODAY, TODAY, null],
  ["LIQUIDADO E PAGO HOJE", TODAY, TODAY, TODAY],
  ["EMPENHADO, LIQUIDADO E PAGO HOJE", TODAY, TODAY, TODAY],
  ["PAGO HOJE", TODAY, null, TODAY],
];

test("F3 exposes Dropdown4_3 labels in the published Power Apps order", () => {
  assert.deepEqual(PROVISAO_PAYMENT_STAGE_LABELS, CASES.map(([label]) => label));
});

for (const [paymentStage, DATA, DATAPREVISTOPGTO, DATAPGTOEFETUADO] of CASES) {
  test(`F3 applies the ${paymentStage} date defaults`, () => {
    assert.deepEqual(
      getProvisaoPaymentStageDefaults(paymentStage, {}, TODAY, "create"),
      { DATA, DATAPREVISTOPGTO, DATAPGTOEFETUADO },
    );
  });
}

test("F3 does not overwrite dates explicitly entered while creating", () => {
  const currentValues = {
    DATA: "2026-08-31",
    DATAPREVISTOPGTO: "2026-09-15",
    DATAPGTOEFETUADO: "2026-09-20",
  };

  assert.deepEqual(
    getProvisaoPaymentStageDefaults(
      "EMPENHADO, LIQUIDADO E PAGO HOJE",
      currentValues,
      TODAY,
      "create",
    ),
    currentValues,
  );
});

test("F3 edit mode preserves the SharePoint dates instead of applying creation defaults", () => {
  assert.deepEqual(
    getProvisaoPaymentStageDefaults(
      "LIQUIDADO E PAGO HOJE",
      {
        DATA: "2026-08-01",
        DATAPREVISTOPGTO: null,
        DATAPGTOEFETUADO: null,
      },
      TODAY,
      "edit",
    ),
    {
      DATA: "2026-08-01",
      DATAPREVISTOPGTO: null,
      DATAPGTOEFETUADO: null,
    },
  );
});

test("F3 renders the external Dropdown4_3 equivalent only while creating", () => {
  const entity = { id: "provisoes-de-pagamento", title: "Provisão de pagamento" };
  const create = formMarkup({ entity, mode: "create", columns: [] });
  const edit = formMarkup({ entity, mode: "edit", columns: [] });

  assert.match(create, /data-provisao-payment-stage/);
  for (const label of PROVISAO_PAYMENT_STAGE_LABELS) assert.match(create, new RegExp(`>${label}<`));
  assert.doesNotMatch(edit, /data-provisao-payment-stage/);
});
