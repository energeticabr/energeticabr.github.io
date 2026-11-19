"""Monthly requests for official tax guides; never creates financial obligations."""
import argparse
from datetime import date, datetime
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

LIST = 'GUIASINSSFGTS'
START = date(2026, 10, 1)
TARGET_BRANCH_ID = 5  # FILIAIS: 004 - EDIFÍCIO XAVANTE
FIELDS = {
    'CHAVE': ('Chave da solicitação', 'Text', 'Required="TRUE" Indexed="TRUE" EnforceUniqueValues="TRUE" MaxLength="255"'),
    'COMPETENCIA': ('Data competência', 'DateTime', 'Format="DateOnly" Required="TRUE"'),
    'FILIAL': ('Filial', 'Text', 'Required="TRUE" MaxLength="255"'),
    'TIPO': ('Tipo', 'Choice', 'Required="TRUE"'),
    'VENCIMENTO': ('Data vencimento', 'DateTime', 'Format="DateOnly"'),
    'VALOR': ('Valor', 'Currency', 'LCID="1046" Decimals="2" Min="0"'),
}


def plan(today, branches):
    """A stable key uses the branch ID even if its label changes later."""
    current = today.replace(day=1)
    selected, seen = [], set()
    for branch in branches:
        ident, label = branch.get('Id'), str(branch.get('Title') or '').strip()
        status = str(branch.get('STATUS') or '').strip().upper()
        if (not isinstance(ident, int) or isinstance(ident, bool) or ident < 1 or ident in seen
                or not label or status not in {'ATIVO', 'INATIVO'}):
            raise ValueError('Cadastro de filiais incompleto, duplicado ou inválido')
        seen.add(ident)
        if ident == TARGET_BRANCH_ID and status == 'ATIVO' and label.startswith('004 - '):
            selected.append((ident, label))
    if not selected:
        raise ValueError('Filial 004 ativa não confirmada no cadastro')
    rows, month = [], START
    while month < current:
        competence = month.strftime('%Y-%m')
        following_month = date(month.year + (month.month == 12), month.month % 12 + 1, 1)
        for ident, label in selected:
            for tax in ('INSS', 'FGTS'):
                rows.append(dict(Title=f'Solicitar guia {tax} — {competence} — {label}',
                                 CHAVE=f'GUIA:{competence}:{ident}:{tax}',
                                 COMPETENCIA=month.replace(day=20).isoformat() + 'T12:00:00Z',
                                 FILIAL=label, TIPO=tax, VALOR=None,
                                 VENCIMENTO=following_month.replace(day=20).isoformat() + 'T12:00:00Z'))
        month = following_month
    return rows


def synchronize(store, rows):
    created = sum(bool(store.ensure(row)) for row in rows)
    return {'expected': len(rows), 'created': created, 'existing': len(rows) - created}


class SharePointStore:
    def __init__(self, client):
        self.client = client
        self.base = client._list_endpoint(LIST)

    def pages(self, endpoint, params=None):
        root = self.client.site_url.rstrip('/') + '/_api/'
        expected = urlsplit(endpoint if endpoint.startswith('https://') else root + endpoint)
        result, seen, ids = [], set(), set()
        for _ in range(1000):
            url = endpoint if endpoint.startswith('https://') else root + endpoint
            parsed = urlsplit(url)
            if ((parsed.scheme, parsed.netloc, parsed.path) != (expected.scheme, expected.netloc, expected.path)
                    or endpoint in seen):
                raise ValueError('Paginação inválida ou repetida')
            seen.add(endpoint)
            data = self.client._request('GET', endpoint, params=params)
            rows = data.get('value')
            if not isinstance(rows, list): raise ValueError('Coleção SharePoint incompleta')
            for row in rows:
                ident = row.get('Id')
                if ident is None or ident in ids: raise ValueError('ID de coleção ausente ou duplicado')
                ids.add(ident)
                result.append(row)
            endpoint = data.get('odata.nextLink') or data.get('@odata.nextLink')
            if not endpoint: return result
            params = None
        raise ValueError('Limite de paginação excedido')

    def branches(self):
        return self.pages(self.client._list_endpoint('FILIAIS') + '/items',
                          {'$select': 'Id,Title,STATUS', '$top': 1000})

    def find(self, key):
        return self.pages(self.base + '/items', {'$filter': "CHAVE eq '" + key.replace("'", "''") + "'",
                                                '$select': 'Id,CHAVE,COMPETENCIA,FILIAL,TIPO', '$top': 2})

    @staticmethod
    def verify(row, expected):
        # A renamed branch retains the original request label. Editable values,
        # dates and attachments are intentionally never replaced by recurrence.
        if (row.get('CHAVE') != expected['CHAVE'] or row.get('TIPO') != expected['TIPO']
                or str(row.get('COMPETENCIA') or '')[:10] != expected['COMPETENCIA'][:10]
                or not str(row.get('FILIAL') or '').strip()):
            raise ValueError('Solicitação existente diverge da identidade mensal')

    def ensure(self, row):
        existing = self.find(row['CHAVE'])
        if existing:
            if len(existing) != 1: raise ValueError('Solicitação mensal duplicada')
            self.verify(existing[0], row)
            return False
        created = True
        try:
            self.client._request('POST', self.base + '/items', json=row)
        except Exception as error:
            # Includes an ambiguous POST timeout: reconcile the committed key,
            # never blindly repeat a mutation. Uniqueness arbitrates races.
            existing = self.find(row['CHAVE'])
            if len(existing) != 1: raise error
            created = False
        confirmed = self.find(row['CHAVE'])
        if len(confirmed) != 1: raise ValueError('Criação da solicitação não confirmada')
        self.verify(confirmed[0], row)
        return created

    def schema(self):
        fields = self.pages(self.base + '/fields', {'$select': 'Id,InternalName,TypeAsString,Indexed,EnforceUniqueValues', '$top': 500})
        by_name = {f['InternalName']: f for f in fields}
        for name, (_, field_type, _) in FIELDS.items():
            if by_name.get(name, {}).get('TypeAsString') != field_type:
                raise ValueError(f'Esquema inesperado: {name}')
        if not all(by_name['CHAVE'].get(k) is True for k in ('Indexed', 'EnforceUniqueValues')):
            raise ValueError('Chave mensal sem unicidade garantida pelo SharePoint')
        metadata = self.client._request('GET', self.base, params={'$select': 'Id,EnableAttachments'})
        if metadata.get('EnableAttachments') is not True: raise ValueError('Anexos desabilitados')

def existing_client():
    sys.path[:0] = ['/opt/energetica-whatsapp', '/opt/energetica-whatsapp/worker']
    from local_app import load_env
    from clients import SharePointClient
    load_env(Path('/etc/energetica-whatsapp.env'))
    return SharePointClient(os.environ['SHAREPOINT_HOST'], os.environ['SHAREPOINT_SITE_PATH'],
                            os.environ['ENTRA_TENANT_ID'], os.environ['ENTRA_CLIENT_ID'],
                            Path(os.environ['ENTRA_PRIVATE_KEY_FILE']).read_text(),
                            Path(os.environ['ENTRA_CERTIFICATE_FILE']).read_text(), LIST)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    store = SharePointStore(existing_client())
    store.schema()
    rows = plan(datetime.now(ZoneInfo('America/Sao_Paulo')).date(), store.branches())
    if args.apply:
        result = synchronize(store, rows)
        for row in rows:
            found = store.find(row['CHAVE'])
            if len(found) != 1: raise ValueError('Cobertura mensal incompleta')
            store.verify(found[0], row)
        print(json.dumps(result))
    else:
        print(json.dumps({'expected': len(rows), 'keys': [r['CHAVE'] for r in rows]}))


if __name__ == '__main__': main()
