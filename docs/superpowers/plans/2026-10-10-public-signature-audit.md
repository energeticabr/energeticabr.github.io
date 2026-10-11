# Plano de auditoria pública da assinatura

Spec: ../specs/2026-10-10-public-signature-audit-design.md. Execução inline autorizada pelo usuário.

1. Testes primeiro: observação de eventos e ciclo de vida, registro cifrado e selado, consulta pública e botão em PDF. Demonstrar falha por funcionalidade ausente.
2. `src/web/signature-trace.js`: observador passivo, snapshot e hash PNG. Integrar em `ui/chat-view.js` fora dos blocos protegidos; propagar no controller e cliente. Protocolos: prepare com `public_verification=true`; capture JSON autenticado; finalize PDF. Captura ausente explícita para PNG importado.
3. `backend-patches/public-signature-audit/worker/signature_audit.py`: subclass do store existente, compatibilidade com registros privados antigos, selo Ed25519, AES-GCM para movimentos e imagem, limite de captura, URL aleatória e resultado público mínimo. `signature_public.py`: HTML responsivo seguro com verificação SHA-256 local e download do comprovante. Patch pequeno no bridge para encaminhar rotas GET públicas e POST capture.
4. `src/web/pdf-signing.js`: botão real HTTPS dentro da identificação, sem alterar os blocos de gestos; manter metadados/anotações anteriores. Testar PDF real e renderizar exemplo sem dados pessoais para inspeção.
5. Testar suites, guard, web/PWA. Revisar interfaces e ameaças. Publicar backend com comparação de SHA do bridge, backup e rollback, validar serviço e página pública com exemplo sintético. Commit/PR/merge e publicar web, TestFlight e Play internal, conferir cada resultado.

Rulings: o escopo foi especificado nas mensagens anteriores; não pedir confirmação adicional conforme instrução expressa. A captura detalhada continua privada, pois a consulta pública requerida pode ser satisfeita por resumo/hashes/horários. Sem autenticação individual nova, sem certificar o fornecedor e sem alterar documentos históricos.

Revisão: corrigidos fallback público de email, arbitragem sem deslocamento no WKWebView, traçado vazio ao atingir limite e encerramento ao ir para background. Imagem até 1MiB incluída na captura cifrada; o servidor confere SHA dos bytes e presença dos pixels nos recursos do PDF final. Não é validação visual nem prova individual de autoria. Coalesced samples preservam diferença temporal quando disponível. Testes de exportação real e sequência prepare/capture/sign/confirm/send acrescentados.

Backend publicado em 11/10/2026 02:20 UTC após 44 testes no Linux sem skips, Caddy validado e saúde conferida. Bridge SHA-256 `28b4f8f6e27e0b26fe2442925fb0f6087823c21b1fc75678f605f8175ea4ac47`. Diretório de chaves 0700 e arquivos 0600 verificados no serviço. Demonstração sintética: PDF gerado por pdf-lib, recebido e confirmado no serviço, consulta sem login 200, download do comprovante e verificação local Ed25519 aprovados. Navegador reconheceu PDF final como idêntico e PDF original como divergente; sem envio público do arquivo. Consulta responsiva sem overflow no tamanho de celular. Nenhum documento pessoal foi assinado ou postado para testar.

Verificação final local: 5.282 testes móveis aprovados, builds web/PWA e guard com 14 blocos intactos. Publicação dos pacotes acompanhada no PR e nos workflows da mesma revisão.
