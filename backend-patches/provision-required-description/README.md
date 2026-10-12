# Vínculo obrigatório na criação de provisões

O fluxo de criação de `PROVISÃO PGTOS` oferece um novo `DESCRITIVOPROVISAO` por padrão ou associação explícita a um descritivo existente e pendente. O pai é gravado antes dos filhos. O vínculo é um ID positivo em texto; não é permitido relincar filhos já gravados.

A opção existente exige identidade, ETag e os quatro marcadores de pagamento/agendamento vazios. Ao acrescentar um filho, o total do pai é recalculado a partir de todos os filhos vinculados, inclusive pagos: `QTD × VALORTOTAL + FRETE`. Atualizações concorrentes interrompem a gravação ou provocam uma nova consulta completa, nunca substituem dados de pagamento ou metadados do pai.

O journal congela dados, seleção, tokens e anexos para recuperar respostas perdidas e gravações parciais. Não há gravações durante a composição do rascunho. Este pacote não faz migração histórica de provisões sem vínculo.

## Implantação do backend

O diff público contém somente quatro arquivos revisados. O bundle privado é gerado separadamente; não contém estado, dados financeiros ou credenciais. `package.py` fixa hashes de produção e espelho independentemente. `deploy.py` recusa deriva e caminhos inesperados, preserva backup, reinicia o bridge e verifica a saúde. O instalador compartilhado também tem hash fixado.

Na pasta privada `/home/opc/provision-required-description-20261012-v1`, colocar `deploy.py`, `deploy-manifest.json`, `source.patch`, o bundle privado `source-files.tar` e `backend-patches/launch-payroll-per-payment/deploy.py` com o nome `shared-deploy.py`. Executar primeiro `deploy.py --check <SHA256_DO_MANIFESTO>`, depois `--deploy` com o mesmo hash. A checagem não altera código em produção. O recibo e as cópias anteriores ficam em `/var/backups/energetica-whatsapp/provision-required-description-*`.

## Verificação

Os testes do instalador usam somente diretórios temporários. Os testes de criação/recuperação são executados sobre uma cópia privada completa do backend, com conectores em memória e rede bloqueada. A suíte histórica do espelho tem falhas pré-existentes; testes focados aprovados não significam que toda essa suíte passou.

O ajuste do Power Automate é separado deste pacote. A definição candidata de `PAGAMENTO RECORRENTE` foi preparada e testada estruturalmente em artefatos privados, mas a inserção pelo designer travou. Não houve salvamento nem reexecução; o fluxo publicado continua original. O candidato ainda precisa de validação do checker e releitura da definição salva. Este pacote não garante vínculo obrigatório em criadores Power Automate ainda não atualizados. Não reexecutar pagamentos reais para testar.
