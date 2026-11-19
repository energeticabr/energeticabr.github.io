# Cadastro de produto nas propostas fiscais

Implementar diretamente conforme autorização do usuário. Botão azul CADASTRAR
à direita de Produto em cada item, tanto no lançamento como na provisão.
Abrir formulário dentro do mesmo diálogo; preservar proposta e anexos no DOM.
Usar o cadastro SharePoint CADASTROPRODUTO, com subfamília, nome, unidade,
tipo de despesa e geração de desembolso. Sugerir nome/unidade do XML.
Ao salvar, selecionar o produto no item de origem e atualizar os demais seletores.
Cancelar retorna à proposta intacta. Envios reservados não permitem cadastro.

1. Serviço de cadastro: carregar opções e validar valores, resolver colunas,
   gravar produto ativo com classificação da subfamília; detectar duplicados
   e reconciliar repetição após resposta perdida. Testes com repositório fictício.
2. Integrar formulário e cluster à view compartilhada. Testar lançamento e
   provisão, seleção, preservação de edição/anexos, cancelamento e falha.
3. Executar regressões fiscais, builds PWA/nativo e trava de assinatura;
   revisar diff, integrar por PR e verificar Pages, Play interno e TestFlight.

Review focus: perda do rascunho, repetição de cadastro, cadastro em envio
reservado, callbacks após fechar, botões dentro do rótulo do seletor.
