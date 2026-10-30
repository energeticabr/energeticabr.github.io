# Vinculacao incremental DDA x documento fiscal

## Objetivo

Quando o sincronizador Sicoob criar um item novo em `DDAS SICOOB`, consultar somente os documentos fiscais candidatos daquele fornecedor e daquele dia. Se houver exatamente uma correspondencia segura de valor, copiar o PDF fiscal para os anexos do mesmo item, preservando o espelho DDA ja anexado.

## Gatilho e limite de busca

- A rotina roda dentro do fluxo SharePoint somente quando `Localizar` retorna zero itens existentes.
- Atualizacoes de DDAs existentes nao executam consulta fiscal.
- A consulta SharePoint e filtrada por CNPJ/CPF do fornecedor e intervalo fechado-aberto do dia de emissao, com limite de resultados. Nao existe varredura diaria do acervo.
- Falhas transitorias usam a politica de repeticao do conector dentro do processamento do novo DDA; nao criam varredura retroativa.

## Criterios de correspondencia

1. Fornecedor: CNPJ/CPF deve ser exatamente igual.
2. Data: a data de emissao fiscal deve ser o mesmo dia calendario informado pelo Sicoob.
3. Valor: o valor do DDA em centavos deve ser igual ao valor liquido ou ao valor total da nota. Para documentos de servico, o valor dos servicos tambem pode ser considerado.
4. Documento: exige PDF fiscal marcado como disponivel e nota nao cancelada.
5. Unicidade: somente uma candidata e anexada. Zero candidatas resulta em `unmatched`; duas ou mais resultam em `ambiguous`, sem escolher arbitrariamente.

## Execucao no Power Automate

- A busca e a copia rodam dentro do mesmo fluxo que cria ou atualiza o DDA, usando a conexao SharePoint ja autorizada para os dois sites.
- A condicao externa exige que `Localizar` tenha retornado zero itens; assim, atualizacoes nunca executam a consulta fiscal.
- Dentro do ramo de criacao, data de emissao, CNPJ/CPF e valor precisam estar presentes antes de montar o filtro. DDA novo com algum desses dados ausente conclui normalmente como `unmatched`, sem consultar a lista fiscal.
- A consulta retorna no maximo duas candidatas. Uma candidata avanca; zero resulta em `unmatched`; duas resultam em `ambiguous`.
- A lista fiscal deve devolver exatamente um anexo PDF. O arquivo recebe o prefixo `FISCAL-`, e o fluxo rele a lista de anexos do DDA para confirmar uma unica gravacao antes de responder.
- Reexecucoes de um DDA ja criado entram no ramo de atualizacao e nao tentam anexar novamente.
- A Galeria DDA ja abre colecoes de anexos; assim, o mesmo item passa a expor o espelho DDA e o DANFE, DANFSe ou DACTE separadamente em Android, iOS e web/Windows.

## Auditoria

O recibo do fluxo inclui `fiscalStatus` com `not_created`, `linked`, `unmatched`, `ambiguous` ou `pdf_unavailable`. Nenhum dado bancario ou fiscal novo e enviado a fila remota; ela continua recebendo apenas contagens e IDs opacos ja autorizados.
