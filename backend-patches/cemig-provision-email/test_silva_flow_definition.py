import json
import unittest
from silva_flow_definition import definition

class FlowTests(unittest.TestCase):
    def test_schedule_requires_an_explicit_local_calendar_anchor(self):
        with self.assertRaises(ValueError):definition('00000000-0000-0000-0000-000000000001')
    def setUp(self):self.flow=definition('00000000-0000-0000-0000-000000000001','2026-11-06T06:50:00')
    def test_single_daily_trigger_without_arrival_or_workstation(self):
        self.assertEqual(list(self.flow['triggers']),['daily'])
        trigger=self.flow['triggers']['daily']
        self.assertEqual(trigger['recurrence']['frequency'],'Day')
        self.assertEqual(trigger['recurrence']['interval'],1)
        self.assertEqual(trigger['recurrence']['schedule'],{'hours':[6],'minutes':[50]})
        self.assertNotIn('OnNewEmail',json.dumps(self.flow))
    def test_searches_do_not_require_attachments_and_include_read_mail(self):
        for key in ('Charges_Search','Invoices_Search'):
            p=self.flow['actions'][key]['inputs']['parameters']
            self.assertFalse(p['fetchOnlyUnread']);self.assertFalse(p['includeAttachments'])
            self.assertNotIn('hasattachments',p['searchQuery'])
            self.assertNotIn('"',p['searchQuery'])
    def test_financial_lists_are_never_written_by_email_flow(self):
        encoded=json.dumps(self.flow)
        self.assertNotIn('PROVISÃO PGTOS',encoded)
        self.assertNotIn('DESCRITIVOPROVISAO',encoded)
        self.assertIn('NB PARTICIPACOES',encoded)
        self.assertIn('mail.json',encoded)
    def test_both_searches_guard_incomplete_results_before_queueing(self):
        for prefix in ('Charges','Invoices'):
            check=self.flow['actions'][prefix+'_Check_complete']
            self.assertEqual(set(check['runAfter']),{'Read_queue','Charges_Search','Invoices_Search'})
            self.assertIn('IncompleteAsaasSearch',json.dumps(check['else']))
            self.assertIn('Repair_or_create',json.dumps(check))

if __name__=='__main__':unittest.main()
