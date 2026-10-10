# Relatório de folhas: painel de pagamentos

Evoluir o HTML existente para o modelo visual fornecido: identidade do fornecedor, totais coloridos por tipo, tabela de pagamentos, edição e exportação. Manter filtros por mês de referência, fornecedor e profissão, impressão e navegação existentes.

O período exibido corresponde ao primeiro e último dia do mês de referência da folha (incluindo fevereiro bissexto), não às datas mínima/máxima dos pagamentos. Em Todos, mostrar os períodos distintos das folhas.

Cada tipo presente recebe seu próprio bloco e somatório, sem limitar à lista da imagem. Salário verde, vale refeição amarelo, vale transporte azul, premiação roxo, ajuda de custo laranja e outros tipos com cores estáveis. Valores desconhecidos nunca viram zero.

Tabela inclui IDs de pagamento/folha/lançamento, tipo, data, descrição, valor unitário, quantidade, total, conta/forma de pagamento e ações de edição. Reutilizar os formulários existentes: editar FOLHAPGTO para vínculos/tipo/data e LANÇAMENTOS para valores e descrição, sem gravar cópias dos valores financeiros em FOLHAPGTO. Editar apenas ao submeter o formulário. Após salvar, recarregar dados e totais mantendo os filtros e fornecedor aberto.

Exportar CSV UTF-8 com BOM, separador ponto e vírgula, IDs, fornecedor, período, campos de pagamento e totais por tipo/geral. Exportar o fornecedor aberto ou todos os resultados filtrados; não exportar conjuntos incompletos. Escapar aspas/quebras e neutralizar fórmulas em campos textuais. Usar exportMedia existente para Windows/web, Android e iOS.

Preservar seleção por referência mesmo quando pagamento ocorreu depois do mês. Não incluir exclusão nova, gráficos nem alterações nos blocos SIGNATURE_GESTURE_LOCK. Validar com dados fictícios; não salvar edições reais na verificação.
