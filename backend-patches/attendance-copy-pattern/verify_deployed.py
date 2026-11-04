"""Exercise installed engine with isolated, in-memory fixtures."""
from pathlib import Path
import sys
import unittest
root=Path('/opt/energetica-whatsapp')
sys.path[:0]=[str(root/'worker'),str(root),str(Path(__file__).resolve().parent)]
import workflow
if Path(workflow.__file__).resolve() != root/'worker/workflow.py': raise RuntimeError('Unexpected workflow import')
print('DEPLOYED_WORKFLOW='+str(workflow.__file__),flush=True)
from test_copy import CopyPatternTests
from test_comparison import ComparisonTests
from test_supplier_defaults import SupplierDefaultsTests
suite=unittest.TestSuite()
suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(CopyPatternTests))
for cls,prefix in ((ComparisonTests,'test_comparison_'),(SupplierDefaultsTests,'test_supplier_defaults_')):
    suite.addTests(cls(name) for name in dir(cls) if name.startswith(prefix))
result=unittest.TextTestRunner().run(suite)
raise SystemExit(not result.wasSuccessful())
