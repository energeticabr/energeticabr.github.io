"""Read-only verification of the installed source and live payment catalog."""
import json,os,sys,tempfile
from pathlib import Path
sys.path.insert(0,'/opt/energetica-whatsapp')
import local_app
local_app.load_env(Path('/etc/energetica-whatsapp.env'))
import workflow
import financial_catalog_registration as catalog
with tempfile.TemporaryDirectory(prefix='payment-catalog-readback-') as temporary:
    os.environ['LOCAL_DATA_DIR']=temporary
    engine=local_app.build_engine()
    choices=catalog.payroll_choices(engine,workflow.LAUNCH_PAYROLL_TYPE_OPTIONS)
    names=[title for _,title in choices]
    expected={title for _,title in workflow.LAUNCH_PAYROLL_TYPE_OPTIONS}|{'INSS','FGTS'}
    assert expected.issubset(set(names)),names
    raw=catalog.payroll_rows(engine)
    assert len(raw)==len({row['id'] for row in raw})
    print(json.dumps({'status':'verified','list':catalog.PAYROLL_LIST,'list_count':len(raw),'names':names,
        'create_action':catalog.PAYROLL_CREATE,'platforms':['Android','iOS','Windows/web']},ensure_ascii=False,indent=2))
