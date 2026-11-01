# Sincronizacao do editor apos conflito
O aviso de conflito de versao (SharePoint HTTP412/concurrent_change) do editor compartilhado recebe um botao SINCRONIZAR a direita. O clique faz somente leitura atualizada do mesmo ID/entidade/variante. Quando a leitura for bem-sucedida, o formulario passa aos valores e ETag mais recentes, sem reaplicar campos antigos sobre mudancas de terceiros. Novos ajustes usam preenchimento laranja e confirmacao Campo/Antes/Depois existentes antes de salvar.

Durante a consulta, impedir submits/duplo clique; permitir voltar/fechar e ignorar respostas atrasadas ou de outra sessao. Em falha, manter o formulario e rascunho anteriores e permitir tentar sincronizar novamente. Preservar anexos locais preparados; nunca duplicar upload ou exclusao. Alertar conflitos de nomes sem destruir o rascunho. Nao exibir a acao em erros comuns, exclusao, ou erro apenas de atualizar a galeria depois de um save confirmado.

Nenhum registro real deve ser alterado nos testes. Preservar os14 blocos de assinatura. Publicar Windows/web, Androidinternal e iOSTestFlight na mesma revisao validada.
