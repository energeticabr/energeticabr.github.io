"""Run isolated in-memory tests against the explicitly imported installed engine."""
import os
from pathlib import Path
import sys
import unittest

root = Path(os.environ.get('ATTENDANCE_DEPLOYED_ROOT', '/opt/energetica-whatsapp')).resolve()
sys.path[:0] = [str(root/'worker'), str(root), str(Path(__file__).resolve().parent)]
import workflow
if Path(workflow.__file__).resolve() != root/'worker/workflow.py':
    raise RuntimeError('Unexpected workflow import')
print('DEPLOYED_WORKFLOW=' + str(workflow.__file__), flush=True)
from test_supplier_defaults import SupplierDefaultsTests
import test_inline_regression
names = [name for name in dir(SupplierDefaultsTests) if name.startswith('test_supplier_defaults_')]
suite = unittest.TestSuite(SupplierDefaultsTests(name) for name in names)
suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(test_inline_regression))
result = unittest.TextTestRunner(verbosity=1).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
