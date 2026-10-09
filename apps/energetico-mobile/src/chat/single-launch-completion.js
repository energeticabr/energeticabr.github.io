// This is a read-only projection of the worker's confirmed-write notice, not
// evidence that a submission succeeded. Unrecognized notices keep their text.
export function singleLaunchCompletion(message) {
  if (message?.role === 'user' || (message?.type && message.type !== 'text')
    || message?.launchCompletionMode === 'multiple'
    || message?.presence_confirmation || message?.presenceConfirmation
    || message?.payment_audit_table || message?.paymentAuditTable
    || message?.detail_table || message?.detailTable || message?.presenceDateSummary) return null;
  const lines = String(message?.text || '').replaceAll('*', '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length !== 4 && lines.length !== 5) return null;
  const heading = lines[0].match(/^(?:✅\s*)?(?:🟢\s*)?LANÇAMENTO GRAVADO NA BASE DE DADOS LANCAMENTOS ÀS ((?:[01]\d|2[0-3]):[0-5]\d)\.?\s*(?:🕒)?$/i);
  if (!heading || !/^(?:🆔\s*)?REGISTROS CONFIRMADOS:$/i.test(lines[1])) return null;
  const launch = lines[2].match(/^(?:•\s*)?LANÇAMENTO:\s*ID ([1-9]\d*)$/i);
  const order = lines.length === 5 ? lines[3].match(/^(?:•\s*)?PEDIDO:\s*ID ([1-9]\d*)$/i) : null;
  const total = lines.at(-1).match(/^(?:💰\s*)?VALOR TOTAL DOS LANÇAMENTOS:\s*(R\$\s*(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2})$/i);
  if (!launch || (lines.length === 5 && !order) || !total) return null;
  return Object.freeze({ time: heading[1], launchId: launch[1], orderId: order?.[1] || null, total: total[1] });
}

export function isMultipleLaunchFlow(flow) {
  return (flow?.rows || []).some(row => /LANÇAMENTO MÚLTIPLO/i.test(String(row?.value || '')))
    || (flow?.launches?.lines || []).some(line => Boolean(line?.editReply));
}
