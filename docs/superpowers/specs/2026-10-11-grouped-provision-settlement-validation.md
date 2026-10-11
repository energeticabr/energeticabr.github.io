# Validação — baixa por descritivo

Branch: `feat/grouped-provision-settlement-20261011`; base `ac0d5744b4a540f421d9b330f2f89d6106327b23`.

## Contrato validado

- Popup e relatórios do menu Pendências consultam DESCRITIVOPROVISAO; total decimal exato de todos os filhos, inclusive pagos. Apenas filhos ainda pendentes entram na baixa.
- Data efetiva, forma de pagamento e observação compartilhadas, solicitadas uma vez. Quantidade, preço, frete, pedidos/lançamentos opcionais e demais dados são individuais, editáveis por item no resumo.
- Confirmação grava/verifica o pai primeiro, depois cada filho em ordem numérica. Journal durável preserva retomada e respostas perdidas sem recriar registros opcionais ou repetir filhos confirmados.
- Versões, vínculos e valores concorrentes são revalidados. Durante uma gravação ambígua, anexos/dados ficam congelados, inclusive contra botões antigos de revisão.
- Metadados reais confirmaram PGTOAGENDADO do pai como DateTime; data de agendamento preservada. Aliases de datas canônicas e leitura com ETag conferidos na VM.
- Consulta real somente leitura encontrou 13 grupos pendentes: 10 válidos e 3 bloqueados por preço unitário nulo. Valor desconhecido aparece como — e baixa é bloqueada. Nenhum dado financeiro foi gravado nos testes.
- Compatibilidade de versões: somente o app que solicita `sourceKind: provision-description` recebe IDs do pai. Apps instalados antigos continuam recebendo IDs de filhos, evitando editar um registro errado com ID coincidente enquanto o usuário atualiza o aparelho. Fonte desconhecida é recusada e a consulta agrupada não cai silenciosamente na antiga.

## Evidências automatizadas e visuais

- Backend específico: 161 testes passaram. Coordenador/compatibilidade: 35 testes passaram também no Python 3.9 real da VM, usando conectores fictícios e diretório temporário isolado. Cliente autenticado: 45/45, incluindo namespace explícito.
- Instalador: 9 testes passaram, incluindo hashes/escopo, montagem sem Git, compilação de montagem reutilizada, deriva, checagem sem alteração e rollback com restauração de ambos os roots.
- App: suíte inicial completa 5307/5307 aprovada; foco final 758/758 aprovado. Execução completa portal/app antes da camada final de compatibilidade: 6283 aprovados, 6 ignorados, zero falhas (6289 casos). Nova execução final e CI conferidos antes de integrar. Guard: 14 blocos de gestos de assinatura intactos. Builds web e PWA, inclusive PWA final compatível, aprovados.
- Prévia vertical 390 × 844 e atalho check→fluxo conferidos com fixture totalmente fictícia `tests/fixtures/grouped-provision-popup.html`. Popup fechado antes de iniciar o fluxo; nenhum pagamento real foi baixado.
- Checagem do estágio final v5 aprovada: seis hashes exatos e compilação no Python da VM. Consulta somente GET confirmou fonte, grupos, leitura fresca e ETag, com zero gravação financeira.

## Rulings e revisão

A suíte histórica do espelho não é uma baseline verde: a produção inalterada tinha 631 falhas / 1665 aprovados; o candidato comparável final tinha 628 falhas / 1775 aprovados, sem identidade nova de falha e com três falhas antigas de edição/ETag removidas. Não se afirma que toda a suíte legada passou. Três testes não coletáveis em Windows (webhook não incluído no arquivo de suporte e dois watchdogs Unix/resource) foram excluídos igualmente das duas árvores. A última regressão isolada de pré-validação foi adicionalmente verificada nos testes específicos e no Python real da VM.

Revisão independente encontrou e exigiu regressões red→green para: OBS vazia com serializador real, primeira rejeição definitiva de versão, escolha explícita do item para edição, botão antigo de revisão após nova tentativa ambígua, rejeição de pré-validação na retomada, proteção Git do bundle privado e compilação na reutilização de montagem. Todos foram corrigidos; revisão final independente confirmou ausência de Critical/Important e prontidão do código. Não há achado menor deliberadamente adiado. Versões publicadas são conferidas antes da entrega ao usuário.

## Publicação e recuperação

Manifesto pinado: `8cacbe16c40aaa9f31b8254b9cecb6f1fa4becf19855a2eded3c611cafff5fa1`. Somente seis arquivos de código são instalados, com backup de produção e espelho; configuração, estado de conversas, documentos, anexos e segredos não são alterados. O arquivo privado de fontes e logs ficam ignorados em `artifacts/grouped-provision-settlement/`, fora do commit público.

Integração via PR revisado e CI; publicação web/Windows, Google Play interno e TestFlight conforme workflows existentes. Verificar produção por GET após implantação e popup publicado sem submeter pagamentos reais. Recibo do backup, IDs dos workflows, versões e confirmação de distribuição são preservados nos artefatos privados da entrega.
