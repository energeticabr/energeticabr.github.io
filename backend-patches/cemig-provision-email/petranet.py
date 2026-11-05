"""Validate Petranet's email summary against its original Sicoob PDF."""
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
import html
import re
import unicodedata

SENDER='boleto@grupopetranet.com.br'
SUBJECT='Boleto da Petranet internet'
CUSTOMER='11721'
UNIT='PETRANET-'+CUSTOMER
HOLDER='BERNARDO NOTINI MOREIRA BAHIA'
BENEFICIARY='60.777.188/0001-00'
BENEFICIARIES=(('PETRANET INTERNET CPRNET LP LTDA',BENEFICIARY),
               ('PETRANET INTERNET LP SERVICOS E INSTALACOES LTDA','57.145.714/0001-05'))
LINE=r'\b\d{5}\.\d{5}\s+\d{5}\.\d{6}\s+\d{5}\.\d{6}\s+\d\s+\d{14}\b'


def clean(text):
    text=html.unescape(re.sub(r'<[^>]+>',' ',str(text or '')))
    text=''.join(x for x in unicodedata.normalize('NFKD',text) if not unicodedata.combining(x))
    return re.sub(r'\s+',' ',text).strip().upper()


def one(pattern,text):
    found=set(re.findall(pattern,text))
    if len(found)!=1:raise ValueError('Dados da fatura Petranet ausentes ou ambiguos')
    return found.pop()


def bank_line(text):
    lines={re.sub(r'\D','',x) for x in re.findall(LINE,text)}
    if len(lines)!=1:raise ValueError('Linha digitavel Petranet ausente ou ambigua')
    return lines.pop()


@dataclass(frozen=True)
class Invoice:
    number: str
    reference: str
    due: date
    amount: Decimal
    line: str


def parse_email(body):
    text=clean(body)
    if 'LEMBRETE DA CONTA PETRANET' not in text or not re.search(r'OLA,\s*'+HOLDER+r'\b',text):
        raise ValueError('Titular ou mensagem Petranet fora do escopo')
    number=one(r'NUMERO DA FATURA:\s*(\d+)\b',text)
    month,year=one(r'MES DE REFERENCIA:\s*(\d{2})/(20\d{2})\b',text)
    date(int(year),int(month),1)
    due=datetime.strptime(one(r'DATA DE VENCIMENTO:\s*(\d{2}/\d{2}/20\d{2})\b',text),'%d/%m/%Y').date()
    amount=Decimal(one(r'\bVALOR:\s*R\$\s*([\d.]+,\d{2})\b',text).replace('.','').replace(',','.'))
    line=bank_line(text)
    if amount<=0 or Decimal(line[-10:])/100!=amount:
        raise ValueError('Total da fatura Petranet difere da linha digitavel')
    return Invoice(number,f'{year}-{month}',due,amount,line)


def validate_pdf(text,invoice):
    text=clean(text)
    beneficiaries={document for name,document in BENEFICIARIES if name in text and document in text}
    if (len(beneficiaries)!=1 or set(re.findall(r'\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b',text))!=beneficiaries
            or not all(token in text for token in ['ANTONIO TORRES DOS SANTOS','XAVANTE'])
            or not re.search(r'ANTONIO TORRES DOS SANTOS\s+134\b',text)
            or set(re.findall(r'\bPAGADOR\s+(\d+)\s*-\s*[A-Z]',text))!={CUSTOMER}
            or not re.search(r'\bPAGADOR\s+'+CUSTOMER+r'\s*-\s*'+HOLDER+r'\b',text)):
        raise ValueError('Boleto Petranet nao corresponde ao cliente e endereco configurados')
    due,amount=one(re.escape(next(iter(beneficiaries)))+r'\s+(\d{2}/\d{2}/20\d{2})\s+R\$\s*([\d.]+,\d{2})\b',text)
    if (datetime.strptime(due,'%d/%m/%Y').date()!=invoice.due
            or Decimal(amount.replace('.','').replace(',','.'))!=invoice.amount
            or bank_line(text)!=invoice.line
            or not re.search(r'\b0*'+re.escape(invoice.number)+r'-\d\b',text)):
        raise ValueError('Boleto Petranet difere dos dados do email')
