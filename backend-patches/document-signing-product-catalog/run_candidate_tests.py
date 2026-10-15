"""Run the VM's existing workflow suite against a staged workflow candidate."""

import os
from pathlib import Path
import sys
import unittest

candidate = Path(os.environ["PRODUCT_CATALOG_SOURCE"]) / "worker"
build = Path("/home/opc/energetica-build")
sys.path[:0] = [str(candidate), str(build / "worker")]

# Load this exact module before the existing fixture prepends its own path.
import workflow  # noqa: E402,F401

suite = unittest.defaultTestLoader.discover(str(build / "tests"), pattern="test_workflow.py")
result = unittest.TextTestRunner(verbosity=0).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
