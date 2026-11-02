"""Integration fixture: isolated queues only, never production requests."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import time

sys.path.insert(0, '/opt/energetica-whatsapp')
from dda_sync import Queue as DdaQueue
from sefaz_sync import Queue as FiscalQueue
from demand_watch import stream

first = Path(__file__).parent / 'probe-first-connection'
if not first.exists():
    first.write_text('reconnect fixture')
    print('{"event":"ready"}', flush=True)
    sys.exit(1)

with tempfile.TemporaryDirectory(prefix='energetica-demand-probe-') as directory:
    queues = {'dda': DdaQueue(Path(directory) / 'dda'),
              'fiscal': FiscalQueue(Path(directory) / 'fiscal')}

    def produce():
        time.sleep(3)
        with queues['dda'].locked() as state:
            state['jobs']['a' * 32] = {'requestId': 'a' * 32, 'owner': 'probe',
                                      'status': 'queued', 'createdAt': time.time()}

    def emit(event):
        print(json.dumps(event), flush=True)
        if event.get('event') == 'wake':
            # Duplicate delivery must not create a second task instance.
            print(json.dumps(event), flush=True)
            queues['dda'].worker('claim')

    threading.Thread(target=produce, daemon=True).start()
    try:
        stream(queues, emit, heartbeat_seconds=2)
    except BrokenPipeError:
        pass
