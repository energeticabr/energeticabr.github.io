"""Delete through the real gallery; simulate only SharePoint's REST boundary."""
import os
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest
from urllib.parse import urlencode

source = Path(os.environ["GALLERY_SOURCE"]).resolve()
sys.path[:0] = [str(source / "worker"), os.environ["GALLERY_FIXTURES"]]
from launch_gallery import LaunchGalleryError, LaunchGalleryService
from test_launch_gallery import SharePoint, base_fields, mutation


class DeletionSharePoint(SharePoint):
    def __init__(self):
        super().__init__()
        self.schemas["NOTASPENDENTES"] = base_fields()
        self.rows["NOTASPENDENTES"] = [{"Id": 17}, {"Id": 117}, {"Id": 99}]
        self.rows["LANCAMENTOS"][0]["AGRUPAR"] = "17"
        self.rows["LANCAMENTOS"][1]["AGRUPAR"] = "117"
        self.link_read = None
        self.after_launch_delete = None
        self.order_conflict = False
        self.order_schema_missing = False

    def _request(self, method, endpoint, **kw):
        name, item = re.search(r"GetByTitle\('([^']+)'\)(?:/items\((\d+)\))?", endpoint).groups()
        query = (kw.get("params") or {}).get("$filter")
        if self.link_read == "wrong-list" and name == "NOTASPENDENTES" and "%24skiptoken=" in endpoint:
            return {"value": []}
        if method == "GET" and name == "NOTASPENDENTES" and endpoint.endswith("/fields"):
            if self.order_schema_missing:
                self.error(404)
        if method == "GET" and name == "LANCAMENTOS" and not item and "/items" in endpoint:
            if self.link_read == "fail":
                self.error(503)
            if self.link_read == "bad":
                return {"value": [{"Id": 2}]}
            if self.link_read == "bad-cursor":
                return {"value": [], "@odata.nextLink": "/not-a-sharepoint-page"}
            if self.link_read == "bad-envelope":
                return {"d": []}
            if self.link_read in {"page-two", "wrong-list", "wrong-filter", "conflicting-links", "duplicate-filter"}:
                if "%24skiptoken=" in endpoint:
                    return {"value": [{"Id": 3, "AGRUPAR": "17"}] if self.link_read == "page-two" else []}
                path = endpoint if self.link_read != "wrong-list" else endpoint.replace("LANCAMENTOS", "NOTASPENDENTES")
                filter_by = "AGRUPAR eq '117'" if self.link_read == "wrong-filter" else "AGRUPAR eq '17'"
                cursor = urlencode({"$filter": filter_by, "$skiptoken": "Paged=TRUE&p_ID=2"})
                if self.link_read == "duplicate-filter":
                    cursor += "&%24filter="
                result = {"value": [], "@odata.nextLink": self.site_url + "/_api/" + path + "?" + cursor}
                if self.link_read == "conflicting-links":
                    result["odata.nextLink"] = "https://elsewhere.invalid/items"
                return result
            assert query == "AGRUPAR eq '17'", query
            return {"value": [row for row in self.rows[name] if row.get("AGRUPAR") == "17"]}
        if method == "POST" and name == "NOTASPENDENTES" and item == "17" and self.order_conflict:
            self.error(412)
        result = super()._request(method, endpoint, **kw)
        if method == "POST" and name == "LANCAMENTOS" and item == "1" and self.after_launch_delete:
            self.after_launch_delete()
        return result


class DeleteLaunchTests(unittest.TestCase):
    def setUp(self):
        self.sp = DeletionSharePoint()
        self.service = LaunchGalleryService(SimpleNamespace(sharepoint=self.sp))

    def remaining(self, name):
        return [row["Id"] for row in self.sp.rows[name]]

    def delete(self, **kw):
        return self.service.handle("delete", mutation() | kw)

    def test_last_link_deletes_only_its_order(self):
        self.assertTrue(self.delete()["ok"])
        self.assertEqual(self.remaining("LANCAMENTOS"), [2, 3])
        self.assertEqual(self.remaining("NOTASPENDENTES"), [117, 99])
        self.assertEqual([call[2]["headers"]["IF-MATCH"] for call in self.sp.mutations], ['"1"', '"1"'])
        self.assertIn("LANCAMENTOS", self.sp.mutations[0][1])

    def test_existing_sibling_keeps_order(self):
        self.sp.rows["LANCAMENTOS"][2]["AGRUPAR"] = "17"
        self.delete()
        self.assertEqual(self.remaining("NOTASPENDENTES"), [17, 117, 99])
        self.assertEqual(len(self.sp.mutations), 1)

    def test_sibling_on_next_page_keeps_order(self):
        self.sp.link_read = "page-two"
        self.delete()
        self.assertEqual(self.remaining("NOTASPENDENTES"), [17, 117, 99])

    def test_sibling_added_after_launch_delete_keeps_order(self):
        self.sp.after_launch_delete = lambda: self.sp.rows["LANCAMENTOS"][-1].update(AGRUPAR="17")
        self.delete()
        self.assertEqual(self.remaining("NOTASPENDENTES"), [17, 117, 99])

    def test_non_order_group_does_not_touch_orders(self):
        for grouping in ("EMPENHADO HOJE", None, "17/117"):
            with self.subTest(grouping=grouping):
                self.setUp()
                self.sp.rows["LANCAMENTOS"][0]["AGRUPAR"] = grouping
                self.assertTrue(self.delete()["ok"])
                self.assertEqual(self.remaining("NOTASPENDENTES"), [17, 117, 99])
                self.assertFalse(any("NOTASPENDENTES" in call[1] for call in self.sp.calls))

    def test_order_already_missing_is_safe(self):
        self.sp.rows["NOTASPENDENTES"].pop(0)
        self.assertTrue(self.delete()["ok"])
        self.assertEqual(self.remaining("LANCAMENTOS"), [2, 3])
        self.assertEqual(self.remaining("NOTASPENDENTES"), [117, 99])

    def test_stale_launch_does_not_delete_launch_or_order(self):
        with self.assertRaises(LaunchGalleryError) as caught:
            self.delete(expectedModified="2025-01-01T00:00:00Z")
        self.assertEqual(caught.exception.code, "conflict")
        self.assertEqual(self.sp.mutations, [])

    def test_failed_launch_delete_does_not_delete_order(self):
        self.sp.fail_link = True
        with self.assertRaises(LaunchGalleryError):
            self.delete()
        self.assertEqual(self.remaining("LANCAMENTOS"), [1, 2, 3])
        self.assertEqual(self.remaining("NOTASPENDENTES"), [17, 117, 99])

    def test_failed_or_incomplete_link_read_reports_partial_without_deleting_order(self):
        for failure in ("fail", "bad", "bad-cursor", "bad-envelope", "wrong-list", "wrong-filter", "conflicting-links", "duplicate-filter"):
            with self.subTest(failure=failure):
                self.setUp()
                self.sp.after_launch_delete = lambda: setattr(self.sp, "link_read", failure)
                with self.assertRaises(LaunchGalleryError) as caught:
                    self.delete()
                self.assertEqual(caught.exception.code, "order_cleanup_incomplete")
                self.assertEqual(caught.exception.details, {"launchDeleted": True, "orderId": "17"})
                self.assertEqual(self.remaining("LANCAMENTOS"), [2, 3])
                self.assertEqual(self.remaining("NOTASPENDENTES"), [17, 117, 99])

    def test_order_list_error_before_delete_preserves_both(self):
        self.sp.order_schema_missing = True
        with self.assertRaises(LaunchGalleryError):
            self.delete()
        self.assertEqual(self.remaining("LANCAMENTOS"), [1, 2, 3])
        self.assertEqual(self.remaining("NOTASPENDENTES"), [17, 117, 99])

    def test_changed_order_is_preserved_and_reported(self):
        self.sp.order_conflict = True
        with self.assertRaises(LaunchGalleryError) as caught:
            self.delete()
        self.assertEqual(caught.exception.code, "order_cleanup_incomplete")
        self.assertEqual(self.remaining("LANCAMENTOS"), [2, 3])
        self.assertEqual(self.remaining("NOTASPENDENTES"), [17, 117, 99])


if __name__ == "__main__":
    unittest.main()
