"""Run legacy multiple-launch cases plus the real card suite in isolation."""
import os
from pathlib import Path
import sys
import unittest

root = Path(os.environ["SUMMARY_SUPPLIER_SOURCE"]).resolve()
sys.path[:0] = [str(root / "worker"), str(root), str(root / "tests")]
import test_workflow
import test_summary_cards

names = [name for name in unittest.defaultTestLoader.getTestCaseNames(test_workflow.WorkflowTests)
         if name.startswith("test_multiple_launch")]
suite = unittest.TestSuite(test_workflow.WorkflowTests(name) for name in names)
suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(test_summary_cards))
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
