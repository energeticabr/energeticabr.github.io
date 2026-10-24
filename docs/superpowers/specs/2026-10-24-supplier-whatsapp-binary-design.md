# WhatsApp do fornecedor: respostas diretas

## Intenção e escopo

Na pergunta `💬 ESTE TELEFONE POSSUI WHATSAPP?` do cadastro de fornecedor
embutido no lançamento, mostrar somente as respostas de domínio `SIM` e `NÃO`,
além da navegação já existente. Remover a confirmação `SIM, MANTER — ...`, a
ação de escolher outro valor e a instrução de filtrar. Cada escolha grava seu
valor em `WHATSAPP` e avança para o e-mail sem perder o fluxo pai.

## Abordagem

Reutilizar a correção restrita já publicada para homologação: normalizar os
títulos e retirar `confirm_recommended` apenas deste passo; atualizar opções
em memória antes de resolver a resposta. Alterar só o texto no aplicativo não
corrigiria os valores nem os menus de sessões existentes. Alterar globalmente
o comportamento de recomendações afetaria perguntas não solicitadas.

## Restrições

- Preservar os IDs condicionais existentes: telefone vazio, 1=NÃO e 2=SIM;
  telefone preenchido, 1=SIM e 2=NÃO.
- Um botão antigo de manter continua representando seu valor; a antiga ação
  de expandir só reapresenta a pergunta, sem gravar resposta.
- Preservar homologação, demais recomendações, contexto pai, anexos e dados.
- Não alterar blocos protegidos de assinatura nem gerar lançamentos de teste.
- Publicar no backend compartilhado por Android, iOS e Windows, com fontes
  independentes de produção e espelho, hashes, bloqueios, backup e recuperação.
- Nenhuma mudança em binários nativos ou no bundle web é necessária.

## Verificação

Executar os motores e serializadores reais com estados fictícios, tanto para
telefone vazio como preenchido: opções, gravação, resposta digitada, retomada
e menus antigos. Reexecutar os testes de homologação. Conferir saúde e hashes
independentemente após a publicação e testar o código realmente instalado.
