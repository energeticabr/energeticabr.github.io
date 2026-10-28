export function ddaPaidManually(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}
export function validateDdaPaymentReceipt(result, { itemId, key }) {
  if (result?.status !== 'confirmed' || result.itemId !== Number(itemId) || result.key !== key
    || typeof result.confirmedBy !== 'string' || !result.confirmedBy.trim()
    || typeof result.confirmedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(result.confirmedAt)
    || !Number.isFinite(Date.parse(result.confirmedAt))) throw new Error('A gravação do pagamento não foi confirmada.');
  return result;
}
