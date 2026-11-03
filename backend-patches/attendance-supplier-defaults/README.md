# Padrões de fornecedores na validação de presenças

Ao confirmar um lote com alterações efetivas de atividade ou descritivo, o motor apresenta os fornecedores e os valores do par a gravar, com opções Sim, Não e Voltar. A opção Não conserva o envio original de presenças; Sim verifica a identidade, filial, valores e versões atuais antes de registrar o lote e atualizar os cadastros. Quando duas linhas do mesmo fornecedor exigem padrões diferentes, o lote é bloqueado para correção. A gravação usa o journal existente, ETag e leitura de confirmação para suportar retomada sem reaplicar presenças.

As fontes da aplicação e do build são mantidas separadas. `package.py` exige âncoras únicas, verifica sintaxe, gera um candidato independente por origem e registra os hashes de entrada e saída no manifesto. As cópias exatas de entrada e os candidatos ficam fora do Git. `deploy.py` valida manifesto, hashes e saúde, cria backup, instala com compare-and-swap, reinicia a ponte e verifica a saúde, com rollback e proteção contra alteração concorrente.

Em ambiente isolado na VM, os 15 testes de fornecedor e 15 testes de regressão do fluxo passaram para cada candidato; os nove testes de publicação e rollback passaram. As leituras de cadastro dos dois fornecedores mostrados na solicitação confirmaram uma correspondência por nome e filial; os testes de escrita usaram dados fictícios em memória.

Após a instalação, foram executados 33 testes contra o `workflow.py` efetivamente instalado, incluindo entrega da pergunta pelo adaptador real de mensagens e recuperação de uma resposta perdida; todos passaram com serviços externos simulados. A ponte e o serviço de WhatsApp permaneceram saudáveis. O recibo e os hashes estão em `deployment-receipt.json`.
