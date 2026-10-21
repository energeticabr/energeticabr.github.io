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

def ensure(sp,token,fields,store):
    try: module=importlib.import_module('supplier_registration_checkpoint')
    except ModuleNotFoundError:
        return sp.ensure_item(token,fields,target_list='FORNECEDORES',idempotency_field='__PowerAppsId__',merge_existing=False)
    return module.ensure_supplier(sp,token,fields,state_store=store)

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
