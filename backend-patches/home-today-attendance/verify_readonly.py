"""Read-only live count check; never handle events or write attendance/session data."""
import json
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path('/opt/energetica-whatsapp')
sys.path[:0] = [str(ROOT), str(ROOT / 'worker')]
from local_app import load_env, build_engine
load_env(Path('/etc/energetica-whatsapp.env'))
import requests
original = requests.sessions.Session.request

def read_only_request(session, method, url, *args, **kwargs):
    from urllib.parse import urlsplit
    parsed = urlsplit(url)
    token_request = (method.upper() == 'POST' and parsed.hostname == 'login.microsoftonline.com'
                     and parsed.path.endswith('/token'))
    if method.upper() not in ('GET', 'HEAD') and not token_request:
        raise RuntimeError('Read-only check refused a remote write')
    return original(session, method, url, *args, **kwargs)

with patch.object(requests.sessions.Session, 'request', read_only_request):
    engine = build_engine()
    assert type(engine.sharepoint).__name__ == 'SharePointClient', 'Real source required'
    action = engine._today_pending_attendance_action({})
    print(json.dumps({'visible': bool(action), 'label': (action or {}).get('title'),
                      'date': (action or {}).get('date'), 'mode': 'read-only'}, ensure_ascii=False))
