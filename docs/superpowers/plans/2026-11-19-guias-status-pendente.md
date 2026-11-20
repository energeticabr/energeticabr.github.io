# Status inicial das guias — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans e revisão independente ao final.

**Goal:** Confirmar a criação mensal de INSS/FGTS e persistir STATUS=PENDENTE em toda nova solicitação.

**Architecture:** Manter o timer diário de conferência e a chave mensal única. Adicionar STATUS de texto obrigatório com padrão PENDENTE no SharePoint e no payload do worker. Inicialização explícita preenche apenas status vazios, com backup e ETag; recorrência nunca altera status existentes. Galeria/editor e relatório exibem e filtram o campo real.

**Tech Stack:** Python, SharePoint REST/Power Platform, systemd, JavaScript/CSS, Node/JSDOM/Chrome.

**Spec:** Pedido nesta conversa; executar e publicar sem nova confirmação conforme instrução permanente do usuário.

## Global Constraints

- Somente filial 004 - EDIFÍCIO XAVANTE, competência anterior e vencimento seguinte, ambos dia 20.
- Uma linha por tipo/competência; preservar valores, anexos e status já preenchidos.
- STATUS inicial PENDENTE também para criação direta no SharePoint.
- Preservar os 14 blocos de assinatura; publicar web/PC, Play interno e TestFlight.

## Review Focus

- Virada mensal e anual não duplicam solicitações nem criam competência futura.
- Reexecução não restaura PENDENTE sobre status alterado pelo usuário.
- Migração toca somente STATUS vazio e usa ETag exato, preservando edições concorrentes.
- Status exibido vem da linha, sem inferir pagamento a partir de anexo.
- Coluna/filtro adicionais permanecem utilizáveis no celular e PC.

## Execução

- [x] Ler código e conferir timer habilitado/ativo, unidade --apply e última execução com exit0.
- [x] Testar criação PENDENTE, limites mensais e preservação; implementar campo/default/payload e inicializador com backup/ETag.
- [x] Criar coluna no SharePoint, inicializar vazios, implantar worker e confirmar execução idempotente/duas linhas reais.
- [x] Exibir STATUS na galeria/editor/relatório e filtros; testar valores persistidos e telas pequenas.
- [ ] Executar verificações relacionadas, builds, guard e revisão; integrar e acompanhar publicação nos três canais.
