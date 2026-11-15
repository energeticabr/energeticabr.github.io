"""Exercise the gallery operation and the shared settlement writer together."""

import ast
from contextlib import contextmanager, nullcontext
from decimal import Decimal, InvalidOperation
import os
from pathlib import Path
import re
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


class Refused(Exception):
    pass


def fail(code, message, status=400):
    raise Refused(code, message, status)


def load_method(path, class_name, method_name):
    tree = ast.parse(path.read_bytes())
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == class_name)
    method = next((node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == method_name), None)
    if method is None:
        return None
    scope = {"Decimal": Decimal, "InvalidOperation": InvalidOperation, "LAUNCHES": "LANCAMENTOS",
             "_id": str, "_instant": lambda date: date, "_norm": lambda value: str(value or "").strip().upper(),
             "normalize_text": lambda value: str(value).strip().casefold(),
             "_fail": fail, "LaunchGalleryError": Refused, "PortalMediaStore": object, "os": os, "re": re}
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(path), "exec"), scope)
    return scope[method_name]


class Fixture:
    def __init__(self):
        path = Path(os.environ["MANUAL_LINK_SOURCE"])
        self.link = load_method(path / "launch_gallery.py", "LaunchGalleryService", "_confirm_provision_payroll_link")
        self.write_link = load_method(path / "workflow.py", "WorkflowEngine", "_settlement_has_payroll_link")
        self.engine = self
        self.sharepoint = self
        self.provision = {"IDFOLHA": 21.0, "FORNECEDOR": "RAFAEL", "TIPOPGTO": "SALÁRIO",
                          "IDLANCAMENTOS": "3810", "FILIAL": "004 - XAVANTE"}
        self.launch = {"FORNECEDOR": "RAFAEL", "IDPGTOAGENDADO": "471",
                       "DATA PGTO EFETUADO": "2026-11-14", "FILIAL": "004 - XAVANTE (TODOS)"}
        self.payroll = {"Title": "APP-folha-provisao-471", "FORNECEDOR": "RAFAEL", "TIPOPGTO": "SALÁRIO",
                        "IDFOLHA": "21", "IDPROVISAO": 471.0, "IDLANCAMENTO": None}
        self.writes = []
        self.preflight_checks = 0
        self.blocked_origin = False

    def _check_provision_payroll_origin(self, provision_id, launch_id):
        assert (provision_id, launch_id) == ("471", "3810")
        if self.blocked_origin:
            fail("payroll_allocation_locked", "O lançamento já foi rateado.", 409)

    def _get(self, list_name, item_id, fields):
        record = self.launch if list_name == "LANCAMENTOS" else self.provision
        return {field: record.get(field) for field in fields}

    def _settlement_has_payroll_link(self, *args, **kwargs):
        return self.write_link(self, *args, **kwargs)

    def get_options(self, *args):
        return [{"id": 189, "source_values": self.payroll.copy()}] if self.payroll else []

    def get_item_fields_with_etag(self, item_id, fields, target_list):
        return {field: self.payroll.get(field) for field in fields}, '"189,1"'

    @contextmanager
    def _settlement_payroll_origin_guard(self, launch_id, title, payroll_id):
        assert (launch_id, title, payroll_id) == (3810, "APP-folha-provisao-471", 189)
        self.preflight_checks += 1
        yield None

    def update_item_with_etag(self, item_id, fields, version, target_list):
        assert (item_id, version, target_list) == (189, '"189,1"', "FOLHAPGTO")
        self.writes.append(fields)
        self.payroll.update(fields)

    def save(self):
        if self.link is None:
            raise AssertionError("Manual reconciliation is not routed to the settlement writer")
        return self.link(self, {"provisionId": "471", "launchId": "3810"})


class ManualLinkTest(unittest.TestCase):
    def test_confirms_and_reuses_the_existing_salary_row(self):
        fixture = Fixture()
        self.assertEqual(fixture.save(), {"linked": True, "provisionId": "471", "launchId": "3810"})
        self.assertEqual(fixture.save()["linked"], True)
        self.assertEqual(fixture.writes, [{"IDLANCAMENTO": "3810"}])
        self.assertEqual(fixture.preflight_checks, 2)

    def test_bad_payroll_identity_and_other_launch_are_refused(self):
        for fields in ({"IDLANCAMENTO": "3999"}, {"FORNECEDOR": "OUTRO"}, {"TIPOPGTO": "ADIANTAMENTO"},
                       {"IDFOLHA": "22"}):
            with self.subTest(fields=fields):
                fixture = Fixture()
                fixture.payroll.update(fields)
                with self.assertRaises(Refused):
                    fixture.save()
                self.assertEqual(fixture.writes, [])
                self.assertEqual(fixture.preflight_checks, 0)

    def test_requires_the_exact_reciprocal_link_and_a_paid_launch(self):
        for fields in ({"IDPGTOAGENDADO": "472"}, {"DATA PGTO EFETUADO": None}, {"FORNECEDOR": "OUTRO"},
                       {"FILIAL": "005 - OUTRA"}, {"FILIAL": None}):
            with self.subTest(fields=fields):
                fixture = Fixture()
                fixture.launch.update(fields)
                with self.assertRaises(Refused):
                    fixture.save()
                self.assertEqual(fixture.writes, [])
                self.assertEqual(fixture.preflight_checks, 0)

    def test_missing_payroll_row_is_not_confirmed(self):
        fixture = Fixture()
        fixture.payroll = None
        with self.assertRaises(Refused):
            fixture.save()
        self.assertEqual(fixture.writes, [])

    def test_preflight_can_validate_unreserved_records_without_writing(self):
        fixture = Fixture()
        fixture.provision["IDLANCAMENTOS"] = None
        fixture.launch["IDPGTOAGENDADO"] = None
        self.assertEqual(fixture.link(fixture, {"provisionId": "471", "launchId": "3810", "checkOnly": True}),
                         {"ready": True, "provisionId": "471", "launchId": "3810"})
        self.assertEqual(fixture.writes, [])
        self.assertEqual(fixture.preflight_checks, 0)
        fixture.blocked_origin = True
        with self.assertRaises(Refused):
            fixture.link(fixture, {"provisionId": "471", "launchId": "3810", "checkOnly": True})

    def test_portal_access_alone_does_not_authorize_a_payroll_link(self):
        source = Path(os.environ["MANUAL_LINK_SOURCE"]) / "channel_bridge.py"
        route = load_method(source, "ChannelBridge", "portal_launch_gallery")
        identity = {"email": "financeiro@example.com"}
        fixture = Fixture()
        bridge = SimpleNamespace(lock=nullcontext(), _portal_state=lambda _: ("test", None),
                                 portal_owners=SimpleNamespace(authorize=lambda *args, **kwargs: None),
                                 engine=fixture)
        gallery = ModuleType("launch_gallery")
        gallery.LaunchGalleryService = lambda engine: SimpleNamespace(handle=lambda _operation, payload: engine.link(engine, payload))
        with patch.dict(sys.modules, {"launch_gallery": gallery}):
            with patch.dict(os.environ, {"PAYROLL_PENDING_ALLOWED_EMAILS": "outro@example.com"}):
                with self.assertRaises(PermissionError):
                    route(bridge, identity, "payroll_provision_link", {}, None, allowed_emails={identity["email"]})
                self.assertEqual(fixture.writes, [])
            with patch.dict(os.environ, {"PAYROLL_PENDING_ALLOWED_EMAILS": identity["email"]}):
                result = route(bridge, identity, "payroll_provision_link", {"provisionId": "471", "launchId": "3810"},
                               None, allowed_emails={identity["email"]})
                self.assertTrue(result["launchGallery"]["linked"])
