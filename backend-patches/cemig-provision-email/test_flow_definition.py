import unittest
from flow_definition import definition


class FlowTests(unittest.TestCase):
    def test_event_uses_exact_sender_and_no_inline_attachment_download(self):
        d=definition('queue-guid')
        trigger=d['triggers']['email']
        self.assertEqual(trigger['inputs']['host']['operationId'],'OnNewEmailV3')
        self.assertEqual(trigger['inputs']['parameters']['from'],'fatura@cemig.com.br')
        self.assertFalse(trigger['inputs']['parameters']['includeAttachments'])
        self.assertEqual(d['actions']['Read_email']['inputs']['host']['operationId'],'GetEmailV2')

    def test_ready_only_after_durable_envelope(self):
        d=definition('queue-guid')
        actions=d['actions']['Only_Xavante']['actions']
        self.assertEqual(actions['Store_original_email']['inputs']['parameters']['displayName'],'mail.json')
        self.assertEqual(actions['Mark_ready']['runAfter'],{'Store_original_email':['Succeeded']})
        self.assertIn('RECEIVING',str(actions['Create_queue']))
        self.assertIn('READY',str(actions['Mark_ready']))

    def test_temporary_replay_has_explicit_email_id_schema(self):
        trigger=definition('queue-guid',replay=True)['triggers']['manual']
        self.assertEqual(trigger['inputs']['schema']['required'],['messageId'])
        self.assertNotIn('email',definition('queue-guid',replay=True)['triggers'])

    def test_protect_original_email_and_pdf_payloads(self):
        d=definition('queue-guid')
        self.assertEqual(d['actions']['Read_email']['runtimeConfiguration']['secureData']['properties'],['inputs','outputs'])
        actions=d['actions']['Only_Xavante']['actions']
        self.assertEqual(actions['Store_original_email']['runtimeConfiguration']['secureData']['properties'],['inputs','outputs'])

    def test_sharepoint_http_body_is_json_string_with_expressions(self):
        actions=definition('queue-guid')['actions']['Only_Xavante']['actions']
        body=actions['Create_queue']['inputs']['parameters']['parameters/body']
        self.assertIsInstance(body,str)
        self.assertIn('@{',body)

    def test_odata_quotes_escaped_inside_flow_expression(self):
        action=definition('queue-guid')['actions']['Only_Xavante']['actions']['Mark_ready']
        self.assertIn("guid''queue-guid''",action['inputs']['parameters']['parameters/uri'])

if __name__=='__main__':unittest.main()
