import unittest
from contextlib import nullcontext
from unittest.mock import patch

import payroll_row_attachments as fanout
import provision_attachment_sync as mirror
import provision_description_settlement as settlement


PAID_BEFORE = {
    'FORNECEDOR': 'FORNECEDOR TESTE',
    'FILIAL': 'FILIAL TESTE',
    'DESCRITIVOPROVISAO': '7',
    'IDPEDIDO': '21',
    'IDLANCAMENTOS': '31',
    'PGTOAGENDADO': 'PAGO',
    'DATA PGTO EFETUADO': '2026-10-19T03:00:00Z',
    'STATUS': 'PAGAMENTO PREVISTO',
    'QTD': '1',
    'VALOR TOTAL': '10,00',
}
PAID_AFTER = {
    **PAID_BEFORE,
    'STATUS': 'PAGAMENTO EFETUADO',
    'DATA PGTO EFETUADO': '2026-10-19T12:00:00Z',
}
RECORDED_CHILD = {
    'expected_fields': {'PGTOAGENDADO': 'PAGO', 'DATA PGTO EFETUADO': '2026-10-19'},
    'launch_item': {'item_id': 31, 'target_list': fanout.LAUNCH, 'verified': True},
    'related_item': {'item_id': 21, 'target_list': fanout.ORDER, 'verified': True},
}


class SharePoint:
    def __init__(self, after, change_after=1, final_version=9):
        self.after = after
        self.change_after = change_after
        self.final_version = final_version
        self.child_reads = 0
        self.files = {
            (settlement.PARENT_LIST, 7): {'recibo.pdf': b'%PDF-1.7 recibo teste'},
            (fanout.CHILD, 11): {'recibo.pdf': b'%PDF-1.7 recibo teste'},
            (fanout.ORDER, 21): {'recibo.pdf': b'%PDF-1.7 recibo teste'},
            (fanout.LAUNCH, 31): {'recibo.pdf': b'%PDF-1.7 recibo teste'},
        }

    def get_item_fields_with_etag(self, item_id, fields, target_list):
        row = PAID_BEFORE
        version = 8
        if target_list == fanout.CHILD:
            self.child_reads += 1
            if self.child_reads > self.change_after:
                row, version = self.after, self.final_version
        return {field: row.get(field) for field in fields}, f'"11111111-1111-1111-1111-111111111111,{version}"'

    def verify_item(self, item_id, fields, names, target_list):
        return True

    def _ensure_attachment_local(self, *args, **kwargs):
        raise AssertionError('A confirmed attachment must not be written again')


class Attachments:
    def __init__(self, client):
        self.files = client.files

    def names(self, target, item):
        return set(self.files[target, item])

    def content(self, target, item, name):
        return self.files[target, item][name]

    def digest(self, target, item, name):
        return mirror.sha(self.content(target, item, name))


class PaidAttachmentRefreshTests(unittest.TestCase):
    def setUp(self):
        for module in (fanout, mirror):
            patcher = patch.object(module, 'SharePointStore', Attachments)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(mirror, 'parent_lock', lambda *_: nullcontext())
        patcher.start()
        self.addCleanup(patcher.stop)

    def sync(self, after, *, saved=True, change_after=1, final_version=9):
        workflow = settlement.ProvisionDescriptionSettlement()
        workflow.sharepoint = SharePoint(after, change_after=change_after, final_version=final_version)
        record = dict(RECORDED_CHILD)
        workflow._description_sync_selected_attachments({'provision_description': {
            'parent_id': '7',
            'parent': PAID_BEFORE,
            'children': [{**PAID_BEFORE, 'Id': 11}],
            'entries': [{'fields': {**PAID_BEFORE, 'ID PROVISÃO': '11'}}],
            'journal': {'children': {'11': record} if saved else {}},
        }})
        return record.get('attachment_propagation')

    def test_normalization_during_parent_attachment_sync(self):
        result = self.sync(PAID_AFTER)
        self.assertEqual({(item['target_list'], item['item_id']) for item in result},
                         {(fanout.ORDER, 21), (fanout.LAUNCH, 31)})

    def test_normalization_during_financial_fanout(self):
        # One original means five child reads in the mirror, then the
        # propagation baseline. The next read sees the automatic update.
        result = self.sync(PAID_AFTER, change_after=6)
        self.assertEqual(len(result), 2)

    def test_unconfirmed_child_still_checks_raw_snapshot(self):
        with self.assertRaisesRegex(RuntimeError, 'selecionada mudou'):
            self.sync(PAID_AFTER, saved=False)

    def test_payment_day_and_financial_fields_cannot_drift(self):
        for changes in ({'DATA PGTO EFETUADO': '2026-10-20T12:00:00Z'},
                        {'DATA PGTO EFETUADO': '2026-10-19T02:59:59Z'},
                        {'IDLANCAMENTOS': '32'}, {'VALOR TOTAL': '99'}):
            for change_after in (1, 6):
                with self.subTest(changes=changes, change_after=change_after):
                    with self.assertRaisesRegex(RuntimeError, '[Aa]lterada|mudou'):
                        self.sync({**PAID_AFTER, **changes}, change_after=change_after)

    def test_second_version_change_is_not_absorbed(self):
        for change_after in (1, 6):
            with self.subTest(change_after=change_after):
                with self.assertRaisesRegex(RuntimeError, '[Aa]lterada|mudou'):
                    self.sync(PAID_AFTER, change_after=change_after, final_version=10)

    def test_standalone_fanout_keeps_version_guard(self):
        with self.assertRaisesRegex(RuntimeError, 'Provisão alterada'):
            fanout.propagate(SharePoint(PAID_AFTER), 11, PAID_BEFORE, RECORDED_CHILD, parent='7')


if __name__ == '__main__':
    unittest.main()
