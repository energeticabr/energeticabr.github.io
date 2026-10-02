import Decimal from "decimal.js";
export const PAYROLL_LAUNCH_REPLY_ID = "action_supplier_payroll_launch";
export const PAYROLL_RUBRICS = Object.freeze(
  [
    ["salary", "Salário", "SALÁRIO"],
    ["allowance", "Ajuda de custo", "AJUDA DE CUSTO"],
    ["meal", "Vale alimentação", "VALE REFEIÇÃO"],
    ["award", "Prêmio", "PREMIAÇÃO"],
    ["transport", "Vale transporte", "VALE TRANSPORTE"],
    ["thirteenth", "13º salário", "13 SALÁRIO"],
    ["vacation", "Férias", "FÉRIAS E/OU ENCARGOS"],
  ].map(([id, label, payrollType]) =>
    Object.freeze({ id, label, payrollType }),
  ),
);
export const payrollKey = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
export function isSupplierPayrollMenu(message, flow) {
  if (flow?.id !== "launch") return false;
  const modality = (message?.options || []).some((option) =>
    [option.id, option.reply, option.replyId].some((id) =>
      /^choice:tipo_lancamento:2$/.test(String(id || "")),
    ),
  );
  return (
    modality &&
    (flow.rows || []).some(
      (row) =>
        payrollKey(row.value) === "NOVOPEDIDO" &&
        /PEDIDO|LANCAMENTO/.test(payrollKey(row.label)),
    )
  );
}
export function payrollDecimal(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/^R\$\s*/, "");
  const localized = text.includes(",");
  if (!(localized ? /^\d+(?:\.\d{3})*,\d+$/ : /^\d+(?:\.\d+)?$/).test(text))
    throw new RangeError("Informe um número válido.");
  const decimal = new Decimal(
    localized ? text.replace(/\./g, "").replace(",", ".") : text,
  );
  if (!decimal.isFinite() || decimal.gt(1e12))
    throw new RangeError("O valor informado está fora do limite.");
  return decimal;
}
export function payrollTotal(lines = []) {
  const total = lines.reduce((total, line) => {
    if (String(line.unitValue ?? "").trim() === "") return total;
    return total.plus(
      payrollDecimal(line.quantity)
        .times(payrollDecimal(line.unitValue))
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    );
  }, new Decimal(0));
  if (total.times(100).gt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("O total ultrapassa o limite de precisão monetária.");
  }
  return total.toNumber();
}
export function validPayrollDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text
  );
}
export function validatePayrollDraft(draft) {
  if (!validPayrollDate(draft?.date))
    throw new RangeError("Selecione uma data válida.");
  for (const [field, label] of [
    ["supplier", "fornecedor"],
    ["product", "produto"],
    ["stage", "etapa"],
  ]) {
    if (!draft[field]?.id || !draft[field]?.label)
      throw new RangeError(`Selecione o ${label} cadastrado.`);
  }
  if (!String(draft.supplier.branch || "").trim())
    throw new RangeError("O fornecedor não possui filial cadastrada.");
  const seen = new Set();
  const lines = [];
  for (const line of draft.lines || []) {
    if (String(line.unitValue ?? "").trim() === "") {
      if (line.files?.length)
        throw new RangeError(
          "Informe o valor da rubrica que contém comprovantes.",
        );
      continue;
    }
    const rubric = PAYROLL_RUBRICS.find((r) => r.id === line.rubric);
    if (!rubric || seen.has(rubric.id))
      throw new RangeError("Rubrica inválida ou repetida.");
    seen.add(rubric.id);
    const quantity = payrollDecimal(line.quantity),
      unitValue = payrollDecimal(line.unitValue);
    if (!quantity.gt(0))
      throw new RangeError(
        `Informe quantidade maior que zero em ${rubric.label}.`,
      );
    if (!line.account?.id || !line.account?.label)
      throw new RangeError(
        `Selecione a forma de pagamento de ${rubric.label}.`,
      );
    if (unitValue.isZero()) continue;
    lines.push({
      ...line,
      quantity: quantity.toNumber(),
      unitValue: unitValue.toNumber(),
      label: rubric.label,
      payrollType: rubric.payrollType,
      files: line.files || [],
    });
  }
  if (!lines.length)
    throw new RangeError(
      "Preencha pelo menos uma rubrica com valor maior que zero.",
    );
  return { ...draft, lines, total: payrollTotal(lines) };
}
