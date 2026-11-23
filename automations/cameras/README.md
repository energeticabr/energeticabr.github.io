# Câmeras no Energético

O aplicativo lista os canais disponíveis para o usuário autenticado. A API consulta o Microsoft Graph com a sessão do Energético e confere o ID da conta contra a lista de visualizadores. O serviço mantém até três transmissões simultâneas sob demanda, compartilhando esse limite entre usuários. Cada sessão de vídeo vence em 20 minutos ou é encerrada após 12 segundos sem pedidos. O uso simultâneo deve ser validado com as fontes reais e com os limites do servidor antes do deploy.

Instale `gateway.py`, o adaptador da fonte e seus runtimes em `/opt/energetico-cameras`. A unidade systemd lê o arquivo privado `/etc/energetico-cameras/cameras.json` por meio de `LoadCredential`. O proxy HTTPS deve enviar somente `/api/portal-cameras` e `/api/portal-camera-media/*` para `127.0.0.1:8872`. Remova o caminho de mídia dos logs de acesso do proxy, pois ele contém uma chave temporária de reprodução.

O JSON tem os campos `viewers` (IDs dos usuários no diretório), `origins` (origens HTTPS e Capacitor autorizadas), `ffmpeg` (caminho absoluto, com libx264), e `channels`. Cada canal define `id`, `label`, `format` (`hevc`, `h264` ou `mpegts`), `command` (lista de argumentos com executável absoluto), e opcionalmente `input` (JSON recebido pelo processo via stdin). A fonte escreve somente o fluxo de vídeo no stdout. As credenciais ficam no arquivo privado.

O adaptador iCSee utiliza a interface do cliente `xmplayer` instalado separadamente. Configure `PYTHONPATH` para apontar para essa instalação e para suas dependências, com Python 3.11 ou superior para o adaptador. O diretório do cliente precisa conter `desktop_monitor.json` e o diretório `screenshots` criado previamente. O campo `input` inclui `cloudId`, `username`, `password`, `channel` (índice a partir de zero), e `tlsPins` (`status` e `relay`, SHA-256 dos certificados aprovados). Se o fornecedor trocar um desses certificados, valide o novo certificado antes de atualizar o pin. Uma fonte compatível com o mesmo contrato pode ser usada para outros fabricantes.

O adaptador iCSee aceita comandos curtos de movimento somente durante uma sessão ao vivo. O histórico é consultado por data no armazenamento da própria câmera; cada item recebe uma identificação temporária vinculada ao usuário e ao canal, e o caminho original não é enviado ao aplicativo. A capacidade de movimento e a existência de gravações dependem de cada dispositivo.

Execute `python -B -m unittest discover -s automations/cameras -v` para testar a autorização e as rotas.
