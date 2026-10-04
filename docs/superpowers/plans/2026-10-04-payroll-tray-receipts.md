# Payroll tray receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Selecionar comprovantes da bandeja nas rubricas.
**Architecture:** Picker dedicado recebe snapshot e leitura autenticada do controller.
A view conserva File por rubrica e o transporte SharePoint existente.
**Tech Stack:** JS DOM/CSS, node:test/JSDOM e Playwright.
**Spec:** docs/superpowers/specs/2026-10-04-payroll-tray-receipts.md

## Global Constraints

- Não abrir seletor externo, consumir anexos nem alterar assinaturas bloqueadas.
- Publicar web/Windows, Android interno e TestFlight; não postar pagamentos de teste.

## Review Focus

- Bandeja vazia, download falho, cancelamento tardio, sessão encerrada,
  arquivo removido, nome extenso/HTML e duplicado: exercitar sem vínculo incorreto.

### Task 1: Picker e integração

**Files:** src/ui/payroll-receipt-picker.js, src/ui/supplier-payroll-view.js,
src/ui/supplier-payroll.css, src/app-controller.js e testes correspondentes.
**Interfaces:** getReceiptAttachments() retorna snapshot; readReceiptAttachment(id)
retorna Promise<File> e revalida sessão/bandeja. onConfirm recebe File[].

- [x] Escrever testes da seleção/cancelamento/erro/sessão; rodar e observar falhas.
- [x] Implementar picker e controller, remover input file; verificar testes verdes.
- [x] Verificar browser 320/390/768/1365/PWA, suítes completas/build/guard.
- [ ] Revisão independente, commit/PR e publicação verificada.
