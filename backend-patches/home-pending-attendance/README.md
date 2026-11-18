# Aviso de presenças de todas as datas

Pedido: manter o aviso vermelho PRESENÇAS no menu principal enquanto houver
qualquer presença pendente de validação, incluindo dias anteriores.

O patch mantém `start_today_pending_attendance` por compatibilidade com os
clientes instalados. Consulta a fonte de registros existente sem o filtro DATA,
preservando os demais filtros e reforçando PRESENCA=PENDENTE. Conta IDs únicos.
Ao clicar, reconsulta as pendências e inicia o seletor de datas da validação
existente. Não submete ou altera presenças ao exibir ou abrir o aviso.

Esta regra fica no servidor compartilhado por Android, iOS e web/Windows.
Não há mudança nos binários ou assets do aplicativo.

## Verificação

- O baseline de produção falhou nos cenários de pendências antigas e consulta
  sem filtro de data. O candidato passou os oito testes de integração com o
  workflow real e serviços externos em memória, incluindo escolher data antiga.
- Consulta real com escritas remotas bloqueadas encontrou oito pendências de
  17/11/2026 e confirmou `👷 PRESENÇAS (8)` com tom `danger` em 18/11/2026.
- Fonte mantém seu limite existente `top=5000`; o patch não muda paginação.
- `deploy.py --check` valida hashes independentes de produção e espelho,
  preservando divergências preexistentes e finais de linha de cada arquivo.
  A instalação usa os dois locks compartilhados, cópias recuperáveis,
  comparação de hashes e verificação de saúde após reiniciar o bridge.
- Configuração, credenciais e registros SharePoint permanecem preservados.

## Comandos no servidor

```sh
sudo env ATTENDANCE_CANDIDATE=/home/opc/presence-pending-20261118/candidate \
  /opt/energetica-whatsapp/.venv/bin/python \
  /home/opc/presence-pending-20261118/test_home_pending.py -v
sudo python3 /home/opc/presence-pending-20261118/deploy.py --check
sudo python3 /home/opc/presence-pending-20261118/deploy.py --apply
sudo /opt/energetica-whatsapp/.venv/bin/python \
  /home/opc/presence-pending-20261118/verify_readonly.py
```

Produção antes: `4801ef5206e78c176176017204702f6fc09a650b554efd8397ce789a145cbc8b`.
Candidato testado: `0335a0a4371c85d70e2b88e1169b520b2cb5ce162342d73768129cfdc90aed79`.
