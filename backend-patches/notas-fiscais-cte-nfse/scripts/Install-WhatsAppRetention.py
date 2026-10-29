"""Install the notification-only patch without sending or reopening documents."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import uuid


def install(stage, deploy=False):
    target = Path('/opt/energetica-whatsapp/integrations/notas-fiscais-sefaz/sefaz_whatsapp_dispatch.py')
    manifest = json.loads((stage / 'manifest.json').read_text())
    raw = (stage / 'src/sefaz_whatsapp_dispatch.py').read_bytes()
    digest = lambda value: hashlib.sha256(value).hexdigest()
    assert digest(raw) == manifest['newSha256'], 'NEW_HASH_MISMATCH'
    compile(raw, str(target), 'exec')
    previous = target.read_bytes()
    assert digest(previous) == manifest['oldSha256'], 'PRIOR_HASH_MISMATCH'
    metadata = target.stat()
    # Callers must pause fiscal dispatch triggers before deploy. The DB lock
    # alone cannot stop a CLI process that already imported the previous code.
    if deploy:
        for proc in Path('/proc').glob('[0-9]*/cmdline'):
            try:
                assert str(target).encode() not in proc.read_bytes().split(b'\0'), 'DISPATCH_PROCESS_ACTIVE'
            except (FileNotFoundError, ProcessLookupError):
                pass
    db = sqlite3.connect('/var/lib/energetica-whatsapp/whatsmeow/gateway.db', timeout=30)
    replaced = False
    try:
        db.execute('BEGIN IMMEDIATE')
        def history():
            return digest(json.dumps(db.execute('SELECT * FROM sefaz_notification_dispatch ORDER BY rowid').fetchall(), separators=(',', ':')).encode())
        before = history()
        counts = dict(db.execute('SELECT state,count(*) FROM sefaz_notification_dispatch GROUP BY state').fetchall())
        assert not sum(v for k, v in counts.items() if k not in ('sent', 'baseline')), 'DISPATCH_NOT_QUIESCENT'
        assert db.execute("SELECT count(*) FROM gateway_outbox WHERE cast(message AS TEXT) LIKE '%sefaz-new-%'").fetchone()[0] == 0, 'SEFAZ_MESSAGES_PENDING'
        proof = {'status': 'CHECKED', 'at': datetime.now(timezone.utc).isoformat(), 'statesPreserved': counts,
                 'oldSha256': digest(previous), 'newSha256': digest(raw), 'messagesEnqueued': 0, 'historicalMessagesResent': 0}
        if deploy:
            backup = target.with_name('sefaz_whatsapp_dispatch.before-retention-'+uuid.uuid4().hex+'.py')
            with backup.open('xb') as output:
                os.fchmod(output.fileno(), metadata.st_mode & 0o777)
                os.fchown(output.fileno(), metadata.st_uid, metadata.st_gid)
                output.write(previous); output.flush(); os.fsync(output.fileno())
            db.execute('''CREATE TABLE IF NOT EXISTS sefaz_notification_retention(
                key TEXT PRIMARY KEY,amount TEXT NOT NULL,text TEXT NOT NULL,message_id INTEGER)''')
            temporary = target.with_name('.retention-'+uuid.uuid4().hex+'.tmp')
            with temporary.open('xb') as output:
                os.fchmod(output.fileno(), metadata.st_mode & 0o777)
                os.fchown(output.fileno(), metadata.st_uid, metadata.st_gid)
                output.write(raw); output.flush(); os.fsync(output.fileno())
            os.replace(temporary, target); replaced = True
            folder = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(folder)
            finally: os.close(folder)
            assert digest(target.read_bytes()) == manifest['newSha256'], 'INSTALLED_HASH_MISMATCH'
            assert history() == before, 'DISPATCH_HISTORY_CHANGED'
            db.commit()
            proof.update(status='INSTALLED', historyUnchanged=True, backup=str(backup))
        else:
            db.rollback()
        return proof
    except Exception:
        db.rollback()
        if replaced:
            rollback = target.with_name('.retention-rollback-'+uuid.uuid4().hex+'.tmp')
            with rollback.open('xb') as output:
                os.fchmod(output.fileno(), metadata.st_mode & 0o777)
                os.fchown(output.fileno(), metadata.st_uid, metadata.st_gid)
                output.write(previous); output.flush(); os.fsync(output.fileno())
            os.replace(rollback, target)
        raise
    finally:
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', type=Path)
    parser.add_argument('--deploy', action='store_true')
    args = parser.parse_args()
    print(json.dumps(install(args.stage, args.deploy)))
