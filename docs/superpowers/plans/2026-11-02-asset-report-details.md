# Relatório de imobilizados - implementação

Objetivo: mostrar somente os 13 campos solicitados, em blocos de identificação, valores, datas e depreciação. Compra vem imediatamente antes do residual; rótulo do residual inclui (compra - residual) / compra * 100 com uma casa decimal. Compra ausente ou não positiva não produz percentual. Status ATIVO verde, INATIVO vermelho, outros neutros. Preservar histórico, dados gravados, nomes extensos e acessibilidade.

- [x] Testes de campos permitidos, cálculo acumulado e status: falhas observadas, depois 19 testes focados aprovados.
- [x] Seleção e agrupamento na apresentação compartilhada e estilos responsivos.
- [ ] Dados fictícios em 320/390/1365px nas duas galerias, suíte, guardas e builds.
- [ ] Revisão, publicação web/Windows, Android interno e iOS TestFlight; verificar cada destino.

Decisão: alterar somente apresentação; cadastro e histórico permanecem completos na origem.
