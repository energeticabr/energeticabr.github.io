# Configuração da assinatura em documentos

## Objetivo

Permitir que o usuário escolha onde a assinatura será aplicada no PDF e se
ela será repetida em todas as páginas ou usada somente na página final. A
assinatura continuará sem o fundo branco da imagem enviada.

## Experiência do usuário

Depois que o documento e a imagem da assinatura forem recebidos, o fluxo
mostrará uma etapa de configuração. O usuário escolherá uma das modalidades:

- **Todas as páginas**: aplica a mesma assinatura em cada página.
- **Somente página final**: aplica a assinatura apenas na última página.

Em seguida, o usuário escolherá uma posição em uma grade de nove áreas:
superior, central ou inferior, combinada com esquerda, centro ou direita.
Quando a modalidade for somente a página final, a interface exibirá apenas
essa modalidade configurada; não haverá uma segunda opção para assinatura
repetida em todas as páginas nessa tela.

As coordenadas serão armazenadas de forma proporcional à largura e à altura
da página, para que a escolha continue correta em páginas com dimensões
diferentes. A posição padrão permanece centro inferior e todas as páginas,
preservando o comportamento anterior para estados antigos ou incompletos.

## Implementação

O estado do fluxo receberá `document_signing_scope` (`all` ou `final`) e
`document_signing_position` com coordenadas normalizadas. Após receber a
assinatura, o workflow aguardará a modalidade e a posição antes de gerar o
PDF. Os comandos também serão representados como opções estruturadas, para
que o mesmo fluxo funcione no portal web, no iOS, no Android e em canais que
consumam as enquetes existentes.

O gerador de PDF aceitará o escopo e a posição, converterá as coordenadas
normalizadas para cada mediabox e mesclará a imagem somente nas páginas
selecionadas. O recorte e a transparência da assinatura continuarão sendo
validados antes da composição.

## Falhas e compatibilidade

Escolhas ausentes, inválidas ou estados antigos usarão o padrão centro
inferior em todas as páginas. PDFs protegidos, imagens inválidas e páginas
sem dimensões válidas continuarão gerando erro seguro e permitindo nova
tentativa. O documento original não será alterado; o resultado será um novo
arquivo assinado.

## Validação

Os testes cobrirão: aplicação em todas as páginas, aplicação somente na
última, cada posição da grade, páginas com tamanhos diferentes, compatibilidade
com a assinatura padrão antiga e a sequência completa do workflow.
