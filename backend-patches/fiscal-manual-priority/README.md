# Prioridade da consulta fiscal manual

O ciclo automático executava CT-e/NFS-e antes de tentar obter um trabalho NF-e. O intervalo da SEFAZ podia terminar durante essas fontes; nesse caso, a consulta automática usava a janela antes do pedido manual, que era adiado por mais 65 minutos.

`local_bridge.py` verifica novamente a fila manual no momento de obter um trabalho automático NF-e e reserva uma janela manual que vencerá nos próximos dois minutos (incluindo o tempo do bridge e a inicialização do processo). Usa o mesmo `next_wake` do coordenador. Mantém CT-e/NFS-e, notificações, renovação e conclusão de leases automáticos em funcionamento.

Destino de instalação: `/opt/energetica-whatsapp/fiscal-collector/local_bridge.py`. Instalar sob o lock do supervisor, com backup e comparação do hash anterior. Não alterar configuração, NSU, intervalo SEFAZ ou documentos financeiros. O reparo é compartilhado por Android, iOS e Windows.

Testes: `python -m unittest discover -s backend-patches/fiscal-manual-priority -p "test_*.py" -v`. Não fazem consultas fiscais reais.
