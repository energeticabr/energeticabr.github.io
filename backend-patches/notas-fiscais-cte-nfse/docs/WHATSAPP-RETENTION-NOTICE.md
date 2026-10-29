# Aviso de retenção após o PDF

Para novas notificações no NOVO DDA, a sequência por documento é texto → PDF → aviso de retenção, quando houver valor positivo declarado para o comprador. Cada etapa depende da confirmação da anterior; a próxima nota aguarda a confirmação do aviso. O texto é `*ATENÇÃO : ESSA NOTA GEROU RETENÇÕES NO VALOR DE R$ XX,YY*` (negrito no WhatsApp).

Os dados vêm do XML validado, nunca de metadados enviados pelo cliente ou da diferença entre total e líquido. NF-e usa os componentes de `total/retTrib` e `total/ISSQNtot/vISSRet` quando a Energética é destinatária. NFS-e nacional usa os componentes retidos federais e ISSQN retido pelo tomador, somente quando a Energética é tomadora. O agregado `vRetCSLL` já inclui PIS/COFINS/CSLL; `vPis`/`vCofins` não são somados. `vTotalRet` é somente um limite de consistência, pois pode incluir retenção de outro responsável. Tributos próprios do CT-e não são inferidos como retenção.

Referência: [NT007 NFS-e, páginas 4–6](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-007-se-cgnfse-v1-0.pdf). A regra acompanha os componentes de retenção já usados na galeria, sem recalcular obrigação tributária.

A tabela complementar `sefaz_notification_retention` preserva valor, mensagem e identificador da fila. A tabela de notificações existente mantém suas 12 colunas. Notas já enviadas e a linha de base não são reabertas, e a implantação não envia mensagens históricas ou de teste.

Antes de `--deploy`, pausar os três disparadores fiscais Windows, aguardar as execuções terminarem e confirmar ausência de chamadas antigas ao dispatcher; o bloqueio SQLite sozinho não impede código já carregado. Restaurar os estados anteriores das tarefas após a troca, com restauração automática limitada a dois minutos como proteção operacional.

Validar `test_sefaz_whatsapp_dispatch.py` e os testes PowerShell de WhatsApp. Instalar primeiro a compatibilidade `retention_queued` no runtime Windows usando o instalador unificado. No servidor, estagiar módulo, testes, `fiscal_document.py` compatível e manifesto com hashes anterior/novo; executar testes isolados e `Install-WhatsAppRetention.py STAGE` (somente verificação), depois `--deploy`. O instalador exige fila fiscal sem pendências, salva o código anterior e preserva o histórico. Não é necessária atualização de tela ou novo pacote móvel: a mensagem é gerada no servidor para WhatsApp Android, iOS e Windows.
