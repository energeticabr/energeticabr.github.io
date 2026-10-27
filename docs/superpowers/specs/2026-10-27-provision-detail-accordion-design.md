# Provisões vinculadas em cartões expansíveis

Usar a primeira imagem do usuário como referência: cada provisão tem um resumo compacto com iniciais, fornecedor, descrição, data, valor total, status e seta. Ao expandir, exibir os demais campos em linhas organizadas, incluindo quantidade, valor unitário, frete, filial, imóvel e observação. Preservar também IDFOLHA e data de pagamento quando existentes.

O primeiro item começa aberto; tocar outro fecha o anterior, e tocar o aberto permite recolher todos. A escolha é de apresentação, sem nova consulta ao expandir e sem qualquer escrita na base. Manter todos os vínculos, valores, total do grupo, cores alternadas e fechamento/foco do modal.

Estender o componente compartilhado pelas galerias de pagamentos e descritivos. Botões nativos com aria-expanded/aria-controls e painéis ocultos garantem teclado e acessibilidade no Android, iOS e Windows. No celular estreito o resumo pode ocupar duas linhas para preservar data, total e status legíveis.

Alternativas: details nativo dependeria de suporte uniforme a grupos exclusivos; manter cartões estáticos não atende à referência. Usar botão/painel no componente existente, com um item aberto por vez. Execução e publicação já estão autorizadas, sem perguntas de aprovação.
