# Plano: vale-alimentação em lote

Spec: `docs/superpowers/specs/2026-10-15-meal-voucher-launches-design.md`

## Task 1 — Modelo e persistência

- Criar validação de linhas, datas, mês de referência, filial e total com Decimal; linhas em branco ou zero são omitidas.
- Criar fonte SharePoint que lista todos os fornecedores elegíveis e opções de etapa/conta/pedido.
- Confirmar IDFOLHA única por fornecedor no mês, salvar pedido, lançamentos e FOLHAPGTO idempotentemente, com releitura, proteção de sessão e anexos.
- TDD: testes de seleção, valores, agrupamento, pedido existente, falha parcial e retomada.

## Task 2 — Interface e integração

- Inserir opção após folha, abrir tela própria no controlador e prover autorização Microsoft.
- Criar tabela responsiva, perguntas adicionais, resumo e confirmação de postagem.
- TDD: testes de interface, navegação, conexão do controlador e bloqueios de seleção.

## Task 3 — Verificação e publicação

- Rodar trava de gestos, testes focados e suíte apropriada, build web/PWA e revisão.
- Publicar código web/PC e iniciar distribuições TestFlight e Play internal; verificar os resultados da revisão correta.
