# Justificativa como motivação da ausência

Ao validar AUSENTE, o fluxo consulta a justificativa atual (`IRREGULARIDADES`)
do mesmo ID e data, usa esse texto como `MOTIVACAO` e segue ao resumo sem
repetir a pergunta. Sem justificativa, mantém a pergunta existente. A escolha
FERIADO e a edição explícita de motivação continuam disponíveis. PRESENTE
não recebe o motivo de ausência.

No lote, cada registro conserva sua justificativa; a pergunta complementar
se aplica apenas aos IDs sem texto. O resumo apresenta as motivações antes
da confirmação. Alterações concorrentes exigem um resumo atualizado; os
registros usam o controle de versão existente para impedir uma escrita com
justificativa desatualizada. `IRREGULARIDADES` não é alterado pelo patch.

Somente `worker/workflow.py` do backend compartilhado é publicado. Android,
iOS e Windows/web instalados recebem a alteração sem novo binário. O espelho
de compilação é conferido por hash e permanece intacto.

## Validação

`ABSENCE_JUSTIFICATION_SOURCE` deve apontar para um snapshot privado do
backend com as fixtures em memória de `tests/test_workflow.py`. Os testes
não acessam SharePoint nem enviam mensagens reais.

```sh
ABSENCE_JUSTIFICATION_SOURCE=/private/candidate python -B test_regression.py -v
python -B test_deploy.py -v
python -B package.py --baseline /private/baseline --candidate /private/candidate --stage /private/release
```

A publicação usa manifesto e hashes, lock compartilhado, bloqueio breve de
novas requisições, drenagem, backup, instalação atômica, verificação de saúde
e rollback. A fonte completa e configurações operacionais ficam fora do Git.
