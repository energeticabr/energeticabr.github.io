"""Original Asaas PDFs -> exact accounting provisions. No financial field writes."""
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from hashlib import sha256
from html import unescape
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit, urljoin
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

from cemig_sync import CHILD, PARENT, Review, Wait, normal, money, SharePointAdapter, make_client

SUPPLIER='CONTABILIDADE SILVA NOVAIS'
BRANCH='004 - EDIFÍCIO XAVANTE'
COMPANY='ENERGETICA CONSTRUCOES LTDA'
PAYER='38626750000146'
ISSUER='14647910000175'
BILL_SENDER='cobrancas+6564259@asaas.com'
NF_SENDER='nao-responda@asaas.com.br'
NF_SUBJECT='Nota Fiscal Eletrônica de CONTABILIDADE SILVA NOVAIS LTDA'
QUEUE='CONTABILIDADE SILVA NOVAIS FILA'
STATE=Path('/var/lib/energetica-whatsapp/silva-novais')
BUSINESS=('IDRECORRENCIA','FILIAL','FORNECEDOR','PRODUTO','DATA','DATAPREVISTOPGTO',
          'DESCRITIVOPROVISAO','VALORTOTAL','STATUS','PGTOAGENDADO','DATAPGTOEFETUADO',
          'IDLANCAMENTOS','IDPEDIDO','FORMAPGTO','QTD','OBS','FRETE','APROVACAO','IMOVEL')

class Html(HTMLParser):
    def __init__(self,text):
        super().__init__();self.text=[];self.links=[];self.current=None;self.feed(text)
    def handle_starttag(self,tag,attrs):
        if tag=='a':self.current=[dict(attrs).get('href',''),[]]
        if tag in ('p','br','div','td','tr','h1','h2','h3'):self.text.append(' ')
    def handle_endtag(self,tag):
        if tag=='a' and self.current:
            self.links.append((' '.join(self.current[1]),unescape(self.current[0])));self.current=None
        self.text.append(' ')
    def handle_data(self,data):
        self.text.append(data)
        if self.current:self.current[1].append(data)

def text_and_links(body):
    parsed=Html(str(body or ''))
    links=parsed.links+[(re.sub(r'\s+',' ',label),unescape(url)) for label,url in re.findall(r'\[([^\]]+)\]\((https?://[^)]+)\)',str(body),re.S)]
    return re.sub(r'\s+',' ',unescape(' '.join(parsed.text))),links

def validate_url(url):
    p=urlsplit(url)
    if p.scheme!='https' or p.username or p.password or p.port not in (None,443) or p.fragment:
        raise Review('Link do Asaas invalido')
    public=p.hostname in ('www.asaas.com','asaas.com') and bool(re.fullmatch(r'/(?:i/[A-Za-z0-9]+|b/pdf/[A-Za-z0-9]+|(?:000/)?file/public/download/[A-Za-z0-9]+)',p.path))
    tracking=bool(re.fullmatch(r'url[0-9]+\.asaas\.com(?:\.br)?',p.hostname or '')) and p.path=='/ls/click'
    if not (public or tracking):raise Review('Link fora dos downloads publicos permitidos do Asaas')
    return url

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class Downloads:
    def __init__(self,root):self.root=Path(root);self.root.mkdir(mode=0o700,parents=True,exist_ok=True);self.opener=urllib.request.build_opener(NoRedirect)
    def fetch(self,url):
        for redirect in range(6):
            validate_url(url)
            for attempt in range(3):
                try:
                    req=urllib.request.Request(url,headers={'User-Agent':'Energetica-AccountingDocuments/1.0'})
                    with self.opener.open(req,timeout=30) as response:
                        size=int(response.headers.get('Content-Length') or 0)
                        if size>20*1024*1024:raise Review('Documento excede 20 MB')
                        data=response.read(20*1024*1024+1)
                        if len(data)>20*1024*1024:raise Review('Documento excede 20 MB')
                        return url,data
                except urllib.error.HTTPError as exc:
                    if exc.code in (301,302,303,307,308):url=urljoin(url,exc.headers['Location']);break
                    if exc.code not in (408,429,500,502,503,504) or attempt==2:raise
                    time.sleep(2*(attempt+1))
                except (TimeoutError,urllib.error.URLError):
                    if attempt==2:raise
                    time.sleep(2*(attempt+1))
            else:continue
        raise Review('Redirecionamentos excessivos no Asaas')
    def resolve(self,url):return self.fetch(url)[0]
    def pdf(self,charge,kind,url):
        if not re.fullmatch(r'[A-Za-z0-9]{8,64}',charge) or kind not in ('nfse','boleto'):raise Review('Identidade de documento invalida')
        path=self.root/(charge+'-'+kind+'.pdf');meta=path.with_suffix('.json')
        if path.exists() and meta.exists():
            data=path.read_bytes()
            if json.loads(meta.read_text())['sha256']!=sha256(data).hexdigest():raise Review('Cache original nao confere')
            return data
        _,data=self.fetch(url)
        if not data.startswith(b'%PDF-'):raise Review('O Asaas nao retornou um PDF original')
        # Cache once: Asaas may regenerate the boleto's document date on each GET.
        atomic(meta,json.dumps({'sha256':sha256(data).hexdigest()}).encode())
        atomic(path,data)
        return data

def atomic(path,data):
    path=Path(path);path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.tmp')
    with temp.open('wb') as stream:os.chmod(temp,0o600);stream.write(data);stream.flush();os.fsync(stream.fileno())
    os.replace(temp,path)

@dataclass(frozen=True)
class Source:
    kind:str
    charge:str
    amount:Decimal
    due:object=None
    pdf_url:str=''
    mail_id:str=''

def parse_email(email,resolver=None):
    sender=email.get('from') or email.get('sender') or ''
    if isinstance(sender,dict):sender=sender.get('emailAddress',{}).get('address','')
    sender=str(sender).strip().lower()
    if sender not in (BILL_SENDER,NF_SENDER):raise Review('Remetente fora do escopo Silva Novais')
    raw=email.get('body','')
    if isinstance(raw,dict):raw=raw.get('content','')
    body,links=text_and_links(raw);text=normal(body)
    if (not re.search(r'OLA\s*,\s*ENERGETICA CONSTRUCOES LTDA\b',text)
            or 'NB PARTICIPACOES' in text or SUPPLIER not in text
            or ISSUER not in re.sub(r'\D','',text)):
        raise Review('Email nao corresponde exclusivamente a Energetica e Silva Novais')
    values={money(x) for x in re.findall(r'R\$\s*([\d.,]+)',body)}
    if len(values)!=1 or next(iter(values))<=0:raise Review('Valor do email ausente ou ambiguo')
    kind='nfse' if sender==NF_SENDER else 'boleto'
    if kind=='nfse' and normal(email.get('subject'))!=normal(NF_SUBJECT):raise Review('Assunto fiscal fora do escopo')
    charge_urls=[url for label,url in links if normal(label).strip() in ('COBRANCA','VISUALIZAR COBRANCA')]
    direct=re.findall(r'https://(?:www\.)?asaas\.com/i/([A-Za-z0-9]+)',str(raw))
    if not direct and charge_urls and resolver:
        direct=[re.search(r'/i/([A-Za-z0-9]+)',resolver(charge_urls[0])).group(1)]
    if len(set(direct))!=1:raise Review('Cobranca do email ausente ou ambigua')
    charge=direct[0]
    dates=set(re.findall(r'VENCE(?:U)? EM\s+(\d{2}/\d{2}/\d{4})',text))
    if len(dates)>1:raise Review('Vencimento do email ambiguo')
    due=datetime.strptime(next(iter(dates)),'%d/%m/%Y').date() if dates else None
    fiscal=[u for label,u in links if normal(label).strip()=='VISUALIZAR NOTA FISCAL']
    if kind=='nfse' and len(set(fiscal))!=1:raise Review('Link da NFS-e ausente ou ambiguo')
    pdf_url=fiscal[0] if kind=='nfse' else 'https://www.asaas.com/b/pdf/'+charge
    validate_url(pdf_url)
    return Source(kind,charge,next(iter(values)),due,pdf_url,str(email.get('id') or ''))

def pdf_text(content):
    from pypdf import PdfReader
    if not content.startswith(b'%PDF-') or len(content)>20*1024*1024:raise Review('PDF original invalido')
    try:
        reader=PdfReader(BytesIO(content))
        if reader.is_encrypted or not 1<=len(reader.pages)<=10:raise Review('PDF criptografado ou numero de paginas inesperado')
        return '\n'.join(page.extract_text() or '' for page in reader.pages)
    except Review:raise
    except Exception as exc:raise Review('PDF original nao pode ser lido') from exc

def document_identity(content):
    try:text=normal(pdf_text(content))
    except Review:return None
    digits=re.sub(r'\D','',text)
    if PAYER not in digits or ISSUER not in digits or COMPANY not in text:return None
    ids=set(re.findall(r'ASAAS\.COM/I/([A-Z0-9]+)',text))
    if re.search(r'NFS.?E|NOTA FISCAL',text):
        key=re.search(r'CHAVE DE ACESSO DA NFS-E\s+(\d{40,60})',text)
        if key:return 'nfse','key:'+key.group(1)
        number=re.search(r'NUMERO (?:DA )?(?:NFS.?E|NOTA(?: FISCAL)?)\s*[:\-]?\s*(\d+)',text)
        if number:return 'nfse','number:'+number.group(1)
        if len(ids)==1:return 'nfse','charge:'+next(iter(ids)).lower()
    if 'LINHA DIGIT' in text and len(ids)==1:return 'boleto','charge:'+next(iter(ids)).lower()
    return None

@dataclass(frozen=True)
class Document:
    kind:str
    charge:str
    content:bytes
    identity:str

def validate_document(content,source,due=None):
    text=normal(pdf_text(content));digits=re.sub(r'\D','',text)
    if PAYER not in digits or ISSUER not in digits or COMPANY not in text or 'NB PARTICIPACOES' in text:
        raise Review('CNPJ do tomador ou do fornecedor nao corresponde')
    ids={x.lower() for x in re.findall(r'ASAAS\.COM/I/([A-Z0-9]+)',text)}
    if ids!={source.charge.lower()}:raise Review('PDF pertence a outra cobranca')
    values={money(x) for x in re.findall(r'R\$\s*([\d.,]+)',text)}
    if values!={source.amount}:raise Review('Valor do PDF difere do email/provisao')
    identity=document_identity(content)
    if not identity or identity[0]!=source.kind:raise Review('Tipo ou identidade do PDF nao confirmado')
    if source.kind=='boleto':
        dates={datetime.strptime(x,'%d/%m/%Y').date() for x in re.findall(r'(?:DATA DE )?VENCIMENTO\s+(\d{2}/\d{2}/\d{4})',text)}
        if dates!={due}:raise Review('Vencimento do boleto difere da provisao')
    return Document(source.kind,source.charge,content,identity[1])

def parse_checkout(body,charge,amount):
    plain,_=text_and_links(body);text=normal(plain)
    if COMPANY not in text or SUPPLIER not in text or ISSUER not in re.sub(r'\D','',text):raise Review('Pagina de cobranca nao corresponde a Energetica')
    values={money(x) for x in re.findall(r'R\$\s*([\d.,]+)',plain)}
    if values!={amount}:raise Review('Valor do checkout difere da nota/email')
    match=re.search(r'<atlas-card\b[^>]*header=["\']Data de vencimento["\'][^>]*>(.*?)</atlas-card>',body,re.S|re.I)
    dates=re.findall(r'\d{2}/\d{2}/\d{4}',text_and_links(match.group(1))[0]) if match else []
    if len(set(dates))!=1:raise Review('Vencimento do checkout ausente ou ambiguo')
    due=datetime.strptime(dates[0],'%d/%m/%Y').date()
    return due,('PAGAMENTO EFETUADO EM' in text or 'O PAGAMENTO DESTA FATURA JA FOI EFETUADO' in text)

def validate_checkout_url(url,charge):
    validate_url(url)
    if urlsplit(url).path!='/i/'+charge:raise Review('Checkout redirecionou para outra cobranca')

def existing_boleto(files,source,due):
    for f in files:
        if f['content'].startswith(b'%PDF-') and document_identity(f['content'])==('boleto','charge:'+source.charge):
            return validate_document(f['content'],source,due)
    return None

def download_boleto(downloads,source,due,paid_remote):
    try:content=downloads.pdf(source.charge,'boleto','https://www.asaas.com/b/pdf/'+source.charge)
    except urllib.error.HTTPError as exc:
        if not paid_remote:raise
        return None,{'httpStatus':exc.code,'reason':'Asaas informa cobranca paga; o download do boleto nao foi disponibilizado nesta tentativa'}
    return validate_document(content,source,due),None

def choose_target(rows,due,amount):
    matches=[r for r in rows if str(r.get('IDRECORRENCIA'))=='28'
             and normal(r.get('FORNECEDOR'))==SUPPLIER and normal(r.get('FILIAL'))==normal(BRANCH)
             and normal(r.get('PRODUTO'))=='CONTABILIDADE'
             and str(r.get('DATA',''))[:10]==due.isoformat()
             and (not r.get('DATAPREVISTOPGTO') or str(r['DATAPREVISTOPGTO'])[:10]==due.isoformat())
             and money(r.get('VALORTOTAL'))==amount]
    if not matches:raise Wait('Provisao exata ainda nao encontrada para o vencimento '+due.isoformat())
    if len(matches)!=1:raise Review('Mais de uma provisao para o mesmo vencimento')
    return matches[0]

def fingerprint(row):return {k:row.get(k) for k in BUSINESS}

def backup(store,targets,root):
    for kind,ident in targets:
        folder=Path(root)/('child-' if kind==CHILD else 'parent-')/str(ident)
        if (folder/'record.json').exists():continue
        row,_=store.read(kind,ident)
        atomic(folder/'record.json',json.dumps(row,ensure_ascii=False,default=str).encode())
        for f in store.attachments(kind,ident):atomic(folder/(sha256(f['content']).hexdigest()+'.bin'),f['content'])

def attach_documents(store,due,amount,documents,dry_run=False,identity_reader=document_identity,backup_root=None):
    selected=choose_target(store.children(),due,amount);child=int(selected['Id'])
    raw=str(selected.get('DESCRITIVOPROVISAO') or '')
    if raw and not re.fullmatch(r'[1-9]\d*',raw):raise Review('Vinculo de descritivo invalido')
    parent=int(raw) if raw else None
    targets=[(CHILD,child)]+([(PARENT,parent)] if parent else [])
    with store.lock(parent or child):
        current=choose_target(store.children(),due,amount)
        if int(current['Id'])!=child or str(current.get('DESCRITIVOPROVISAO') or '')!=raw:raise Review('Vinculo alterado durante captura')
        before={}
        for kind,ident in targets:
            row,_=store.read(kind,ident)
            if kind==PARENT:
                if (normal(row.get('FORNECEDOR'))!=SUPPLIER or normal(row.get('FILIAL'))!=normal(BRANCH)
                        or money(row.get('VALORTOTAL'))!=amount or str(row.get('DATAPREVISTOPGTO',''))[:10]!=due.isoformat()):
                    raise Review('Descritivo diverge da provisao mensal')
                siblings=[r for r in store.children() if str(r.get('DESCRITIVOPROVISAO'))==str(parent)]
                if len(siblings)!=1 or int(siblings[0]['Id'])!=child:raise Review('Descritivo compartilhado exige revisao')
            before[(kind,ident)]=fingerprint(row)
        if not dry_run and backup_root:backup(store,targets,backup_root)
        report={'child':child,'parent':parent,'due':due.isoformat(),'amount':str(amount),'added':0,'planned':0,'existing':0}
        for kind,ident in targets:
            existing=store.attachments(kind,ident)
            hashes={sha256(f['content']).hexdigest() for f in existing}
            identities={identity_reader(f['content']) for f in existing if f['content'].startswith(b'%PDF-')}
            for doc in documents:
                digest=sha256(doc.content).hexdigest()
                if digest in hashes or (doc.kind,doc.identity) in identities:report['existing']+=1;continue
                for key,expected in before.items():
                    row,_=store.read(*key)
                    if fingerprint(row)!=expected:raise Review('Dados financeiros alterados durante captura')
                name=f'SILVA-NOVAIS-{doc.kind.upper()}-{due.isoformat()}-{doc.charge}.pdf'
                if kind==PARENT:name=f'PROV-{child}-{digest}-{name}'
                if dry_run:report['planned']+=1
                else:
                    store.put(kind,ident,name,doc.content)
                    confirmed=store.attachments(kind,ident)
                    if digest not in {sha256(f['content']).hexdigest() for f in confirmed}:raise RuntimeError('PDF nao confirmado por SHA-256')
                    report['added']+=1
                hashes.add(digest);identities.add((doc.kind,doc.identity))
        for key,expected in before.items():
            row,_=store.read(*key)
            if fingerprint(row)!=expected:raise Review('Dados financeiros mudaram; revisar concorrencia')
        return report

def process(client,root=STATE,dry_run=False):
    store=SharePointAdapter(client);downloads=Downloads(Path(root)/'originals')
    queue=store.api.collection(client._list_endpoint(QUEUE)+'/items',{'$top':'5000'})
    groups={};errors=[]
    for row in queue:
        try:
            envelope=next(f['content'] for f in store.attachments(QUEUE,int(row['Id'])) if f['filename']=='mail.json')
            source=parse_email(json.loads(envelope),downloads.resolve)
            groups.setdefault(source.charge,[]).append((source,row))
        except Exception as exc:errors.append({'queue':row['Id'],'state':'REVIEW' if isinstance(exc,Review) else 'RETRY','reason':str(exc) if isinstance(exc,Review) else type(exc).__name__})
    reports=[]
    for charge,entries in groups.items():
        report={'charge':charge,'state':'DONE','added':0}
        try:
            amounts={s.amount for s,r in entries}
            if len(amounts)!=1:raise Review('Emails da mesma cobranca divergem em valor')
            amount=next(iter(amounts))
            final,page=downloads.fetch('https://www.asaas.com/i/'+charge)
            validate_checkout_url(final,charge)
            due,remote_paid=parse_checkout(page.decode('utf8'),charge,amount)
            if any(s.due and s.due!=due for s,r in entries):raise Review('Vencimento do email difere do checkout')
            selected=choose_target(store.children(),due,amount)
            documents=[]
            fiscal={s.pdf_url:s for s,r in entries if s.kind=='nfse'}
            if not fiscal:raise Wait('Aguardando email da nota fiscal da mesma cobranca')
            for source in fiscal.values():documents.append(validate_document(downloads.pdf(charge,'nfse',source.pdf_url),source))
            existing=store.attachments(CHILD,int(selected['Id']))
            source=Source('boleto',charge,amount,due,'https://www.asaas.com/b/pdf/'+charge)
            boleto=existing_boleto(existing,source,due)
            unavailable=None
            if boleto is None:boleto,unavailable=download_boleto(downloads,source,due,remote_paid)
            if boleto is not None:documents.append(boleto)
            report.update(attach_documents(store,due,amount,documents,dry_run=dry_run,backup_root=Path(root)/'before-attachments'))
            report['invoice']=True;report['boleto']=boleto is not None
            if not report['boleto']:
                report.update(state='BOLETO_INDISPONIVEL_QUITADO',**unavailable)
        except Wait as exc:report.update(state='WAITING',reason=str(exc))
        except Review as exc:report.update(state='REVIEW',reason=str(exc))
        except Exception as exc:report.update(state='RETRY',reason=type(exc).__name__)
        if not dry_run:
            for source,row in entries:
                fields={'State':report['state'],'Result':json.dumps(report,ensure_ascii=False)}
                current,etag=store.read(QUEUE,int(row['Id']))
                if any(current.get(k)!=v for k,v in fields.items()):store.write(QUEUE,int(row['Id']),fields,etag)
        reports.append(report)
    return reports+errors

def seed(client,path):
    store=SharePointAdapter(client);rows=store.api.collection(client._list_endpoint(QUEUE)+'/items',{'$top':'5000'})
    known={r.get('MailId'):r for r in rows};count=0
    for email in json.loads(Path(path).read_text(encoding='utf8')):
        raw=email.get('body',{});body=raw.get('content','') if isinstance(raw,dict) else raw
        sender=email.get('sender',{}).get('emailAddress',{}).get('address') or email.get('from')
        data={**email,'body':body,'from':sender}
        if not re.search(r'OLA\s*,\s*ENERGETICA CONSTRUCOES LTDA',normal(text_and_links(body)[0])):continue
        existing=known.get(email['id'])
        if existing is None:
            created=client._request('POST',client._list_endpoint(QUEUE)+'/items',json={'Title':'ASAAS '+email['receivedDateTime'],'MailId':email['id'],'EmailReceived':email['receivedDateTime'],'State':'RECEIVING'})
            existing=created.get('d',created);known[email['id']]=existing
        ident=int(existing['Id'])
        if 'mail.json' not in store.api.names(QUEUE,ident):
            client._ensure_attachment_local(ident,'mail.json',json.dumps(data,ensure_ascii=False).encode('utf8'),'application/json',target_list=QUEUE)
            current,tag=store.read(QUEUE,ident);store.write(QUEUE,ident,{'State':'READY'},tag);count+=1
    return count

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--dry-run',action='store_true');parser.add_argument('--seed');args=parser.parse_args()
    STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    import fcntl
    with (STATE/'worker.lock').open('a+b') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        client=make_client()
        if args.seed:print(json.dumps({'seeded':seed(client,args.seed)}));return 0
        reports=process(client,dry_run=args.dry_run)
        result={'dryRun':args.dry_run,'results':reports}
        atomic(STATE/('last-dry-run.json' if args.dry_run else 'last-result.json'),json.dumps(result,ensure_ascii=False).encode('utf8'))
        print(json.dumps(result,ensure_ascii=False))
        return 2 if any(r['state'] in ('RETRY','REVIEW') for r in reports) else 0

if __name__=='__main__':sys.exit(main())
