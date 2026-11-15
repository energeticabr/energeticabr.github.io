# Vínculo manual de provisões da folha

A ação **Vincular** verifica o acesso, os dados da folha e a disponibilidade do lançamento antes de reservar o par. Após confirmar os dois lados do vínculo, o servidor completa a folha com o mesmo controle de concorrência e retomada da baixa automática.

A interface conclui a baixa após receber a confirmação para o mesmo lançamento e a mesma provisão. Em caso de falha, o vínculo reservado permite retomar essa operação. Provisões comuns seguem o fluxo existente.

Gere os candidatos aplicando os diffs às origens do manifesto. Use `deploy.py` com o diretório dos candidatos e o caminho de `provision-existing-payroll/deploy.py`. Os testes leem os candidatos `workflow.py`, `launch_gallery.py` e `channel_bridge.py` no diretório indicado por `MANUAL_LINK_SOURCE`.
