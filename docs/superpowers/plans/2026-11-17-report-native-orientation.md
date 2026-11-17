# Report Native Orientation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Orientar relatórios e teclado na horizontal em iPhone/Android e liberar orientação ao fechar.

**Architecture:** Plugin oficial Capacitor; controlador compartilhado de visibilidade com fila de operações; integração em `bindReportLandscape` preservando CSS de fallback.

**Tech Stack:** JavaScript, Capacitor 8.5.1, Screen Orientation 8.0.2, JSDOM, Vite.

**Spec:** `docs/superpowers/specs/2026-11-17-report-native-orientation-design.md`

## Global Constraints

- Preservar todos os blocos de gestos de assinatura e executar o guard antes/depois.
- Somente aplicativo nativo solicita rotação; navegador mantém layout atual.
- Publicar revisão validada em Pages, Android interno e TestFlight.

## Review Focus

- Construção de relatório oculto não gira o app.
- Relatórios sobrepostos mantêm bloqueio até o último fechar.
- Fechar durante lock pendente deve executar unlock depois do lock.
- Remover/destruir relatório ou ocultar ancestral libera a orientação.
- Negação nativa mantém CSS e não deixa promise rejeitada.

### Task 1: Controlador e integração

**Files:** criar `src/native/report-orientation.js`, `tests/report-native-orientation.test.mjs`; modificar `src/ui/report-landscape.js`, dependências e projetos nativos gerenciados.

- [ ] Escrever testes de ciclo real de DOM e das operações da ponte nativa, incluindo os cinco casos de revisão e navegador sem chamadas.
- [ ] Executar testes antes da implementação e confirmar falha por funcionalidade ausente.
- [ ] Implementar `createReportOrientationController({isNative,screenOrientation}).bind(root)` com `update()`/`destroy()` e integração ao helper compartilhado.
- [ ] Instalar versão exata do plugin e sincronizar projetos iOS/Android.
- [ ] Rodar testes direcionados, suíte apropriada, builds nativo/PWA e guard.

### Task 2: Revisão e distribuição

- [ ] Revisar diff e comportamento concorrente, preservar DOM e consultas na rotação.
- [ ] Commit, PR e integração; acompanhar CI e distribuição dos três canais.
- [ ] Conferir artefatos e estados de distribuição da revisão publicada; comunicar limitações de validação física.
