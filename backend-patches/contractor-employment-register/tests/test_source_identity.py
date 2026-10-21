"""Lost source POST must not manufacture two employees, even across restarts."""
import copy
import importlib
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from urllib.parse import unquote, urlsplit

import pytest
import requests

sys.path.insert(0,str(Path(os.environ['ENERGETICA_BACKEND_TEST_ROOT'])/'worker'))
from clients import SharePointClient

class Transport:
    def __init__(self): self.rows=[]; self.hidden=False; self.lost=False; self.posts=0
    def request(self,method,url,**kwargs):
        path=unquote(urlsplit(url).path)
        response=requests.Response(); response.status_code=200
        if path.endswith('/fields'):
            body={'value':[{'Title':'__PowerAppsId__','InternalName':'field_7','TypeAsString':'Text'},
                           {'Title':'CADASTRO','InternalName':'Title','TypeAsString':'Text'}]}
        elif path.endswith('/items'):
            if method=='POST':
                self.posts+=1
                self.rows.append({'Id':100+len(self.rows),**copy.deepcopy(kwargs['json'])})
                if self.lost: self.lost=False; raise requests.Timeout('synthetic accepted POST, response lost')
                body={'Id':self.rows[-1]['Id']}
            else:
                token=kwargs.get('params',{}).get('$filter','').split("'")[1]
                body={'value':[] if self.hidden else [r for r in self.rows if r['field_7']==token]}
        else:
            item_id=int(path.rsplit('(',1)[1][:-1]); found=[r for r in self.rows if r['Id']==item_id]
            if not found: response.status_code=404; body={}
            else: body=found[0]
        response._content=json.dumps(body).encode(); return response

def client(remote):
    value=SharePointClient('synthetic.invalid','sites/synthetic','','','','','FORNECEDORES')
    value.session=remote; value._token=lambda refresh=False:'synthetic'; return value

def ensure(sp,token,fields,store,**kwargs):
    try: module=importlib.import_module('supplier_registration_checkpoint')
    except ModuleNotFoundError:
        return sp.ensure_item(token,fields,target_list='FORNECEDORES',idempotency_field='__PowerAppsId__',merge_existing=False)
    return module.ensure_supplier(sp,token,fields,state_store=store,**kwargs)

def test_invisible_accepted_source_post_is_not_repeated_on_retry_or_restart(tmp_path):
    remote=Transport(); remote.hidden=True; remote.lost=True
    store=SimpleNamespace(directory=tmp_path)
    for _ in range(2):
        with pytest.raises((requests.Timeout,RuntimeError)):
            ensure(client(remote),'WA-SYNTHETIC',{'CADASTRO':'SYNTHETIC'},store)
    assert remote.posts==1
    remote.hidden=False
    assert ensure(client(remote),'WA-SYNTHETIC',{'CADASTRO':'SYNTHETIC'},store)==100
    assert remote.posts==1

def test_known_source_id_is_used_when_collection_is_temporarily_empty(tmp_path):
    remote=Transport(); store=SimpleNamespace(directory=tmp_path)
    assert ensure(client(remote),'WA-SYNTHETIC',{'CADASTRO':'SYNTHETIC'},store)==100
    remote.hidden=True
    assert ensure(client(remote),'WA-SYNTHETIC',{'CADASTRO':'SYNTHETIC'},store)==100
    assert remote.posts==1

def test_old_duplicate_token_is_rejected_instead_of_choosing_an_employee(tmp_path):
    remote=Transport(); remote.rows=[{'Id':100,'field_7':'WA-SYNTHETIC'},{'Id':101,'field_7':'WA-SYNTHETIC'}]
    with pytest.raises(RuntimeError):
        ensure(client(remote),'WA-SYNTHETIC',{'CADASTRO':'SYNTHETIC'},SimpleNamespace(directory=tmp_path))
    assert remote.posts==0


def test_only_new_source_post_authorizes_future_hr_submission(tmp_path):
    remote=Transport(); store=SimpleNamespace(directory=tmp_path)
    helper=importlib.import_module('supplier_registration_checkpoint')
    start=getattr(helper,'start_future_flow',None)
    assert callable(start), 'Positive flow cutover marker is missing'
    flow_id=start(client(remote),'NEW-TOKEN',state_store=store)
    item_id=ensure(client(remote),'NEW-TOKEN',{'CADASTRO':'SYNTHETIC'},store,future_flow_id=flow_id)
    proofs=list(tmp_path.rglob('submission-*.json'))
    assert len(proofs)==1
    proof=json.loads(proofs[0].read_text())
    assert proof['supplier_id']==item_id and proof['version']==1
    assert len(proof['token_hash'])==64 and 'SYNTHETIC' not in json.dumps(proof)


def test_preexisting_source_token_is_not_authority_to_import(tmp_path):
    remote=Transport(); remote.rows=[{'Id':77,'field_7':'OLD-TOKEN'}]
    assert ensure(client(remote),'OLD-TOKEN',{'CADASTRO':'SYNTHETIC'},SimpleNamespace(directory=tmp_path))==77
    assert remote.posts==0 and list(tmp_path.rglob('submission-*.json'))==[]


def test_unmarked_new_source_post_does_not_authorize_old_session(tmp_path):
    remote=Transport(); store=SimpleNamespace(directory=tmp_path)
    ensure(client(remote),'OLD-SESSION',{'CADASTRO':'SYNTHETIC'},store)
    assert remote.posts==1 and list(tmp_path.rglob('submission-*.json'))==[]


def test_old_uncertain_checkpoint_lookup_cannot_be_retroactively_marked(tmp_path):
    import contractor_employment as hr
    import hashlib
    helper=importlib.import_module('supplier_registration_checkpoint')
    start=getattr(helper,'start_future_flow',None)
    assert callable(start), 'Positive flow cutover marker is missing'
    remote=Transport(); store=SimpleNamespace(directory=tmp_path); sp=client(remote)
    directory=hr._state_directory(sp,store)
    token='OLD-UNCERTAIN'
    hr._checkpoint(directory/('source-'+hashlib.sha256(token.encode()).hexdigest()+'.json'),
        {'phase':'create_pending','token':token})
    remote.rows=[{'Id':77,'field_7':token}]
    flow_id=start(sp,token,state_store=store)
    assert ensure(sp,token,{'CADASTRO':'SYNTHETIC'},store,future_flow_id=flow_id)==77
    assert list(tmp_path.rglob('submission-*.json'))==[]
