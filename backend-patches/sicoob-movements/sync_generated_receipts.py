"""Attach generated conference PDFs only to Sicoob debits from 2026-11-19."""
import argparse
from collections import defaultdict
from contextlib import closing
from datetime import date
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


def valid_existing(content,row):
    pdf=PdfReader(BytesIO(content))
    if (len(pdf.pages)!=1 or (pdf.metadata or {}).get('/Keywords')!=VERSION+':'+fingerprint(row)
            or 'Não emitido pelo banco' not in pdf.pages[0].extract_text()):
        raise ValueError('Generated PDF identity mismatch')


def reconcile(client,rows,bank_rows,payer,*,pix_details=None,boleto_details=None,check=False,output_dir=None):
    by_key=defaultdict(list)
    for bank in bank_rows:by_key[bank[m.KEY]].append(bank)
    result={'eligible':0,'attached':0,'already_attached':0,'failed':0}
    for row in rows:
        if not eligible(row):continue
        result['eligible']+=1
        try:
            item=row['Id'];name=filename(item)
            fresh=client.get_item_fields(item,FIELDS,m.LIST)
            if not _same(row,fresh):raise ValueError('Movement changed before attachment')
            files=client.get_item_attachments(item,m.LIST)
            existing=[f for f in files if f['filename']==name]
            if existing:
                if len(existing)!=1:raise ValueError('Duplicate generated attachment')
                valid_existing(existing[0]['content'],row)
                result['already_attached']+=1;continue
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
            if not _same(row,client.get_item_fields(item,FIELDS,m.LIST)):raise ValueError('Movement changed during PDF rendering')
            try:client.ensure_attachment(item,name,content,'application/pdf',target_list=m.LIST)
            except Exception:
                # Upload may have been accepted despite an uncertain response.
                if [f['content'] for f in client.get_item_attachments(item,m.LIST) if f['filename']==name]!=[content]:raise
            actual=[f['content'] for f in client.get_item_attachments(item,m.LIST) if f['filename']==name]
            if actual!=[content]:raise ValueError('Generated attachment readback mismatch')
            if not _same(row,client.get_item_fields(item,FIELDS,m.LIST)):raise ValueError('Movement changed after attachment')
            result['attached']+=1
        except Exception as error:
            print(json.dumps({'stage':'generated-pdf','item':row['Id'],'errorType':type(error).__name__}),file=sys.stderr)
            result['failed']+=1
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


def run(check=False,output_dir=None):
    client=m.sharepoint_client();m.assert_destination(client)
    rows=list(boleto_stage.list_movements(client));selected=[r for r in rows if eligible(r)]
    pending=[r for r in selected if filename(r['Id']) not in client.get_attachment_names(r['Id'],m.LIST)]
    bank=[];payer={};pix={};receipts={}
    if pending:
        first=min(m.civil_date(r['DATAPAGAMENTO']) for r in pending)
        last=max(m.civil_date(r['DATAPAGAMENTO']) for r in pending)
        if last>m.datetime.now(m.ZONE).date():raise ValueError('Future bank date')
        account,statements=m.read_bank(first,last)
        for (start,end),statement in statements.items():bank.extend(m.payment_rows(statement,start,end,account,{}))
        payer,pix=bank_context(account,rows)
        pending_ids={r['Id'] for r in pending}
        references={reference:row for reference,row in unique_boleto_references(rows).items() if row['Id'] in pending_ids}
        if references:
            answers=boleto_stage.read_receipts(account,list(references))
            for reference,row in references.items():
                response=answers.get(reference,{})
                if response.get('status')==200 and boleto_stage.receipt_matches(row,response.get('receipt')):
                    receipts[row['Id']]=response['receipt']
    return reconcile(client,selected,bank,payer,pix_details=pix,boleto_details=receipts,check=check,output_dir=output_dir)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');parser.add_argument('--output-dir',type=Path)
    args=parser.parse_args()
    try:
        counts=run(args.check,args.output_dir)
        print(json.dumps(counts),flush=True)
        raise SystemExit(1 if counts['failed'] else 0)
    except Exception as error:
        parser.exit(1,'SICOOB_GENERATED_PDF_FAILED ('+type(error).__name__+')\n')
