# Baixa agrupada com fornecedores diferentes

A confirmação de um descritivo com fornecedores diferentes falhava antes de
gravar porque a conversão exigia um único fornecedor/filial para todo o grupo.
O aviso genérico não explicava essa restrição.

A baixa agora cria um pedido por combinação de fornecedor e filial, somando
somente suas linhas pendentes. Cada lançamento e provisão apontam ao pedido
correto. Grupos homogêneos mantêm a chave anterior. O resumo informa quantos
pedidos serão gerados. A decisão NÃO continua sem criar pedidos/lançamentos.

O plano completo fica congelado no journal antes das gravações. Perdas de
resposta e falhas parciais reutilizam as mesmas chaves e conferem os registros
existentes. Fornecedor/filial adulterados, vínculos preexistentes conflitantes,
alteração concorrente ou pedidos não confirmados interrompem a operação.
O botão TENTAR NOVAMENTE também retoma o rascunho que falhou antes de criar
a primeira intenção, mantendo a proteção de duplicatas e o cooldown existente.

## Anexos e retomada

O upload do comprovante no pai usa o armazenamento local do cliente seguido
pelo fanout com o snapshot aprovado de proprietários do pai e de cada filho.
As verificações de vínculo, ETag e conteúdo SHA-256 permanecem ativas.
Comprovantes originais do grupo alcançam todos os pedidos confirmados;
arquivos originados em uma linha preservam seu escopo.

Após fanout concluído, um contexto mínimo de proprietários é salvo com modo
0600, sob lock, no diretório privado de sincronização já existente. Hooks e
reparo automático podem reutilizá-lo apenas enquanto pai, conjunto de filhos,
proprietários e destinos continuarem compatíveis. Sem contexto validado, o
caminho genérico permanece estrito. Dry-run não cria autorização persistente.

## Testes e implantação

Os testes de conversação usam o workflow real com conectores e arquivos
fictícios; exigem `ENERGETICA_BACKEND_TEST_ROOT` apontando a um snapshot privado
de código e às fixtures herdadas `test_workflow.py`, `test_batch_review.py` e
`test_parent_fanout.py`. Não usam credenciais nem gravações no SharePoint.
Os testes do instalador são independentes e rodam em diretórios temporários.

`package.py` gera o diff de apenas dois módulos e o manifesto por raiz.
`sourceBefore` identifica a origem do diff cumulativo; os hashes `before` e
`mirrorBefore` fixam separadamente o runtime atual em uma implantação de seguimento.
O arquivo completo `source-files.tar` permanece privado e ignorado pelo Git.
Preparar `/home/opc/provision-post-confirmation-20261025` com manifesto, patch,
bundle, `deploy.py` e o instalador compartilhado hash-pinned
`backend-patches/launch-payroll-per-payment/deploy.py` como `shared-deploy.py`.
Executar `deploy.py --check <sha256-do-manifesto>` antes de `--deploy`.
O instalador recusa deriva, preserva backup recuperável e confere saúde e hashes.

A alteração é no serviço comum a Android, iOS e Windows/web. Nenhum binário ou
contrato de cliente foi alterado; os aplicativos instalados consomem a correção
na próxima interação com o serviço. A implantação não reenvia confirmações,
não modifica rascunhos e não realiza pagamentos bancários.
