# Metadados de retenção da NF-e

Atualização para a integração SEFAZ já instalada. Os caminhos desta pasta são relativos à raiz dessa integração; os arquivos novos e alterados devem ser aplicados junto da configuração, autenticação Microsoft e renderizador já existentes. Não é um pacote de importação do Power Automate.

Leia `docs/RETENCOES.md`. Regenerar os fluxos, executar os testes de extração e contrato e usar o provisionador antes de publicar a interface que solicita os campos novos. A carga do fluxo `06` altera somente retenções de registros existentes, sem arquivos ou notificações. Não contém certificado, chave privada, senha ou token.

Testes na integração: `pwsh -NoProfile -File tests/Retencoes-Tests.ps1` e `node --test tests/retencoes-flow.test.mjs`. O contrato Node também funciona a partir da raiz do repositório: gera os fluxos numa pasta temporária com configuração inteiramente fictícia, sem ler a configuração do tenant ou modificar arquivos instalados. `tests/wdl.mjs` e `scripts/danfe-flow.mjs` estão incluídos para permitir essa execução independente. A instalação real dos geradores continua usando `config/energetica.json` existente.
