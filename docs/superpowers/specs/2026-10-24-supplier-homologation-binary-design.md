# Homologação do fornecedor: resposta direta

O usuário quer responder se o fornecedor exige homologação com SIM ou NÃO,
sem a confirmação ambígua `SIM, MANTER — NÃO`.

## Abordagem

Corrigir a etapa `supply_supplier_registration_flow / homologacao_fornecedor_suprimentos`
no servidor compartilhado. Remover `confirm_recommended` e a apresentação de
recomendação nas duas fontes condicionais; preservar os IDs e valores existentes
para não inverter respostas de botões antigos. Atualizar as opções dessa etapa
antes de resolver uma resposta de sessão em cache. A ação antiga de expandir deve
apenas reapresentar SIM/NÃO, sem gravar resposta ou avançar.

Só renomear o botão manteria o significado errado. Alterar o mecanismo genérico
de recomendações afetaria outras perguntas e não é necessário.

## Limites e verificação

- SIM grava `HOMOLOGAÇÃO=SIM`; NÃO grava `HOMOLOGAÇÃO=NÃO`.
- Sem opção em branco, recomendação, filtro ou etapa extra nessa pergunta.
- Preservar navegação e contexto do lançamento/cadastro embutido.
- Não alterar dados existentes nem publicar registros de teste no SharePoint.
- Publicar o servidor e seu espelho de build; os três clientes existentes
  recebem a definição corrigida sem necessidade de novo binário.
- Testar fonte real, opções emitidas, respostas de ambos os ramos, retomada,
  botões legados e escopo restrito. Usar CAS e cópia de recuperação na publicação.
