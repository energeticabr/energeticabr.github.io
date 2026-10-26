"""Pure RH benefit intents; no authentication or remote writes."""
from datetime import date, timedelta
import re
import unicodedata

LABEL = 'VALE ALIMENTAÇÃO'
PARENT = 'DESCRITIVOPROVISAO'
CHILD = 'PROVISÃO PGTOS'
RH = 'FUNCIONARIOSRH'
LEGACY = 'DESPESASRECORRENTES'
PREFIX = 'SWILE-RH:'
PREPARING = '|PREPARANDO'


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value or '').strip()).upper()
                   if c.isascii() and c.isalnum())


def identity(value):
    if isinstance(value, bool) or not re.fullmatch(r'[1-9][0-9]*', str(value).strip()):
        raise ValueError('Identidade de origem ausente ou inválida')
    return int(str(value).strip())


def blank(value):
    return value is None or normalized(value) in {'', '0', 'EMBRANCO'}


def unpaid(row, allow_blank_status=False):
    statuses = {'PENDENTE', 'PAGAMENTOPREVISTO'} | ({''} if allow_blank_status else set())
    return (normalized(row.get('STATUS')) in statuses
            and normalized(row.get('PGTOAGENDADO')) in {'', '0', 'PENDENTE', 'EMBRANCO'}
            and all(blank(row.get(k)) for k in ['DATAPGTOEFETUADO', 'DATAPGTOAGENDADO',
                                                'DATAEXECUCAOAGENDAMENTO', 'IDLANCAMENTOS', 'IDPEDIDO']))


def plan_horizon(rh_rows, reference_date, excluded_supplier_ids):
    if type(reference_date) is not date:
        raise ValueError('Informe uma data local, sem horário')
    excluded = {identity(x) for x in excluded_supplier_ids}
    rows, ids, names = [], set(), set()
    for source in rh_rows:
        sid = identity(source.get('IDFORNECEDORORIGEM'))
        if sid in excluded:
            continue
        rid = identity(source.get('Id', source.get('id')))
        name = str(source.get('Title') or '').strip()
        branch = str(source.get('FILIAL') or '').strip()
        prop = str(source.get('IMOVEL') or 'TODOS').strip() or 'TODOS'
        if not name or not branch or sid in ids or normalized(name) in names:
            raise ValueError('Nome, filial ou vínculo RH ausente/duplicado')
        ids.add(sid)
        names.add(normalized(name))
        rows.append({'rhId': rid, 'supplierId': sid, 'name': name, 'branch': branch, 'property': prop})
    if not rows:
        return []
    rows.sort(key=lambda x: x['supplierId'])
    first = reference_date + timedelta(days=(2 - reference_date.weekday()) % 7)
    return [{'key': PREFIX + due.isoformat(), 'dueDate': due.isoformat(),
             'createdDate': reference_date.isoformat(), 'rows': rows, 'total': len(rows) * 225}
            for due in (first + timedelta(days=x) for x in (0, 7, 14))
            if due <= reference_date + timedelta(days=14)]


def parent_payload(plan):
    branches = {r['branch'] for r in plan['rows']}
    return {'Title': plan['key'] + PREPARING, 'FOLHAOPERACAO': plan['key'],
            'FORNECEDOR': 'SWILE', 'FILIAL': next(iter(branches)) if len(branches) == 1 else 'DIVERSAS',
            'VALORTOTAL': '0', 'OBS': LABEL, 'FORMAPGTO': '', 'STATUS': 'PAGAMENTO PREVISTO',
            'DATAPREVISTOPGTO': plan['dueDate'] + 'T12:00:00Z'}


def child_payload(plan, row, parent_id):
    key = plan['key'] + ':' + str(row['supplierId'])
    return {'Title': key, 'FOLHAOPERACAO': key, 'DESCRITIVOPROVISAO': str(identity(parent_id)),
            'FORNECEDOR': row['name'], 'FILIAL': row['branch'], 'IMOVEL': row['property'],
            'PRODUTO': LABEL, 'OBS': LABEL, 'FORMAPGTO': '', 'QTD': '5', 'VALORTOTAL': '45', 'FRETE': '0',
            'STATUS': 'PAGAMENTO PREVISTO', 'PGTOAGENDADO': 'PENDENTE',
            'DATA': plan['createdDate'] + 'T12:00:00Z',
            'DATAPREVISTOPGTO': plan['dueDate'] + 'T12:00:00Z'}


def legacy_targets(rows, parents, recurrence_id):
    wanted = str(identity(recurrence_id))
    candidates = [r for r in rows if str(r.get('IDRECORRENCIA', '')).strip() == wanted and unpaid(r)]
    ids = {identity(r.get('Id', r.get('id'))) for r in candidates}
    parent_ids = {str(r.get('DESCRITIVOPROVISAO', '')).strip() for r in candidates}
    empty = []
    for p in parents:
        pid = identity(p.get('Id', p.get('id')))
        linked = [r for r in rows if str(r.get('DESCRITIVOPROVISAO', '')).strip() == str(pid)]
        if (str(pid) in parent_ids and linked and not p.get('Attachments')
                and all(identity(r.get('Id', r.get('id'))) in ids for r in linked)
                and unpaid(p, allow_blank_status=True)):
            empty.append(pid)
    return {'provisionIds': sorted(ids), 'parentIds': sorted(empty)}
