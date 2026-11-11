# Importação de pagamentos Sicoob

O coletor lê os pagamentos debitados pela API Conta Corrente v4 com o escopo
`cco_consulta`. O destino é a lista pessoal existente `MOVIMENTACOESFINANCEIRAS`.
A chave única `CHAVEIMPORTACAO` combina banco, conta e identificador da transação.
Cada item novo é relido do SharePoint. Registros manuais continuam disponíveis
na galeria e os importados são somente para consulta no aplicativo.

A primeira carga abrange de 01/10/2026 a 07/11/2026. O modo programado começa
em 08/11/2026 e relê o dia anterior para capturar lançamentos tardios.
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

Depois da coleta, o serviço consulta a segunda via dos boletos Sicoob pela
referência do extrato. Valida conta, data, valor, situação efetivada e
autenticação bancária antes de completar campos vazios e anexar o PDF. O PDF
é formatado pelo Energético com os dados retornados pela API de comprovantes.
A etapa preserva os arquivos existentes e tenta de novo nas próximas coletas
quando o banco limita as consultas. Para conferir os vínculos sem gravação,
execute `sync_boleto_receipts.py --check` com o ambiente da unidade.

Para Pix, o nome vem do extrato Sicoob ou da consulta direta por EndToEndId
com escopo `pixpagamentos_consulta`. Se o extrato trouxer apenas o CPF
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
