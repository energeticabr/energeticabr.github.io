"""Render complete authorized NF-e, CT-e and national NFS-e offline.

CLI protocol: bounded UTF-8 JSON on stdin; JSON result on stdout. No files,
external URLs, certificate access or document content in diagnostic messages.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import sys

from brazilfiscalreport.danfe import Danfe
from brazilfiscalreport.dacte import Dacte
from fiscal_pdf_layout import render_fiscal_mirror
from fiscal_document import COMPANY, KEY_PATTERN, parse_fiscal_xml

NS = {'n': 'http://www.portalfiscal.inf.br/nfe'}
MAX_BASE64 = 1_500_000
MAX_PDF = 2_000_000


def _mirror_pdf(document, situation='AUTORIZADA'):
    return render_fiscal_mirror(document, situation)


def render_request(request: dict) -> dict:
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
    try:
        if document.kind == 'nfeProc':
            pdf = bytes(Danfe(xml=document.xml).output())
        elif document.kind == 'cteProc':
            try:
                pdf = bytes(Dacte(xml=document.xml).output())
            except Exception:
                pdf = _mirror_pdf(document)
        else:
            pdf = _mirror_pdf(document, situation)
    except Exception:
        raise ValueError('DANFE_RENDER_FAILED') from None
    if not pdf.startswith(b'%PDF-') or not pdf.rstrip().endswith(b'%%EOF') or len(pdf) > MAX_PDF:
        raise ValueError('DANFE_PDF_INVALID')
    return {'key': key, 'xmlSha256': digest,
            'fileName': f'{document.prefix}-{key}-{digest[:16]}.pdf',
            'pdfBase64': base64.b64encode(pdf).decode('ascii'),
            'pdfSha256': hashlib.sha256(pdf).hexdigest()}


if __name__ == '__main__':
    try:
        data = sys.stdin.buffer.read(2_100_001)
        if len(data) > 2_100_000:
            raise ValueError('DANFE_INPUT_INVALID')
        result = render_request(json.loads(data))
        sys.stdout.write(json.dumps(result, ensure_ascii=True))
    except Exception:
        sys.stderr.write('DANFE_GENERATION_FAILED\n')
        sys.exit(1)
