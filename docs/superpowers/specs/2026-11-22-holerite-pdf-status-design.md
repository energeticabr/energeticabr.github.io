# Holerite PDF Status Placement Design

- Intenção: aumentar a área vertical do PDF no relatório de holerites, movendo o indicador de carregamento concluído e o resumo de páginas/tamanho para a direita de ENCAMINHAR.
- Escopo: somente `data-layout="payslip-report-pdf"`; prévias DDA, NF-e e anexos gerais mantêm a apresentação atual. O progresso durante carregamento e erros continuam visíveis na faixa de status.
- Abordagem: renderizar o status concluído em uma região compacta no rodapé, depois do botão de encaminhar, e recolher a faixa central quando não há mensagem ativa.
- Validação: teste DOM do layout e CSS responsivo; executar testes focados, build web e guarda de gestos. Não há mudança de lógica de assinatura ou conteúdo PDF.

