# Cadastro de documentos em sequência

## Objetivo

Ao entrar em ADICIONAR UM NOVO DOCUMENTO, escolher APENAS UM DOCUMENTO ou
DIVERSOS DOCUMENTOS. O caminho único mantém perguntas, resumo, confirmação e
postagem atuais. Não alterar assinatura de documentos nem anexação a item existente.

## Fluxo múltiplo

O primeiro documento usa o formulário existente e exige anexo próprio. No resumo,
oferecer ADICIONAR MAIS UM DOCUMENTO, SUBMETER SEM ADICIONAR MAIS DOCUMENTOS,
EDITAR e CANCELAR. Adicionar mais um confirma e grava o documento atual antes
de preparar o seguinte. Encerrar grava o atual e conclui o fluxo.

O próximo documento conserva os dados comuns (filial, homologação, pessoa/fornecedor,
emissão, validade, imóvel, contrato, marco, observação e etapa), nunca o tipo ou os
anexos anteriores. Mostrar menu de edição dos dados aplicáveis, uma pergunta por
vez, usando as dependências do formulário existente. PROSSEGUIR SEM EDITAR pergunta
TIPODOCUMENTO e depois coleta o novo anexo, sem repetir os demais dados. Ao editar
um campo, retornar ao menu, permitindo editar outros. Não inventar valores ausentes.

## Persistência e segurança

Um item DOCUMENTOS por documento. Cada linha tem identidade idempotente própria,
checkpoint durável independente da navegação e anexos isolados. Só avançar após
confirmar campos e anexos no SharePoint. Falhas preservam a linha e a intenção de
continuar/encerrar. Se a criação tiver resultado desconhecido, tentar reconciliar
pelo token, nunca fazer novo POST baseado apenas em consulta vazia. Não permitir
editar uma linha cuja postagem já começou. Limpar o histórico ao passar para outro
documento para não voltar a uma linha enviada. Registros já enviados não são
apagados ao cancelar os próximos.

## Compatibilidade e verificação

Implementar no motor compartilhado da VM, com as mensagens de opções já aceitas
pelos clientes Android, iOS e Windows/web, sem depender de atualização nativa.
Testar o motor real com SharePoint e mídia sintéticos: único, vários, reuso/edição,
anexo obrigatório, falhas, repetição, retomada e cadastro auxiliar de tipo.
Validar visualmente o chat com respostas do motor em ambiente local, sem publicar
documentos de teste na base real. Implantação com hashes, backup e verificação de
saúde. Publicar o código revisável no GitHub; conferir os três clientes.
