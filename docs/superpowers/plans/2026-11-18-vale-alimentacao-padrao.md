# Vale-alimentação: valores gerais

Objetivo: inserir quantidade e valor unitário abaixo do filtro, com alteração em toda a lista e valores iniciais conforme o fluxo de referência, zerando os demais fornecedores.

Implementação direta autorizada pelo pedido e pelas instruções do usuário.

- [x] Cobrir em `meal-voucher-view.test.mjs` a edição geral com filtro ativo, recálculo, edição individual e retorno à primeira etapa.
- [x] Em `meal-voucher-view.js`, acrescentar dois campos gerais exclusivos da alimentação; atualizar modelos e controles sem reconstruir a tela a cada tecla. Manter rascunhos recuperados e transporte.
- [x] Conferir a elegibilidade e os valores do fluxo de referência; cobrir elegíveis e demais zerados. Referência adotada: filtro efetivo do Power Automate em `automations/weekly-meal-provisions/build_flow.py:219`, com CARGO e 5 × R$ 45.
- [ ] Verificar testes apropriados, builds PWA/mobile, trava da assinatura e layout em celular/PC.
- [ ] Revisar, integrar e acompanhar site, Android interno e TestFlight.

Revisão: filtros não limitam a edição geral; alterações individuais continuam possíveis; vírgula decimal e zero funcionam; navegação preserva edições; nenhum lançamento acontece antes da confirmação.

Revisão independente: corrigidos inclusão de novos fornecedores na retomada protegida, metadados de UI na assinatura, divergência entre normalização local e filtro efetivo da automação e reabertura dos valores gerais. Regressões observadas falhando antes e passando depois das correções.
