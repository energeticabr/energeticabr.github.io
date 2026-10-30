# Plano de implementacao: vinculo incremental DDA x documento fiscal

**Objetivo:** anexar automaticamente o PDF fiscal correto ao mesmo item de cada DDA novo, sem reexaminar DDAs existentes.

**Arquitetura:** o proprio fluxo Power Automate que cria o DDA consulta a lista fiscal e copia o PDF usando a conexao SharePoint autorizada. O ramo roda somente quando a deduplicacao retorna zero itens existentes. A interface existente continua responsavel por listar e abrir todos os anexos do item.

## Task 1: Especificar o comportamento com testes

- Criar testes para o filtro por CNPJ, dia e valor liquido/total.
- Cobrir cancelamento, PDF pendente, ambiguidade e a garantia de que atualizacao nao consulta a lista fiscal.
- Cobrir idempotencia da transformacao da definicao.
- Executar os testes e confirmar falha antes da implementacao.

## Task 2: Implementar a definicao do fluxo

- Consultar SharePoint com filtro exato de fornecedor, dia e valores, limitado a duas candidatas.
- Prosseguir somente com uma candidata e exatamente um PDF fiscal.
- Copiar o arquivo para o item DDA e conferir o anexo por releitura da colecao.
- Expor o estado fiscal no recibo do fluxo.

## Task 3: Integrar somente ao ramo de criacao

- Inserir a vinculacao depois da confirmacao do espelho DDA.
- Condicionar a consulta a `length(Localizar.value) = 0`.
- Registrar o resultado sem transformar ausencia ou ambiguidade em vinculo incorreto.
- Preservar os recibos e a fila remota atuais.

## Task 4: Implantar e verificar

- Publicar a definicao no Power Automate com restauracao automatica em caso de falha de verificacao.
- Executar testes unitarios PowerShell, testes da Galeria DDA e validacoes completas do app.
- Fazer uma sincronizacao real e conferir recibo, logs e, se houver novo DDA com candidata unica, os dois anexos no mesmo item.
- Publicar a versao do app para web/Windows, Android e iOS se houver alteracao de cliente; se o cliente permanecer inalterado, validar a compatibilidade multiplataforma da galeria ja publicada.
