# Fornecedor do pedido: ID e cadastro incorporado

Ao responder “NÃO, ESCOLHER OUTRO FORNECEDOR” no lançamento único para novo pedido,
o catálogo exibe `ID - FORNECEDOR` e oferece `➕ CADASTRAR NOVO FORNECEDOR` antes dos
fornecedores. A ação permanece acessível na pesquisa, inclusive sem resultados.
Catálogos de conversas já abertas recebem o mesmo formato.

O cadastro usa o wizard padrão, com uma pergunta por vez. Ao concluir, o fornecedor
criado é escolhido para o pedido. O lançamento mantém seus campos, anexos,
fornecedor original e seleções que determinam folha/IDFOLHA. A opção de retornar
ao lançamento sem concluir o cadastro restaura o seletor do pedido.

## Validação

`ORDER_SUPPLIER_SOURCE` aponta para o snapshot privado do runtime e fixtures
sintéticas de `tests/test_workflow.py`. Nenhum teste usa registros de produção.

```sh
ORDER_SUPPLIER_SOURCE=/private/candidate python -B test_registration.py -v
python -B test_deploy.py -v
ORDER_SUPPLIER_SOURCE=/private/candidate REGISTRATION_FIXTURE=/private/packets.json python -B test_registration.py
node verify_ui.mjs /private/packets.json /private/screenshots
```

A fixture visual usa ChannelBridge, store e renderer reais do aplicativo, com
dados fictícios, em 320, 390 e 1200 pixels, incluindo nomes longos e busca vazia.

## Publicação

Somente `worker/workflow.py` da raiz ativa `/opt/energetica-whatsapp` é atualizado.
O espelho divergente `/home/opc/energetica-build` é protegido por hash e permanece
inalterado. O pacote reutiliza o instalador com lock compartilhado, conferência
da baseline, gate de conexões, drenagem de requisições, instalação atômica,
backup, verificação de saúde e rollback.

```sh
python -B package.py --baseline /private/baseline --candidate /private/candidate --stage /private/release
sudo -n /opt/energetica-whatsapp/.venv/bin/python -B /home/opc/order-supplier-registration-20261104/release/deploy.py --check <manifest_sha256>
sudo -n bash /home/opc/order-supplier-registration-20261104/release/deploy.sh <manifest_sha256>
```

O código compartilhado atende Android, iOS e Windows/web com os clientes
instalados; esta alteração não modifica bundles nem exige reinstalação.
