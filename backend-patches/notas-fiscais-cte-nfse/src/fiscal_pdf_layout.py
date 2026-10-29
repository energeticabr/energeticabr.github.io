"""Human-readable, bounded offline fiscal mirrors using the existing fpdf stack.

This is a consultation layout, never an official DANFSe/DACTE. Values come from
explicit XML fields; this module neither calculates liability nor alters net.
"""
from datetime import datetime
from decimal import Decimal
from importlib.resources import files
import os
from pathlib import Path

from fontTools.ttLib import TTFont
from fpdf import FPDF
from fiscal_document import child, text, money

MISSING = 'Não informado no XML'
NAVY = (25, 48, 70)
GRAY = (87, 103, 117)
LINE = (221, 228, 234)


def amount(value):
    if value is None:
        return MISSING
    return 'R$ ' + format(value, ',.2f').translate(str.maketrans({',': '.', '.': ','}))


def xml_money(node, path):
    value = text(node, path)
    return money(value) if value is not None else None


def stamp(value):
    if not value:
        return MISSING
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        zone = parsed.strftime('%z')
        zone = ' (UTC' + zone[:3] + ':' + zone[3:] + ')' if zone else ''
        return parsed.strftime('%d/%m/%Y às %H:%M:%S') + zone
    except ValueError:
        return value


def first_node(node, paths):
    for path in paths:
        found = child(node, path)
        if found is not None:
            return found
    return None


def identity(node):
    return text(node, 'CNPJ') or text(node, 'CPF') or text(node, 'NIF')


def address(node):
    end = first_node(node, ['end', 'enderEmit', 'enderReme', 'enderDest', 'enderExped', 'enderReceb', 'enderToma', 'enderNac'])
    if end is None:
        return None
    lines = []
    street = ', '.join(v for v in [text(end, 'xLgr'), text(end, 'nro')] if v)
    if street:
        lines.append(street)
    neighborhood = ' - '.join(v for v in [text(end, 'xCpl'), text(end, 'xBairro')] if v)
    if neighborhood:
        lines.append(neighborhood)
    municipality = text(end, 'xMun') or text(end, 'endNac/xMun')
    if not municipality:
        code = text(end, 'endNac/cMun') or text(end, 'cMun')
        municipality = 'Município (IBGE): ' + code if code else None
    locality = ' / '.join(v for v in [municipality, text(end, 'UF') or text(end, 'endNac/UF')] if v)
    if locality:
        lines.append(locality)
    postal = text(end, 'endNac/CEP') or text(end, 'CEP')
    if postal:
        lines.append('CEP: ' + postal)
    country = text(end, 'endExt/cPais') or text(end, 'cPais')
    if country:
        lines.append('País informado: ' + country)
    return '\n'.join(lines) or None


def _fonts():
    # Reuse fonts already installed on the host. The existing barcode font is
    # the embedded Unicode fallback; no download or additional package needed.
    windows = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
    candidates = [
        (Path('/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf'), Path('/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf')),
        (Path('/usr/share/fonts/dejavu/DejaVuSans.ttf'), Path('/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf')),
        (Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')),
        (Path('/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf'), Path('/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf')),
        (windows / 'arial.ttf', windows / 'arialbd.ttf'),
    ]
    for regular, bold in candidates:
        if regular.is_file():
            return str(regular), str(bold if bold.is_file() else regular)
    fallback = str(files('barcode').joinpath('fonts/DejaVuSansMono.ttf'))
    return fallback, fallback


def render_fiscal_mirror(document, situation='AUTORIZADA'):
    nodes = list(document.root.iter())
    if len(nodes) > 4000 or sum(len(n.text or '') for n in nodes) > 400000:
        raise ValueError('DANFE_MIRROR_LIMIT')
    regular, bold = _fonts()
    # Preserve accents/Unicode or fail explicitly, never silently replace data.
    with TTFont(regular) as font:
        glyphs = font.getBestCmap()
    literal = ''.join(n.text or '' for n in nodes) + document.supplier
    if any(ord(c) not in glyphs for c in literal if c not in '\r\n\t'):
        raise ValueError('DANFE_UNSUPPORTED_TEXT_GLYPH')
    service = document.kind == 'NFSe'
    title = 'ESPELHO DA NFS-e' if service else ('ESPELHO DO CT-e OS' if document.kind == 'cteOSProc' else 'ESPELHO DO CT-e SIMPLIFICADO' if document.kind == 'cteSimpProc' else 'ESPELHO DO CT-e')

    class Mirror(FPDF):
        def header(self):
            self.set_fill_color(*NAVY)
            self.rect(14, 12, self.w - 28, 23, style='F')
            self.set_xy(18, 16)
            self.set_font('FiscalSans', 'B', 15)
            self.set_text_color(255, 255, 255)
            self.cell(0, 8, title, new_x='LMARGIN', new_y='NEXT')
            self.set_x(18)
            self.set_font('FiscalSans', size=8.5)
            self.set_text_color(220, 231, 240)
            self.cell(0, 5, 'Documento de consulta gerado a partir do XML original', new_x='LMARGIN', new_y='NEXT')
            self.set_xy(14, 38)
            self.set_font('FiscalSans', size=8)
            self.set_text_color(*GRAY)
            note = 'Não substitui o DANFSe oficial do ADN.' if service else 'Não reproduz o leiaute oficial do DACTE.'
            self.cell(0, 4, note, new_x='LMARGIN', new_y='NEXT')
            if document.environment == '2':
                self.set_font('FiscalSans', 'B', 8)
                self.set_text_color(136, 91, 15)
                self.cell(0, 5, 'HOMOLOGACAO - SEM VALOR FISCAL', new_x='LMARGIN', new_y='NEXT')
            if situation != 'AUTORIZADA':
                self.set_fill_color(252, 233, 232)
                self.set_text_color(148, 37, 36)
                self.set_font('FiscalSans', 'B', 10)
                self.cell(0, 8, situation + ' - DOCUMENTO FISCAL HISTÓRICO', fill=True, new_x='LMARGIN', new_y='NEXT')
            self.ln(4)

        def footer(self):
            self.set_y(-19)
            self.set_draw_color(*LINE)
            self.line(14, self.y, self.w - 14, self.y)
            self.set_font('FiscalSans', size=7)
            self.set_text_color(*GRAY)
            self.cell(0, 5, 'Chave de acesso: ' + document.key, align='C', new_x='LMARGIN', new_y='NEXT')
            self.cell(0, 4, 'Gerado do XML original - Página ' + str(self.page_no()) + '/{nb}', align='C')

        def add_page(self, *args, **kwargs):
            if self.page_no() >= 100:
                raise ValueError('DANFE_MIRROR_LIMIT')
            return super().add_page(*args, **kwargs)

    pdf = Mirror(format='A4')
    pdf.set_margins(14, 12, 14)
    pdf.set_auto_page_break(auto=True, margin=25)
    pdf.add_font('FiscalSans', fname=regular)
    pdf.add_font('FiscalSans', style='B', fname=bold)
    pdf.alias_nb_pages()
    pdf.set_title(title)
    pdf.set_author('Energética - leitura do XML fiscal')
    pdf.set_subject('Espelho de consulta. SHA-256 do XML: ' + document.digest)
    pdf.add_page()

    def line(value, size=9.5, color=NAVY, style='', height=4.7):
        pdf.set_x(pdf.l_margin)
        pdf.set_font('FiscalSans', style, size)
        pdf.set_text_color(*color)
        pdf.multi_cell(0, height, value or MISSING, align='L', new_x='LMARGIN', new_y='NEXT')

    def section(label):
        if pdf.will_page_break(15):
            pdf.add_page()
        pdf.ln(1)
        pdf.set_fill_color(237, 242, 246)
        pdf.set_text_color(*NAVY)
        pdf.set_font('FiscalSans', 'B', 9)
        pdf.cell(0, 6, '  ' + label, fill=True, new_x='LMARGIN', new_y='NEXT')
        pdf.ln(2)

    def measure(value, width, size=10, style='', height=4.8):
        pdf.set_font('FiscalSans', style, size)
        return pdf.multi_cell(width, height, value or MISSING, align='L', dry_run=True, output='HEIGHT')

    def grid(entries, columns=2):
        width = pdf.epw / columns
        for start in range(0, len(entries), columns):
            row = entries[start:start + columns]
            heights = [measure(label, width - 6, 9, height=4) + measure(value, width - 6, style='B') + 1 for label, value in row]
            row_height = max(heights)
            if pdf.will_page_break(row_height + 3):
                pdf.add_page()
            y = pdf.y
            for index, (label, value) in enumerate(row):
                x = pdf.l_margin + width * index
                pdf.set_xy(x, y)
                pdf.set_font('FiscalSans', size=9)
                pdf.set_text_color(*GRAY)
                pdf.multi_cell(width - 6, 4, label, align='L', new_x='LEFT', new_y='NEXT')
                pdf.set_font('FiscalSans', 'B', 10)
                pdf.set_text_color(*NAVY if value else GRAY)
                pdf.multi_cell(width - 6, 4.8, value or MISSING, align='L', new_x='LEFT', new_y='NEXT')
            pdf.set_xy(pdf.l_margin, y + row_height + 2)

    def parties(first, second):
        prepared = []
        width = (pdf.epw - 5) / 2
        for label, node, name, *given_address in [first, second]:
            details = 'CPF/CNPJ: ' + (identity(node) or MISSING)
            party_address = given_address[0] if given_address else address(node)
            details += '\n' + (party_address or ('Endereço: ' + MISSING))
            height = 13 + measure(name, width - 8, 10, 'B') + measure(details, width - 8, 9, height=4.4)
            prepared.append((label, name, details, height))
        height = max(item[3] for item in prepared)
        if height > 95:
            for label, name, details, _ in prepared:
                section(label)
                line(name, style='B')
                line(details, 9, GRAY)
            return
        if pdf.will_page_break(height + 4):
            pdf.add_page()
        y = pdf.y
        for index, (label, name, details, _) in enumerate(prepared):
            x = pdf.l_margin + index * (width + 5)
            pdf.set_draw_color(*LINE)
            pdf.set_fill_color(250, 252, 253)
            pdf.rect(x, y, width, height, style='DF')
            pdf.set_xy(x + 4, y + 3)
            pdf.set_font('FiscalSans', 'B', 9)
            pdf.set_text_color(*GRAY)
            pdf.cell(width - 8, 5, label, new_x='LEFT', new_y='NEXT')
            pdf.set_font('FiscalSans', 'B', 10)
            pdf.set_text_color(*NAVY)
            pdf.multi_cell(width - 8, 4.8, name or MISSING, align='L', new_x='LEFT', new_y='NEXT')
            pdf.ln(2)
            pdf.set_x(x + 4)
            pdf.set_font('FiscalSans', size=9)
            pdf.set_text_color(*GRAY)
            pdf.multi_cell(width - 8, 4.4, details, align='L', new_x='LEFT', new_y='NEXT')
        pdf.set_xy(pdf.l_margin, y + height + 4)

    def totals(discounts):
        section('VALORES')
        if pdf.will_page_break(30):
            pdf.add_page()
        values = [('VALOR DOS SERVIÇOS' if service else 'VALOR DA PRESTAÇÃO', document.amount, (231, 243, 235), (32, 99, 61)),
                  ('DESCONTOS INFORMADOS', discounts, (253, 245, 225), (119, 84, 29)),
                  ('VALOR LÍQUIDO DO XML', document.net, (232, 241, 251), (31, 76, 123))]
        width, y = (pdf.epw - 8) / 3, pdf.y
        for index, (label, value, fill, ink) in enumerate(values):
            x = pdf.l_margin + index * (width + 4)
            pdf.set_fill_color(*fill)
            pdf.rect(x, y, width, 24, style='F')
            pdf.set_xy(x + 3, y + 3)
            pdf.set_font('FiscalSans', 'B', 9)
            pdf.set_text_color(*ink)
            pdf.cell(width - 6, 5, label, new_x='LEFT', new_y='NEXT')
            value_text = amount(value)
            size = 15 if value is not None else 9
            pdf.set_font('FiscalSans', 'B', size)
            while pdf.get_string_width(value_text) > width - 6 and size > 9:
                size -= .5
                pdf.set_font('FiscalSans', 'B', size)
            pdf.cell(width - 6, 10, value_text)
        pdf.set_xy(pdf.l_margin, y + 27)
        line('Valor líquido conforme o XML original.', 9, GRAY)

    inf = document.invoice
    if service:
        dps = child(inf, 'DPS/infDPS')
        provider, taker = child(dps, 'prest'), child(dps, 'toma')
        section('DADOS DO DOCUMENTO')
        grid([('NÚMERO DA NFS-e', text(inf, 'nNFSe')), ('EMISSÃO / GERAÇÃO DA NFS-e', stamp(document.issued_at)),
              ('DPS - NÚMERO / SÉRIE', ' / '.join(v for v in [text(dps, 'nDPS'), text(dps, 'serie')] if v)), ('EMISSÃO DA DPS', stamp(text(dps, 'dhEmi')))])
        provider_address = address(provider)
        issuer = child(inf, 'emit')
        if not provider_address and identity(provider) and identity(provider) == identity(issuer):
            provider_address = address(issuer)
        parties(('PRESTADOR', provider, document.supplier, provider_address), ('TOMADOR', taker, text(taker, 'xNome')))
        section('SERVIÇO')
        serv = child(dps, 'serv')
        locality_code = text(serv, 'locPrest/cLocPrestacao')
        locality = (text(inf, 'xLocPrestacao') or locality_code) if locality_code else None
        country = text(serv, 'locPrest/cPaisPrestacao')
        grid([('CÓDIGO NACIONAL DO SERVIÇO', text(serv, 'cServ/cTribNac')), ('MUNICÍPIO DA PRESTAÇÃO', locality)])
        if country:
            grid([('PAÍS DA PRESTAÇÃO', country)])
        line(text(serv, 'cServ/xDescServ'), size=10, height=5)
        desc = child(dps, 'valores/vDescCondIncond')
        discount_values = [xml_money(desc, path) for path in ['vDescCond', 'vDescIncond']]
        discount = sum((v for v in discount_values if v is not None), Decimal(0)) if any(v is not None for v in discount_values) else None
        totals(discount)
        if discount is not None:
            grid([('DESCONTO CONDICIONADO', amount(discount_values[0])), ('DESCONTO INCONDICIONADO', amount(discount_values[1]))])
        values = child(inf, 'valores')
        trib = child(dps, 'valores/trib')
        fed, pis = child(trib, 'tribFed'), child(trib, 'tribFed/piscofins')
        section('TRIBUTOS INFORMADOS')
        grid([('ISS informado', amount(xml_money(values, 'vISSQN'))), ('Base de cálculo do ISS', amount(xml_money(values, 'vBC'))),
              ('PIS informado', amount(xml_money(pis, 'vPis'))), ('COFINS informada', amount(xml_money(pis, 'vCofins')))], columns=4)
        section('RETENÇÕES DECLARADAS')
        retained = []
        pis_type = text(pis, 'tpRetPisCofins')
        for name, path, codes in [('PIS retido', 'vPis', {'1', '3', '4', '5', '9'}), ('COFINS retida', 'vCofins', {'1', '3', '4', '6', '7'})]:
            value = xml_money(pis, path)
            if pis_type in codes and value is not None:
                retained.append((name, amount(value)))
        for name, path in [('CSLL retida', 'vRetCSLL'), ('IRRF retido', 'vRetIRRF'), ('Previdência retida', 'vRetCP')]:
            value = xml_money(fed, path)
            if value is not None:
                retained.append((name, amount(value)))
        iss_type = text(trib, 'tribMun/tpRetISSQN')
        iss_value = xml_money(values, 'vISSQN')
        if iss_type in {'2', '3'} and iss_value is not None:
            retained.append(('ISS retido pelo tomador' if iss_type == '2' else 'ISS retido pelo intermediário', amount(iss_value)))
        if retained:
            grid(retained, columns=4)
        else:
            line('Não há valores de retenção informados nos campos lidos do XML.', 9, GRAY)
        section('OBSERVAÇÕES')
        line(text(serv, 'infoCompl/xInfComp'), 9)
        if text(inf, 'xOutInf'):
            section('INFORMAÇÕES AO FISCO')
            line(text(inf, 'xOutInf'), 9)
    else:
        ide = child(inf, 'ide')
        provider = child(inf, 'emit')
        taker = child(inf, 'toma')
        if taker is None:
            taker = child(ide, 'toma4')
        if taker is None:
            role = text(ide, 'toma3/toma')
            taker = child(inf, {'0': 'rem', '1': 'exped', '2': 'receb', '3': 'dest'}.get(role, 'toma'))
        section('DADOS DO DOCUMENTO')
        grid([('NÚMERO DO CT-e / SÉRIE', ' / '.join(v for v in [text(ide, 'nCT'), text(ide, 'serie')] if v)), ('EMISSÃO DO CT-e', stamp(document.issued_at)),
              ('MODELO', document.model), ('PROTOCOLO DE AUTORIZAÇÃO', text(document.root, 'protCTe/infProt/nProt'))])
        parties(('TRANSPORTADORA', provider, document.supplier), ('TOMADOR', taker, text(taker, 'xNome')))
        section('TRANSPORTE')
        grid([('ORIGEM', ' / '.join(v for v in [text(ide, 'xMunIni'), text(ide, 'UFIni')] if v)), ('DESTINO', ' / '.join(v for v in [text(ide, 'xMunFim'), text(ide, 'UFFim')] if v)),
              ('NATUREZA DA OPERAÇÃO', text(ide, 'natOp')), ('CFOP', text(ide, 'CFOP'))])
        fat = first_node(inf, ['infCTeNorm/cobr/fat', 'cobr/fat'])
        totals(xml_money(fat, 'vDesc'))
        if document.kind == 'cteSimpProc':
            section('ENTREGAS DO TRANSPORTE')
            namespace = inf.tag.partition('}')[0] + '}'
            for detail in inf.findall(namespace + 'det'):
                if pdf.will_page_break(38):
                    pdf.add_page()
                line('Entrega ' + detail.get('nItem', '?'), 9.5, style='B')
                grid([('ORIGEM', text(detail, 'xMunIni') or text(detail, 'cMunIni')), ('DESTINO', text(detail, 'xMunFim') or text(detail, 'cMunFim')),
                      ('PRESTAÇÃO', amount(xml_money(detail, 'vPrest'))), ('VALOR A RECEBER', amount(xml_money(detail, 'vRec')))])
                for nfe in detail.findall(namespace + 'infNFe/' + namespace + 'chNFe'):
                    line('NF-e vinculada: ' + (nfe.text or MISSING), 9, GRAY)
        section('TRIBUTOS INFORMADOS')
        icms = child(inf, 'imp/ICMS')
        tax = list(icms)[0] if icms is not None and len(icms) else None
        grid([('ICMS informado', amount(xml_money(tax, 'vICMS'))), ('Base de cálculo do ICMS', amount(xml_money(tax, 'vBC')))])
        line('Tributos reproduzidos do XML; valores de ICMS não são classificados como retenção pelo tomador.', 9, GRAY)
        section('OBSERVAÇÕES')
        line(text(inf, 'compl/xObs'), 9)
        fiscal = text(inf, 'imp/infAdFisco')
        if fiscal:
            section('INFORMAÇÕES AO FISCO')
            line(fiscal, 9)
    return bytes(pdf.output())
