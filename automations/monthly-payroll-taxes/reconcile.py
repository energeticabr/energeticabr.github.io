"""Resumable initial INSS/FGTS replacement; all remote I/O is caller supplied.

The adapter must return complete find results and full read rows, expose
``audit_etag``, enforce the preflighted unique keys, and never retry mutations
internally. Callers serialize executions and retain the private journal.
No payroll calculations, credentials, payment execution or delete operations
belong here. A receipt is returned only after independent final readback.
"""
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile


_spec = importlib.util.spec_from_file_location('monthly_reconcile_model', Path(__file__).with_name('model.py'))
model = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(model)

PARENTS = 'DESCRITIVOPROVISAO'
PROVISIONS = 'PROVISÃO PGTOS'
PAYROLL = 'FOLHAPGTO'
TAXES = ('INSS', 'FGTS')
_MONEY = {'VALORTOTAL', 'VALORUNITARIO', 'FRETE'}
_IDS = {'IDFOLHA', 'IDPROVISAO', 'DESCRITIVOPROVISAO'}
_DATES = {'DATA', 'DATAPREVISTOPGTO'}


class ReconciliationError(ValueError):
    """Unsafe, divergent or uncertain state; no automatic blind retry is safe."""


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def _fingerprint(value):
    return hashlib.sha256(_canonical(value).encode('utf-8')).hexdigest()


class JsonJournal:
    """Atomic, fsynced private operation intents, surviving new instances.

    An attempt is durable BEFORE entering the transport. An unconfirmed attempt
    cannot be issued again even when a timeout happened before server commit.
    Keep this file outside version control; it contains the exact private intent.
    """

    def __init__(self, path):
        self.path = Path(path)
        self._load()

    def _load(self):
        if not self.path.exists():
            return {'version': 1, 'records': {}}
        try:
            data = json.loads(self.path.read_text(encoding='utf-8'))
            if data['version'] != 1 or not isinstance(data['records'], dict):
                raise ValueError()
            for record in data['records'].values():
                if record['fingerprint'] != _fingerprint(record['intent']):
                    raise ValueError()
            return data
        except (ValueError, KeyError, TypeError):
            raise ReconciliationError('Journal inválido; não reiniciar tentativas incertas.') from None

    def _save(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=self.path.parent,
                                             prefix=self.path.name + '.', suffix='.tmp', delete=False) as stream:
                temp_path = stream.name
                stream.write(_canonical(data))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_path, self.path)
        finally:
            if temp_path is not None and os.path.exists(temp_path):
                os.unlink(temp_path)

    @staticmethod
    def _key(operation, title, key):
        return _canonical([operation, title, str(key)])

    def record(self, operation, title, key, intent):
        record = self._load()['records'].get(self._key(operation, title, key))
        if record is not None and record['fingerprint'] != _fingerprint(intent):
            raise ReconciliationError('Intenção diverge do journal congelado.')
        return deepcopy(record)

    def _update(self, operation, title, key, intent, **changes):
        data = self._load()
        token = self._key(operation, title, key)
        self.record(operation, title, key, intent)
        record = data['records'].setdefault(token, dict(intent=deepcopy(intent),
            fingerprint=_fingerprint(intent), attempted=False, attemptedId=None, confirmedId=None))
        if record['confirmedId'] is not None:
            for field in ('attemptedId', 'confirmedId'):
                if changes.get(field) is not None and changes[field] != record['confirmedId']:
                    raise ReconciliationError('Identificador confirmado mudou.')
        record.update(changes)
        self._save(data)

    def bind(self, operation, title, key, intent):
        self._update(operation, title, key, intent)

    def attempt(self, operation, title, key, intent, item_id=None):
        previous = self.record(operation, title, key, intent)
        if previous and (previous['attempted'] or previous['confirmedId'] is not None):
            raise ReconciliationError('Tentativa anterior sem readback exato; repetição bloqueada.')
        self._update(operation, title, key, intent, attempted=True, attemptedId=item_id)

    def observed(self, operation, title, key, intent, item_id):
        self._update(operation, title, key, intent, attemptedId=item_id)

    def confirm(self, operation, title, key, intent, item_id):
        previous = self.record(operation, title, key, intent)
        if previous and previous.get('attemptedId') not in (None, item_id):
            raise ReconciliationError('Readback retornou outro identificador.')
        changes = {'confirmedId': item_id}
        if previous and previous['attempted']:
            changes['attemptedId'] = item_id
        self._update(operation, title, key, intent, **changes)


def _id(row):
    if not isinstance(row, dict):
        raise ReconciliationError('Readback de registro ausente.')
    result = model.positive_id(row.get('Id', row.get('ID')))
    if 'ID' in row and model.positive_id(row['ID']) != result:
        raise ReconciliationError('Identificadores de readback divergem.')
    return result


def _read(transport, title, item_id):
    row = transport.read(title, item_id)
    if _id(row) != item_id:
        raise ReconciliationError('Readback retornou outro ID.')
    return row


def _same(field, actual, expected):
    if actual is None or expected is None:
        return (actual is None and expected is None) or (actual is None and expected == '') or (expected is None and actual == '')
    try:
        if field in _MONEY:
            return model.money_cents(actual) == model.money_cents(expected)
        if field in _IDS:
            # SharePoint Number columns deserialize integral references as 3.0.
            # Normalize only exact integral floats, never fractions/bools/NaN.
            if isinstance(actual, float) and actual.is_integer(): actual = int(actual)
            if isinstance(expected, float) and expected.is_integer(): expected = int(expected)
            return model.positive_id(actual) == model.positive_id(expected)
        if field == 'QTD':
            return not isinstance(actual, bool) and Decimal(str(actual)) == Decimal(str(expected))
        if field in _DATES:
            return model.day(actual) == model.day(expected)
    except (ValueError, InvalidOperation):
        return False
    return actual == expected


def _matches(row, fields):
    return all(field in row and _same(field, row[field], expected) for field, expected in fields.items())


def _verify(row, fields, item_id=None):
    result = _id(row)
    if (item_id is not None and result != item_id) or not _matches(row, fields):
        raise ReconciliationError('Campos/ID existentes divergem da intenção; não sobrescrever.')
    return result


def _blank(value):
    return value is None or (isinstance(value, str) and not value.strip())


def _pending(row, require_status=True):
    if (require_status or not _blank(row.get('STATUS'))) and model.normalized(row.get('STATUS')) not in ('PAGAMENTOPREVISTO', 'PENDENTE'):
        raise ReconciliationError('Origem não está pendente.')
    if not _blank(row.get('PGTOAGENDADO')) and model.normalized(row['PGTOAGENDADO']) != 'PENDENTE':
        raise ReconciliationError('Origem já agendada/processada.')
    for field in ('IDLANCAMENTOS', 'IDLANCAMENTO', 'IDPEDIDO', 'IDPEDIDOS',
                  'DATAPGTOEFETUADO', 'DATAPAGAMENTO', 'DATAPGTO'):
        if not _blank(row.get(field)):
            raise ReconciliationError('Origem possui lançamento, pedido ou pagamento.')


def _find(transport, title, field, value):
    rows = transport.find(title, field, value)
    if not isinstance(rows, list):
        raise ReconciliationError('Find deve retornar lista completa, não página ou envelope.')
    if len({_id(row) for row in rows}) != len(rows):
        raise ReconciliationError('Find retornou identidades duplicadas.')
    return rows


def _unique(transport, title, field, value):
    rows = _find(transport, title, field, value)
    if len(rows) > 1:
        raise ReconciliationError('Chave financeira duplicada.')
    if not rows:
        return None
    row = _read(transport, title, _id(rows[0]))
    if field not in row or not _same(field, row[field], value):
        raise ReconciliationError('Chave de readback diverge da consulta.')
    return row


def _single(rows, message):
    if len(rows) != 1:
        raise ReconciliationError(message)
    return rows[0]


def _find_names(transport, title, field, names):
    # Find using both frozen and current spelling. Identity comparison remains
    # accent/case insensitive even for an adapter with exact string filtering.
    found = {}
    for name in dict.fromkeys(names):
        for row in _find(transport, title, field, name):
            found[_id(row)] = row
    return list(found.values())


def _source_fields(row, planned):
    if model.normalized(row.get('STATUS')) != 'ATIVO' or model.normalized(row.get('EMPREITEIRO')) != 'SIM':
        raise ReconciliationError('Fornecedor/RH deixou de ser empreiteiro ativo.')
    for field, key in [('Title', 'name'), ('FILIAL', 'branch'), ('PROFISSAO', 'profession')]:
        if model.normalized(row.get(field)) != model.normalized(planned[key]):
            raise ReconciliationError('Fornecedor diverge da identidade/filial/profissão congelada.')


def _hr_fields(row, planned):
    if model.normalized(row.get('VINCULO')) != 'CLT':
        raise ReconciliationError('Vínculo CLT atual não confirmado.')
    if model.positive_id(row.get('IDFORNECEDORORIGEM')) != planned['supplierId']:
        raise ReconciliationError('Identidade RH diverge.')
    if model.normalized(row.get('STATUS')) != 'ATIVO' or model.normalized(row.get('EMPREITEIRO')) != 'SIM' or not _blank(row.get('DATADESLIGAMENTO')):
        raise ReconciliationError('RH não está ativo/empreiteiro ou possui desligamento.')
    if model.normalized(row.get('CARGO')) != model.normalized(planned['cargo']) or model.day(row.get('DATAADMISSAO')) != model.day(planned['admission']):
        raise ReconciliationError('Cargo/admissão RH diverge do plano.')
    if row.get('Title') and model.normalized(row['Title']) != model.normalized(planned['name']):
        raise ReconciliationError('Nome RH pertence a outro fornecedor.')


def _sheet_fields(sheet, planned, competence):
    if _id(sheet) != planned['sheetId'] or model.normalized(sheet.get('FORNECEDOR')) != model.normalized(planned['name']) or model.month(sheet.get('MESREFERENCIA')) != competence:
        raise ReconciliationError('Folha não corresponde ao fornecedor/competência exatos.')
    for field in ('IDFORNECEDORORIGEM', 'IDFORNECEDOR'):
        if not _blank(sheet.get(field)) and model.positive_id(sheet[field]) != planned['supplierId']:
            raise ReconciliationError('Folha de fornecedor homônimo/estrangeiro.')


def _sources(plan, snapshot, transport):
    frozen_hr = snapshot['lists']['FUNCIONARIOSRH']['rows']
    frozen_sheets = snapshot['lists']['IDFOLHA']['rows']
    for row in plan['rows']:
        sid = row['supplierId']
        source = _read(transport, 'FORNECEDORES', sid)
        _source_fields(source, row)
        names = _find_names(transport, 'FORNECEDORES', 'Title', [source['Title'], row['name']])
        if _id(_single(names, 'Nome de fornecedor ausente/duplicado.')) != sid:
            raise ReconciliationError('Fornecedor homônimo não corresponde ao ID congelado.')
        hr = _single([r for r in frozen_hr if str(r.get('IDFORNECEDORORIGEM')) == str(sid)], 'RH congelado ausente/duplicado.')
        _hr_fields(hr, row)
        live_hr = _single(_find(transport, 'FUNCIONARIOSRH', 'IDFORNECEDORORIGEM', str(sid)), 'RH atual ausente/duplicado.')
        if ('Id' in hr or 'ID' in hr) and _id(hr) != _id(live_hr):
            raise ReconciliationError('Registro RH foi substituído.')
        _hr_fields(_read(transport, 'FUNCIONARIOSRH', _id(live_hr)), row)
        sheet = _single([s for s in frozen_sheets if model.normalized(s.get('FORNECEDOR')) == model.normalized(row['name'])
                         and model.month(s.get('MESREFERENCIA')) == plan['competence']], 'Folha congelada ausente/duplicada.')
        _sheet_fields(sheet, row, plan['competence'])
        live_sheet = _read(transport, 'IDFOLHA', row['sheetId'])
        _sheet_fields(live_sheet, row, plan['competence'])
        sheets = _find_names(transport, 'IDFOLHA', 'FORNECEDOR', [live_sheet['FORNECEDOR'], sheet['FORNECEDOR'], row['name']])
        sheet = _single([s for s in sheets if model.normalized(s.get('FORNECEDOR')) == model.normalized(row['name'])
                         and model.month(s.get('MESREFERENCIA')) == plan['competence']], 'Folha atual ausente/duplicada.')
        _sheet_fields(_read(transport, 'IDFOLHA', _id(sheet)), row, plan['competence'])


def _pdf_intent(pdf, item_id):
    return dict(id=item_id, name=pdf['name'], sha256=hashlib.sha256(pdf['bytes']).hexdigest())


def _has_pdf(transport, title, item_id, pdf):
    metadata = transport.attachments(title, item_id)
    if not isinstance(metadata, list) or any(not isinstance(a.get('FileName'), str) for a in metadata):
        raise ReconciliationError('Metadados de anexos incompletos.')
    matches = [a['FileName'] for a in metadata if a['FileName'].casefold() == pdf['name'].casefold()]
    if not matches:
        return False
    if matches != [pdf['name']] or transport.attachment_bytes(title, item_id, matches[0]) != pdf['bytes']:
        raise ReconciliationError('PDF com mesmo nome possui metadados/bytes divergentes.')
    return True


def _attachment_preflight(transport, journal, title, item_id, pdf):
    intent = _pdf_intent(pdf, item_id)
    key = f'{item_id}:{pdf["name"]}'
    record = journal.record('attachment', title, key, intent)
    present = _has_pdf(transport, title, item_id, pdf)
    if not present and record and (record['attempted'] or record['confirmedId'] is not None):
        raise ReconciliationError('Anexo de tentativa anterior não está visível; não reenviar.')
    return present


def _attach(transport, journal, title, item_id, pdf):
    intent = _pdf_intent(pdf, item_id)
    key = f'{item_id}:{pdf["name"]}'
    if not _attachment_preflight(transport, journal, title, item_id, pdf):
        journal.attempt('attachment', title, key, intent, item_id)
        try:
            transport.add_attachment(title, item_id, pdf['name'], pdf['bytes'])
        except Exception as error:
            if not _has_pdf(transport, title, item_id, pdf):
                raise ReconciliationError('Upload incerto sem PDF confirmado; não reenviar.') from error
        if not _has_pdf(transport, title, item_id, pdf):
            raise ReconciliationError('Anexo ausente após upload.')
    journal.confirm('attachment', title, key, intent, item_id)


def _origin(transport, journal, snapshot, title, item_id, fields):
    original = _single([r for r in snapshot['specified_origins'][title] if _id(r) == item_id], 'Origem congelada ausente/duplicada.')
    # The specifically audited legacy parents were created without STATUS.
    # This exception cannot be used by a new/owned row or skip payment guards;
    # the unchanged audited ETag below still authorizes the only possible CAS.
    legacy_parent = (title == PARENTS and _blank(original.get('STATUS'))
                     and _blank(original.get('FOLHAOPERACAO')))
    _pending(original, require_status=not legacy_parent)
    etag = original.get('audit_etag')
    if not isinstance(etag, str) or not etag.strip():
        raise ReconciliationError('ETag da auditoria ausente.')
    current = _read(transport, title, item_id)
    _pending(current, require_status=not legacy_parent)
    keyed = _unique(transport, title, 'FOLHAOPERACAO', fields['FOLHAOPERACAO'])
    if keyed is not None and _id(keyed) != item_id:
        raise ReconciliationError('Chave da origem aponta para outro ID.')
    intent = dict(id=item_id, fields=fields, etag=etag)
    record = journal.record('patch', title, fields['FOLHAOPERACAO'], intent)
    if _matches(current, fields):
        if record and record['confirmedId'] not in (None, item_id):
            raise ReconciliationError('ID original confirmado diverge.')
        return current
    if (current.get('audit_etag') != etag or (record and (record['attempted'] or record['confirmedId'] is not None))
            or str(current.get('FOLHAOPERACAO', '')).startswith('ENCARGOS:')):
        raise ReconciliationError('ETag/linha já apropriada diverge; não sobrescrever.')
    if not _blank(current.get('IDFOLHA')):
        raise ReconciliationError('Origem já possui vínculo de folha; não substituir.')
    if title == PROVISIONS and not _same('DESCRITIVOPROVISAO', current.get('DESCRITIVOPROVISAO'), fields['DESCRITIVOPROVISAO']):
        raise ReconciliationError('Mapeamento descritivo/provisão diverge.')
    return current


def _patch_origin(transport, journal, snapshot, title, item_id, fields):
    current = _origin(transport, journal, snapshot, title, item_id, fields)
    original = next(r for r in snapshot['specified_origins'][title] if _id(r) == item_id)
    intent = dict(id=item_id, fields=fields, etag=original['audit_etag'])
    key = fields['FOLHAOPERACAO']
    if not _matches(current, fields):
        journal.attempt('patch', title, key, intent, item_id)
        try:
            response = transport.patch(title, item_id, fields, original['audit_etag'])
        except Exception as error:
            current = _read(transport, title, item_id)
            if not _matches(current, fields):
                raise ReconciliationError('PATCH incerto ou CAS recusado; não repetir.') from error
        else:
            if _id(response) != item_id:
                raise ReconciliationError('Resposta PATCH retornou ID diferente.')
        current = _read(transport, title, item_id)
    _verify(current, fields, item_id)
    _pending(current)
    journal.confirm('patch', title, key, intent, item_id)
    return item_id


def _created_preflight(transport, journal, title, field, key, fields):
    intent = dict(field=field, key=key, fields=fields)
    record = journal.record('create', title, key, intent)
    row = _unique(transport, title, field, key)
    if row is None:
        if record and (record['attempted'] or record['confirmedId'] is not None):
            raise ReconciliationError('POST anterior sem resultado visível; não repetir.')
        return None
    item_id = _verify(row, fields)
    _pending(row, require_status=title != PAYROLL)
    if record and (record['confirmedId'] not in (None, item_id) or record['attemptedId'] not in (None, item_id)):
        raise ReconciliationError('Chave passou a apontar para outro ID.')
    return row


def _create(transport, journal, title, field, key, fields):
    intent = dict(field=field, key=key, fields=fields)
    row = _created_preflight(transport, journal, title, field, key, fields)
    if row is None:
        journal.attempt('create', title, key, intent)
        try:
            response = transport.create(title, fields)
        except Exception as error:
            row = _unique(transport, title, field, key)
            if row is None:
                raise ReconciliationError('POST incerto sem resultado visível; não repetir.') from error
        else:
            response_id = _id(response)
            journal.observed('create', title, key, intent, response_id)
            row = _unique(transport, title, field, key)
            if row is None or _id(row) != response_id:
                raise ReconciliationError('ID/chave após POST não confirmado.')
    item_id = _verify(row, fields)
    _pending(row, require_status=title != PAYROLL)
    journal.confirm('create', title, key, intent, item_id)
    return item_id


def _payroll_preflight(transport, journal, plan, row, tax, provision_id):
    if provision_id is not None:
        fields = model.payroll_fields(plan, row, tax, provision_id)
        _created_preflight(transport, journal, PAYROLL, 'IDPROVISAO', provision_id, fields)
    for payroll in _find(transport, PAYROLL, 'IDFOLHA', str(row['sheetId'])):
        if model.normalized(payroll.get('TIPOPGTO')) != tax:
            continue
        if (provision_id is None or not _same('IDPROVISAO', payroll.get('IDPROVISAO'), provision_id)
                or model.normalized(payroll.get('FORNECEDOR')) != model.normalized(row['name'])):
            raise ReconciliationError('Rubrica já vinculada a outra provisão/fornecedor.')


def _parent_children(transport, parent_id, expected_ids):
    children = _find(transport, PROVISIONS, 'DESCRITIVOPROVISAO', str(parent_id))
    if {_id(row) for row in children} != set(expected_ids):
        raise ReconciliationError('Descritivo possui filhos ausentes ou estranhos ao lote.')
    for child in children:
        if not _same('DESCRITIVOPROVISAO', child.get('DESCRITIVOPROVISAO'), parent_id):
            raise ReconciliationError('Filho aponta para outro descritivo.')


def _validate_inputs(plan, pdfs):
    if not isinstance(plan, dict) or not isinstance(plan.get('rows'), list) or not plan['rows']:
        raise ReconciliationError('Lote vazio.')
    if not {'competence', 'createdDate', 'dueDate', 'totals', 'initialTargets'} <= plan.keys():
        raise ReconciliationError('Plano incompleto.')
    required = {'supplierId', 'sheetId', 'name', 'branch', 'profession', 'cargo',
                'admission', 'inssCents', 'fgtsCents'}
    if any(not isinstance(row, dict) or not required <= row.keys() for row in plan['rows']):
        raise ReconciliationError('Linha individual vazia/incompleta.')
    if (not isinstance(plan['initialTargets'], dict) or not isinstance(plan['totals'], dict)
            or any(tax not in plan['totals'] or not isinstance(plan['initialTargets'].get(tax), dict)
                   or not {'parentId', 'reusedProvisionId'} <= plan['initialTargets'][tax].keys() for tax in TAXES)
            or not isinstance(pdfs, dict) or any(not isinstance(pdfs.get(tax), dict) for tax in TAXES)):
        raise ReconciliationError('Alvos, totais ou PDFs incompletos.')
    if model.month(plan['competence']) != plan['competence']:
        raise ReconciliationError('Competência do plano inválida.')
    model.day(plan['createdDate'])
    model.day(plan['dueDate'])
    for field in ('supplierId', 'sheetId'):
        ids = [model.positive_id(row[field]) for row in plan['rows']]
        if len(set(ids)) != len(ids):
            raise ReconciliationError('Fornecedor/folha duplicado no plano.')
    names = [model.normalized(row['name']) for row in plan['rows']]
    if not all(names) or len(set(names)) != len(names):
        raise ReconciliationError('Nomes ausentes/duplicados no plano.')
    for field in ('parentId', 'reusedProvisionId'):
        ids = [model.positive_id(plan['initialTargets'][tax][field]) for tax in TAXES]
        if len(set(ids)) != len(ids):
            raise ReconciliationError('Mesmo alvo utilizado em dois impostos.')
    for tax, amount_field in [('INSS', 'inssCents'), ('FGTS', 'fgtsCents')]:
        amounts = [row[amount_field] for row in plan['rows']]
        if any(type(amount) is not int or amount < 0 for amount in amounts) or type(plan['totals'][tax]) is not int or sum(amounts) != plan['totals'][tax]:
            raise ReconciliationError('Totais individuais divergem do plano.')
        pdf = pdfs[tax]
        name = pdf.get('name')
        if (not isinstance(name, str) or not 1 <= len(name) <= 180 or name != name.strip()
                or not name.lower().endswith('.pdf') or name.startswith('.')
                or re.search(r'[<>:"/\\|?*\x00-\x1f\x7f]', name)
                or re.fullmatch(r'(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])', name.split('.')[0].upper())):
            raise ReconciliationError('Nome de PDF inseguro.')
        if not isinstance(pdf.get('bytes'), bytes) or not pdf['bytes'].startswith(b'%PDF-'):
            raise ReconciliationError('Bytes não são PDF.')


def _external_provisions(plan, transport):
    """An unlinked existing tax obligation is still an obligation, not absence."""
    for planned in plan['rows']:
        for candidate in _find(transport, PROVISIONS, 'IDFOLHA', planned['sheetId']):
            current = _read(transport, PROVISIONS, _id(candidate))
            if not _same('IDFOLHA', current.get('IDFOLHA'), planned['sheetId']):
                raise ReconciliationError('Consulta externa de folha diverge do readback.')
            for tax in TAXES:
                matches_type = any(model.normalized(current.get(field)) == tax
                                   for field in ('TIPOPGTO', 'PRODUTO'))
                matches_type = matches_type or bool(re.search(
                    r'(?<![A-Z0-9])' + tax + r'(?![A-Z0-9])', str(current.get('OBS') or '').upper()))
                own_key = f'ENCARGOS:{plan["competence"]}:{tax}:{planned["supplierId"]}'
                if matches_type and current.get('FOLHAOPERACAO') != own_key:
                    raise ReconciliationError('Já existe provisão externa desse encargo/IDFOLHA; não duplicar.')


def reconcile_initial(plan, snapshot, transport, journal, pdfs):
    """Revalidate the frozen batch, replace originals with CAS and verify all IDs.

    Receipt: ``{competence, parents: {tax: id}, rows: [{tax, supplierId,
    sheetId, parentId, provisionId, payrollId}], attachments: [{list, id,
    name, sha256}]}``. There is no success receipt on partial/uncertain work.
    The same frozen inputs and durable journal must be supplied on resumption.
    """
    plan, snapshot, pdfs = deepcopy(plan), deepcopy(snapshot), deepcopy(pdfs)
    _validate_inputs(plan, pdfs)
    journal.bind('plan', 'monthly-payroll-taxes', plan['competence'],
                 dict(plan=plan, snapshot=snapshot, pdfs={tax: _pdf_intent(pdfs[tax], None) for tax in TAXES}))
    _sources(plan, snapshot, transport)
    _external_provisions(plan, transport)
    # Complete BOTH taxes' source/origin/ownership/PDF checks before any write.
    for tax in TAXES:
        target = plan['initialTargets'][tax]
        pid, cid = target['parentId'], target['reusedProvisionId']
        parent = model.parent_fields(plan, tax)
        _origin(transport, journal, snapshot, PARENTS, pid, parent)
        known_children = []
        for index, row in enumerate(plan['rows']):
            fields = model.provision_fields(plan, row, tax, pid)
            if index == 0:
                child = _origin(transport, journal, snapshot, PROVISIONS, cid, fields)
                original = _single([r for r in snapshot['specified_origins'][PROVISIONS] if _id(r) == cid], 'Origem ausente.')
                if not _same('DESCRITIVOPROVISAO', original.get('DESCRITIVOPROVISAO'), str(pid)):
                    raise ReconciliationError('Mapeamento congelado descritivo/provisão diverge.')
            else:
                child = _created_preflight(transport, journal, PROVISIONS, 'FOLHAOPERACAO', fields['FOLHAOPERACAO'], fields)
            child_id = _id(child) if child is not None else None
            _payroll_preflight(transport, journal, plan, row, tax, child_id)
            if child_id is not None:
                known_children.append(child_id)
                _attachment_preflight(transport, journal, PROVISIONS, child_id, pdfs[tax])
        _parent_children(transport, pid, known_children)
        _attachment_preflight(transport, journal, PARENTS, pid, pdfs[tax])

    receipt = dict(competence=plan['competence'], parents={}, rows=[], attachments=[])
    for tax in TAXES:
        target = plan['initialTargets'][tax]
        pid = _patch_origin(transport, journal, snapshot, PARENTS, target['parentId'], model.parent_fields(plan, tax))
        receipt['parents'][tax] = pid
        for index, row in enumerate(plan['rows']):
            fields = model.provision_fields(plan, row, tax, pid)
            if index == 0:
                cid = _patch_origin(transport, journal, snapshot, PROVISIONS, target['reusedProvisionId'], fields)
            else:
                cid = _create(transport, journal, PROVISIONS, 'FOLHAOPERACAO', fields['FOLHAOPERACAO'], fields)
            _payroll_preflight(transport, journal, plan, row, tax, cid)
            payroll_id = _create(transport, journal, PAYROLL, 'IDPROVISAO', cid, model.payroll_fields(plan, row, tax, cid))
            _attach(transport, journal, PROVISIONS, cid, pdfs[tax])
            receipt['rows'].append(dict(tax=tax, supplierId=row['supplierId'], sheetId=row['sheetId'],
                                       parentId=pid, provisionId=cid, payrollId=payroll_id))
        _attach(transport, journal, PARENTS, pid, pdfs[tax])

    # Do not return cached journal IDs: recheck the actual remote graph and bytes.
    planned = {row['supplierId']: row for row in plan['rows']}
    for tax, pid in receipt['parents'].items():
        parent = _read(transport, PARENTS, pid)
        _verify(parent, model.parent_fields(plan, tax), pid)
        _pending(parent)
        _parent_children(transport, pid, [r['provisionId'] for r in receipt['rows'] if r['tax'] == tax])
    for entry in receipt['rows']:
        tax, cid = entry['tax'], entry['provisionId']
        row = planned[entry['supplierId']]
        child = _read(transport, PROVISIONS, cid)
        _verify(child, model.provision_fields(plan, row, tax, entry['parentId']), cid)
        _pending(child)
        _payroll_preflight(transport, journal, plan, row, tax, cid)
        payroll = _read(transport, PAYROLL, entry['payrollId'])
        _verify(payroll, model.payroll_fields(plan, row, tax, cid), entry['payrollId'])
    for tax in TAXES:
        targets = [(PARENTS, receipt['parents'][tax])] + [(PROVISIONS, r['provisionId']) for r in receipt['rows'] if r['tax'] == tax]
        for title, item_id in targets:
            if not _has_pdf(transport, title, item_id, pdfs[tax]):
                raise ReconciliationError('PDF final ausente.')
            receipt['attachments'].append(dict(list=title, **_pdf_intent(pdfs[tax], item_id)))
    return receipt
