"""Import deployed workflow code, exercising only in-memory external services."""
import os
from pathlib import Path
import runpy
import sys

root = Path(os.environ.get('ATTENDANCE_INLINE_DEPLOYED_ROOT','/opt/energetica-whatsapp')).resolve()
sys.path[:0] = [str(root/'worker'), str(root)]
import workflow
if Path(workflow.__file__).resolve() != root/'worker/workflow.py':
    raise RuntimeError('Unexpected workflow import')
print('DEPLOYED_WORKFLOW='+workflow.__file__, flush=True)
script = Path(__file__).with_name('test_inline.py')
sys.argv = [str(script), '-v']
runpy.run_path(str(script),run_name='__main__')
