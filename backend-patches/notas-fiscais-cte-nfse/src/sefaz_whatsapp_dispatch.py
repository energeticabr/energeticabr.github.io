"""Private SSH NF-e notification ingress and delivery reconciler.

Shares the existing DDA WhatsApp gateway queue; opens no HTTP listener. The
receipt and PDF come from the authenticated, completed SharePoint import.
"""
from contextlib import closing
import base64
from decimal import Decimal, InvalidOperation
from datetime import date, datetime
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time

from fiscal_document import KEY_PATTERN, issue_day, parse_fiscal_xml

ROOT = Path('/var/lib/energetica-whatsapp')
DB = ROOT / 'whatsmeow/gateway.db'
CONFIG = ROOT / 'sefaz-notifications/config.json'
DDA_CONFIG = ROOT / 'dda-notifications/config.json'
FILES = ROOT / 'outbound-documents/sefaz-notifications'
COMPANY = '38626750000146'
NS = {'n': 'http://www.portalfiscal.inf.br/nfe'}
MAX_REQUEST = 4_600_000


def destination(config, dda):
    group = config.get('groupId', '')
    if (config.get('enabled') is not True or dda.get('enabled') is not True
            or config.get('companyCnpj') != COMPANY or dda.get('payerId') != COMPANY
            or config.get('groupName') != 'NOVO DDA' or dda.get('groupName') != 'NOVO DDA'
            or not re.fullmatch(r'[0-9-]+@g\.us', group) or group != dda.get('groupId')):
        raise ValueError('DESTINATION_NOT_CONFIGURED')
    return group


def schema(c):
    c.executescript('''CREATE TABLE IF NOT EXISTS sefaz_notification_meta(
        name TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sefaz_notification_dispatch(
        key TEXT PRIMARY KEY,group_id TEXT NOT NULL,xml_hash TEXT NOT NULL,pdf_hash TEXT NOT NULL,
        text TEXT NOT NULL,pdf_path TEXT NOT NULL,file_name TEXT NOT NULL,state TEXT NOT NULL,
        text_id INTEGER,pdf_id INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sefaz_notification_audit(
        key TEXT NOT NULL,code TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(key,code));''')


def require_initialized(c, group):
    row = c.execute('SELECT value FROM sefaz_notification_meta WHERE name=?', ('destination',)).fetchone()
    if not row:
        raise ValueError('NOT_INITIALIZED')
    if row[0] != group:
        raise ValueError('DESTINATION_CHANGED')


def initialize(config, dda, db=DB):
    group = destination(config, dda)
    keys = config.get('baselineKeys')
    if (not isinstance(keys, list) or not keys or len(set(keys)) != len(keys)
            or any(not isinstance(k, str) or not re.fullmatch(KEY_PATTERN, k) for k in keys)):
        raise ValueError('BASELINE_REQUIRED')
    baseline = hashlib.sha256('\n'.join(sorted(keys)).encode()).hexdigest()
    with closing(sqlite3.connect(db, timeout=30)) as c, c:
        schema(c)
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT value FROM sefaz_notification_meta WHERE name=?', ('baseline',)).fetchone()
        if row:
            require_initialized(c, group)
            if row[0] != baseline:
                raise ValueError('BASELINE_CHANGED')
            return {'status': 'initialized', 'baselineCount': len(keys), 'duplicate': True}
        if c.execute('SELECT count(*) FROM sefaz_notification_dispatch').fetchone()[0]:
            raise ValueError('BASELINE_RESET_FORBIDDEN')
        now = int(time.time())
        for key in keys:
            c.execute('INSERT INTO sefaz_notification_dispatch VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                      (key, group, '', '', '', '', '', 'baseline', None, None, now, now))
        c.executemany('INSERT INTO sefaz_notification_meta VALUES(?,?)', [('destination', group), ('baseline', baseline)])
    return {'status': 'initialized', 'baselineCount': len(keys), 'duplicate': False}


def validate(request):
    doc = request.get('document', {})
    key = doc.get('key', '')
    if (request.get('source') != 'SEFAZ' or not isinstance(key, str) or not re.fullmatch(KEY_PATTERN, key)
            or doc.get('kind') not in ('nfeProc', 'cteProc', 'cteOSProc', 'cteSimpProc', 'NFSe')
            or not re.fullmatch(r'[0-9]{15,19}-[a-f0-9]{16}', doc.get('id', ''))
            or int(doc.get('id', '0').split('-')[0]) > 9223372036854775807):
        raise ValueError('INVALID_IDENTITY')
    receipt = request.get('receipt', {})
    ids = receipt.get('acknowledgedIds', [])
    if receipt.get('source') != 'SEFAZ' or not isinstance(ids, list) or ids.count(doc['id']) != 1:
        raise ValueError('SHAREPOINT_RECEIPT_REQUIRED')
    # Supplied fields are never a source of financial metadata. An explicit
    # cancellation/incomplete declaration is an additional conservative veto.
    fields = doc.get('fields', {})
    if (not isinstance(fields, dict) or fields.get('SITUACAO', 'AUTORIZADA') != 'AUTORIZADA'
            or doc.get('fiscalSituation', 'AUTORIZADA') != 'AUTORIZADA'
            or fields.get('STATUS_IMPORTACAO', 'XML_COMPLETO') != 'XML_COMPLETO'):
        raise ValueError('INVALID_AUTHORIZATION')
    try:
        encoded = doc['xmlBase64']
        if not isinstance(encoded, str) or len(encoded) > 1_500_000:
            raise ValueError()
        raw = base64.b64decode(encoded, validate=True)
        digest = hashlib.sha256(raw).hexdigest()
        if digest != doc.get('sha256') or not doc['id'].endswith('-' + digest[:16]):
            raise ValueError()
    except Exception:
        raise ValueError('INVALID_XML') from None
    fiscal = parse_fiscal_xml(raw, key, COMPANY, required_environment='1')
    if fiscal.kind != doc['kind']:
        raise ValueError('INVALID_IDENTITY')
    company = ' '.join(fiscal.supplier.translate(str.maketrans({'*': ' ', '_': ' ', '~': ' ', '`': ' '})).split())
    if not company or len(company) > 250 or any(ord(c) < 32 for c in company):
        raise ValueError('INVALID_COMPANY')
    if 'T' in fiscal.issued_at:
        original = datetime.fromisoformat(fiscal.issued_at.replace('Z', '+00:00'))
        emission = f'*{original:%d/%m/%Y} às {original:%H:%M:%S}*'
    else:
        emission = f'*{issue_day(fiscal.issued_at):%d/%m/%Y}* — horário não informado'
    value = format(fiscal.amount, ',.2f').translate(str.maketrans({',': '.', '.': ','}))
    danfe = doc.get('danfe', {})
    filename = f'{fiscal.prefix}-{key}-{digest[:16]}.pdf'
    try:
        encoded_pdf = danfe['pdfBase64']
        if not isinstance(encoded_pdf, str) or len(encoded_pdf) > 2_700_000:
            raise ValueError()
        pdf = base64.b64decode(encoded_pdf, validate=True)
        pdf_hash = hashlib.sha256(pdf).hexdigest()
        if (not 20 <= len(pdf) <= 2_000_000 or not pdf.startswith(b'%PDF-') or not pdf.rstrip().endswith(b'%%EOF')
                or pdf_hash != danfe.get('sha256') or filename != danfe.get('fileName')):
            raise ValueError()
    except Exception:
        raise ValueError('INVALID_PDF') from None
    # Preserve the established NF-e text exactly; new document types identify
    # themselves while keeping the same supplier/value/emission emphasis.
    label = fiscal.fiscal_type + (' IDENTIFICADA' if fiscal.kind == 'NFSe' else ' IDENTIFICADO')
    if fiscal.kind == 'nfeProc':
        text = f'NOVA NOTA IDENTIFICADA DA EMPRESA *{company}* NO VALOR DE *R$ {value}*\nEmissão: {emission}'
    else:
        text = f'{label} DA EMPRESA *{company}* NO VALOR DE *R$ {value}*\nEmissão: {emission}'
    return key, digest, pdf_hash, text, filename, pdf


def grant_gateway_read(path):
    if os.name == 'nt':
        return
    gateway_gid = path.parent.parent.stat().st_gid
    os.chown(path.parent, -1, gateway_gid)
    os.chmod(path.parent, 0o750)
    os.chown(path, -1, gateway_gid)
    os.chmod(path, 0o640)


def stage(request, config, dda, db=DB, files=FILES):
    group = destination(config, dda)
    key, xml_hash, pdf_hash, text, filename, pdf = validate(request)
    with closing(sqlite3.connect(db, timeout=30)) as c, c:
        c.execute('BEGIN IMMEDIATE')
        require_initialized(c, group)
        row = c.execute('SELECT state,xml_hash,pdf_hash FROM sefaz_notification_dispatch WHERE key=?', (key,)).fetchone()
        if row:
            if row[0] != 'baseline' and row[1:] != (xml_hash, pdf_hash):
                raise ValueError('CONTENT_CHANGED')
            return {'status': row[0], 'duplicate': True, 'key': key}
        if config.get('minimumIssueDate'):
            minimum = date.fromisoformat(config['minimumIssueDate'])
            fiscal = parse_fiscal_xml(base64.b64decode(request['document']['xmlBase64'], validate=True),
                                      key, COMPANY, required_environment='1')
            if issue_day(fiscal.issued_at) < minimum:
                audit(c, key, 'BEFORE_MINIMUM_ISSUE_DATE')
                return {'status': 'scope_excluded', 'duplicate': False, 'key': key}
        files = Path(files)
        files.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = files / filename
        temporary = files / (filename + '.tmp')
        with open(temporary, 'wb') as output:
            os.chmod(temporary, 0o600)
            output.write(pdf)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        grant_gateway_read(path)
        if os.name != 'nt':
            directory = os.open(files, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        now = int(time.time())
        c.execute('INSERT INTO sefaz_notification_dispatch VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                  (key, group, xml_hash, pdf_hash, text, str(path), filename, 'staged', None, None, now, now))
    return {'status': 'staged', 'duplicate': False, 'key': key}


def audit(c, key, code):
    c.execute('INSERT OR IGNORE INTO sefaz_notification_audit VALUES(?,?,?)', (key, code, int(time.time())))


def drain(config, dda, db=DB):
    group = destination(config, dda)
    with closing(sqlite3.connect(db, timeout=30)) as c, c:
        c.row_factory = sqlite3.Row
        c.execute('BEGIN IMMEDIATE')
        require_initialized(c, group)
        # One unfinished invoice owns the destination until BOTH phases are
        # acknowledged. BEGIN IMMEDIATE makes selection and enqueue atomic
        # across concurrent drains. Rowid preserves staging order, including
        # when timestamps tie; an uncertain/blocked head must not be overtaken.
        rows = c.execute("SELECT rowid AS dispatch_rowid,* FROM sefaz_notification_dispatch "
                         "WHERE state NOT IN ('baseline','sent') "
                         "ORDER BY rowid LIMIT 100").fetchall()
        for row in rows:
            key = row['key']
            if row['group_id'] != group:
                raise ValueError('DESTINATION_CHANGED')
            state = row['state']
            for phase in ('text', 'pdf'):
                completion = 'sefaz-new-' + key + '-' + phase
                ack = c.execute('SELECT 1 FROM gateway_completion_messages WHERE completion_id=? AND chat_id=? AND message_id<>?',
                                (completion, group, '')).fetchone()
                if ack:
                    state = 'sent' if phase == 'pdf' else 'text_sent'
                    continue
                queued_id = row[phase + '_id']
                if queued_id is not None:
                    pending = c.execute('SELECT message,attempts FROM gateway_outbox WHERE id=?', (queued_id,)).fetchone()
                    if pending:
                        message = json.loads(pending[0])
                        if message.get('completionId') != completion or message.get('group_id') != group or message.get('conversation_id') != group:
                            raise ValueError('QUEUE_IDENTITY_CHANGED')
                        state = phase + '_queued'
                        if pending[1] > 0:
                            audit(c, key, phase.upper() + '_GATEWAY_RETRYING')
                    else:
                        state = 'unconfirmed'
                        audit(c, key, phase.upper() + '_UNCONFIRMED')
                    break
                message = {'conversation_id': group, 'group_id': group, 'trackCompletionSuccess': True, 'completionId': completion}
                if phase == 'text':
                    message.update(type='text', text=row['text'])
                else:
                    # The original SharePoint-confirmed bytes are retained; no regeneration or URL download.
                    path = Path(row['pdf_path'])
                    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != row['pdf_hash']:
                        state = 'pdf_blocked'
                        audit(c, key, 'PDF_CONTENT_MISSING_OR_CHANGED')
                        break
                    grant_gateway_read(path)
                    message.update(type='document', path=str(path), fileName=row['file_name'], mimeType='application/pdf')
                message_id = c.execute('INSERT INTO gateway_outbox(message,created_at) VALUES(?,?)',
                                       (json.dumps(message, ensure_ascii=False).encode('utf8'), int(time.time()))).lastrowid
                c.execute('UPDATE sefaz_notification_dispatch SET ' + phase + '_id=? WHERE key=?', (message_id, key))
                state = phase + '_queued'
                break
            c.execute('UPDATE sefaz_notification_dispatch SET state=?,updated_at=? WHERE key=?', (state, int(time.time()), key))
            if state != 'sent':
                break
        counts = dict(c.execute('SELECT state,count(*) FROM sefaz_notification_dispatch GROUP BY state').fetchall())
    return {'status': 'reconciled', 'counts': counts}


def status(key, db=DB):
    if not isinstance(key, str) or not re.fullmatch(KEY_PATTERN, key):
        raise ValueError('INVALID_KEY')
    with closing(sqlite3.connect(db, timeout=30)) as c:
        row = c.execute('SELECT state FROM sefaz_notification_dispatch WHERE key=?', (key,)).fetchone()
    return {'status': row[0] if row else 'missing', 'key': key}


def main():
    os.umask(0o077)
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
        if len(raw) > MAX_REQUEST:
            raise ValueError('INPUT_TOO_LARGE')
        request = json.loads(raw)
        mode = request.get('mode', 'stage')
        config, dda = json.loads(CONFIG.read_text()), json.loads(DDA_CONFIG.read_text())
        if mode == 'initialize':
            result = initialize(config, dda)
        elif mode == 'drain':
            result = drain(config, dda)
        elif mode == 'status':
            destination(config, dda)
            result = status(request.get('key', ''))
        elif mode == 'stage':
            result = stage(request, config, dda)
        else:
            raise ValueError('INVALID_MODE')
        print(json.dumps(result))
        return 0
    except Exception:
        print('{"status":"failed","reason":"SEFAZ_NOTIFICATION_FAILED"}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
