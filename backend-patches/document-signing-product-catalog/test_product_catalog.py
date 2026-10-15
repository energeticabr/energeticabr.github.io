"""Behavioral regressions for the existing payment-receipt product chooser."""

import os
from pathlib import Path
import sys
import unittest

SOURCE = Path(os.environ.get("PRODUCT_CATALOG_SOURCE", "/opt/energetica-whatsapp"))
BUILD = Path("/home/opc/energetica-build")
sys.path.insert(0, str(BUILD / "worker"))
sys.path.insert(0, str(SOURCE / "worker"))

from clients import SharePointClient  # noqa: E402
from workflow import WorkflowEngine  # noqa: E402

sys.path.insert(0, str(BUILD / "tests"))
import test_workflow as fixtures  # noqa: E402


class PaymentProductCatalogTests(unittest.TestCase):
    def test_receipt_catalog_excludes_blocked_products_and_orders_active_ids_descending(self):
        client = SharePointClient.__new__(SharePointClient)
        client._resolve_source = lambda source, context: source
        client._internal_field = lambda _list, field: field
        client._list_endpoint = lambda _list: "catalog/items"
        rows = [
            {"Id": 8, "PRODUTO": "SERVIÇO ANTIGO", "UNIDADE": "UN", "SATUS": "BLOQUEADO"},
            {"Id": 13, "PRODUTO": "SERVIÇO NOVO", "UNIDADE": "UN", "SATUS": "ATIVO"},
            {"Id": 104, "PRODUTO": "SERVIÇO RECENTE", "UNIDADE": "UN", "SATUS": "ATIVO"},
        ]

        def read_only(method, _endpoint, **kwargs):
            self.assertEqual(method, "GET")
            params = kwargs["params"]
            self.assertEqual(params["$orderby"], "Id desc")
            filtered = [row for row in rows if row["SATUS"] == "ATIVO"] if "$filter" in params else rows
            return {"value": sorted(filtered, key=lambda row: row["Id"], reverse=True)}

        client._request = read_only
        step = WorkflowEngine._document_signing_payment_product_step()
        options = client.get_options(step, context={})

        self.assertEqual([option["id"] for option in options], [104, 13])
        self.assertTrue(all(option["source_values"]["SATUS"] == "ATIVO" for option in options))

    def test_typed_filter_query_returns_matching_product_without_invalid_selection_error(self):
        case = fixtures.WorkflowTests("runTest")
        case.setUp()
        self.addCleanup(case.doCleanups)
        case.sharepoint.options_by_key["document_signing_payment_product"] = [
            {"id": 104, "title": "104 - SERVIÇO RECENTE", "value": "SERVIÇO RECENTE",
             "source_values": {"Id": 104, "PRODUTO": "SERVIÇO RECENTE", "SATUS": "ATIVO"}},
            {"id": 8, "title": "8 - SERVIÇO ANTIGO", "value": "SERVIÇO ANTIGO",
             "source_values": {"Id": 8, "PRODUTO": "SERVIÇO ANTIGO", "SATUS": "ATIVO"}},
        ]
        state = {
            "key": "receipt-catalog-test", "batch_id": "receipt-catalog-test",
            "flow": "document_signing", "stage": "document_signing_payment_product",
            "phone_number_id": "portal-admin", "options": [], "processed_message_ids": [],
            "document_signing_payment_items": [],
        }
        self.assertTrue(case.engine._document_signing_prompt_payment_options(state, kind="product"))
        event = fixtures.event("typed-filter", "text", text="Serviço", reply_id="filter_query")

        result = case.engine._handle_document_signing_text(event, state, None)

        self.assertEqual(result["status"], "filtered_options")
        self.assertEqual(result["option_count"], 2)
        self.assertFalse(any("SELECIONE UM PRODUTO DA LISTA" in str(item) for item in case.messenger.sent))

    def test_numeric_filter_query_does_not_select_product_with_same_id(self):
        case = fixtures.WorkflowTests("runTest")
        case.setUp()
        self.addCleanup(case.doCleanups)
        case.sharepoint.options_by_key["document_signing_payment_product"] = [
            {"id": 12, "title": "12 - GASOLINA", "value": "GASOLINA",
             "source_values": {"Id": 12, "PRODUTO": "GASOLINA", "SATUS": "ATIVO"}},
            {"id": 120, "title": "120 - DIESEL", "value": "DIESEL",
             "source_values": {"Id": 120, "PRODUTO": "DIESEL", "SATUS": "ATIVO"}},
        ]
        state = {
            "key": "receipt-numeric-filter", "batch_id": "receipt-numeric-filter",
            "flow": "document_signing", "stage": "document_signing_payment_product",
            "phone_number_id": "portal-admin", "options": [], "processed_message_ids": [],
            "document_signing_payment_items": [],
        }
        self.assertTrue(case.engine._document_signing_prompt_payment_options(state, kind="product"))

        result = case.engine._handle_document_signing_text(
            fixtures.event("numeric-filter", "text", text="12", reply_id="filter_query"),
            state, None,
        )

        self.assertEqual(result["status"], "filtered_options")
        self.assertEqual(result["option_count"], 2)
        self.assertEqual(state["stage"], "document_signing_payment_product")
        self.assertEqual(case.messenger.sent[-1]["type"], "filtered_options")
        self.assertFalse(any("SELECIONE UM PRODUTO DA LISTA" in str(item) for item in case.messenger.sent))

        selected = case.engine._handle_document_signing_text(
            fixtures.event("selected-product", "button", text="12 - GASOLINA", reply_id="12"),
            state, result["etag"],
        )
        self.assertEqual(selected["status"], "awaiting_payment_quantity")
        self.assertEqual(state["stage"], "document_signing_payment_quantity")

    def test_unmatched_filter_query_does_not_report_invalid_product_selection(self):
        case = fixtures.WorkflowTests("runTest")
        case.setUp()
        self.addCleanup(case.doCleanups)
        case.sharepoint.options_by_key["document_signing_payment_product"] = [
            {"id": 12, "title": "12 - GASOLINA", "value": "GASOLINA",
             "source_values": {"Id": 12, "PRODUTO": "GASOLINA", "SATUS": "ATIVO"}},
        ]
        state = {
            "key": "receipt-no-match", "batch_id": "receipt-no-match",
            "flow": "document_signing", "stage": "document_signing_payment_product",
            "phone_number_id": "portal-admin", "options": [], "processed_message_ids": [],
            "document_signing_payment_items": [],
        }
        self.assertTrue(case.engine._document_signing_prompt_payment_options(state, kind="product"))

        result = case.engine._handle_document_signing_text(
            fixtures.event("unmatched-filter", "text", text="999", reply_id="filter_query"),
            state, None,
        )

        self.assertEqual(result["status"], "filtered_options")
        self.assertEqual(result["option_count"], 0)
        self.assertEqual(state["stage"], "document_signing_payment_product")
        self.assertEqual(case.messenger.sent[-1]["type"], "filtered_options")
        self.assertIn("NENHUM PRODUTO ENCONTRADO", case.messenger.sent[-1]["prompt"])
        self.assertFalse(any("SELECIONE UM PRODUTO DA LISTA" in str(item) for item in case.messenger.sent))

    def test_whatsapp_numeric_text_still_selects_product(self):
        case = fixtures.WorkflowTests("runTest")
        case.setUp()
        self.addCleanup(case.doCleanups)
        case.sharepoint.options_by_key["document_signing_payment_product"] = [
            {"id": 12, "title": "12 - GASOLINA", "value": "GASOLINA",
             "source_values": {"Id": 12, "PRODUTO": "GASOLINA", "SATUS": "ATIVO"}},
        ]
        state = {
            "key": "receipt-whatsapp-choice", "batch_id": "receipt-whatsapp-choice",
            "flow": "document_signing", "stage": "document_signing_payment_product",
            "phone_number_id": "business-phone-id", "options": [], "processed_message_ids": [],
            "document_signing_payment_items": [],
        }
        self.assertTrue(case.engine._document_signing_prompt_payment_options(state, kind="product"))

        result = case.engine._handle_document_signing_text(
            fixtures.event("whatsapp-choice", "text", text="12"), state, None,
        )

        self.assertEqual(result["status"], "awaiting_payment_quantity")
        self.assertEqual(state["stage"], "document_signing_payment_quantity")

    def test_old_portal_numeric_text_without_filter_marker_only_filters(self):
        case = fixtures.WorkflowTests("runTest")
        case.setUp()
        self.addCleanup(case.doCleanups)
        case.sharepoint.options_by_key["document_signing_payment_product"] = [
            {"id": 12, "title": "12 - GASOLINA", "value": "GASOLINA",
             "source_values": {"Id": 12, "PRODUTO": "GASOLINA", "SATUS": "ATIVO"}},
        ]
        state = {
            "key": "receipt-old-portal-filter", "batch_id": "receipt-old-portal-filter",
            "flow": "document_signing", "stage": "document_signing_payment_product",
            "phone_number_id": "portal-admin", "options": [], "processed_message_ids": [],
            "document_signing_payment_items": [],
        }
        self.assertTrue(case.engine._document_signing_prompt_payment_options(state, kind="product"))

        result = case.engine._handle_document_signing_text(
            fixtures.event("old-portal-filter", "text", text="12"), state, None,
        )

        self.assertEqual(result["status"], "filtered_options")
        self.assertEqual(state["stage"], "document_signing_payment_product")


if __name__ == "__main__":
    unittest.main()
