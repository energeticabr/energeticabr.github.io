"""Exercise current and previous financial flows with in-memory adapters."""
import os
from pathlib import Path
import sys
import unittest

stage = Path(__file__).resolve().parent
sys.path.insert(0, '/opt/energetica-whatsapp/worker')
sys.path.insert(0, os.getenv('FINANCIAL_CANDIDATE', '/opt/energetica-whatsapp/worker'))
import workflow  # Pin the chosen engine before legacy suites modify sys.path.
sys.path.insert(0, str(stage))
suite = unittest.TestSuite()
for name in ('test_financial_catalog', 'test_investment', 'test_institution',
             'test_investment_type', 'test_profitability', 'test_taxation'):
    suite.addTests(unittest.defaultTestLoader.loadTestsFromName(name))
result = unittest.TextTestRunner(verbosity=1).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
