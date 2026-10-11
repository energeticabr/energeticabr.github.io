# Auditoria da assinatura manuscrita

Backend incremental sobre `channel_bridge.py` e `worker/signature_evidence.py` existentes. `patch_bridge.py` só aplica quatro âncoras exatas. Não substituir o bridge a partir de uma cópia antiga.

## Contrato

- POST `/api/portal-signature-evidence?operation=prepare&public_verification=true`: PDF original; conta Microsoft autorizada; retorna URL pública aleatória.
- POST na mesma rota com `operation=capture&record_id=...`: JSON até 4 MiB, conta proprietária. `version=1`, `mode=live|unavailable`, `durationMs`, `truncated`, `strokes[{input,points[{x,y,t,pressure?,tiltX?,tiltY?}]}]`, `inkSha256`, `inkImageBase64` (PNG/JPEG até 1 MiB / 4 megapixels). Sem dados ao vivo: strokes vazio e duração zero. Máximo 20.000 pontos/256 traçados/600 s.
- POST `operation=finalize`: PDF final com protocolo, link exato e pixels da imagem registrada. A captura deve existir antes. Não permite trocar bytes após confirmação. A imagem e os movimentos são cifrados juntos; o servidor valida o hash dos bytes e compara RGBA visível com as imagens incorporadas no PDF. Isso não substitui identificar quem desenhou nem prova a versão canônica do documento.
- GET `/assinaturas/<registro>/<segredo-256-bits>`: sem autenticação. Não lista registros, não entrega PDF ou dados biométricos brutos. `/registro` fornece comprovante JSON assinado pela aplicação.

A página pública exibe os dados do documento e os hashes SHA-256 registrados, sem seletor ou comparação de PDF. Não há upload público. Selo Ed25519 dos metadados e comprovante; AES-256-GCM do traçado, com nonce aleatório e vínculo ao registro/hash original. Chaves persistidas em diretório 0700, arquivos 0600, ao lado das evidências privadas. Backup protegido das evidências deve incluir `.audit-keys`; perder as chaves impede verificar/decriptar registros. Não regenerar as chaves de registros existentes.

Registros existentes sem opt-in continuam privados. Não inferir captura, autenticação do fornecedor ou pressão a partir de imagem reutilizada. O servidor registra recebimento e confirmação; não representa carimbo de tempo independente. O selo é da aplicação e não constitui certificado ICP-Brasil individual. Não vincula automaticamente o snapshot a uma versão canônica do SharePoint.

## Publicação

Validar módulos e testes antes. Conferir SHA-256 atual do bridge, backup root-only do bridge/Caddyfile, instalar módulos sem alterar o armazenamento histórico, aplicar patch à versão atual, adicionar `handle /assinaturas/*` ao Caddy para 127.0.0.1:8765, validar Caddy e reiniciar o bridge. Em falha de saúde restaurar bridge/Caddy, mantendo as evidências criadas.

Frontend: `pnpm guard:signature-gestures`, `pnpm test`, builds web/PWA. Os 14 blocos protegidos permanecem byte-a-byte intactos; o observador não cancela eventos, não muda capturas nem renderiza. Publicar web, TestFlight e Play internal na mesma revisão após validação.
