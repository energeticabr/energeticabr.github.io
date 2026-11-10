"""Use archived bank receipts only to discover IDs. Receiver fields come from the Sicoob API."""
import argparse
from collections import Counter, defaultdict
from datetime import timedelta
from decimal import Decimal, InvalidOperation
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
import subprocess

import sync_movements as movements
from sync_boleto_receipts import IDENTITY, LIST, RECEIVER, list_movements

END_ID = re.compile(r'(?<![A-Za-z0-9])[Ee][0-9]{20}[A-Za-z0-9]{11}(?![A-Za-z0-9])')
CPF_MASK = re.compile(r'\*{2,3}\s*\.\s*(\d{3})\s*\.\s*(\d{3})\s*-\s*\*{2,3}')
EXTRA = (*RECEIVER, 'CONTARECEBEDOR')
CACHE = Path('/var/lib/energetica-sicoob-movements/pix-ocr')


def extract_end_ids(text):
    return {'E' + value[1:] for value in END_ID.findall(text)}


def mask_key(value):
    match = CPF_MASK.search(movements.text(value))
    return ''.join(match.groups()) if match else ''


def pix_key(row):
    return (movements.civil_date(row['DATAPAGAMENTO']), movements.money(row['VALOR']),
            movements.text(row['CONTAPAGADORA']),
            movements.tax_id(row.get('DOCUMENTORECEBEDOR')) or mask_key(row['DESCRICAO']))


def direct_ids(row):
    return extract_end_ids(f"{row.get('DESCRICAO') or ''} {row.get('REFERENCIABANCARIA') or ''}")


def pix_matches(row, pix, end_id, payer_document):
    if not isinstance(pix, dict) or pix.get('endToEndId') != end_id or pix.get('estado') != 'FINALIZADO':
        return False
    origin = pix.get('origem') or {}
    receiver = pix.get('destino') or {}
    try:
        day, value, account, identity = pix_key(row)
        document = movements.tax_id(receiver.get('cpfCnpj'))
        explicit = direct_ids(row)
        if explicit and explicit != {end_id}:
            return False
        if len(identity) == 6:
            counterparty_matches = len(document) == 11 and document[3:9] == identity
        else:
            counterparty_matches = document == identity if identity else explicit == {end_id}
        return (bool(payer_document and movements.tax_id(origin.get('cpfCnpj')) == payer_document)
                and movements.text(origin.get('conta')).lstrip('0') == account.lstrip('0')
                and movements.civil_date(pix['horario']) == day and movements.money(pix['valor']) == value
                and counterparty_matches
                and bool(movements.text(receiver.get('nome'))))
    except (AttributeError, KeyError, TypeError, ValueError):
        return False


def pix_receiver_fields(pix):
    receiver = pix['destino']
    result = {'RAZAOSOCIALRECEBEDOR': movements.text(receiver['nome'])[:255]}
    document = movements.tax_id(receiver.get('cpfCnpj'))
    if document:
        result['DOCUMENTORECEBEDOR'] = document
    account = movements.text(receiver.get('conta'))
    if re.fullmatch(r'\d{1,20}', account):
        result['CONTARECEBEDOR'] = account
    return result


def receipt_ids(content):
    from PIL import ImageOps
    from pypdf import PdfReader
    import pypdfium2

    if not content.startswith(b'%PDF-') or len(content) > 12_000_000:
        return set()
    pdf = PdfReader(BytesIO(content))
    if len(pdf.pages) != 1:
        return set()
    text = pdf.pages[0].extract_text() or ''
    labels = movements.bank_label(text)
    ids = extract_end_ids(text)
    if all(label in labels for label in ('COMPROVANTE', 'SICOOB', 'PIX')) and ids:
        return ids if len(ids) == 1 else set()
    with pypdfium2.PdfDocument(content) as document:
        with document[0] as page:
            bitmap = page.render(scale=2)
            try:
                image = ImageOps.autocontrast(ImageOps.grayscale(bitmap.to_pil()))
            finally:
                bitmap.close()
    image.thumbnail((1400, 2600))
    picture = BytesIO()
    image.save(picture, format='PNG')
    for layout in ('6', '11'):
        process = subprocess.run(['/usr/bin/tesseract', 'stdin', 'stdout', '--psm', layout, '-l', 'eng'],
                                 input=picture.getvalue(), capture_output=True, timeout=30,
                                 env={**os.environ, 'OMP_THREAD_LIMIT': '1'})
        text = process.stdout.decode('utf-8', errors='replace')
        labels = movements.bank_label(text)
        ids = extract_end_ids(text)
        if all(label in labels for label in ('COMPROVANTE', 'SICOOB', 'PIX')) and ids:
            return ids if len(ids) == 1 else set()
    return set()


def cached_receipt_ids(content):
    from pypdf.errors import PdfReadError
    key = hashlib.sha256(content).hexdigest()
    file = CACHE / key
    if file.exists():
        cached = json.loads(file.read_text())
        return {cached[0]} if (isinstance(cached, list) and len(cached) == 1
                               and isinstance(cached[0], str) and END_ID.fullmatch(cached[0])) else set()
    try:
        ids = receipt_ids(content)
    except (OSError, ValueError, RuntimeError, PdfReadError, subprocess.SubprocessError):
        return set()
    CACHE.mkdir(mode=0o700, exist_ok=True)
    temporary = file.with_suffix(f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(sorted(ids)))
    temporary.replace(file)
    return ids


def launch_dates_and_values(client, start, end):
    endpoint = client._list_endpoint('LANCAMENTOS') + '/items'
    rows = client._values(client._request('GET', endpoint, params={
        '$select': 'Id,field_4,field_8,field_9,field_10,Attachments',
        '$filter': f"field_4 ge datetime'{start.isoformat()}T00:00:00Z' and "
                   f"field_4 lt datetime'{(end + timedelta(days=2)).isoformat()}T00:00:00Z'",
        '$top': '5000',
    }))
    if len(rows) >= 5000:
        raise ValueError('Incomplete launch snapshot')
    matches = defaultdict(list)
    for row in rows:
        if not row.get('Attachments'):
            continue
        try:
            quantity = Decimal(str(row.get('field_8') or 0).replace(',', '.'))
            price = Decimal(str(row.get('field_9') or 0).replace(',', '.'))
            freight = Decimal(str(row.get('field_10') or 0).replace(',', '.'))
            value = f'{quantity * price + freight:.2f}'.replace('.', ',')
            matches[(movements.civil_date(row['field_4']), value)].append(row['Id'])
        except (KeyError, InvalidOperation, ValueError):
            continue
    return matches


def read_pix(account, ids):
    script = Path(__file__).with_name('Read-SicoobPixDetails.ps1')
    result = subprocess.run(['/usr/bin/pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-File', str(script)],
                            input=json.dumps({'account': account, 'ids': ids}),
                            encoding='utf-8', capture_output=True, timeout=780)
    if result.returncode:
        raise RuntimeError('SICOOB_PIX_READ_FAILED')
    return json.loads(result.stdout)


def save_pix(client, row, pix, end_id, payer, content):
    item_id = row['Id']
    fresh, _ = client.get_item_fields_with_etag(item_id, (*IDENTITY, *EXTRA), LIST)
    if any(fresh[field] != row[field] for field in IDENTITY) or not pix_matches(fresh, pix, end_id, payer):
        raise ValueError('Pix movement identity changed')
    if content:
        filename = f'Comprovante-Sicoob-Pix-{item_id}.pdf'
        client.ensure_attachment(item_id, filename, content, 'application/pdf', target_list=LIST)
        if [f['content'] for f in client.get_item_attachments(item_id, LIST) if f['filename'] == filename] != [content]:
            raise ValueError('Pix receipt readback mismatch')
    fresh, etag = client.get_item_fields_with_etag(item_id, (*IDENTITY, *EXTRA), LIST)
    if any(fresh[field] != row[field] for field in IDENTITY) or not pix_matches(fresh, pix, end_id, payer):
        raise ValueError('Pix movement identity changed')
    fields = pix_receiver_fields(pix)
    for field in EXTRA:
        current = movements.text(fresh.get(field))
        if current.upper() not in ('', movements.UNKNOWN) and current.casefold() != fields.get(field, '').casefold():
            return False
    updates = {k: v for k, v in fields.items() if movements.text(fresh.get(k)).upper() in ('', movements.UNKNOWN)}
    client.update_item_with_etag(item_id, updates, etag, LIST)
    if updates and client.get_item_fields(item_id, tuple(updates), LIST) != updates:
        raise ValueError('Pix receiver readback mismatch')
    return 'RAZAOSOCIALRECEBEDOR' in updates


def bank_match(row, options, answers, movements_in_account, payer):
    if any(answers.get(end_id, {}).get('status') not in (200, 404) for end_id in options):
        return None
    movement_key = pix_key(row)[:3]
    if any(r['Id'] != row['Id'] and not pix_key(r)[-1] and not direct_ids(r) and pix_key(r)[:3] == movement_key
           for r in movements_in_account):
        return None
    matches = []
    for end_id, content in options.items():
        answer = answers[end_id]
        result = answer.get('result')
        if answer['status'] != 200 or not isinstance(result, dict):
            continue
        pix = result.get('resultado', result)
        compatible = [r['Id'] for r in movements_in_account if pix_matches(r, pix, end_id, payer)]
        if compatible == [row['Id']]:
            matches.append((pix, end_id, content))
    return matches[0] if len(matches) == 1 else None


def run(check):
    client = movements.sharepoint_client()
    movements.assert_destination(client)
    pix_rows = [row for row in list_movements(client) if row['ORIGEMMOVIMENTACAO'] == 'SICOOB'
                and row['OPERACAO'] == 'DÉBITO' and re.search(r'\bPIX\b', movements.bank_label(row['DESCRICAO']))]
    pending = [row for row in pix_rows if movements.text(row['RAZAOSOCIALRECEBEDOR']).upper() in ('', movements.UNKNOWN)
               and (pix_key(row)[-1] or len(direct_ids(row)) == 1)]
    stats = Counter(pendentes=len(pending))
    if not pending:
        return dict(stats)
    days = [pix_key(row)[0] for row in pending]
    launches = launch_dates_and_values(client, min(days), max(days))
    archive = {}
    by_account = defaultdict(dict)
    for row in pending:
        day, value, account, _ = pix_key(row)
        direct = direct_ids(row)
        if len(direct) > 1:
            continue
        candidates = dict.fromkeys(direct)
        for launch_id in launches[(day, value)]:
            if launch_id not in archive:
                archive[launch_id] = client.get_item_attachments(launch_id, 'LANCAMENTOS')
            for file in archive[launch_id]:
                if re.search(r'comprov|pix|recibo', file['filename'], re.I):
                    for end_id in cached_receipt_ids(file['content']):
                        if (not direct or end_id in direct) and not candidates.get(end_id):
                            candidates[end_id] = file['content']
        if candidates:
            by_account[account][row['Id']] = (row, candidates)
    for account, group in by_account.items():
        ids = sorted({end_id for _, options in group.values() for end_id in options})
        data = read_pix(account, ids)
        payer = movements.tax_id(data['payer_document'])
        for row, options in group.values():
            for end_id in options:
                answer = data['results'].get(end_id, {})
                stats[f"http_{answer.get('status', 'pendente')}"] += 1
            match = bank_match(row, options, data['results'], pix_rows, payer)
            if not match:
                continue
            stats['verificados'] += 1
            if not check:
                try:
                    pix, end_id, content = match
                    stats['nomes_gravados'] += save_pix(client, row, pix, end_id, payer, content)
                except (OSError, ValueError, RuntimeError) as error:
                    stats[f'falha_gravacao_{type(error).__name__}'] += 1
    return dict(stats)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.check), sort_keys=True))
    except Exception as error:
        parser.exit(1, f'SICOOB_PIX_SYNC_FAILED ({type(error).__name__})\n')
