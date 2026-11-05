import unittest
from flow_definition import definition


class FlowTests(unittest.TestCase):
    def test_daily_search_replaces_arrival_subscription_for_both_providers(self):
        for provider in ['cemig','petranet']:
            d=definition('queue-guid',provider=provider)
            self.assertEqual(set(d['triggers']),{'daily'})
            trigger=d['triggers']['daily']
            self.assertEqual(trigger['type'],'Recurrence')
            self.assertEqual(trigger['recurrence']['frequency'],'Day')
            self.assertEqual(trigger['recurrence']['interval'],1)
            self.assertEqual(trigger['recurrence']['timeZone'],'E. South America Standard Time')
            self.assertEqual(trigger['recurrence']['schedule'],{'hours':[6],'minutes':[45]})
            self.assertNotIn('OnNewEmail',str(d))

    def test_search_is_server_filtered_and_includes_read_messages_without_pdf_download(self):
        d=definition('queue-guid')
        search=d['actions']['Search_emails']
        self.assertEqual(search['inputs']['host']['operationId'],'GetEmailsV3')
        parameters=search['inputs']['parameters']
        self.assertIn('from:fatura@cemig.com.br',parameters['searchQuery'])
        self.assertIn('received>=2026-11-04',parameters['searchQuery'])
        self.assertNotIn('"',parameters['searchQuery'])
        self.assertIn('subject:CEMIG',parameters['searchQuery'])
        self.assertFalse(parameters['fetchOnlyUnread'])
        self.assertFalse(parameters['includeAttachments'])

    def test_durable_queue_dedup_precedes_pdf_download_and_recovers_same_incomplete_row(self):
        actions=definition('queue-guid')['actions']['Check_complete_result']['actions']['Each_email']['actions']
        self.assertIn('MailId',str(actions['Known_mail']))
        self.assertIn('AttachmentFiles',str(actions['Complete_mail']))
        self.assertIn('mail.json',str(actions['Complete_mail']))
        self.assertIn('$expand=AttachmentFiles',str(definition('queue-guid')['actions']['Read_queue']))
        self.assertEqual(actions['Needs_capture']['runAfter'],{'Complete_mail':['Succeeded']})
        recover=actions['Needs_capture']['actions']['Recover_existing']
        repair=recover['actions']['Repair_Only_configured_properties']['actions']
        self.assertNotIn('Repair_Create_queue',repair)
        self.assertIn("first(body('Known_mail'))",str(repair['Repair_Store_original_email']))
        self.assertIn('Create_queue',recover['else']['actions']['Only_configured_properties']['actions'])

    def test_no_silent_truncation_and_serialized_daily_execution(self):
        d=definition('queue-guid')
        check=d['actions']['Check_complete_result']
        self.assertIn('1000',str(check['expression']))
        self.assertIn('nextLink',str(check['expression']))
        self.assertEqual(check['else']['actions']['Truncated_result']['type'],'Terminate')
        loop=check['actions']['Each_email']
        self.assertEqual(loop['runtimeConfiguration']['concurrency']['repetitions'],1)
        self.assertEqual(d['triggers']['daily']['runtimeConfiguration']['concurrency']['runs'],1)

    def test_ready_only_after_durable_envelope(self):
        d=definition('queue-guid',replay=True)
        actions=d['actions']['Only_configured_properties']['actions']
        self.assertEqual(actions['Store_original_email']['inputs']['parameters']['displayName'],'mail.json')
        self.assertEqual(actions['Mark_ready']['runAfter'],{'Store_original_email':['Succeeded']})
        self.assertIn('RECEIVING',str(actions['Create_queue']))
        self.assertIn('READY',str(actions['Mark_ready']))

    def test_temporary_replay_has_explicit_email_id_schema(self):
        trigger=definition('queue-guid',replay=True)['triggers']['manual']
        self.assertEqual(trigger['inputs']['schema']['required'],['messageId'])
        self.assertNotIn('email',definition('queue-guid',replay=True)['triggers'])

    def test_protect_original_email_and_pdf_payloads(self):
        d=definition('queue-guid',replay=True)
        self.assertEqual(d['actions']['Read_email']['runtimeConfiguration']['secureData']['properties'],['inputs','outputs'])
        actions=d['actions']['Only_configured_properties']['actions']
        self.assertEqual(actions['Store_original_email']['runtimeConfiguration']['secureData']['properties'],['inputs','outputs'])

    def test_sharepoint_http_body_is_json_string_with_expressions(self):
        actions=definition('queue-guid',replay=True)['actions']['Only_configured_properties']['actions']
        body=actions['Create_queue']['inputs']['parameters']['parameters/body']
        self.assertIsInstance(body,str)
        self.assertIn('@{',body)

    def test_odata_quotes_escaped_inside_flow_expression(self):
        action=definition('queue-guid',replay=True)['actions']['Only_configured_properties']['actions']['Mark_ready']
        self.assertIn("guid''queue-guid''",action['inputs']['parameters']['parameters/uri'])

    def test_address_filter_includes_office_and_xavante_only(self):
        condition=definition('queue-guid',replay=True)['actions']['Only_configured_properties']['expression']
        self.assertIn('OSCAR NIEMEYER',str(condition))
        self.assertIn('ANTONIO TORRES DOS SANTOS',str(condition))
        self.assertIn('1033',str(condition))
        self.assertIn('904',str(condition))

if __name__=='__main__':unittest.main()
