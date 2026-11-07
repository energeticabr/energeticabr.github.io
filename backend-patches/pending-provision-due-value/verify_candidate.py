"""Stage verification: load a candidate over the installed worker and run snapshot tests."""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.path.insert(0, '/opt/energetica-whatsapp')
from worker import provision_description_settlement as current

candidate = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location(current.__name__, candidate)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
suite = unittest.defaultTestLoader.discover(str(Path(__file__).parent), pattern='test_snapshot.py')
raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
