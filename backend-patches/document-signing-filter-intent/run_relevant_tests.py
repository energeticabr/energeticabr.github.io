"""Run existing signing and receipt workflow regressions on a staged candidate."""

from __future__ import annotations

import os
from pathlib import Path
import sys
import unittest


candidate = Path(os.environ["PRODUCT_CATALOG_SOURCE"]) / "worker"
build = Path("/home/opc/energetica-build")
sys.path[:0] = [str(candidate), str(build / "worker"), str(build / "tests")]

# Load the candidate first: the existing fixture prepends its own build path.
import workflow  # noqa: E402,F401
import test_workflow  # noqa: E402


def relevant(case: unittest.TestSuite | unittest.TestCase):
    if isinstance(case, unittest.TestSuite):
        for child in case:
            yield from relevant(child)
    elif any(term in case.id().casefold() for term in (
        "document_signing", "payment_receipt", "comprovante_pagamento",
        "sign_later", "pending_generated_receipt", "epi_delivery",
        "pending_signature",
    )):
        yield case


suite = unittest.TestSuite(relevant(unittest.defaultTestLoader.loadTestsFromModule(test_workflow)))
print(f"Running {suite.countTestCases()} signing and receipt tests", flush=True)
result = unittest.TextTestRunner(verbosity=1).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
