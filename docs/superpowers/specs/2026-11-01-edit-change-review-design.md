# Revisao de edicoes
O usuario solicita todos os campos alterados com preenchimento laranja e confirmacao antes da gravacao em todas as telas de edicao. A implementacao compartilhada no renderDynamicForm deve abranger as galerias genericas, relatorios e o editor de descritivo de provisao; lancamentos possuem editor/revisao proprios a integrar.

Comparar semanticamente com o registro carregado; ao restaurar o valor original retirar o destaque. Pesquisar uma opcao sem seleciona-la nao e alteracao. Exibir Campo, Antes, Depois em tabela responsiva; incluir anexos adicionados/removidos. Primeiro SUBMETER apenas valida e abre revisao. SUBMETER na revisao persiste uma vez; CANCELAR/Escape volta aos valores editados. Fechamento/cleanup nao pode persistir. Formularios de criacao permanecem no fluxo existente. Manter validacao, locks, ETags, recuperacao de falha e comprovante apos gravar.

Escolha tecnica: componente compartilhado no portal, reutilizado pelo aplicativo, sem interceptacao global de eventos. Incorporar editores customizados conforme inventario. Nenhuma alteracao em registros reais nos testes. Publicar web/Windows, Android interno, iOS TestFlight na mesma revisao validada.
