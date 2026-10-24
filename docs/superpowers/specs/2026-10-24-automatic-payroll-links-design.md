# Vínculo automático e recuperável dos lançamentos à folha

## Intenção e escopo

Impedir a repetição da falha dos vales Swile do pedido 440: o lançamento existia, mas o upload interrompia o fluxo antes da criação de FOLHAPGTO. A regra nova vale para as entradas de vale-refeição e de folha do aplicativo. A correção histórica permanece limitada ao pedido 440; não executar pagamentos ou migrar outros pedidos.

## Decisão de implementação

O SharePoint não oferece transação atômica entre LANCAMENTOS e FOLHAPGTO. Portanto, cada novo lançamento de folha deve carregar IDFOLHA no próprio POST, como referência técnica, além de receber seu vínculo FOLHAPGTO imediatamente e antes de anexos ou da próxima linha. Nunca anunciar conclusão até confirmar ambos por releitura. Uma falha de rede pode deixar o vínculo complementar pendente, mas não deixa o lançamento sem sua referência à folha e a retomada reutiliza os mesmos IDs.

Adicionar a coluna numérica opcional IDFOLHA em LANCAMENTOS, sem torná-la obrigatória para despesas não relacionadas à folha. Validar o schema antes de qualquer registro financeiro. Resolver a folha única pelo fornecedor e competência previamente confirmados; INSS/FGTS continuam na competência própria já escolhida. Se não houver folha única, bloquear antes de gravar, sem criar uma folha por suposição.

## Alternativas consideradas

- Apenas mover FOLHAPGTO antes do upload: resolve falha do anexo, mas não preserva a referência caso o POST do vínculo falhe.
- Criar vínculo antes do lançamento: deixa um pagamento de folha sem lançamento de origem e exige compensação arriscada.
- Referência no mesmo POST do lançamento e vínculo por linha: escolhida pelo agente para atender a garantia, com retomada idempotente e sem transação financeira compensatória.

## Compatibilidade e segurança

Referências existentes divergentes nunca são sobrescritas. Ao retomar a mesma operação antiga, referência vazia só pode ser preenchida após conferir todos os dados originais e a versão ETag; vínculos existentes incompatíveis bloqueiam a retomada. Um vínculo compatível da mesma origem é reutilizado, mesmo se o título técnico diferir. Preservar os tokens originais, anexos apenas no pedido e último lançamento do vale, revisão do lote e travas de sessão. Não editar blocos de assinatura.

Registrar uma tentativa pendente em armazenamento persistente antes de cada POST financeiro. Se a resposta for incerta e o registro ainda não estiver visível, a retomada deve aguardar a reconciliação, não repetir o POST. Somente uma rejeição HTTP inequívoca libera outra tentativa. Coordenar escritores participantes por operação/origem; reler associações pela origem antes de criar ou adotar referência legada, sem depender de um snapshot antigo. As consultas novas de associação devem ser filtradas por IDLANCAMENTO, sem exigir varrer todo o histórico. Campos originalmente vazios também entram na conferência final.

## Aceitação

Cobrir falha de vínculo e de upload, resposta perdida, primeira linha confirmada antes da segunda, retomada sem duplicar, schema ausente/incompatível, competência inexistente/duplicada e referência divergente. Validar com dados fictícios. Publicar a mesma revisão em web/Windows, Play internal e TestFlight e só declarar publicação após comprovantes de cada canal.
