# Cadastro de etapa dentro da baixa da provisão

Na pergunta `etapa_baixa` do fluxo `payment_settlement`, oferecer `➕ CADASTRAR ETAPA` como primeira opção. Abrir o fluxo padrão `construction_stage_registration`, preservando o contexto da baixa e seus anexos. Ao concluir e verificar o cadastro, selecionar a etapa criada e continuar a baixa. Voltar/cancelar o cadastro devolve o contexto original sem efetuar a baixa.

A pergunta de filial do cadastro mantém todas as escolhas válidas e oferece primeiro, com `⭐`, a filial original do pagamento. A mesma recomendação vale para a pergunta de filial da própria baixa, quando exibida. Conservar IDs e valores originais do catálogo, sem duplicar opções ou modificar o valor gravado com o emoji. Se não houver correspondência inequívoca no catálogo, manter as opções válidas sem inventar uma filial.

Reutilizar o cadastro incorporado existente no servidor e o renderizador de opções já instalado nos três clientes. A alteração fica no backend comum; não requer novos binários móveis. Não modificar políticas de filiais, gravação financeira, cálculo de valores ou transferência de anexos. Toda validação usa armazenamento e catálogos fictícios.
