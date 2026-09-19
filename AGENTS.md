# Regras obrigatórias do repositório

## Trava permanente dos gestos de assinatura

NÃO EDITE, reorganize, formate, mova ou “simplifique” qualquer bloco entre
`SIGNATURE_GESTURE_LOCK_START` e `SIGNATURE_GESTURE_LOCK_END` sem que a
solicitação atual do usuário mencione explicitamente o **desenho da assinatura**
ou o **arraste da assinatura**. Pedidos genéricos sobre assinatura, PDF,
redimensionamento, layout, anexos ou fluxos de documentos não autorizam essas
alterações.

Antes de qualquer trabalho no aplicativo móvel, execute em
`apps/energetico-mobile`:

```sh
pnpm guard:signature-gestures
```

Se a verificação falhar e a solicitação atual não contiver a autorização
explícita acima, preserve os blocos e interrompa qualquer edição que os alcance.
Não atualize o manifesto para ocultar a divergência.

Quando — e somente quando — houver autorização explícita, aplique a alteração
com testes de regressão e atualize a impressão digital usando o texto integral
do pedido atual:

```sh
pnpm guard:signature-gestures:update -- --authorization "<pedido literal do usuário>"
pnpm guard:signature-gestures
```

Nunca edite manualmente `signature-gesture-lock.json`. O código protegido, os
testes e a nova impressão digital devem permanecer na mesma alteração. O CI
compara a autorização e as impressões digitais com a revisão-base e rejeita
alterações incidentais ou a reutilização de uma autorização anterior.
