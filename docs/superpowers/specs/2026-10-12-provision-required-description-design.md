# Vínculo obrigatório de novas provisões

## Pedido e escopo

Toda nova PROVISÃO PGTOS deve nascer vinculada a DESCRITIVOPROVISAO. O padrão é criar um novo descritivo primeiro. O usuário pode optar por um descritivo já pendente de pagamento. A recorrência automática também cria o descritivo antes da provisão. Não há migração retroativa de registros neste pedido.

## Situação verificada

Produção baixada por SSH em 12/10 UTC: PaymentProvisionFlow já cria/verifica pai e filhos com diário de retomada. Falta escolha de pai existente. O portal genérico cria o filho diretamente. PAGAMENTO RECORRENTE é o fluxo 637c9b22-f0b0-41cd-99cd-5998f16942ac no ambiente 200b8072-cebe-e4d7-b154-640eab964ee5; sua definição será exportada antes de alterar.

## Contrato

- Chat: oferecer NOVO DESCRITIVO (padrão) ou VINCULAR A DESCRITIVO PENDENTE, sem gravação durante composição. Seleção existente identifica ID, fornecedor, filial, vencimento e total.
- Seleção existente: pai deve existir, não estar pago nem com pagamento agendado/em execução; pode conter filhos pagos e pendentes, mas não deve ser apresentado como disponível para uma nova obrigação quando já foi encerrado. Revalidar imediatamente antes de gravação. Restringir permissões e manter metadados financeiros já existentes.
- `DESCRITIVOPROVISAO` do filho é texto com ID positivo do pai; não é lookup.
- Total do pai é soma exata de todos os filhos vinculados, inclusive pagos. `VALORTOTAL` do filho é preço unitário; soma QTD × unitário + FRETE. Não usar soma simples da coluna.
- Novo pai não marca pagamento ou agendamento: DATAPGTOEFETUADO, PGTOAGENDADO, DATAPGTOAGENDADO e DATAEXECUCAOAGENDAMENTO nulos.
- Novo pai deve ser criado/verificado antes do primeiro filho. Vínculo existente deve ser validado antes de criar filho. Usar tokens estáveis, checkpoints persistidos e comparação ETag para conflitos; não substituir dados de pagamento nem relincar filhos que já possuem outro pai.
- Retentativa recupera o mesmo pai/filho após resposta perdida; não cria duplicata nem novo pai por falha de anexos. Estado e anexos ficam congelados após início da gravação.
- Depois de anexar a pai existente, recalcular soma com consulta paginada e atualização ETag; falha retoma atualização, não criação. Não presumir transação atômica entre listas.
- Portal individual e fila usam o mesmo coordenador; edição de provisão existente permanece inalterada. Respeitar fluxos já existentes de criação seguida de baixa sem realizar pagamento de teste real.
- Power Automate: preservar recorrência, próxima data, filtros e conexão; criação parent-first e vínculo na criação do filho. Examinar outros fluxos criadores para aplicar o mesmo contrato sem reexecutar históricos.
- Nenhum teste cria obrigação fictícia em produção nem efetua baixa financeira real. Testes são com conectores fake e leitura de produção. Não alterar blocos de gestos de assinatura.

## Entrega

Testes RED/GREEN, revisão independente, pacote backend com baseline/hashes e rollback, publicação web/Windows e builds internos Android/TestFlight quando houver mudança de cliente. Abrir o app publicado e conferir a escolha nova sem confirmar gravação real. Publicação autorizada pelas instruções expressas do usuário.
