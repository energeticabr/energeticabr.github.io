"""Sicoob-style conference documents, explicitly issued by Energetico."""
from datetime import datetime
from decimal import Decimal
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle

import sync_movements as movements

ASSETS=Path(__file__).with_name('assets')
PREFIX='Demonstrativo-Energetico-Sicoob-'
VERSION='energetico-sicoob-generated-v1'
IDENTITY=('CHAVEIMPORTACAO','ORIGEMMOVIMENTACAO','OPERACAO','CONTAPAGADORA',
          'DATAPAGAMENTO','VALOR','DESCRICAO','REFERENCIABANCARIA')


def is_generated_filename(name):
    return re.fullmatch(re.escape(PREFIX)+r'[1-9][0-9]*\.pdf',name) is not None


def fingerprint(row):
    identity={k:row.get(k) for k in (*IDENTITY,'RAZAOSOCIALRECEBEDOR','DOCUMENTORECEBEDOR')}
    identity['DATAPAGAMENTO']=str(movements.civil_date(row['DATAPAGAMENTO']))
    identity['VALOR']=movements.money(row['VALOR'])
    identity['Id']=int(row['Id'])
    return sha256(json.dumps(identity,sort_keys=True,ensure_ascii=False).encode()).hexdigest()


def _document(value):
    value=movements.text(value)
    if len(value)==11 and value.isdigit():return f'***.{value[3:6]}.{value[6:9]}-**'
    if len(value)==14 and '*' not in value:return f'{value[:2]}.{value[2:5]}.{value[5:8]}/{value[8:12]}-{value[12:]}'
    return value or 'Não disponibilizado pelo banco'


def _institution(value):
    mapping=json.loads((ASSETS/'institutions.json').read_text(encoding='utf-8'))['institutions']
    value=movements.text(value)
    return mapping.get(value, 'ISPB '+value if value else 'Não disponibilizado pelo banco')


def render_receipt(row,payer,*,pix=None,boleto=None):
    """Render validated source fields only; statement dates are never payment times."""
    fonts=Path(reportlab.__file__).parent/'fonts'
    for name,file in [('Receipt','Vera.ttf'),('ReceiptBold','VeraBd.ttf')]:
        if name not in pdfmetrics.getRegisteredFontNames():pdfmetrics.registerFont(TTFont(name,str(fonts/file)))
    output=BytesIO();W=440
    ink=HexColor('#003D42');gray=HexColor('#505957')
    receiver=dict(pix.get('destino') or {}) if pix else {}
    receiver.setdefault('nome',row.get('RAZAOSOCIALRECEBEDOR'))
    receiver.setdefault('cpfCnpj',row.get('DOCUMENTORECEBEDOR'))
    if (not pix and 'INTERCREDIS' in movements.bank_label(row['DESCRICAO'])
            and movements.tax_id(receiver.get('cpfCnpj'))==movements.tax_id(payer.get('cpfCnpj'))
            and movements.bank_label(receiver.get('nome'))!=movements.bank_label(payer.get('nome'))):
        # This statement format includes the sender's document in its complement.
        receiver['cpfCnpj']=None
    if not receiver.get('cpfCnpj'):
        masked=movements.PIX_MASKED_DOCUMENT.search(row.get('DESCRICAO') or '')
        if masked:receiver['cpfCnpj']='***.'+masked[1]+'.'+masked[2]+'-**'
    payer=dict(payer)
    if pix:payer.update(pix.get('origem') or {})
    is_pix=bool(re.search(r'\bPIX\b',movements.bank_label(row['DESCRICAO'])))
    title='Comprovante de envio Pix' if is_pix else 'Demonstrativo de pagamento'
    paid=movements.civil_date(row['DATAPAGAMENTO']).strftime('%d/%m/%Y')
    caption='Lançado no extrato em '+paid
    identifier='Não disponibilizado pelo banco'
    identifier_label='ID da Transação:' if is_pix else 'Referência bancária:'
    if pix:
        when=datetime.fromisoformat(pix['horario'].replace('Z','+00:00')).astimezone(movements.ZONE)
        caption='Transferido em '+when.strftime('%d/%m/%Y às %H:%M:%S')
        identifier=pix['endToEndId']
    elif boleto:
        receiver['nome']=boleto.get('nomeRazaoSocialBeneficiarioFinal') or boleto.get('nomeRazaoSocialBeneficiario') or receiver.get('nome')
        receiver['cpfCnpj']=boleto.get('numeroCpfCnpjBeneficiarioFinal') or boleto.get('numeroCpfCnpjBeneficiario') or receiver.get('cpfCnpj')
        identifier_label='Autenticação bancária:'
        identifier=boleto['numeroAutenticacaoPagamento']
    elif not is_pix:
        identifier=movements.text(row.get('REFERENCIABANCARIA')) or identifier

    # Calculate wrapped field heights before drawing to support long legal names.
    def paragraph(value,size=15.5,bold=True,color=ink):
        style=ParagraphStyle('field',fontName='ReceiptBold' if bold else 'Receipt',fontSize=size,
                             leading=size*1.23,textColor=color,spaceAfter=0,splitLongWords=True)
        p=Paragraph(escape(str(value)),style);p.wrap(310,10000);return p
    groups=[]
    for heading,party in [('Recebedor',receiver),('Pagador',payer)]:
        name=movements.text(party.get('nome'))
        if name.upper() in ('','N/A'):name='Não disponibilizado pelo banco'
        values=[('Nome',name.upper()),('CPF/CNPJ',_document(party.get('cpfCnpj'))),
                ('Instituição',_institution(party.get('ispb')))]
        fields=[];height=56
        for label,value in values:
            p=paragraph(value);fields.append((label,p));height+=30+p.height
        groups.append((heading,fields,height))
    idp=paragraph(identifier,11.5,False)
    group_height=sum(g[2] for g in groups)
    transaction_height=96+max(0,idp.height-15)
    H=321+group_height+transaction_height+70
    c=canvas.Canvas(output,pagesize=(W,H),invariant=1)
    c.setTitle(title+' - gerado pelo Energético')
    c.setAuthor('Energético')
    c.setSubject('Documento para conferência. Não emitido pelo banco.')
    c.setKeywords(VERSION+':'+fingerprint(row))
    def txt(x,y,s,size=15,bold=False,color=ink):
        c.setFillColor(color);c.setFont('ReceiptBold' if bold else 'Receipt',size);c.drawString(x,H-y,str(s))
    def center(y,s,size,bold=True):
        c.setFillColor(ink);c.setFont('ReceiptBold' if bold else 'Receipt',size);c.drawCentredString(W/2,H-y,s)
    def box(x,y,w,h,fill=None,stroke='#DDDFDF',radius=6):
        c.setStrokeColor(HexColor(stroke));c.setLineWidth(.75)
        if fill:c.setFillColor(HexColor(fill))
        c.roundRect(x,H-y-h,w,h,radius,fill=fill is not None,stroke=True)
    def rule(y):
        c.setStrokeColor(HexColor('#BBBBBB'));c.setLineWidth(.65);c.line(48,H-y,392,H-y)
    c.drawImage(str(ASSETS/'sicoob-logo.png'),143,H-59,width=154,height=34.68,mask='auto')
    center(107,title,18 if is_pix else 17)
    value=f'{Decimal(movements.money(row["VALOR"]).replace(",",".")):,.2f}'.replace(',','X').replace('.',',').replace('X','.')
    center(157,'R$ '+value,32);center(187,caption,12)
    box(48,207,344,97,'#F0F9FD','#C6E8F4',5)
    c.setStrokeColor(HexColor('#079ACC'));c.setLineWidth(1.25);c.circle(76,H-236,9,stroke=1,fill=0)
    txt(73.8,242,'i',16,True,HexColor('#079ACC'))
    txt(97,232,'Documento para conferência',13.5,True)
    txt(97,253,'Gerado pelo Energético com dados',12)
    txt(97,272,'consultados no Sicoob.',12)
    txt(97,291,'Não emitido pelo banco.',12)
    box(48,321,344,group_height+transaction_height)
    y=321
    for index,(heading,fields,height) in enumerate(groups):
        if index:rule(y)
        txt(65,y+30,heading,12.5,True);field_y=y+57
        for label,p in fields:
            txt(65,field_y,label,14,False,gray)
            p.drawOn(c,65,H-(field_y+9)-p.height)
            field_y+=30+p.height
        y+=height
    rule(y);box(65,y+17,310,transaction_height-32,'#F1F9FC','#E3EFF2',2)
    txt(77,y+43,identifier_label,14)
    idp.drawOn(c,77,H-(y+51)-idp.height)
    center(H-39,'DOCUMENTO GERADO PELO ENERGÉTICO',8.5)
    center(H-24,'Fonte: Sicoob | Movimento '+str(row['Id']),8,False)
    c.showPage();c.save();return output.getvalue()
