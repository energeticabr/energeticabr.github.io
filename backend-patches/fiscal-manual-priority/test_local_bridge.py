import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
sys.path.insert(0,str(HERE.parent/'on-demand-workers'))
sys.path.insert(0,'/opt/energetica-whatsapp/worker')
import local_bridge

NOW=1793967087.0
def fiscal(status='waiting',due='2026-11-06T12:11:27Z',lease=0):
    source_status='failed' if status in ('partial','failed') else status
    other_status='failed' if status=='failed' else 'succeeded'
    return {'version':1,'jobs':{'request':{'status':status,'leaseUntil':lease,'sources':{
        'NFE':{'status':source_status,'nextAllowedAt':due},'CTE':{'status':other_status},'NFSE':{'status':other_status}}}}}

class PriorityTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        self.path=Path(self.directory.name)/'state.json'
        self.addCleanup(patch.stopall)
        patch.object(local_bridge,'MANUAL_STATE',self.path,create=True).start()
        patch('time.time',return_value=NOW).start()
        self.bridge=patch.object(local_bridge.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='{"job":{"id":9}}')).start()
    def write(self,state):self.path.write_text(json.dumps(state),encoding='utf-8')
    def test_due_manual_request_prevents_automatic_claim(self):
        self.write(fiscal())
        self.assertEqual(local_bridge.invoke(['queue-next']),{'job':None})
        self.bridge.assert_not_called()
    def test_inconsistent_job_and_source_completion_fails_closed(self):
        for job_status,source_status in [('succeeded','waiting'),('partial','succeeded'),('failed','succeeded'),('waiting','succeeded')]:
            with self.subTest(job=job_status,source=source_status):
                state=fiscal(status='succeeded');state['jobs']['request']['status']=job_status
                state['jobs']['request']['sources']['NFE']['status']=source_status
                self.write(state)
                with self.assertRaises(ValueError):local_bridge.invoke(['queue-next'])
        self.bridge.assert_not_called()
    def test_eligibility_is_checked_after_auxiliary_work_crosses_the_cooldown(self):
        self.write(fiscal(due='2026-11-06T12:14:27Z'))
        self.assertEqual(local_bridge.invoke(['queue-next']),{'job':{'id':9}})
        self.bridge.reset_mock()
        with patch('time.time',return_value=NOW+182):
            self.assertEqual(local_bridge.invoke(['queue-next']),{'job':None})
        self.bridge.assert_not_called()
    def test_claim_and_child_startup_cannot_take_an_imminent_manual_window(self):
        self.write(fiscal(due='2026-11-06T12:12:27Z'))
        self.assertEqual(local_bridge.invoke(['queue-next']),{'job':None})
        self.bridge.assert_not_called()
    def test_future_manual_cooldown_preserves_automatic_collection(self):
        self.write(fiscal(due='2026-11-06T13:17:00Z'))
        self.assertEqual(local_bridge.invoke(['queue-next']),{'job':{'id':9}})
        self.bridge.assert_called_once()
    def test_terminal_manual_history_does_not_block_automatic_collection(self):
        for status in ('succeeded','partial','failed'):
            with self.subTest(status=status):
                self.write(fiscal(status=status,lease=NOW+300))
                self.assertEqual(local_bridge.invoke(['queue-next']),{'job':{'id':9}})
    def test_active_manual_lease_keeps_the_distribution_window_exclusive(self):
        self.write(fiscal(status='running',due='2026-11-06T13:17:00Z',lease=NOW+300))
        self.assertEqual(local_bridge.invoke(['queue-next']),{'job':None})
        self.bridge.assert_not_called()
    def test_ready_auxiliary_source_also_hands_control_to_the_manual_worker(self):
        state=fiscal(due='2026-11-06T13:17:00Z');state['jobs']['request']['sources']['CTE']={'status':'queued'}
        self.write(state)
        self.assertEqual(local_bridge.invoke(['queue-next']),{'job':None})
    def test_missing_manual_queue_preserves_existing_automatic_behavior(self):
        self.assertEqual(local_bridge.invoke(['queue-next']),{'job':{'id':9}})
    def test_corrupt_queue_fails_closed_without_claiming_automatic_work(self):
        self.path.write_text('{invalid',encoding='utf-8')
        with self.assertRaises(ValueError):local_bridge.invoke(['queue-next'])
        self.bridge.assert_not_called()
    def test_semantically_corrupt_queue_fails_closed_before_any_automatic_claim(self):
        cases=[]
        state=fiscal();state['jobs']['request']['sources']={};cases.append(state)
        state=fiscal();state['jobs']['request']['sources']['NFE']['status']='unexpected';cases.append(state)
        state=fiscal();state['jobs']['request']['leaseUntil']=-1;cases.append(state)
        state=fiscal();state['jobs']['request']['leaseUntil']=True;cases.append(state)
        state=fiscal();state['jobs']['request']['status']='unexpected';cases.append(state)
        for state in cases:
            with self.subTest(state=state):
                self.write(state)
                with self.assertRaises(ValueError):local_bridge.invoke(['queue-next'])
        self.bridge.assert_not_called()
    def test_existing_automatic_leases_can_finish_even_after_manual_becomes_due(self):
        self.write(fiscal())
        for operation in ('queue-renew','queue-complete','queue-defer'):
            self.assertEqual(local_bridge.invoke([operation,'--id','9']),{'job':{'id':9}})
        self.assertEqual(self.bridge.call_count,3)
    def test_invalid_operation_never_reads_or_claims_either_queue(self):
        self.write(fiscal())
        with self.assertRaises(ValueError):local_bridge.invoke(['invalid'])
        self.bridge.assert_not_called()

if __name__=='__main__':unittest.main()
