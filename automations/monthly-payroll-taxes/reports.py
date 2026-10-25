"""Read-only HTML/PDF views of a frozen salary-only tax manifest.

Amounts and components come from the manifest, never from inferred rates or an
employer tax regime. Rendering does not calculate obligations or record payment.
"""
from html import escape
from io import BytesIO
from pathlib import Path


_NOTICE = 'Valores previstos; não pagos. Este relatório não comprova pagamento.'
_BASE = 'Base exclusiva: SALARIO. Prêmio, alimentação e transporte excluídos.'
_ROUNDING = 'Salário e base arredondados a centavos no cálculo de origem.'
_ALLOCATION = ('INSS patronal: componentes totalizados por filial e código de receita; '
               'resíduo em centavos distribuído pelo maior resto fracionário no cálculo de origem.')
_COLUMNS = ('Pessoa / origem', 'Salário e base')


def _cents(value):
    if type(value) is not int or value < 0:
        raise ValueError('Valores monetários devem ser centavos inteiros não negativos.')
    return value


def _rows(plan, tax):
    if tax not in ('INSS', 'FGTS'):
        raise ValueError('Tributo deve ser INSS ou FGTS.')
    rows = plan['rows']
    for row in rows:
        for field in ('salaryCents', 'baseCents', 'inssCents', 'fgtsCents'):
            _cents(row[field])
        components = row['components']
        if not isinstance(components, dict) or not components:
            raise ValueError('Componentes INSS ausentes no manifesto.')
        if sum(_cents(value) for value in components.values()) != row['inssCents']:
            raise ValueError('Componentes divergem do INSS individual no manifesto.')
        if (type(row['days']) is not int or type(row['divisor']) is not int
                or not 0 <= row['days'] <= row['divisor'] or row['divisor'] <= 0):
            raise ValueError('Dias e divisor inválidos no manifesto.')
    total = _cents(plan['totals'][tax])
    if sum(row[f'{tax.lower()}Cents'] for row in rows) != total:
        raise ValueError('Total do tributo diverge da soma individual no manifesto.')
    return rows


def _money(value):
    whole, fraction = divmod(_cents(value), 100)
    return f'R$ {whole:,}'.replace(',', '.') + f',{fraction:02d}'


def _text(value):
    return escape(str(value), quote=True)


def _components(plan, row, tax):
    if tax == 'FGTS':
        return [('FGTS', row['fgtsCents'])]
    labels = {item['code']: str(item['label'])
              for item in plan.get('rules', {}).get('employerComponents', [])}
    result = []
    for code, amount in row['components'].items():
        label = 'Empregado' if code == 'EMPREGADO' else labels.get(code)
        result.append((f'{label} ({code})' if label else str(code), amount))
    return result


def _cells(plan, row, tax):
    """Escaped, simple markup accepted by both HTML and ReportLab paragraphs."""
    identity = (
        f'<b>{_text(row["name"])}</b><br/>'
        f'Fornecedor: {_text(row["supplierId"])}<br/>'
        f'Filial: {_text(row["branch"])}<br/>'
        f'Profissão de origem: {_text(row["profession"])}<br/>'
        f'Cargo RH: {_text(row["cargo"])}<br/>'
        f'Folha: {_text(row["sheetId"])}')
    basis = (
        f'Salário: <b>{_money(row["salaryCents"])}</b><br/>'
        f'Admissão: {_text(row["admission"])}<br/>'
        f'Dias / divisor: {row["days"]} / {row["divisor"]}<br/>'
        f'Base proporcional:<br/><b>{_money(row["baseCents"])}</b>')
    components = '<br/>'.join(
        f'{_text(label)}: <b>{_money(amount)}</b>'
        for label, amount in _components(plan, row, tax))
    amounts = (f'{components}<br/><br/><b>{tax} previsto: '
               f'{_money(row[f"{tax.lower()}Cents"])}</b>')
    return identity, basis, amounts


def calculation_html(plan, tax):
    """Return standalone, escaped HTML; reject inconsistent manifest amounts.

    The selected total and INSS component sums must match the frozen rows. The
    renderer deliberately does not validate or supply financial configuration.
    """
    rows = _rows(plan, tax)
    body = ''.join('<tr>' + ''.join(f'<td>{cell}</td>' for cell in _cells(plan, row, tax))
                   + '</tr>' for row in rows)
    if not rows:
        body = '<tr><td colspan="3">Nenhuma pessoa no manifesto desta competência.</td></tr>'
    total = _money(plan['totals'][tax])
    return f'''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{tax} - Memória de cálculo - {_text(plan['competence'])}</title>
<style>
@page {{ size: A4; margin: 14mm; }}
* {{ box-sizing: border-box; }}
body {{ margin: 24px auto; max-width: 1050px; padding: 0 16px;
        font: 14px/1.5 Arial, sans-serif; color: #182d40; }}
h1 {{ margin: 0 0 8px; font-size: 24px; }}
p {{ margin: 5px 0; overflow-wrap: anywhere; }}
.notice {{ padding: 10px 12px; background: #edf3f7; border-left: 4px solid #285a78; }}
.summary {{ margin: 14px 0; font-size: 17px; }}
table {{ border-collapse: collapse; width: 100%; table-layout: fixed; }}
thead {{ display: table-header-group; }}
th {{ background: #203f56; color: white; text-align: left; }}
th, td {{ padding: 10px; vertical-align: top; overflow-wrap: anywhere;
          border-bottom: 1px solid #cdd8e1; }}
tr {{ break-inside: avoid; page-break-inside: avoid; }}
tbody tr:nth-child(even) {{ background: #f3f6f8; }}
.total {{ background: #e4eef4; font-weight: bold; }}
footer {{ margin-top: 14px; font-size: 12px; }}
@media print {{ body {{ margin: 0; padding: 0; max-width: none; font-size: 10pt; }}
                th, td {{ padding: 7pt; }} }}
</style>
</head>
<body>
<header>
<h1>{tax} - Memória de cálculo</h1>
<p>Competência: {_text(plan['competence'])} | Vencimento: {_text(plan['dueDate'])}</p>
<p>Versão das regras: {_text(plan['rulesVersion'])}</p>
<p>Emissão do plano: {_text(plan['createdDate'])} | Versão do manifesto: {_text(plan['version'])}</p>
<div class="notice"><p>{_NOTICE}</p><p>{_BASE}</p>
<p>{_ROUNDING}{' ' + _ALLOCATION if tax == 'INSS' else ''}</p></div>
<p class="summary">Total previsto {tax}: <strong>{total}</strong> | Pessoas: {len(rows)}</p>
</header>
<table>
<colgroup><col style="width:38%"><col style="width:28%"><col style="width:34%"></colgroup>
<thead><tr><th>{_COLUMNS[0]}</th><th>{_COLUMNS[1]}</th><th>{tax} previsto / componentes</th></tr></thead>
<tbody>{body}
<tr class="total"><td colspan="2">TOTAL PREVISTO {tax}</td><td>{total}</td></tr>
</tbody>
</table>
<footer><p>{_NOTICE}</p><p>Valores preservados do manifesto; componentes e arredondamentos não são recalculados neste relatório.</p></footer>
</body>
</html>'''


def render_calculation_pdf(plan, tax, path):
    """Write one tax's PDF with wrapping rows, repeated context and page numbers.

    Build in memory before replacing the destination so a validation/layout
    failure leaves an existing file intact. Return the caller's path as a Path.
    ReportLab is loaded only for PDF generation; HTML has no PDF dependency.
    """
    rows = _rows(plan, tax)
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, TableStyle

    ink = colors.HexColor('#203f56')
    pale = colors.HexColor('#edf3f7')
    margin = 36
    # SimpleDocTemplate's frame adds six points of padding on each side.
    width = A4[0] - 2 * margin - 12
    normal = ParagraphStyle('Body', fontName='Helvetica', fontSize=9, leading=12,
                            textColor=ink, splitLongWords=True, alignment=TA_LEFT)
    small = ParagraphStyle('Metadata', parent=normal, fontSize=8.5, leading=11)
    title = ParagraphStyle('Title', parent=normal, fontName='Helvetica-Bold',
                           fontSize=17, leading=21)
    heading = ParagraphStyle('Column', parent=normal, fontName='Helvetica-Bold',
                             textColor=colors.white)
    summary = ParagraphStyle('Summary', parent=normal, fontName='Helvetica-Bold',
                             fontSize=12, leading=16, spaceAfter=8)
    notice = ParagraphStyle('Notice', parent=normal, backColor=pale,
                            borderPadding=7, spaceBefore=6, spaceAfter=12)
    header = [
        Paragraph(f'{tax} - Memória de cálculo', title),
        Paragraph(f'Competência: {_text(plan["competence"])} | '
                  f'Vencimento: {_text(plan["dueDate"])}', small),
        Paragraph(f'Versão das regras: {_text(plan["rulesVersion"])}', small)]
    header_height = sum(item.wrap(width, A4[1])[1] for item in header)
    top_margin = margin + header_height + 18
    full_frame_height = A4[1] - top_margin - 46 - 12

    class ManifestTable(LongTable):
        def split(self, available_width, available_height):
            # Ordinary people move together to the next page. An unusually tall
            # cell can continue only from a fresh frame, never in leftover space
            # that would produce a second column header on the same page.
            # The original table may also start below the first-page summary.
            self.splitInRow = int(self is table or available_height >= full_frame_height - 1)
            return super().split(available_width, available_height)

    def decorate(canvas, document):
        canvas.saveState()
        y = A4[1] - margin
        for paragraph in header:
            _, height = paragraph.wrap(width, A4[1])
            y -= height
            paragraph.drawOn(canvas, margin, y)
        canvas.setStrokeColor(colors.HexColor('#cdd8e1'))
        canvas.line(margin, y - 6, A4[0] - margin, y - 6)
        canvas.setFillColor(ink)
        canvas.setFont('Helvetica', 8)
        canvas.drawString(margin, 28, _NOTICE)
        canvas.drawRightString(A4[0] - margin, 16, f'{tax} | Página {document.page}')
        canvas.restoreState()

    total = _money(plan['totals'][tax])
    story = [
        Paragraph(f'Emissão do plano: {_text(plan["createdDate"])} | '
                  f'Versão do manifesto: {_text(plan["version"])}', small),
        Spacer(1, 8),
        Paragraph(f'{_NOTICE}<br/>{_BASE}<br/>{_ROUNDING}'
                  + (' ' + _ALLOCATION if tax == 'INSS' else ''), notice),
        Paragraph(f'Total previsto {tax}: {total} | Pessoas: {len(rows)}', summary)]
    data = [[Paragraph(label, heading) for label in
             (*_COLUMNS, f'{tax} previsto / componentes')]]
    for row in rows:
        data.append([Paragraph(cell, normal) for cell in _cells(plan, row, tax)])
    if not rows:
        data.append([Paragraph('Nenhuma pessoa no manifesto desta competência.', normal), '', ''])
    data.append([Paragraph(f'TOTAL PREVISTO {tax}', normal), '',
                 Paragraph(f'<b>{total}</b>', normal)])
    table = ManifestTable(data, colWidths=[width * .38, width * .28, width * .34],
                          repeatRows=1, splitByRow=1, splitInRow=0, hAlign='LEFT')
    commands = [
        ('BACKGROUND', (0, 0), (-1, 0), ink),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#f3f6f8')]),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#e4eef4')),
        ('SPAN', (0, -1), (1, -1)),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LINEBELOW', (0, 0), (-1, -1), .4, colors.HexColor('#cdd8e1'))]
    if not rows:
        commands.append(('SPAN', (0, 1), (-1, 1)))
    table.setStyle(TableStyle(commands))
    story.append(table)
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=margin, rightMargin=margin,
        topMargin=top_margin, bottomMargin=46,
        title=f'{tax} - Memória de cálculo - {plan["competence"]}',
        author='Relatório de provisões', pageCompression=1)
    document.build(story, onFirstPage=decorate, onLaterPages=decorate)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(buffer.getvalue())
    return target
