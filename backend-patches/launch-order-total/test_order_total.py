"""Regression coverage at the Gallery service's SharePoint boundary."""
import os
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest
from urllib.parse import parse_qs, urlencode, urlsplit

source = Path(os.environ["GALLERY_SOURCE"]).resolve()
sys.path[:0] = [str(source / "worker"), os.environ["GALLERY_FIXTURES"]]
from launch_gallery import LaunchGalleryError, LaunchGalleryService
from test_launch_gallery import SharePoint, base_fields, field, mutation


NOTE = ("Observação manual preservada.\nDESCONTO GLOBAL DO LOTE:\n"
        "VALOR GLOBAL: R$ 35,10.\nDESCONTO GLOBAL: R$ 4,00.\n"
        "VALOR GLOBAL APÓS DESCONTO: R$ 31,10.")


class LinkedOrders(SharePoint):
    def __init__(self):
        super().__init__()
        self.schemas["NOTASPENDENTES"] = base_fields() + [field("VALORTOTAL"), field("OBS", kind="Note")]
        self.rows["NOTASPENDENTES"] = [
            {"Id": 17, "VALORTOTAL": "31,1", "OBS": NOTE},
            {"Id": 18, "VALORTOTAL": "99,99", "OBS": "Anotação independente"},
        ]
        for row, (group, quantity, price, freight) in zip(self.rows["LANCAMENTOS"], (
                ("17", 1, 4.34159544159544, 0), ("18", 1, 99.99, 0), ("17", 2, 13.129, 0.5))):
            row.update(AGRUPAR=group, field_8=quantity, field_9=price, field_10=freight)
        self.bad_page = None
        self.conflicts = 0
        self.read_failure = False
        self.stale_price = None

    def _request(self, method, endpoint, **kw):
        name, item = re.search(r"GetByTitle\('([^']+)'\)(?:/items\((\d+)\))?", endpoint).groups()
        if method == "GET" and name == "LANCAMENTOS" and not item and "/items" in endpoint:
            self.calls.append((method, endpoint, kw))
            if self.read_failure:
                self.read_failure = False
                self.error(503)
            params = kw.get("params") or {k: v[0] for k, v in parse_qs(urlsplit(endpoint).query).items()}
            group = re.fullmatch(r"AGRUPAR eq '(\d+)'", params["$filter"])[1]
            rows = [r for r in self.rows[name] if r.get("AGRUPAR") == group]
            rows = [{k: r[k] for k in params["$select"].split(",") if k in r} for r in rows]
            if self.stale_price is not None:
                for row in rows:
                    if row["Id"] == 1:
                        row["field_9"] = self.stale_price
            if "$skiptoken" in params:
                if self.bad_page == "repeat":
                    return {"value": rows[:1]}
                if self.bad_page == "missing-amount":
                    rows[-1].pop("field_9")
                return {"value": rows[1:]}
            if len(rows) < 2:
                return {"value": rows}
            next_params = params | {"$skiptoken": "Paged=TRUE&p_ID=1"}
            if self.bad_page == "wrong-filter":
                next_params["$filter"] = "AGRUPAR eq '18'"
            return {"value": rows[:1], "odata.nextLink": self.site_url + "/_api/" + endpoint + "?" + urlencode(next_params)}
        if method == "POST" and name == "NOTASPENDENTES" and kw["headers"]["X-HTTP-Method"] == "MERGE" and self.conflicts:
            self.conflicts -= 1
            self.error(412)
        return super()._request(method, endpoint, **kw)


class OrderTotalTests(unittest.TestCase):
    def setUp(self):
        self.sp = LinkedOrders()
        self.service = LaunchGalleryService(SimpleNamespace(sharepoint=self.sp))
        self.order = self.sp.rows["NOTASPENDENTES"][0]

    def edit(self, **fields):
        return self.service.handle("update", mutation(fields=fields))

    def test_price_edit_recalculates_all_pages_once_preserving_discount(self):
        self.assertTrue(self.edit(**{"VALOR UNITÁRIO": "14,3415954415954"})["ok"])
        self.assertEqual(self.order["VALORTOTAL"], "41,10")
        self.assertEqual(self.order["OBS"], NOTE.replace("35,10", "45,10").replace("31,10", "41,10"))
        self.assertEqual(self.sp.rows["NOTASPENDENTES"][1]["VALORTOTAL"], "99,99")
        self.assertEqual(self.sp.mutations[-1][2]["headers"]["IF-MATCH"], '"1"')

    def test_deleting_one_line_updates_remaining_order(self):
        self.assertTrue(self.service.handle("delete", mutation())["ok"])
        self.assertEqual(self.order["VALORTOTAL"], "26,76")

    def test_replacing_numeric_link_with_workflow_label_updates_former_order(self):
        self.assertTrue(self.edit(AGRUPAR="EMPENHADO HOJE")["ok"])
        self.assertEqual(self.order["VALORTOTAL"], "26,76")

    def test_non_financial_edit_preserves_order(self):
        self.edit(**{"DESCRIÇÃO": "Texto revisado"})
        self.assertEqual(self.order["VALORTOTAL"], "31,1")
        self.assertFalse(any("NOTASPENDENTES" in endpoint for _, endpoint, _ in self.sp.calls))

    def test_quantity_and_freight_are_part_of_total(self):
        self.edit(QUANTIDADE=2, FRETE="1,53")
        self.assertEqual(self.order["VALORTOTAL"], "36,97")

    def test_retry_refreshes_after_order_conflict(self):
        self.sp.conflicts = 1
        self.edit(**{"VALOR UNITÁRIO": "14,3415954415954"})
        self.assertEqual(self.order["VALORTOTAL"], "41,10")
        self.assertEqual(self.sp.conflicts, 0)

    def test_retries_transient_page_failure_without_repeating_launch_write(self):
        self.sp.read_failure = True
        self.edit(**{"VALOR UNITÁRIO": "14,3415954415954"})
        self.assertEqual(self.order["VALORTOTAL"], "41,10")
        self.assertEqual(sum("LANCAMENTOS" in request[1] for request in self.sp.mutations), 1)

    def test_stale_launch_read_never_confirms_the_old_balance(self):
        self.sp.stale_price = 4.34159544159544
        with self.assertRaises(LaunchGalleryError) as caught:
            self.edit(**{"VALOR UNITÁRIO": "14,3415954415954"})
        self.assertEqual(caught.exception.code, "order_total_incomplete")
        self.assertEqual(self.order["VALORTOTAL"], "31,1")
        self.assertEqual(len(self.sp.mutations), 1)

    def test_invalid_pages_never_overwrite_total(self):
        for problem in ("wrong-filter", "repeat", "missing-amount"):
            with self.subTest(problem=problem):
                self.setUp()
                self.sp.bad_page = problem
                with self.assertRaises(LaunchGalleryError) as caught:
                    self.edit(FRETE=10)
                self.assertEqual(caught.exception.code, "order_total_incomplete")
                self.assertEqual(caught.exception.details["launchUpdated"], True)
                self.assertEqual(self.order["VALORTOTAL"], "31,1")

    def test_duplicate_amount_submission_is_idempotent_and_repairs_stale_total(self):
        self.sp.rows["LANCAMENTOS"][0]["field_9"] = 14.3415954415954
        self.edit(**{"VALOR UNITÁRIO": "14,3415954415954"})
        self.assertEqual(self.order["VALORTOTAL"], "41,10")

    def test_rounds_the_sum_and_keeps_manual_notes(self):
        self.order["OBS"] = "A nota não altera o total."
        self.sp.rows["LANCAMENTOS"][2].update(field_8=1, field_9=1.004, field_10=0)
        self.edit(**{"VALOR UNITÁRIO": "1,004"})
        self.assertEqual(self.order["VALORTOTAL"], "2,01")
        self.assertEqual(self.order["OBS"], "A nota não altera o total.")

    def test_adjustment_increase_is_preserved(self):
        self.order.update(OBS=NOTE.replace("DESCONTO", "ACRÉSCIMO").replace("35,10", "27,10"))
        self.edit(**{"VALOR UNITÁRIO": "14,3415954415954"})
        self.assertEqual(self.order["VALORTOTAL"], "41,10")
        self.assertIn("VALOR GLOBAL: R$ 37,10.", self.order["OBS"])
        self.assertIn("ACRÉSCIMO GLOBAL: R$ 4,00.", self.order["OBS"])
        self.assertIn("VALOR GLOBAL APÓS ACRÉSCIMO: R$ 41,10.", self.order["OBS"])


if __name__ == "__main__":
    unittest.main()
