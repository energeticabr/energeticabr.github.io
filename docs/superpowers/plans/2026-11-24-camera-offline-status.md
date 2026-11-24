# Camera Offline Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir status e última conexão nas câmeras, consultando iCSee a cada duas horas e usando o fluxo Yoosee já monitorado.

**Architecture:** O serviço Yoosee expõe um retrato JSON de saúde no socket Unix. O gateway grava estados e horários em SQLite, consulta o status iCSee pelo `CloudIdClient` já instalado a cada duas horas e inclui o estado no catálogo. A tela móvel atualiza o catálogo enquanto estiver aberta e renderiza a tarja para câmeras off-line.

**Tech Stack:** Python 3, SQLite, asyncio/Unix sockets, JavaScript ES modules, CSS, Node.js test runner.

**Spec:** `docs/superpowers/specs/2026-11-24-camera-offline-status.md`

## Global Constraints

- Consultar cada câmera iCSee a cada 7.200 segundos, serialmente, usando `CloudIdClient` sem iniciar vídeo.
- Falhas de transporte/autorização iCSee permanecem desconhecidas; apenas o resultado explícito do protocolo pode marcar off-line.
- Yoosee usa o fluxo contínuo existente e marca off-line somente após 130 segundos sem vídeo.
- Persistir `lastOnlineAt` em UTC e exibi-lo no fuso local; não expor credenciais.
- Preservar os 14 blocos protegidos de gestos de assinatura.
- Validar a implementação antes de publicar web, Google Play internal e TestFlight.

## Review Focus

- Falha geral do gateway ou socket não deve tornar todas as câmeras off-line.
- Câmera nunca vista deve exibir “Sem registro de conexão”, não uma data fictícia.
- Reinício do gateway não deve apagar o último horário on-line.
- A consulta iCSee usa o cliente já instalado, não transmite senha da câmera e não inicia FFmpeg.
- A atualização periódica da lista deve ser abortada ao fechar a tela.

## File Map

- `automations/cameras/camera_status.py`: estado SQLite e sondagens agendadas.
- `automations/cameras/gateway.py`: anexa status ao catálogo e inicializa o monitor.
- `automations/cameras/yoosee_source.py`: comando de status no socket Unix e timestamp dos pacotes.
- `automations/cameras/test_camera_status.py`, `test_gateway.py`, `test_yoosee_source.py`, `test_icsee_source.py`: regressões do servidor.
- `automations/cameras/energetico-cameras.service`: diretório persistente do SQLite.
- `apps/energetico-mobile/src/chat/chat-client.js`: normaliza metadados de status.
- `apps/energetico-mobile/src/ui/cameras-view.js` e `.css`: tarja e atualização visível do catálogo.
- `apps/energetico-mobile/tests/cameras-view.test.mjs`, `chat-client.test.mjs`: regressões da interface e contrato.
- `automations/cameras/README.md`: intervalo, armazenamento e operação.

## Tasks

### Task 1 — Status persistente e consulta iCSee

- [x] Adicionar testes para persistência, horário UTC, inicialização desconhecida, agenda de 7.200 segundos e consulta iCSee por `CloudIdClient` sem iniciar FFmpeg.
- [x] Confirmar que os testes falham pelo módulo/behavior ausente.
- [x] Implementar armazenamento SQLite e worker serial para consulta iCSee; somente `Online`/`Offline` explícitos atualizam o estado.
- [x] Executar os testes do módulo e os testes existentes do gateway/adaptador iCSee.

### Task 2 — Status Yoosee via fluxo já conectado

- [x] Testar publicação de pacotes, comando JSON de status, cálculo online/offline aos 130 segundos e erro de protocolo.
- [x] Confirmar RED; implementar retrato de saúde no socket Unix sem duplicar vídeo.
- [x] Atualizar o banco persistente do gateway com estado do Yoosee; IPC indisponível fica desconhecido.
- [x] Executar testes do gateway, fonte Yoosee e fonte iCSee.

### Task 3 — Catálogo e interface

- [x] Testar metadados do catálogo e o cartão para online/offline/unknown, datas ausentes e atualização periódica cancelável.
- [x] Confirmar RED; integrar contrato, tarja e renderização local da data.
- [x] Validar a tela em layouts mobile e desktop e executar testes focados.

### Task 4 — Operação, publicação e verificação final

- [x] Configurar `StateDirectory` e documentar consulta/IPC, sem criar dependência da API XMEye de desenvolvedor.
- [x] Rodar a trava de gestos, testes focados da interface, layout mobile/desktop e builds web/PWA/iOS; a suíte Python anterior passou, mas dois novos testes do leitor PTZ aguardam validação no CI.
- [ ] Aguardar CI da revisão, publicar web/Google Play internal/TestFlight e implantar o gateway nos dois serviços systemd com backup e health verificado.

## Completion

Registrar cada task e seus comandos/resultados em `.superpowers/sdd/2026-11-24-camera-offline-status/progress.md`. Não declarar como concluído até os três destinos móveis/web e os serviços backend terem evidência de publicação e saúde.
