# Verificação — documentos em sequência

- Snapshot obtido da VM em 21/10/2026, sem registros nem arquivos de usuários.
- Trava de assinatura: 14 blocos intactos; não houve edição de código móvel.
- Motor e instalador: 43 testes aprovados, zero falhas, com SharePoint/mídia sintéticos.
- Testes RED/GREEN observados para modo inicial, repetição, checkpoints, reconciliação,
  isolamento dos anexos, contexto, campos dependentes, finalização e retornos.
- Navegador real: chat existente em 390 × 844 e desktop; documento único, menu de
  reaproveitamento, alteração de pessoa, tipo, novo anexo e conclusão de duas linhas.
- QA visual encontrou e corrigiu repetição de perguntas depois de finalizar o anexo.
- Revisão independente: duas falhas importantes reproduzidas/corrigidas com testes
  públicos de `WorkflowEngine.handle`: menu após conclusão e reply prefixado WhatsApp.
- Cancelamento de cadastro auxiliar de tipo preserva identidade e contexto do lote.
- Instalador: dez testes de escopo/hash/drift/backup/rollback e dependência do espelho.
- Suíte completa root/portal/app: 7.928 testes, 7.920 aprovados, oito skips de
  plataforma, zero falhas (847,6 segundos). Nenhum arquivo de produção JS foi editado.
- VM: 33 testes do motor real aprovados com fronteiras externas sintéticas; quatro
  testes Linux do gate aprovados depois de normalizar finais de linha da cópia de estágio.
- `ios:verify`, `secrets:verify` e build PWA aprovados; avisos de bundle já existentes.

## Limites da evidência

Os testes não criaram documentos na base real e não simulam garantias de consistência
do SharePoint. Um POST com resultado desconhecido permanece em reconciliação, mesmo
se o registro demorar a aparecer; não se troca segurança contra duplicidade por
reenvio automático. Checkpoints não são apagados ao encerrar a conversa.

Suíte completa e implantação são etapas separadas dos testes acima. Resultados
finais, recibo da VM, revisão integrada e publicação web são registrados na PR após
as verificações reais, não inferidos da existência do pacote. Builds nativas não
são necessárias para essa mudança de comportamento no servidor compartilhado.
