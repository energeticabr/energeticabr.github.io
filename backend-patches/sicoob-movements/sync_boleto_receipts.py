"""Attach verified Sicoob boleto receipt data to existing bank movements."""
import argparse
from collections import Counter, defaultdict
from io import BytesIO
import json
import os
from pathlib import Path
import re
import subprocess
from xml.sax.saxutils import escape

import sync_movements as movements

LIST = movements.LIST
IDENTITY = (movements.KEY, 'ORIGEMMOVIMENTACAO', 'OPERACAO', 'DESCRICAO', 'REFERENCIABANCARIA',
            'CONTAPAGADORA', 'DATAPAGAMENTO', 'VALOR')
RECEIVER = ('RAZAOSOCIALRECEBEDOR', 'DOCUMENTORECEBEDOR')
CURSOR = Path('/var/lib/energetica-sicoob-movements/receipt-cursor')


def receipt_candidate(movement):
    reference = movements.text(movement.get('REFERENCIABANCARIA'))
    description = movements.bank_label(movement.get('DESCRICAO'))
    if (movement.get('ORIGEMMOVIMENTACAO') == 'SICOOB' and movement.get('OPERACAO') == 'DÉBITO'
            and re.search(r'\b(?:BOLETO|TIT|TITULO)\b', description)
            and re.fullmatch(r'\d{4,18}', reference)):
        return reference
    return None


def receipt_matches(movement, receipt):
    if not isinstance(receipt, dict) or not movements.text(receipt.get('numeroAutenticacaoPagamento')):
        return False
    try:
        return (movements.bank_label(receipt.get('situacaoPagamento')) == 'EFETIVADO'
                and movements.text(receipt.get('numeroConta')) == movements.text(movement['CONTAPAGADORA'])
                and movements.civil_date(receipt['dataPagamento']) == movements.civil_date(movement['DATAPAGAMENTO'])
                and movements.money(receipt['valorPagamento']) == movements.money(movement['VALOR']))
    except (KeyError, TypeError, ValueError):
        return False


def receiver_fields(receipt):
    suffix = 'Final' if any(movements.text(receipt.get(key + 'Final')) for key in (
        'nomeRazaoSocialBeneficiario', 'nomeFantasiaBeneficiario', 'numeroCpfCnpjBeneficiario')) else ''
    legal = movements.text(receipt.get('nomeRazaoSocialBeneficiario' + suffix))
    trade = movements.text(receipt.get('nomeFantasiaBeneficiario' + suffix))
    document = movements.tax_id(receipt.get('numeroCpfCnpjBeneficiario' + suffix))
    name = f'{legal} ({trade})' if legal and trade and legal.casefold() != trade.casefold() else legal or trade
    result = {'RAZAOSOCIALRECEBEDOR': name[:255]} if name else {}
    if document:
        result['DOCUMENTORECEBEDOR'] = document
    return result


def missing_receiver_fields(movement, receipt):
    verified = receiver_fields(receipt)
    updates = {}
    for field in RECEIVER:
        current = movements.text(movement.get(field))
        value = verified.get(field, '')
        if current.upper() in ('', movements.UNKNOWN):
            if value:
                updates[field] = value
        elif field == 'DOCUMENTORECEBEDOR':
            if not value or movements.tax_id(current) != value:
                return {}
        elif current.casefold() != value.casefold():
            return {}
    return updates


def receipt_pdf(receipt, reference):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    values = [
        ('Situação', receipt['situacaoPagamento']),
        ('Data do pagamento', movements.civil_date(receipt['dataPagamento']).strftime('%d/%m/%Y')),
        ('Valor pago', 'R$ ' + movements.money(receipt['valorPagamento'])),
        ('Conta pagadora', receipt['numeroConta']),
        ('Pagador', receipt.get('nomeProprietarioContaCorrente')),
        ('Beneficiário', receipt.get('nomeRazaoSocialBeneficiario')),
        ('Nome fantasia', receipt.get('nomeFantasiaBeneficiario')),
        ('CPF/CNPJ do beneficiário', receipt.get('numeroCpfCnpjBeneficiario')),
        ('Beneficiário final', receipt.get('nomeRazaoSocialBeneficiarioFinal')),
        ('Nome fantasia do beneficiário final', receipt.get('nomeFantasiaBeneficiarioFinal')),
        ('CPF/CNPJ do beneficiário final', receipt.get('numeroCpfCnpjBeneficiarioFinal')),
        ('Linha digitável', receipt.get('numeroLinhaDigitavel')),
        ('Referência do extrato', reference),
        ('Autenticação bancária', receipt['numeroAutenticacaoPagamento']),
    ]
    output = BytesIO()
    styles = getSampleStyleSheet()
    rows = [[Paragraph(escape(label), styles['Normal']),
             Paragraph(escape(movements.text(value)), styles['Normal'])]
            for label, value in values if movements.text(value)]
    table = Table(rows, colWidths=[158, 314])
    table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.HexColor('#edf4f7'), colors.white]),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    document = SimpleDocTemplate(output, pagesize=A4, title='Dados do comprovante de pagamento Sicoob',
                                 author='Energético', leftMargin=60, rightMargin=60, invariant=1)
    document.build([
        Paragraph('Dados do comprovante de pagamento', styles['Title']),
        Paragraph('Boleto Sicoob', styles['Heading2']),
        Paragraph('PDF formatado pelo Energético com os dados da segunda via retornados pela API Sicoob.', styles['Normal']),
        Spacer(1, 14), table,
    ])
    return output.getvalue()


def list_movements(client):
    endpoint = client._list_endpoint(LIST) + '/items'
    after = 0
    while True:
        rows = client._values(client._request('GET', endpoint, params={
            '$select': ','.join(('Id', 'Attachments', *IDENTITY, *RECEIVER)),
            '$filter': f'Id gt {after}', '$orderby': 'Id asc', '$top': '1000',
        }))
        if not rows:
            return
        for row in rows:
            identifier = int(row['Id'])
            if identifier <= after:
                raise ValueError('Invalid movement page order')
            after = identifier
            yield row


def read_receipts(account, references):
    script = Path(__file__).with_name('Read-SicoobBoletoReceipts.ps1')
    result = subprocess.run(['/usr/bin/pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-File', str(script)],
                            input=json.dumps({'account': account, 'references': references}),
                            encoding='utf-8', capture_output=True, timeout=840)
    if result.returncode:
        raise RuntimeError('SICOOB_RECEIPT_READ_FAILED')
    return json.loads(result.stdout)


def receipt_filename(reference):
    return f'Comprovante-Sicoob-{reference}.pdf'


def save_receipt(client, movement, reference, receipt):
    item_id = movement['Id']
    fresh, etag = client.get_item_fields_with_etag(item_id, (*IDENTITY, *RECEIVER), LIST)
    if any(fresh.get(field) != movement.get(field) for field in IDENTITY) or not receipt_matches(fresh, receipt):
        raise ValueError('Movement identity changed before attachment')
    updates = missing_receiver_fields(fresh, receipt)
    if updates:
        client.update_item_with_etag(item_id, updates, etag, target_list=LIST)
    filename = receipt_filename(reference)
    pdf = receipt_pdf(receipt, reference)
    client.ensure_attachment(item_id, filename, pdf, 'application/pdf', target_list=LIST)
    copies = [file['content'] for file in client.get_item_attachments(item_id, LIST) if file['filename'] == filename]
    if copies != [pdf] or client.get_item_fields(item_id, tuple(updates), LIST) != updates:
        raise ValueError('Movement receipt readback mismatch')
    return 'RAZAOSOCIALRECEBEDOR' in updates


def receipt_order(pending, cursor):
    return sorted(pending, key=lambda reference: (
        int(pending[reference]['Id']) >= cursor,
        -int(pending[reference]['Id']),
    ))


def run(check):
    client = movements.sharepoint_client()
    movements.assert_destination(client)
    records = defaultdict(list)
    for movement in list_movements(client):
        reference = receipt_candidate(movement)
        if reference:
            records[reference].append(movement)

    result = Counter()
    accounts = defaultdict(dict)
    for reference, candidates in records.items():
        if len(candidates) != 1:
            result['ambiguous_reference'] += len(candidates)
            continue
        movement = candidates[0]
        if movement['Attachments'] and receipt_filename(reference) in client.get_attachment_names(movement['Id'], LIST):
            result['already_attached'] += 1
            continue
        accounts[movement['CONTAPAGADORA']][reference] = movement
    cursor = int(CURSOR.read_text().strip()) if CURSOR.exists() else 0
    last_attempt = None
    for account, pending in accounts.items():
        selected = receipt_order(pending, cursor)[:30]
        receipts = read_receipts(account, selected)
        for reference in selected:
            response = receipts.get(reference, {})
            receipt = response.get('receipt')
            if response.get('status') not in (None, 429):
                last_attempt = int(pending[reference]['Id'])
            if response.get('status') != 200 or not receipt_matches(pending[reference], receipt):
                result[f"unverified_{response.get('status', 'deferred')}"] += 1
                continue
            result['verified'] += 1
            if not check:
                try:
                    result['names_recovered'] += save_receipt(client, pending[reference], reference, receipt)
                except (RuntimeError, ValueError, OSError) as error:
                    result[f'write_failed_{type(error).__name__}'] += 1
                else:
                    result['attached'] += 1
    if not check and last_attempt is not None:
        temporary = CURSOR.with_suffix(f'.{os.getpid()}.tmp')
        temporary.write_text(f'{last_attempt}\n')
        temporary.replace(CURSOR)
    return dict(result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.check), sort_keys=True))
    except Exception as error:
        parser.exit(1, f'SICOOB_RECEIPT_SYNC_FAILED ({type(error).__name__})\n')
