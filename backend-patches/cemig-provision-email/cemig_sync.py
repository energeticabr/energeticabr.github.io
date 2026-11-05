"""Enrich the exact monthly pair for the two configured Cemig consumer units."""
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import argparse
import base64
import html
import json
import os
import re
import sys
import unicodedata

CHILD = 'PROVISÃO PGTOS'
PARENT = 'DESCRITIVOPROVISAO'
QUEUE = 'CEMIG FATURAS FILA'
BRANCH = '004 - EDIFÍCIO XAVANTE'
UNIT = '1317066501899'
MONTHS = 'JAN FEV MAR ABR MAI JUN JUL AGO SET OUT NOV DEZ'.split()
BUSINESS = ('IDRECORRENCIA', 'FILIAL', 'FORNECEDOR', 'DATA', 'DESCRITIVOPROVISAO',
            'VALORTOTAL', 'STATUS', 'PGTOAGENDADO', 'DATAPGTOEFETUADO', 'IDLANCAMENTOS', 'IDPEDIDO')


class Wait(ValueError): pass
class Review(ValueError): pass


@dataclass(frozen=True)
class Profile:
    recurrence: str
    branch: str
    unit: str
    address_tokens: tuple
    numbers: tuple
    room: str = ''


PROFILES=(Profile('33',BRANCH,UNIT,('XAVANTE','ANTONIO TORRES DOS SANTOS'),('130','134')),
          Profile('4','000 - ESCRITÓRIO CENTRAL','1003321701890',
                  ('OSCAR NIEMEYER','VILA DA SERRA'),('1033',),'904'))


def profile_for_unit(unit):
    matches=[p for p in PROFILES if p.unit==unit]
    if len(matches)!=1: raise Review('Instalacao Cemig nao configurada')
    return matches[0]


def normal(value):
    return ''.join(x for x in unicodedata.normalize('NFKD', str(value or '')) if not unicodedata.combining(x)).upper()


def money(value):
    raw = str(value if value not in (None, '') else '0').strip().replace('R$', '').strip()
    if ',' in raw: raw = raw.replace('.', '').replace(',', '.')
    try: result = Decimal(raw)
    except InvalidOperation as exc: raise Review('Valor monetario invalido') from exc
    if not result.is_finite() or result < 0: raise Review('Valor monetario invalido')
    return result.quantize(Decimal('.01'))


@dataclass(frozen=True)
class Bill:
    reference: str
    due: date
    amount: Decimal
    unit: str = UNIT


def address_matches(text,profile):
    return (all(token in text for token in profile.address_tokens)
            and any(re.search(r'\b'+number+r'\b',text) for number in profile.numbers)
            and (not profile.room or bool(re.search(r'\b'+profile.room+r'\b',text))))


def parse_bill_text(text,profile=None):
    text = normal(text)
    units = {re.sub(r'\D', '', x) for x in re.findall(r'\b\d{2}\.\d{3}\.\d{3}\.\d{3}-\d{2}\b', text)}
    if len(units)!=1: raise Review('PDF sem uma unica unidade consumidora')
    detected=profile_for_unit(next(iter(units)))
    if profile is not None and profile!=detected: raise Review('Imovel do PDF difere do email')
    profile=detected
    if 'CEMIG' not in text or not address_matches(text,profile):
        raise Review('PDF nao corresponde ao endereco configurado')
    pattern = r'\b(' + '|'.join(MONTHS) + r')/(20\d{2})\s+(\d{2}/\d{2}/20\d{2})\s+([\d.]+,\d{2})\b'
    matches = set(re.findall(pattern, text))
    if len(matches) != 1: raise Review('Cabecalho da fatura ausente ou ambiguo')
    month, year, due, amount = matches.pop()
    try: due = datetime.strptime(due, '%d/%m/%Y').date()
    except ValueError as exc: raise Review('Vencimento invalido no PDF') from exc
    amount = money(amount)
    if amount <= 0: raise Review('Fatura sem valor positivo')
    return Bill(f'{year}-{MONTHS.index(month)+1:02}', due, amount,profile.unit)


def validate_email(email):
    if str(email.get('from', '')).strip().lower() != 'fatura@cemig.com.br':
        raise Review('Remetente fora do escopo')
    if normal(email.get('subject')).strip() != 'CEMIG FATURA ONLINE':
        raise Review('Assunto fora do escopo')
    body = normal(html.unescape(re.sub(r'<[^>]+>', ' ', str(email.get('body', '')))))
    matches=[p for p in PROFILES if address_matches(body,p)]
    if len(matches)!=1: raise Review('Endereco do email ausente, ambiguo ou fora do escopo')
    return matches[0]


def pdf_password(profile,client=None):
    if profile.recurrence=='33': return '3862'
    if client is None: raise Review('Consulta do documento do titular indisponivel')
    holder=client.get_item_fields(11,['Title','DOCUMENTOFORNECEDOR'],target_list='FORNECEDORES')
    document=re.sub(r'\D','',str(holder.get('DOCUMENTOFORNECEDOR') or ''))
    if normal(holder.get('Title'))!='BERNARDO' or len(document)!=11:
        raise Review('Cadastro do titular da conta do escritorio nao confere')
    return document[:4]


def extract_email(email,password_resolver=None):
    from pypdf import PdfReader
    profile=validate_email(email)
    files, bills, size = [], set(), 0
    for attachment in email.get('attachments') or []:
        name = str(attachment.get('name', ''))
        if attachment.get('isInline') or not name.lower().endswith('.pdf'): continue
        if Path(name).name != name or '/' in name or '\\' in name: raise Review('Nome de PDF invalido')
        try: content = base64.b64decode(attachment.get('contentBytes', ''), validate=True)
        except (ValueError, TypeError) as exc: raise Review('PDF sem conteudo valido') from exc
        size += len(content)
        if not content.startswith(b'%PDF-') or size > 30 * 1024 * 1024: raise Review('PDF invalido ou excessivo')
        try:
            reader = PdfReader(BytesIO(content))
        except Exception as exc: raise Review('Falha ao abrir PDF original') from exc
        # Lookup is a network boundary: timeout/429/503 must reach the queue's RETRY path.
        password=(password_resolver(profile) if password_resolver else pdf_password(profile)) if reader.is_encrypted else None
        try:
            if reader.is_encrypted:
                if not reader.decrypt(password): raise Review('PDF nao pode ser aberto')
            if not 1 <= len(reader.pages) <= 20: raise Review('Quantidade de paginas inesperada')
            text = '\n'.join(page.extract_text() or '' for page in reader.pages)
        except Review: raise
        except Exception as exc: raise Review('Falha ao ler PDF original') from exc
        units = {re.sub(r'\D', '', x) for x in re.findall(r'\b\d{2}\.\d{3}\.\d{3}\.\d{3}-\d{2}\b', text)}
        if units and units != {profile.unit}: raise Review('Outro imovel em PDF do email')
        if re.search(r'\b(?:' + '|'.join(MONTHS) + r')/20\d{2}\s+\d{2}/\d{2}/20\d{2}\s+[\d.]+,\d{2}', normal(text)):
            bills.add(parse_bill_text(text,profile=profile))
        files.append({'filename': name, 'content': content})
    if not files or len(bills) != 1: raise Review('Email sem uma fatura mensal inequivoca')
    return bills.pop(), files


def scoped(row,bill=None):
    profile=profile_for_unit(bill.unit if bill else UNIT)
    return (str(row.get('IDRECORRENCIA')) == profile.recurrence and normal(row.get('FORNECEDOR')) == 'CEMIG'
            and normal(row.get('FILIAL')) == normal(profile.branch))


def choose_target(rows, bill):
    profile=profile_for_unit(bill.unit)
    matches = [r for r in rows if scoped(r,bill) and str(r.get('DATA', ''))[:7] == bill.due.isoformat()[:7]]
    if not matches: raise Wait(f'Aguardando provisao da recorrencia {profile.recurrence} no mes {bill.due:%Y-%m}')
    if len(matches) != 1: raise Review(f'Mais de uma provisao da recorrencia {profile.recurrence} no mesmo mes')
    return matches[0]


def paid(row):
    return (bool(row.get('DATAPGTOEFETUADO')) or bool(row.get('IDLANCAMENTOS'))
            or normal(row.get('STATUS')) in {'PAGO', 'PAGAMENTO EFETUADO'} or normal(row.get('PGTOAGENDADO')) == 'PAGO')


def fingerprint(row): return {k: row.get(k) for k in BUSINESS}


def reconcile(store, bill, files, dry_run=False):
    profile=profile_for_unit(bill.unit)
    selected = choose_target(store.children(), bill)
    child = int(selected['Id'])
    raw_parent = str(selected.get('DESCRITIVOPROVISAO') or '')
    if not re.fullmatch(r'[1-9]\d*', raw_parent): raise Wait('Aguardando descritivo vinculado a provisao')
    parent = int(raw_parent)
    with store.lock(parent):
        row, _ = store.read(CHILD, child)
        head, _ = store.read(PARENT, parent)
        if (not scoped(row,bill) or str(row.get('DESCRITIVOPROVISAO')) != str(parent)
                or str(row.get('DATA',''))[:7] != bill.due.isoformat()[:7]): raise Review('Vinculo ou mes alterado')
        if int(choose_target(store.children(),bill)['Id']) != child: raise Review('Provisao do mes alterada')
        if normal(head.get('FORNECEDOR')) != 'CEMIG' or normal(head.get('FILIAL')) != normal(profile.branch):
            raise Review('Descritivo nao corresponde ao imovel da conta Cemig')
        siblings = [r for r in store.children() if str(r.get('DESCRITIVOPROVISAO')) == str(parent)]
        if len(siblings) != 1 or int(siblings[0]['Id']) != child: raise Review('Descritivo agrupado exige revisao')
        if (paid(row) or paid(head)) and any(money(r.get('VALORTOTAL')) != bill.amount for r in (row, head)):
            raise Review('Valor de registro ja pago difere da fatura; historico preservado')
        before = {CHILD: fingerprint(row), PARENT: fingerprint(head)}
        report = {'child': child, 'parent': parent, 'reference': bill.reference,
                  'due': bill.due.isoformat(), 'amount': str(bill.amount),'unit':bill.unit,
                  'recurrence':profile.recurrence, 'added': 0, 'updated': 0, 'plannedFiles': 0}
        for kind, ident in [(CHILD, child), (PARENT, parent)]:
            existing = {sha256(f['content']).hexdigest() for f in store.attachments(kind, ident)}
            for f in files:
                digest = sha256(f['content']).hexdigest()
                if digest in existing: continue
                # Same deterministic name on both sides; the normal mirror reuses its content hash.
                name = f'CEMIG-{bill.reference}-{digest}.pdf'
                current, _ = store.read(CHILD, child)
                current_head, _ = store.read(PARENT, parent)
                if fingerprint(current) != before[CHILD] or fingerprint(current_head) != before[PARENT]:
                    raise Review('Dados financeiros alterados durante a captura')
                if dry_run: report['plannedFiles'] += 1
                else:
                    store.put(kind, ident, name, f['content'])
                    found = {sha256(a['content']).hexdigest() for a in store.attachments(kind, ident)}
                    if digest not in found: raise RuntimeError('Upload nao confirmado por SHA-256')
                    report['added'] += 1
                existing.add(digest)
        current, child_tag = store.read(CHILD, child)
        current_head, parent_tag = store.read(PARENT, parent)
        if fingerprint(current) != before[CHILD] or fingerprint(current_head) != before[PARENT]:
            raise Review('Registro editado ou pago durante captura; valores preservados')
        changes = [(kind, ident, r, tag) for kind, ident, r, tag in
                   [(PARENT, parent, current_head, parent_tag), (CHILD, child, current, child_tag)]
                   if money(r.get('VALORTOTAL')) != bill.amount]
        if dry_run:
            report['plannedUpdates'] = len(changes)
            return report
        attempted = []
        try:
            for kind, ident, original, tag in changes:
                attempted.append((kind, ident, original))
                store.write(kind, ident, {'VALORTOTAL': format(bill.amount, '.2f').replace('.', ',')}, tag)
                report['updated'] += 1
        except Exception:
            # A timed-out response is not proof that SharePoint rejected the write.
            observed={kind:store.read(kind,ident) for kind,ident in [(CHILD,child),(PARENT,parent)]}
            if all(money(pair[0].get('VALORTOTAL'))==bill.amount for pair in observed.values()):
                report['updated']=len(changes)
            else:
                for kind, ident, original in reversed(attempted):
                    now, tag = observed[kind]
                    if fingerprint(now)==fingerprint(original): continue
                    expected = {**fingerprint(original), 'VALORTOTAL': format(bill.amount, '.2f').replace('.', ',')}
                    if fingerprint(now) != expected: raise Review('Atualizacao parcial com edicao concorrente; revisar valores')
                    store.write(kind, ident, {'VALORTOTAL': original.get('VALORTOTAL')}, tag)
                raise
        for kind, ident in [(CHILD, child), (PARENT, parent)]:
            after, _ = store.read(kind, ident)
            if money(after.get('VALORTOTAL')) != bill.amount: raise RuntimeError('Total nao confirmado apos gravacao')
            if kind == CHILD and (not scoped(after,bill) or str(after.get('DESCRITIVOPROVISAO')) != str(parent)):
                raise Review('Vinculo alterado apos atualizacao')
            if not {sha256(f['content']).hexdigest() for f in files}.issubset(
                    {sha256(f['content']).hexdigest() for f in store.attachments(kind, ident)}):
                raise RuntimeError('Anexo ausente na verificacao final')
        return report


class SharePointAdapter:
    def __init__(self, client):
        from provision_attachment_sync import SharePointStore, parent_lock, STATE_DIR
        self.client, self.api = client, SharePointStore(client)
        self.parent_lock, self.lockdir = parent_lock, STATE_DIR / 'locks'

    def lock(self, parent): return self.parent_lock(self.lockdir, parent)
    def children(self):
        return self.api.collection(self.client._list_endpoint(CHILD)+'/items', {'$top':'5000'})
    def read(self, kind, ident):
        response = self.client._request('GET',self.client._list_endpoint(kind)+f'/items({int(ident)})',_return_response=True)
        payload=response.json(); row=payload.get('d',payload)
        tag=response.headers.get('ETag') or row.get('@odata.etag') or row.get('odata.etag') or row.get('__metadata',{}).get('etag')
        if not tag: raise RuntimeError('ETag ausente')
        return row,tag
    def attachments(self, kind, ident):
        return [{'filename':name,'content':self.api.content(kind,ident,name)} for name in sorted(self.api.names(kind,ident))]
    def put(self, kind, ident, name, content):
        self.client._ensure_attachment_local(ident,name,content,'application/pdf',target_list=kind)
    def write(self, kind, ident, fields, etag):
        self.client.update_item_with_etag(ident,fields,etag,target_list=kind)


def make_client():
    sys.path[:0] = ['/opt/energetica-whatsapp','/opt/energetica-whatsapp/worker']
    from local_app import load_env
    from clients import SharePointClient
    load_env(Path('/etc/energetica-whatsapp.env'))
    return SharePointClient('energeticaltda-my.sharepoint.com','/personal/bernardonotini_energeticabr_com',
        os.environ['ENTRA_TENANT_ID'],os.environ['ENTRA_CLIENT_ID'],
        Path(os.environ['ENTRA_PRIVATE_KEY_FILE']).read_text(),Path(os.environ['ENTRA_CERTIFICATE_FILE']).read_text(),CHILD)


def superseded(rows, bill, received):
    stamp=datetime.fromisoformat(received.replace('Z','+00:00'))
    for row in rows:
        if row.get('State')!='DONE': continue
        try: previous=json.loads(row.get('Result') or '{}')
        except (ValueError,TypeError): continue
        # Results from the original single-property release belong only to Xavante.
        if (previous.get('unit') or UNIT)!=bill.unit: continue
        if previous.get('reference')!=bill.reference or str(previous.get('due',''))[:7]!=bill.due.isoformat()[:7]: continue
        if previous.get('emailReceived') and datetime.fromisoformat(previous['emailReceived'].replace('Z','+00:00'))>stamp:
            return True
    return False


def queue_ready(row,now):
    if row.get('State')=='RECEIVING':
        created=datetime.fromisoformat(row['Created'].replace('Z','+00:00'))
        return now-created>=timedelta(minutes=10)
    return row.get('State') in {'READY','WAITING','RETRY'}


def process_queue(client, dry_run=False, only=None):
    store=SharePointAdapter(client)
    rows=store.api.collection(client._list_endpoint(QUEUE)+'/items',{'$top':'5000'})
    result=[]
    for row in rows:
        ident=int(row['Id'])
        if only and ident != only: continue
        now=datetime.now(timezone.utc)
        if not queue_ready(row,now) and not only: continue
        if not only and row.get('NextTry') and datetime.fromisoformat(row['NextTry'].replace('Z','+00:00')) > now: continue
        status,detail,delay='DONE',{},0
        try:
            envelopes=store.attachments(QUEUE,ident)
            envelope=next((f['content'] for f in envelopes if f['filename']=='mail.json'),None)
            if not envelope: raise Wait('Envelope ainda nao confirmado')
            if len(envelope)>45*1024*1024: raise Review('Envelope excessivo')
            email=json.loads(envelope)
            bill,files=extract_email(email,lambda profile:pdf_password(profile,client))
            received=email.get('receivedDateTime')
            if not received: raise Review('Email sem data de recebimento')
            if superseded(rows,bill,received):
                status,detail='SUPERSEDED',{'reference':bill.reference,'reason':'Email posterior ja aplicado'}
            else:
                detail=reconcile(store,bill,files,dry_run=dry_run)
                detail.update({'emailReceived':received,'mailId':email.get('id')})
        except Wait as exc: status,detail,delay='WAITING',{'reason':str(exc)},900
        except Review as exc: status,detail='REVIEW',{'reason':str(exc)}
        except Exception as exc: status,detail,delay='RETRY',{'reason':type(exc).__name__},300
        if not dry_run:
            current,tag=store.read(QUEUE,ident)
            store.write(QUEUE,ident,{'State':status,'Result':json.dumps(detail,ensure_ascii=False),
                'NextTry':(now+timedelta(seconds=delay)).isoformat() if delay else None},tag)
            row.update({'State':status,'Result':json.dumps(detail,ensure_ascii=False)})
        result.append({'queue':ident,'state':status,**detail})
    return result


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--dry-run',action='store_true');parser.add_argument('--queue',type=int)
    args=parser.parse_args()
    client=make_client()
    import fcntl
    state=Path('/var/lib/energetica-whatsapp/cemig-provisions');state.mkdir(exist_ok=True,parents=True,mode=0o700)
    with (state/'worker.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        results=process_queue(client,args.dry_run,args.queue)
        print(json.dumps({'dryRun':args.dry_run,'results':results},ensure_ascii=False))
        if any(r['state'] in {'RETRY','REVIEW'} for r in results): return 2
    return 0


if __name__=='__main__': sys.exit(main())
