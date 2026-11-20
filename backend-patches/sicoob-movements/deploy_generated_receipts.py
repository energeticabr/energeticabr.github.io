"""Guarded additive OCI deployment; execute from the reviewed package with sudo."""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request

SOURCE=Path(__file__).resolve().parent.parent
LIVE=Path('/opt/energetica-whatsapp')
MIRROR=Path('/home/opc/energetica-build')
WORKER='energetica-sicoob-manual-sync.service'
TIMER='energetica-sicoob-movements.timer'
EXPECTED_WORKER='6ae7c13f645102c096c0983e14d728ac7ad7711efef6927f0f235cd59155b877'
EXPECTED_PIX='7f6029ad066f2eefc080ebed1b7103f95bab5999e583106b3aa2f2862b7809e5'
FILES=('generated_receipt.py','sync_generated_receipts.py','assets/sicoob-logo.png','assets/institutions.json')


def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=45).stdout.strip()
def digest(data):return hashlib.sha256(data).hexdigest()
def active(unit):return subprocess.run(['systemctl','is-active','--quiet',unit],capture_output=True).returncode==0


@contextmanager
def lock(path):
    with Path(path).open('a+b') as stream:
        deadline=time.monotonic()+15
        while True:
            try:fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB);break
            except BlockingIOError:
                if time.monotonic()>deadline:raise RuntimeError('Deployment or pipeline busy')
                time.sleep(.25)
        yield


def atomic(path,data,metadata=None,*,relabel=True):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,temporary=tempfile.mkstemp(prefix='.generated-pdf-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as output:
            os.fchmod(output.fileno(),metadata.st_mode&0o777 if metadata else 0o644)
            os.fchown(output.fileno(),metadata.st_uid if metadata else 0,metadata.st_gid if metadata else 0)
            output.write(data);output.flush();os.fsync(output.fileno())
        os.replace(temporary,path)
        if relabel:run('restorecon',str(path))
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def health():
    if not active(WORKER):raise RuntimeError('Manual worker inactive')
    with urllib.request.urlopen('http://127.0.0.1:8765/health',timeout=5) as response:
        if response.status!=200 or json.loads(response.read()).get('status')!='ok':raise RuntimeError('Bridge unhealthy')
    with urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=5) as response:
        if response.status!=200 or response.read()!=b'ok':raise RuntimeError('Backend unhealthy')


def install_files(replacements,originals,worker_active):
    installed=[]
    try:
        for path,data in replacements.items():
            # Record before replacement: relabeling may fail after os.replace.
            installed.append(path)
            atomic(path,data,originals[path][1] if originals[path] else None)
            if digest(path.read_bytes())!=digest(data):raise RuntimeError('Installed hash mismatch')
        if worker_active:run('systemctl','start',WORKER)
        health()
    except BaseException as error:
        failures=[]
        try:subprocess.run(['systemctl','stop',WORKER],capture_output=True,timeout=40)
        except Exception as stop_error:failures.append(type(stop_error).__name__)
        for path in reversed(installed):
            try:
                if originals[path]:atomic(path,*originals[path],relabel=False)
                else:path.unlink(missing_ok=True)
            except Exception as rollback_error:failures.append(type(rollback_error).__name__)
        # A metadata failure must not prevent byte rollback or worker restoration.
        for path in installed:
            if path.exists():
                try:subprocess.run(['restorecon',str(path)],capture_output=True,timeout=20)
                except Exception as relabel_error:failures.append(type(relabel_error).__name__)
        if worker_active:
            try:run('systemctl','start',WORKER)
            except Exception as restart_error:failures.append(type(restart_error).__name__)
        if failures:raise RuntimeError('Deployment failed; rollback failures: '+','.join(failures)) from error
        raise


def deploy():
    if os.geteuid()!=0:raise RuntimeError('sudo required')
    # Pin the complete reviewed package, including all new assets.
    manifest=json.loads((SOURCE/'generated-manifest.json').read_text())
    replacements={LIVE/'sicoob-manual-sync/sicoob_worker.py':(SOURCE/'sicoob-manual-sync/sicoob_worker.py').read_bytes(),
                  MIRROR/'sicoob-manual-sync/sicoob_worker.py':(SOURCE/'sicoob-manual-sync/sicoob_worker.py').read_bytes(),
                  LIVE/'sicoob-movements/sync_pix_receivers.py':(SOURCE/'sicoob-movements/sync_pix_receivers.py').read_bytes()}
    replacements.update({LIVE/'sicoob-movements'/name:(SOURCE/'sicoob-movements'/name).read_bytes() for name in FILES})
    for path,data in replacements.items():
        relative=str(path.relative_to(MIRROR if path.is_relative_to(MIRROR) else LIVE))
        if digest(data)!=manifest['files'][relative]:raise RuntimeError('Candidate package hash mismatch')
        if path.suffix=='.py':compile(data,str(path),'exec')
    with lock('/tmp/energetica-whatsapp-deploy.lock'):
        timer_active=active(TIMER);worker_active=active(WORKER)
        try:
            if timer_active:run('systemctl','stop',TIMER)
            state=run('systemctl','show','energetica-sicoob-movements.service','-p','ActiveState','--value')
            if state not in ('inactive','failed'):raise RuntimeError('Scheduled collection is running')
            with lock('/var/lib/energetica-sicoob-movements/pipeline.lock'):
                queue=json.loads(Path('/var/lib/energetica-whatsapp/sicoob-sync/state.json').read_text())
                if any(j['status']=='running' for j in queue['jobs'].values()):raise RuntimeError('Manual collection running')
                originals={}
                for path in replacements:
                    if path in (LIVE/'sicoob-manual-sync/sicoob_worker.py',MIRROR/'sicoob-manual-sync/sicoob_worker.py'):
                        expected=EXPECTED_WORKER
                    elif path==LIVE/'sicoob-movements/sync_pix_receivers.py':expected=EXPECTED_PIX
                    else:expected=None
                    if expected is None and path.exists():raise RuntimeError('New target already exists; reconcile first')
                    if expected and digest(path.read_bytes())!=expected:raise RuntimeError('Live baseline changed')
                    originals[path]=(path.read_bytes(),path.stat()) if path.exists() else None
                backup=Path('/var/backups/energetica-sicoob-generated-pdf')/time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
                backup.mkdir(parents=True,mode=0o700)
                for path,original in originals.items():
                    if original:
                        target=backup/path.relative_to('/')
                        target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
                shutil.copy2(SOURCE/'generated-manifest.json',backup/'generated-manifest.json')
                if worker_active:run('systemctl','stop',WORKER)
                install_files(replacements,originals,worker_active)
                print(json.dumps({'installed':True,'backup':str(backup),'files':{str(p):digest(d) for p,d in replacements.items()}}))
        finally:
            if timer_active:run('systemctl','start',TIMER)


if __name__=='__main__':deploy()
