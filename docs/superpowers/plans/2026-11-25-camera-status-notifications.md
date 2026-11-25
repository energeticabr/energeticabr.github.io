# Camera Status Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alertar o usuário sobre transições confirmadas off-line/on-line das câmeras, gratuitamente, em Android, iOS e web/Windows.

**Architecture:** O gateway registra cada transição confirmada em uma fila SQLite e expõe eventos via a API de câmeras autenticada. O app consulta a fila enquanto a sessão está ativa, guarda um cursor por conta e usa notificações locais ou do navegador; eventos durante o encerramento são recuperados quando o app voltar.

**Tech Stack:** Python 3, SQLite, servidor HTTP atual, JavaScript ES modules, Capacitor Local Notifications e Browser Notifications.

**Spec:** `docs/superpowers/specs/2026-11-25-camera-status-notifications-design.md`

## Global Constraints

- Registrar somente transições `online`↔`offline`; estados `unknown`, valores repetidos e a leitura inicial não notificam.
- Preservar o último estado confirmado através de leituras `unknown`; o próximo `online`/`offline` pode gerar a transição correta.
- Produzir eventos por canal e incluir o rótulo do canal, sem agregar estados de uma câmera multi-canal.
- Reutilizar SQLite, bearer token, validação de conta e plugin já instalado; não adicionar serviço ou tarifa.
- Consultar eventos a cada 60 segundos durante a sessão ativa e recuperar os pendentes ao voltar ao app.
- Sem push remoto configurado, o app pode ser suspenso em segundo plano; eventos chegam após retomar o primeiro plano ou abrir novamente.
- Não expor credenciais nem alterar os blocos de gestos de assinatura.

## Review Focus

- Uma falha de API/IPC resulta em `unknown` e não cria evento de desconexão; a proteção permanece no monitor atual e deve continuar coberta pelo CI.
- Canais diferentes da mesma câmera geram avisos com os próprios nomes; o estado de outro canal não mascara a queda.
- Um cursor ausente estabelece a linha de base; cursor parcial avança somente após tentativa de notificação e lote incompleto continua sendo consultado.
- Recriação/restauração da fila SQLite muda a geração ou reduz o maior ID; o cliente estabelece nova linha de base para ambos os casos.
- Logout, expiração de sessão e suspensão do app não vazam eventos entre contas nem mantêm timers órfãos.
- Permissão negada ou API de notificação indisponível não bloqueia login nem consulta do catálogo.

---

### Task 1: Persistir e disponibilizar transições no gateway

**Files:**
- Modify: `automations/cameras/camera_status.py`
- Modify: `automations/cameras/gateway.py`
- Modify: `automations/cameras/README.md`
- Existing CI coverage: `automations/cameras/test_camera_status.py`, `automations/cameras/test_gateway.py`

**Interfaces:**
- `CameraStatusStore.update(channel_id, status, *, checked_at=None, last_online_at=None)` grava mudança e evento atomicamente, comparando o estado confirmado.
- `CameraStatusStore.events_after(cursor, limit=100)` devolve eventos ordenados, cursor final e geração da fila.
- A ação autenticada `status-events` recebe `after` inteiro opcional e devolve `{events, cursor, generation}`; sem `after`, devolve fila vazia como linha de base.

- [ ] Acrescentar tabela append-only de eventos, transação de estado e gravação de apenas `online`↔`offline`.
- [ ] Preservar estado confirmado através de `unknown`; gravar eventos pelo ID público do próprio canal.
- [ ] Validar cursor/lote e adicionar a ação HTTP sob `gateway.authorize`.
- [ ] Atualizar README quanto à fila e ao limite sem push remoto.
- [ ] Validar sintaxe Python e execução/saúde do serviço no servidor após publicação.

### Task 2: Consumir e apresentar notificações multiplataforma

**Files:**
- Modify: `apps/energetico-mobile/src/chat/chat-client.js`
- Create: `apps/energetico-mobile/src/chat/camera-status-notifications.js`
- Modify: `apps/energetico-mobile/src/native/native-ports.js`
- Modify: `apps/energetico-mobile/src/app-controller.js`
- Existing CI coverage: `apps/energetico-mobile/tests/chat-client.test.mjs`, `native-ports.test.mjs`, `app-controller.test.mjs`

**Interfaces:**
- `listCameraStatusEvents({after, signal}) -> {events, cursor, generation}` valida o esquema, a geração e o limite.
- `createCameraStatusNotifications({listEvents, notify, storage, intervalMs})` oferece `start(accountKey)`, `poll()`, `stop()`.
- Portas nativas oferecem `requestCameraStatusNotificationPermission()` e `notifyCameraStatus(event)`.

- [ ] Normalizar evento, cursor e datas sem confiar em dados recebidos.
- [ ] Implementar cursor/geração local por conta, linha de base inicial, consulta serial e avanço após cada notificação.
- [ ] Implementar solicitação de permissão na ação de abrir Câmeras e notificações Android/iOS/web.
- [ ] Iniciar no login apenas se já habilitado; ativar na primeira abertura de Câmeras; parar no logout/stop e consultar imediatamente ao voltar ao primeiro plano.
- [ ] Validar trava dos gestos, suíte de CI e builds web, Android e iOS.

### Task 3: Implantar e confirmar os destinos

**Files:**
- Publicar a revisão pelo GitHub e verificar os serviços instalados.

- [ ] Manter intacta e fora do commit a alteração local preexistente em `automations/cameras/icsee_source.py`.
- [ ] Abrir/mesclar PR depois das verificações aprovadas pelo CI.
- [ ] Verificar deploy Pages, Google Play internal e TestFlight da mesma revisão.
- [ ] Atualizar o gateway no servidor com backup, reinício controlado e health dos serviços.
