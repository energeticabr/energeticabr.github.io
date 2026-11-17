"""Controlled reverse-only backfill using the same bounded scheduled-worker functions."""
import fcntl,json,os,sys
from datetime import datetime,timezone
from pathlib import Path
sys.path.insert(0,'/opt/energetica-whatsapp/dda-fiscal')
from dda_fiscal_worker import Store,FiscalBridge,reconcile_reverse,build_plan
root=Path('/var/lib/energetica-whatsapp/dda-fiscal')
with (root/'worker.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    progress=json.loads((root/'progress.json').read_text())
    bridge=FiscalBridge(json.loads((root/'config.json').read_text()))
    store=Store(); notes=bridge.inventory(); plan=build_plan(store.inventory(),notes)
    result={'checked_at':datetime.now(timezone.utc).isoformat(),'reverse_receipts':[],'reverse_reviews':[],
            'reverse_errors':[],'reverse_checks':0,'reverse_deferred':0,'reverse_verified_from_cache':0,'plan':plan}
    reconcile_reverse(store,bridge,plan['links'],notes,progress,result,datetime.now(timezone.utc))
    result.update(bridge_runs=bridge.calls,receipt_polls=bridge.polls,
        pending_unverified=[x['fiscal_id'] for x in plan['links'] if not progress.get(str(x['fiscal_id']),{}).get('reverse',{}).get('verified_at')])
    tmp=root/'progress.tmp';tmp.write_text(json.dumps(progress));os.chmod(tmp,0o600);tmp.replace(root/'progress.json')
    dest=root/('reverse-controlled-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json')
    dest.write_text(json.dumps(result,ensure_ascii=False,indent=2));os.chmod(dest,0o600)
    print(json.dumps({k:v for k,v in result.items() if k not in ('plan','reverse_receipts')},ensure_ascii=False))
    if result['reverse_errors']:sys.exit(1)
