# Sincronização manual DDA

O botão da Galeria DDA chama ações fixas autenticadas no portal existente. A fila privada aceita somente a identidade explicitamente autorizada em `/var/lib/energetica-whatsapp/dda-sync/access.json`, dentro do diretório já autorizado pelo sandbox do serviço. Não recebe conta, boleto, certificado, token bancário, comando ou endereço de destino do cliente.

O Windows com o certificado consulta a fila por SSH de saída, utilizando a autorização existente. O agente não expõe porta local. Recebe somente um identificador opaco e executa o sincronizador previamente instalado. Sua resposta contém apenas estado e contagens. O certificado e o DPAPI permanecem no Windows.

## Estados e disponibilidade

O coletor atualizado inclui `createdItemIds`: somente IDs inteiros de registros cuja criação e anexo foram confirmados pelo recibo SharePoint (`matchedItems=0`). O worker e a fila conferem tipos, unicidade e quantidade, sem transportar fornecedor, valor ou código bancário. A galeria usa esses IDs com seu snapshot autorizado para o pop-up. Recibos antigos sem IDs continuam aceitos, mas não permitem inferir quais itens foram criados. A atualização do coletor privado deve instalar `Get-DdaVerifiedCreationId` e a acumulação dos IDs junto desta versão do worker. Limites:10000IDs e128KiB no recibo CLI.

Fila única com trava entre processos, identidade responsável, heartbeat de 180 segundos e limite de execução de 45 minutos. Cliques concorrentes da mesma pessoa acompanham a execução ativa. Outra identidade não lê esse pedido. Estados parcial, indisponível, expirado ou sem recibo não geram sucesso. O agente local mantém heartbeat durante a consulta e limita o subprocesso a 40 minutos.

A tarefa Windows executa a cada minuto com sessão iniciada; pode levar até um minuto para receber um pedido. O computador deve permanecer ligado. A tarefa diária 07/12/17 continua existindo. O parâmetro opcional `WaitForLockSeconds` do coletor permite aguardar uma execução diária concorrente, sem considerá-la automaticamente uma consulta nova. Fechar a galeria encerra seu acompanhamento, sem cancelar a importação em andamento.

## Instalação e verificação

1. Executar testes Python da fila e PowerShell dos recibos; testes JavaScript da consulta e galeria.
2. Estagiar `install.py`, `dda_sync.py` e `access.json` privado. O instalador confere hash dos dois fontes do bridge, compila o candidato, mantém backup e usa a trava de deploy existente.
3. Executar `--check`, depois `--deploy`. Há restauração do bridge em caso de falha de saúde.
4. Instalar agente e módulo junto do coletor privado, com `worker-config.json` contendo apenas host SSH e caminho da chave já autorizada. Nunca versionar essa configuração, chaves, arquivos DPAPI ou respostas bancárias.
5. Criar tarefa limitada à sessão do usuário, sem elevação, janela oculta, sem instâncias simultâneas. Confirmar heartbeat e pedido real completo.

Rollback: desabilitar a tarefa do agente, restaurar os dois arquivos bridge do backup e reiniciar somente `energetica-channel-bridge`. Manter a tarefa diária e os dados existentes. A fila privada pode permanecer para auditoria; não executar exclusão automática de títulos.
