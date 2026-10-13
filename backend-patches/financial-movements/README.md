# Movimentações financeiras

The FINANCEIRO menu adds APONTAR MOVIMENTAÇÃO, paired in the shared mobile/web
client with GALERIA DE MOVIMENTAÇÃO. Four ordered fields write to the personal
MOVIMENTACOESFINANCEIRAS list after review: INSTITUICAO, DESCRICAO, OPERACAO,
VALOR. Live metadata confirmed all four are Text; OPERACAO has no choice list.
Institution choices come from INSTITUICAOEMISSORA and descriptions from CADASTRO
INVESTIMENTO filtered by the chosen institution. Amounts must be greater than
zero. Existing idempotency and confirmation logic is retained.

Both catalog questions include the existing nested registration action. A new
investment for a different institution is saved to its own catalog but cannot
silently populate the movement's description. The original question is restored.
Gallery creation, filters, full-screen editing and existing ETag/mutation guards
are reused; institution and description are selection-only and revalidated before
an edit is saved. No test records are written to live financial lists.

`install.py` adds only the new action and flow to the exact production baseline.
`deploy.py` pins candidates and both destination baselines, backs up each file,
preserves owner/mode, atomically installs, restarts and checks health/hashes, with
rollback on failure. The build configuration mirror was older than production;
its separately pinned baseline is backed up and synchronized to the candidate.
Production configuration and secrets are never committed. `manifest.json` is
the active deployment record for this change; financial-inline-catalog manifests
describe their historical deployments, before this helper extension.

Validation: real workflow engine with isolated adapters, including confirmation,
dependent choices, nested return, malformed amounts and escaped OData; existing
financial regressions; actual dynamic-form DOM behavior and gallery service tests;
shared native and PWA builds and signature gesture guard.
