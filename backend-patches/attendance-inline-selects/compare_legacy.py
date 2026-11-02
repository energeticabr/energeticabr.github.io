"""Compare existing attendance regression outcomes between baseline and candidate."""
import json
import os
from pathlib import Path
import sys
import unittest
SOURCE=Path(os.environ['ATTENDANCE_INLINE_SOURCE']).resolve()
sys.path.insert(0,str(SOURCE/'tests'))
import test_workflow as fixtures
names=[name for name in unittest.defaultTestLoader.getTestCaseNames(fixtures.WorkflowTests) if 'attendance' in name]
suite=unittest.TestSuite(fixtures.WorkflowTests(name) for name in names)
result=unittest.TestResult()
suite.run(result)
print(json.dumps({'run':result.testsRun,'failures':[case.id().split('.')[-1] for case,_ in result.failures], 'errors':[case.id().split('.')[-1] for case,_ in result.errors], 'skipped':[case.id().split('.')[-1] for case,_ in result.skipped]},indent=2))
