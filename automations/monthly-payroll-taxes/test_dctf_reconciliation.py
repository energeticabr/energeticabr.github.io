import tempfile
import unittest
from pathlib import Path

from dctf_reconciliation import (
    DCTF_NAMESPACE, Pending, Review, plan_reconciliation,
    read_declaration, reconcile, select_declaration,
)


COMPETENCE = "2026-11"
CNPJ = "12345678000195"
CODES = {"EMPREGADO": 10100, "1138": 30000, "1646": 4500, "1170": 3750}


def report(credit="100.00", net="1.00", cnpj=CNPJ, month="202611", code="108201",
           sent="20261213120100", receipt="50000000001234"):
    def line(code, gross, total, balance, linked=""):
        return f"""<CreditoTributarioApurado><codReceita>{code}</codReceita>
        <ctValor>{gross}</ctValor><vlTotalCred>{total}</vlTotalCred>
        <saldoaPagar>{balance}</saldoaPagar>{linked}</CreditoTributarioApurado>"""
    linked = f"<A250-DeducaoSalFamiliaValoresVinculados><dedSalFamilia>{credit}</dedSalFamilia></A250-DeducaoSalFamiliaValoresVinculados>"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
    <ProcDctf xmlns="{DCTF_NAMESPACE}"><ConteudoDeclaracao><DctfXml>
      <A000-DadosIdentificadoresContribuinte><inscContrib>{cnpj}</inscContrib>
        <perApuracao>{month}</perApuracao><categoriaDCTF>40</categoriaDCTF>
      <A050-CreditosTributariosApurados>
      {line(code, "101.00", credit, net, linked)}
      {line("113801", "300.00", "0.00", "300.00")}
      {line("164601", "45.00", "0.00", "45.00")}
      {line("117001", "37.50", "0.00", "37.50")}
      {line("116201", "800.00", "0.00", "800.00")}
      {line("56107", "21.50", "0.00", "21.50")}
      </A050-CreditosTributariosApurados></A000-DadosIdentificadoresContribuinte>
    </DctfXml></ConteudoDeclaracao><OutrasInformacoes><numeroRecibo>{receipt}</numeroRecibo>
    <dataHoraTransmissao>{sent}</dataHoraTransmissao></OutrasInformacoes></ProcDctf>""".encode()


def manifest():
    return {
        "competence": COMPETENCE, "key": f"ENCARGOS:{COMPETENCE}", "createdDate": "2026-12-01",
        "totals": {"INSS": 48350},
        "rows": [
            {"supplierId": 10, "sheetId": 14, "name": "Pessoa A", "salaryFamilyReview": True,
             "inssCents": 18350, "components": {"EMPREGADO": 5100, "1138": 10000, "1646": 2000, "1170": 1250}},
            {"supplierId": 60, "sheetId": 16, "name": "Pessoa B", "inssCents": 30000,
             "components": {"EMPREGADO": 5000, "1138": 20000, "1646": 2500, "1170": 2500}},
        ],
    }


class ParserTests(unittest.TestCase):
    def test_uses_the_credit_applied_to_the_debit_excluding_prestador_retention(self):
        source = read_declaration(report(), CNPJ, COMPETENCE)
        result = plan_reconciliation(manifest(), source)
        self.assertEqual(source.receipt, "50000000001234")
        self.assertEqual((result.credit, result.gross, result.net), (10000, 48350, 38350))
        self.assertEqual((result.worker["supplierId"], result.worker["inssCents"] - result.credit), (10, 8350))

    def test_rejects_other_company_period_or_other_explanation_for_the_difference(self):
        for source in (report(cnpj="12345678000299"), report(month="202610"), report(net="0.00"),
                       report(code="116201"), report(credit="101.01", net="0.00")):
            with self.subTest(source=source[:100]), self.assertRaises(Review):
                plan_reconciliation(manifest(), read_declaration(source, CNPJ, COMPETENCE))

    def test_rejects_missing_or_multiple_marked_workers_and_mismatched_gross(self):
        source = read_declaration(report(), CNPJ, COMPETENCE)
        for mode in ("none", "multiple", "mismatch"):
            plan = manifest()
            if mode == "none":
                plan["rows"][0]["salaryFamilyReview"] = False
            elif mode == "multiple":
                plan["rows"][1]["salaryFamilyReview"] = True
            else:
                plan["rows"][0]["components"]["EMPREGADO"] -= 1
            with self.subTest(mode=mode), self.assertRaises(Review):
                plan_reconciliation(plan, source)

    def test_selects_latest_transmission_ignores_other_type_and_quarantines_conflict(self):
        first = report()
        latest = report(credit="60.00", net="41.00", sent="20261215120100", receipt="50000000001235")
        selection = select_declaration([latest, first, first, b"<eSocial/>"], CNPJ, COMPETENCE)
        self.assertEqual(selection.receipt, "50000000001235")
        conflict = report(credit="55.00", net="46.00", sent="20261215120100", receipt="50000000001236")
        with self.assertRaises(Review):
            select_declaration([latest, conflict], CNPJ, COMPETENCE)

    def test_resuming_receipt_takes_precedence_over_a_newer_attachment(self):
        old = report()
        newest = report(credit="60.00", net="41.00", sent="20261215120100", receipt="50000000001235")
        pending = read_declaration(old, CNPJ, COMPETENCE)
        self.assertEqual(select_declaration([newest, old], CNPJ, COMPETENCE, preferred_digest=pending.digest), pending)
        with self.assertRaises(Pending):
            select_declaration([newest], CNPJ, COMPETENCE, preferred_digest=pending.digest)


class MockLedger:
    def __init__(self):
        self.values = {"child": 18350, "payroll": 18350, "parent": 48350}
        self.writes = []
        self.fail = False
        self.closed = False

    def preflight(self, plan, adjustment, previous_credit, old_receipt, pending=False):
        if self.closed:
            raise Review("pagamento já efetuado")
        grosses = {"child": 18350, "payroll": 18350, "parent": 48350}
        for key, gross in grosses.items():
            allowed = {gross - previous_credit}
            if pending:
                allowed.add(gross - adjustment.credit)
            if self.values[key] not in allowed:
                raise Review("valor alterado")

    def apply(self, plan, adjustment, previous_credit, old_receipt):
        for key, gross in (("child", 18350), ("payroll", 18350), ("parent", 48350)):
            new = gross - adjustment.credit
            if self.values[key] != new:
                self.values[key] = new
                self.writes.append(key)
            if self.fail and key == "child":
                raise RuntimeError("interrupção simulada")

    def verify(self, plan, adjustment):
        assert self.values["parent"] == adjustment.net


class ReplayTests(unittest.TestCase):
    def test_resumes_a_partial_write_and_never_deducts_twice(self):
        first = read_declaration(report(), CNPJ, COMPETENCE)
        ledger = MockLedger()
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder) / "state.json"
            ledger.fail = True
            with self.assertRaises(RuntimeError):
                reconcile(ledger, manifest(), first, state)
            self.assertEqual(ledger.values, {"child": 8350, "payroll": 18350, "parent": 48350})
            ledger.fail = False
            self.assertEqual(reconcile(ledger, manifest(), first, state), "CONCILIADO")
            self.assertEqual(reconcile(ledger, manifest(), first, state), "CONCILIADO")
            self.assertEqual(ledger.writes, ["child", "payroll", "parent"])

    def test_new_transmission_replaces_the_previous_credit_and_stale_file_is_ignored(self):
        ledger = MockLedger()
        first = read_declaration(report(), CNPJ, COMPETENCE)
        second = read_declaration(
            report(credit="60.00", net="41.00", sent="20261215120100", receipt="50000000001235"), CNPJ, COMPETENCE,
        )
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder) / "state.json"
            reconcile(ledger, manifest(), first, state)
            reconcile(ledger, manifest(), second, state)
            self.assertEqual(reconcile(ledger, manifest(), first, state), "ORIGEM_SUPERADA")
            self.assertEqual(ledger.values, {"child": 12350, "payroll": 12350, "parent": 42350})

    def test_paid_provision_and_unexpected_amount_are_rejected_before_any_write(self):
        first = read_declaration(report(), CNPJ, COMPETENCE)
        for closed in (False, True):
            ledger = MockLedger()
            if closed:
                ledger.closed = True
            else:
                ledger.values["parent"] += 1
            with tempfile.TemporaryDirectory() as folder, self.assertRaises(Review):
                reconcile(ledger, manifest(), first, Path(folder) / "state.json")
            self.assertEqual(ledger.writes, [])
