# Notificações de mudança de estado das câmeras

## Intenção

Avisar o usuário quando uma câmera conhecida mudar de on-line para off-line ou voltar de off-line para on-line, sem repetir avisos em cada sondagem e sem adicionar um serviço pago.

## Objetivos e limites

- Registrar transições confirmadas por canal junto do estado atual no SQLite do gateway. Ignorar `unknown`, a leitura inicial e atualizações repetidas do mesmo estado.
- Servir uma fila autenticada de eventos por meio da API de câmeras existente. Um cursor por conta e aparelho evita duplicação e permite recuperar eventos depois que o app volta a funcionar.
- Com o app ativo, consultar a fila a cada minuto e apresentar notificação local no Android/iOS e de navegador na web/Windows. Pedir permissão quando o usuário abrir Câmeras e consultar imediatamente ao voltar ao primeiro plano.
- Acompanhar todas as câmeras no período em que o app estiver ativo, sem exigir que a tela de câmeras permaneça aberta.
- iCSee: a cada duas horas, consultar uma vez por gravador o status CloudId; se o gravador estiver on-line, sondar os canais individualmente com uma prévia temporária de 384 px/6 fps, encerrada no primeiro segmento e limitada a 45 segundos. Um timeout isolado não é queda; dois timeouts consecutivos em rodadas separadas por duas horas confirmam ausência de vídeo. Falha de processo, falta de capacidade ou transmissão em inicialização reinicia a sequência.
- Yoosee: reutilizar o fluxo de vídeo ativo e seus pacotes recentes; não iniciar uma segunda transmissão só para medir status. Só considerar o observador confiável após vídeo ou `STATE_PLAY`; falha do próprio pipeline resulta em desconhecido.
- Não instalar FCM, APNs, servidor de Web Push ou outra dependência externa. Sem push remoto, eventos ocorridos enquanto o app estiver totalmente encerrado serão notificados na próxima abertura, não em tempo real.
- A primeira habilitação estabelece o cursor atual e não transforma o estado já existente em uma notificação nova. Se o armazenamento do cursor for perdido, o próximo início estabelece uma nova linha de base. A tarja atual continua mostrando câmeras que já estejam off-line.

## Abordagens consideradas

1. Comparar o catálogo apenas enquanto a tela de câmeras está aberta: simples, mas deixa de observar transições fora dessa tela e perde alterações intermediárias.
2. **Fila durável no gateway e consulta pelo app ativo (escolhida):** registra todas as transições confirmadas, entrega avisos uma vez por cursor e custa apenas consultas leves à infraestrutura existente. Recupera eventos ao reabrir o app, mas não consegue despertar um app encerrado.
3. Push remoto via FCM/APNs/Web Push: poderia alertar com o app encerrado, mas não há configuração nem credenciais de push no projeto. Exigiria configuração adicional externa; fica fora deste trabalho.

## Arquitetura

O `CameraStatusStore` gravará, na mesma atualização SQLite do estado, uma linha de evento quando o último estado confirmado e o novo estado forem opostos (`online`/`offline`). Uma sondagem `unknown` não apaga o último estado confirmado e não gera evento. Eventos são por canal para não declarar a câmera inteira indisponível quando outro canal dela ainda funciona. No iCSee, o status CloudId é consultado a cada duas horas por gravador; quando o gravador responde on-line, cada canal recebe sua própria verificação com um fluxo temporário em baixa resolução, sem ocupar uma vaga se a grade estiver cheia. Um timeout isolado de 45 segundos não confirma queda; o canal só fica off-line após dois timeouts consecutivos, em rodadas separadas por duas horas. Falha de processo, falta de capacidade ou uma transmissão ainda em inicialização reiniciam essa sequência. O relógio da verificação é persistido separadamente dos pedidos normais de vídeo, e uma observação atrasada não pode substituir estado mais recente de vídeo ao vivo. As sondagens iCSee ficam em uma thread própria para manter a observação Yoosee a cada 30 segundos. No Yoosee, o serviço observa os pacotes do fluxo já usado para reprodução e não abre outra sessão. O observador só se considera confiável após vídeo ou `STATE_PLAY`; falha no login ou na inicialização não pode manter confiança antiga. O gateway expõe uma nova ação da API, autorizada pelo mesmo bearer token e pela mesma lista de visualizadores, entregando até 100 eventos por consulta. Sem cursor, a resposta é uma linha de base vazia com o maior ID atual e a geração do banco. O cliente avança após cada notificação; se a geração do banco mudar ou o maior ID ficar abaixo do cursor local, estabelece nova linha de base para não ficar preso a um cursor antigo.

O cliente normalizará o retorno e um observador ligado à sessão autenticada buscará eventos a cada 60 segundos enquanto o processo estiver ativo, com consulta imediata ao retomar. O primeiro retorno define o cursor-base; retornos seguintes enviam uma notificação por evento. O cursor e a geração são isolados por conta no armazenamento local. Se uma notificação falhar ou a permissão não estiver concedida, o cursor daquele evento fica pendente para nova tentativa. A permissão é solicitada a partir da abertura da tela Câmeras. O app interrompe a observação no logout e a retoma na sessão seguinte. Android/iOS podem suspender o processo em segundo plano; os eventos desse período, como os ocorridos enquanto o app está encerrado, são apresentados quando o app voltar ao primeiro plano.

## Compatibilidade e texto

- Android/iOS Capacitor: `@capacitor/local-notifications`, entregue imediatamente com identificador derivado do evento.
- Web/Windows PWA: API `Notification` em HTTPS, respeitando a permissão concedida.
- Off-line: título “Câmera off-line” e nome/canal da câmera com horário da mudança.
- Retorno: título “Câmera on-line” e nome/canal da câmera com horário da mudança.
- Sem permissão ou enquanto o processo não está ativo, os eventos ficam sem aviso imediato; quando o app reabrir com permissão já concedida, a fila pendente será processada.

## Alterações previstas

- `automations/cameras/camera_status.py`: tabela e leitura ordenada de transições persistentes por canal, geração da fila, cadência por gravador/canal.
- `automations/cameras/gateway.py`: rota autenticada `status-events`, validação do cursor e prévias temporárias iCSee para sondagem individual.
- `automations/cameras/yoosee_source.py`: status a partir do fluxo ativo Yoosee, diferenciando observador indisponível de vídeo recente.
- `apps/energetico-mobile/src/chat/camera-status-notifications.js`: prazo para consulta remota e cancelamento de consulta ao suspender o app, sem interromper uma notificação já em entrega.
- `automations/cameras/test_camera_status.py`, `test_gateway.py`: cobertura de transições, cursor e autorização no CI.
- `apps/energetico-mobile/src/chat/chat-client.js`: contrato de listagem de eventos.
- `apps/energetico-mobile/src/chat/camera-status-notifications.js`: observação periódica, persistência de cursor e deduplicação.
- `apps/energetico-mobile/src/native/native-ports.js`: solicitação de permissão e apresentação nativa/web.
- `apps/energetico-mobile/src/app-controller.js`: ativação após login/abertura de Câmeras, ciclo de vida e limpeza no logout.
- `automations/cameras/README.md`: funcionamento e limite de notificações sem push remoto.

## Decisões restantes para implementação

Usar lote pequeno e ordenado (até 100 eventos por consulta), linha de base explícita sem cursor, geração persistente para detectar recriação do banco, avançar apenas após cada tentativa de notificação e tolerar ausência de armazenamento ou de permissão sem interromper o app. Não armazenar tokens de push nem dados de credencial de câmeras.
