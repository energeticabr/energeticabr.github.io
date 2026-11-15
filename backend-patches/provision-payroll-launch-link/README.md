# Lançamento na folha após a baixa

Após confirmar a baixa, o serviço preenche o ID do lançamento na linha da folha já criada para a provisão. A gravação usa a versão do item no SharePoint e o controle de concorrência dos rateios por lançamento. Uma linha com vínculo anterior mantém seu lançamento. Uma falha de consulta ou gravação retorna à recuperação do vínculo com a baixa já confirmada.

Na galeria, a troca de fornecedor de um lançamento vinculado a uma provisão da folha é recusada para preservar a concordância entre a folha e a provisão.

Gere os candidatos aplicando cada diff à origem indicada no manifesto. Valide e aplique os arquivos com `deploy_combined.py`, passando o diretório com os candidatos e o caminho para `provision-existing-payroll/deploy.py`.

Para testar, defina `WORKFLOW_SOURCE`, `GALLERY_SOURCE_FILE` e `PENDING_SOURCE_FILE` com os caminhos dos candidatos correspondentes e execute `python -m unittest discover -s tests` a partir deste diretório.
