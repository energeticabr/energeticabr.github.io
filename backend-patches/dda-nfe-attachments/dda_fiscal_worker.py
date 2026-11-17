"""OCI scheduled reconciler; adds fiscal PDFs only, never financial fields."""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlparse

import requests
from dda_fiscal_reconcile import build_plan, ensure_pdf, validate_pdf

ENDPOINT = "web/lists(guid'33804dc0-a580-4dfe-96a0-c9621c5b8755')"
SELECT = 'Id,CHAVE_DDA,CNPJ_FORNECEDOR,CNPJ_PAGADOR,EMISSAO,VALOR,SITUACAO,STATUS_DDA,PGTO_CONFIRMADO'
FISCAL_FIELDS = (
    'Id', 'Modified', 'CHAVE_ACESSO', 'CNPJ_FORNECEDOR', 'CNPJ_DESTINATARIO', 'DATA_EMISSAO',
    'VALOR_LIQUIDO', 'VALOR_LIQUIDO_FATURA', 'VALOR_TOTAL_NOTA', 'VALOR_SERVICOS',
    'STATUS_DANFE', 'STATUS_IMPORTACAO', 'SITUACAO',
)
MAX_PDF_CHECKS = 8
MAX_REVERSE_CHECKS = 8
VERIFIED_FOR = timedelta(days=7)
REVIEW_RETRY_AFTER = timedelta(hours=20)


class FiscalBridgeUnavailable(RuntimeError):
    pass


def unpack(value):
    for _ in range(3):
        if isinstance(value, str): value=json.loads(value)
        else: break
    return value


class FiscalBridge:
    def __init__(self, config):
        self.uri = config['uri']
        uri = urlparse(self.uri)
        workflow = re.search(r'/workflows/([a-f0-9-]+)/triggers/', uri.path, re.I)
        if (uri.scheme != 'https' or not uri.hostname
                or not uri.hostname.endswith(('.api.powerplatform.com', '.logic.azure.com'))
                or 'sig=' not in uri.query or not workflow):
            raise ValueError('UNTRUSTED_FISCAL_BRIDGE')
        self.origin = uri.netloc
        self.workflow_path = f'/workflows/{workflow[1]}/runs/'
        self.deadline = time.monotonic() + 510
        self.calls = 0
        self.polls = 0

    def request(self, method, uri, deadline, **kwargs):
        remaining = deadline - time.monotonic()
        if remaining < 1:
            raise FiscalBridgeUnavailable('FISCAL_BRIDGE_DEADLINE')
        try:
            return requests.request(
                method, uri, timeout=(min(10, remaining), min(30, remaining)),
                allow_redirects=False, **kwargs,
            )
        except requests.RequestException:
            raise FiscalBridgeUnavailable('FISCAL_BRIDGE_NETWORK_ERROR') from None

    def call(self, body):
        deadline = min(self.deadline, time.monotonic() + 375)
        self.calls += 1
        response = self.request('POST', self.uri, deadline, json=body)
        location = response.headers.get('Location', '')
        while response.status_code == 202:
            location = response.headers.get('Location') or location
            target = urlparse(location)
            if (target.scheme != 'https' or target.netloc != self.origin
                    or self.workflow_path not in target.path
                    or not re.search(r'(?:^|&)(?:sig|code)=', target.query)):
                raise FiscalBridgeUnavailable('FISCAL_BRIDGE_INVALID_RECEIPT_URL')
            retry_after = response.headers.get('Retry-After', '')
            delay = max(5, int(retry_after)) if retry_after.isdecimal() else 5
            if time.monotonic() + delay >= deadline:
                raise FiscalBridgeUnavailable('FISCAL_BRIDGE_RECEIPT_TIMEOUT')
            time.sleep(delay)
            self.polls += 1
            response = self.request('GET', location, deadline)
        if response.status_code != 200:
            raise FiscalBridgeUnavailable('FISCAL_BRIDGE_HTTP_%d' % response.status_code)
        return unpack(response.json())

    def inventory(self):
        rows=[]; after=0
        while True:
            page=unpack(self.call({'mode':'inventory','afterId':after})['page'])
            batch=page.get('value')
            if not isinstance(batch,list): raise ValueError('INVALID_FISCAL_PAGE')
            if not batch: return rows
            for row in batch:
                if int(row['Id']) <= after: raise ValueError('FISCAL_PAGINATION_NOT_INCREASING')
                after=int(row['Id']);rows.append(row)

    def pdf(self, item_id):
        result=self.call({'mode':'pdf','itemId':int(item_id)})
        if result.get('status') != 'ready': raise ValueError('FISCAL_PDF_UNAVAILABLE')
        content=result['content']
        if not isinstance(content,dict) or '$content' not in content: raise ValueError('INVALID_PDF_ENVELOPE')
        raw=base64.b64decode(content['$content'],validate=True);validate_pdf(raw)
        return result['filename'],raw,unpack(result['record'])

    def ensure_dda_pdf(self, item_id, filename, content, expected_key):
        validate_pdf(content)
        if (not isinstance(item_id, int) or item_id <= 0
                or not re.fullmatch(r'DDA-[1-9][0-9]*-Espelho_DDA_[0-9a-f]{16}\.pdf', filename)
                or not re.fullmatch(r'[0-9]{44}|[0-9]{50}', expected_key)):
            raise ValueError('INVALID_DDA_ATTACHMENT_REQUEST')
        result = self.call({'mode':'dda_sync', 'itemId':item_id, 'filename':filename,
                            'ddaId':int(filename.split('-')[1]), 'sourceName':filename.split('-', 2)[2],
                            'expectedKey':expected_key, 'content':base64.b64encode(content).decode('ascii')})
        if result.get('status') not in {'linked', 'already_linked'}:
            raise ValueError('DDA_ATTACHMENT_UNAVAILABLE')
        envelope = unpack(result.get('content'))
        if not isinstance(envelope, dict) or '$content' not in envelope:
            raise ValueError('INVALID_DDA_PDF_ENVELOPE')
        actual = base64.b64decode(envelope['$content'], validate=True)
        if hashlib.sha256(actual).digest() != hashlib.sha256(content).digest():
            raise ValueError('DDA_PDF_READBACK_MISMATCH')
        result['record'] = unpack(result['record'])
        return result


class Store:
    def __init__(self):
        sys.path.insert(0,'/opt/energetica-whatsapp/integrations/notas-fiscais-sefaz')
        from sharepoint_sefaz import authenticated_client
        self.client=authenticated_client(personal=True)

    def inventory(self):
        rows=[];after=0
        while True:
            page=self.client._request('GET',ENDPOINT+'/items',params={
                '$select':SELECT,'$filter':'Id gt %d'%after,'$orderby':'Id asc','$top':200})['value']
            if not page: return rows
            for row in page:
                if int(row['Id']) <= after: raise ValueError('DDA_PAGINATION_NOT_INCREASING')
                after=int(row['Id']);rows.append(row)

    def attachments(self, item_id):
        result=self.client._request('GET',ENDPOINT+'/items(%d)/AttachmentFiles'%item_id,
                                    params={'$select':'FileName','$top':5000})
        if result.get('odata.nextLink') or result.get('@odata.nextLink'):
            raise ValueError('ATTACHMENT_PAGINATION_REQUIRED')
        return result['value']

    def read_pdf(self, item_id, name):
        return self.client._request('GET',ENDPOINT+"/items(%d)/AttachmentFiles/getByFileName('%s')/$value"%(item_id,quote(name,safe='')),
                                    _return_response=True).content

    def add_pdf(self, item_id, name, content):
        # Existing client handles a committed POST whose response was lost.
        self.client.ensure_attachment(item_id,name,content,'application/pdf',target_list='DDAS SICOOB')


def verified_receipts(store, link, previous, revision, now):
    receipts = previous.get('receipts', [])
    if (not revision or previous.get('revision') != revision or not receipts
            or previous['verified_at'] <= (now - VERIFIED_FOR).isoformat()
            or [receipt['dda_id'] for receipt in receipts] != link['dda_ids']):
        return []
    for receipt in receipts:
        item_id = receipt['dda_id']
        name = receipt['filename']
        names = [row['FileName'] for row in store.attachments(item_id)
                 if re.match(r'^(fiscal-|danfe[-_]|danfse[-_]|dacte[-_])', row['FileName'], re.I)]
        if names != [name] or hashlib.sha256(store.read_pdf(item_id, name)).hexdigest() != receipt['sha256']:
            return []
    return [dict(receipt, status='already_linked') for receipt in receipts]


def original_dda_pdfs(store, link):
    sources = []
    for item_id in link['dda_ids']:
        names = sorted(row['FileName'] for row in store.attachments(item_id)
                       if re.fullmatch(r'Espelho_DDA_[0-9a-f]{16}\.pdf', row['FileName']))
        if not names:
            raise ValueError('ORIGINAL_DDA_PDF_UNAVAILABLE')
        for name in names:
            raw = store.read_pdf(item_id, name)
            validate_pdf(raw)
            sources.append({'dda_id':item_id, 'source_name':name, 'filename':f'DDA-{item_id}-{name}',
                            'sha256':hashlib.sha256(raw).hexdigest(), 'bytes':len(raw), 'content':raw})
    return sources


def reconcile_reverse(store, bridge, links, notes, progress, result, now):
    revisions = {row['Id']:row.get('Modified') for row in notes}
    pending = sorted(links, key=lambda link:(
        progress.get(str(link['fiscal_id']), {}).get('reverse', {}).get('attempted_at', ''), link['fiscal_id']))
    available = True
    for link in pending:
        fiscal_id = link['fiscal_id']; key = str(fiscal_id)
        state = progress.setdefault(key, {}).setdefault('reverse', {})
        # Cached manifest verification also downloads sources, so it shares the same bounded work budget.
        if (not available or result['reverse_checks'] >= MAX_REVERSE_CHECKS
                or getattr(bridge, 'deadline', float('inf')) - time.monotonic() < 60):
            result['reverse_deferred'] += 1
            continue
        result['reverse_checks'] += 1
        state['attempted_at'] = now.isoformat()
        try:
            sources = original_dda_pdfs(store, link)
            manifest = [{k:v for k,v in s.items() if k != 'content'} for s in sources]
            if (revisions.get(fiscal_id) and state.get('revision') == revisions[fiscal_id]
                    and state.get('manifest') == manifest
                    and state.get('verified_at', '') > (now - VERIFIED_FOR).isoformat()):
                result['reverse_receipts'].extend(dict(s, fiscal_id=fiscal_id, status='already_linked') for s in manifest)
                result['reverse_verified_from_cache'] += 1
                continue
            if state.get('retry_at', '') > now.isoformat() and state.get('manifest') == manifest:
                result['reverse_deferred'] += 1
                continue
            state.clear(); state.update(attempted_at=now.isoformat(), manifest=manifest)
            receipts = []
            for source in sources:
                # Revalidate the complete unique match and source bytes immediately before every write.
                fresh_notes = bridge.inventory()
                fresh_plan = build_plan(store.inventory(), fresh_notes)
                if link not in fresh_plan['links']:
                    raise ValueError('MATCH_CHANGED_BEFORE_REVERSE_WRITE')
                current = next(n for n in fresh_notes if n['Id'] == fiscal_id)
                if hashlib.sha256(store.read_pdf(source['dda_id'], source['source_name'])).hexdigest() != source['sha256']:
                    raise ValueError('DDA_SOURCE_CHANGED_BEFORE_WRITE')
                if source['source_name'] not in [a['FileName'] for a in store.attachments(source['dda_id'])]:
                    raise ValueError('DDA_SOURCE_CHANGED_BEFORE_WRITE')
                response = bridge.ensure_dda_pdf(fiscal_id, source['filename'], source['content'], current['CHAVE_ACESSO'])
                receipt = dict({k:v for k,v in source.items() if k != 'content'}, fiscal_id=fiscal_id, status=response['status'])
                receipts.append(receipt); result['reverse_receipts'].append(receipt)
                state['revision'] = response['record'].get('Modified')
            state.update(verified_at=now.isoformat(), receipts=receipts)
        except Exception as exc:
            code = str(exc) if isinstance(exc, (ValueError, FiscalBridgeUnavailable)) else type(exc).__name__
            if isinstance(exc, FiscalBridgeUnavailable): available = False
            review = code in {'CONFLICTING_DDA_ATTACHMENT', 'DDA_PDF_READBACK_MISMATCH', 'ORIGINAL_DDA_PDF_UNAVAILABLE'}
            if review: state['retry_at'] = (now + REVIEW_RETRY_AFTER).isoformat()
            result['reverse_reviews' if review else 'reverse_errors'].append({'fiscal_id':fiscal_id, 'code':code[:100]})


def reconcile(store, bridge, execute=False, progress=None, now=None):
    now = now or datetime.now(timezone.utc)
    progress = {} if progress is None else progress
    notes = bridge.inventory()
    bills = store.inventory()
    plan=build_plan(bills,notes)
    result={'checked_at':now.isoformat(),'execute':execute,'bills':len(bills),'notes':len(notes),
            'plan':plan,'receipts':[],'reviews':[],'errors':[],'pdf_checks':0,'deferred':0,
            'verified_from_cache':0}
    result.update(reverse_receipts=[], reverse_reviews=[], reverse_errors=[], reverse_checks=0,
                  reverse_deferred=0, reverse_verified_from_cache=0)
    if not execute: return result
    revisions = {row['Id']: row.get('Modified') for row in notes}
    pending = sorted(plan['links'], key=lambda link: (
        progress.get(str(link['fiscal_id']), {}).get('attempted_at', ''), link['fiscal_id'],
    ))
    bridge_available = True
    for link in pending:
        fiscal_id = link['fiscal_id']
        key = str(fiscal_id)
        revision = revisions.get(fiscal_id)
        previous = progress.get(key, {})
        try:
            cached = verified_receipts(store, link, previous, revision, now)
            if cached:
                result['receipts'].extend(cached)
                result['verified_from_cache'] += 1
                continue
            if (not bridge_available or result['pdf_checks'] >= MAX_PDF_CHECKS
                    or (revision and previous.get('revision') == revision
                        and previous.get('retry_at', '') > now.isoformat())):
                result['deferred'] += 1
                continue
            result['pdf_checks'] += 1
            progress[key] = {'revision': revision, 'attempted_at': now.isoformat(), 'reverse':previous.get('reverse', {})}
            name,pdf,current_note=bridge.pdf(fiscal_id)
            # Re-evaluate full fresh inventories before adding to any member.
            fresh_notes=bridge.inventory()
            current=next((n for n in fresh_notes if n['Id']==fiscal_id),None)
            if current is None or any(current.get(k)!=current_note.get(k) for k in FISCAL_FIELDS):
                raise ValueError('FISCAL_CHANGED_DURING_DOWNLOAD')
            fresh_plan=build_plan(store.inventory(),fresh_notes)
            if link not in fresh_plan['links']: raise ValueError('MATCH_CHANGED_BEFORE_WRITE')
            receipts = []
            for item_id in link['dda_ids']:
                receipt=ensure_pdf(store,item_id,name,pdf)
                receipt['fiscal_id']=fiscal_id
                receipts.append(receipt)
                result['receipts'].append(receipt)
            progress[key].update(revision=current.get('Modified'), verified_at=now.isoformat(), receipts=receipts)
        except Exception as exc:
            # No signed endpoints, tokens, financial data or response bodies in logs.
            code=str(exc) if isinstance(exc, (ValueError, FiscalBridgeUnavailable)) else type(exc).__name__
            if isinstance(exc, FiscalBridgeUnavailable):
                bridge_available = False
            review = code in {'CONFLICTING_FISCAL_ATTACHMENT', 'DUPLICATE_FISCAL_ATTACHMENT', 'FISCAL_PDF_UNAVAILABLE'}
            if review:
                progress[key]['retry_at'] = (now + REVIEW_RETRY_AFTER).isoformat()
            result['reviews' if review else 'errors'].append({'fiscal_id':fiscal_id,'code':code[:100]})
    reconcile_reverse(store, bridge, plan['links'], notes, progress, result, now)
    for key in progress.keys() - {str(link['fiscal_id']) for link in pending}:
        del progress[key]
    return result


def main():
    import fcntl
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true')
    parser.add_argument('--config',default='/var/lib/energetica-whatsapp/dda-fiscal/config.json')
    args=parser.parse_args();config=Path(args.config)
    with (config.parent/'worker.lock').open('a') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: print('{"status":"busy"}');return
        progress_path = config.parent / 'progress.json'
        progress = json.loads(progress_path.read_text()) if progress_path.exists() else {}
        bridge = FiscalBridge(json.loads(config.read_text()))
        result = reconcile(Store(), bridge, args.execute, progress)
        result.update(bridge_runs=bridge.calls, receipt_polls=bridge.polls)
        if args.execute:
            progress_tmp = progress_path.with_suffix('.tmp')
            progress_tmp.write_text(json.dumps(progress))
            os.chmod(progress_tmp, 0o600)
            progress_tmp.replace(progress_path)
        encoded=json.dumps(result,ensure_ascii=False,indent=2)
        target=config.parent/'last-result.json';tmp=target.with_suffix('.tmp')
        tmp.write_text(encoded);os.chmod(tmp,0o600);tmp.replace(target)
        with (config.parent/'audit.jsonl').open('a') as audit:
            audit.write(json.dumps(result,ensure_ascii=False)+'\n')
        print(encoded)
        if result['errors'] or result['reverse_errors']: sys.exit(1)


if __name__=='__main__': main()
