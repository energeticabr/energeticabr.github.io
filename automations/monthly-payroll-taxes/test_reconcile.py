"""Real reconciliation against a narrow, synthetic SharePoint boundary."""
from copy import deepcopy
from datetime import date
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


def load_local(name):
    path = Path(__file__).with_name(name + '.py')
    if not path.exists():
        return None
    spec = importlib.util.spec_from_file_location('monthly_test_' + name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


model = load_local('model')
reconcile = load_local('reconcile')
PARENTS = 'DESCRITIVOPROVISAO'
PROVISIONS = 'PROVISÃO PGTOS'
PAYROLL = 'FOLHAPGTO'
PDF = b'%PDF-1.4\nsynthetic calculation only\n%%EOF\n'


class MemoryTransport:
    """Only the supplied external interface; CAS and unique fields are enforced."""

    def __init__(self, lists):
        self.lists = {title: {row['Id']: deepcopy(row) for row in rows}
                      for title, rows in lists.items()}
        self.files = {}
        self.calls = []
        self.writes = []
        self.fail = None  # (method, list, before/after); consumed once
        self.next_id = 1000
        self.before_write = None

    def read(self, title, item_id):
        self.calls.append(('read', title, item_id))
        return deepcopy(self.lists.get(title, {})[item_id])

    def find(self, title, field, value):
        self.calls.append(('find', title, field, value))
        return [deepcopy(row) for row in self.lists.get(title, {}).values()
                if str(row.get(field, '')).casefold() == str(value).casefold()]

    def _start(self, method, title, item_id, fields=None):
        if self.before_write:
            self.before_write(method, title, item_id, fields)
        self.calls.append((method, title, item_id))
        self.writes.append((method, title, item_id, deepcopy(fields)))
        if self.fail == (method, title, 'before'):
            self.fail = None
            raise TimeoutError('Synthetic response lost before commit')

    def _finish(self, method, title):
        if self.fail == (method, title, 'crash'):
            self.fail = None
            raise KeyboardInterrupt('Synthetic process stopped after commit')
        if self.fail == (method, title, 'after'):
            self.fail = None
            raise TimeoutError('Synthetic response lost after commit')

    def create(self, title, fields):
        self._start('create', title, None, fields)
        unique = 'IDPROVISAO' if title == PAYROLL else 'FOLHAOPERACAO'
        if any(str(row.get(unique)) == str(fields[unique])
               for row in self.lists.get(title, {}).values()):
            raise ValueError('Synthetic unique field conflict')
        self.next_id += 1
        row = dict(deepcopy(fields), Id=self.next_id, audit_etag='"1"')
        self.lists.setdefault(title, {})[row['Id']] = row
        self._finish('create', title)
        return deepcopy(row)

    def patch(self, title, item_id, fields, etag):
        self._start('patch', title, item_id, fields)
        row = self.lists[title][item_id]
        if row['audit_etag'] != etag:
            raise ValueError('Synthetic CAS conflict')
        row.update(deepcopy(fields))
        row['audit_etag'] = '"' + str(int(etag.strip('"')) + 1) + '"'
        self._finish('patch', title)
        return deepcopy(row)

    def attachments(self, title, item_id):
        self.calls.append(('attachments', title, item_id))
        return [{'FileName': name} for name in self.files.get((title, item_id), {})]

    def attachment_bytes(self, title, item_id, name):
        self.calls.append(('attachment_bytes', title, item_id, name))
        return self.files[(title, item_id)][name]

    def add_attachment(self, title, item_id, name, data):
        self._start('add_attachment', title, item_id, {'name': name})
        files = self.files.setdefault((title, item_id), {})
        if name in files:
            raise ValueError('Synthetic attachment already exists')
        files[name] = data
        self._finish('add_attachment', title)


def fixture():
    employees = [dict(Id=31, IDFORNECEDORORIGEM='701', STATUS='ATIVO', EMPREITEIRO='SIM',
                      CARGO='CARGO TESTE A', VINCULO='CLT', DATAADMISSAO='2026-01-01', DATADESLIGAMENTO=None),
                 dict(Id=32, IDFORNECEDORORIGEM='809', STATUS='ATIVO', EMPREITEIRO='SIM',
                      CARGO='CARGO TESTE B', VINCULO='CLT', DATAADMISSAO='2026-01-01', DATADESLIGAMENTO=None)]
    suppliers = [dict(Id=701, Title='PESSOA FICTICIA A', FILIAL='FILIAL TESTE',
                      PROFISSAO='PROFISSAO TESTE A', STATUS='ATIVO', EMPREITEIRO='SIM'),
                 dict(Id=809, Title='PESSOA FICTICIA B', FILIAL='FILIAL TESTE',
                      PROFISSAO='PROFISSAO TESTE B', STATUS='ATIVO', EMPREITEIRO='SIM')]
    sheets = [dict(Id=610, FORNECEDOR='PESSOA FICTICIA A', MESREFERENCIA='09/2026'),
              dict(Id=620, FORNECEDOR='PESSOA FICTICIA B', MESREFERENCIA='09/2026')]
    rules = dict(version='SYNTHETIC', confirmed=True, base='SALARIO', validFrom='2026-01',
                 validThrough='2026-12', divisor=30, fgtsBps=800,
                 employeeBrackets=[dict(limitCents=10000000, rateBps=1000)],
                 employerComponents=[dict(code='TEST', label='Empresa ficticia', rateBps=2000)],
                 employeeRounding='truncate', employerRounding='truncate')
    plan = model.plan_month(employees, suppliers,
        [dict(CARGO='CARGO TESTE A', SALARIO='2000', DATAREFERENCIA='2026-01-01'),
         dict(CARGO='CARGO TESTE B', SALARIO='3000', DATAREFERENCIA='2026-01-01')],
        sheets, rules, date(2026, 10, 1))
    plan['initialTargets'] = {'INSS': dict(parentId=410, reusedProvisionId=510),
                              'FGTS': dict(parentId=420, reusedProvisionId=520)}
    parents = [dict(Id=pid, Title='AGREGADO TESTE ' + tax, VALORTOTAL='9999.00',
                    STATUS='PAGAMENTO PREVISTO', FORMAPGTO='', audit_etag='"7"',
                    IDLANCAMENTOS=None, IDPEDIDO=None, EXTRA='preservar')
               for tax, pid in [('INSS', 410), ('FGTS', 420)]]
    provisions = [dict(Id=cid, Title='AGREGADO TESTE ' + tax, VALORTOTAL='9999.00',
                       DESCRITIVOPROVISAO=str(pid), STATUS='PAGAMENTO PREVISTO',
                       PGTOAGENDADO='PENDENTE', audit_etag='"5"', IDLANCAMENTOS=None,
                       IDPEDIDO=None, IDFOLHA=None, ORIGEMEXTRA='preservar')
                  for tax, pid, cid in [('INSS', 410, 510), ('FGTS', 420, 520)]]
    # This unrelated obligation and its source reference must survive every run.
    unrelated = dict(Id=999, Title='OUTRA OBRIGACAO FICTICIA', DESCRITIVOPROVISAO='998',
                     IDFOLHA=997, IDLANCAMENTOS='996', STATUS='PAGO', audit_etag='"9"')
    snapshot = {'specified_origins': {PARENTS: deepcopy(parents), PROVISIONS: deepcopy(provisions)},
                'lists': {'FUNCIONARIOSRH': {'rows': deepcopy(employees)},
                          'IDFOLHA': {'rows': deepcopy(sheets)}}}
    transport = MemoryTransport({PARENTS: parents, PROVISIONS: provisions + [unrelated],
                                 PAYROLL: [], 'FORNECEDORES': suppliers,
                                 'FUNCIONARIOSRH': employees, 'IDFOLHA': sheets})
    for title, ids in [(PARENTS, [410, 420]), (PROVISIONS, [510, 520])]:
        for item_id in ids:
            transport.files[(title, item_id)] = {'guia-antiga.pdf': b'%PDF-1.4\noriginal sintetico'}
    pdfs = {tax: {'name': 'calculo-' + tax.lower() + '.pdf', 'bytes': PDF + tax.encode()}
            for tax in ['INSS', 'FGTS']}
    return plan, snapshot, transport, pdfs


class InitialReconcileTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(reconcile, 'Initial replacement reconciler is not implemented')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'journal.json'
        self.plan, self.snapshot, self.transport, self.pdfs = fixture()

    def run_reconcile(self):
        # Reopen the real on-disk journal on EVERY invocation.
        return reconcile.reconcile_initial(self.plan, self.snapshot, self.transport,
                                            reconcile.JsonJournal(self.path), self.pdfs)

    def assert_no_financial_writes(self):
        self.assertEqual(self.transport.writes, [])

    # Break caught: reusing the aggregate amount/owner instead of individual links.
    def test_individual_links_and_totals_are_verified_with_originals_preserved(self):
        unrelated = deepcopy(self.transport.lists[PROVISIONS][999])
        receipt = self.run_reconcile()
        self.assertEqual(receipt['parents'], {'INSS': 410, 'FGTS': 420})
        self.assertEqual(len(receipt['rows']), 4)
        seen = set()
        for entry in receipt['rows']:
            tax, supplier = entry['tax'], entry['supplierId']
            expected = {('INSS', 701): ('600.00', 610, 'PESSOA FICTICIA A', 410),
                        ('INSS', 809): ('900.00', 620, 'PESSOA FICTICIA B', 410),
                        ('FGTS', 701): ('160.00', 610, 'PESSOA FICTICIA A', 420),
                        ('FGTS', 809): ('240.00', 620, 'PESSOA FICTICIA B', 420)}[(tax, supplier)]
            amount, sheet, name, parent = expected
            child = self.transport.read(PROVISIONS, entry['provisionId'])
            payroll = self.transport.read(PAYROLL, entry['payrollId'])
            self.assertEqual((child['VALORTOTAL'], child['IDFOLHA'], child['FORNECEDOR'],
                              child['DESCRITIVOPROVISAO']), (amount, sheet, name, str(parent)))
            self.assertEqual((payroll['VALORUNITARIO'], payroll['IDFOLHA'], payroll['FORNECEDOR'],
                              payroll['IDPROVISAO'], payroll['TIPOPGTO']),
                             (amount, str(sheet), name, entry['provisionId'], tax))
            self.assertEqual(payroll['Title'], 'APP-folha-provisao-' + str(entry['provisionId']))
            self.assertEqual(child['PRODUTO'], 'PROFISSAO TESTE ' + ('A' if supplier == 701 else 'B'))
            self.assertEqual((child['QTD'], child['IMOVEL'], child['FORMAPGTO']), ('1', 'TODOS', ''))
            seen.add((tax, supplier))
            self.assertEqual(self.transport.attachment_bytes(PROVISIONS, entry['provisionId'],
                self.pdfs[tax]['name']), self.pdfs[tax]['bytes'])
        self.assertEqual(seen, {('INSS', 701), ('INSS', 809), ('FGTS', 701), ('FGTS', 809)})
        self.assertEqual(self.transport.lists[PARENTS][410]['VALORTOTAL'], '1500.00')
        self.assertEqual(self.transport.lists[PARENTS][420]['VALORTOTAL'], '400.00')
        self.assertEqual({r['provisionId'] for r in receipt['rows'] if r['supplierId'] == 701}, {510, 520})
        for title, ids in [(PARENTS, [410, 420]), (PROVISIONS, [510, 520])]:
            for item_id in ids:
                self.assertIn('guia-antiga.pdf', self.transport.files[(title, item_id)])
        self.assertEqual(self.transport.lists[PROVISIONS][510]['ORIGEMEXTRA'], 'preservar')
        self.assertEqual(self.transport.lists[PARENTS][410]['EXTRA'], 'preservar')
        self.assertEqual(self.transport.lists[PROVISIONS][999], unrelated)
        self.assertTrue(all(w[1] in [PARENTS, PROVISIONS, PAYROLL] for w in self.transport.writes))
        self.assertTrue(all(w[0] in ['patch', 'create', 'add_attachment'] for w in self.transport.writes))

    # Break caught: repeated reconciliation creates a second financial obligation.
    def test_fresh_journal_instance_recovers_actual_ids_without_any_second_write(self):
        first = self.run_reconcile()
        self.transport.writes.clear()
        second = self.run_reconcile()
        self.assertEqual(second, first)
        self.assert_no_financial_writes()

    # Break caught: a POST timeout is retried despite a committed matching row.
    def test_lost_create_response_after_commit_is_confirmed_by_authoritative_readback(self):
        for title in [PROVISIONS, PAYROLL]:
            with self.subTest(title=title):
                self.plan, self.snapshot, self.transport, self.pdfs = fixture()
                self.path = Path(self.temp.name) / (title.replace(' ', '_') + '.json')
                self.transport.fail = ('create', title, 'after')
                receipt = self.run_reconcile()
                self.assertEqual(len(receipt['rows']), 4)
                self.assertEqual(len([w for w in self.transport.writes if w[0:2] == ('create', title)]),
                                 2 if title == PROVISIONS else 4)
                self.transport.writes.clear()
                self.assertEqual(self.run_reconcile(), receipt)
                self.assert_no_financial_writes()

    # Break caught: no visible result is mistaken for permission to POST again.
    def test_lost_create_before_commit_blocks_after_reopening_journal(self):
        self.transport.fail = ('create', PROVISIONS, 'before')
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.transport.writes.clear()
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: lost CAS response makes the next run overwrite concurrent fields.
    def test_lost_patch_after_commit_recovers_without_a_second_patch(self):
        self.transport.fail = ('patch', PARENTS, 'after')
        receipt = self.run_reconcile()
        self.assertEqual(len(receipt['rows']), 4)
        self.assertEqual(len([w for w in self.transport.writes if w[:3] == ('patch', PARENTS, 410)]), 1)

    # Break caught: preflight starts mutating before validating every frozen origin.
    def test_etag_paid_link_and_mapping_conflicts_have_zero_writes(self):
        cases = [(PARENTS, 420, {'audit_etag': '"88"'}),
                 (PROVISIONS, 520, {'audit_etag': '"88"'}),
                 (PARENTS, 420, {'STATUS': 'PAGO'}),
                 (PROVISIONS, 520, {'DATAPGTOEFETUADO': '2026-10-10'}),
                 (PROVISIONS, 520, {'IDLANCAMENTOS': '900'}),
                 (PROVISIONS, 520, {'IDPEDIDO': '901'}),
                 (PROVISIONS, 520, {'DESCRITIVOPROVISAO': '410'})]
        for title, item_id, fields in cases:
            with self.subTest(title=title, fields=fields):
                self.plan, self.snapshot, self.transport, self.pdfs = fixture()
                self.transport.lists[title][item_id].update(fields)
                with self.assertRaises(ValueError):
                    self.run_reconcile()
                self.assert_no_financial_writes()

    # Break caught: stale sheets/RH/source data are checked only after a parent write.
    def test_all_live_sources_and_sheets_are_checked_before_financial_mutation(self):
        cases = [('IDFOLHA', 620, {'MESREFERENCIA': '10/2026'}),
                 ('IDFOLHA', 620, {'FORNECEDOR': 'OUTRA PESSOA FICTICIA'}),
                 ('FORNECEDORES', 809, {'FILIAL': 'OUTRA FILIAL'}),
                 ('FORNECEDORES', 809, {'PROFISSAO': 'OUTRA PROFISSAO'}),
                 ('FORNECEDORES', 809, {'STATUS': 'INATIVO'}),
                 ('FORNECEDORES', 809, {'EMPREITEIRO': 'NAO'}),
                 ('FUNCIONARIOSRH', 32, {'STATUS': 'INATIVO'}),
                 ('FUNCIONARIOSRH', 32, {'VINCULO': 'PJ'}),
                 ('FUNCIONARIOSRH', 32, {'DATADESLIGAMENTO': '2026-09-30'}),
                 ('FUNCIONARIOSRH', 32, {'CARGO': 'OUTRO CARGO'}),
                 ('FUNCIONARIOSRH', 32, {'DATAADMISSAO': '2026-02-01'})]
        for title, item_id, fields in cases:
            with self.subTest(title=title, fields=fields):
                self.plan, self.snapshot, self.transport, self.pdfs = fixture()
                self.transport.lists[title][item_id].update(fields)
                with self.assertRaises(ValueError):
                    self.run_reconcile()
                self.assert_no_financial_writes()

    # Break caught: same-name supplier or duplicate person/month is silently selected.
    def test_duplicate_supplier_hr_or_sheet_fails_instead_of_selecting_first(self):
        for title, item_id in [('FORNECEDORES', 809), ('FUNCIONARIOSRH', 32), ('IDFOLHA', 620)]:
            with self.subTest(title=title):
                self.plan, self.snapshot, self.transport, self.pdfs = fixture()
                duplicate = dict(deepcopy(self.transport.lists[title][item_id]), Id=888)
                self.transport.lists[title][888] = duplicate
                with self.assertRaises(ValueError):
                    self.run_reconcile()
                self.assert_no_financial_writes()

    # Break caught: existing payroll IDPROVISAO can be adopted with the wrong owner.
    def test_foreign_payroll_link_blocks_before_origins_change(self):
        self.transport.lists[PAYROLL][880] = dict(Id=880, IDPROVISAO=520,
            FORNECEDOR='OUTRA PESSOA', TIPOPGTO='FGTS', IDFOLHA='620', VALORUNITARIO='160.00')
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    def test_external_tax_provision_without_payroll_is_not_duplicated(self):
        for marker in ({'TIPOPGTO': 'INSS'}, {'PRODUTO': 'INSS'}, {'OBS': 'INSS - competência fictícia'}):
            self.plan, self.snapshot, self.transport, self.pdfs = fixture()
            self.transport.lists[PROVISIONS][700] = dict(Id=700, IDFOLHA=610,
                DESCRITIVOPROVISAO='777', FOLHAOPERACAO='', STATUS='PAGAMENTO PREVISTO',
                audit_etag='"1"', **marker)
            with self.subTest(marker=marker), self.assertRaisesRegex(ValueError, '(?i)(extern|duplic|outr)'):
                self.run_reconcile()
            self.assert_no_financial_writes()

    def test_audited_initial_parent_can_have_blank_status_but_not_payment_references(self):
        for origin in self.snapshot['specified_origins'][PARENTS]:
            origin['STATUS'] = None
            self.transport.lists[PARENTS][origin['Id']]['STATUS'] = None
        receipt = self.run_reconcile()
        self.assertEqual(len(receipt['rows']), 4)

    def test_blank_status_exception_is_not_available_to_unowned_or_changed_parents(self):
        for changes in ({'IDLANCAMENTO': '91'}, {'PGTOAGENDADO': 'SIM'}, {'audit_etag': '"8"'}):
            self.plan, self.snapshot, self.transport, self.pdfs = fixture()
            for origin in self.snapshot['specified_origins'][PARENTS]:
                origin['STATUS'] = None
                self.transport.lists[PARENTS][origin['Id']]['STATUS'] = None
            self.transport.lists[PARENTS][410].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.run_reconcile()
            self.assert_no_financial_writes()

    # Break caught: a duplicate rubric uses another provision and creates double debt.
    def test_existing_same_sheet_tax_with_foreign_provision_is_not_duplicated(self):
        self.transport.lists[PAYROLL][881] = dict(Id=881, IDPROVISAO=882,
            FORNECEDOR='PESSOA FICTICIA B', TIPOPGTO='FGTS', IDFOLHA='620', VALORUNITARIO='240.00')
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: idempotence overwrites an owned row edited after successful creation.
    def test_changed_owned_row_blocks_every_write_on_retry(self):
        receipt = self.run_reconcile()
        entry = next(row for row in receipt['rows'] if row['supplierId'] == 809)
        self.transport.lists[PROVISIONS][entry['provisionId']]['VALORTOTAL'] = '0.01'
        self.transport.writes.clear()
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: same filename is accepted without checking the stored PDF bytes.
    def test_wrong_existing_pdf_is_detected_before_any_financial_write(self):
        for title, item_id in [(PARENTS, 420), (PROVISIONS, 520)]:
            with self.subTest(title=title):
                self.plan, self.snapshot, self.transport, self.pdfs = fixture()
                self.transport.files[(title, item_id)][self.pdfs['FGTS']['name']] = b'%PDF-1.4\nwrong'
                with self.assertRaises(ValueError):
                    self.run_reconcile()
                self.assert_no_financial_writes()

    # Break caught: empty jobs or unsafe attachment names make partial financial writes.
    def test_empty_rows_unsafe_names_and_non_pdf_bytes_are_rejected_upfront(self):
        cases = [('rows', []), ('name', '../calculo.pdf'), ('name', 'C:\\calculo.pdf'),
                 ('name', 'calculo.pdf:stream'), ('name', 'CON.pdf'), ('name', 'calculo.txt'),
                 ('name', 'calculo\n.pdf'), ('bytes', b'<html>not pdf</html>')]
        for field, value in cases:
            with self.subTest(field=field, value=value):
                self.plan, self.snapshot, self.transport, self.pdfs = fixture()
                if field == 'rows':
                    self.plan[field] = value
                else:
                    self.pdfs['FGTS'][field] = value
                with self.assertRaises(ValueError):
                    self.run_reconcile()
                self.assert_no_financial_writes()

    # Break caught: a parent with unplanned children is reused with an incorrect total.
    def test_foreign_child_under_original_parent_blocks_the_whole_batch(self):
        self.transport.lists[PROVISIONS][883] = dict(Id=883, DESCRITIVOPROVISAO='420',
            FORNECEDOR='OUTRA PESSOA FICTICIA', STATUS='PAGAMENTO PREVISTO', audit_etag='"1"')
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: the first CAS silently replaces a pre-existing unrelated sheet.
    def test_original_with_foreign_sheet_is_not_repurposed(self):
        self.transport.lists[PROVISIONS][520]['IDFOLHA'] = 777
        self.snapshot['specified_origins'][PROVISIONS][1]['IDFOLHA'] = 777
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: optional payroll status lets a paid existing obligation pass.
    def test_paid_owned_payroll_blocks_on_retry(self):
        receipt = self.run_reconcile()
        self.transport.lists[PAYROLL][receipt['rows'][0]['payrollId']]['STATUS'] = 'PAGO'
        self.transport.writes.clear()
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: receipt ignores a parent being linked to a launch mid-execution.
    def test_final_readback_refuses_parent_that_acquired_a_launch(self):
        def concurrent_launch(method, title, item_id, fields):
            if method == 'add_attachment' and title == PARENTS and item_id == 420:
                self.transport.lists[PARENTS][410]['IDLANCAMENTOS'] = '777'
        self.transport.before_write = concurrent_launch
        with self.assertRaises(ValueError):
            self.run_reconcile()

    # Break caught: recovered creates retain no actual attempted identifier.
    def test_confirmed_create_identifiers_are_durable_even_after_lost_response(self):
        self.transport.fail = ('create', PROVISIONS, 'after')
        self.run_reconcile()
        data = json.loads(self.path.read_text(encoding='utf-8'))
        records = [r for key, r in data['records'].items() if json.loads(key)[0] == 'create']
        self.assertEqual(len(records), 6)
        for record in records:
            self.assertTrue(record['attempted'])
            self.assertIsInstance(record['attemptedId'], int)
            self.assertEqual(record['attemptedId'], record['confirmedId'])

    # Break caught: editing the audit snapshot can bypass a frozen initial intention.
    def test_revised_audit_snapshot_cannot_authorize_a_new_cas_on_retry(self):
        self.transport.fail = ('add_attachment', PARENTS, 'crash')
        with self.assertRaises(KeyboardInterrupt):
            self.run_reconcile()
        self.transport.lists[PARENTS][420]['audit_etag'] = '"99"'
        self.snapshot['specified_origins'][PARENTS][1]['audit_etag'] = '"99"'
        self.transport.writes.clear()
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: exact filtering rejects a still-corresponding accented live sheet.
    def test_accent_case_and_date_equivalent_sources_remain_the_same_person(self):
        self.transport.lists['FORNECEDORES'][701].update(
            Title='Pessoa Fictícia A', PROFISSAO='Profissão Teste A', STATUS='átivo', EMPREITEIRO='sím')
        self.transport.lists['FUNCIONARIOSRH'][31].update(CARGO='Cárgo Teste A', DATAADMISSAO='2026-01-01T00:00:00Z')
        self.transport.lists['IDFOLHA'][610].update(FORNECEDOR='Pessoa Fictícia A', MESREFERENCIA='2026-09')
        try:
            receipt = self.run_reconcile()
        except ValueError as error:
            self.fail('Equivalent live identity was rejected: ' + str(error))
        self.assertEqual(len(receipt['rows']), 4)

    # Break caught: a structurally empty individual row bypasses an explicit rejection.
    def test_empty_individual_row_fails_upfront_with_no_transport_calls(self):
        self.plan['rows'] = [{}]
        try:
            with self.assertRaises(ValueError):
                self.run_reconcile()
        except KeyError:
            self.fail('Malformed individual row was not explicitly validated')
        self.assertEqual(self.transport.calls, [])

    # Break caught: transport mutation starts before an exact durable intent exists.
    def test_every_mutating_request_has_its_exact_attempt_persisted_first(self):
        checked = []

        def inspect_disk(method, title, item_id, fields):
            records = json.loads(self.path.read_text(encoding='utf-8'))['records']
            operation = 'attachment' if method == 'add_attachment' else method
            pending = [r for token, r in records.items()
                       if json.loads(token)[:2] == [operation, title]
                       and r['attempted'] and r['confirmedId'] is None
                       and (r['intent'].get('fields') == fields if method != 'add_attachment'
                            else r['intent']['id'] == item_id and r['intent']['name'] == fields['name'])]
            self.assertEqual(len(pending), 1)
            record = pending[0]
            self.assertRegex(record['fingerprint'], r'^[0-9a-f]{64}$')
            if method == 'patch':
                self.assertEqual(record['attemptedId'], item_id)
                self.assertEqual(record['intent']['etag'], '"7"' if title == PARENTS else '"5"')
            if method == 'add_attachment':
                import hashlib
                tax = 'INSS' if fields['name'] == 'calculo-inss.pdf' else 'FGTS'
                self.assertEqual(record['intent']['sha256'], hashlib.sha256(self.pdfs[tax]['bytes']).hexdigest())
            checked.append(method)

        self.transport.before_write = inspect_disk
        self.run_reconcile()
        self.assertEqual(checked.count('patch'), 4)
        self.assertEqual(checked.count('create'), 6)
        self.assertEqual(checked.count('add_attachment'), 6)

    # Break caught: all employees are not reread before the first financial request.
    def test_first_mutation_occurs_after_every_supplier_hr_and_sheet_read(self):
        observations = []

        def inspect_reads(method, title, item_id, fields):
            if observations:
                return
            reads = {call[1:3] for call in self.transport.calls if call[0] == 'read'}
            self.assertTrue({('FORNECEDORES', 701), ('FORNECEDORES', 809),
                             ('FUNCIONARIOSRH', 31), ('FUNCIONARIOSRH', 32),
                             ('IDFOLHA', 610), ('IDFOLHA', 620)} <= reads)
            observations.append(method)

        self.transport.before_write = inspect_reads
        self.run_reconcile()
        self.assertEqual(observations, ['patch'])

    # Break caught: a committed POST is posted again after process death, not just timeout.
    def test_process_interruption_after_create_recovers_from_new_journal(self):
        self.transport.fail = ('create', PROVISIONS, 'crash')
        with self.assertRaises(KeyboardInterrupt):
            self.run_reconcile()
        committed = [r['Id'] for r in self.transport.lists[PROVISIONS].values()
                     if r.get('FOLHAOPERACAO') == 'ENCARGOS:2026-09:INSS:809']
        self.assertEqual(len(committed), 1)
        self.transport.writes.clear()
        receipt = self.run_reconcile()
        entry = next(r for r in receipt['rows'] if (r['tax'], r['supplierId']) == ('INSS', 809))
        self.assertEqual(entry['provisionId'], committed[0])
        self.assertEqual(len([w for w in self.transport.writes if w[:2] == ('create', PROVISIONS)]), 1)

    # Break caught: recovery trusts a stale journal ID after the key was reassigned.
    def test_recreated_owned_record_with_another_id_is_not_silently_adopted(self):
        receipt = self.run_reconcile()
        cid = next(r['provisionId'] for r in receipt['rows'] if r['supplierId'] == 809)
        changed = self.transport.lists[PROVISIONS].pop(cid)
        changed['Id'] = 8888
        self.transport.lists[PROVISIONS][8888] = changed
        self.transport.writes.clear()
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: uncertain payroll POST is repeated after no record becomes visible.
    def test_lost_payroll_create_before_commit_blocks_without_second_post(self):
        self.transport.fail = ('create', PAYROLL, 'before')
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.transport.writes.clear()
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: a failed CAS with no committed change is automatically retried.
    def test_lost_patch_before_commit_blocks_on_next_attempt(self):
        self.transport.fail = ('patch', PROVISIONS, 'before')
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.transport.writes.clear()
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: a concurrent edit is clobbered by a second CAS request.
    def test_concurrent_cas_failure_preserves_edit_and_never_retries_blindly(self):
        def edit_before_cas(method, title, item_id, fields):
            if method == 'patch':
                self.transport.lists[title][item_id].update(audit_etag='"50"', EXTRA='edicao concorrente')
        self.transport.before_write = edit_before_cas
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assertEqual(len(self.transport.writes), 1)
        self.assertEqual(self.transport.lists[PARENTS][410]['EXTRA'], 'edicao concorrente')
        self.transport.writes.clear()
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: an upload timeout triggers duplicate/replacement upload.
    def test_lost_attachment_after_commit_recovers_exact_bytes(self):
        self.transport.fail = ('add_attachment', PROVISIONS, 'after')
        receipt = self.run_reconcile()
        self.assertEqual(len(receipt['attachments']), 6)
        self.assertEqual(len([w for w in self.transport.writes if w[:3] == ('add_attachment', PROVISIONS, 510)]), 1)
        self.transport.writes.clear()
        self.assertEqual(self.run_reconcile(), receipt)
        self.assert_no_financial_writes()

    # Break caught: a missing attachment after an uncertain attempt permits another POST.
    def test_lost_attachment_before_commit_blocks_on_retry(self):
        self.transport.fail = ('add_attachment', PROVISIONS, 'before')
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.transport.writes.clear()
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: old ETags block exact read-only recovery with a new empty journal.
    def test_exact_existing_targets_can_be_recovered_without_the_previous_journal(self):
        first = self.run_reconcile()
        self.path = Path(self.temp.name) / 'fresh-journal.json'
        self.transport.writes.clear()
        self.assertEqual(self.run_reconcile(), first)
        self.assert_no_financial_writes()

    # Break caught: current source/sheet changes are ignored after a successful run.
    def test_retry_rechecks_live_sources_even_when_every_financial_id_is_confirmed(self):
        self.run_reconcile()
        self.transport.lists['IDFOLHA'][620]['MESREFERENCIA'] = '10/2026'
        self.transport.writes.clear()
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()

    # Break caught: comparisons use text equality or confuse explicit null with zero.
    def test_numeric_date_and_explicit_blank_equivalents_need_no_mutation(self):
        first = self.run_reconcile()
        for title in [PARENTS, PROVISIONS, PAYROLL]:
            for row in self.transport.lists[title].values():
                if row['Id'] == 999:
                    continue
                for field in ['VALORTOTAL', 'VALORUNITARIO', 'FRETE', 'QTD']:
                    if field in row:
                        row[field] = float(row[field])
                for field in ['IDFOLHA', 'IDPROVISAO', 'DESCRITIVOPROVISAO']:
                    if field in row:
                        row[field] = str(row[field])
                for field in ['DATA', 'DATAPREVISTOPGTO']:
                    if field in row:
                        row[field] = row[field][:10] + 'T05:30:00-03:00'
                if 'FORMAPGTO' in row:
                    row['FORMAPGTO'] = None
        self.transport.writes.clear()
        self.assertEqual(self.run_reconcile(), first)
        self.assert_no_financial_writes()

    # Break caught: blank/null FRETE is accepted as the expected zero money.
    def test_missing_money_never_equals_zero_money(self):
        self.run_reconcile()
        for value in [None, '', False]:
            with self.subTest(value=value):
                self.transport.lists[PROVISIONS][510]['FRETE'] = value
                self.transport.writes.clear()
                with self.assertRaises(ValueError):
                    self.run_reconcile()
                self.assert_no_financial_writes()

    # Break caught: verification checks keys/amounts but omits another intended field.
    def test_all_payload_fields_are_checked_on_retry(self):
        receipt = self.run_reconcile()
        payroll_id = receipt['rows'][0]['payrollId']
        cases = [(PARENTS, 410, {'Title': 'OUTRO', 'FOLHAOPERACAO': 'OUTRO', 'FILIAL': 'OUTRA',
                  'FORNECEDOR': 'OUTRO', 'VALORTOTAL': '0', 'OBS': 'OUTRA', 'FORMAPGTO': 'PIX',
                  'STATUS': 'PAGO', 'DATAPREVISTOPGTO': '2026-10-21'}),
                 (PROVISIONS, 510, {'Title': 'OUTRO', 'FOLHAOPERACAO': 'OUTRO', 'FILIAL': 'OUTRA',
                  'FORNECEDOR': 'OUTRO', 'PRODUTO': 'OUTRO', 'OBS': 'OUTRA', 'IMOVEL': 'OUTRO',
                  'FORMAPGTO': 'PIX', 'QTD': '2', 'VALORTOTAL': '0', 'FRETE': '1', 'STATUS': 'PAGO',
                  'PGTOAGENDADO': 'SIM', 'DATA': '2026-10-02', 'DATAPREVISTOPGTO': '2026-10-21',
                  'DESCRITIVOPROVISAO': '9999', 'IDFOLHA': '9999'}),
                 (PAYROLL, payroll_id, {'Title': 'OUTRO', 'FORNECEDOR': 'OUTRO', 'TIPOPGTO': 'OUTRO',
                  'VALORUNITARIO': '0', 'QTD': '2', 'DATA': '2026-10-21', 'IDFOLHA': '9999', 'IDPROVISAO': 9999})]
        originals = deepcopy(self.transport.lists)
        for title, item_id, mutations in cases:
            for field, value in mutations.items():
                with self.subTest(title=title, field=field):
                    self.transport.lists = deepcopy(originals)
                    self.transport.lists[title][item_id][field] = value
                    self.transport.writes.clear()
                    with self.assertRaises(ValueError):
                        self.run_reconcile()
                    self.assert_no_financial_writes()

    # Break caught: duplicate deterministic child keys cause the first matching ID to win.
    def test_duplicate_deterministic_child_key_is_rejected_before_writes(self):
        for item_id in [885, 886]:
            self.transport.lists[PROVISIONS][item_id] = dict(Id=item_id,
                FOLHAOPERACAO='ENCARGOS:2026-09:FGTS:809')
        with self.assertRaises(ValueError):
            self.run_reconcile()
        self.assert_no_financial_writes()


if __name__ == '__main__':
    unittest.main()
