"""Real channel and payroll handlers, fake external records only."""
import copy
import test_per_payment as launch_fixture


class SettlementPayrollTests(launch_fixture.PerPaymentTests):
    def settlement(self, multi=False, launch=True):
        self.current['flow'] = 'payment_settlement'
        self.current['stage'] = 'notifying'
        rows=[]
        entries=[]
        for n, item in enumerate(self.entries[:3 if multi else 1],start=11):
            f=item['fields']
            fields={'ID PROVISÃO':str(n),'FORNECEDOR':f['FORNECEDOR'],'FILIAL':f['FILIAL'],
                'PRODUTO':f['PRODUTO'],'QTD':f['QUANTIDADE'],'VALOR TOTAL':f['VALOR UNITÁRIO'],
                'FRETE':f['FRETE'],'DATA PGTO EFETUADO':'2026-10-29','DATA PREVISTO PGTO':'2026-10-20',
                'FORMAPGTO':'PIX'}
            entries.append({'fields':fields})
            rows.append({'item_id':n,'verified':True,
                'launch_item':{'item_id':item['item_id'],'expected_fields':f,'verified':True} if launch else None})
        self.current['fields']=copy.deepcopy(entries[0]['fields'])
        self.current['sharepoint']={**copy.deepcopy(rows[0]),'recorded_at':'2026-10-29T12:00:00Z'}
        if multi:
            self.current['provision_description']={'parent_id':'7','entries':entries,
                'journal':{'intent':{'DATA PGTO EFETUADO':'2026-10-29'},'children':{str(r['item_id']):copy.deepcopy(r) for r in rows}}}
            self.current['sharepoint']['line_items']=rows
        self.sharepoint.options_by_key['launch_payroll_supplier_contractors']=[
            {'id':1,'value':'SIM','source_values':{'EMPREITEIRO':'SIM'}}]
        return self.engine._notify_completed(self.current,None)

    def test_single_settlement_offers_payroll_then_links_actual_provision_and_launch(self):
        result=self.settlement()
        self.assertEqual(result['status'],'awaiting_launch_payroll_decision')
        self.assertEqual(self.send('launch_payroll_yes')['status'],'awaiting_launch_payroll_sheet')
        self.choose(31)
        self.send('launch_payroll_type_salary')
        rows=[r['fields'] for r in self.sharepoint.items.values() if r['target_list']=='FOLHAPGTO']
        self.assertEqual(len(rows),1)
        self.assertEqual((rows[0]['IDPROVISAO'],rows[0]['IDLANCAMENTO'],rows[0]['IDFOLHA']),(11,901,31))
        self.assertEqual(float(rows[0]['VALORUNITARIO'])*float(rows[0]['QTD']),25)

    def test_without_generated_launch_still_offers_and_does_not_use_provision_id_as_launch(self):
        self.settlement(launch=False)
        self.send('launch_payroll_yes')
        self.choose(31)
        self.send('launch_payroll_type_salary')
        row=next(r['fields'] for r in self.sharepoint.items.values() if r['target_list']=='FOLHAPGTO')
        self.assertEqual(row['IDPROVISAO'],11)
        self.assertNotIn('IDLANCAMENTO',row)

    def test_group_assigns_each_employee_own_sheet(self):
        self.settlement(multi=True)
        self.send('launch_payroll_yes')
        self.send('launch_payroll_selected:11,13')
        self.choose(31)
        self.choose(41)
        self.send('launch_payroll_type_salary')
        self.send('launch_payroll_type_salary')
        rows=[r['fields'] for r in self.sharepoint.items.values() if r['target_list']=='FOLHAPGTO']
        self.assertEqual({(r['IDPROVISAO'],r['IDFOLHA']) for r in rows},{(11,31),(13,41)})

    def test_no_finishes_without_creating_payroll_or_reasking(self):
        self.settlement()
        self.assertEqual(self.send('launch_payroll_no')['status'],'completed')
        self.assertFalse(self.rows())

    def test_non_contractor_finishes_without_question(self):
        original=self.sharepoint.get_options
        self.sharepoint.get_options=lambda step,ctx=None: [] if step.get('key')=='launch_payroll_supplier_contractors' else original(step,ctx)
        self.assertEqual(self.settlement()['status'],'completed')

    def test_supplier_query_failure_retries_without_reposting_settlement(self):
        original=self.sharepoint.get_options
        def fail(step,ctx=None):
            if step.get('key')=='launch_payroll_supplier_contractors':
                raise RuntimeError('read outage')
            return original(step,ctx)
        self.sharepoint.get_options=fail
        self.assertEqual(self.settlement()['status'],'settlement_payroll_load_failed')
        self.sharepoint.get_options=original
        self.assertEqual(self.send('launch_payroll_yes')['status'],'awaiting_launch_payroll_decision')
        self.assertFalse(self.sharepoint.items)

    def test_retry_loading_can_finish_when_supplier_is_not_contractor(self):
        original=self.sharepoint.get_options
        def fail(step,ctx=None):
            if step.get('key')=='launch_payroll_supplier_contractors':
                raise RuntimeError('read outage')
            return original(step,ctx)
        self.sharepoint.get_options=fail
        self.settlement()
        self.sharepoint.get_options=lambda step,ctx=None: [] if step.get('key')=='launch_payroll_supplier_contractors' else original(step,ctx)
        self.assertEqual(self.send('launch_payroll_yes')['status'],'completed')

    def test_foreign_sheet_is_rejected_in_settlement(self):
        self.settlement()
        self.send('launch_payroll_yes')
        self.choose(41)
        self.assertFalse(self.rows())
        self.assertNotIn('IDFOLHA',self.pending()['selected_entries'][0])

    def test_unverified_payroll_write_does_not_finish_or_mark_checkpoint(self):
        self.settlement()
        self.send('launch_payroll_yes')
        self.choose(31)
        original=self.sharepoint.verify_item
        self.sharepoint.verify_item=lambda *args,**kwargs: {'fields':False,'attachments':True}
        self.assertEqual(self.send('launch_payroll_type_salary')['status'],'awaiting_launch_payroll_type')
        self.assertNotIn('FOLHAPGTO_ID',self.pending()['selected_entries'][0])
        self.sharepoint.verify_item=original
        self.send('launch_payroll_type_salary')
        self.assertEqual(len(self.rows()),1)

    def test_confirmed_date_overrides_old_group_entry_snapshot(self):
        self.settlement(multi=True)
        state,etag=self.load()
        state['provision_description']['entries'][0]['fields']['DATA PGTO EFETUADO']='2026-10-15'
        state['sharepoint']['line_items'][0]['expected_fields']={'DATA PGTO EFETUADO':'2026-10-29'}
        state.pop('pending_launch_payroll',None)
        state.pop('settlement_payroll_batch',None)
        self.engine._notify_completed(state,etag)
        self.send('launch_payroll_yes')
        self.send('launch_payroll_selected:11')
        self.choose(31)
        self.send('launch_payroll_type_salary')
        self.assertEqual(self.rows()[0]['DATA'],'2026-10-29')

    def test_replayed_loading_retry_never_becomes_yes_consent(self):
        original=self.sharepoint.get_options
        def fail(step,ctx=None):
            if step.get('key')=='launch_payroll_supplier_contractors':
                raise RuntimeError('read outage')
            return original(step,ctx)
        self.sharepoint.get_options=fail
        self.settlement()
        self.sharepoint.get_options=original
        self.send('launch_payroll_yes',message='loading-retry-fixed-id')
        self.send('launch_payroll_yes',message='loading-retry-fixed-id')
        self.assertIsNone(self.pending()['decision'])

    def test_unconfirmed_group_keeps_frozen_journal_guard(self):
        self.settlement(multi=True)
        state,etag=self.load()
        state['sharepoint']['line_items'][0]['verified']=False
        result=self.engine._handle_frozen_provision({'kind':'text','reply_id':'launch_payroll_yes','message_id':'guard-test'},state,etag)
        self.assertEqual(result['status'],'provision_submission_locked')
        self.assertTrue(state['provision_description']['journal']['intent'])
        self.assertFalse(self.sharepoint.items)

    def test_new_conversation_with_no_state_still_opens_menu(self):
        self.send('OPA')
        self.assertIsNotNone(self.load()[0])

    def test_stale_back_cannot_restore_pre_settlement_snapshot(self):
        self.engine._push_navigation_state(self.current)
        self.settlement(multi=True)
        before,_=self.load()
        self.send('navigation_back')
        after,_=self.load()
        self.assertEqual(after['provision_description']['journal'],before['provision_description']['journal'])
        self.assertEqual(after['sharepoint'],before['sharepoint'])
