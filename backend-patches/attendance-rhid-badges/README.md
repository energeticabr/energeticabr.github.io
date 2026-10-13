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

`patch_bridge.py` aplica cinco substituições exatas ao backend atual e recusa
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
