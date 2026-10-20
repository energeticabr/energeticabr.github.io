# Cadastro e busca global de fornecedor no agrupamento de lançamentos

Pacote público revisável do backend, com diff e manifesto de hashes fixos.
O bundle completo de código permanece privado; os testes usam apenas catálogos e armazenamento em memória.

O contrato permite pesquisar todos os fornecedores cadastrados ao agrupar lançamentos múltiplos
e acessar o wizard existente de cadastro com uma pergunta por vez. O poll de agrupamento usa
`databaseFilter=true`, `databaseFilterKey="fornecedor_agrupador_lancamento"` e a opção terminal
`NOVO_FORNECEDOR`, com retorno ao agrupamento sem alterar os fornecedores das linhas.
Despesas recorrentes oferecem o mesmo cadastro padrão, uma pergunta por vez, e retomam a etapa correta.
Os testes de contrato verificam abertura, busca global, limpeza, seleção, conclusão e retorno do wizard,
preservação dos anexos e rejeição de controles antigos. Consulte `verification.md` para os resultados e limitações.

## Escopo e validação do instalador

Somente estes arquivos integram o pacote, nesta ordem:

- `worker/workflow.py`
- `worker/workflow_config.json`
- `worker/clients.py`

O instalador compila os dois arquivos Python e valida o JSON em UTF-8, inclusive ao reutilizar um candidato
já montado. Nenhum desses arquivos pode estar ausente na baseline. O manifesto fixa hashes independentes
da produção e do espelho, do candidato, do diff e do bundle privado. O instalador mantém as verificações
de escopo do tar, deriva, aliases/symlinks das raízes, lock, cópia atômica, backups recuperáveis, saúde e rollback.
Mudanças concorrentes desconhecidas são preservadas e registradas como rollback incompleto.

As raízes continuam `/opt/energetica-whatsapp` e `/home/opc/energetica-build`.
O estágio é `/home/opc/supplier-create-global-search-20261020` e os backups ficam em
`/var/backups/energetica-whatsapp/supplier-create-global-search-<timestamp>`.

## Regeneração do pacote

Executar somente depois de finalizar e validar o candidato privado. A partir da raiz do repositório,
este exemplo PowerShell usa as pastas privadas definidas para esta tarefa:

```powershell
$taskPython = 'C:/Users/Bernardonotini/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $taskPython backend-patches/supplier-create-global-search/package.py `
  --baseline 'C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/supplier-create-global-search-20261020/baseline' `
  --candidate 'C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/supplier-create-global-search-20261020/candidate' `
  --output backend-patches/supplier-create-global-search `
  --mirror-hashes 'C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/supplier-create-global-search-20261020/mirror-hashes.json' `
  --archive-output 'C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/supplier-create-global-search-20261020/source-files.tar'
```

`mirror-hashes.json` deve conter os hashes reais e revisados dos três caminhos relativos no espelho,
obtidos de forma independente da baseline de produção. O gerador exige alteração nos três arquivos.
Revisar o diff antes de publicar. O bundle completo permanece privado e fora do Git.
Não incluir registros reais, documentos, anexos, estado de conversa, logs privados ou credenciais
no pacote público; os dados dos testes do instalador são inteiramente sintéticos.

## Implantação

Preparar o estágio com `deploy.py`, `source.patch`, `deploy-manifest.json`, `source-files.tar` privado
e o runner compartilhado como `shared-deploy.py`. Usar a versão confiável de
`backend-patches/launch-payroll-per-payment/deploy.py` cujo SHA-256 seja exatamente:

```text
01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2
```

O hash é dos bytes com finais de linha LF; um checkout Windows com CRLF tem outro hash.
Preparar e conferir os bytes LF antes de transferir o runner. Não substituir o pin por um hash diferente.
Na VM Linux, calcular o SHA-256 do manifesto revisado e executar primeiro a conferência:

```sh
cd /home/opc/supplier-create-global-search-20261020
sudo python3 deploy.py --check <sha256_do_manifesto_revisado>
```

Somente na etapa de implantação autorizada, executar `--deploy` com o mesmo hash:

```sh
sudo python3 deploy.py --deploy <sha256_do_manifesto_revisado>
```

Conferir o recibo no backup, os hashes nas duas raízes e a saúde dos serviços após reiniciar.
O modo `--check` valida e monta o candidato e consulta saúde sem escrever nos arquivos vivos.
Empacotar não instala automaticamente; `--deploy` é uma etapa explícita separada.

## Testes do instalador

A partir da raiz do repositório, usar o Python e as dependências de QA já disponíveis:

```powershell
$taskPython = 'C:/Users/Bernardonotini/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$env:PYTHONPATH = 'C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr/work/grouped-provision-one-order-20261019/qa-win-deps'
$env:PYTHONDONTWRITEBYTECODE = '1'
& $taskPython -m pytest -q -p no:cacheprovider backend-patches/supplier-create-global-search/tests/test_deploy.py
```

Esses testes executam o empacotador, a montagem, a validação, a instalação simulada e o rollback
em diretórios temporários. Não acessam VM, SharePoint ou as pastas privadas de backend.
Para executar também `tests/test_supplier_workflows.py`, configure `ENERGETICA_BACKEND_TEST_ROOT`
para a raiz de um snapshot privado do servidor e rode a pasta `tests` completa. Não use a base de dados real.
