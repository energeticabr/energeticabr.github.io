"""Print only changed configuration paths, never values."""
import json
from pathlib import Path
a=json.loads(Path('/opt/energetica-whatsapp/worker/workflow_config.json').read_text())
b=json.loads(Path('/home/opc/energetica-build/worker/workflow_config.json').read_text())
def compare(a,b,path=''):
    if isinstance(a,dict) and isinstance(b,dict):
        for key in sorted(set(a)|set(b)):
            if key not in a or key not in b: print(path+'/'+key+' [missing]')
            else: compare(a[key],b[key],path+'/'+key)
    elif a != b: print(path+' [different]')
compare(a,b)
