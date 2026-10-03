import test from "node:test";
import assert from "node:assert/strict";
import * as payroll from "../src/chat/supplier-payroll.js";
const flow = {
  id: "launch",
  rows: [
    {
      label:
        "ESSE LANÇAMENTO SERÁ APLICADO A UM PEDIDO EXISTENTE OU SERÁ CRIADO UM NOVO PEDIDO?",
      value: "NOVO PEDIDO",
    },
  ],
};
const menu = {
  question: "COMO DESEJA EFETUAR O LANÇAMENTO?",
  options: [
    { id: "choice:tipo_lancamento:1", label: "LANÇAMENTO ÚNICO" },
    { id: "choice:tipo_lancamento:2", label: "LANÇAMENTO MÚLTIPLO" },
  ],
};
test("folha aparece apenas na modalidade Novo Pedido do fluxo de lançamentos", () => {
  assert.equal(payroll.isSupplierPayrollMenu(menu, flow), true);
  assert.equal(
    payroll.isSupplierPayrollMenu(menu, {
      ...flow,
      rows: [{ label: "TIPO DE PEDIDO", value: "PEDIDO EXISTENTE" }],
    }),
    false,
  );
  assert.equal(
    payroll.isSupplierPayrollMenu(menu, {
      ...flow,
      id: "personal_expense_launch",
    }),
    false,
  );
  assert.equal(
    payroll.isSupplierPayrollMenu(
      { question: "Qual produto?", options: [] },
      flow,
    ),
    false,
  );
});
test("rubricas seguem imagem e total usa quantidade vezes valor, com centavos exatos", () => {
  assert.deepEqual(
    payroll.PAYROLL_RUBRICS.map((r) => r.label),
    [
      "Salário",
      "Ajuda de custo",
      "Vale alimentação",
      "Prêmio",
      "Vale transporte",
      "13º salário",
      "Férias",
    ],
  );
  assert.equal(
    payroll.payrollTotal([
      { quantity: "2", unitValue: "1.234,56" },
      { quantity: "3", unitValue: "0,10" },
    ]),
    2469.42,
  );
});
test("validação ignora linhas vazias e recusa quantidade, conta, data e valores inválidos", () => {
  const draft = {
    date: "2026-10-02",
    supplier: { id: "1", label: "EDGAR", branch: "OBRA A" },
    product: { id: "2", label: "PEDREIRO" },
    stage: { id: "3", label: "FUNDAÇÃO" },
    sheet: { id: "9", label: "10/2026" },
    lines: [
      {
        rubric: "salary",
        quantity: "2",
        unitValue: "120,50",
        account: { id: "4", label: "PIX" },
      },
      { rubric: "award", quantity: "1", unitValue: "", account: null },
    ],
  };
  assert.equal(payroll.validatePayrollDraft(draft).lines.length, 1);
  for (const sheet of [
    null,
    {},
    { id: "0", label: "10/2026" },
    { id: "abc", label: "10/2026" },
    { id: "9" },
  ])
    assert.throws(
      () => payroll.validatePayrollDraft({ ...draft, sheet }),
      /IDFOLHA/,
    );
  for (const patch of [
    { quantity: "0" },
    { quantity: "-1" },
    { unitValue: "1abc" },
    { unitValue: "Infinity" },
    { account: null },
  ])
    assert.throws(() =>
      payroll.validatePayrollDraft({
        ...draft,
        lines: [{ ...draft.lines[0], ...patch }],
      }),
    );
  assert.throws(() =>
    payroll.validatePayrollDraft({ ...draft, date: "2026-02-30" }),
  );
  assert.throws(() =>
    payroll.validatePayrollDraft({
      ...draft,
      lines: [{ ...draft.lines[0], unitValue: "" }],
    }),
  );
});

test("não permite totais além da precisão monetária segura", () => {
  assert.throws(
    () =>
      payroll.payrollTotal([
        { quantity: "1000000000000", unitValue: "1000000000000" },
      ]),
    /limite|precisão/i,
  );
});

test("rubrica sem valor nunca entra no envio, mesmo com quantidade alterada ou comprovante", () => {
  const result = payroll.validatePayrollLines([
    { rubric: "salary", quantity: "1", unitValue: "150", account: { id: "3", label: "PIX" } },
    { rubric: "allowance", quantity: "2", unitValue: "  ", account: null, files: [{ name: "comprovante.pdf" }] },
    { rubric: "meal", quantity: "1", unitValue: "", account: null },
  ]);
  assert.equal(result.total, 150);
  assert.deepEqual(result.lines.map(line => line.rubric), ["salary"]);
});

test("valor zero não exige conta nem entra no envio de uma folha com rubrica válida", () => {
  const result = payroll.validatePayrollLines([
    { rubric: "salary", quantity: "1", unitValue: "150", account: { id: "3", label: "PIX" } },
    { rubric: "allowance", quantity: "1", unitValue: "0", account: null },
  ]);
  assert.equal(result.total, 150);
  assert.deepEqual(result.lines.map(line => line.rubric), ["salary"]);
});
