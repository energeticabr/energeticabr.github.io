export const reviewTable = (overrides = {}) => ({
  kind: 'provision_settlement_review', descriptionId: '7',
  title: 'DETALHAMENTO — DESCRITIVO 7', notice: '',
  rows: [
    { id: '11', index: 1, product: 'CIMENTO PORTLAND CP II 50 KG', quantityDisplay: '2', unitPriceDisplay: 'R$ 10,50', totalDisplay: 'R$ 24,00', freightDisplay: 'R$ 3,00', paid: false },
    { id: '12', index: 2, product: 'AREIA MÉDIA LAVADA', quantityDisplay: '1', unitPriceDisplay: 'R$ 20,00', totalDisplay: 'R$ 20,00', freightDisplay: '', paid: false },
    { id: '13', index: 3, product: 'TUBO PVC SOLDÁVEL 25 MM', quantityDisplay: '3', unitPriceDisplay: 'R$ 5,00', totalDisplay: 'R$ 16,00', freightDisplay: 'R$ 1,00', paid: false },
    { id: '14', index: 4, product: 'LUVA SOLDÁVEL', quantityDisplay: '2', unitPriceDisplay: 'R$ 2,50', totalDisplay: 'R$ 5,00', freightDisplay: '', paid: true },
  ],
  totalDisplay: 'R$ 65,00', pendingTotalDisplay: 'R$ 60,00', hasPaidRows: true, canSubmit: true,
  ...overrides,
});

export const reviewMessage = (table = reviewTable()) => ({
  id: 'synthetic-review', role: 'assistant', type: 'poll',
  question: 'DESCRITIVO 7 — CONFIRA AS PROVISÕES.\nPRODUTO | QTD | VALOR UNITÁRIO | VALOR TOTAL\n1. CIMENTO PORTLAND CP II 50 KG | 2 | R$ 10,50 | R$ 24,00\nTOTAL GERAL: R$ 65,00\nSUBMETA OS VALORES OU ESCOLHA UMA LINHA PARA EDITAR.',
  detail_table: table,
  options: [
    { id: 'choice:description_review:description_review_submit', reply: 'description_review_submit', label: '✅ SUBMETER', disabled: table?.canSubmit === false },
    { id: 'choice:description_review:description_review_edit', reply: 'description_review_edit', label: '✏️ EDITAR ALGUMA LINHA' },
  ],
});

export const reviewState = (message = reviewMessage(), overrides = {}) => ({
  sessionStatus: 'authenticated', account: { name: 'Prévia' },
  draft: '', pendingFiles: [], attachments: [], activeText: null,
  activeFlow: { id: 'payment_settlement', title: 'BAIXAR PAGAMENTO AGENDADO', stepKey: 'description_review', contextId: 'synthetic-description-7' },
  messages: [message], ...overrides,
});
