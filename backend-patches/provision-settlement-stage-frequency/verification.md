# Verificação da publicação

## Resultado

- Publicado em 2026-11-24 13:24:25 UTC no backend compartilhado.
- Baseline de produção: `131b5f5956c0d2b4bac60a7de380e81a3b8700ea8eeae8033962f4f709b9caef`.
- Hash instalado em `/opt/energetica-whatsapp/worker/workflow.py`: `6c3714be08db697760d99d7d76fc3042df684ba16e192defbbc9d74e87dbe4af`.
- Mirror somente leitura `/home/opc/energetica-build/worker/workflow.py`: `a77df64274c20e1ae175d074ae7b96cb51cf6b5e7ba4ca0c917783d94a16dbc3` antes e depois.
- `energetica-channel-bridge.service` e `energetica-whatsmeow.service`: ativos; health local do bridge: `{"status":"ok","channel":"generic"}`; health HTTPS público: `ok`.
- Backup e recibo: `/var/backups/energetica-whatsapp/provision-settlement-stage-frequency/launch-payroll-per-payment-20261124T132425316205Z`.
- A regra atende Windows/web, Android e iOS pelo endpoint compartilhado `/api/portal-chat`; nenhum bundle ou binário foi alterado.
- `pnpm guard:signature-gestures`: 14 blocos intactos antes e depois da alteração.
- A checagem de implantação compilou o candidato e validou baseline, manifesto, mirror e saúde antes da instalação.
- Testes automatizados não foram executados.

## Tentativa revertida

A primeira instalação foi revertida automaticamente com o hash de produção restaurado. Os logs mostraram que `channel_bridge_started` ocorreu 18 segundos após o reinício, além da janela original de health check de 15 segundos. A segunda tentativa ampliou a espera para até 60 segundos e concluiu sem rollback.
