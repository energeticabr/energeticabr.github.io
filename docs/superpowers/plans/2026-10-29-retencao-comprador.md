# Retenção pelo comprador — implementação

> Executar diretamente com testes antes da implementação, conforme autorização contínua do usuário. Revisão independente ao final.

**Objetivo:** preencher de vermelho a linha de NF-e de entrada com retenções informadas no XML, com indicação textual e valores, mantendo o DANFE à esquerda.

**Arquitetura:** o coletor extrai exclusivamente os totais de retenção de PIS, COFINS, CSLL, IRRF, Previdência e ISS do XML autorizado. SharePoint persiste os seis valores e o estado da análise. A galeria usa valores numéricos positivos, direção de entrada e situação autorizada para destacar o cartão; não calcula obrigação tributária por fornecedor, natureza ou observações.

**Fonte:** MOC 7.0, grupos W01/ISSQNtot/vISSRet e W02/retTrib (https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-anexo-i-leiaute-e-rv.pdf).

**Decisões:** manter cores dos blocos internos e acrescentar fundo vermelho claro ao cartão inteiro, borda vermelha e aviso. Ausência dos campos no XML é “Não informada no XML”, nunca garantia de inexistência de obrigação; resumo permanece pendente. Cancelamento remove alerta ativo. Nenhuma dedução automática no líquido, guia ou pagamento. Optou-se por dados estruturados em vez de palavras soltas, pois “sem retenção”, tributos aproximados e ICMS-ST não comprovam retenção pelo comprador.

- [ ] Testar extração dos seis tributos, zeros/ausências, base sem imposto, ICMS-ST, saída e resumo/eventos; implementar em `src/Sefaz.psm1` da integração.
- [ ] Acrescentar seis colunas Currency e `STATUS_RETENCOES` Text ao provisionamento e merge do receptor; testar preservação em resumos/eventos.
- [ ] Testar vermelho/aviso para entrada autorizada positiva; ausência para zeros, saída, cancelada e pendente. Incluir campos de retenção na seção de tributos e filtro do estado.
- [ ] Validar guard14, testes focados, builds mobile/PWA, 320/390px e revisão independente.
- [ ] Instalar extrator/receptor e preencher apenas metadados de retenção dos XMLs existentes, sem novas consultas SEFAZ ou notificações. Conferir com leitura SharePoint.
- [ ] Publicar a mesma revisão para Windows/PWA, Android interno e TestFlight; abrir e conferir o app publicado e registrar evidências.
