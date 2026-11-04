from pathlib import Path
import os,sys,unittest
root=Path('/opt/energetica-whatsapp')
sys.path[:0]=[str(root/'worker'),str(root),str(Path(__file__).resolve().parent)]
import workflow
if Path(workflow.__file__).resolve()!=root/'worker/workflow.py': raise RuntimeError('Unexpected engine')
print('DEPLOYED_WORKFLOW='+str(workflow.__file__),flush=True)
from test_stage_sync import AssignmentStageTests,AssignmentEndToEndTests
from test_copy import CopyPatternTests
from test_comparison import ComparisonTests
from test_supplier_defaults import SupplierDefaultsTests
suite=unittest.TestSuite();loader=unittest.TestLoader()
for cls in (AssignmentStageTests,AssignmentEndToEndTests,CopyPatternTests):suite.addTests(loader.loadTestsFromTestCase(cls))
for cls,prefix in ((ComparisonTests,'test_comparison_'),(SupplierDefaultsTests,'test_supplier_defaults_')):suite.addTests(cls(name) for name in dir(cls) if name.startswith(prefix))
result=unittest.TextTestRunner().run(suite)
raise SystemExit(not result.wasSuccessful())
