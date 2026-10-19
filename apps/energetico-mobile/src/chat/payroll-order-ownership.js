import { payrollKey, PAYROLL_RUBRICS } from './supplier-payroll.js';

const mealType = payrollKey(PAYROLL_RUBRICS.find(rubric => rubric.id === 'meal').payrollType);

// Legacy meal purchases can name the benefit operator (or DIVERSOS) on the
// parent order. The payroll row and its launch must still belong to the worker;
// callers also verify the order's exact ID and branch. Provision-backed and
// other-rubric paths retain the worker-only parent rule.
export function payrollOrderSupplierMatches({ supplier, orderSupplier, paymentType, hasProvision }) {
  const owner = payrollKey(orderSupplier);
  return !!owner && (owner === payrollKey(supplier)
    || !hasProvision && payrollKey(paymentType) === mealType);
}
