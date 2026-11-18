"""Read-only live-source benchmark. No user conversation, mutation or posting."""
import copy
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, '/opt/energetica-whatsapp')
from local_app import build_engine, load_env
import workflow

load_env(Path('/etc/energetica-whatsapp.env'))
engine = build_engine()
# Avoid opening/reconciling any real user's latent diary record.
engine._pending_construction_diary_options = lambda state: (None, engine._startable_construction_diary_options(), None)
state = {'key': 'startup-performance-read-probe', 'sender': 'portal:startup-performance-read-probe',
         'phone_number_id': 'portal-admin', 'stage': 'choosing_group'}
namespace = dict(vars(workflow))
exec(compile(Path(__file__).with_name('menu_method.py').read_bytes(), 'menu_method.py', 'exec'), namespace)
measurements = []
menus = []
for label, method in [('before', type(engine)._start_group_menu_options), ('after', namespace['_start_group_menu_options'])]:
    started = time.monotonic()
    options = method(engine, copy.deepcopy(state))
    measurements.append({'version': label, 'seconds': round(time.monotonic() - started, 3), 'options': len(options)})
    menus.append(options)
print(json.dumps({'measurements': measurements, 'identical_menu': menus[0] == menus[1]}))
