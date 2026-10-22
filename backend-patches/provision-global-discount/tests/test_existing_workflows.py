"""Previous freight/branch scenarios explicitly decline the new optional discount."""
from pathlib import Path
import sys

PATCHES = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(PATCHES / 'multi-provision-first-freight/tests'),
                str(PATCHES / 'provision-allowed-branches/tests')]
import test_first_freight as freight
import test_allowed_branches as branches


class FirstFreightRegressionTests(freight.FirstFreightTests):
    def setUp(self):
        super().setUp()
        self.state['provision_discount'] = {'enabled': False, 'decision_complete': True, 'amount': '0'}


class AllowedBranchRegressionTests(branches.AllowedBranchTests):
    def setUp(self):
        super().setUp()
        self.state['provision_discount'] = {'enabled': False, 'decision_complete': True, 'amount': '0'}
