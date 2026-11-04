# Sincronização da etapa nas atribuições de presença

A atribuição replica o par descritivo/atividade, etapa e imóvel da origem como um conjunto, mesmo que a etapa não tenha mudado na origem. Cada destino é conferido contra o descritivo e o catálogo de atividades antes da primeira gravação. A escolha de atividade consulta a etapa do descritivo; se a consulta falhar, preserva a etapa do rascunho e mantém a validação de consistência.

O pacote constrói candidatos independentes para os dois arquivos de serviço e usa hashes, backup, verificação de saúde e rollback. Os testes usam fixtures em memória; o verificador importa o serviço instalado sem gravar registros reais.
