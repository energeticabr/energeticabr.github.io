# Gallery Conflict Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** permitir recuperar um editor que recebeu412 usando uma nova leitura autoritativa.
**Architecture:** acao de leitura no createGalleryRecordActions; reaproveitar renderizador e callbacks de persistencia com novo contexto, sem alterarETag ou gravacoes no servico de dados.
**Tech Stack:** JavaScript, DOM, node:test, jsdom, Vite/Capacitor.
**Spec:** docs/superpowers/specs/2026-11-01-gallery-conflict-sync-design.md

## Global Constraints
- SINCRONIZAR a direita do aviso, alvo44px e sem overflow em320/390px.
- Somente leitura na sincronizacao; novos campos/ETag do servidor, nenhuma sobrescrita automatica.
- Falha preserva rascunho; anexos preparados preservados; cancelar/descartar ignora resposta atrasada.
- Confirmacao e destaque da tarefa anterior permanecem; nenhum bloco de assinatura modificado.
- Publicar web/Windows, Androidinternal e TestFlight com entrega verificada.

## Review Focus
- Conflito repetido depois da sincronizacao deve continuar protegido por ETag.
- Erros normais ou refresh apos save nao podem virar recuperacao de contexto.
- Variante/identidade incorreta ou metadados nao editaveis devem falhar antes de limpar o formulario.
- Anexos preparados nao podem desaparecer, ser duplicados ou gravados pela sincronizacao.
- Respostas de leitura apos fechar/trocar contexto nao podem reabrir o editor.

## Task1: implementar e provar recuperacao
- [x] Reproduzir412 e observar testeRED do botao e zero writes no sync.
- [x] Implementar aviso+read/reload com novosdados/ETag, preservarestado em falha e anexos locais.
- [x] Integracoes reais com repositorio simulado, erros/retry/variant/abort e novo save com confirmacao; testesfocadosGREEN.
## Task2: verificar e publicar
- [x] QA390/320 com dadosficticios, buildsapp/PWA, guard14 e revisaoindependente.
- [ ] Commit/PR/merge; acompanhar CI e entregasweb/Android/TestFlight sem duplicar publicacoes.
