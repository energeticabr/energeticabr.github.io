# Fornecedor de destino do pagamento

> **For agentic workers:** Execute inline using superpowers:executing-plans.

**Goal:** Permitir escolher o fornecedor da folha independentemente do fornecedor do lançamento.
**Architecture:** O seletor usa o cadastro de empreiteiros ativos. O lançamento preenche o fornecedor inicialmente; a troca invalida a folha anterior. App e servidor validam o destino escolhido, mantendo IDLANCAMENTO, data, quantidade e valor da origem.
**Tech Stack:** JavaScript, Node test/JSDOM/Chrome, Python unittest, SharePoint.
**Spec:** Pedido e imagem do usuário nesta tarefa; execução e publicação já autorizadas.

## Global Constraints
- Fornecedor imediatamente abaixo de Lançamento, com busca, cluster azul e X.
- Nova escolha do lançamento restaura seu fornecedor padrão; limpar fornecedor bloqueia submissão.
- Folha pertence ao fornecedor escolhido; valor e quantidade continuam do lançamento.
- Preservar competência INSS/FGTS, validação cadastral, trava por origem e retomada idempotente.
- Publicar Windows/web, Android interno e iOS TestFlight.

## Review Focus
- Fornecedor sem lançamento próprio deve aparecer no catálogo.
- Mudança de fornecedor limpa folha anterior e mantém valores.
- Folha de outro fornecedor e fornecedor inativo são recusados sem escrita.
- Troca do destino após envio incerto não gera nova gravação.
- INSS/FGTS continua respeitando competência e unicidade da origem.

### Task 1: Seleção e gravação
- [ ] Adicionar regressões em payroll-payment-view.test.mjs, payroll-payment-data.test.mjs e test_payroll_pending.py e observar falhas.
- [ ] Alterar payroll-payment-view.js, payroll-payment-data.js e payroll_pending.py; adaptar fixture/layout ao novo contrato supplierId.
- [ ] Executar testes focados, layout responsivo, suíte completa, builds e guard.
- [ ] Revisar a mudança e publicar backend com manifesto, hash de base, backup e health.
- [ ] Integrar código e verificar Pages, Play interno e TestFlight pela revisão publicada.

## Execution ledger
- Baseline: 33 testes focados aprovados; guard confirmou 14 blocos intactos.
- Ruling: usar worktree manual isolada após criação nativa não retornar; fetch do repositório local falhou por objetos ausentes. Não alterar o checkout de outra tarefa.
