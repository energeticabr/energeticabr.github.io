# Guias mensais da filial 004

Objetivo: botão INSS e FGTS imediatamente à esquerda de Galeria Holerites; duas solicitações mensais exclusivamente para 004 - EDIFÍCIO XAVANTE, com competência dia 20 do mês anterior e vencimento dia 20 do mês atual. Valor e anexo dependem do usuário.

- [x] Testar planejamento mensal exclusivo da filial ID5, datas20/10/2026 e20/11/2026, virada de ano e preservação de valores/anexos.
- [x] Ajustar `automations/monthly-tax-guides/run.py` e implementar alinhamento inicial idempotente com backup, preflight e ETags exatos. Retirar somente as seis linhas próprias e intocadas das outras filiais; ajustar as duas originais sem tocar valor/anexos.
- [x] Manter os dois botões em uma linha explícita no menu RH; conferir sua posição no celular e Windows e atualizar a orientação da galeria.
- [x] Executar testes focados, guard de assinatura e builds. Revisar, implantar no servidor e confirmar somente duas linhas e segunda execução sem criação.
- [ ] Integrar e publicar a mesma revisão em Pages/Windows, Google Play interno e TestFlight; confirmar recibos.
