# Busca fiscal manual durável

O portal usa sua identidade Microsoft já autenticada. Este módulo aceita somente
`sefaz_refresh` e `sefaz_refresh_status` e devolve o envelope `sefazRefresh`.
O hook executa depois de `_portal_identity()`, reutilizando a autenticação Graph
e a política corporativa existente do portal (membro, domínio autorizado e OID).
Cada usuário autorizado pode solicitar a coleta e lê somente seus próprios
pedidos. Nenhum cliente pode enviar identidade, empresa, certificado, URL ou
comando. Não existe uma segunda lista de acesso DDA; o instalador não altera
perfis, permissões SharePoint nem a política de autenticação do aplicativo.

## Portal

```json
{"action":"sefaz_refresh","requestId":"0123456789abcdef0123456789abcdef"}
{"action":"sefaz_refresh_status","requestId":"0123456789abcdef0123456789abcdef"}
{"action":"sefaz_refresh_status","mode":"pending"}
{"action":"sefaz_refresh_status","requestId":"0123456789abcdef0123456789abcdef","acknowledge":true}
```

IDs e aliases são idempotentes. Pedidos ativos do mesmo usuário são agrupados;
outros usuários autorizados têm pedidos separados, consumidos sequencialmente.
Pendências e resultados continuam no servidor após fechar o aplicativo. Somente
o reconhecimento explícito retira o resultado da lista pendente. Registros de
idempotência e recibos não reconhecidos não são descartados automaticamente.

As três fontes fixas `NFE`, `CTE` e `NFSE` devolvem `status`, `documents` opcional,
`code` opcional e `nextAllowedAt` opcional. Contagens significam documentos
processados, nunca quantidade de novas notas. Sucesso depende das três fontes;
mistura de sucesso e falha é `partial`. Espera fiscal permanece `waiting`.

## Protocolo Windows

Executar via SSH de saída, como **energetica-whatsapp**, com Python e caminho
fixos. Não executar a fila como root: seus arquivos privados pertencem ao serviço.

```
sudo -n -u energetica-whatsapp /opt/energetica-whatsapp/.venv/bin/python /opt/energetica-whatsapp/sefaz_sync.py heartbeat
```

Operações CLI: `heartbeat`, `claim`, `renew`, `progress`, `complete`.
Somente as três últimas recebem JSON por stdin (limite de 64 KiB):

- `claim`: retorna `job:null`, ou recibo público acrescido de `leaseToken`
  (64 caracteres hexadecimais minúsculos) e `leaseUntil` ISO.
- `renew`: `{requestId,leaseToken}` renova a reserva de 20 minutos.
- `progress`: `{requestId,leaseToken,source,result}` persiste o resultado de uma
  fonte. Não libera a reserva; permite consultar as demais fontes na mesma rodada.
- `complete`: `{requestId,leaseToken}` encerra a rodada e libera a reserva.
  O servidor calcula o estado agregado; não aceita uma alegação de sucesso geral.

`progress` e `complete` retornam `{ok:true,job:<recibo público>}`. `renew` retorna
`{ok:true,leaseUntil}`. Repetições de resultados idênticos são aceitas; uma fonte
terminal não pode regredir. Token substituído é recusado. Fontes concluídas são
preservadas na retomada. Pedido aguardando somente fontes com datas futuras não
é reservado. Ausência de heartbeat informa indisponibilidade, mas não apaga o
pedido nem ignora cooldown. Após 24 horas, fontes ainda incompletas encerram com
falha explícita, preservando os sucessos e as contagens confirmadas.

O worker deve persistir seu recibo local antes de enviá-lo; se perder a resposta,
reenvia o recibo em vez de repetir a consulta fiscal. A confirmação de entrega
continua vindo do coletor/Power Automate; este módulo não consulta governo,
SharePoint ou WhatsApp e não armazena XML, notas, tokens ou certificados.

## Verificação e instalação

```powershell
& "$env:LOCALAPPDATA/Energetica/Runtime/FiscalPdf/Scripts/python.exe" -m unittest discover -s backend-patches/sefaz-manual-sync -p 'test*.py'
```

O instalador é específico para os dois bridges cujo SHA-256 atual foi conferido
por leitura da VM. Faz backup, instala sob a trava de deploy existente e verifica
a saúde do serviço, restaurando o bridge em caso de falha. Recusa drift, instalação
duplicada, permissão inesperada ou ausência da autenticação antes do hook. Preserva todos os
dados fiscais, tarefas e diretórios já existentes.

Após revisão, copiar `install.py` e `sefaz_sync.py` para staging privado e executar
`sudo python install.py --check`, depois `--deploy`. Verificar a rota autenticada
de pendências e o worker real separadamente; saúde HTTP não prova coleta fiscal.

Rollback: desativar apenas a tarefa manual, restaurar os dois bridges do backup,
reiniciar `energetica-channel-bridge` e verificar `/health`. Preservar a fila
privada para auditoria e os agendamentos fiscais existentes.
