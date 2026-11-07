# Cadastrar no resumo de presenças

A ação Cadastrar fica antes de Submeter todos e oferece Descritivo etapa e Atividade executada. Reutiliza os cadastros padrão e restaura o estado completo do resumo depois da confirmação. Os seletores são consultados novamente e o cadastro fica disponível conforme os filtros de filial/etapa existentes, sem aplicação automática nas presenças.

Cancelar, fim e o botão de cancelamento do cadastro retornam ao resumo. O cadastro aninhado de atividade dentro do descritivo preserva os dois retornos. Nenhuma presença ou padrão de fornecedor é gravado pelo novo caminho.

`package.py` aplica âncoras únicas às bases independentes de app e build e gera candidatos e manifesto SHA-256. `deploy.py` usa lock, validação de hashes, backup, substituição atômica, saúde e rollback com proteção contra alterações concorrentes.

Os testes funcionais usam WorkflowEngine real com SharePoint e mensageria em memória, via `ATTENDANCE_INLINE_SOURCE` apontando ao sandbox de testes. `test_deploy.py` cobre as proteções sem serviços reais. `export_preview.py` exporta mensagens fictícias reais para validar o layout nos clientes.
