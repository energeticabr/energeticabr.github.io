# Plano de implementação: detalhes fiscais na OBS da retenção

## Tarefa 1: contrato do parser e do fluxo

- Adicionar testes que exijam a extração ordenada dos produtos de NF-e.
- Adicionar testes que exijam razão social, emissão formatada e produto/serviço em `OBS`, incluindo ausências seguras.
- Executar os testes para confirmar a falha inicial.
- Implementar a extração de `xProd` e a expressão de `OBS`.
- Regenerar as definições dos fluxos e executar os testes focados.

## Tarefa 2: implantação e verificação

- Atualizar o bloqueio de deriva para reconhecer exatamente a versão atualmente publicada.
- Executar a suíte fiscal relevante e o build de definições.
- Publicar o fluxo receptor no Power Automate.
- Confirmar o estado `Started`, a igualdade da ação publicada e uma execução de verificação sem escrita financeira inesperada.
- Revisar o diff final e registrar a alteração no repositório.
