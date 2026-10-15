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


if __name__ == "__main__":
    unittest.main()
