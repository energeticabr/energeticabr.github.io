# Plano de implementação — Documento de Entrega de EPI

## 1. Cobertura de regressão e contrato

- Criar testes do menu intermediário e preservar teste do caminho avulso.
- Criar testes da data, fornecedor filtrado, produto filtrado, quantidade e laço de múltiplos itens.
- Criar testes do HTML/PDF, incluindo escape de conteúdo e linhas dinâmicas.
- Criar teste de ponta a ponta da assinatura e gravação em `DOCUMENTOS`.

## 2. Gerador do documento

- Adicionar módulo dedicado para normalização dos dados, HTML e PDF A4.
- Incluir cabeçalho da empresa, identificação do fornecedor, tabela de EPIs e área de assinatura.
- Produzir nome de arquivo previsível e seguro.

## 3. Máquina de estados

- Adicionar estágios e comandos do novo menu e do questionário EPI.
- Consultar SharePoint pelas fontes `FORNECEDORES` e `CADASTROPRODUTO` com os filtros solicitados.
- Armazenar campos de origem necessários no estado.
- Gerar e preparar o PDF para o assinador existente.

## 4. Assinatura e SharePoint

- Após posicionar a assinatura do EPI, assinar o PDF sem abrir o formulário genérico.
- Criar item idempotente em `DOCUMENTOS`, anexar o PDF e verificar a gravação.
- Entregar o PDF assinado ao usuário e concluir no menu principal.

## 5. Verificação e publicação

- Executar testes unitários focados, regressões do assinador e testes do aplicativo.
- Fazer revisão do diff e checagens de segurança.
- Implantar o backend.
- Publicar build de teste no TestFlight e na faixa interna do Google Play, sem produção.
