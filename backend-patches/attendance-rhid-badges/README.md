# Indicadores RHID na validação de presenças

O seletor existente de presenças recebe indicadores de leitura após o nome do
fornecedor. O indicador não preenche nem submete o campo `PRESENCA`.

- Verde: horas calculadas pelos pares de entrada/saída (`08h30`).
- Vermelho: `AUSENTE`, cadastro conhecido e nenhuma batida na data escolhida.
- Laranja: `INCONSISTENTE`, entrada sem saída, batida inválida/duplicada ou
  jornada menor que 510 minutos de segunda a quinta. Não existe mínimo novo
  para sexta, sábado ou domingo.
- Cinza: `S/ CADASTRO`, somente quando o cadastro completo do RHID exclui o
  fornecedor. Nomes ambíguos e falhas de consulta ficam neutros, indisponíveis.

## Origem e compatibilidade

O cliente autenticado usa `rhid_attendance_report` com
`includeRegistration: true` somente para os indicadores. A VM autoriza o dono
da sessão antes de consultar o RHID. Os relatórios diário/mensal existentes
continuam usando o SharePoint; o pedido sem essa opção não muda.

`rhid_badge_source.py` usa a mesma conexão do coletor:

1. Login existente no RHID, sem nova conta ou alteração de permissões.
2. `GET /person?start=0&length=100`, conferindo `totalRecords`, todas as páginas
   e identificadores únicos antes de declarar o cadastro completo.
3. `GET /report/afd/download671`, equipamento 1 (o equipamento já usado pelo
   coletor), `dataIni` e `dataFinal` iguais à data da presença, limite 50000.
4. Confere o período do cabeçalho, a presença do trailer e as quantidades por
   tipo de registro conforme o [leiaute AFD](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/leiaute-do-arquivo-fonte-de-dados-afd.pdf).
   Cabeçalho isolado, registros cortados e contagens divergentes são recusados.
5. Junta AFD por PIS exclusivamente no servidor e devolve apenas identificador
   RHID, nome e horários. Credenciais, PIS, CPF e biometria não são enviados ao
   aplicativo. Ajustes administrativos aprovados continuam aplicados pela VM.

Não chama ressíncrono, não altera o relógio e não grava presenças no SharePoint.
O AFD vazio, inválido, truncado ou com vínculo ambíguo causa erro neutro; não é
tratado como prova de ausência. Consulta diária tem cache de 60 segundos;
cadastro completo tem cache de 5 minutos. Caches não persistem dados no chat.
O cache da interface também pertence à conta/sessão autenticada; trocar a
conta ou sair descarta respostas pendentes da conta anterior.

## Configuração e implantação

As credenciais já utilizadas pelo coletor ficam fora do Git, em
`/etc/energetica-rhid-directory.json`, permissão `0640`,
`root:energetica-whatsapp`. Não incluir valores, arquivos privados ou tokens em
commits, logs ou exemplos.

`patch_bridge.py` aplica seis substituições exatas ao backend original e recusa
deriva/patch ambíguo. Instalar o módulo e a alteração pequena de
`channel_bridge.py` no serviço e no espelho de build, com cópia recuperável e
conferência de hashes antes de reiniciar. Nenhum `workflow_config.json` é
alterado.

Teste reproduzível, usando um Python com `requests` já instalado:

```sh
python -m unittest discover -s backend-patches/attendance-rhid-badges/tests -v
```

O teste de ponte usa uma fixture pequena do método original e verifica que
consulta, ajustes, vínculo pendente e autorização são preservados.

## Correção do contexto enviado ao app (13/10/2026)

O produtor real `ChannelMessenger._send_option_poll` removia `source_values`
sem transmitir a data individual. Isso deixava todos os indicadores neutros,
mesmo com a conexão RHID e o AFD funcionando. As opções das três etapas de
presença agora recebem somente `date`, `name` e, quando conhecido, `rhidId`.
Nenhum CPF, PIS, credencial ou registro completo sai para o aplicativo.
Controles terminais e outras etapas não recebem esses metadados. Uma data
inválida, vazia ou ausente usa o marcador `INVALID`, para que um cliente antigo
não reutilize a data anterior. Não há fallback para "hoje" nem para uma
confirmação histórica que não pertença comprovadamente à enquete atual.

O cliente também lê a célula `DATA` do `detail_table` daquela própria opção,
permitindo consultar corretamente listas de Pendências já restauradas.

Para uma ponte que já possui a consulta RHID, use `deploy_context.py` (dry-run
por padrão). Forneça os SHA-256 atuais de `channel_bridge.py` e
`rhid_badge_source.py`, além de um estágio externo às duas raízes. A opção
`--apply` instala somente esses dois arquivos em produção e no espelho,
preservando donos/modos, cópias recuperáveis, configurações e credenciais.
O CLI mantém os dois locks compartilhados já utilizados pelos demais deploys
(`/tmp/energetica-whatsapp-deploy.lock` e `/home/opc/.energetica-deploy.lock`).
O instalador recusa deriva, verifica o HTTP 200 após reiniciar e reverte em
caso de falha. Cada arquivo deslocado fica numa pasta única
`.rhid-context-recovery-*`; a publicação usa hardlink create-only, nunca um
`replace` que possa apagar um arquivo criado no intervalo por outro escritor.
Os bytes deslocados são verificados depois de capturados e preservados em
conflitos, inclusive durante a reversão. Os locks serializam escritores
cooperativos; a recuperação preserva arquivos de escritores externos.

Os testes `test_choice_context.py` executam o produtor real de opções e
`test_context_deploy.py` cobre hashes, locks, concorrência real, backup, saúde
e reversão. Os testes do app
verificam a consulta pela data transmitida e os quatro indicadores originais.
