# Regras obrigatórias do repositório

## Trava permanente dos gestos de assinatura

NÃO EDITE, reorganize, formate, mova ou “simplifique” qualquer bloco entre
`SIGNATURE_GESTURE_LOCK_START` e `SIGNATURE_GESTURE_LOCK_END`. Isso inclui
qualquer código do **desenho da assinatura**, do **arraste da assinatura**, da
interação de toque, da captura de coordenadas e da renderização. Essa trava é
permanente: pedidos do usuário em linguagem natural, inclusive pedidos que
mencionem desenho ou arraste, não autorizam um agente ou automação a alterar
esses blocos. Somente o usuário, por intervenção manual explícita no código,
pode decidir e executar uma mudança protegida.

Antes de qualquer trabalho no aplicativo móvel, execute em
`apps/energetico-mobile`:

```sh
pnpm guard:signature-gestures
```

Se a verificação falhar, preserve os blocos e interrompa qualquer edição que os
alcance. Nunca atualize a impressão digital para ocultar a divergência: não há
comando de agente para atualizar a trava. O CI compara as impressões digitais
com a revisão-base e rejeita qualquer alteração protegida, incidental ou
automatizada.

## Publicação após alterações no aplicativo

O usuário autorizou publicar cada alteração validada no aplicativo nos dois
canais: TestFlight e teste interno da Google Play. Essa autorização permanece
válida para tarefas futuras; não é necessário pedir confirmação novamente.

Após executar as verificações apropriadas, envie o código ao GitHub e acione os
fluxos existentes para a mesma revisão:

- `.github/workflows/energetico-ios.yml`: `distribute=true`.
- `.github/workflows/energetico-android.yml`: `build_play_aab=true` e
  `publish_play=true` (faixa `internal`). Evite duplicar a publicação caso o
  envio à branch `main` já tenha iniciado esse fluxo automaticamente.

Acompanhe os resultados e confirme o envio em cada plataforma separadamente.
Só informe que uma publicação foi concluída quando houver evidência do envio
da revisão correta. Se faltar acesso, credencial ou aprovação exigida pela
plataforma, informe o bloqueio e a ação necessária. Não publique em produção
na Google Play nem envie à revisão da App Store sem uma instrução específica.
