"""Render standard auxiliary NF-e and CT-e documents from authorized XML.

CLI protocol: bounded UTF-8 JSON on stdin; JSON result on stdout. No files,
external URLs, certificate access or document content in diagnostic messages.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import sys
import unicodedata
from decimal import Decimal

from brazilfiscalreport.danfe import Danfe
from brazilfiscalreport.dacte import Dacte
from fiscal_document import COMPANY, KEY_PATTERN, child, parse_fiscal_xml, text

NS = {'n': 'http://www.portalfiscal.inf.br/nfe'}
MAX_BASE64 = 1_500_000
MAX_PDF = 2_000_000
MAX_REQUEST = 4_300_000


class CompleteDacte(Dacte):
    """Keep upstream DACTE layout while restoring the omitted compl/xObs.

    BrazilFiscalReport 1.3.1 reads only child xTexto values when building its
    observations list. Its standard observations box and overflow renderer
    can print xObs as well, without changing or reserializing the source XML.
    """
    def _draw_documents_obs(self):
        observations = []
        if self.compl is not None:
            for node in self.compl:
                value = node.text if node.tag.rsplit('}', 1)[-1] == 'xObs' else text(node, 'xTexto')
                if value and value.strip():
                    observations.append(value)
        self.obs_dacte_list = observations
        super()._draw_documents_obs()


def validate_official_nfse_pdf(request, document):
    """Validate identity without changing a byte of the downloaded PDF.

    Official provenance is guaranteed by the authenticated, fixed-host caller;
    PDF text alone cannot authenticate its origin or the issuer's signature.
    """
    if document.kind != 'NFSe':
        raise ValueError('DANFSE_DOCUMENT_REQUIRED')
    encoded = request.get('pdfBase64')
    if not isinstance(encoded, str) or len(encoded) > ((MAX_PDF + 2) // 3) * 4:
        raise ValueError('DANFSE_PDF_INVALID')
    try:
        pdf = base64.b64decode(encoded, validate=True)
        if (not pdf.startswith(b'%PDF-') or not pdf.rstrip().endswith(b'%%EOF')
                or len(pdf) > MAX_PDF):
            raise ValueError()
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf), strict=True)
        if reader.is_encrypted or not 1 <= len(reader.pages) <= 50:
            raise ValueError()
        content = '\n'.join(page.extract_text() or '' for page in reader.pages)
        if not content or len(content) > 1_000_000:
            raise ValueError()
    except Exception:
        raise ValueError('DANFSE_PDF_INVALID') from None

    provider = child(document.invoice, 'DPS/infDPS/prest')
    provider_id = text(provider, 'CNPJ') or text(provider, 'CPF')
    number = text(document.invoice, 'nNFSe')
    if not provider_id or not re.fullmatch(r'(?:\d{11}|\d{14})', provider_id):
        raise ValueError('DANFSE_PDF_IDENTITY_MISMATCH')

    # Boundaries keep a CNPJ or invoice number embedded in the 50-digit key
    # from satisfying a separate field. Accept presentation punctuation only.
    key_pattern = r'(?<!\d)' + r'\s*'.join(document.key) + r'(?!\d)'
    id_pattern = r'(?<!\d)' + r'[.\s/\-]*'.join(provider_id) + r'(?!\d)'
    identity_content = re.sub(key_pattern, ' ', content)
    normalized = ''.join(c for c in unicodedata.normalize('NFKD', identity_content)
                         if not unicodedata.combining(c)).casefold()

    def labeled_values(label, value_pattern):
        # Fail closed when a PDF's reading order does not associate a supported
        # label with its value. A value appearing in an unrelated field cannot
        # satisfy another field merely because its digits occur in the PDF.
        return re.findall(label + r'\s*:?[ \t\r\n]*(?:r\$\s*)?(' + value_pattern + r')(?![\d.,])', normalized)

    def amount_matches(label, amount):
        values = labeled_values(label, r'(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}')
        return bool(values) and all(Decimal(v.replace('.', '').replace(',', '.')) == amount for v in values)

    numbers = labeled_values(r'\bnumero da nfs-e\b', r'\d+')
    number_matches = bool(number and number.isdecimal() and numbers) and all(
        int(value) == int(number) for value in numbers)
    provider_values = labeled_values(r'\bprestador\s+cnpj(?:\s*/\s*cpf)?\b', r'[\d./-]+')
    provider_matches = bool(provider_values) and all(
        re.sub(r'\D', '', value) == provider_id for value in provider_values)

    if (not re.search(key_pattern, content) or not re.search(id_pattern, identity_content)
            or not provider_matches or not number_matches
            or not amount_matches(r'\bvalor (?:do servico|total dos servicos)\b', document.amount)
            or not amount_matches(r'\bvalor liquido (?:da nfs-e|dos servicos)\b', document.net)):
        raise ValueError('DANFSE_PDF_IDENTITY_MISMATCH')
    return {'valid': True, 'key': document.key, 'xmlSha256': document.digest,
            'pdfSha256': hashlib.sha256(pdf).hexdigest()}


def render_request(request: dict) -> dict:
    action = request.get('action', 'render')
    if action not in ('render', 'validateOfficialNfsePdf'):
        raise ValueError('DANFE_ACTION_INVALID')
    key = request.get('key', '')
    encoded = request.get('xmlBase64', '')
    if (not isinstance(key, str) or not re.fullmatch(KEY_PATTERN, key)
            or request.get('companyCnpj') != COMPANY
            or not isinstance(encoded, str) or len(encoded) > MAX_BASE64):
        raise ValueError('DANFE_INPUT_INVALID')
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception:
        raise ValueError('DANFE_XML_INVALID') from None
    digest = hashlib.sha256(raw).hexdigest()
    if digest != request.get('xmlSha256'):
        raise ValueError('DANFE_XML_HASH_MISMATCH')
    document = parse_fiscal_xml(raw, key, COMPANY)
    # A validated event may change an otherwise valid invoice's current state.
    # This optional input only marks historical NFSe; it cannot authorize XML.
    situation = request.get('fiscalSituation', 'AUTORIZADA')
    if situation not in ('AUTORIZADA', 'CANCELADA', 'SUBSTITUIDA'):
        raise ValueError('DANFE_SITUATION_INVALID')
    if situation != 'AUTORIZADA' and document.kind != 'NFSe':
        raise ValueError('DANFE_SITUATION_INVALID')
    if action == 'validateOfficialNfsePdf':
        return validate_official_nfse_pdf(request, document)
    if document.kind not in ('nfeProc', 'NFSe') and (
            document.kind != 'cteProc' or document.model != '57'
            or document.root.get('versao') != '4.00'
            or document.invoice.get('versao') != '4.00'):
        raise ValueError('DACTE_LAYOUT_UNSUPPORTED')
    try:
        if document.kind == 'nfeProc':
            pdf = bytes(Danfe(xml=document.xml).output())
        elif document.kind == 'NFSe':
            from national_danfse import render_national_danfse
            pdf = render_national_danfse(document, situation)
        else:
            pdf = bytes(CompleteDacte(xml=document.xml).output())
    except Exception:
        raise ValueError('DANFE_RENDER_FAILED') from None
    if not pdf.startswith(b'%PDF-') or not pdf.rstrip().endswith(b'%%EOF') or len(pdf) > MAX_PDF:
        raise ValueError('DANFE_PDF_INVALID')
    result = {'key': key, 'xmlSha256': digest,
            'fileName': f'{document.prefix}-{key}-{digest[:16]}.pdf',
            'pdfBase64': base64.b64encode(pdf).decode('ascii'),
            'pdfSha256': hashlib.sha256(pdf).hexdigest()}
    if document.kind == 'NFSe':
        result['source'] = 'LOCAL_DANFSE_NACIONAL'
    return result


if __name__ == '__main__':
    try:
        data = sys.stdin.buffer.read(MAX_REQUEST + 1)
        if len(data) > MAX_REQUEST:
            raise ValueError('DANFE_INPUT_INVALID')
        result = render_request(json.loads(data))
        sys.stdout.write(json.dumps(result, ensure_ascii=True))
    except Exception:
        sys.stderr.write('DANFE_GENERATION_FAILED\n')
        sys.exit(1)
