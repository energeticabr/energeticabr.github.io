# Provisões sempre vinculadas — plano

Spec: docs/superpowers/specs/2026-10-12-provision-required-description-design.md

## Global Constraints

Toda nova provisão tem descritivo. Padrão novo, opção existente pendente. Pai primeiro, filho com ID textual positivo. Soma QTD × preço unitário + FRETE, todos os filhos. Não sobrescrever pagamento/agendamento, não relincar, não duplicar em retentativas. Nenhuma migração retroativa nem obrigação fictícia em produção. Não alterar gestos de assinatura. Publicar quando aplicável em web/Windows, Android interno e TestFlight.

## Task 1: Chat/VM — escolha e persistência

Trabalhar no candidato privado artifacts/provision-required-description-20261012/candidate, copiado da baseline recém-baixada. Alterar worker/payment_provision_flow.py, novo worker/provision_parent_choice.py se necessário, integrações mínimas em workflow.py e channel_bridge.py. Não alterar outros recursos.

Interfaces: PROVISION_STAGES/PROVISION_STATE_KEYS controlam escolhas persistidas, PaymentProvisionFlow controla commit; cliente existente fornece listagem paginada e operações ETag. Sem exigir tela nativa nova: renderizador de opções atual atende chat.

1. Adicionar testes de escolha NOVO/EXISTENTE e invariantes: pai pago/excluído/alterado, ausência de ETag, totals mistos pagos/pendentes, composição sem writes, respostas perdidas pai/filho, anexos/retry, rascunhos antigos com vínculos conflitantes. Rodar antes da implementação: Expected FAIL pelo comportamento ausente.
2. Implementar seleção, validação autoritativa, congelamento e atualização de total verificável com ETag. Preservar tokens e retomada antiga, evitando pai órfão por vínculo já existente.
3. Rodar novos testes e testes existentes de criação/anexos/agrupamento/bridge. Expected todos focados PASS. Comparar suíte ampla com baseline sem esconder falhas antigas. Reportar comandos/outputs RED/GREEN e arquivos exatos. Não acessar VM, Power Automate, browser nem publicar. Não subdelegar.

## Task 2: Power Automate — criação parent-first

Controller local: exportar backup e ler definição de PAGAMENTO RECORRENTE. Identificar ações de criação e list GUIDs/campos reais. Examinar CRIAR PROVISAO PGTOS POWERAPPS, CRIAR PREVISAO PGTO, receita/impostos e locação para identificar criadores ainda ativos.

1. Salvar cópia original privada e criar testes de definição para pai antes de filho, link string ID, próxima data só após child, repetição/concorrência sem criação duplicada. Expected teste estrutural/contrato FAIL antes da mudança.
2. Alterar somente criadores necessários: pai com dados correspondentes/total correto, filho com vínculo e dependência correta. Conservar seleção existente quando fornecida e validar pai. Preservar conexão e agenda; salvar e validar checker/reexport/releitura.
3. Expected definição publicada comprovável, habilitada e sem erros checker. Não reexecutar runs financeiros antigos. Documentar limite se ferramenta não permitir a alteração segura.

## Task 3: Portal — coordenador obrigatório e escolha

Alterar portal/forms/entity-submit.js, novo portal/forms/provision-parent-workflow.js, hooks focados em portal/ui/entity-page.js e testes. Somente criação provisões; edição/generic outros tipos intacta. Usar campos internos reais, referência resolvida e checkpoint preservado no retryState. Oferecer novo descritivo ou existente pendente no formulário.

1. Testes FAIL: default pai-first, seleção válida/inválida, paid/changing parent, fila, resposta perdida/checkpoint, anexos repetidos, soma exata, edição intacta.
2. Implementar coordenador e seleção com revalidação, ETag e verificação. Nenhuma gravação antes de submeter. Não criar pai em cada retry quando child já salvo.
3. Rodar testes provision-parent-workflow e powerapps-form-attachments; Expected PASS. Testes completos portal e mobile/guard/build antes de merge.

## Task 4: Revisão e implantação

Revisão de tarefa e revisão integral independente com foco em mutações/conflitos concorrentes, checkpoints e recuperação de resposta perdida, somatório sem preço nulo mascarado, compatibilidade antiga e nenhum vazamento de dados. Resolver importantes com RED/GREEN.

Empacotar patch backend e hashes produção/espelho. Antes de deploy conferir drift, salvar backup recuperável, instalar com rollback e reiniciar/conferir saúde. Rodar testes Python 3.9 da VM sem efeitos reais. Expected hashes pós iguais ao candidato, serviço active/health ok.

## Task 5: Publicação e conferência

Merge autorizado após revisão/testes. Publicar web/Windows e versões nativas internas se cliente mudou. Expected workflows sucesso e Play internal/TestFlight válido/anexado. Abrir app e ver nova escolha sem submeter dados reais. Preservar evidências e avisar qualquer etapa não concluída.
