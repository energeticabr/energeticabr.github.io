# Verificação da revisão futura e bloqueio de provisionamento

## Escopo vigente

O usuário confirmou FUNCIONARIOSRH vazia, somente futuros cadastros SIM/ATIVO.
Não importar dados, anexos, esquema, auditoria ou permissões de FORNECEDORES.
Não instalar timer/backfill nem criar colunas RH na origem. A restrição antiga de
leitura de ACL não é dependência desta revisão.

- Cargo com oito opções e admissão são perguntados uma etapa por vez para novo SIM.
- O destino recebe respostas e bytes locais, nunca cópias lidas da origem.
- Prova durável de novo fluxo e recibo congelado antes do primeiro POST impedem
  importar retroativamente sessões antigas, retomadas e IDs históricos.
- Criação incerta não autoriza outro POST. Reenvio idêntico preserva nomes e ordem
  congelados, inclusive após reinício; bytes/nome/multiplicidade distintos são recusados.
- Galeria abaixo de Presenças lê somente o destino e mostra estado vazio explícito.
- Cargo/datas pertencem ao destino. Inativação explícita de funcionário vinculado
  exige desligamento e confirma STATUS na origem/destino com ETags/checkpoints.
  EMPREITEIRO=NÃO não contorna a exigência. Antigos sem vínculo não são importados.
- Sem cálculos de folha, INSS ou FGTS nesta entrega.

## Evidência de código

- Backend direcionado: 77 aprovados, zero falhas, execução independente.
- Revisão independente encerrada: nove testes de recuperação com WorkflowEngine,
  LocalMediaRepository, LocalStateStore e SharePointClient reais, HTTP sintético.
  Um POST por lista, arquivos preservados, nenhum download da origem.
- Revisão cliente encerrada: 54 testes aprovados; implementador executou 65,
  incluindo EMPREITEIRO=NÃO/INATIVO combinados e alteração em duas etapas.
- Root/portal final: 1.124 aprovados, seis skips, zero falhas.
- Suíte móvel final após a última correção: 6.762 aprovados, dois skips, zero falhas,
  6.764 totais, 797278ms. Não confundir com contagens do desenho substituído.
- Guard de assinatura: 14 regiões preservadas; git diff --check sem erros.
- Galeria vazia/bloqueio de desligamento ausente verificados com fixture sintética.
  Nenhum funcionário fictício ou pagamento real criado/alterado para QA.
- pytest indiscriminado na raiz encontrou 41 erros de coleta em pacotes históricos
  com ambientes/namespaces distintos; nenhum teste executado nessa chamada.
  Não é apresentado como suíte verde.

## Pacote revisado, ainda não instalado

Manifesto SHA-256:
`573fed76df20d654e39ed32e67e81d89fe8587523551906f5bacd294e78466bc`.

Exatamente quatro arquivos: worker/workflow.py, worker/workflow_config.json,
worker/contractor_employment.py, worker/supplier_registration_checkpoint.py.
Hashes locais/staging remoto conferidos. Nenhum deploy/restart/ativação desta revisão.

## Bloqueio atual: criar a nova lista

Plano GET confirmou destino ausente e 28 ações aditivas. Uma única tentativa autorizada
de provisionamento retornou "Target list creation uncertain; rerun read-only plan".
GET posterior confirmou novamente exists:false. Checkpoint create_pending preservado;
nenhum novo POST tentado. A exceção original foi suprimida pelo provisionador:
não atribuir à tentativa um código HTTP que não foi registrado.

Diagnóstico GET da MESMA credencial de serviço:

- Token com papel Sites.Selected; nenhum token divulgado.
- web/EffectiveBasePermissions: High 66224, Low 1008964335.
- Low & 0x800 == 0: falta ManageLists para criar listas/colunas.
- Lista ausente, nenhum item RH escrito, nenhuma mudança na lista anterior.
- Sem concessões, novos escopos, troca de identidade ou alteração de ACL.

É necessária ação de administrador para criar a estrutura vazia ou autorizar a
permissão apropriada no site. Não ampliar privilégios autonomamente. Não mesclar,
ativar ou publicar como funcional antes de confirmar a lista real, 27 campos
explícitos, anexos habilitados e contagem zero. Preservar os dados existentes.

Referências: [Manage Lists](https://learn.microsoft.com/en-us/sharepoint/understanding-permission-levels)
e [máscara 0x800](https://learn.microsoft.com/en-us/openspecs/sharepoint_protocols/ms-wssfo3/1f5e3322-920f-431c-bbc4-7f65c477e698).

## Vencimentos: outra solicitação concluída

PRs #554/#555 integradas em 47f1428393e8c7bbbac7564d899e1af253258596.
Pages 39527486048 success e ativo HTTP200; Android 39527486125 success,
1.0.1400/code1400, artefato e commit interno confirmados; iOS 39527485977 success,
build1704 enviado/associado ao grupo ENERGETICO Validacao.

Editar vencimento do descritivo atualiza DATA PREVISTO PGTO de todas as vinculadas
sem mudar STATUS/data de pagamento efetuado. Essa entrega não depende da base RH.
