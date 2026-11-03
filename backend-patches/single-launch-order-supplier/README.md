# Fornecedor do pedido em lançamento único

Depois de selecionar o fornecedor de um lançamento único para novo pedido, o fluxo pergunta se o pedido usará o mesmo fornecedor. SIM mantém o fornecedor. NÃO abre o cadastro completo de fornecedores, com pesquisa por texto ou ID, limpar filtro e paginação. O resumo identifica separadamente o fornecedor do pedido.

Somente o payload de criação do novo pedido em NOTASPENDENTES recebe o fornecedor alternativo. O lançamento, a recomendação de filial, o aviso de provisões pendentes, a elegibilidade de empreiteiro e as perguntas de folha/IDFOLHA continuam usando o fornecedor original do lançamento. Pedidos existentes e lançamentos múltiplos mantêm o comportamento anterior.

A subpergunta usa a etapa existente de verificação de provisões, sem inserir etapas nem alterar a configuração. Isso preserva os índices de conversas em andamento. Controles recebem um token por seleção de fornecedor; respostas antigas não escolhem fornecedores de outra pergunta. Anexos, retomada e histórico de navegação são preservados.

## Verificação

`ORDER_SUPPLIER_SOURCE` deve apontar para um snapshot privado da versão ativa com módulos de runtime e `tests/test_workflow.py`. Todos os testes usam dados fictícios e armazenamento em memória.

```sh
ORDER_SUPPLIER_SOURCE=/path/to/candidate python -B test_order_supplier.py -v
python -B test_deploy.py -v
ORDER_SUPPLIER_SOURCE=/path/to/candidate ORDER_SUPPLIER_FIXTURE=/path/to/packets.json python -B test_order_supplier.py
node verify_ui.mjs /path/to/packets.json /path/to/screenshots
```

O teste de submissão cria pedido e lançamento somente no SharePoint fictício, confirma fornecedores distintos e verifica a pergunta de folha para o fornecedor original. O teste pelo ChannelBridge real verifica SIM/NÃO, seleção, Voltar e IDFOLHA. A fixture visual usa o store e o renderer reais do aplicativo a 320, 390 e 1200 pixels.

## Publicação

Somente `worker/workflow.py` na raiz ativa `/opt/energetica-whatsapp` é atualizado. O espelho divergente `/home/opc/energetica-build` é conferido por hash e permanece sem alterações. Não são modificados estados de conversa, configuração, anexos nem registros financeiros.

`package.py` gera o diff e o manifesto a partir da baseline exata e do candidato reproduzido pelo patcher. O runtime completo permanece privado. Preparar o release com os arquivos do manifesto; copiar o runner compartilhado de `launch-payroll-per-payment/deploy.py` com LF e SHA-256 `01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2`.

```sh
sudo -n /opt/energetica-whatsapp/.venv/bin/python -B /home/opc/single-launch-order-supplier-20261103/release/deploy.py --check <sha256_do_manifesto>
sudo -n bash /home/opc/single-launch-order-supplier-20261103/release/deploy.sh <sha256_do_manifesto>
```

O instalador usa o lock compartilhado, rejeita deriva, preserva atributos, confere backups, instala bytes imutáveis atomicamente e reinicia o bridge com verificação de saúde e rollback. O gate existente suspende novas conexões ao bridge e drena requisições antes da troca.

A publicação do backend compartilhado atende Android, iOS e Windows/web com os clientes instalados. Esta mudança não altera bundles nem exige novos binários nativos.
