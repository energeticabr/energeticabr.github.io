# Lançamento na folha após a baixa

Após confirmar a baixa, o serviço preenche o ID do lançamento na linha da folha já criada para a provisão. A gravação usa a versão do item no SharePoint. Uma linha que já tem lançamento mantém seu vínculo. Uma falha de consulta ou gravação retorna à recuperação do vínculo com a baixa já confirmada.

Os diffs e hashes correspondem às duas revisões do serviço. Gere os candidatos aplicando cada diff à origem indicada no manifesto e use o instalador de `provision-existing-payroll` para validar e aplicar os dois arquivos.

Para testar, defina `WORKFLOW_SOURCE` com o caminho do candidato e execute `python -m unittest discover -s tests` a partir deste diretório.
