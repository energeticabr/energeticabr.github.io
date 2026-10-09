"""Exercise the real launch snapshot; only SharePoint I/O uses its existing fixture.

GALLERY_SOURCE selects the backend containing worker/. GALLERY_FIXTURE_SOURCE
selects existing offline tests, so fetching other live backend files is unnecessary.
"""
import importlib.util
import os
from pathlib import Path
import sys
import unittest


REPO = Path(__file__).resolve().parents[2]
SOURCE = Path(os.environ.get("GALLERY_SOURCE", REPO / "backend-patches/launch-gallery-quick-search/candidate"))
FIXTURE_SOURCE = Path(os.environ.get("GALLERY_FIXTURE_SOURCE", REPO / "apps/energetico-mobile/.superpowers/single-launch-candidate"))
spec = importlib.util.spec_from_file_location("gallery_search_fixtures", FIXTURE_SOURCE / "tests/test_launch_gallery.py")
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
# The fixture adds its own old worker directory; the selected live candidate wins.
sys.path.insert(0, str(SOURCE / "worker"))
import launch_gallery


class QuickSearchTests(unittest.TestCase):
    def setUp(self):
        self.service, self.sp, _ = fixtures.make_env()

    def snapshot(self, search, **payload):
        filters = payload.pop("filters", {}) | {"search": search}
        try:
            return self.service.handle("snapshot", {"filters": filters, **payload})
        except launch_gallery.LaunchGalleryError as exc:
            self.fail(f"Valid quick search was rejected: {exc.code}: {exc}")

    def test_all_terms_can_match_different_fields_without_case_or_accents(self):
        self.sp.rows["LANCAMENTOS"][0].update(field_5="ÁGUA São José", field_7="AÇO", field_16="Revisão elétrica")
        result = self.snapshot("  AGUA\taco\nREVISAO\u00a0ELETRICA  ")
        self.assertEqual([row["id"] for row in result["rows"]], ["1"])
        self.assertEqual(result["totals"]["total"], 24)

    def test_each_requested_text_field_is_searchable(self):
        cases = [
            ("field_5", "Fornécédor Exclusivo", "fornecedor exclusivo"),
            ("field_7", "Máquina Especial", "maquina especial"),
            ("field_16", "Inspeção única", "inspecao unica"),
            ("field_14", "Poupança Teste", "poupanca teste"),
            ("field_19", "Concluído Especial", "concluido especial"),
            ("Title", "Filial Única", "filial unica"),
            ("field_6", "Instalação Única", "instalacao unica"),
            ("APROVACAO", "Aprovação Especial", "aprovacao especial"),
        ]
        for field, value, query in cases:
            with self.subTest(field=field):
                self.setUp()
                self.sp.rows["LANCAMENTOS"][0][field] = value
                self.assertEqual([row["id"] for row in self.snapshot(query)["rows"]], ["1"])

    def test_terms_use_and_and_do_not_cross_between_records(self):
        rows = self.sp.rows["LANCAMENTOS"]
        rows[0]["field_5"] = "Fornecedor Singular"
        rows[1]["field_7"] = "Produto Distinto"
        result = self.snapshot("singular distinto")
        self.assertEqual((result["rows"], result["count"], result["pages"]), ([], 0, 0))
        self.assertEqual(result["totals"], dict(committed=0, liquidated=0, pending=0, paid=0, total=0))

    def test_substrings_are_literal_and_regex_characters_have_no_special_meaning(self):
        self.sp.rows["LANCAMENTOS"][0]["field_16"] = "[A+B] inspeção"
        self.assertEqual([row["id"] for row in self.snapshot("[a+b] inspec")["rows"]], ["1"])
        self.assertEqual(self.snapshot(".*")["count"], 0)

    def test_description_html_entities_match_visible_text(self):
        self.sp.rows["LANCAMENTOS"][0]["field_16"] = "<p>Inspe&ccedil;&atilde;o el&eacute;trica</p>"
        self.assertEqual([row["id"] for row in self.snapshot("inspecao eletrica")["rows"]], ["1"])

    def test_description_markup_entities_and_attributes_are_not_searchable(self):
        self.sp.rows["LANCAMENTOS"][0]["field_16"] = '<p data-marker="attribute-only">Inspe&ccedil;&atilde;o</p>'
        for query in ("ccedil", "atilde", "<p", "attribute-only"):
            with self.subTest(query=query):
                self.assertEqual(self.snapshot(query)["count"], 0)

    def test_description_script_and_style_are_inert_and_excluded(self):
        self.sp.rows["LANCAMENTOS"][0]["field_16"] = (
            '<script>script-only marker</script><style>.style-only{color:red}</style>'
            '<p>Inspeção elétrica</p>')
        self.assertEqual([row["id"] for row in self.snapshot("inspecao eletrica")["rows"]], ["1"])
        for query in ("script-only", "style-only", "color:red"):
            with self.subTest(query=query):
                self.assertEqual(self.snapshot(query)["count"], 0)

    def test_description_block_boundaries_do_not_join_unrelated_words(self):
        self.sp.rows["LANCAMENTOS"][0]["field_16"] = "<p>inspe</p><p>cao</p><div>elet</div><div>rica</div>"
        self.assertEqual(self.snapshot("inspecao")["count"], 0)
        self.assertEqual(self.snapshot("eletrica")["count"], 0)
        self.assertEqual([row["id"] for row in self.snapshot("inspe cao elet rica")["rows"]], ["1"])

    def test_description_inline_markup_preserves_visible_words_and_line_breaks(self):
        self.sp.rows["LANCAMENTOS"][0]["field_16"] = "<p>Inspe<strong>ção</strong><br>elétrica&nbsp;local</p>"
        self.assertEqual([row["id"] for row in self.snapshot("inspecao eletrica local")["rows"]], ["1"])

    def test_html_decoding_is_limited_to_description(self):
        self.sp.rows["LANCAMENTOS"][0].update(field_5="Supplier&ccedil;", field_16="Visita")
        self.assertEqual([row["id"] for row in self.snapshot("ccedil")["rows"]], ["1"])
        self.assertEqual(self.snapshot("supplierc")["count"], 0)

    def test_search_looks_at_every_sharepoint_page_before_ui_paging_and_totals(self):
        self.sp.rows["LANCAMENTOS"] = [self.sp.launch(i) for i in range(1, 102)]
        for row in self.sp.rows["LANCAMENTOS"]:
            row["field_16"] = "correspondência" if row["Id"] in (1, 51, 101) else "outro"
        result = self.snapshot("correspondencia", page=2, pageSize=2)
        self.assertEqual([row["id"] for row in result["rows"]], ["1"])
        self.assertEqual((result["count"], result["pages"], result["pageSize"]), (3, 2, 2))
        self.assertEqual(result["totals"], dict(committed=72, liquidated=0, pending=72, paid=0, total=72))

    def test_search_preserves_payment_category_totals_and_filter_options(self):
        self.sp.rows["LANCAMENTOS"][1]["field_5"] = "OUTRO"
        result = self.snapshot("d'agua", pageSize=1)
        self.assertEqual(result["count"], 2)
        self.assertEqual(result["totals"], dict(committed=24, liquidated=0, pending=24, paid=24, total=48))
        self.assertEqual(result["filterOptions"]["supplier"], ["D'ÁGUA"])

    def test_all_structured_filters_are_intersected_with_search(self):
        self.sp.rows["LANCAMENTOS"][0]["field_16"] = "agulha especial"
        filters = dict(branch="OBRA A", supplier="D'ÁGUA", product="CIMENTO", stage="FUNDAÇÃO",
                       contract="7", id="1", status="PEDIDO EMPENHADO", pendingApproval=True,
                       dateStart="19/09/2026", dateEnd="2026-09-19")
        self.assertEqual(self.snapshot("agulha", filters=filters)["count"], 1)
        mismatches = dict(branch="OBRA B", supplier="OUTRO", product="OUTRO", stage="OUTRA",
                          contract="8", id="2", status="LIQUIDADO",
                          dateStart="2026-09-20", dateEnd="2026-09-18")
        for key, value in mismatches.items():
            with self.subTest(filter=key):
                self.assertEqual(self.snapshot("agulha", filters={key: value})["count"], 0)
        self.sp.rows["LANCAMENTOS"][0]["APROVACAO"] = "APROVADO"
        self.assertEqual(self.snapshot("agulha", filters={"pendingApproval": True})["count"], 0)

    def test_ids_and_linked_ids_are_searchable(self):
        self.sp.schemas["LANCAMENTOS"] += [fixtures.field("IDPGTOAGENDADO"), fixtures.field("IDFOLHA", kind="Number")]
        self.sp.rows["LANCAMENTOS"][0].update(CONTRATO="7788", MEDICAOPARCIAL="8899", IDPGTOAGENDADO="9911", IDFOLHA=4455)
        for query in ("1", "7788", "8899", "9911", "4455"):
            with self.subTest(query=query):
                result = self.snapshot(query, filters={"id": "1"})
                self.assertEqual([row["id"] for row in result["rows"]], ["1"])

    def test_dates_accept_iso_and_brazilian_civil_format(self):
        self.sp.schemas["LANCAMENTOS"] += [fixtures.field("DATA RMS", "DATARMS", "DateTime")]
        self.sp.rows["LANCAMENTOS"][0].update(field_2="2026-10-09T02:59:59Z", DATARMS="2026-07-15T03:00:00Z")
        cases = [("2026-10-09", ["1"]), ("08/10/2026", ["1"]), ("20/09/2026", ["2"]),
                 ("19/09/2026", ["3", "2", "1"]), ("18/09/2026", ["3", "2", "1"]),
                 ("15/07/2026", ["1"])]
        for query, expected in cases:
            with self.subTest(query=query):
                self.assertEqual([row["id"] for row in self.snapshot(query)["rows"]], expected)

    def test_numeric_values_accept_decimal_and_brazilian_display_formats(self):
        self.sp.rows["LANCAMENTOS"][0].update(field_8=2, field_9="1234.56", field_10="7.89")
        for query in ("1234.56", "1234,56", "1.234,56", "7,89", "2477.01", "2.477,01"):
            with self.subTest(query=query):
                self.assertEqual([row["id"] for row in self.snapshot(query)["rows"]], ["1"])
        self.sp.rows["LANCAMENTOS"][0]["field_8"] = 987
        self.assertEqual([row["id"] for row in self.snapshot("987")["rows"]], ["1"])

    def test_currency_display_can_be_pasted_with_its_prefix(self):
        self.sp.rows["LANCAMENTOS"][0].update(field_8=2, field_9="1234.56", field_10="7.89")
        self.assertEqual([row["id"] for row in self.snapshot("R$ 2.477,01")["rows"]], ["1"])

    def test_iso_civil_date_matches_the_sao_paulo_day_at_utc_boundary(self):
        self.sp.rows["LANCAMENTOS"][0]["field_2"] = "2026-10-09T02:59:59Z"
        self.assertEqual([row["id"] for row in self.snapshot("2026-10-08")["rows"]], ["1"])

    def test_full_timestamp_does_not_add_a_brazilian_alias_for_its_utc_prefix(self):
        self.sp.rows["LANCAMENTOS"][0]["field_2"] = "2026-10-09T02:59:59Z"
        self.assertEqual([row["id"] for row in self.snapshot("08/10/2026")["rows"]], ["1"])
        self.assertEqual(self.snapshot("09/10/2026")["count"], 0)
        self.assertEqual([row["id"] for row in self.snapshot("2026-10-09T02:59:59Z")["rows"]], ["1"])

    def test_missing_values_metadata_and_signature_do_not_produce_matches(self):
        self.sp.rows["LANCAMENTOS"][0].update(field_16=None, ASSINATURA="private-signature-marker",
                                            __metadata={"uri": "private-metadata-marker"})
        for query in ("none", "null", "private-signature-marker", "private-metadata-marker", "field_5"):
            with self.subTest(query=query):
                self.assertEqual(self.snapshot(query)["count"], 0)

    def test_absent_empty_and_whitespace_search_preserve_snapshot_exactly(self):
        self.sp.schemas["LANCAMENTOS"] += [fixtures.field("IDFOLHA", kind="Number")]
        self.sp.rows["LANCAMENTOS"][0]["IDFOLHA"] = 4455
        for payload in ({}, {"filters": {"supplier": "D'ÁGUA"}, "page": 2, "pageSize": 2}):
            expected = self.service.handle("snapshot", payload)
            for query in ("", " \t\r\n\u00a0 "):
                with self.subTest(payload=payload, query=query):
                    self.assertEqual(self.snapshot(query, **payload), expected)

    def test_invalid_search_is_rejected_before_sharepoint_io_without_echoing_input(self):
        invalid = [None, True, 123, 1.5, [], {}, "x" * 513, "unsafe\x00marker", "unsafe\x1bmarker", "unsafe\ud800marker"]
        for query in invalid:
            with self.subTest(query=repr(query)):
                self.setUp()
                with self.assertRaises(launch_gallery.LaunchGalleryError) as rejected:
                    self.service.handle("snapshot", {"filters": {"search": query}})
                self.assertEqual(rejected.exception.code, "invalid_filter")
                self.assertEqual(rejected.exception.status, 400)
                self.assertEqual(rejected.exception.details, {})
                self.assertNotIn("unsafe", str(rejected.exception))
                self.assertEqual(self.sp.calls, [])
        self.sp.rows["LANCAMENTOS"][0]["field_16"] = "x" * 512
        self.assertEqual(self.snapshot("x" * 512)["count"], 1)

    def test_search_never_enters_the_sharepoint_query(self):
        query = "x' or Id gt 0 or 'x' eq 'x"
        self.sp.rows["LANCAMENTOS"][0]["field_16"] = query
        result = self.snapshot(query, filters={"supplier": "D'ÁGUA"})
        self.assertEqual([row["id"] for row in result["rows"]], ["1"])
        params = next(kw["params"] for _, ep, kw in self.sp.calls if ep.endswith("/items"))
        self.assertEqual(params["$filter"], "field_5 eq 'D''ÁGUA'")
        self.assertNotIn(query, str(self.sp.calls))
        self.assertEqual(self.sp.mutations, [])

    def test_sort_and_out_of_range_pages_keep_filtered_totals(self):
        result = self.snapshot("cimento", sort="MAIOR DATA PGTO PREVISTO", pageSize=1)
        self.assertEqual([row["id"] for row in result["rows"]], ["2"])
        result = self.snapshot("cimento", page=99)
        self.assertEqual((result["rows"], result["count"], result["pages"]), ([], 3, 1))
        self.assertEqual(result["totals"]["total"], 72)

    def test_other_gallery_operations_do_not_accept_search(self):
        with self.assertRaises(launch_gallery.LaunchGalleryError) as rejected:
            self.service.handle("detail", {"id": "1", "search": "cimento"})
        self.assertEqual(rejected.exception.code, "invalid_payload")
        self.assertEqual(self.sp.calls, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
