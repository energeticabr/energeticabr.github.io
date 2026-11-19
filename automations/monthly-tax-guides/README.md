# Galeria INSS e FGTS

Lista `GUIASINSSFGTS`, site pessoal, ID `405b215c-7688-4ea5-abf9-643ec9b14740`.
Menu Recursos Humanos → **GALERIA INSS E FGTS** no Energético.

Campos visíveis: data vencimento, data competência, filial, valor e tipo (INSS/FGTS).
No início de cada mês, solicita as duas guias da competência anterior para cada filial marcada ATIVO em FILIAIS.
O lote inicial é outubro/2026. Não retroage antes dessa competência.
Vencimento e valor começam nulos para preenchimento conforme a guia oficial.
Competência, filial e tipo são protegidos na edição; o lápis permite editar vencimento/valor e anexar arquivos.
O cartão indica guia pendente, anexada ou consulta indisponível conforme a leitura dos anexos reais.
Nenhuma provisão, lançamento, pagamento ou mensagem a terceiros é criado.

## Execução

Servidor: `/opt/energetica-tax-guides/run.py`, usando a identidade SharePoint já instalada em `/etc/energetica-whatsapp.env` sem copiar credenciais.
`energetica-tax-guides.timer` roda diariamente às 06:10 America/Sao_Paulo; é persistente e recupera competências perdidas a partir de outubro/2026.
`run.py` apenas lê e verifica; `run.py --apply` cria somente solicitações ausentes.
O serviço verifica esquema, paginação completa e unicidade da coluna CHAVE antes de qualquer gravação.
Chave: `GUIA:AAAA-MM:IDFILIAL:TIPO`, única/indexada no SharePoint. Uma nova tentativa lê a chave após conflito ou resposta ambígua.
Uma solicitação já existente nunca é atualizada pela rotina: valores, vencimentos e anexos informados são preservados.

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
