"""Use archived receipts to discover IDs and Sicoob APIs to verify payments."""
import argparse
from collections import Counter, defaultdict
from contextlib import closing
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
import subprocess
import time

import sync_movements as movements
from sync_boleto_receipts import IDENTITY, LIST, RECEIVER, list_movements
from pix_events import Inbox

END_ID = re.compile(r'(?<![A-Za-z0-9])[Ee][0-9]{20}[A-Za-z0-9]{11}(?![A-Za-z0-9])')
EXTRA = (*RECEIVER, 'CONTARECEBEDOR')
CACHE = Path('/var/lib/energetica-sicoob-movements/pix-ocr')


def extract_end_ids(text):
    return {'E' + value[1:] for value in END_ID.findall(text)}


def mask_key(value):
    match = movements.PIX_MASKED_DOCUMENT.search(movements.text(value))
    return ''.join(match.groups()) if match else ''


def pix_key(row):
    return (movements.civil_date(row['DATAPAGAMENTO']), movements.money(row['VALOR']),
            movements.text(row['CONTAPAGADORA']),
            movements.tax_id(row.get('DOCUMENTORECEBEDOR')) or mask_key(row['DESCRICAO']))


def direct_ids(row):
    return extract_end_ids(f"{row.get('DESCRICAO') or ''} {row.get('REFERENCIABANCARIA') or ''}")


def pix_matches(row, pix, end_id, payer_document, *, allow_posting_delay=False):
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
        delay = (day - movements.civil_date(pix['horario'])).days
        matches_day = delay == 0 or (allow_posting_delay and 0 < delay <= movements.POSTING_OVERLAP_DAYS)
        return (bool(payer_document and movements.tax_id(origin.get('cpfCnpj')) == payer_document)
                and movements.text(origin.get('conta')).lstrip('0') == account.lstrip('0')
                and matches_day and movements.money(pix['valor']) == value
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


def receipt_end_ids(text):
    labels = movements.bank_label(text)
    if not all(label in labels for label in ('COMPROVANTE', 'SICOOB', 'PIX')):
        return set()
    ids = extract_end_ids(text)
    lines = text.splitlines()
    for index, line in enumerate(lines):
        # Keep the case as read. OCR can insert spaces into the ID on this line.
        if not re.match(r'^ID DA TRANSA[CG]AO\s*:', movements.bank_label(line)):
            continue
        value = line.partition(':')[2].strip()
        if not value and index + 1 < len(lines):
            value = lines[index + 1]
        candidate = ''.join(value.split())
        if END_ID.fullmatch(candidate):
            ids.update(extract_end_ids(candidate))
    return ids if len(ids) == 1 else set()


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
    ids = receipt_end_ids(text)
    if all(label in labels for label in ('COMPROVANTE', 'SICOOB', 'PIX')) and ids:
        return ids if len(ids) == 1 else set()
    with closing(pypdfium2.PdfDocument(content)) as document:
        with closing(document[0]) as page:
            width, height = page.get_size()
            if not (width > 0 and height > 0):
                return set()
            scale = min(2, 1400 / width, 2600 / height)
            with closing(page.render(scale=scale)) as bitmap:
                image = ImageOps.autocontrast(ImageOps.grayscale(bitmap.to_pil()))
    image.thumbnail((1400, 2600))
    picture = BytesIO()
    image.save(picture, format='PNG')
    found = set()
    incomplete = False
    for layout, language in (('6', 'eng'), ('6', 'por'), ('11', 'eng')):
        try:
            process = subprocess.run(['/usr/bin/tesseract', 'stdin', 'stdout', '--psm', layout, '-l', language],
                                     input=picture.getvalue(), capture_output=True, timeout=30,
                                     env={**os.environ, 'OMP_THREAD_LIMIT': '1'})
        except subprocess.TimeoutExpired:
            incomplete = True
            continue
        if getattr(process, 'returncode', 0):
            incomplete = True
            continue
        text = process.stdout.decode('utf-8', errors='replace')
        labels = movements.bank_label(text)
        ids = receipt_end_ids(text)
        if all(label in labels for label in ('COMPROVANTE', 'SICOOB', 'PIX')) and ids:
            found.update(ids)
    if incomplete and not found:
        raise RuntimeError('Receipt OCR incomplete')
    return found


def cached_receipt_ids(content):
    from pypdf.errors import PdfReadError
    key = hashlib.sha256(content).hexdigest()
    file = CACHE / f'{key}.v3'
    if file.exists():
        cached = json.loads(file.read_text())
        return set(cached) if (isinstance(cached, list) and len(cached) <= 3
                              and all(isinstance(value, str) and END_ID.fullmatch(value) for value in cached)) else set()
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
            day = movements.civil_date(row['field_4'])
        except (KeyError, ValueError):
            continue
        matches[(day, None)].append(row['Id'])
        try:
            quantity = Decimal(str(row.get('field_8') or 0).replace(',', '.'))
            price = Decimal(str(row.get('field_9') or 0).replace(',', '.'))
            freight = Decimal(str(row.get('field_10') or 0).replace(',', '.'))
            value = f'{quantity * price + freight:.2f}'.replace('.', ',')
            matches[(day, value)].append(row['Id'])
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


def receiver_field_matches(current, fields, field):
    value = movements.text(current.get(field))
    if value.casefold() == fields.get(field, '').casefold():
        return True
    document = movements.tax_id(current.get('DOCUMENTORECEBEDOR'))
    if not document or document != fields.get('DOCUMENTORECEBEDOR'):
        return False
    # Banking and registry names can differ for the same establishment.
    return (field == 'DOCUMENTORECEBEDOR' or
            (field == 'RAZAOSOCIALRECEBEDOR' and len(document) == 14 and value.upper() not in ('', movements.UNKNOWN)))


def save_pix(client, row, pix, end_id, payer, content, *, allow_posting_delay=False):
    item_id = row['Id']
    fresh, _ = client.get_item_fields_with_etag(item_id, (*IDENTITY, *EXTRA), LIST)
    if any(fresh[field] != row[field] for field in IDENTITY) or not pix_matches(
            fresh, pix, end_id, payer, allow_posting_delay=allow_posting_delay):
        raise ValueError('Pix movement identity changed')
    if content:
        filename = f'Comprovante-Sicoob-Pix-{item_id}.pdf'
        client.ensure_attachment(item_id, filename, content, 'application/pdf', target_list=LIST)
        if [f['content'] for f in client.get_item_attachments(item_id, LIST) if f['filename'] == filename] != [content]:
            raise ValueError('Pix receipt readback mismatch')
    fresh, etag = client.get_item_fields_with_etag(item_id, (*IDENTITY, *EXTRA), LIST)
    if any(fresh[field] != row[field] for field in IDENTITY) or not pix_matches(
            fresh, pix, end_id, payer, allow_posting_delay=allow_posting_delay):
        raise ValueError('Pix movement identity changed')
    fields = pix_receiver_fields(pix)
    for field in EXTRA:
        current = movements.text(fresh.get(field))
        if current.upper() not in ('', movements.UNKNOWN) and not receiver_field_matches(fresh, fields, field):
            return False
    updates = {k: v for k, v in fields.items() if movements.text(fresh.get(k)).upper() in ('', movements.UNKNOWN)}
    client.update_item_with_etag(item_id, updates, etag, LIST)
    if updates and client.get_item_fields(item_id, tuple(updates), LIST) != updates:
        raise ValueError('Pix receiver readback mismatch')
    return 'RAZAOSOCIALRECEBEDOR' in updates


def payment_details(answer, requested_id):
    result = answer.get('result')
    if answer.get('status') != 200 or not isinstance(result, dict):
        return None
    pix = result.get('resultado', result)
    if not isinstance(pix, dict):
        return None
    end_id = movements.text(pix.get('endToEndId'))
    # Receipt OCR can change the case. Keep the bank's canonical identifier.
    if END_ID.fullmatch(end_id) and end_id.casefold() == requested_id.casefold():
        return pix, end_id
    return None


def has_account_payment(answers, account, payer):
    if not payer:
        return False
    for requested_id, answer in answers.items():
        payment = payment_details(answer, requested_id)
        if payment:
            origin = payment[0].get('origem')
            if (isinstance(origin, dict) and movements.tax_id(origin.get('cpfCnpj')) == payer
                    and movements.text(origin.get('conta')).lstrip('0') == account.lstrip('0')):
                return True
    return False


def allows_payment(row, end_id, claims):
    assigned = claims.get(row['Id'])
    if assigned:
        return assigned == {end_id}
    return all(end_id not in identifiers for identifiers in claims.values())


def verify_late_postings(pix_rows, answers, account, payer, claims=None):
    """Map a late Pix to its unique statement key. None marks unverifiable candidates."""
    late = {}
    claims = claims or {}
    for requested, answer in answers.items():
        payment = payment_details(answer, requested)
        if not payment:
            continue
        pix, end_id = payment
        try:
            paid = movements.civil_date(pix['horario'])
        except (KeyError, ValueError):
            continue
        possible = [row for row in pix_rows if row.get(movements.KEY)
                    and allows_payment(row, end_id, claims)
                    and (not row.get('Attachments') or direct_ids(row) == {end_id})
                    and movements.civil_date(row['DATAPAGAMENTO']) > paid
                    and pix_matches(row, pix, end_id, payer, allow_posting_delay=True)]
        if possible:
            late[end_id] = (pix, paid, possible)
    if not late:
        return {}
    verified = dict.fromkeys(late)
    first = min(paid for _, paid, _ in late.values())
    today = datetime.now(movements.ZONE).date()
    overlap = timedelta(days=movements.POSTING_OVERLAP_DAYS)
    last = min(today, max(paid for _, paid, _ in late.values()) + overlap)
    if first > last:
        return verified
    try:
        statement_account, statements = movements.read_bank(first, last)
        if statement_account != account:
            return verified
        statement = []
        for (start, end), payload in statements.items():
            for entry in payload.get('resultado', payload)['transacoes']:
                for row in movements.payment_rows({'transacoes': [entry]}, start, end, account, {}):
                    if re.search(r'\bPIX\b', movements.bank_label(row['DESCRICAO'])):
                        day = movements.civil_date(row['DATAPAGAMENTO']).isoformat()
                        batch = (movements.text(entry.get('dataLote')) == day
                                 and movements.text(entry.get('data')) in (day + 'T00:00', day + 'T00:00:00'))
                        statement.append((row, batch))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        return verified
    claimed_keys = {row[movements.KEY]: row for row in pix_rows
                    if row.get(movements.KEY) and row['Id'] in claims}
    for end_id, (pix, paid, possible) in late.items():
        total = movements.money(pix['valor'])
        candidates = []
        for row, batch in statement:
            day, value, _, identity = pix_key(row)
            if value != total or (day != paid and not (batch and 0 < (day - paid).days <= movements.POSTING_OVERLAP_DAYS)):
                continue
            claimed = claimed_keys.get(row[movements.KEY])
            if (claimed and not allows_payment(claimed, end_id, claims)
                    and all(claimed.get(field) == row[field] for field in IDENTITY)):
                continue
            # An unidentified debit in the same window could be the payment.
            if pix_matches(row, pix, end_id, payer, allow_posting_delay=batch) or (not identity and not direct_ids(row)):
                candidates.append(row)
        if len(candidates) != 1:
            continue
        expected = candidates[0]
        if pix_matches(expected, pix, end_id, payer):
            # The statement confirmed one exact-date debit and no late alternative.
            del verified[end_id]
            continue
        if today <= paid + overlap and direct_ids(expected) != {end_id}:
            # With a masked document, another compatible debit can still post.
            continue
        for row in possible:
            if all(row.get(field) == expected[field] for field in IDENTITY):
                verified[end_id] = expected[movements.KEY]
    return verified


def bank_match(row, options, answers, movements_in_account, payer, late_postings=None, claims=None):
    if any(answers.get(end_id, {}).get('status') not in (200, 404) for end_id in options):
        return None
    movement_key = pix_key(row)[:3]
    if any(r['Id'] != row['Id'] and not pix_key(r)[-1] and not direct_ids(r) and pix_key(r)[:3] == movement_key
           for r in movements_in_account):
        return None
    late_postings = late_postings or {}
    claims = claims or {}
    matches = {}
    for requested_id, content in options.items():
        payment = payment_details(answers[requested_id], requested_id)
        if not payment:
            continue
        pix, end_id = payment
        late_key = late_postings.get(end_id)
        if end_id in late_postings and not late_key and direct_ids(row) != {end_id}:
            continue
        compatible = [r['Id'] for r in movements_in_account if allows_payment(r, end_id, claims) and pix_matches(
            r, pix, end_id, payer, allow_posting_delay=bool(late_key and r.get(movements.KEY) == late_key))]
        if compatible == [row['Id']]:
            prior = matches.get(end_id)
            if prior and prior[0] != pix:
                return None
            if not prior or not prior[2]:
                matches[end_id] = (pix, end_id, content)
    return next(iter(matches.values())) if len(matches) == 1 else None


def resolve_inbox(client, pix_rows, check, inbox=None, *, proofs=None):
    """Use notified IDs before searching historical attachments; retain failures."""
    inbox = inbox if inbox is not None else Inbox()
    identifiers = inbox.pending(limit=10001)
    stats = Counter()
    if not identifiers or not pix_rows:
        return stats
    if len(identifiers) > 10000:
        raise ValueError('Incomplete webhook snapshot')
    accounts = {pix_key(row)[2] for row in pix_rows}
    if len(accounts) != 1:
        raise ValueError('Webhook account is ambiguous')
    account = next(iter(accounts))
    cached = inbox.bank_answers(account)
    payers = {entry[0] for entry in cached.values()}
    if len(payers) > 1:
        raise ValueError('Webhook cached payer is ambiguous')
    payer = next(iter(payers), None)
    answers = {key: entry[1] for key, entry in cached.items()}
    # Bound each run and persist each batch, so large queues survive the
    # pipeline timeout. Still consider the entire snapshot before matching.
    to_query = [identifier for identifier in identifiers if identifier not in answers][:100]
    started = time.monotonic()
    for offset in range(0, len(to_query), 25):
        batch = to_query[offset:offset + 25]
        if not check:
            inbox.attempted(batch)
        data = read_pix(account, batch)
        batch_payer = movements.tax_id(data['payer_document'])
        if payer is not None and payer != batch_payer:
            raise ValueError('Webhook payer changed between batches')
        payer = batch_payer
        batch_answers = {identifier: data['results'][identifier] for identifier in batch if identifier in data['results']}
        if not check:
            inbox.remember_bank_answers(account, payer, batch_answers)
        answers.update(batch_answers)
        if time.monotonic() - started >= 180:
            break
    for identifier in identifiers:
        if identifier in answers:
            stats[f"http_{answers[identifier].get('status', 'pendente')}"] += 1
        # A notified payment returning 404 may be temporarily unavailable.
        # It remains unknown, not an eliminated competing payment.
        answer = answers.get(identifier, {})
        payment = payment_details(answer, identifier)
        status = answer.get('status')
        if status == 404 or (status == 200 and (not payment or payment[1] != identifier)):
            answers[identifier] = {'status': 'pendente'}
    options = dict.fromkeys(identifiers)
    claims = inbox.claimed_movements()
    late_postings = verify_late_postings(pix_rows, answers, account, payer, claims)
    for row in pix_rows:
        # Newly received IDs may add another candidate. Retry a fresh snapshot.
        if not set(inbox.pending(limit=10001)).issubset(options):
            break
        explicit = direct_ids(row)
        row_options = {key: value for key, value in options.items() if key in explicit} if explicit else options
        match = bank_match(row, row_options, answers, pix_rows, payer, late_postings, claims)
        if not match:
            continue
        pix, canonical, _ = match
        late_key = late_postings.get(canonical)
        delayed = bool(late_key and row.get(movements.KEY) == late_key)
        missing = movements.text(row['RAZAOSOCIALRECEBEDOR']).upper() in ('', movements.UNKNOWN)
        fields = pix_receiver_fields(pix)
        if missing:
            stats['verificados'] += 1
        if check:
            if proofs is not None and row.get(movements.KEY):
                proofs[row[movements.KEY]] = (pix, canonical, payer, None, delayed)
            if missing:
                row.update(fields)
            continue
        try:
            stats['nomes_gravados'] += save_pix(client, row, pix, canonical, payer, None, allow_posting_delay=delayed)
            fresh = client.get_item_fields(row['Id'], (*IDENTITY, *EXTRA), LIST)
            if any(fresh[field] != row[field] for field in IDENTITY):
                raise ValueError('Webhook movement changed')
            if not pix_matches(fresh, pix, canonical, payer, allow_posting_delay=delayed):
                raise ValueError('Webhook movement no longer matches')
            if any(not receiver_field_matches(fresh, fields, field) for field in fields):
                continue
            row.update({field: fresh[field] for field in EXTRA})
            if inbox.complete(canonical, row['Id']):
                claims.setdefault(row['Id'], set()).add(canonical)
        except (OSError, ValueError, RuntimeError) as error:
            stats[f'falha_gravacao_{type(error).__name__}'] += 1
    return stats


def run(check):
    client = movements.sharepoint_client()
    movements.assert_destination(client)
    pix_rows = [row for row in list_movements(client) if row['ORIGEMMOVIMENTACAO'] == 'SICOOB'
                and row['OPERACAO'] == 'DÉBITO' and re.search(r'\bPIX\b', movements.bank_label(row['DESCRICAO']))]
    pending = [row for row in pix_rows if movements.text(row['RAZAOSOCIALRECEBEDOR']).upper() in ('', movements.UNKNOWN)
               and (pix_key(row)[-1] or len(direct_ids(row)) == 1)]
    stats = Counter(pendentes=len(pending))
    inbox = Inbox()
    stats.update(resolve_inbox(client, pix_rows, check, inbox))
    webhook_pending = inbox.pending(limit=10001)
    pending = [row for row in pending if movements.text(row['RAZAOSOCIALRECEBEDOR']).upper() in ('', movements.UNKNOWN)]
    # Historical receipts must not bypass unresolved webhook ambiguity.
    if not pending or webhook_pending:
        return dict(stats)
    stats.update(resolve_receipts(client, pix_rows, pending, check, inbox))
    return dict(stats)


def prepare_import(client, records, account):
    """Resolve authenticated Pix evidence in memory before publishing any debit."""
    incoming = [row for row in records if re.search(r'\bPIX\b', movements.bank_label(row['DESCRICAO']))]
    if not incoming:
        return {}
    existing = [row for row in list_movements(client) if row['ORIGEMMOVIMENTACAO'] == 'SICOOB'
                and row['OPERACAO'] == 'DÉBITO' and movements.text(row['CONTAPAGADORA']) == account
                and re.search(r'\bPIX\b', movements.bank_label(row['DESCRICAO']))]
    prior_by_key = {row[movements.KEY]: row for row in existing if row.get(movements.KEY)}
    prepared = {}
    for index, row in enumerate(incoming, 1):
        prior = prior_by_key.get(row[movements.KEY])
        if prior:
            movements.verify_fields(prior, row, IDENTITY)
        candidate = {field: '' for field in EXTRA}
        candidate.update(row, Id=prior['Id'] if prior else -index, Attachments=bool(prior and prior.get('Attachments')))
        if prior:
            for field in EXTRA:
                if movements.text(prior.get(field)).upper() not in ('', movements.UNKNOWN):
                    candidate[field] = prior[field]
        prepared[row[movements.KEY]] = candidate
    universe = [row for row in existing if row.get(movements.KEY) not in prepared] + list(prepared.values())
    inbox = Inbox()
    proofs = {}
    resolve_inbox(client, universe, True, inbox, proofs=proofs)
    pending = [row for row in prepared.values()
               if pix_key(row)[-1] or len(direct_ids(row)) == 1]
    if pending and not inbox.pending(limit=10001):
        resolve_receipts(client, universe, pending, True, inbox, proofs=proofs)
    for row in incoming:
        for field in EXTRA:
            value = movements.text(prepared[row[movements.KEY]].get(field))
            if value.upper() not in ('', movements.UNKNOWN):
                row[field] = value
    return proofs


def finish_import(client, row, proof):
    """Retain the original receipt and verified extra fields after item readback."""
    if proof is None:
        return
    item = client._find_item(row[movements.KEY], LIST, movements.KEY)
    if not item:
        raise ValueError('Prepared Pix movement was not saved')
    fresh = client.get_item_fields(item['Id'], (*IDENTITY, *EXTRA), LIST)
    movements.verify_fields(fresh, row, IDENTITY)
    pix, end_id, payer, content, delayed = proof
    save_pix(client, {**fresh, 'Id': item['Id']}, pix, end_id, payer, content, allow_posting_delay=delayed)


def resolve_receipts(client, pix_rows, pending, check, inbox, *, proofs=None):
    stats = Counter()
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
        # Accounting entries can split or group a payment's amount. Only the
        # bank response establishes the amount and recipient of the movement.
        for launch_id in dict.fromkeys(launches[(day, value)] + launches[(day, None)]):
            if launch_id not in archive:
                archive[launch_id] = client.get_item_attachments(launch_id, 'LANCAMENTOS')
            for file in archive[launch_id]:
                if re.search(r'comprov|pix|recibo', file['filename'], re.I):
                    for end_id in cached_receipt_ids(file['content']):
                        if (not direct or end_id in direct) and not candidates.get(end_id):
                            candidates[end_id] = file['content']
        if candidates:
            by_account[account][row['Id']] = (row, candidates)
    claims = inbox.claimed_movements()
    for account, group in by_account.items():
        ids = sorted({end_id for _, options in group.values() for end_id in options})
        data = read_pix(account, ids)
        payer = movements.tax_id(data['payer_document'])
        answers = data['results']
        has_bank_details = has_account_payment(answers, account, payer)
        for row, options in group.values():
            statement_ids = direct_ids(row)
            for end_id in options:
                answer = answers.get(end_id, {})
                status = answer.get('status', 'pendente')
                if (status == 403 and answer.get('identifierDenied') is True
                        and end_id not in statement_ids and has_bank_details):
                    stats['receipt_candidates_denied'] += 1
                else:
                    stats[f'http_{status}'] += 1
            # A refused candidate stays unresolved and still blocks ambiguous matches.
            match = bank_match(row, options, answers, pix_rows, payer, claims=claims)
            if not match:
                continue
            stats['verificados'] += 1
            if check:
                fields = pix_receiver_fields(match[0])
                if any(movements.text(row.get(field)).upper() not in ('', movements.UNKNOWN)
                       and not receiver_field_matches(row, fields, field) for field in EXTRA):
                    continue
                row.update({field: value for field, value in fields.items()
                            if movements.text(row.get(field)).upper() in ('', movements.UNKNOWN)})
                if proofs is not None and row.get(movements.KEY):
                    pix, end_id, content = match
                    proofs[row[movements.KEY]] = (pix, end_id, payer, content, False)
            else:
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
