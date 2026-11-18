"""Check the real source without writing attendance or session records."""
from collections import Counter
import copy
import json
from pathlib import Path
import sys
from unittest.mock import patch
from urllib.parse import urlsplit

ROOT = Path('/opt/energetica-whatsapp')
sys.path[:0] = [sys.argv[1] if len(sys.argv) > 1 else str(ROOT / 'worker'), str(ROOT / 'worker'), str(ROOT)]
import workflow
from local_app import load_env, build_engine
import requests

load_env(Path('/etc/energetica-whatsapp.env'))
original = requests.sessions.Session.request


def readonly(session, method, url, *args, **kwargs):
    parsed = urlsplit(url)
    token = method.upper() == 'POST' and parsed.hostname == 'login.microsoftonline.com' and parsed.path.endswith('/token')
    if method.upper() not in ('GET', 'HEAD') and not token:
        raise RuntimeError('Remote writes are forbidden during verification')
    return original(session, method, url, *args, **kwargs)


with patch.object(requests.sessions.Session, 'request', readonly):
    engine = build_engine()
    assert isinstance(engine, workflow.WorkflowEngine)
    assert type(engine.sharepoint).__name__ == 'SharePointClient'
    step = copy.deepcopy(engine._attendance_validation_config()['steps'][1])
    step['source']['filters'] = [f for f in step['source']['filters'] if f.get('field') != 'DATA']
    rows = engine.sharepoint.get_options(step, {})
    pending = {}
    for row in rows:
        source = row.get('source_values') or {}
        if workflow.normalize_text(str(source.get('PRESENCA') or '')) == 'pendente':
            identifier = source.get('Id', row.get('value', row.get('id')))
            if identifier not in (None, ''):
                pending[str(identifier)] = str(source.get('DATA') or '')[:10]
    action = engine._today_pending_attendance_action({})
    expected = f'👷 PRESENÇAS ({len(pending)})' if pending else None
    assert (action or {}).get('title') == expected
    assert not action or action['tone'] == 'danger'
    print(json.dumps({'mode': 'read-only', 'label': expected, 'pending': len(pending),
                      'dates': dict(sorted(Counter(pending.values()).items()))}, ensure_ascii=False))
