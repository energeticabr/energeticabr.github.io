"""Small fail-closed patch for the existing authenticated upload handler."""
from pathlib import Path


def once(source, before, after):
    if source.count(before) != 1:
        raise ValueError('Bridge source drift: expected one patch anchor')
    return source.replace(before, after, 1)


def patch_bridge(source):
    helper = Path(__file__).with_name('replacement.py').read_text(encoding='utf-8').replace('\r\n', '\n')
    source = once(source, 'class ChannelBridge:\n', helper + '\n\nclass ChannelBridge:\n')
    anchor = '''            result = self.bridge.handle(
                portal_channel_payload(
                    {
                        "messageId": self.headers.get("X-Portal-Message-Id", "") or uuid.uuid4().hex,
                        "media": upload.as_media(),
                    },
                    identity,
                )
            )'''
    action = '''            query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
            if "operation" in query:
                if any(len(values) != 1 for values in query.values()) or query.get("operation") != ["attachment_replace"]:
                    raise ValueError("Operação de upload inválida")
                if set(query) != {"operation", "attachment_id", "expected_sha256", "request_id"}:
                    raise ValueError("Parâmetros da substituição inválidos")
                if self.headers.get("X-Portal-Message-Id", "") != query["request_id"][0]:
                    raise ValueError("Identificador da tentativa de substituição divergente")
                result = portal_replace_attachment(
                    self.bridge, identity, upload, self.portal_media_store,
                    attachment_id=query["attachment_id"][0], expected_sha256=query["expected_sha256"][0],
                    request_id=query["request_id"][0], allowed_emails=self.portal_authenticator.allowed_emails,
                )
                return self._send_json(200, result, cors_origin=cors_origin)
'''
    source = once(source, anchor, action + anchor)
    compile(source, 'channel_bridge.py', 'exec')
    return source


def patch(relative, before):
    import hashlib
    import json
    stage = Path(__file__).resolve().parent
    manifest = json.loads((stage / 'deploy-manifest.json').read_text(encoding='utf-8'))
    if relative != 'channel_bridge.py' or hashlib.sha256(before).hexdigest() != manifest['files'][relative]['before']:
        raise ValueError('Bridge baseline hash mismatch')
    after = patch_bridge(before.decode('utf-8')).encode('utf-8')
    if hashlib.sha256(after).hexdigest() != manifest['files'][relative]['after']:
        raise ValueError('Bridge candidate hash mismatch')
    return after
