"""Read posted Sicoob debits and append them to the existing movement list."""
import argparse
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
from zoneinfo import ZoneInfo

BACKFILL_START = date(2026, 10, 1)
BACKFILL_END = date(2026, 11, 7)
NEW_START = date(2026, 11, 8)
ZONE = ZoneInfo('America/Sao_Paulo') if sys.platform != 'win32' else timezone(timedelta(hours=-3))
LIST = 'MOVIMENTACOESFINANCEIRAS'
LIST_ID = 'ad287352-ea59-4f60-9c91-d18520bb1d08'
SERVICE_ROOT = Path('/opt/energetica-whatsapp')
SCOPE = Path('/var/lib/energetica-whatsapp/dda-sync/manual-payment-scope.json')
KEY = 'CHAVEIMPORTACAO'
UNKNOWN = 'N/A'
PAYMENT = re.compile(r'\b(?:PIX|TED|DOC|PGTO|PAGTO|PAGAMENTO|TRANSF|TRANSFERENCIA|BOLETO|TITULO|CONVENIO)\b|\bDEB(?:ITO)?\.? AUTOMATICO\b|\bCOMPRA (?:NO )?CARTAO\b')
NON_PAYMENT = re.compile(r'\b(?:TARIFA|TARIFAS|SAQUE|APLICACAO|RESGATE|ESTORNO|IOF)\b')
COMPENSATED_BOLETO = 'DEB.TIT.COMPE EFETIVADO'
BANK_DOCUMENT = re.compile(r'(?:[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}[/ ][A-Z0-9]{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})', re.I)


def monthly_windows(start, end):
    while start <= end:
        last = min(end, start.replace(day=monthrange(start.year, start.month)[1]))
        yield start, last
        start = last + timedelta(days=1)


def scheduled_start(cursor, today):
    if not cursor.exists():
        return NEW_START
    last = date.fromisoformat(cursor.read_text().strip())
    if not NEW_START <= last <= today:
        raise ValueError('Invalid scheduled cursor')
    # Keep the prior day in each run to catch bank posting delays across midnight.
    return max(NEW_START, min(last, today - timedelta(days=1)))


def text(value):
    return ' '.join(str(value if value is not None else '').split())


def bank_label(value):
    normalized = unicodedata.normalize('NFKD', text(value).upper())
    return ''.join(c for c in normalized if not unicodedata.combining(c))


def tax_id(value):
    raw = re.sub(r'[. /-]', '', text(value)).upper()
    if re.fullmatch(r'[0-9]{11}|[A-Z0-9]{12}[0-9]{2}', raw) and len(set(raw)) > 1:
        return raw
    return ''


def bank_receiver(entry):
    fields = text(entry.get('descInfComplementar')).split('|@')
    name = re.match(r'^FAV\.:\s*(.+)$', fields[0].strip(), re.I)
    documents = {tax_id(field) for field in fields[1:] if BANK_DOCUMENT.fullmatch(field.strip())}
    documents.discard('')
    document = tax_id(entry.get('cpfCnpj'))
    if not document and len(documents) == 1:
        document = next(iter(documents))
    return document, text(name.group(1)) if name else ''


def receiver_names(rows):
    grouped = {}
    for row in rows:
        document = tax_id(row.get('DOCUMENTOFORNECEDOR'))
        name = text(row.get('Title'))
        if document and name and name.upper() != UNKNOWN:
            grouped.setdefault(document, {}).setdefault(name.casefold(), name)
    return {document: next(iter(names.values())) for document, names in grouped.items() if len(names) == 1}


def public_receiver_name(document, request):
    if len(document) != 14 or tax_id(document) != document:
        return ''
    response = request(document)
    if not isinstance(response, dict) or tax_id(response.get('cnpj')) != document:
        return ''
    legal = text(response.get('razao_social'))
    trade = text(response.get('nome_fantasia'))
    if legal and trade and legal.casefold() != trade.casefold():
        return f'{legal} ({trade})'
    return legal or trade


def civil_date(value):
    value = text(value)
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return date.fromisoformat(value)
    if re.match(r'^\d{4}-\d{2}-\d{2}[ T]', value):
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return stamp.astimezone(ZONE).date() if stamp.tzinfo else stamp.date()
    if re.match(r'^\d{2}/\d{2}/\d{4}(?:$| )', value):
        return datetime.strptime(value[:10], '%d/%m/%Y').date()
    raise ValueError('Unrecognized transaction date')


def money(value):
    amount = text(value)
    if re.fullmatch(r'-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}', amount):
        amount = amount.replace('.', '').replace(',', '.')
    if not re.fullmatch(r'-?\d+(?:\.\d{1,2})?', amount):
        raise ValueError('Invalid bank amount')
    amount = abs(Decimal(amount))
    if not amount:
        raise ValueError('Zero bank debit')
    return format(amount, '.2f').replace('.', ',')


def payment_rows(payload, start, end, account, names, excluded=None):
    if not isinstance(payload, dict):
        raise ValueError('Invalid statement')
    result = payload.get('resultado', payload)
    if not isinstance(result, dict) or not isinstance(result.get('transacoes'), list):
        raise ValueError('Statement is missing transactions')
    records = []
    for entry in result['transacoes']:
        kind = bank_label(entry.get('tipo'))
        if kind in {'C', 'CREDITO'}:
            continue
        if kind not in {'D', 'DEBITO'}:
            raise ValueError('Unrecognized bank transaction type')
        paid = civil_date(entry.get('data') or entry.get('dataLote'))
        if not start <= paid <= end:
            continue
        label = bank_label(entry.get('descricao'))
        if (not PAYMENT.search(label) and label != COMPENSATED_BOLETO) or NON_PAYMENT.search(label):
            if excluded is not None:
                excluded.append(1)
            continue
        transaction = text(entry.get('transactionId'))
        if not transaction:
            raise ValueError('Bank debit is missing transactionId')
        document, bank_name = bank_receiver(entry)
        reference = text(entry.get('numeroDocumento')) or transaction
        description = ' | '.join(filter(None, (text(entry.get('descricao')), text(entry.get('descInfComplementar')))))
        key = hashlib.sha256(f'SICOOB\0{account}\0{transaction}'.encode()).hexdigest()
        row = {
            KEY: key, 'Title': f'SICOOB {key}', 'INSTITUICAO': 'SICOOB', 'OPERACAO': 'DÉBITO',
            'VALOR': money(entry.get('valor')), 'DATAPAGAMENTO': f'{paid.isoformat()}T12:00:00Z',
            'CONTAPAGADORA': account, 'DESCRICAO': (description or 'DÉBITO SICOOB')[:255],
            'REFERENCIABANCARIA': reference[:255], 'ORIGEMMOVIMENTACAO': 'SICOOB',
            'RAZAOSOCIALRECEBEDOR': (bank_name or (names.get(document) if not re.search(r'\bPIX\b', label) else '') or UNKNOWN)[:255],
        }
        if document:
            row['DOCUMENTORECEBEDOR'] = document
        records.append(row)
    return records


def import_movements(fetch, save, start, end, account, names):
    records, excluded = {}, []
    for first, last in monthly_windows(start, end):
        for row in payment_rows(fetch(first, last), start, end, account, names, excluded):
            key = row[KEY]
            if records.setdefault(key, row) != row:
                raise ValueError('Conflicting transaction data in the bank response')
    counts = {'debits': len(records), 'excludedDebits': len(excluded), 'inserted': 0, 'existing': 0, 'unidentified': 0}
    for row in records.values():
        created = save(row)
        counts['inserted' if created else 'existing'] += 1
        counts['unidentified'] += row['RAZAOSOCIALRECEBEDOR'] == UNKNOWN
    return counts


def sharepoint_client():
    sys.path[:0] = [str(SERVICE_ROOT), str(SERVICE_ROOT / 'worker')]
    from clients import SharePointClient
    scope = json.loads(SCOPE.read_text())
    return SharePointClient(scope['siteHost'], scope['sitePath'], os.environ['ENTRA_TENANT_ID'],
                            os.environ['ENTRA_CLIENT_ID'], Path(os.environ['ENTRA_PRIVATE_KEY_FILE']).read_text(),
                            Path(os.environ['ENTRA_CERTIFICATE_FILE']).read_text(), LIST)


def assert_destination(client):
    endpoint = client._list_endpoint(LIST)
    item = client._request('GET', endpoint, params={'$select': 'Id,HasUniqueRoleAssignments'})
    field = client._request('GET', f"{endpoint}/fields/GetByInternalNameOrTitle('{KEY}')",
                            params={'$select': 'InternalName,TypeAsString,Indexed,EnforceUniqueValues'})
    if item['Id'].lower() != LIST_ID or not item['HasUniqueRoleAssignments']:
        raise ValueError('Unexpected movement list')
    if field['InternalName'] != KEY or field['TypeAsString'] != 'Text' or not field['Indexed'] or not field['EnforceUniqueValues']:
        raise ValueError('Movement key must be unique')


def supplier_rows(client):
    endpoint = client._list_endpoint('FORNECEDORES') + '/items'
    after = 0
    while True:
        payload = client._request('GET', endpoint, params={
            '$select': 'Id,Title,DOCUMENTOFORNECEDOR', '$filter': f'Id gt {after}',
            '$orderby': 'Id asc', '$top': '5000',
        })
        rows = client._values(payload)
        if not rows:
            return
        for row in rows:
            identifier = int(row['Id'])
            if identifier <= after:
                raise ValueError('Invalid supplier page order')
            after = identifier
            yield row


@lru_cache(maxsize=4096)
def fetch_public_company(document):
    import requests
    try:
        response = requests.get(f'https://minhareceita.org/{document}', timeout=(5, 8), allow_redirects=False)
        return response.json() if response.status_code == 200 else None
    except (requests.RequestException, ValueError):
        return None


def save_movement(client, row):
    key = row[KEY]
    existing = client._find_item(key, LIST, KEY)
    if existing:
        bank_fields = (KEY, 'DATAPAGAMENTO', 'VALOR', 'CONTAPAGADORA', 'REFERENCIABANCARIA', 'ORIGEMMOVIMENTACAO')
        actual = client.get_item_fields(existing['Id'], (*bank_fields, 'RAZAOSOCIALRECEBEDOR'), LIST)
        verify_fields(actual, row, bank_fields)
        row['RAZAOSOCIALRECEBEDOR'] = actual.get('RAZAOSOCIALRECEBEDOR') or UNKNOWN
        return False
    registered_name = '' if re.search(r'\bPIX\b', bank_label(row['DESCRICAO'])) else public_receiver_name(
        row.get('DOCUMENTORECEBEDOR', ''), fetch_public_company)
    if registered_name:
        row['RAZAOSOCIALRECEBEDOR'] = registered_name[:255]
    item_id = client.ensure_item(key, row, target_list=LIST, idempotency_field=KEY, merge_existing=False)
    actual = client.get_item_fields(item_id, tuple(row), LIST)
    verify_fields(actual, row, row)
    return True


def verify_fields(actual, row, fields):
    actual_date = text(actual.get('DATAPAGAMENTO'))[:10]
    if actual_date != row['DATAPAGAMENTO'][:10] or any(
        actual.get(field) != row[field] for field in fields if field != 'DATAPAGAMENTO'
    ):
        raise ValueError('SharePoint payment readback mismatch')


def read_bank(start, end):
    script = Path(__file__).with_name('Read-SicoobStatement.ps1')
    windows = [[first.isoformat(), last.isoformat()] for first, last in monthly_windows(start, end)]
    process = subprocess.run(['/usr/bin/pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-File', str(script)],
                             input=json.dumps(windows), encoding='utf-8', capture_output=True, timeout=700)
    if process.returncode:
        code = process.stdout.strip()
        if re.fullmatch(r'SICOOB_[A-Z0-9_]{1,40}', code):
            raise ValueError(code)
        raise ValueError('SICOOB_STATEMENT_READ_FAILED')
    payload = json.loads(process.stdout)
    account = payload['account']
    if not re.fullmatch(r'\d{4,20}', account) or len(payload['statements']) != len(windows):
        raise ValueError('Unexpected bank account or statement count')
    statements = (json.loads(statement, parse_float=Decimal) for statement in payload['statements'])
    return account, dict(zip(monthly_windows(start, end), statements))


def run(mode, state):
    today = datetime.now(ZONE).date()
    cursor = state / 'through'
    start, end = (BACKFILL_START, BACKFILL_END) if mode == 'backfill' else (scheduled_start(cursor, today), today)
    if mode == 'check':
        start = end
    if start > end or end > today:
        return {'status': 'not_due'}
    account, statements = read_bank(start, end)
    client = sharepoint_client()
    assert_destination(client)
    if mode == 'check':
        excluded = []
        rows = payment_rows(statements[(start, end)], start, end, account, {}, excluded)
        return {'status': 'verified_read_only', 'debits': len(rows), 'excludedDebits': len(excluded)}
    names = receiver_names(supplier_rows(client))
    counts = import_movements(lambda first, last: statements[first, last],
                              lambda row: save_movement(client, row), start, end, account, names)
    if mode == 'scheduled':
        temporary = cursor.with_suffix('.tmp')
        temporary.write_text(end.isoformat() + '\n')
        temporary.replace(cursor)
    return {'status': 'ok', 'from': str(start), 'through': str(end), **counts}


def main():
    import fcntl
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['backfill', 'scheduled', 'check'])
    args = parser.parse_args()
    state = Path(os.environ['STATE_DIRECTORY'])
    try:
        with (state / 'collector.lock').open('a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(run(args.mode, state)), flush=True)
    except Exception as error:
        code = str(error)
        safe = code if re.fullmatch(r'SICOOB_[A-Z0-9_]{1,40}', code) else type(error).__name__
        print(json.dumps({'status': 'failed', 'code': safe}), flush=True)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
