"""Manual DDA bookkeeping only. This module never calls a banking API."""
import re
import json
from pathlib import Path
from datetime import datetime, timezone

SCOPE_PATH = Path('/var/lib/energetica-whatsapp/dda-sync/manual-payment-scope.json')
AUDIT_FIELDS = ('PGTO_CONFIRMADO', 'PGTO_CONFIRMADO_EM', 'PGTO_CONFIRMADO_POR')


class ConcurrentUpdate(RuntimeError):
    pass


class SharePointRepository:
    def __init__(self, client, scope):
        self.client, self.scope = client, scope
        self.company = scope['company']
        self.list_id = scope['listId']

    @classmethod
    def from_bridge(cls, client):
        # A separate client is required: the existing engine uses a different site.
        from clients import SharePointClient
        scope = load_scope()
        return cls(SharePointClient(scope['siteHost'], scope['sitePath'], client.tenant_id,
            client.client_id, client.private_key_pem, client.certificate_pem, 'DDAS SICOOB'), scope)

    def read(self, item_id):
        payload = self.client._request('GET', f"web/lists(guid'{self.list_id}')/items({item_id})",
            params={'$select': ','.join(('Id', 'CHAVE_DDA', 'CNPJ_PAGADOR', *AUDIT_FIELDS))},
            headers={'Accept': 'application/json;odata=verbose'})
        row = dict(payload.get('d', payload))
        row['_etag'] = row.get('__metadata', {}).get('etag')
        return row

    def confirm(self, item_id, fields, etag):
        if set(fields) != set(AUDIT_FIELDS) or not etag or etag == '*':
            raise ValueError('Confirmação DDA inválida.')
        try:
            self.client._request('POST', f"web/lists(guid'{self.list_id}')/items({item_id})",
                json=fields, headers={'Content-Type': 'application/json;odata=nometadata',
                    'IF-MATCH': etag, 'X-HTTP-Method': 'MERGE'})
        except Exception as exc:
            if getattr(getattr(exc, 'response', None), 'status_code', None) == 412:
                raise ConcurrentUpdate('DDA alterado simultaneamente.') from None
            raise RuntimeError('Não foi possível verificar a confirmação DDA. Consulte novamente.') from None


def load_scope(path=SCOPE_PATH):
    scope = json.loads(Path(path).read_text())
    if (set(scope) != {'siteHost', 'sitePath', 'listId', 'company'}
            or not re.fullmatch(r'[a-z0-9-]+\.sharepoint\.com', scope['siteHost'])
            or not re.fullmatch(r'(?:personal|sites)/[a-zA-Z0-9_-]+', scope['sitePath'])
            or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', scope['listId'])
            or not re.fullmatch(r'\d{14}', scope['company'])):
        raise RuntimeError('Escopo DDA privado inválido.')
    return scope


def _validate_row(row, item_id, key, company):
    if (row.get('Id') != item_id or row.get('CHAVE_DDA') != key
            or row.get('CNPJ_PAGADOR') != company):
        raise PermissionError('DDA indisponível para esta confirmação.')


def _receipt(row, item_id, key):
    timestamp, actor = row.get('PGTO_CONFIRMADO_EM'), row.get('PGTO_CONFIRMADO_POR')
    if not isinstance(timestamp, str) or not isinstance(actor, str) or not actor.strip():
        raise RuntimeError('Auditoria da confirmação DDA indisponível.')
    try:
        parsed = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError()
    except ValueError:
        raise RuntimeError('Auditoria da confirmação DDA indisponível.') from None
    return {'status': 'processed', 'messages': [], 'ddaPaymentConfirmation': {
        'status': 'confirmed', 'itemId': item_id, 'key': key,
        'confirmedAt': parsed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'confirmedBy': actor}}


def handle_portal(identity, body, repository, *, allowed_emails=None, now=None):
    # Identity has been authenticated by _portal_identity; apply the same private
    # owner allowlist as dda_refresh before reading any SharePoint item.
    email = str(identity.get('email') or identity.get('preferred_username') or '').strip().lower()
    if allowed_emails is None:
        from dda_sync import Queue
        Queue().authorize(identity)
    elif not identity.get('oid') or not email or email not in {str(x).lower() for x in allowed_emails}:
        raise PermissionError('Confirmação DDA não autorizada para este usuário.')
    if (not isinstance(body, dict) or set(body) != {'action', 'itemId', 'key'}
            or body.get('action') != 'dda_payment_confirm'
            or type(body.get('itemId')) is not int or not 1 <= body['itemId'] <= 2147483647
            or not isinstance(body.get('key'), str) or not re.fullmatch('[a-f0-9]{64}', body['key'])):
        raise ValueError('Pedido de confirmação DDA inválido.')
    item_id, key = body['itemId'], body['key']
    for _ in range(3):
        row = repository.read(item_id)
        _validate_row(row, item_id, key, repository.company)
        if row.get('PGTO_CONFIRMADO') is True:
            return _receipt(row, item_id, key)
        if row.get('PGTO_CONFIRMADO') not in (False, None):
            raise RuntimeError('Estado de confirmação DDA inválido.')
        etag = row.get('_etag')
        if not isinstance(etag, str) or not etag or etag == '*':
            raise RuntimeError('Versão do DDA indisponível.')
        instant = (now or (lambda: datetime.now(timezone.utc)))()
        fields = {'PGTO_CONFIRMADO': True,
                  'PGTO_CONFIRMADO_EM': instant.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
                  'PGTO_CONFIRMADO_POR': email}
        try:
            repository.confirm(item_id, fields, etag)
        except ConcurrentUpdate:
            continue
        persisted = repository.read(item_id)
        _validate_row(persisted, item_id, key, repository.company)
        if persisted.get('PGTO_CONFIRMADO') is not True:
            raise RuntimeError('SharePoint não confirmou a gravação. Consulte novamente.')
        receipt = _receipt(persisted, item_id, key)
        audit = receipt['ddaPaymentConfirmation']
        if audit['confirmedBy'] != email or audit['confirmedAt'] != fields['PGTO_CONFIRMADO_EM']:
            raise RuntimeError('Auditoria da confirmação divergiu. Consulte novamente.')
        return receipt
    raise RuntimeError('DDA foi alterado simultaneamente. Consulte novamente.')
