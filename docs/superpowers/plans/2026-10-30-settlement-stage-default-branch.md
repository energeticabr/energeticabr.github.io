# Settlement stage registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Cadastrar etapa durante a baixa e destacar a filial do pagamento.

**Architecture:** Patch mínimo do WorkflowEngine, usando o fluxo padrão de cadastro incorporado. A etapa verificada retorna ao contexto preservado da baixa; uma recomendação visual ordena a filial sem alterar seu ID/valor.

**Tech Stack:** Python WorkflowEngine, testes offline com unittest/pytest, instalador com hashes e rollback.

**Spec:** `docs/superpowers/specs/2026-10-30-settlement-stage-default-branch-design.md`

## Global Constraints

- Reutilizar `construction_stage_registration`.
- Preservar pagamento, anexos, diário de gravação e retorno ancestral.
- Manter cadastro como primeira opção e filial padrão marcada com ⭐.
- Não realizar testes com registros reais nem publicar binários sem alteração do cliente.
- Publicar o backend com baseline recente, CAS, backup e verificação de saúde.

## Review Focus

- Botão de cadastro continua primeiro após filtrar, limpar ou atualizar opções.
- Filial padrão vem do pagamento, não de rótulo decorado ou outra linha.
- Sem filial válida/unívoca, não inventar escolhas nem ampliar permissões.
- Cancelar/voltar no cadastro restaura o contexto e anexos.
- Cadastro não confirmado não pode avançar nem efetuar baixa financeira.

### Task 1: Comportamento do fluxo

- [ ] Capturar baseline de código atual do servidor.
- [ ] Criar regressões RED do WorkflowEngine real para cadastro primeiro, retorno e filial padrão.
- [ ] Implementar o patch no snapshot privado e verificar GREEN, incluindo baixa simples e agrupada.
- [ ] Revisão independente do patch e testes focados/regressões relacionadas.

### Task 2: Empacotamento e publicação

- [ ] Produzir diff público e arquivo de código privado com hashes fixados.
- [ ] Validar instalador e deriva do baseline sem gravar registros reais.
- [ ] Commit/PR/merge; instalar somente os arquivos revisados com rollback.
- [ ] Confirmar hashes/saúde e verificar os menus com catálogo fictício usando o código instalado.
- [ ] Abrir o app público e registrar a publicação comum aos três clientes.
