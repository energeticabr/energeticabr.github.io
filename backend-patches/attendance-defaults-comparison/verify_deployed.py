"""Run in-memory regressions against the installed attendance engine."""
import os
from pathlib import Path
import sys
import unittest
root = Path(os.environ.get('ATTENDANCE_DEPLOYED_ROOT', '/opt/energetica-whatsapp')).resolve()
sys.path[:0] = [str(root / 'worker'), str(root), str(Path(__file__).resolve().parent)]
import workflow
if Path(workflow.__file__).resolve() != root / 'worker/workflow.py':
    raise RuntimeError('Unexpected workflow import')
print('DEPLOYED_WORKFLOW=' + str(workflow.__file__), flush=True)
from test_comparison import ComparisonTests
from test_supplier_defaults import SupplierDefaultsTests
import test_inline_regression
suite = unittest.TestSuite()
for cls, prefix in [(ComparisonTests, 'test_comparison_'), (SupplierDefaultsTests, 'test_supplier_defaults_')]:
    suite.addTests(cls(name) for name in dir(cls) if name.startswith(prefix))
suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(test_inline_regression))
result = unittest.TextTestRunner(verbosity=1).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
