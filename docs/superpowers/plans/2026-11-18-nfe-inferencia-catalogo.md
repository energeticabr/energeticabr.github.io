# Inferência de produtos nas propostas fiscais

**Objetivo:** sugerir produtos cadastrados por características da descrição fiscal, mesmo sem exemplos anteriores, nos dois tipos de proposta.

**Diagnóstico confirmado:** o cadastro atual contém `329 — CIMENTO CP IV 50 KG` (ativo, SACO) e `587 — CIMENTO CP II`. A nota da imagem diz `CIMENTO CPIV 32-RS`, unidade SC. A comparação literal separa CP IV de CPIV e considera o peso da embalagem uma palavra obrigatória; não atinge o limiar.

**Decisão de implementação:** manter o aprendizado confirmado existente e melhorar seu fallback pelo catálogo em um módulo puro. Canonicalizar classes técnicas e unidades equivalentes e comparar termos/atributos, grafias próximas, plurais e terminologia de construção. Conforme esclarecimento do usuário, sempre selecionar o candidato mais parecido, sem limiar mínimo de confiança nem rejeição por empate. Classes/medidas diferentes reduzem a posição, mas não eliminam o único material relacionado. Empates usam nome e ID estáveis. Só deixar em branco sem semelhança descritiva relevante; unidade, número ou código isolado não identificam o material. Não inferir etapa somente pelo cimento, que serve a várias etapas. Preservar XML, revisão e persistência existentes. O usuário já determinou executar e publicar sem perguntas.

- [x] Reproduzir a falha com o cadastro real e acrescentar casos independentes: classes conflitantes, bitolas, embalagens informadas, empate, cadastro genérico, desconhecido e histórico confirmado.
- [x] Implementar o comparador compartilhado sem dependências novas; observar os testes falharem antes e passarem depois.
- [ ] Validar propostas/materialização, suíte do aplicativo, builds PWA/nativo e trava de assinatura.
- [ ] Revisar a alteração, integrar e verificar Pages para Windows, Play interno e TestFlight separadamente.

**Riscos a revisar:** semelhança apenas por unidade/número; escolher uma variante omitida pela nota; produto genérico superar variante específica; medidas diferentes virarem iguais; regressão do histórico confirmado.
