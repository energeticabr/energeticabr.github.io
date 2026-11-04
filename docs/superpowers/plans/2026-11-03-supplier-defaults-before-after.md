# Comparação dos padrões dos fornecedores

**Objetivo:** Apresentar o antes e depois de descritivo e atividade, agrupados por fornecedor, antes da confirmação da atualização dos cadastros.

**Abordagem:** A VM consulta o cadastro real, registra os valores vistos na confirmação e transmite uma tabela estruturada com texto alternativo para clientes anteriores. O aplicativo apresenta fornecedor e filial à esquerda, duas linhas de campos à direita, colunas Antes/Depois e cores alternadas. Se os valores mudarem após a visualização, exige nova confirmação; se a consulta falhar, permite submeter sem atualizar os cadastros e oferece nova consulta.

- [ ] Testar dados reais de antes por fornecedor, alterações simultâneas, falha/reconsulta, retomada, Sim/Não e transporte pelo canal real usando dados fictícios.
- [ ] Verificar a tabela e o toque em 320/390 px e Windows, nomes longos, dados vazios e escapes.
- [ ] Validar ambas as fontes independentes da VM e o instalador com proteção contra drift, saúde e rollback.
- [ ] Publicar o backend compatível com clientes anteriores, integrar o aplicativo e confirmar web, Android interno e TestFlight para a mesma revisão.
