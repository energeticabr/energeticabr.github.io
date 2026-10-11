"""Public minimal receipt and private authenticated trace ingestion."""
import html
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

from signature_audit import AuditedSignatureEvidenceStore, canonical
from signature_evidence import EvidenceConflict


def store_for(handler):
    cls = type(handler)
    with cls.portal_signature_evidence_lock:
        store = cls.portal_signature_evidence_store
        if store is None or store.root.parent != handler.portal_upload_store.data_root:
            store = AuditedSignatureEvidenceStore(data_root=handler.portal_upload_store.data_root)
            cls.portal_signature_evidence_store = store
    return store


def process_capture(handler, origin_allowed):
    origin = handler.headers.get("Origin", "")
    if not origin_allowed(origin, handler.portal_origins):
        return handler._send_json(403, {"error": "forbidden origin"})
    try:
        identity = handler._portal_identity()
        handler.bridge.portal_authorize(identity, allowed_emails=handler.portal_authenticator.allowed_emails)
        query = parse_qs(urlsplit(handler.path).query, keep_blank_values=True)
        if any(len(values) != 1 for values in query.values()):
            raise ValueError("Parâmetros duplicados")
        length = int(handler.headers.get("Content-Length", "0"))
        if not 0 < length <= 4 * 1024 * 1024 or handler.headers.get("Transfer-Encoding"):
            raise ValueError("Captura acima do limite ou incompleta")
        if handler.headers.get_content_type() != "application/json":
            raise ValueError("Formato de captura inválido")
        value = json.loads(handler.rfile.read(length))
        result = store_for(handler).capture(value, identity=identity, record_id=query.get("record_id", [""])[0])
        return handler._send_json(200, result, cors_origin=origin)
    except PermissionError:
        return handler._send_json(401, {"error": "Conta não autorizada"}, cors_origin=origin)
    except FileNotFoundError:
        return handler._send_json(404, {"error": "Registro não encontrado"}, cors_origin=origin)
    except EvidenceConflict as exc:
        return handler._send_json(409, {"error": str(exc)}, cors_origin=origin)
    except (ValueError, TypeError):
        return handler._send_json(422, {"error": "Dados de captura inválidos"}, cors_origin=origin)
    except Exception:
        return handler._send_json(500, {"error": "Não foi possível preservar a captura"}, cors_origin=origin)


def public_page(receipt, path, nonce):
    data = receipt["payload"]
    escape = lambda value: html.escape(str(value), quote=True)
    capture = data["capture"]
    capture_label = "Desenhada nesta sessão" if capture["mode"] == "live" else "Imagem sem dados de traçado ao vivo"
    input_labels = {"pen": "caneta", "touch": "toque", "mouse": "mouse"}
    summary = f'{capture["strokeCount"]} traçados · {capture["pointCount"]} amostras · {capture["durationMs"] / 1000:g} s'
    inputs = ", ".join(input_labels[key] for key in capture["inputs"]) or "não disponível"
    hashes = "".join(f'<dt>{label}</dt><dd class="hash">{escape(data[key])}</dd>' for label, key in [
        ("SHA-256 do PDF original", "sourceSha256"), ("SHA-256 do PDF final", "finalSha256"),
        ("SHA-256 dos dados de captura", "traceSha256"), ("SHA-256 da imagem da assinatura", "inkSha256")])
    def time_label(value):
        instant = datetime.fromisoformat(value.replace('Z', '+00:00'))
        local = instant.astimezone(timezone(timedelta(hours=-3)))
        return escape(local.strftime('%d/%m/%Y às %H:%M:%S')) + ' (Brasília, UTC−03)'
    return f'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verificar assinatura · Energética</title>
<style nonce="{nonce}">*{{box-sizing:border-box}}body{{margin:0;background:#edf5f7;color:#163447;font:16px system-ui,-apple-system,sans-serif}}main{{max-width:820px;margin:auto;padding:24px 16px 40px}}header{{color:#0b5666;margin-bottom:24px}}h1{{font-size:27px;margin:8px 0}}h2{{font-size:21px}}section{{background:white;border:1px solid #c5d8dd;border-radius:16px;padding:20px;margin:16px 0}}.badge{{display:inline-block;border-radius:20px;background:#e1f3e8;color:#17613e;padding:8px 12px;font-weight:700}}dt{{font-weight:700;margin-top:18px}}dd{{margin:5px 0;line-height:1.5}}.hash{{font-family:ui-monospace,monospace;overflow-wrap:anywhere;font-size:14px}}.note{{font-size:14px;line-height:1.55;color:#4f6570}}.button{{display:inline-block;background:#0b5666;color:white;border-radius:10px;padding:12px 16px;text-decoration:none;font-weight:700}}@media print{{body{{background:white}}section{{break-inside:avoid}}}}</style></head><body><main>
<header><strong>ENERGÉTICA</strong><h1>Verificar assinatura</h1><p>Comprovante vinculado ao documento</p></header>
<section><span class="badge">Registro preservado e selo conferido</span><h2>{escape(data["signerName"])}</h2>
<dl><dt>Documento</dt><dd>{escape(data["fileName"])}</dd><dt>Registro</dt><dd class="hash">{escape(data["id"])}</dd>
<dt>PDF gravado no servidor</dt><dd>{time_label(data["confirmedAt"])}</dd><dt>Traçado recebido no servidor</dt><dd>{time_label(data["captureReceivedAt"])}</dd><dt>Registro iniciado no servidor</dt><dd>{time_label(data["preparedAt"])}</dd>
<dt>Operador do aplicativo</dt><dd>{escape(data["operatorName"])}</dd><dt>Identificação</dt><dd>{escape(data["identityMethod"])}</dd></dl></section>
<section><h2>Dados da captura</h2><dl><dt>Método</dt><dd>{capture_label}</dd><dt>Entrada</dt><dd>{escape(inputs)}</dd><dt>Resumo</dt><dd>{escape(summary)}</dd><dt>Pressão / inclinação da caneta</dt><dd>{'Disponível' if capture["pressureAvailable"] else 'Não disponível'} / {'Disponível' if capture["tiltAvailable"] else 'Não disponível'}</dd><dt>Limite de captura atingido</dt><dd>{'Sim; dados parciais' if capture["truncated"] else 'Não'}</dd></dl><p class="note">Posições e tempos relativos foram enviados pelo aplicativo. Movimentos detalhados ficam cifrados e não são divulgados nesta página.</p></section>
<section><h2>Integridade e comprovante</h2><dl>{hashes}<dt>Imagem da assinatura no PDF</dt><dd>{escape(data['inkBinding'])}</dd><dt>Selo do comprovante</dt><dd>Ed25519 · selo da aplicação Energética</dd><dt>Identificador da chave pública</dt><dd class="hash">{escape(receipt["keyId"])}</dd></dl><p><a class="button" href="{escape(path)}/registro" download="comprovante-assinatura.json">Baixar comprovante assinado</a></p><p class="note">Qualquer pessoa com este link pode consultar este comprovante. O PDF e os anexos permanecem privados. O selo não é um certificado ICP-Brasil do fornecedor, e o horário do servidor não é um carimbo de tempo independente.</p></section>
</main></body></html>'''


def process_public(handler):
    def error(code, message):
        content = canonical({'error': message})
        handler.send_response(code)
        for key, value in {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': str(len(content)),
            'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
            'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"}.items():
            handler.send_header(key, value)
        handler.end_headers(); handler.wfile.write(content)
    path = urlsplit(handler.path).path
    match = re.fullmatch(r"/assinaturas/([0-9a-f]{32})/([0-9a-f]{64})(/registro)?", path)
    if not match:
        return error(404, "Registro não encontrado")
    try:
        receipt = store_for(handler).public_receipt(match[1], match[2])
        nonce = secrets.token_urlsafe(18)
        download = bool(match[3])
        content = canonical(receipt) if download else public_page(receipt, path, nonce).encode("utf-8")
        handler.send_response(200)
        handler.send_header("Content-Type", "application/json; charset=utf-8" if download else "text/html; charset=utf-8")
        handler.send_header("Content-Length", str(len(content)))
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("Referrer-Policy", "no-referrer")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")
        handler.send_header("Content-Security-Policy", f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        if download:
            handler.send_header("Content-Disposition", 'attachment; filename="comprovante-assinatura.json"')
        handler.end_headers()
        handler.wfile.write(content)
    except FileNotFoundError:
        return error(404, "Registro não encontrado")
    except EvidenceConflict:
        return error(409, "Registro ainda não confirmado. Aguarde a conclusão da assinatura.")
    except Exception:
        return error(500, "Integridade do registro não confirmada. Não considere este documento verificado.")
