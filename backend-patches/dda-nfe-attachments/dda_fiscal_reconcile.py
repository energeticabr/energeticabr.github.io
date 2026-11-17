"""Conservative DDA/invoice matching, independent of collection order."""
import hashlib
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    BRAZIL = ZoneInfo('America/Sao_Paulo')
except ZoneInfoNotFoundError:
    BRAZIL = timezone(timedelta(hours=-3))


def cents(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount <= 0 or amount * 100 != (amount * 100).to_integral_value():
            raise ValueError('INVALID_AMOUNT')
        return int(amount * 100)
    except (InvalidOperation, TypeError):
        raise ValueError('INVALID_AMOUNT') from None


def tax_id(value):
    text = re.sub(r'[./\s-]', '', str(value or ''))
    if not re.fullmatch(r'\d{11}|\d{14}', text):
        raise ValueError('INVALID_TAX_ID')
    return text


def supplier(value):
    text = tax_id(value)
    return 'CNPJ:' + text[:8] if len(text) == 14 else 'CPF:' + text


def day(value):
    text = str(value or '')
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', text):
        return datetime.strptime(text, '%Y-%m-%d').date().isoformat()
    parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('MISSING_TIMEZONE')
    return parsed.astimezone(BRAZIL).date().isoformat()


def group_key(row, fiscal=False):
    return (supplier(row.get('CNPJ_FORNECEDOR')),
            tax_id(row.get('CNPJ_DESTINATARIO') if fiscal else row.get('CNPJ_PAGADOR')),
            day(row.get('DATA_EMISSAO') if fiscal else row.get('EMISSAO')))


def invoice_amount(row):
    # Respect retentions: a net amount takes precedence over the gross total.
    for field in ('VALOR_LIQUIDO', 'VALOR_LIQUIDO_FATURA', 'VALOR_TOTAL_NOTA', 'VALOR_SERVICOS'):
        if row.get(field) is not None:
            return cents(row[field])
    raise ValueError('MISSING_INVOICE_AMOUNT')


def matching_subsets(rows, target):
    found = []
    def visit(index, total, ids):
        if len(found) >= 2:
            return
        if total == target:
            found.append(tuple(ids))
            return
        if total > target or index == len(rows):
            return
        row, amount = rows[index]
        visit(index + 1, total + amount, ids + [row['Id']])
        visit(index + 1, total, ids)
    visit(0, 0, [])
    return found


def build_plan(bills, notes):
    groups = defaultdict(list)
    blocked = set()
    blocked_pairs = set()
    keys = Counter(str(r.get('CHAVE_DDA') or '') for r in bills)
    issues = []
    for row in bills:
        group = None
        states = {str(row.get(k) or '').strip().casefold() for k in ('SITUACAO','STATUS_DDA')}
        eligible_states = {'em aberto','agendado','liquidado','pago (liquidado)','pago'}
        if states - {''} and (states - {''}).issubset({'baixado','cancelado','cancelada','retirado'}):
            continue
        try:
            group = group_key(row)
            identity = str(row.get('CHAVE_DDA') or '')
            if not re.fullmatch(r'[0-9a-f]{64}', identity) or keys[identity] != 1:
                blocked.add(group)
                continue
            if not states.intersection(eligible_states) or any(s and s not in eligible_states for s in states):
                blocked.add(group)
                continue
            groups[group].append((row, cents(row.get('VALOR'))))
        except (ValueError, TypeError):
            if group is not None:
                blocked.add(group)
            else:
                try: blocked_pairs.add((supplier(row.get('CNPJ_FORNECEDOR')),tax_id(row.get('CNPJ_PAGADOR'))))
                except ValueError: pass
            issues.append({'dda_id': row.get('Id'), 'status': 'missing_or_invalid_data'})
    proposals = []
    for row in notes:
        if row.get('SITUACAO') != 'AUTORIZADA' or row.get('STATUS_IMPORTACAO') != 'XML_COMPLETO':
            continue
        group = None
        try:
            group = group_key(row, fiscal=True)
            members = groups.get(group, [])
            if group in blocked or group[:2] in blocked_pairs or len(members) > 20:
                issues.append({'fiscal_id':row['Id'],'status':'blocked_group'})
                continue
            target = invoice_amount(row)
            matches = matching_subsets(sorted(members, key=lambda x:x[0]['Id']), target)
            if len(matches) != 1:
                issues.append({'fiscal_id':row['Id'],'status':'ambiguous' if matches else 'unmatched'})
                # All possible members of an ambiguous note must block another
                # invoice claiming one of those same bills.
                if matches:
                    blocked.add(group)
                continue
            proposals.append({'fiscal_id': row['Id'], 'dda_ids':list(matches[0]),
                              'amount_cents':target,'group':group,
                              'pdf_ready':row.get('STATUS_DANFE') == 'DISPONIVEL'})
        except (ValueError, TypeError):
            if group is not None:
                blocked.add(group)
            else:
                try: blocked_pairs.add((supplier(row.get('CNPJ_FORNECEDOR')),tax_id(row.get('CNPJ_DESTINATARIO'))))
                except ValueError: pass
            issues.append({'fiscal_id':row.get('Id'),'status':'missing_or_invalid_data'})
    usage = Counter(i for p in proposals for i in p['dda_ids'])
    links = []
    for proposal in proposals:
        if proposal['group'] in blocked or proposal['group'][:2] in blocked_pairs or any(usage[i] != 1 for i in proposal['dda_ids']):
            issues.append({'fiscal_id':proposal['fiscal_id'],'status':'overlapping_or_ambiguous'})
        elif not proposal['pdf_ready']:
            issues.append({'fiscal_id':proposal['fiscal_id'],'status':'pdf_pending'})
        else:
            links.append({k:v for k,v in proposal.items() if k not in ('group','pdf_ready')})
    return {'links': links, 'issues': issues}


def validate_pdf(content):
    if not isinstance(content, bytes) or not 100 < len(content) <= 20_000_000 or not content.startswith(b'%PDF-') or b'%%EOF' not in content[-1024:]:
        raise ValueError('INVALID_PDF')


def ensure_pdf(store, item_id, filename, content):
    validate_pdf(content)
    if not re.fullmatch(r'[A-Za-z0-9_.-]+\.pdf', filename, re.IGNORECASE):
        raise ValueError('INVALID_FILENAME')
    filename = 'FISCAL-' + filename
    existing = store.attachments(item_id)
    names = [r['FileName'] for r in existing]
    fiscal_names = [n for n in names if re.match(r'^(fiscal-|danfe[-_]|danfse[-_]|dacte[-_])', n, re.IGNORECASE)]
    if len(fiscal_names) > 1:
        raise ValueError('DUPLICATE_FISCAL_ATTACHMENT')
    if fiscal_names and fiscal_names[0].casefold() != filename.casefold():
        if store.read_pdf(item_id,fiscal_names[0]) != content:
            raise ValueError('CONFLICTING_FISCAL_ATTACHMENT')
        return {'dda_id':item_id,'status':'already_linked','filename':fiscal_names[0],
                'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content)}
    same = [n for n in names if n.casefold() == filename.casefold()]
    if len(same) > 1:
        raise ValueError('DUPLICATE_FISCAL_ATTACHMENT')
    status = 'already_linked' if same else 'linked'
    if not same:
        store.add_pdf(item_id, filename, content)
    actual_name = same[0] if same else filename
    if store.read_pdf(item_id, actual_name) != content:
        raise ValueError('PDF_READBACK_MISMATCH')
    return {'dda_id':item_id,'status':status,'filename':actual_name,
            'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content)}
