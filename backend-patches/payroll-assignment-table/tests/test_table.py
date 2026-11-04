import test_batch_assignment as fixtures

class AssignmentTableTests(fixtures.BatchAssignmentTests):
    def table(self):
        polls=[m for m in self.payloads[-1]['messages'] if m.get('type')=='poll']
        self.assertTrue(polls)
        table=polls[-1].get('detail_table') or {}
        self.assertEqual(table.get('kind'), 'payroll_assignment')
        return table['rows']

    def test_mode_and_shared_month_show_only_selected_rows(self):
        self.unique_sheets()
        self.begin(ids=(11,13))
        self.assertEqual([r['id'] for r in self.table()],['11','13'])
        self.sheet_mode('shared')
        self.assertEqual(self.table(),[
            {'id':'11','supplier':'FORNECEDOR TESTE A','totalDisplay':'R$ 25,00'},
            {'id':'13','supplier':'FORNECEDOR TESTE B','totalDisplay':'R$ 33,00'}])
        self.month()
        self.assertEqual(len(self.table()),2)
        self.type_mode('shared')
        self.assertEqual(len(self.table()),2)
        self.assertFalse(self.rows())

    def test_individual_sheet_and_type_have_exactly_current_payment(self):
        self.begin()
        self.sheet_mode('individual')
        self.assertEqual([r['id'] for r in self.table()],['11'])
        self.choose(31)
        self.assertEqual([r['id'] for r in self.table()],['12'])
        self.choose(32)
        self.choose(41)
        self.type_mode('individual')
        self.assertEqual([r['id'] for r in self.table()],['11'])
        self.send('launch_payroll_type_salary')
        self.assertEqual([r['id'] for r in self.table()],['12'])

    def test_single_payment_has_one_row_without_repeated_prose(self):
        self.settlement()
        self.send('launch_payroll_yes')
        self.assertEqual(len(self.table()),1)
        question=next(m['question'] for m in self.payloads[-1]['messages'] if m.get('type')=='poll')
        self.assertNotIn('VALOR TOTAL R$',question)
        self.assertIn('ID | FORNECEDOR | VALOR TOTAL',question)
        self.choose(31)
        self.assertEqual(len(self.table()),1)

    def test_shared_retry_table_excludes_verified_payments(self):
        self.unique_sheets()
        self.begin()
        self.sheet_mode('shared')
        self.month()
        self.type_mode('shared')
        original=self.sharepoint.verify_item
        def verify(identifier, fields, attachments, **kwargs):
            if fields.get('IDPROVISAO')==12:
                raise RuntimeError('synthetic failure')
            return original(identifier,fields,attachments,**kwargs)
        self.sharepoint.verify_item=verify
        self.send('launch_payroll_type_salary')
        self.assertEqual([r['id'] for r in self.table()],['12','13'])

    def test_launch_table_uses_launch_id_and_includes_freight(self):
        self.begin(settlement=False)
        self.sheet_mode('individual')
        self.assertEqual(self.table(),[{'id':'901','supplier':'FORNECEDOR TESTE A','totalDisplay':'R$ 25,00'}])

    def test_unrelated_poll_does_not_receive_assignment_metadata(self):
        self.current['_outbound_detail_table']={'kind':'payroll_assignment','rows':[{'id':'1'}]}
        self.current['stage']='choosing_group'
        self.messenger.send_actions(self.current,'ROOT',[{'id':'root','title':'ROOT'}])
        self.assertNotIn('detail_table',self.messenger.messages[-1])

    def test_pagination_and_filter_keep_current_payment_table(self):
        self.sharepoint.options_by_key['launch_payroll_sheets'] = [
            self.sheet(600+n, 'FORNECEDOR TESTE A', self.sheets[0]['value']) for n in range(30)]
        self.begin(settlement=False)
        self.sheet_mode('individual')
        state,etag=self.load()
        first=len(self.messenger.messages)
        result=self.engine._send_next_option_page(state,etag)
        self.assertEqual(result['status'],'next_option_page')
        self.payloads.append({'messages':self.messenger.messages[first:]})
        self.assertEqual([r['id'] for r in self.table()],['901'])
        state,etag=self.load()
        first=len(self.messenger.messages)
        self.engine._send_filtered_options(state,state['option_pagination']['step'],state['options'][:1])
        self.payloads.append({'messages':self.messenger.messages[first:]})
        self.assertEqual([r['id'] for r in self.table()],['901'])
