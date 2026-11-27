"""Attach generated conference PDFs only to Sicoob debits from 2026-11-19."""
import argparse
from collections import defaultdict
from contextlib import closing
from datetime import date
from functools import partial
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import re
import sys

from pypdf import PdfReader
import sync_movements as m
import sync_boleto_receipts as boleto_stage
from generated_receipt import IDENTITY, PREFIX, VERSION, fingerprint, render_receipt

FIRST_DAY=date(2026,11,19)
FIELDS=(*IDENTITY,'RAZAOSOCIALRECEBEDOR','DOCUMENTORECEBEDOR')
DATABASE=Path('/var/lib/energetica-sicoob-movements/pix-events/events.sqlite3')


def filename(item_id):return PREFIX+str(int(item_id))+'.pdf'


def eligible(row):
    return (row.get('ORIGEMMOVIMENTACAO')=='SICOOB' and row.get('OPERACAO')=='DÉBITO'
            and m.civil_date(row['DATAPAGAMENTO'])>=FIRST_DAY)


def _same(row,other):
    return all(row.get(k)==other.get(k) for k in FIELDS)


def validate_bank(row,bank):
    for key in IDENTITY:
        if key=='DATAPAGAMENTO':equal=m.civil_date(row[key])==m.civil_date(bank[key])
        elif key=='VALOR':equal=m.money(row[key])==m.money(bank[key])
        else:equal=row.get(key)==bank.get(key)
        if not equal:raise ValueError('Statement identity mismatch')
    bank_document=m.tax_id(bank.get('DOCUMENTORECEBEDOR'))
    if bank_document and m.tax_id(row.get('DOCUMENTORECEBEDOR'))!=bank_document:raise ValueError('Statement receiver mismatch')
    bank_name=m.text(bank.get('RAZAOSOCIALRECEBEDOR'))
    if bank_name.upper() not in ('','N/A') and m.bank_label(bank_name)!=m.bank_label(row.get('RAZAOSOCIALRECEBEDOR')):
        if not bank_document or bank_document!=m.tax_id(row.get('DOCUMENTORECEBEDOR')):raise ValueError('Statement receiver name mismatch')


def pdf_fingerprint(content,item):
    pdf=PdfReader(BytesIO(content))
    metadata=pdf.metadata or {}
    if len(pdf.pages)!=1 or metadata.get('/Author')!='Energético':
        raise ValueError('Generated PDF identity mismatch')
    text=pdf.pages[0].extract_text()
    footer=f'Fonte: Sicoob | Movimento {item}'
    if 'Não emitido pelo banco' not in text or not any(line.strip()==footer for line in text.splitlines()):
        raise ValueError('Generated PDF identity mismatch')
    return metadata.get('/Keywords')


def valid_existing(content,row):
    if pdf_fingerprint(content,row['Id'])!=VERSION+':'+fingerprint(row):
        raise ValueError('Generated PDF identity mismatch')


def needs_receiver_refresh(content,row):
    saved=pdf_fingerprint(content,row['Id'])
    if saved==VERSION+':'+fingerprint(row):return False
    name=row.get('RAZAOSOCIALRECEBEDOR')
    document=row.get('DOCUMENTORECEBEDOR')
    unknown=(None,'',m.UNKNOWN)
    names=(name,*unknown) if m.text(name).upper() not in ('',m.UNKNOWN) else (name,)
    documents=(document,*unknown) if m.tax_id(document) else (document,)
    for old_name in names:
        for old_document in documents:
            previous={**row,'RAZAOSOCIALRECEBEDOR':old_name,'DOCUMENTORECEBEDOR':old_document}
            if saved==VERSION+':'+fingerprint(previous):return True
    raise ValueError('Generated PDF identity mismatch')


def generated_attachments(client,item,name):
    return [f['content'] for f in client.get_item_attachments(item,m.LIST) if f['filename']==name]


def refresh_attachment(client,row,name,previous,content):
    item=row['Id']
    endpoint=f"{client._list_endpoint(m.LIST)}/items({int(item)})/AttachmentFiles('{name}')"
    file_url=client._request('GET',endpoint)['ServerRelativeUrl'].replace("'","''")
    file_endpoint=f"web/GetFileByServerRelativeUrl('{file_url}')"
    etag=client._request('GET',file_endpoint,params={'$select':'ETag'}).get('ETag')
    if not etag or etag=='*' or generated_attachments(client,item,name)!=[previous]:
        raise ValueError('Generated attachment changed before refresh')
    if not _same(row,client.get_item_fields(item,FIELDS,m.LIST)):
        raise ValueError('Movement changed during PDF rendering')
    client._request('POST',endpoint+'/$value',data=content,headers={
        'Content-Type':'application/pdf','X-HTTP-Method':'PUT','If-Match':etag,
    })


def reconcile(client,rows,bank_rows=(),payer=None,*,pix_details=None,boleto_details=None,
              load_context=None,check=False,output_dir=None):
    result={'eligible':0,'attached':0,'already_attached':0,'failed':0}
    pending=[]

    def record_failure(row,error):
        print(json.dumps({'stage':'generated-pdf','item':row['Id'],'errorType':type(error).__name__}),file=sys.stderr)
        result['failed']+=1

    for row in rows:
        if not eligible(row):continue
        result['eligible']+=1
        try:
            item=row['Id'];name=filename(item)
            fresh=client.get_item_fields(item,FIELDS,m.LIST)
            if not _same(row,fresh):raise ValueError('Movement changed before attachment')
            existing=generated_attachments(client,item,name)
            if existing:
                if len(existing)!=1:raise ValueError('Duplicate generated attachment')
                if not needs_receiver_refresh(existing[0],row):
                    result['already_attached']+=1;continue
            pending.append((row,existing[0] if existing else None))
        except Exception as error:
            record_failure(row,error)

    if pending and load_context:
        bank_rows,payer,pix_details,boleto_details=load_context([row for row,_ in pending])
    by_key=defaultdict(list)
    for bank in bank_rows:by_key[bank[m.KEY]].append(bank)
    for row,previous in pending:
        try:
            item=row['Id'];name=filename(item)
            candidates=by_key[row[m.KEY]]
            if len(candidates)!=1:raise ValueError('No unique statement entry')
            validate_bank(row,candidates[0])
            if m.text(payer.get('conta')).lstrip('0')!=m.text(row['CONTAPAGADORA']).lstrip('0'):raise ValueError('Payer account mismatch')
            content=render_receipt(row,payer,pix=(pix_details or {}).get(item),boleto=(boleto_details or {}).get(item))
            valid_existing(content,row)
            if output_dir:
                output_dir.mkdir(parents=True,exist_ok=True);(output_dir/name).write_bytes(content)
            if check:
                # Planning counts are never parsed as a successful published stage.
                result['attached']+=1;continue
            try:
                if previous is None:
                    if not _same(row,client.get_item_fields(item,FIELDS,m.LIST)):
                        raise ValueError('Movement changed during PDF rendering')
                    client.ensure_attachment(item,name,content,'application/pdf',target_list=m.LIST)
                else:
                    refresh_attachment(client,row,name,previous,content)
            except Exception:
                # Upload may have been accepted despite an uncertain response.
                if generated_attachments(client,item,name)!=[content]:raise
            if generated_attachments(client,item,name)!=[content]:raise ValueError('Generated attachment readback mismatch')
            if not _same(row,client.get_item_fields(item,FIELDS,m.LIST)):raise ValueError('Movement changed after attachment')
            result['attached']+=1
        except Exception as error:
            record_failure(row,error)
    return result


def choose_pix_details(rows,answers,payer,claims,pending_ids=()):
    import sync_pix_receivers as p
    universe=[r for r in rows if r.get('ORIGEMMOVIMENTACAO')=='SICOOB'
              and r.get('OPERACAO')=='DÉBITO' and re.search(r'\bPIX\b',m.bank_label(r['DESCRICAO']))]
    matches={}
    for row in universe:
        if not eligible(row):continue
        direct=p.direct_ids(row)
        options={eid:None for eid in (direct or dict.fromkeys((*answers,*pending_ids)))}
        match=p.bank_match(row,options,answers,universe,payer,claims=claims)
        if match:matches[row['Id']]=match[0]
    return matches


def unique_boleto_references(rows):
    grouped=defaultdict(list)
    for row in rows:
        reference=boleto_stage.receipt_candidate(row)
        if reference and not re.search(r'TRANSF|TRANSFER',m.bank_label(row['DESCRICAO'])):grouped[reference].append(row)
    return {reference:items[0] for reference,items in grouped.items() if len(items)==1}


def bank_context(account,rows):
    """Use immutable authenticated answers, never notification payload names."""
    import sync_pix_receivers as p
    if not DATABASE.exists():raise ValueError('Authenticated payer context unavailable')
    with closing(sqlite3.connect('file:'+str(DATABASE)+'?mode=ro',uri=True)) as db:
        raw=db.execute('SELECT id,payer,answer FROM bank_answers WHERE account=?',(account,)).fetchall()
        pending_ids=[record[0] for record in db.execute('SELECT id FROM events WHERE completed_at IS NULL')]
        claims=defaultdict(set)
        for item,eid in db.execute('SELECT movement_id,id FROM events WHERE completed_at IS NOT NULL'):claims[item].add(eid)
    origins={};answers={}
    for eid,payer,encoded in raw:
        details=p.payment_details(json.loads(encoded),eid)
        if not details:continue
        pix,canonical=details;origin=pix.get('origem') or {}
        if (m.tax_id(origin.get('cpfCnpj'))!=payer or m.text(origin.get('conta')).lstrip('0')!=account.lstrip('0')):continue
        identity=tuple(m.text(origin.get(k)) for k in ('cpfCnpj','conta','agencia','ispb','nome'))
        origins[identity]=origin;answers[eid]=json.loads(encoded)
    if len(origins)!=1:raise ValueError('Payer context is absent or ambiguous')
    payer=next(iter(origins.values()))
    return payer,choose_pix_details(rows,answers,m.tax_id(payer['cpfCnpj']),claims,pending_ids)


def load_bank_context(rows,pending):
    first=min(m.civil_date(r['DATAPAGAMENTO']) for r in pending)
    last=max(m.civil_date(r['DATAPAGAMENTO']) for r in pending)
    if last>m.datetime.now(m.ZONE).date():raise ValueError('Future bank date')
    account,statements=m.read_bank(first,last)
    bank=[]
    for (start,end),statement in statements.items():bank.extend(m.payment_rows(statement,start,end,account,{}))
    payer,pix=bank_context(account,rows)
    pending_ids={r['Id'] for r in pending}
    references={reference:row for reference,row in unique_boleto_references(rows).items() if row['Id'] in pending_ids}
    receipts={}
    if references:
        answers=boleto_stage.read_receipts(account,list(references))
        for reference,row in references.items():
            response=answers.get(reference,{})
            if response.get('status')==200 and boleto_stage.receipt_matches(row,response.get('receipt')):
                receipts[row['Id']]=response['receipt']
    return bank,payer,pix,receipts


def run(check=False,output_dir=None):
    client=m.sharepoint_client();m.assert_destination(client)
    rows=list(boleto_stage.list_movements(client))
    return reconcile(client,rows,load_context=partial(load_bank_context,rows),check=check,output_dir=output_dir)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');parser.add_argument('--output-dir',type=Path)
    args=parser.parse_args()
    try:
        counts=run(args.check,args.output_dir)
        print(json.dumps(counts),flush=True)
        raise SystemExit(1 if counts['failed'] else 0)
    except Exception as error:
        parser.exit(1,'SICOOB_GENERATED_PDF_FAILED ('+type(error).__name__+')\n')
