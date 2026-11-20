# Importação de pagamentos Sicoob

## PDFs gerados pelo Energético

Desde 19/11/2026, o quarto estágio da coleta manual e programada é
`sync_generated_receipts.py`. Para cada débito Sicoob com data de lançamento
igual ou posterior a **19/11/2026**, ele anexa
`Demonstrativo-Energetico-Sicoob-<ID>.pdf` à própria linha de
`MOVIMENTACOESFINANCEIRAS`. Datas anteriores ficam fora da geração, inclusive
em importações tardias. Não escreve campos financeiros nem replica documentos
para LANCAMENTOS.

O documento usa o layout aprovado e o logotipo público do Sicoob, com aviso
explícito de que foi gerado pelo Energético e não emitido pelo banco. Reconfere
conta, chave de importação, data, valor e descrição com o extrato autenticado.
Dados Pix autenticados do cache e dados de boleto verificados enriquecem o PDF;
horário, documento, instituição e identificadores ausentes permanecem marcados
como não disponibilizados. O horário artificial de armazenamento da data na
lista nunca é exibido como horário bancário.

Arquivos existentes são preservados. O nome estável e a identidade dentro do
PDF permitem retomar tentativas sem duplicar; cada novo upload é baixado e
comparado byte a byte. Um PDF gerado não é considerado comprovante original
pela conciliação Pix. Qualquer erro deixa a atualização como falha e a próxima
rodada retoma os itens restantes. A agenda e o botão Atualizar executam o mesmo
pipeline no OCI, sem depender do computador do usuário.

Para validar sem anexar: `sync_generated_receipts.py --check --output-dir <pasta-privada>`
com o ambiente do serviço. O contador `attached` nesse modo indica arquivos
planejados; somente a execução sem `--check` publica os anexos.

Ativos públicos: `assets/sicoob-logo.svg` veio do elemento `logo-sicoob` da
página `https://www.sicoob.com.br/`; o preenchimento herdado usa a cor
`#003D42` para fundo branco. `assets/sicoob-logo.png` é a rasterização desse
vetor, sem dados de outros comprovantes;
`assets/institutions.json` registra as fontes oficiais do Banco Central. Nomes
ausentes nesse catálogo são mostrados como ISPB, sem inferência.

O coletor lê os pagamentos debitados pela API Conta Corrente v4 com o escopo
`cco_consulta`. O destino é a lista pessoal existente `MOVIMENTACOESFINANCEIRAS`.
A chave única `CHAVEIMPORTACAO` combina banco, conta e identificador da transação.
Cada item novo é relido do SharePoint. Registros manuais continuam disponíveis
na galeria e os importados são somente para consulta no aplicativo.

A primeira carga abrange de 01/10/2026 a 07/11/2026. O modo programado começa
em 08/11/2026 e relê os três dias anteriores para capturar lançamentos tardios,
inclusive após o fim de semana.
Uma execução incompleta não avança a data. O serviço usa o horário de São Paulo
e o temporizador dispara às 09h, 14h e 20h.

O extrato documenta CPF/CNPJ, data, valor, descrição e referência. A triagem
usa a descrição bancária do débito e conta separadamente os itens excluídos.
A cobertura deve ser comparada com pagamentos conhecidos antes da ativação.
A conta
pagadora é a conta autenticada. A conta do recebedor fica vazia quando o banco
não a fornece. O coletor procura o documento exato no cadastro de fornecedores.
Para CNPJ, consulta também a base pública Minha Receita e valida o CNPJ
devolvido antes de gravar `RAZÃO SOCIAL (NOME FANTASIA)`, ou o único nome
disponível. O dado enviado à API pública é somente o CNPJ. Sem nome
verificável, grava `N/A`.

Depois da coleta, o serviço consulta dados dos pagamentos de boletos Sicoob
com identificação incompleta pela referência do extrato. Valida conta, data,
valor, situação efetivada e autenticação bancária antes de completar os campos
vazios do recebedor. A API consultada retorna os dados em JSON. O documento
do banco deve ser obtido no Sicoob e anexado ao movimento como
`Comprovante-Sicoob-<referência>.pdf`.
Para conferir documentos pendentes e consultas sem gravação, execute
`sync_boleto_receipts.py --check` com o ambiente da unidade.

Antes de gravar qualquer débito da rodada, o coletor consulta os vínculos Pix:
notificações bancárias e, sem ambiguidades na fila, comprovantes originais já
arquivados em LANCAMENTOS. A consulta autenticada por EndToEndId e a conferência
de conta, titular, valor, data, documento e unicidade preenchem o recebedor em
memória antes da primeira gravação. Os dados da notificação não fornecem nomes.
Comprovantes encontrados são preservados e conferidos depois de salvar o item;
a consulta se repete nas tentativas seguintes, inclusive quando o nome já foi
gravado, para recuperar uma falha no anexo sem perder o documento original.

Para Pix, o nome vem do extrato Sicoob (formatos `FAV.: nome` e
`Pix enviado|@nome|@CPF/CNPJ|@`) ou da consulta direta por EndToEndId
com escopo `pixpagamentos_consulta`. Se o extrato omitir o nome e informar
o CNPJ completo, a importação consulta a razão social no OpenCNPJ e confere
o CNPJ devolvido. Se o extrato trouxer apenas o CPF
mascarado, o coletor pode localizar o identificador completo em um comprovante
Sicoob arquivado em LANCAMENTOS. Só grava a resposta do banco se o débito
corresponder de forma única à conta, ao titular, à data, ao valor e ao documento
do recebedor. A leitura de imagens usa Tesseract e mantém apenas o cache
privado de identificadores por conteúdo.
Um Pix sem nome fica em identificação pendente e volta à consulta em cada
rodada. O coletor preserva o EndToEndId completo se o extrato o fornecer.

## Notificações Pix

O receptor `pix_events.py` recebe os identificadores de pagamento em uma fila
SQLite privada e confirma a entrega somente depois de gravá-los. O endereço
contém um segredo aleatório; não deve aparecer em logs ou relatórios. Campos
de nome enviados ao webhook são ignorados. O coletor consulta os identificadores
pela API autenticada e exige a mesma correspondência financeira e unicidade
usadas na consulta histórica antes de completar os campos vazios.
Para lançamento em lote até três dias depois da efetivação, o coletor relê
o extrato e confirma a chave do único débito compatível. Com identificação
parcial do extrato, aguarda o fechamento da janela antes de conciliar.
Cada débito é reservado à notificação bancária que o conciliou.

Cada execução consulta até 100 identificadores em lotes de 25, no limite de
tempo disponível. Respostas bancárias de pagamentos finalizados ficam salvas
por lote para permitir retomada. Erros e respostas 404 continuam pendentes.
A análise considera toda a fila, inclusive identificadores ainda não consultados;
um resultado desconhecido impede a associação apenas por data/valor/CPF mascarado.
Enquanto houver eventos pendentes, a busca em comprovantes históricos não pode
contornar essa ambiguidade. O processamento ocorre nas coletas existentes,
manuais ou programadas às 09h, 14h e 20h; a recepção fica disponível continuamente.

O instalador `deploy_webhook.py` verifica versões, adquire as travas existentes,
valida o Caddy e mantém backup e reversão. Depois de liberar o escopo
`pixpagamentos_webhook` no Developers, execute `Configure-SicoobPixWebhook.ps1`
em modo `Register` com o ambiente e usuário do serviço. O script preserva um
callback diferente já cadastrado e exige leitura de confirmação do endereço.
Se o Developers exigir um aplicativo separado, guarde seu Client ID, CNPJ e
conta no arquivo privado criptografado `sicoob-webhook-credentials.dpapi`.
O registrador usa essa configuração sem alterar a integração de extratos;
na ausência dela, usa a configuração de movimentações existente.
Ativação de escopo, cadastro da URL e entrega de um Pix feito no aplicativo
Sicoob são verificações separadas. O receptor instalado, isoladamente, não
comprova que esse canal de pagamento será notificado pelo banco.

## Ativação

1. Instale os scripts de extrato e comprovantes em `/opt/energetica-whatsapp/sicoob-movements` e as
   unidades systemd em `/etc/systemd/system`. Mantenha o temporizador desativado
   durante a validação.
2. Valide `check` com o usuário do serviço e o arquivo de ambiente da aplicação.
   O coletor usa o certificado e a conta do DDA. Para um Client ID dedicado
   da mesma conta e titularidade, use o estado criptografado
   `sicoob-movements-credentials.dpapi` do coletor DDA, com `cnpj`,
   `accountNumber` e `clientId`. Conceda a permissão de consulta da Conta Corrente.
3. Execute `backfill` com o mesmo ambiente e diretório de estado. Compare a
   contagem e os dados lidos de volta. A segunda execução deve inserir zero.
4. Ative `energetica-sicoob-movements.timer` e verifique a primeira coleta.
