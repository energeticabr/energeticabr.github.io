# INSS no menu inicial — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans, com revisão final independente.

**Goal:** Adicionar o mascote INSS imediatamente à esquerda do RHID e mostrar os registros INSS/FGTS em relatório sobre o menu inicial.

**Architecture:** Reutilizar a leitura autenticada `taxGuides` da lista GUIASINSSFGTS. Um relatório próprio apresenta vencimento, competência, filial, valor, tipo e acesso aos anexos reais, com filtros e atualização. Fechar restaura o menu e o foco; a galeria existente continua sendo o local de preenchimento.

**Tech Stack:** JavaScript, DOM, CSS, Vite, testes Node/JSDOM e Chrome.

**Spec:** Pedido e foto do usuário nesta conversa; executar sem nova confirmação conforme instrução permanente.

## Global Constraints

- INSS fica à esquerda do RHID, com mascote e nome visível; manter os outros atalhos funcionais.
- Nenhuma escrita em guias, valores ou anexos neste relatório de consulta.
- Preservar os 14 blocos protegidos de assinatura.
- Publicar Web/Windows, Google Play interno e TestFlight após validar.

## Review Focus

- Larguras estreitas: INSS e RHID na mesma linha, sem sobrepor os atalhos comerciais.
- Valor nulo permanece A informar; zero real aparece como R$ 0,00.
- Resposta atrasada após fechar/sair não pode reabrir o relatório.
- Anexos permanecem vinculados à linha correta e usam o visualizador existente.
- Login/retomada e volta do relatório preservam a conversa atual.

## Tarefa única: atalho e relatório

- [x] Testar primeiro os dados, filtros, zero/nulo, anexos e cancelamento em `tests/tax-guides-report.test.mjs`; observar falha antes de implementar.
- [x] Criar `src/ui/tax-guides-report-view.js` e CSS próprio, com `createTaxGuidesReportView({document,data,openMediaCollection})`, `element/open/close/destroy`, paisagem, foco e backdrop.
- [x] Ligar `open-tax-guides-report` ao controlador, leitura `taxGuides` e allowlist de retomada; incluir título de impressão.
- [x] Acrescentar mascote INSS e CSS junto do RHID; atualizar contratos de quantidade/ordem dos atalhos.
- [x] Verificar clique real, dados e fechamento nos testes de retorno ao menu; medir posição e ausência de sobreposição em 320/365/366/375/390/414/425/426/1365px.
- [ ] Executar testes relacionados, builds PWA/nativo e guard; revisar, integrar e acompanhar os três canais até os recibos.
