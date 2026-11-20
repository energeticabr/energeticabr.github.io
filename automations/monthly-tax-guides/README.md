# Galeria INSS e FGTS

Lista `GUIASINSSFGTS`, site pessoal, ID `405b215c-7688-4ea5-abf9-643ec9b14740`.
Menu Recursos Humanos → **GALERIA INSS E FGTS** no Energético.

Campos visíveis: data vencimento, data competência, filial, valor, tipo (INSS/FGTS) e status.
No início de cada mês, solicita uma guia de INSS e uma de FGTS exclusivamente para a filial **004 - EDIFÍCIO XAVANTE** (ID5 em FILIAIS, que deve permanecer ativa).
O lote inicial é outubro/2026. Não retroage antes dessa competência.
Competência: dia20 do mês anterior. Vencimento: dia20 do mês seguinte à competência, sem deslocamento automático por calendário. Exemplo inicial: competência20/10/2026 e vencimento20/11/2026, conforme solicitado pelo usuário.
Valor começa nulo e os anexos ficam a cargo do usuário. A recorrência nunca estima valores nem produz arquivos de guia.
STATUS começa **PENDENTE**, explicitamente no payload do worker e no padrão obrigatório da coluna de texto SharePoint. A galeria permite editar o status; a rotina mensal jamais restaura PENDENTE sobre um status já preenchido. O relatório INSS mostra o campo e permite filtrar seu valor, sem inferir pagamento pela presença de anexo.
Competência, filial e tipo são protegidos na edição; o lápis permite editar vencimento/valor e anexar arquivos.
O cartão indica guia pendente, anexada ou consulta indisponível conforme a leitura dos anexos reais.
Nenhuma provisão, lançamento, pagamento ou mensagem a terceiros é criado.

## Execução

Servidor: `/opt/energetica-tax-guides/run.py`, usando a identidade SharePoint já instalada em `/etc/energetica-whatsapp.env` sem copiar credenciais.
`energetica-tax-guides.timer` roda diariamente às 06:10 America/Sao_Paulo; é persistente e recupera competências perdidas a partir de outubro/2026.
`run.py` apenas lê e verifica; `run.py --apply` cria somente solicitações ausentes.
O serviço verifica esquema, paginação completa e unicidade da coluna CHAVE antes de qualquer gravação.
Na virada de novembro para dezembro/2026 acrescenta somente duas linhas: competência20/11/2026 e vencimento20/12/2026. Os demais disparos diários apenas conferem as chaves existentes.
Chave: `GUIA:AAAA-MM:IDFILIAL:TIPO`, única/indexada no SharePoint. Uma nova tentativa lê a chave após conflito ou resposta ambígua.
Uma solicitação já existente nunca é atualizada pela rotina: valores, vencimentos e anexos informados são preservados.

O botão fica na primeira coluna, imediatamente à esquerda de Galeria Holerites na segunda coluna do menu RH.

## Alinhamento do lote inicial

`initialize_status.py --backup-root <diretorio-privado>` inicializa somente STATUS vazio nas solicitações mensais da filial5. Faz backup antes de escrever e usa o ETag exato; qualquer conflito exige nova leitura. Não altera valores, datas, anexos ou status já preenchidos. É uma preparação explícita, não executada pelo timer.

`realign_initial.py --backup-root <diretorio-privado>` é um alinhamento único, reexecutável, das oito solicitações originais de outubro/2026. Faz backup integral antes de escrever, remove apenas os seis itens próprios e intocados das outras filiais e ajusta as datas dos itens7/8. Qualquer valor, anexo ou edição nos itens a remover interrompe o preflight inteiro. Todas as mutações usam o ETag exato do snapshot; conflitos não autorizam sobrescrita. Nos itens mantidos, valor/anexos e vencimento já preenchido pelo usuário são preservados. A rotina mensal não executa essa migração.

Preparação de esquema: `bootstrap.ps1`, pela conexão delegada Power Platform já autorizada.
O certificado do servidor possui escrita de itens, mas não criação de listas; não ampliar suas permissões.
O provisionador cria o nome interno ASCII antes de renomear o título visível e verifica os nomes retornados.
Reexecutar o provisionador é seguro; não remove listas, campos nem itens.

## Validação

`python -m unittest discover -s automations/monthly-tax-guides -v`

No app: `node --test tests/tax-guides-gallery.test.mjs tests/tax-guides-browser.test.mjs`.
O teste de navegador compila uma fixture isolada para evitar interferência do cache Vite em suítes concorrentes.
Dados fictícios, nenhuma escrita real. Confere 320/390/1365 px, campos protegidos e upload disponível.

Após implantação: conferir `systemctl is-enabled energetica-tax-guides.timer`, próximo disparo e `Result=success`, `ExecMainStatus=0` do serviço.
Reexecutar e confirmar `created: 0`; ler as linhas pelo SharePoint e confirmar dois tipos por filial/competência.
