# Retirar ajuste manual de ponto RHID

A edição de um horário manual próprio oferece, nesta ordem, **Cancelar**,
**Deletar registro** e **Salvar edição**. A regularização de horário ausente
continua com as duas ações anteriores. O cliente só oferece exclusão quando o
e-mail do autor corresponde à conta conectada; essa indicação não substitui
a autorização do servidor.

## Segurança e auditoria

- A ação autenticada `rhid_attendance_adjust_delete` recebe data, pessoa,
  coluna e ID da revisão exibida, nunca uma identidade fornecida pelo cliente.
- A consulta existente autoriza a conta/conversa e confirma o colaborador na
  data. A exclusão exige dia encerrado e o OID do autor original, armazenado
  em `RESPONSAVEL`. Outro usuário, revisão antiga ou campo inexistente não grava.
- Não há exclusão física. Um evento `EXCLUSAO-AJUSTE-<ID>` retira o ajuste dos
  cálculos e mantém a trilha anterior. `BATIDAS_RHID` não é alterado.
- Um único redutor é usado pelos relatórios diário, mensal e calendário.
  Retirar a última revisão não ressuscita uma revisão antiga; um ajuste novo
  posterior continua valendo. O PDF usa os mesmos dados efetivos do aplicativo.
- Repetir uma exclusão confirmada, inclusive após perda de resposta, não cria
  novo evento nem retira uma revisão posterior.

## Implantação

`build_candidate.py` aplica substituições exatas aos três arquivos da base
revisada, acrescentando somente o módulo de retirada. Gera o manifesto, um
diff revisável e o pacote de fontes **privado**, fora do repositório público.
O espelho de build estava atrasado: seus hashes anteriores são fixados
separadamente e o arquivo mensal ausente é instalado explicitamente.

`deploy.py` reutiliza as operações atômicas do instalador existente, cujo
conteúdo completo é fixado por SHA-256. A normalização CRLF/LF só ocorre se o
resultado inteiro mantiver esse hash revisado. Antes de instalar, o comando
`--check <hash-do-manifesto>` verifica escopo, fontes, candidato e saúde.
O comando `--deploy` mantém cópias recuperáveis, verifica hashes imediatamente
antes de cada troca, reinicia a ponte e confirma os serviços e `/health`.
Falha resulta em tentativa de restauração dos arquivos anteriores. Não são
alterados credenciais, configuração, estado de conversa ou registros de ponto
durante a implantação.

## Verificação

Os testes usam SharePoint falso e fonte candidata isolada, sem registros reais:

```sh
python -B test_removal.py -v
RHID_REMOVAL_SOURCE=/caminho/candidato python -B test_wiring.py -v
```

Incluem propriedade por OID, revisão obsoleta, repetição, recuperação após
resposta perdida, preservação dos demais horários, diário/mensal/calendário,
identidade autenticada no despachante HTTP e datas inválidas/futuras.
Na conferência visual publicada, apenas abrir e cancelar o editor de um ajuste
existente; não salvar nem excluir dados reais de RH como teste.
