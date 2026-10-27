# Percentual em todos os carregamentos do Energético

Sempre que o mascote de carregamento aparecer, mostrar o cluster de percentual
na mesma linha, imediatamente à direita do ícone giratório, inclusive durante
processamento de respostas e transições entre perguntas. Usar o componente
compartilhado já adotado por chat, galerias, formulários, relatórios e anexos.

Iniciar em 0% quando uma operação começa sem medida informada. Manter os valores
reais quando fornecidos; conservar o estado indeterminado explícito dos downloads
sem tamanho conhecido (—%, sem aria-valuenow). Atualizar apenas o texto não deve
zerar um progresso existente. Nunca simular avanço por tempo ou antecipar 100%.

A escolha de implementação é aplicar o padrão nas duas formas do componente
(HTML e criação DOM), em vez de alterar cada chamada individual. Preservar o
layout, a identificação de acessibilidade e os gestos de assinatura protegidos.
Verificar 320px, 390px e desktop, claro/escuro, com dados fictícios; executar testes
e publicar a mesma revisão em Windows/PWA, Android interno e TestFlight.
