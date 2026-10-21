# Progresso da finalização dos anexos do diário

## Intenção e escopo

Ao selecionar FINALIZAR ANEXOS no diário de obras, mostrar uma pequena etiqueta
de 0% a 100% junto ao spinner do cartão atual. Preservar mascote, texto, demais
fluxos e bandeja. Publicar web/Windows, Android interno e TestFlight.
Execução direta autorizada pelas instruções permanentes do usuário.

## Desenho

A montagem/compressão acontece sincronamente na VM. Acrescentar telemetria
opcional, em memória e isolada por autoridade Microsoft, usuário e messageId.
Usar tenant quando fornecido; o autenticador atual verifica Graph /me e retorna
oid sem tid, portanto usar o namespace fixo dessa autoridade nesse caso. A mesma chamada
de finalização continua sendo a única mutação; consultas de progresso não
reenviam arquivos, não executam o fluxo e não adquirem o lock da conversa.
Uma ContextVar conecta o pedido HTTP ao processamento das imagens, sem estado
compartilhado no builder. Expirar registros e limitar sua quantidade.

O percentual representa etapas concluídas, não tempo decorrido: 0 ao iniciar,
até 75 durante renderização das fotos, 80 ao gerar o PDF, 90 ao consolidar e
até 99 na conclusão. Recompressões/mesclagens não fazem o indicador regredir.
100 somente após resposta válida que confirme sucesso da finalização.
Arquivos indisponíveis, falhas e resposta incerta nunca confirmam 100.

O cliente consulta uma vez por segundo, sequencialmente, enquanto a mesma
requisição/sessão estiver ativa. Descartar respostas atrasadas e abortar
consultas ao terminar/sair. Servidor antigo ou falha da telemetria não impede
a resposta principal; a indicação permanece no último avanço confirmado.
UI acessível, percentual numérico validado, sem alterações nos blocos de
gestos protegidos. Não gravar nomes/arquivos nos registros de telemetria.

## Validação

Testar isolamento, expiração, monotonicidade, simultaneidade e caminho real
do builder; cliente com resposta pendente e falhas; controller com fluxo
diário e outros fluxos; renderização 0/37/100 e badge próximo ao spinner.
Rodar suítes, builds e trava de assinatura; revisar, atualizar VM com backup
e rollback, merge e verificar publicações efetivas da mesma revisão.
