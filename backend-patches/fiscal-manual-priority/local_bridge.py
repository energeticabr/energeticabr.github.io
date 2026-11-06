"""Fixed local replacement for the former SSH SharePoint queue command."""
import json,sys,subprocess,os,tempfile,time,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'worker'))
from demand_watch import next_wake,timestamp
ROOT=Path('/var/lib/energetica-whatsapp/fiscal-local')
TRACK=ROOT/'automatic-lease.json'
MANUAL_STATE=ROOT.parent/'sefaz-sync/state.json'
BRIDGE='/opt/energetica-whatsapp/integrations/notas-fiscais-sefaz/sefaz_bridge.py'
PYTHON='/opt/energetica-whatsapp/.venv/bin/python'
def manual_request_due():
    try:state=json.loads(MANUAL_STATE.read_text(encoding='utf-8'))
    except FileNotFoundError:return False
    if state.get('version')!=1 or not isinstance(state.get('jobs'),dict):raise ValueError('Invalid fiscal queue state')
    for job in state['jobs'].values():
        if not isinstance(job,dict) or job.get('status') not in {'queued','running','waiting','succeeded','partial','failed'}:raise ValueError('Invalid fiscal job')
        sources=job.get('sources')
        if not isinstance(sources,dict) or set(sources)!={'NFE','CTE','NFSE'}:raise ValueError('Invalid fiscal sources')
        lease=job.get('leaseUntil',0)
        if type(lease) not in (int,float) or not math.isfinite(lease) or lease<0:raise ValueError('Invalid fiscal lease')
        for source in sources.values():
            if not isinstance(source,dict) or source.get('status') not in {'queued','running','waiting','succeeded','failed'}:raise ValueError('Invalid fiscal source status')
            if 'nextAllowedAt' in source:
                if not isinstance(source['nextAllowedAt'],str):raise ValueError('Invalid fiscal retry time')
                timestamp(source['nextAllowedAt'])
        statuses=[source['status'] for source in sources.values()]
        if all(status in {'succeeded','failed'} for status in statuses):
            expected='succeeded' if all(status=='succeeded' for status in statuses) else ('partial' if 'succeeded' in statuses else 'failed')
            if job['status']!=expected:raise ValueError('Inconsistent fiscal completion')
        elif job['status'] in {'succeeded','partial','failed'}:raise ValueError('Inconsistent fiscal completion')
    now=time.time()
    live=[job for job in state['jobs'].values() if job['status'] not in {'succeeded','partial','failed'}]
    if any(job.get('leaseUntil',0)>now for job in live):return True
    due=next_wake(state,'fiscal',now)
    # Recheck after CT-e/NFS-e, at the actual NF-e claim boundary. Reserve the
    # next two minutes for a manual retry: bridge + child startup take time.
    return due is not None and due<=now+120
def invoke(arguments):
    if not arguments or arguments[0] not in {'queue-next','queue-renew','queue-complete','queue-defer'}:raise ValueError('Invalid fixed operation')
    if arguments[0]=='queue-next' and manual_request_due():return {'job':None}
    p=subprocess.run([PYTHON,BRIDGE,*arguments],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=85)
    if p.returncode or len(p.stdout)>65536:raise RuntimeError('FISCAL_BRIDGE_FAILED')
    return json.loads(p.stdout)
if __name__=='__main__':
    try:
        result=invoke(sys.argv[1:]);op=sys.argv[1]
        if op=='queue-next' and result.get('job'):
            fd,tmp=tempfile.mkstemp(dir=ROOT)
            with os.fdopen(fd,'w') as f:
                os.fchmod(f.fileno(),0o600);json.dump({'ownerPid':os.getppid(),'id':result['job']['id']},f);f.flush();os.fsync(f.fileno())
            os.replace(tmp,TRACK)
        if op in {'queue-complete','queue-defer'} and TRACK.exists():TRACK.unlink()
        print(json.dumps(result))
    except Exception:
        print('{"ok":false,"code":"FISCAL_BRIDGE_FAILED"}');sys.exit(1)
