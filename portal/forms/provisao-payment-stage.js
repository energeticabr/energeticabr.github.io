export const PROVISAO_PAYMENT_STAGE_LABELS = Object.freeze([
  "EMPENHADO HOJE",
  "EMPENHADO E LIQUIDADO HOJE",
  "LIQUIDADO HOJE",
  "LIQUIDADO E PAGO HOJE",
  "EMPENHADO, LIQUIDADO E PAGO HOJE",
  "PAGO HOJE",
]);

const LIQUIDATED_TODAY = new Set([
  "EMPENHADO E LIQUIDADO HOJE",
  "LIQUIDADO HOJE",
  "LIQUIDADO E PAGO HOJE",
  "EMPENHADO, LIQUIDADO E PAGO HOJE",
]);

const PAID_TODAY = new Set([
  "LIQUIDADO E PAGO HOJE",
  "EMPENHADO, LIQUIDADO E PAGO HOJE",
  "PAGO HOJE",
]);

function currentDateValues(currentValues = {}) {
  return {
    DATA: currentValues?.DATA ?? null,
    DATAPREVISTOPGTO: currentValues?.DATAPREVISTOPGTO ?? null,
    DATAPGTOEFETUADO: currentValues?.DATAPGTOEFETUADO ?? null,
  };
}

function explicitValueOrDefault(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "string" && value.trim() === "") return defaultValue;
  return value;
}

export function getProvisaoPaymentStageDefaults(
  paymentStage,
  currentValues = {},
  today,
  formMode = "create",
) {
  const current = currentDateValues(currentValues);
  if (formMode === "edit") return current;

  return {
    DATA: explicitValueOrDefault(currentValues?.DATA, today),
    DATAPREVISTOPGTO: explicitValueOrDefault(
      currentValues?.DATAPREVISTOPGTO,
      LIQUIDATED_TODAY.has(paymentStage) ? today : null,
    ),
    DATAPGTOEFETUADO: explicitValueOrDefault(
      currentValues?.DATAPGTOEFETUADO,
      PAID_TODAY.has(paymentStage) ? today : null,
    ),
  };
}
