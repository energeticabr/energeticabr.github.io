# Cadastro de tipos de pagamento

Adicionar primeiro botão `➕ CADASTRAR TIPO DE PAGAMENTO` na pergunta da folha exibida no lançamento. O catálogo deve vir do SharePoint e estar disponível a Android, iOS e Windows pelo backend compartilhado. A auditoria encontrou apenas valores históricos em FOLHAPGTO.TIPOPGTO, sem catálogo próprio.

Criar CADASTROTIPOPAGAMENTO com TIPOPGTO (nome), Title (nome legível) e CHAVE (identidade normalizada única). Inicializar os sete tipos atuais mais FGTS e INSS do histórico. Não modificar registros financeiros.

Usar cadastro inline com nome obrigatório, confirmação de gravação, cancelamento/voltar e retorno ao seletor sem escolher/gravar pagamento automaticamente. Preservar linhas, anexos, folhas e tokens. Duplicidades inclusive acentos/caixa e concorrência devem ser impedidas por CHAVE única e escrita idempotente. Catálogo paginado, tipos antigos preservados, controles atrasados/repetidos ignorados; cadastro indisponível deve falhar de forma explicada.

Alternativas: manter tipos fixos não permite persistência compartilhada; usar FOLHAPGTO como cadastro misturaria configuração e pagamentos. Lista dedicada atende ao pedido. Implementação decidida conforme autorização de execução direta do usuário.
