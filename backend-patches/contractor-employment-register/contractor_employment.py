"""Register future app submissions in a new, independent HR list.

No source list reads, schema discovery, ACL access or background import. The
ordinary supplier writer shares only the durable locking/checkpoint utilities.
"""
from contextlib import contextmanager
from datetime import date, datetime
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
from urllib.parse import quote, unquote, urljoin, urlsplit
from xml.etree import ElementTree as ET

import requests

SOURCE = 'FORNECEDORES'  # Used only by the separate, normal registration writer.
TARGET = 'FUNCIONARIOSRH'
KEY = 'IDFORNECEDORORIGEM'
JSON_HEADERS = {'Content-Type': 'application/json;odata=nometadata'}
ROLES = ('SERVENTE DE PEDREIRO I', 'SERVENTE DE PEDREIRO II', 'SERVENTE DE PEDREIRO III',
         'PEDREIRO I', 'PEDREIRO II', 'PEDREIRO III', 'MESTRE DE OBRAS', 'SUPERVISOR DE OBRAS')
TEXT_FIELDS = ('Title', KEY, 'CARGO', 'EMPREITEIRO', 'STATUS', 'FILIAL', 'TIPO', 'CIDADE',
    'VINCULO', 'HOMOLOGACAO', 'TIPODOCUMENTO', 'DOCUMENTOFORNECEDOR', 'TELEFONECONTATO',
    'WHATSAPP', 'EMAIL', 'PROFISSAO', 'FORMAPGTO', 'VLRDIARIO', 'HORASTRABALHO', 'MEDICAOATUAL', 'IMOVEL')
NOTE_FIELDS = ('ENDERECO', 'DESCRITIVOETAPAATUAL', 'ATIVIDADEEXERCIDA')
DATE_FIELDS = ('DATAADMISSAO', 'DATADESLIGAMENTO', 'DATANASCIMENTO')
FIELD_TYPES = {**dict.fromkeys(TEXT_FIELDS, 'Text'), **dict.fromkeys(NOTE_FIELDS, 'Note'),
               **dict.fromkeys(DATE_FIELDS, 'DateTime')}
FIELD_MAP = {name: name for name in FIELD_TYPES if name != KEY}
FIELD_MAP.update({'CADASTRO': 'Title', 'HOMOLOGAÇÃO': 'HOMOLOGACAO',
    'DOCUMENTO FORNECEDOR': 'DOCUMENTOFORNECEDOR', 'ENDEREÇO': 'ENDERECO',
    'FORMA PGTO': 'FORMAPGTO', 'VLR DIARIO': 'VLRDIARIO',
    'DESCRITIVOETAPA ATUAL': 'DESCRITIVOETAPAATUAL', 'ATIVIDADE EXERCIDA': 'ATIVIDADEEXERCIDA',
    'MEDIÇÃOATUAL': 'MEDICAOATUAL'})
MUTABLE_HISTORY = {'CARGO', 'DATAADMISSAO', 'DATADESLIGAMENTO', 'STATUS'}


def _positive_id(value):
    if isinstance(value, bool) or not isinstance(value, (int, str)) or not re.fullmatch(r'[1-9][0-9]*', str(value)):
        raise ValueError('Invalid supplier ID')
    return int(value)


def collection(client, endpoint, params=None):
    """Read all pages, rejecting continuations outside this exact collection."""
    original = urljoin(client.site_url.rstrip('/') + '/_api/', endpoint)
    expected = urlsplit(original)
    allowed = (expected.scheme, expected.netloc, unquote(expected.path).casefold())
    seen, result, url = set(), [], original
    while url:
        parsed = urlsplit(url)
        if (parsed.scheme, parsed.netloc, unquote(parsed.path).casefold()) != allowed or parsed.fragment:
            raise ValueError('Unexpected SharePoint continuation')
        if url in seen or len(seen) >= 10000:
            raise ValueError('Repeated or excessive SharePoint continuation')
        seen.add(url)
        payload = client._request('GET', url, params=params)
        params = None
        data = payload.get('d', {}) if isinstance(payload, dict) else {}
        rows = payload.get('value', data.get('results')) if isinstance(payload, dict) else None
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError('Incomplete SharePoint collection')
        result.extend(rows)
        links = [payload.get('@odata.nextLink'), payload.get('odata.nextLink'), data.get('__next')]
        links = [link for link in links if link not in (None, '')]
        if any(not isinstance(link, str) for link in links) or len(set(links)) > 1:
            raise ValueError('Invalid SharePoint continuation')
        url = urljoin(original, links[0]) if links else None
    return result


def list_fields(client, title=TARGET):
    return collection(client, client._list_endpoint(title) + '/fields', {
        '$select': 'InternalName,Title,TypeAsString,ReadOnlyField,Hidden,SchemaXml,Indexed,EnforceUniqueValues',
        '$top': '5000'})


def expected_fields():
    result = []
    for name, kind in FIELD_TYPES.items():
        attrs = {'Name': name, 'StaticName': name, 'DisplayName': 'CADASTRO' if name == 'Title' else name,
                 'Type': kind, 'Required': 'FALSE'}
        if name == KEY:
            attrs.update(Indexed='TRUE', EnforceUniqueValues='TRUE', MaxLength='255')
        if kind == 'DateTime':
            attrs['Format'] = 'DateOnly'
        if kind == 'Note':
            attrs.update(RichText='FALSE', NumLines='6')
        result.append({'InternalName': name, 'Title': attrs['DisplayName'], 'TypeAsString': kind,
                       'SchemaXml': ET.tostring(ET.Element('Field', attrs), encoding='unicode')})
    return result


def validate_field(actual, expected):
    name = expected['InternalName']
    if actual.get('TypeAsString') != expected['TypeAsString'] or actual.get('ReadOnlyField') or actual.get('Hidden'):
        raise ValueError('Incompatible target field: ' + name)
    if name == KEY and not (actual.get('Indexed') is True and actual.get('EnforceUniqueValues') is True):
        raise ValueError('Source identity must be unique and indexed')
    if name in DATE_FIELDS and ET.fromstring(actual['SchemaXml']).get('Format', '').casefold() != 'dateonly':
        raise ValueError('Expected date-only target field: ' + name)


def _state_directory(client, state_store):
    base = getattr(state_store, 'directory', None) or os.getenv('CONTRACTOR_EMPLOYMENT_STATE_DIR')
    if base is None:
        base = '/var/lib/energetica-whatsapp/state'
    site = hashlib.sha256(client.site_url.rstrip('/').casefold().encode()).hexdigest()[:20]
    directory = Path(base).resolve() / 'contractor-employment-register' / site
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    if directory.is_symlink() or not directory.is_dir():
        raise RuntimeError('Invalid registration state directory')
    return directory


@contextmanager
def supplier_lock(directory, identity):
    """Persistent shared inode, not PrivateTmp, across both service processes."""
    descriptor = os.open(directory / f'{identity}.lock',
        os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    acquired = False
    try:
        if os.fstat(descriptor).st_size == 0:
            os.write(descriptor, b'0')
        deadline = time.monotonic() + 30
        while not acquired:
            try:
                if os.name == 'nt':
                    import msvcrt
                    os.lseek(descriptor, 0, os.SEEK_SET)
                    msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except (BlockingIOError, OSError):
                if time.monotonic() >= deadline:
                    raise TimeoutError('Registration reconciliation already running') from None
                time.sleep(.05)
        yield
    finally:
        if acquired:
            if os.name == 'nt':
                import msvcrt
                os.lseek(descriptor, 0, os.SEEK_SET)
                msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def _checkpoint(path, state):
    descriptor, temporary = tempfile.mkstemp(prefix='.checkpoint-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            json.dump(state, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name != 'nt':
            descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _read_checkpoint(path):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def submission_proof(client, supplier_id, *, state_store=None, flow_id=None):
    """Both a post-cutover flow marker and its first source POST are required."""
    source_id = _positive_id(supplier_id)
    directory = _state_directory(client, state_store)
    proof = _read_checkpoint(directory / f'submission-{source_id}.json')
    marked = proof.get('flow_id', '')
    if not isinstance(marked, str) or not re.fullmatch('[0-9a-f]{32}', marked):
        return None
    marker = _read_checkpoint(directory / f'flow-{marked}.json')
    if (proof.get('version') != 1 or proof.get('supplier_id') != source_id
            or marker.get('version') != 1 or marker.get('flow_id') != marked
            or marker.get('token_hash') != proof.get('token_hash')
            or not re.fullmatch('[0-9a-f]{64}', str(proof.get('token_hash', '')))
            or (flow_id is not None and flow_id != marked)):
        return None
    return proof


def _civil_date(value):
    if not isinstance(value, str):
        raise ValueError('Expected a validated civil date')
    if len(value) > 10:
        datetime.fromisoformat(value.replace('Z', '+00:00'))
    day = date.fromisoformat(value[:10]).isoformat()
    try:
        from .clients import _sharepoint_datetime_for_civil_date
    except ImportError:
        from clients import _sharepoint_datetime_for_civil_date
    return _sharepoint_datetime_for_civil_date(day)


def _payload(source_id, fields):
    if not isinstance(fields, dict):
        raise ValueError('Expected validated submission answers')
    payload = dict.fromkeys(FIELD_TYPES)
    payload[KEY] = str(source_id)
    seen = set()
    for alias, value in fields.items():
        name = FIELD_MAP.get(alias)
        if name is None or name in seen:
            raise ValueError('Unknown or duplicate submission field')
        seen.add(name)
        if value in (None, ''):
            continue
        if name in DATE_FIELDS:
            value = _civil_date(value)
        elif not isinstance(value, str):
            raise ValueError('Expected a text submission answer')
        if FIELD_TYPES[name] == 'Text' and len(value) > 255:
            raise ValueError('Submission text exceeds target capacity')
        payload[name] = value
    if (not payload['Title'] or not payload['Title'].strip() or payload['CARGO'] not in ROLES
            or payload['DATAADMISSAO'] is None or payload['DATADESLIGAMENTO'] is not None
            or payload['VINCULO'] not in {'CLT', 'TERCEIRIZADO', 'INFORMAL'}):
        raise ValueError('Incomplete or invalid employee submission')
    return payload


def _files(files):
    result = {}
    for file in files:
        name, content = file.get('filename'), file.get('content')
        if (not isinstance(name, str) or not name or name in {'.', '..'}
                or any(c in name for c in '/\\\r\n\0') or name in result
                or not isinstance(content, bytes)):
            raise ValueError('Invalid local submission attachment')
        result[name] = content
    return result


def _digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(',', ':')).encode('utf-8')).hexdigest()


def _lookup(client, source_id):
    rows = collection(client, client._list_endpoint(TARGET) + '/items', {
        '$select': 'Id,' + KEY, '$filter': f"{KEY} eq '{source_id}'", '$top': '2'})
    if len(rows) > 1:
        raise RuntimeError('Duplicate HR identity; reconciliation required')
    return rows[0] if rows else None


def _matches(actual, expected, name):
    if name in DATE_FIELDS and actual is not None and expected is not None:
        try:
            return datetime.fromisoformat(actual.replace('Z', '+00:00')) == datetime.fromisoformat(expected.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            return False
    return actual == expected


def _verify_fields(client, endpoint, target_id, payload, *, historical=False):
    result = client._request('GET', endpoint, params={'$select': ','.join(['Id', *FIELD_TYPES])})
    row = result.get('d', result)
    if _positive_id(row.get('Id', row.get('ID'))) != target_id:
        raise RuntimeError('HR receipt identity not confirmed')
    for name, value in payload.items():
        if historical and name in MUTABLE_HISTORY:
            continue  # Never restore the original active status over a later edit.
        if name not in row or not _matches(row[name], value, name):
            raise RuntimeError('HR registration fields not confirmed')


def _attachment_names(client, endpoint):
    return {row['FileName'] for row in collection(client, endpoint + '/AttachmentFiles',
        {'$select': 'FileName', '$top': '5000'})}


def register_from_submission(client, supplier_id, fields, files=(), *, state_store=None) -> dict:
    """Create once from local validated input, returning only a verified receipt.

    Ineligible input is skipped. Eligible input without both cutover proofs is an
    error, not permission to import an existing supplier. Replays never MERGE.
    """
    source_id = _positive_id(supplier_id)
    if not isinstance(fields, dict):
        raise ValueError('Expected validated submission answers')
    if fields.get('EMPREITEIRO') != 'SIM' or fields.get('STATUS') != 'ATIVO':
        return {'status': 'skipped', 'supplier_id': source_id}
    payload, local_files = _payload(source_id, fields), _files(files)
    directory = _state_directory(client, state_store)
    with supplier_lock(directory, 'target-' + str(source_id)):
        proof = submission_proof(client, source_id, state_store=state_store)
        if not proof:
            raise RuntimeError('Future submission authority missing; no HR import allowed')
        intent = _digest({'payload': payload, 'files': {n: hashlib.sha256(b).hexdigest()
            for n, b in local_files.items()}, 'proof': proof})
        path = directory / f'target-{source_id}.json'
        saved = _read_checkpoint(path)
        if saved and (saved.get('phase') not in {'create_pending', 'linked', 'verified'}
                or saved.get('intent') != intent or saved.get('supplier_id') != source_id):
            raise RuntimeError('HR submission intent changed; reconcile without overwriting')
        actual = {f['InternalName']: f for f in list_fields(client)}
        for expected in expected_fields():
            if expected['InternalName'] not in actual:
                raise ValueError('Explicit HR schema must be provisioned first')
            validate_field(actual[expected['InternalName']], expected)
        existing = _lookup(client, source_id)
        if existing and not saved:
            raise RuntimeError('Untracked HR identity; refusing adoption')
        target_id = _positive_id(existing['Id']) if existing else saved.get('target_id')
        if existing and saved.get('target_id') not in (None, target_id):
            raise RuntimeError('HR identity changed; reconcile without overwriting')
        historical = saved.get('phase') == 'verified'
        checkpoint = {'phase': 'create_pending', 'supplier_id': source_id, 'intent': intent}
        if target_id is None:
            if saved:
                raise RuntimeError('HR create uncertain; refusing another POST')
            _checkpoint(path, checkpoint)
            try:
                created = client._request('POST', client._list_endpoint(TARGET) + '/items',
                    json=payload, headers=JSON_HEADERS)
                target_id = _positive_id(created.get('d', created)['Id'])
            except (requests.RequestException, KeyError, ValueError):
                existing = _lookup(client, source_id)
                if existing is None:
                    raise RuntimeError('HR create uncertain; reconciliation required') from None
                target_id = _positive_id(existing['Id'])
        target_id = _positive_id(target_id)
        checkpoint.update(phase='verified' if historical else 'linked', target_id=target_id)
        _checkpoint(path, checkpoint)
        endpoint = client._list_endpoint(TARGET) + f'/items({target_id})'
        _verify_fields(client, endpoint, target_id, payload, historical=historical)
        names = _attachment_names(client, endpoint)
        if not historical and not names.issubset(local_files):
            raise RuntimeError('Unexpected HR attachments; reconciliation required')
        for name, content in local_files.items():
            escaped = quote(name.replace("'", "''"), safe='')
            if name not in names:
                if historical:
                    raise RuntimeError('Verified HR attachment missing; reconciliation required')
                try:
                    client._request('POST', endpoint + f"/AttachmentFiles/add(FileName='{escaped}')",
                        data=content, headers={'Content-Type': 'application/octet-stream'})
                except requests.RequestException:
                    if name not in _attachment_names(client, endpoint):
                        raise RuntimeError('HR attachment incomplete; retry the same local file') from None
            response = client._request('GET', endpoint +
                f"/AttachmentFiles/getByFileName('{escaped}')/$value", _return_response=True)
            if response.content != content:
                raise RuntimeError('HR attachment bytes not confirmed')
        final_names = _attachment_names(client, endpoint)
        if (not set(local_files).issubset(final_names)
                or (not historical and final_names != set(local_files))):
            raise RuntimeError('HR attachment set not confirmed')
        _verify_fields(client, endpoint, target_id, payload, historical=historical)
        _checkpoint(path, {**checkpoint, 'phase': 'verified'})
        return {'status': 'registered', 'supplier_id': source_id, 'target_id': target_id, 'verified': True}
