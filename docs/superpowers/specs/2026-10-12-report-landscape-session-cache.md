# Relatórios horizontais e cache de sessão

Os relatórios que hoje impedem abertura na vertical devem abrir imediatamente em um viewport horizontal. Em telefone vertical, rotacionar apenas a superfície do relatório em 90 graus; em horizontal/desktop usar a superfície normal. Rotação é exclusivamente layout e nunca cancela, limpa ou repete consultas. Filtros, rolagem, navegação e PDF continuam utilizáveis; não modificar os gestos protegidos de assinatura nem rotacionar o relatório mensal RHID, que já suporta retrato.

Manter snapshots completos, bem-sucedidos, em memória na mesma sessão autenticada, inclusive quando o controller recria a tela. Não persistir em disco/localStorage, não reutilizar entre contas, logout, nova sessão ou fechamento. Chaves incluem relatório e parâmetros relevantes. Cancelamento, falha ou resposta de geração antiga não podem preencher o cache. Atualizar força uma nova consulta. Escritas de dados invalidam o cache conservadoramente, inclusive baixa, edição e criação; não alterar semântica de autorização. Preservar filtros/paginação incremental de 200 itens e PDF completo.

Publicar web/Windows, Android interno e iOS TestFlight conforme instruções existentes, após testes e revisão, verificando a revisão publicada e a tela real.

## Acréscimos RHID solicitados durante a execução

Ao gerar presenças mensais, abrir apenas o PDF, sem repetir tabelas/resumos HTML abaixo dos botões e sem mensagem persistente de sucesso nesse espaço. Manter avisos de carregamento/erro, seleção múltipla, elegibilidade, cancelamento e retorno do visualizador. O PDF conserva todas as informações.

No PDF RHID, reservar a área de assinatura digital acima de uma linha física. Colocar nome do funcionário e nome/identificação do representante abaixo dessa linha, em dois campos separados. Preservar campos /Sig canônicos, identidade de cada funcionário, gestos protegidos e uma página por funcionário. Verificar posição real do texto/linha/campos, renderizar uma prévia sintética de 31 dias e conferir visualmente antes da publicação.
