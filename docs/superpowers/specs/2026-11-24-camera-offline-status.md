# Estado on-line/off-line das câmeras

## Objetivo

Mostrar, em cada cartão de câmera, quando ela está off-line e a data/hora local da última imagem recebida. O mesmo status funciona na web, Android e iOS.

## Comportamento

- O catálogo retorna `status` (`online`, `offline` ou `unknown`) e `lastOnlineAt` em UTC, sem expor credenciais nem identificadores adicionais.
- iCSee é consultado no servidor a cada 7.200 segundos por câmera pelo `CloudIdClient` já instalado. A consulta usa o protocolo de status sem iniciar vídeo, sem FFmpeg e sem senha da câmera; falhas de transporte resultam em `unknown`, não em falso off-line.
- Yoosee usa a fonte contínua que já mantém o vídeo recebido. O gateway consulta o estado por IPC local e considera a câmera off-line somente após 130 segundos sem pacote de vídeo. Nenhuma segunda transmissão de vídeo é aberta.
- O servidor persiste o último horário on-line em SQLite. Para iCSee, o horário é a última consulta que confirmou `Online` (precisão de até duas horas); para Yoosee, é a chegada do último pacote de vídeo. Falha do serviço/IPC resulta em `unknown`, preservando o último horário conhecido.
- A lista atualiza os status enquanto permanece aberta. Para status `offline`, o cartão mostra tarja OFF-LINE e o horário local da última conexão; sem histórico mostra “Sem registro de conexão”.
- A consulta usa apenas a infraestrutura e as credenciais já configuradas; não depende da API de status XMEye com credenciais de desenvolvedor.

## Abordagem

Usar o `CloudIdClient` do cliente iCSee já instalado para consultar o estado sem transmissão de vídeo ou credenciais de desenvolvedor adicionais. Para Yoosee, usar um comando JSON pequeno no socket Unix existente para consultar o fluxo que já está conectado, sem duplicar os pacotes. Um armazenamento SQLite no diretório de estado do serviço preserva os horários entre reinícios.

## Limites

O status iCSee pode ficar desatualizado por até duas horas. A consulta usa tráfego leve de status com os serviços do fabricante. “Off-line” é informado pelo protocolo do iCSee; falhas de transporte são mostradas como “status desconhecido”.
