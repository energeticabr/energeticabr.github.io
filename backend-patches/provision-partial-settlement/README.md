# Baixa parcial de provisão: implantação

Na revisão de um descritivo, somente as provisões selecionadas seguem para a baixa
e para os lançamentos. Linhas desmarcadas permanecem intactas. O descritivo fica em
aberto e sem data de pagamento até todas as provisões vinculadas estarem pagas;
ao concluir, usa a maior data efetiva das linhas. As baixas reutilizam um pedido
com identidade estável por descritivo, inclusive em datas diferentes e após perda
da confirmação. Pedidos de outro descritivo ou vínculos conflitantes são rejeitados.

O cadastro de etapa usa o fluxo padrão, preserva a baixa e seus anexos e destaca
a filial original do pagamento. Seu teste está no diretório irmão
`provision-settlement-stage/tests`.

O pacote atualiza exatamente três arquivos nos dois roots `/opt/energetica-whatsapp`
e `/home/opc/energetica-build`:

- `worker/workflow.py`
- `worker/provision_description_settlement.py`
- `worker/provision_description_review.py`

`worker/workflow_config.json` é uma guarda de hash estrita e nunca é copiado ou
alterado. Cada um dos seis destinos conserva seu próprio proprietário, grupo e modo.
Não são importados o WorkflowEngine ou conectores durante instalação/verificação.
O instalador não consulta registros, não chama filas e não dispara fluxos.

## Preparação e congelamento

Enquanto os candidatos estiverem mudando, não executar o empacotador. Depois de
main confirmar os três arquivos e os testes, usar um workspace privado fora do repo
com `baseline/worker/` e `candidate/worker/`:

```powershell
& $python -B backend-patches/provision-partial-settlement/package.py --freeze PRIVATE_WORKSPACE
```

Isso cria `PRIVATE_WORKSPACE/release/` com os três fontes privados, ferramentas,
manifesto e diff. Gera também `source.patch` e `deploy-manifest.json` públicos.
O diretório `release/` existente nunca é sobrescrito. Guardar/revisar o SHA-256 do
manifesto; uma mudança posterior em qualquer entrada ou candidato invalida o pacote.
O código completo do engine/helpers permanece fora do repositório público.

## Testes locais

Os testes de instalação estão em `test_deploy.py` na raiz; os testes funcionais dos
outros agentes ficam em `tests/`.

```powershell
& $python -B -m unittest discover -s backend-patches/provision-partial-settlement -p test_deploy.py
```

São usados roots, catálogos e serviços sintéticos. Nenhuma chamada ao tenant/VM.

Os testes funcionais precisam de `ENERGETICA_BACKEND_TEST_ROOT` apontando para
um snapshot privado completo do backend com as dependências Python instaladas:

```powershell
& $python -B backend-patches/provision-partial-settlement/tests/test_partial_settlement.py -v
& $python -B backend-patches/provision-settlement-stage/tests/test_stage_registration.py -v
```

Incluem seleção inválida, lançamento somente das linhas escolhidas, anexos,
retomada, vários dias, criação concorrente de linhas e preservação por CAS de
alterações feitas por outra sessão. A identidade do pedido é conferida na busca
idempotente e na leitura condicional antes da atualização.

## Após GO separado de implantação

Estagiar o release privado em `/home/opc/provision-partial-settlement-20261030/release`.
Conferir seu manifesto/entradas antes de executar como root:

```sh
sudo -n /opt/energetica-whatsapp/.venv/bin/python -B /home/opc/provision-partial-settlement-20261030/release/deploy.py --check SHA_MANIFESTO_REVISADO
sudo -n bash /home/opc/provision-partial-settlement-20261030/release/deploy.sh SHA_MANIFESTO_REVISADO
```

`--check` só lê fontes/config/candidatos e saúde; não cria caches, backups ou trava.
O lock compartilhado existente é obrigatório e não bloqueante. A reentrada no
mesmo processo reutiliza o lock; um lock aberto para check não pode virar deploy.
Durante deploy, o lock permanece adquirido do preflight ao fim do gate/drain,
backup, CAS, restart e readback. O gate rejeita novas conexões locais não-root na
porta 8765; aceita health do root. A drenagem tem prazo de 30 segundos e o watchdog
de liberação, 300 segundos. Config e ambos os roots são conferidos antes e depois.

O backup em `/var/backups/energetica-whatsapp/provision-partial-settlement-*` guarda
os seis fontes anteriores, manifesto e recibo. Escritas são atômicas com fsync;
health após restart tem prazo de 30 segundos. Em falha, o instalador tenta restaurar
todos os destinos alterados e o serviço. Um terceiro conteúdo desconhecido nunca é
sobrescrito pelo rollback; o recibo informa `rollback_incomplete`. Falha ao limpar
o gate após atualização verificada gera `deployed_ingress_cleanup_failed`, sem
alegar conclusão limpa; o watchdog continua sendo a salvaguarda de liberação.

Esta publicação backend é coordenada com a publicação frontend Android/iOS/web
pelo main. Os comandos de instalação aguardam GO; este diretório não publica apps.
