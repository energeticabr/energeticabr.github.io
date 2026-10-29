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
from fpdf import FPDF
from fontTools.ttLib import TTFont
from importlib.resources import files
from fiscal_document import COMPANY, KEY_PATTERN, parse_fiscal_xml

NS = {'n': 'http://www.portalfiscal.inf.br/nfe'}
MAX_BASE64 = 1_500_000
MAX_PDF = 2_000_000


def _literal_rows(node, path='', ordinal=None):
    local = node.tag.rsplit('}', 1)[-1]
    if local == 'Signature':
        return
    current = path + '/' + local + (f'[{ordinal}]' if ordinal is not None else '')
    for name, value in node.attrib.items():
        yield current + '/@' + name, value
    children = list(node)
    if not children and node.text and node.text.strip():
        yield current, node.text.strip()
    counts, positions = {}, {}
    for item in children:
        counts[item.tag] = counts.get(item.tag, 0)+1
    for item in children:
        positions[item.tag] = positions.get(item.tag, 0)+1
        yield from _literal_rows(item, current, positions[item.tag] if counts[item.tag] > 1 else None)


def _amount_br(amount):
    return format(amount, ',.2f').translate(str.maketrans({',': '.', '.': ','}))


def _mirror_pdf(document, situation='AUTORIZADA'):
    rows = list(_literal_rows(document.root))
    if len(rows) > 4000 or sum(len(label)+len(value) for label, value in rows) > 400000:
        raise ValueError('DANFE_MIRROR_LIMIT')
    # The font is shipped by the already pinned python-barcode dependency.
    # Embedded Unicode preserves Portuguese, literal markup and other supported
    # characters without silently transliterating fiscal data.
    font_path = str(files('barcode').joinpath('fonts/DejaVuSansMono.ttf'))
    with TTFont(font_path) as font:
        glyphs = font.getBestCmap()
    characters = set(''.join(label+value for label, value in rows)+document.supplier)
    if any(ord(c) not in glyphs for c in characters if c not in '\r\n\t'):
        raise ValueError('DANFE_UNSUPPORTED_TEXT_GLYPH')

    class Mirror(FPDF):
        def header(self):
            self.set_font('Fiscal', size=12)
            self.set_text_color(28, 58, 85)
            self.multi_cell(0, 7, 'ESPELHO DO XML - '+document.fiscal_type,
                            new_x='LMARGIN', new_y='NEXT')
            self.set_font('Fiscal', size=8)
            self.set_text_color(55, 65, 75)
            self.multi_cell(0, 5, ('HOMOLOGACAO - SEM VALOR FISCAL' if document.environment == '2'
                                  else 'Ambiente informado no XML: PRODUCAO'),
                            new_x='LMARGIN', new_y='NEXT')
            if situation != 'AUTORIZADA':
                self.set_font('Fiscal', size=11)
                self.set_text_color(155, 35, 35)
                self.multi_cell(0, 7, situation+' - REGISTRO FISCAL HISTORICO',
                                new_x='LMARGIN', new_y='NEXT')
            self.ln(3)

        def footer(self):
            self.set_y(-14)
            self.set_font('Fiscal', size=7)
            self.set_text_color(90, 90, 90)
            self.cell(0, 5, f'Chave final {document.key[-12:]} | Pagina {self.page_no()}/{{nb}}', align='C')

    pdf = Mirror(format='A4')
    pdf.set_margins(14, 12, 14)
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_font('Fiscal', fname=font_path)
    pdf.alias_nb_pages()
    pdf.set_title('Espelho do XML - '+document.fiscal_type)
    pdf.set_author('Energetica - leitura do XML fiscal')
    pdf.add_page()

    def line(value, size=9, color=(20, 25, 30)):
        pdf.set_font('Fiscal', size=size)
        pdf.set_text_color(*color)
        pdf.multi_cell(0, 5, value, new_x='LMARGIN', new_y='NEXT')

    line('Documento de consulta gerado a partir do XML original.', 8)
    line(('Este espelho nao e o DANFSe oficial do ADN.' if document.kind == 'NFSe'
          else 'Este espelho nao reproduz o leiaute oficial do DACTE.'), 8)
    pdf.ln(3)
    line('Chave de acesso: '+document.key)
    line('Fornecedor: '+document.supplier)
    line('Emissao registrada no XML: '+document.issued_at)
    line('Valor total informado: R$ '+_amount_br(document.amount))
    if document.net is not None:
        line('Valor liquido informado: R$ '+_amount_br(document.net))
    line('SHA-256 do XML: '+document.digest, 7)
    pdf.ln(4)
    line('CAMPOS DO XML - VALORES LITERAIS', 10, (28, 58, 85))
    line('Tags e atributos preservados abaixo; assinatura digital permanece no XML.', 7)
    pdf.ln(2)
    for label, value in rows:
        if pdf.will_page_break(15):
            pdf.add_page()
        line(label.lstrip('/'), 6.8, (85, 95, 105))
        line(value, 8.5)
        pdf.ln(2)
        if pdf.page_no() > 100:
            raise ValueError('DANFE_MIRROR_LIMIT')
    return bytes(pdf.output())


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
