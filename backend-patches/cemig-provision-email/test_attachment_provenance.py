"""Real parent fanout plus the independent filename copier: one PDF per source."""
import contextlib
from datetime import date
from decimal import Decimal
from hashlib import sha256
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import cemig_sync as c
from test_cemig_sync import MemoryStore, TEXT

REPO=Path(__file__).resolve().parents[2]
PUBLIC=REPO/'backend-patches'
BACKEND=PUBLIC/'provision-parent-attachments' if (PUBLIC/'provision-parent-attachments/worker').exists() else Path('/opt/energetica-whatsapp')
FIXTURE=PUBLIC/'provision-parent-fanout/tests/test_fanout.py'
if not FIXTURE.exists():FIXTURE=Path(__file__).with_name('fanout_test_fixture.py')
sys.path[:0]=[str(BACKEND/'worker'),str(PUBLIC/'provision-parent-fanout/worker')]
with patch.dict(os.environ,{'ENERGETICA_BACKEND_TEST_ROOT':str(BACKEND)}):
    spec=importlib.util.spec_from_file_location('_invoice_fanout_fixture',FIXTURE)
    fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
import provision_attachment_sync as mirror
import provision_parent_fanout as fanout


def routed(count,provider,legacy=False):
    store=MemoryStore(paid=True)
    for kind,old,new in [(c.CHILD,326,11),(c.PARENT,13,7)]:
        store.rows[kind,new]=store.rows.pop((kind,old));store.rows[kind,new]['Id']=new
        store.files[kind,new]=store.files.pop((kind,old));store.versions[kind,new]=store.versions.pop((kind,old))
    store.rows[c.CHILD,11]['DESCRITIVOPROVISAO']='7'
    bill=c.parse_bill_text(TEXT)
    if provider=='PETRANET':
        bill=c.Bill('2026-10',date(2026,11,5),Decimal('99.80'),'PETRANET-11721')
        store.rows[c.CHILD,11]['IDRECORRENCIA']='14'
        for key in [(c.CHILD,11),(c.PARENT,7)]:store.rows[key].update(FORNECEDOR='PETRANET',VALORTOTAL='99.80')
    files=[{'filename':f'invoice-{i}.pdf','content':f'%PDF-invoice-{i}'.encode()} for i in range(count)]
    c.reconcile(store,bill,files)
    client=fixture.Client()
    client.files[c.CHILD,11]={f['filename']:f['content'] for f in store.files[c.CHILD,11]}
    client.files[c.PARENT,7]={f['filename']:f['content'] for f in store.files[c.PARENT,7]}
    if legacy:client.files[c.PARENT,7]=dict(client.files[c.CHILD,11])
    else:
        assert set(client.files[c.PARENT,7])=={mirror.copy_name(11,sha256(data).hexdigest(),name)
            for name,data in client.files[c.CHILD,11].items()}
    with tempfile.TemporaryDirectory() as directory,patch.object(mirror,'parent_lock',lambda *a:contextlib.nullcontext()):
        # Race order observed in production: parent fanout precedes filename copy.
        fanout.sync(client,7,directory=directory)
        for kind,ident in [('LANCAMENTOS',60),('NOTASPENDENTES',50)]:
            for name,data in client.files[c.CHILD,11].items():
                client._ensure_attachment_local(ident,name,data,target_list=kind)
    return client


class AttachmentProvenanceTests(unittest.TestCase):
    def test_legacy_parent_original_reproduces_three_to_six_and_four_to_eight(self):
        for count in [3,4]:
            client=routed(count,'CEMIG',legacy=True)
            self.assertEqual(len(client.files['LANCAMENTOS',60]),count*2)

    def test_invoice_mirror_never_becomes_a_second_financial_attachment(self):
        for provider in ['CEMIG','PETRANET']:
            for count in [1,3,4]:
                with self.subTest(provider=provider,count=count):
                    client=routed(count,provider)
                    for key in [('LANCAMENTOS',60),('NOTASPENDENTES',50)]:
                        self.assertEqual(len(client.files[key]),count)
                        self.assertEqual(len({sha256(b).hexdigest() for b in client.files[key].values()}),count)


if __name__=='__main__':unittest.main()
