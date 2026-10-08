export function provisionSnapshot(overrides = {}) {
  return {
    id: 'provision-batch-one', currency: 'BRL', count: 2, total: '44.50', totalDisplay: 'R$ 44,50',
    lines: [1, 2].map(index => ({
      index, product: index === 1 ? 'Cimento' : 'Areia', quantity: '2',
      unitPrice: '10.50', unitPriceDisplay: 'R$ 10,50', freight: '1.25',
      freightDisplay: 'R$ 1,25', total: '22.25', totalDisplay: 'R$ 22,25',
      details: { supplier: index === 1 ? 'Fornecedor A' : 'Fornecedor B', branch: 'Filial A',
        property: 'Imóvel A', paymentMethod: 'PIX', dueDate: '08/10/2026', observation: 'Entregar na obra' },
    })),
    ...overrides,
  };
}

export const provisionFlow = provisionLines => ({
  id: 'payment', title: 'PROVISÃO DE PAGAMENTO', contextId: 'question-one', provisionLines,
});

export const provisionState = activeFlow => ({
  sessionStatus: 'authenticated', account: { name: 'Teste' }, draft: 'Próxima linha',
  messages: [], pendingFiles: [], activeFlow,
});
