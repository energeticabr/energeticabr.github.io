import assert from 'node:assert/strict';

// Explicit second user action in the assigned payroll/provision integration tests.
export function confirmPayrollProvisionEdit(document) {
  const review = document.querySelector('[data-edit-review]');
  assert.ok(review?.open, 'first submit must open the edit review before persistence');
  assert.deepEqual([...review.querySelectorAll('th')].map(cell => cell.textContent), ['Campo', 'Antes', 'Depois']);
  const confirm = review.querySelector('[data-edit-review-confirm]');
  assert.equal(confirm?.textContent, 'SUBMETER');
  confirm.click();
}
