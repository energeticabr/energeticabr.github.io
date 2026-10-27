# Galeria DDA

Pedido: GALERIA DDA abaixo de DESPESAS RECORRENTES; botao PGTO PROVISAO E RECORRENTES ocupa a altura das quatro galerias.

Implementacao: reutilizar galeria de registros com modelo DDA, leitura da lista privada DDAS SICOOB e anexos pelo visualizador existente. Somente consulta, sem criar, editar, excluir ou pagar. A leitura REST usa a sessao Microsoft atual e as permissoes SharePoint existentes, sem credenciais bancarias no cliente. Graph nao expõe esta lista particular na verificacao atual.

1. Testes de menu, leitura dos campos, anexos, autenticacao/ciclo de vida.
2. Modelo de consulta e integracao no menu; grade quatro linhas.
3. Guard de assinatura, testes, builds e verificacao visual 320/390px com dados ficticios.
4. Revisao, PR, merge e distribuicao Android/iOS/Windows pelos workflows existentes, verificando estados finais.

Baseline: origin/main 938bcd08; checkout principal tem alteracoes de outros trabalhos, preservadas. Worktree isolado feat/galeria-dda-20261027. Guard inicial: 14 blocos intactos.
