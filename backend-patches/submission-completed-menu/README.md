# Confirmação repetida após submissão concluída

O menu posterior à conclusão recebia qualquer texto antes da verificação de
duplicidade. Um segundo clique em `confirm_yes`/`SIM`, com novo identificador,
era interpretado como área; uma resposta antiga também podia atravessar esse
desvio. A criação do estado do menu apagava ainda os identificadores anteriores.
O resultado era `invalid_group` e “ÁREA NÃO RECONHECIDA” apesar da gravação concluída.

A correção em `worker/workflow.py` reapresenta a confirmação quando o lote está
concluído e possui ID persistido, registra o identificador do segundo clique,
verifica respostas duplicadas antes de abrir o menu e preserva esse histórico
na transição. Escolhas reais de área continuam funcionando com um clique.

O backend é compartilhado por Android, iOS e Windows/web. A publicação não exige
novo binário nem reinstalação e não altera registros financeiros existentes.

## Validação

- Nove testes do motor real com armazenamento e dados fictícios passaram.
  Quatro reproduziram a falha antes da correção; outro comprovou a necessidade
  de persistir o identificador do segundo clique.
- Sete testes existentes de conclusão/menu passaram.
- Comparação ampliada de 13 testes existentes: baseline e candidato possuem
  as mesmas três falhas e dois erros legados; nenhuma falha nova. Essa seleção
  não é apresentada como aprovada nem substitui a suíte completa.
- 38 testes do instalador passaram, incluindo hash, lock, gate, instalação
  atômica, backup e rollback. Trava de assinatura: 14 blocos intactos.
- Três testes adicionais verificam inicialização lenta, falha com espera
  limitada e tempo de proteção suficiente para verificação e rollback.
- Revisão independente não encontrou problemas críticos ou importantes.

```sh
SUBMISSION_MENU_SOURCE=/private/candidate python -B test_regression.py -v
python -B test_deploy.py -v
python -B test_startup_wait.py -v
python -B package.py --baseline /private/baseline --candidate /private/candidate --stage /private/release
```

O pacote fixa a revisão ativa, o espelho independente e todos os arquivos de
publicação. `deploy.sh <hash-do-manifesto>` valida o pacote, drena as requisições,
instala somente o arquivo autorizado e verifica a saúde após reiniciar.

A primeira tentativa foi revertida corretamente: a inicialização ultrapassou
a janela original de 15 tentativas. O pacote passou a permitir 60 tentativas,
mantendo os mesmos critérios de saúde. O watchdog de liberação do gate foi
ampliado para cobrir a verificação e eventual rollback; a liberação normal
continua imediata na saída do instalador.

Uma confirmação antiga com identificador nunca observado, entregue somente
após abrir outra área, permanece sujeita à validação normal dessa área.
