import copy
import test_attachments as direct
import test_batch_assignment

class Integration(test_batch_assignment.BatchAssignmentTests):
    def setUp(self):
        super().setUp()
        self.external = direct.SharePoint()
        for entry in self.entries:
            identifier = entry['item_id']
            self.external.items['LANCAMENTOS', identifier] = copy.deepcopy(entry['fields'])
            self.external.files['LANCAMENTOS', identifier] = {
                f'{identifier}-a.pdf': f'first-{identifier}'.encode(),
                f'{identifier}-b.jpg': f'second-{identifier}'.encode()}
        original_read = self.sharepoint.get_item_fields_with_etag
        def read(identifier, fields, target_list=None):
            if target_list == 'LANCAMENTOS':
                return self.external.get_item_fields_with_etag(identifier, fields, target_list)
            return original_read(identifier, fields, target_list)
        self.sharepoint.get_item_fields_with_etag = read
        self.sharepoint.site_url = self.external.site_url
        self.sharepoint._list_endpoint = self.external._list_endpoint
        self.sharepoint._request = self.external._request
        self.sharepoint._ensure_attachment_local = self.external._ensure_attachment_local
        original_verify = self.sharepoint.verify_item
        def verify(identifier, fields, names, target_list=None):
            if target_list == 'FOLHAPGTO':
                row = self.sharepoint.items[identifier]
                actual_files = self.external.files.get((target_list, identifier), {})
                return {'fields': all(str(row['fields'].get(k)) == str(v) for k,v in fields.items()),
                        'attachments': set(names) <= set(actual_files)}
            return original_verify(identifier, fields, names, target_list)
        self.sharepoint.verify_item = verify

    def test_collective_submission_copies_only_each_launch_files(self):
        self.unique_sheets()
        self.begin(settlement=False)
        self.sheet_mode('shared')
        self.month()
        self.type_mode('shared')
        self.assertEqual(self.send('launch_payroll_type_salary')['status'], 'completed')
        rows = [r for r in self.sharepoint.items.values() if r['target_list']=='FOLHAPGTO']
        self.assertEqual(len(rows), 3)
        for identifier, row in self.sharepoint.items.items():
            if row['target_list'] == 'FOLHAPGTO':
                source = row['fields']['IDLANCAMENTO']
                self.assertEqual(self.external.files['FOLHAPGTO', identifier], {
                    f'{source}-a.pdf': f'first-{source}'.encode(),
                    f'{source}-b.jpg': f'second-{source}'.encode()})

    def test_collective_attachment_failure_resumes_remaining_without_recreating_rows(self):
        self.unique_sheets()
        self.begin(settlement=False)
        self.sheet_mode('shared')
        self.month()
        self.type_mode('shared')
        self.external.fail_name = '902-b.jpg'
        self.assertEqual(self.send('launch_payroll_type_salary')['status'], 'awaiting_launch_payroll_type_retry')
        entries = self.pending()['selected_entries']
        self.assertTrue(entries[0].get('FOLHAPGTO_ID'))
        self.assertFalse(entries[1].get('FOLHAPGTO_ID'))
        self.assertEqual(self.send('launch_payroll_type_retry')['status'], 'completed')
        self.assertEqual(len(self.rows()), 3)
        self.assertEqual(len(self.external.uploads), 6)
