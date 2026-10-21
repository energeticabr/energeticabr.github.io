# Cadastro e histórico de funcionários empreiteiros

## Revisão vigente — escolha explícita do usuário

Esta revisão substitui os trechos de importação, espelhamento, reconciliação periódica,
colunas da fonte e clonagem de permissões descritos abaixo. O usuário confirmou:
**base vazia; receber os futuros cadastros de EMPREITEIRO=SIM do app, sem importar os antigos**.

- Criar `FUNCIONARIOSRH` do zero, com esquema explícito e nenhum registro inicial.
  Não copiar registros, anexos, auditoria, esquema ou permissões de FORNECEDORES.
- O cadastro normal de fornecedor continua existindo. Para um novo cadastro com
  EMPREITEIRO=SIM e STATUS=ATIVO, usar as mesmas respostas digitadas pelo usuário e os
  mesmos arquivos locais para uma nova linha RH, após obter o ID do novo fornecedor.
  Não reler o fornecedor para preencher a base. O ID conhecido vira chave única
  `IDFORNECEDORORIGEM`, não autorização para importar funcionários anteriores.
- Manter cargo e admissão obrigatórios, uma pergunta por vez, para todo novo SIM.
  Os oito cargos continuam os definidos nesta especificação. Datas RH ficam apenas
  na nova base: não adicionar admissão/desligamento na lista FORNECEDORES.
- Todos os campos de negócio do cadastro serão definidos explicitamente na base
  nova; Title terá rótulo CADASTRO. Manter CARGO, DATAADMISSAO, DATADESLIGAMENTO,
  EMPREITEIRO, STATUS, FILIAL e a chave de vínculo como contrato estável do cliente.
- Criação incerta mantém checkpoints duráveis por cadastro e nunca repete POST sem
  comprovação. Confirmar dados e anexos do novo destino antes de anunciar sucesso.
- O corte é positivo e durável: somente um fluxo novo iniciado após esta revisão,
  com recibo da criação nova vinculado ao token, é elegível. Não atribuir elegibilidade
  na migração de sessões antigas, em IDs já submetidos ou em POST anterior retomado.
  Preservar respostas e arquivos locais até confirmar RH; perda do arquivo exige
  recuperação explícita pelo usuário, nunca cópia de anexos de FORNECEDORES.
- Não instalar timer, varredura, backfill ou `sync_all`. Mudanças em registros antigos
  de FORNECEDORES não criam linhas na nova base, nem em segundo plano.
- A galeria RH lê somente sua nova base. Cargo/admissão/desligamento são editados
  nela. Para os novos funcionários já vinculados, uma ação explícita de inativação
  pergunta desligamento e confirma STATUS nas duas linhas, com ETag e retomada segura.
  O formulário antigo pede desligamento somente quando houver vínculo RH existente;
  fornecedores antigos não vinculados mantêm o comportamento anterior e não são importados.
  A ação explícita de STATUS pode consultar somente identidade/STATUS/EMPREITEIRO/ETag
  da linha de origem vinculada para confirmar as duas gravações; isso não autoriza
  preencher campos RH a partir da origem nem varrer seus registros.
- Usar o site já utilizado pelo app e suas permissões padrão, sem concessões novas,
  ampliação de escopos ou leitura/cópia de ACLs da lista anterior. A nova lista começa
  vazia; qualquer falha real de criação/gravação deve ser reportada sem elevar acessos.
- Validar com dados sintéticos e consultas reais sem registrar funcionário fictício.
  Conferir lista vazia e galeria publicada; backend, web/Windows, Android internal e
  iOS TestFlight devem ser verificados separadamente.

## Desenho anterior — histórico, não implementar a importação abaixo

## Objetivo

Manter uma nova lista privada no mesmo site SharePoint, `FUNCIONARIOSRH`, vinculada a
`FORNECEDORES`, para os funcionários EMPREITEIRO=SIM e STATUS=ATIVO. Guardar cargo,
admissão e desligamento, sem calcular ou pagar encargos nesta entrega.

## Contrato

- Fonte permanece FORNECEDORES; todos os seus campos de negócio são espelhados sem
  reinterpretar tipos. O ID original fica em `IDFORNECEDORORIGEM` (texto único/indexado).
  Os metadados de auditoria originais e o snapshot integral ficam em colunas próprias;
  IDs e datas de auditoria do destino não fingem ser os do original. Anexos são copiados
  sem duplicar nomes existentes. A lista não é publicada anonimamente.
- A fonte e o destino terão `DATAADMISSAO` e `DATADESLIGAMENTO` (DateTime/date-only).
  CARGO já existe na fonte; reutilizar a coluna. Os oito cargos são SERVENTE DE PEDREIRO
  I/II/III, PEDREIRO I/II/III, MESTRE DE OBRAS e SUPERVISOR DE OBRAS. Manter a grafia
  correta PEDREIRO III já usada no catálogo, interpretando PERDEIRO III como erro de digitação.
- Cadastro compartilhado pergunta cargo e admissão para TODO EMPREITEIRO=SIM, uma
  pergunta por vez, independentemente de VINCULO; SIM/NÃO, vínculo e demais perguntas
  existentes continuam. NÃO não recebe nem grava as datas/cargo inaplicáveis.
- Antes da confirmação/gravação, sessões antigas precisam fornecer os novos dados;
  migrar índices de perguntas por chave, não deslocar respostas silenciosamente.
- Cadastro de ativo sincroniza imediatamente e só informa conclusão após confirmar
  a cópia. Repetição de confirmação, falha parcial ou resposta perdida não gera outro
  funcionário. Rotina periódica idempotente reconcilia atualizações da fonte, inclusive
  galerias, e os ativos já existentes. Dados antigos faltantes permanecem vazios e são
  apresentados para regularização; nunca inventar cargo ou admissão.
- Inativação na galeria solicita data de desligamento antes de salvar; data válida e
  não anterior à admissão. Cancelar não grava. Manter a linha histórica INATIVO, não apagar.
- Nova galeria FUNCIONÁRIOS RH abaixo da GALERIA DE PRESENÇAS, com busca em todos os
  registros carregados/paginados, filtros, detalhes de todos os campos e cargo/datas
  destacados. Edições de cargo/datas/status escrevem a fonte e o destino, com ETag e
  erro explícito em falha parcial; retry reutiliza o mesmo ID de origem.
- Cobrir também o formulário de fornecedor do portal para exigir desligamento ao
  passar empreiteiro para INATIVO. A rotina periódica não decide datas por conta própria.

## Arquitetura e alternativas

Usar o servidor compartilhado, com módulo isolado de sincronização e timer systemd,
mais as galerias existentes do app. Preferido a Power Automate porque integra o commit
atual e permite testes de idempotência; preferido a duplicar a fonte por cliente porque
não depende de qual plataforma cadastra. Sem ampliação de permissões, sem novas contas.
Provisionamento somente aditivo, com inspeção de esquema, dry-run e verificação.

## Segurança e entrega

Não expor dados pessoais nos commits, logs, provas ou fixtures. Não apagar registros.
Preservar blocos de assinatura. Testar com dados sintéticos e consultas reais sem
registrar funcionário fictício. Revisão independente, backup do backend, PR/merge,
servidor, web/Windows, Android internal e iOS TestFlight, confirmando cada publicação.

## Aceite

Novo empreiteiro SIM recebe oito cargos e campo de data; a cópia tem o mesmo conjunto
de dados e um único vínculo de origem. NÃO não entra na lista. Inativação pede data e
fica no histórico. A galeria aparece abaixo de Presenças em desktop e celular.
