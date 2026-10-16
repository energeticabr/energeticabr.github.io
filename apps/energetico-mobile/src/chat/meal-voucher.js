import Decimal from 'decimal.js';
import { payrollDecimal, payrollKey, validPayrollDate } from './supplier-payroll.js';

export const MEAL_VOUCHER_REPLY_ID = 'action_meal_voucher_launch';
export const mealVoucherKey = payrollKey;

function amounts(line) {
  if (!String(line.unitValue ?? '').trim() || !String(line.quantity ?? '').trim()) return null;
  let quantity, unitValue, quantityError, valueError;
  try { quantity = payrollDecimal(line.quantity); } catch (error) { quantityError = error; }
  try { unitValue = payrollDecimal(line.unitValue); } catch (error) { valueError = error; }
  if (quantity?.isZero() || unitValue?.isZero()) return null;
  if (quantityError) throw quantityError;
  if (valueError) throw valueError;
  return { quantity, unitValue };
}

export function mealVoucherLines(rawLines = []) {
  const selected = [];
  const seen = new Set();
  for (const line of rawLines) {
    const parsed = amounts(line);
    if (!parsed) continue;
    const { quantity, unitValue } = parsed;
    if (quantity.isNegative() || unitValue.isNegative()) throw new RangeError('Quantidade e valor devem ser maiores que zero.');
    const supplier = line.supplier;
    if (!/^[1-9]\d*$/.test(String(supplier?.id ?? '')) || !supplier.label)
      throw new RangeError('Selecione um fornecedor cadastrado.');
    if (seen.has(String(supplier.id))) throw new RangeError('Fornecedor repetido no lote.');
    seen.add(String(supplier.id));
    if (!String(supplier.branch || '').trim()) throw new RangeError('O fornecedor precisa de filial cadastrada.');
    if (!String(supplier.profession || '').trim()) throw new RangeError('O fornecedor precisa de profissão cadastrada para definir o produto.');
    const total = quantity.times(unitValue).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (total.times(100).gt(Number.MAX_SAFE_INTEGER)) throw new RangeError('O valor excede o limite de precisão.');
    selected.push({ supplier, quantity: quantity.toNumber(), unitValue: unitValue.toNumber(), total: total.toNumber() });
  }
  if (!selected.length) throw new RangeError('Informe o valor de pelo menos um fornecedor.');
  return selected;
}

export function mealVoucherTotal(lines = []) {
  const total = lines.reduce((sum, line) => {
    const parsed = amounts(line);
    return parsed ? sum.plus(parsed.quantity.times(parsed.unitValue).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)) : sum;
  }, new Decimal(0));
  if (total.times(100).gt(Number.MAX_SAFE_INTEGER)) throw new RangeError('O total excede o limite de precisão.');
  return total.toNumber();
}

export function validateMealVoucherDraft(draft) {
  if (!validPayrollDate(draft?.date) || !validPayrollDate(draft?.dueDate)) throw new RangeError('Informe uma data válida para lançamento e vencimento.');
  if (draft?.paymentDate && !validPayrollDate(draft.paymentDate)) throw new RangeError('Informe uma data válida para o pagamento efetuado.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(draft?.referenceMonth || ''))) throw new RangeError('Informe um mês de referência válido.');
  const lines = mealVoucherLines(draft.lines);
  const branch = lines[0].supplier.branch;
  if (lines.some(line => mealVoucherKey(line.supplier.branch) !== mealVoucherKey(branch)))
    throw new RangeError('Selecione fornecedores da mesma filial para vincular a um único pedido.');
  if (!draft.stage?.id || mealVoucherKey(draft.stage.branch) !== mealVoucherKey(branch))
    throw new RangeError('Selecione uma etapa cadastrada para a filial.');
  if (!draft.account?.id || !draft.account.label) throw new RangeError('Selecione uma conta ou forma de pagamento cadastrada.');
  if (draft.orderMode !== 'new' && draft.orderMode !== 'existing') throw new RangeError('Selecione pedido novo ou existente.');
  if (draft.orderMode === 'existing' && !/^[1-9]\d*$/.test(String(draft.orderId ?? '')))
    throw new RangeError('Selecione um pedido existente.');
  return { ...draft, lines, branch, total: mealVoucherTotal(lines), obs: String(draft.obs || '').trim(), files: draft.files || [] };
}
