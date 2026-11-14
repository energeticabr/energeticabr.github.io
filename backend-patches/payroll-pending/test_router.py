"""Exercise the real router and gallery methods using the captured source as a test input."""
import ast
import os
from pathlib import Path
from functools import lru_cache
from copy import deepcopy
import sys
from types import ModuleType, SimpleNamespace
import unittest


from patch_backend import change


BASELINE = os.environ.get("PAYROLL_ROUTER_BASELINE")


@lru_cache(maxsize=None)
def source_tree(relative, patch=True):
    path = Path(BASELINE) / relative
    raw = path.read_bytes()
    return ast.parse(change(relative, raw) if patch else raw)


def get_class(relative, class_name, methods, namespace, patch=True):
    path = Path(BASELINE) / relative
    source = source_tree(relative, patch)
    # Match by def as well as class name, so the route can move between classes.
    target = next(
        node for node in source.body if isinstance(node, ast.ClassDef)
        and (class_name is None or node.name == class_name)
        and all(any(getattr(method, "name", None) == name for method in node.body) for name in methods)
    )
    target = ast.ClassDef(name=target.name, bases=[], keywords=[], decorator_list=[],
                          body=[deepcopy(node) for node in target.body if getattr(node, "name", None) in methods],
                          type_params=[])
    ast.copy_location(target, next(node for node in source.body if getattr(node, "name", None) == target.name))
    exec(compile(ast.Module(body=[target], type_ignores=[]), str(path), "exec"), namespace)
    return namespace[target.name]


def get_gallery_dispatch():
    path = Path(BASELINE) / "channel_bridge.py"
    source = source_tree("channel_bridge.py")
    node = next(node for node in ast.walk(source) if isinstance(node, ast.If)
                and ast.unparse(node.test) == "action == 'launch_gallery'")
    wrapper = ast.parse("def dispatch(self, action, body, identity, origin):\n    pass")
    wrapper.body[0].body = [node]
    env = {"operation_stage": lambda *args: None}
    ast.fix_missing_locations(wrapper)
    exec(compile(wrapper, str(path), "exec"), env)
    return env["dispatch"]


class GalleryError(ValueError):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = {}


def fail(code, message, status=400):
    raise GalleryError(code, message, status)


@unittest.skipUnless(BASELINE, "Set PAYROLL_ROUTER_BASELINE to a worker source snapshot")
class RouterTests(unittest.TestCase):
    def setUp(self):
        self.recorded = []
        self.unresolved = False
        pending = ModuleType("payroll_pending")
        pending.handle = lambda instance, operation, payload: self.recorded.append((operation, payload)) or {"ok": True}
        self.module = dict(sys.modules)
        pending.has_unresolved_application = lambda gallery, item_id: self.unresolved
        sys.modules["payroll_pending"] = pending
        self.gallery = get_class(
            "worker/launch_gallery.py", "LaunchGalleryService",
            {"_handle", "_payroll_transfer_plan", "_pending_payroll_rows", "_guard_pending_payroll_origin"},
            {"_fail": fail, "_blank": lambda value: value in ("", None),
             "_literal": repr, "LAUNCHES": "LANCAMENTOS", "__package__": None,
             "_number": lambda value, blank_zero: float(value or 0),
             "_instant": lambda value: value, "_norm": lambda value: str(value).casefold()},
        )
        self.bridge = get_class("channel_bridge.py", None, {"portal_launch_gallery"}, {"PortalMediaStore": type})

    def tearDown(self):
        for key in ("launch_gallery", "payroll_pending"):
            if key in self.module:
                sys.modules[key] = self.module[key]
            else:
                sys.modules.pop(key, None)

    def test_authorized_bridge_dispatches_and_unapproved_identity_cannot_dispatch(self):
        class Lock:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

        module = ModuleType("launch_gallery")
        module.LaunchGalleryService = lambda engine: SimpleNamespace(handle=self.gallery()._handle)
        sys.modules["launch_gallery"] = module
        identity = {"mail": "usuario@example.com"}

        def authorize(key, caller, *, allowed_emails, **kwargs):
            if caller["mail"] not in allowed_emails:
                raise PermissionError("denied")
            self.recorded.append(("auth", key))

        bridge = self.bridge()
        bridge.lock = Lock()
        bridge.engine = object()
        bridge._portal_state = lambda caller: (caller["mail"], None)
        bridge.portal_owners = SimpleNamespace(authorize=authorize)
        with self.assertRaises(PermissionError):
            bridge.portal_launch_gallery(identity, "payroll_targets", {}, None, allowed_emails=set())
        self.assertEqual(self.recorded, [])
        for operation in ("payroll_pending", "payroll_targets", "payroll_detail", "payroll_apply", "payroll_legacy_link"):
            self.assertEqual(bridge.portal_launch_gallery(
                identity, operation, {}, None, allowed_emails={identity["mail"]})["launchGallery"], {"ok": True})
            self.assertEqual(self.recorded[-2:], [("auth", identity["mail"]), (operation, {})])

    def test_http_preserves_new_domain_errors_without_changing_ordinary_gallery_errors(self):
        module = ModuleType("launch_gallery")
        module.LaunchGalleryError = GalleryError
        sys.modules["launch_gallery"] = module

        def legacy_conflict(*args, **kwargs):
            raise GalleryError("payroll_apply_uncertain", "Resultado incerto", 409)

        request = SimpleNamespace(
            bridge=SimpleNamespace(portal_launch_gallery=legacy_conflict), portal_media_store=None,
            portal_authenticator=SimpleNamespace(allowed_emails={"usuario@example.com"}),
            _send_json=lambda status, body, **kwargs: (status, body),
        )
        dispatch = get_gallery_dispatch()
        self.assertEqual(dispatch(request, "launch_gallery", {"operation": "payroll_apply"}, {}, ""),
                         (409, {"error": "Resultado incerto", "code": "payroll_apply_uncertain"}))
        with self.assertRaises(GalleryError):
            dispatch(request, "launch_gallery", {"operation": "update"}, {}, "")

    def make_source(self, rows):
        gallery = self.gallery()
        gallery._rows = lambda name, labels, where: rows
        gallery._field = lambda name, label: {"InternalName": label, "TypeAsString": "Text"}
        return gallery

    def test_allocations_do_not_follow_supplier_edit(self):
        gallery = self.make_source([
            {"ID": 15, "IDLANCAMENTO": "1", "Title": "IDFOLHA-PENDENTE:token"},
            {"ID": 16, "IDLANCAMENTO": "1", "Title": "IDFOLHA-PENDENTE:another"},
        ])
        # Neither row needs its sheet or supplier consulted by the legacy transfer.
        self.assertEqual(gallery._payroll_transfer_plan("1", "OTHER", {"IDFOLHA": None}), ([], None))

    def test_origin_delete_and_changes_to_financial_record_are_blocked(self):
        gallery = self.make_source([{"ID": 15, "IDLANCAMENTO": "1", "Title": "IDFOLHA-PENDENTE:token"}])
        for operation, changes in (
            ("delete", {}), ("update", {"QUANTIDADE": 2}), ("update", {"FRETE": 2}),
            ("update", {"VALOR UNITÁRIO": 2}), ("update", {"DATA PGTO EFETUADO": None}),
            ("update", {"TIPO TRANSAÇÃO": "RECEITA"}),
        ):
            with self.subTest(operation=operation, changes=changes):
                with self.assertRaisesRegex(GalleryError, "IDFOLHA"):
                    gallery._guard_pending_payroll_origin("1", operation, changes, {
                        "QUANTIDADE": 1.0, "FRETE": None, "VALOR UNITÁRIO": 1,
                        "DATA PGTO EFETUADO": "2026-11-14T03:00:00Z", "TIPO TRANSAÇÃO": "DESPESA",
                    })
        gallery._guard_pending_payroll_origin("1", "update", {"FORNECEDOR": "OTHER"}, {})
        gallery._guard_pending_payroll_origin("1", "update", {"QUANTIDADE": 1.0}, {"QUANTIDADE": 1})

    def test_origin_is_protected_before_newly_applied_sharepoint_row_becomes_visible(self):
        self.unresolved = True
        with self.assertRaisesRegex(GalleryError, "IDFOLHA"):
            self.make_source([])._guard_pending_payroll_origin("1", "delete", {}, {})

    def test_legacy_link_is_not_subject_to_new_deletion_guard(self):
        gallery = self.make_source([{"ID": 15, "IDLANCAMENTO": "1", "Title": None}])
        gallery._guard_pending_payroll_origin("1", "delete", {}, {})


if __name__ == "__main__":
    unittest.main()
