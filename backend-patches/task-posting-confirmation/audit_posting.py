"""Offline posting/navigation audit against the selected real worker source."""
import io
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(os.environ['TASK_POSTING_SOURCE']).resolve()
FIXTURES = Path(os.environ.get('TASK_POSTING_FIXTURES', ROOT)).resolve()
sys.path[:0] = [str(ROOT / 'worker'), str(ROOT), str(FIXTURES / 'tests')]
import workflow
import test_workflow
import test_clients

assert Path(workflow.__file__).resolve() == ROOT / 'worker/workflow.py'

KEYWORDS = (
    'confirmation', 'failure', 'idempoten', 'retry', 'task_',
    'embedded', 'navigation', 'inactivity_resume', 'deferred_menu',
    'delayed_main_menu', 'completed_flow', 'commit_rechecks',
)
loader = unittest.TestLoader()
names = [name for name in loader.getTestCaseNames(test_workflow.WorkflowTests)
         if any(word in name for word in KEYWORDS)]
suite = unittest.TestSuite(test_workflow.WorkflowTests(name) for name in names)
suite.addTests(loader.loadTestsFromModule(test_clients))
output = io.StringIO()
result = unittest.TextTestRunner(stream=output, verbosity=0).run(suite)
print(json.dumps({
    'source': str(ROOT), 'selected_workflow_tests': len(names),
    'tests_run': result.testsRun,
    'failures': [{'test': case.id(), 'traceback': trace} for case, trace in result.failures],
    'errors': [{'test': case.id(), 'traceback': trace} for case, trace in result.errors],
    'skipped': [(case.id(), reason) for case, reason in result.skipped],
}, indent=2))
