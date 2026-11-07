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

## Ativação

1. Instale os dois scripts em `/opt/energetica-whatsapp/sicoob-movements` e as
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
