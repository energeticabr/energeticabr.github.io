# Troca de fornecedor de lançamento vinculado à folha

Ao salvar o fornecedor pela Galeria de Lançamentos, o servidor procura em `FOLHAPGTO` pelo `IDLANCAMENTO` exato. Cada pagamento passa para a folha do novo fornecedor na competência da folha original. A linha mantém seu ID, valores, quantidade, datas, tipo e anexos. Quando há uma folha única, `LANCAMENTOS.IDFOLHA` recebe o mesmo vínculo; com várias competências, as linhas mantêm seus vínculos próprios. Um lançamento sem vínculo continua sem folha.

O servidor valida todos os vínculos antes de escrever. Sem uma folha disponível e única na competência, apresenta o motivo e preserva os registros. As escritas usam ETag e fazem leitura de confirmação quando a resposta é ambígua. Se o lançamento não for salvo, a compensação restaura apenas as linhas que ainda têm a versão criada por essa tentativa. Edições concorrentes são preservadas.

`source.patch` altera apenas `worker/launch_gallery.py`. `test_reassign.py` usa o servidor real com o SharePoint simulado pelas fixtures privadas existentes (`GALLERY_SOURCE` e `GALLERY_FIXTURES`). O pacote inclui o runner e o gate já usados em `launch-payroll-attachments`, com hashes fixos, e um manifesto dos hashes de origem e destino para produção e mirror. A regra passa a valer no Android, iOS e Windows/web pelo servidor comum, sem atualização do cliente.
