"""Bounded, offline fiscal XML validation shared by PDF and notification ingress.

This validates XML structure/identity and authorization data, not XMLDSIG or
tax law. It reads no certificate, URL, mutable supplied fields or filesystem.
"""
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import hashlib
import re

from defusedxml import ElementTree as ET

COMPANY = '38626750000146'
KEY44 = r'[0-9]{6}[A-Z0-9]{12}[0-9]{26}'
KEY_PATTERN = rf'(?:{KEY44}|[0-9]{{50}})'
MAX_XML = 1_125_000


@dataclass(frozen=True)
class FiscalDocument:
    raw: bytes
    xml: str
    root: object
    invoice: object
    key: str
    digest: str
    kind: str
    fiscal_type: str
    model: str
    prefix: str
    environment: str
    supplier: str
    issued_at: str
    amount: Decimal
    net: Decimal | None


def child(node, path):
    """Direct namespace-aware child lookup. Never match an injected descendant."""
    if node is None:
        return None
    namespace = node.tag.partition('}')[0] + '}' if node.tag.startswith('{') else ''
    return node.find('/'.join(namespace + part for part in path.split('/')))


def text(node, path):
    found = child(node, path)
    return found.text if found is not None and found.text is not None else None


def single(node, path):
    namespace = node.tag.partition('}')[0] + '}' if node.tag.startswith('{') else ''
    matches = node.findall('/'.join(namespace + part for part in path.split('/')))
    if len(matches) != 1:
        raise ValueError('DANFE_COMPLETE_XML_REQUIRED')
    return matches[0]


def money(value):
    try:
        if not isinstance(value, str) or not re.fullmatch(r'\d{1,13}(?:\.\d{1,2})?', value):
            raise ValueError()
        result = Decimal(value)
        if not result.is_finite() or result < 0:
            raise ValueError()
        return result
    except (ValueError, InvalidOperation):
        raise ValueError('INVALID_AMOUNT') from None


def issue_day(value):
    try:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', value or ''):
            return date.fromisoformat(value)
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})', value or ''):
            raise ValueError()
        return datetime.fromisoformat(value.replace('Z', '+00:00')).date()
    except ValueError:
        raise ValueError('INVALID_ISSUE_DATE') from None


def parse_fiscal_xml(raw, key, company_cnpj=COMPANY, required_environment=None):
    if (not isinstance(raw, bytes) or not raw or len(raw) > MAX_XML
            or not isinstance(key, str) or not re.fullmatch(KEY_PATTERN, key)
            or company_cnpj != COMPANY):
        raise ValueError('DANFE_INPUT_INVALID')
    try:
        xml = raw.decode('utf-8', errors='strict')
        root = ET.fromstring(raw, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except Exception:
        raise ValueError('INVALID_XML') from None
    nfe_ns = 'http://www.portalfiscal.inf.br/nfe'
    cte_ns = 'http://www.portalfiscal.inf.br/cte'
    nfse_ns = 'http://www.sped.fazenda.gov.br/nfse'
    digest = hashlib.sha256(raw).hexdigest()
    parties = []
    net = None
    if root.tag == '{'+nfe_ns+'}nfeProc':
        kind, fiscal_type, model, prefix = 'nfeProc', 'NF-e', '55', 'DANFE'
        invoice = single(root, 'NFe/infNFe')
        protocol = single(root, 'protNFe/infProt')
        environment = text(invoice, 'ide/tpAmb')
        if (invoice.get('Id') != 'NFe'+key or text(protocol, 'chNFe') != key
                or text(invoice, 'ide/mod') != '55' or key[20:22] != '55'
                or text(protocol, 'cStat') not in ('100', '150')
                or environment != text(protocol, 'tpAmb')):
            raise ValueError('INVALID_AUTHORIZATION')
        if not invoice.findall('{'+nfe_ns+'}det'):
            raise ValueError('DANFE_COMPLETE_XML_REQUIRED')
        parties = [text(invoice, p) for p in ['emit/CNPJ', 'dest/CNPJ', 'transp/transporta/CNPJ']]
        parties.extend(n.text for n in invoice.findall('{'+nfe_ns+'}autXML/{'+nfe_ns+'}CNPJ'))
        supplier = text(invoice, 'emit/xNome')
        timestamp = text(invoice, 'ide/dhEmi')
        if timestamp and 'T' not in timestamp:
            raise ValueError('INVALID_ISSUE_DATE')
        issued = timestamp or text(invoice, 'ide/dEmi')
        amount = money(text(invoice, 'total/ICMSTot/vNF'))
        net_text = text(invoice, 'cobr/fat/vLiq')
        net = money(net_text) if net_text is not None else None
    elif root.tag in {'{'+cte_ns+'}'+k for k in ('cteProc', 'cteOSProc', 'cteSimpProc')}:
        kind = root.tag.split('}')[1]
        model = '67' if kind == 'cteOSProc' else '57'
        fiscal_type, prefix = ('CT-e OS' if model == '67' else 'CT-e'), 'DACTE'
        element = {'cteProc': 'CTe', 'cteOSProc': 'CTeOS', 'cteSimpProc': 'CTeSimp'}[kind]
        invoice = single(root, element+'/infCte')
        protocol = single(root, 'protCTe/infProt')
        environment = text(invoice, 'ide/tpAmb')
        if (invoice.get('Id') != 'CTe'+key or text(protocol, 'chCTe') != key
                or len(key) != 44 or key[20:22] != model or text(invoice, 'ide/mod') != model
                or text(protocol, 'cStat') != '100' or environment != text(protocol, 'tpAmb')):
            raise ValueError('INVALID_AUTHORIZATION')
        for path in ['emit/CNPJ', 'rem/CNPJ', 'exped/CNPJ', 'receb/CNPJ', 'dest/CNPJ', 'toma/CNPJ', 'ide/toma4/CNPJ']:
            parties.append(text(invoice, path))
        parties.extend(n.text for n in invoice.findall('{'+cte_ns+'}autXML/{'+cte_ns+'}CNPJ'))
        supplier = text(invoice, 'emit/xNome')
        issued = text(invoice, 'ide/dhEmi')
        if kind == 'cteSimpProc':
            if not invoice.findall('{'+cte_ns+'}det'):
                raise ValueError('DANFE_COMPLETE_XML_REQUIRED')
            amount, net = money(text(invoice, 'total/vTPrest')), money(text(invoice, 'total/vTRec'))
        else:
            amount, net = money(text(invoice, 'vPrest/vTPrest')), money(text(invoice, 'vPrest/vRec'))
    elif root.tag == '{'+nfse_ns+'}NFSe':
        kind, fiscal_type, model, prefix = 'NFSe', 'NFS-e', 'NFS-e', 'DANFSe'
        invoice = single(root, 'infNFSe')
        dps = single(invoice, 'DPS/infDPS')
        environment = text(dps, 'tpAmb')
        if (len(key) != 50 or invoice.get('Id') != 'NFS'+key
                or text(invoice, 'cStat') not in ('100', '102', '103', '107')):
            raise ValueError('INVALID_AUTHORIZATION')
        parties = [text(dps, p) for p in ['prest/CNPJ', 'toma/CNPJ', 'interm/CNPJ']]
        provider_id = text(dps, 'prest/CNPJ') or text(dps, 'prest/CPF') or text(dps, 'prest/NIF')
        supplier = text(dps, 'prest/xNome')
        if not supplier and provider_id == (text(invoice, 'emit/CNPJ') or text(invoice, 'emit/CPF')):
            supplier = text(invoice, 'emit/xNome')
        supplier = supplier or ('Prestador '+provider_id if provider_id else None)
        issued = text(invoice, 'dhProc')
        amount, net = money(text(dps, 'valores/vServPrest/vServ')), money(text(invoice, 'valores/vLiq'))
    else:
        raise ValueError('DANFE_COMPLETE_XML_REQUIRED')
    if environment not in ('1', '2') or (required_environment is not None and environment != required_environment):
        raise ValueError('INVALID_AUTHORIZATION')
    if company_cnpj not in parties:
        raise ValueError('DANFE_COMPANY_MISMATCH')
    if not supplier or not supplier.strip() or len(supplier) > 1000:
        raise ValueError('INVALID_COMPANY')
    issue_day(issued)
    if kind != 'nfeProc' and 'T' not in issued:
        raise ValueError('INVALID_ISSUE_DATE')
    return FiscalDocument(raw, xml, root, invoice, key, digest, kind, fiscal_type,
                          model, prefix, environment, supplier, issued, amount, net)
