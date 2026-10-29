# Baixa de provisões SWILE por funcionário

Descritivos SWILE podem reunir provisões individuais de funcionários. O pedido comum fica no fornecedor SWILE, e cada lançamento e provisão conserva seu fornecedor original. O grupo continua exigindo filial única, proprietários originais íntegros, ausência de vínculos conflitantes, confirmação do usuário e chaves duráveis de retomada.

Também são conferidos os anexos: o fornecedor do pedido compartilhado deve corresponder ao descritivo SWILE da mesma filial, e o lançamento deve continuar vinculado ao funcionário da provisão. ETags, snapshots congelados, hashes dos arquivos e o caminho genérico estrito permanecem ativos. DIVERSOS conserva o comportamento anterior. Outros fornecedores mistos continuam recusados.

A falha foi reproduzida na tentativa preservada antes de qualquer journal/intenção de gravação. A implantação não altera o rascunho nem submete automaticamente o pagamento. Após a atualização, o usuário pode usar TENTAR NOVAMENTE.

Testes: fixtures com baixa completa, falha parcial/retomada, fornecedor SWILE no pedido, funcionários nos lançamentos, cópia de anexos e recusa de destinos divergentes. As regressões existentes de anexos também são executadas. Tudo usa conectores em memória, sem gravações reais. Os testes dependem do backend privado e das fixtures test_single_order.py, test_scoped_fanout.py e test_parent_fanout.py.

Pacote exato de três módulos da VM; diff e manifesto públicos, bundle completo privado. O instalador reutiliza o runner verificado, fixa os hashes de produção e espelho separadamente, usa lock, backup, rollback e checagem de saúde. A correção atende Android, iOS e Windows/web pelo serviço compartilhado, sem novos binários.
