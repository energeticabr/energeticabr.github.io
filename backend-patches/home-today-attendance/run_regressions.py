"""Compare relevant existing workflow regressions offline on the VM."""
import json
import io
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path('/home/opc/energetica-build')
sys.path.insert(0, str(ROOT / 'worker'))
sys.path.insert(0, os.environ.get('ATTENDANCE_CANDIDATE', str(ROOT / 'worker')))
import workflow
sys.path.insert(0, str(ROOT / 'tests'))
import test_workflow
names = [name for name in unittest.defaultTestLoader.getTestCaseNames(test_workflow.WorkflowTests)
         if any(word in name for word in ('attendance', 'pending_diary', 'main_menu', 'group_choice'))]
with patch('requests.sessions.Session.request', side_effect=AssertionError('Offline regression')):
    result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(unittest.TestSuite(test_workflow.WorkflowTests(name) for name in names))
print(json.dumps({'run': result.testsRun, 'failures': [test.id() for test, _ in result.failures],
                  'errors': [test.id() for test, _ in result.errors], 'skipped': len(result.skipped)}))
sys.exit(0 if result.wasSuccessful() else 1)
