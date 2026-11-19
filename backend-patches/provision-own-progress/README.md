# Retomada da baixa durante a atualização automática dos vínculos

Ao criar um lançamento, uma automação do SharePoint pode preencher o pedido,
o lançamento, o status e a data da provisão antes de o aplicativo terminar a
cópia dos anexos. A proteção de concorrência interrompia a própria baixa, e
a retomada tratava esses campos como uma edição externa.

A baixa agora salva o recibo dos destinos verificados antes de copiar os
anexos. Reconhece somente os vínculos gerados por esse recibo e a data civil
correspondente em São Paulo. Confere o snapshot completo da provisão e os
campos dos dois destinos financeiros antes de renovar o ETag para a escrita
condicional. Valores, fornecedor, filial, observações, conta ou vínculos
divergentes continuam bloqueando a operação. Uma retomada reutiliza os mesmos
tokens e não cria outro pedido ou lançamento já existente.

O caminho sem criação de lançamento mantém as conferências anteriores. O
patch é aplicado separadamente ao serviço ativo e ao espelho, preservando as
demais alterações e os finais de linha de cada origem. Candidatos integrais,
documentos e dados financeiros permanecem privados.

## Verificação e implantação

Os testes usam o motor real com limites de SharePoint e mídia simulados:

- 3 testes novos: atualização automática durante os anexos, interrupção e
  retomada sem duplicação, e bloqueio de 10 alterações externas distintas.
- 23 regressões existentes de anexos, vínculos, respostas perdidas e baixa
  sem novo lançamento.
- 6 regressões existentes de atualização do status e normalização da data.

Para executar o teste novo, defina `ENERGETICA_BACKEND_TEST_ROOT` para o
runtime candidato e inclua os módulos privados do backend no `PYTHONPATH`.
A fixture fica em `../payroll-row-attachments/tests/test_propagation.py`.

No estágio privado da VM, coloque os arquivos deste pacote, a fixture acima
como `test_propagation.py` e
`../provision-paid-attachment-refresh/test_paid_refresh.py`. Execute primeiro
`deploy.py --check` e depois `deploy.py --apply`. O instalador compila os
candidatos, executa os 32 testes, verifica novamente os bytes de origem,
salva backups, instala atomicamente e reinicia os serviços. Falha de saúde
restaura a versão anterior sem sobrescrever alterações concorrentes.

Esta correção pertence ao servidor compartilhado utilizado por Android, iOS
e Windows/web. Não exige atualização dos binários dos aplicativos.
