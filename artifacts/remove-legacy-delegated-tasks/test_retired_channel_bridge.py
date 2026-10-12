"""Offline tests of the two real retired ChannelBridge methods.

Only external SharePoint/state/media boundaries use memory fixtures. Portal
identity and owner authorization run unchanged against a temporary owner store.
Run with QA Python -X utf8 -B; --bridge selects baseline or updated copy.
"""
import argparse
import copy
import importlib.util
import sys
import tempfile
import threading
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch


WORKSPACE = Path("C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr")
MIRROR = WORKSPACE / "artifacts/pending-attendance-checkboxes-20261012/candidate"
ARTIFACT = Path(__file__).resolve().parent
BUNDLED_SITE_PACKAGES = Path("C:/Users/Bernardonotini/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/Lib/site-packages")
IDENTITY = {"oid": "entra-user-1", "email": "owner@example.test", "name": "Owner"}
ALLOWED_EMAILS = {"owner@example.test"}


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def cases(bridge_module, fixtures):
    class RetiredChannelBridgeTests(unittest.TestCase):
        def setUp(self):
            fixture = fixtures.WorkflowTests()
            fixture.setUp()
            self.engine = fixture.engine
            self.store = fixture.state
            self.sharepoint = fixture.sharepoint
            self.task_rows = [
                {"Id": 81, "TAREFA": "LEGACY TASK ONE", "STATUS": "ATIVIDADE CRIADA", "CONCLUÍDO": "ATIVIDADE CRIADA", "RESPONSÁVEL": "OWNER", "FILIAL": "CENTRO", "PRIORITÁRIA": "SIM", "DATA FATAL": "2026-10-13", "ASSOCIAÇÃO": "COMPLIANCE"},
                {"Id": 82, "TAREFA": "LEGACY TASK TWO", "STATUS": "ATIVIDADE CRIADA", "CONCLUÍDO": "ATIVIDADE CRIADA", "RESPONSÁVEL": "OWNER", "FILIAL": "CENTRO", "PRIORITÁRIA": "NÃO", "DATA FATAL": "2026-10-14", "ASSOCIAÇÃO": "COMPLIANCE"},
            ]
            self.task_calls = []

            def get_tasks():
                self.task_calls.append(("get_delegated_tasks",))
                return copy.deepcopy(self.task_rows)

            def complete_task(task_id):
                self.task_calls.append(("complete_delegated_task", str(task_id)))
                for row in self.task_rows:
                    if str(row["Id"]) == str(task_id):
                        row.update(STATUS="CONCLUÍDO", **{"CONCLUÍDO": "CONCLUÍDO"})

            self.sharepoint.get_delegated_tasks = get_tasks
            self.sharepoint.complete_delegated_task = complete_task
            self.bridge = bridge_module.ChannelBridge.__new__(bridge_module.ChannelBridge)
            self.bridge.engine = self.engine
            self.bridge.messenger = bridge_module.ChannelMessenger()
            self.bridge.lock = threading.Lock()
            temporary = tempfile.TemporaryDirectory(prefix="retired-channel-bridge-")
            self.addCleanup(temporary.cleanup)
            self.owner_root = Path(temporary.name)
            self.bridge.portal_owners = bridge_module.PortalConversationOwnerStore(self.owner_root)
            event = bridge_module.normalize_channel_events(bridge_module.portal_channel_payload(
                {"messageId": "active-draft", "text": "DRAFT"}, IDENTITY,
            ))[0]
            self.key = fixtures.conversation_key(event)
            state = self.engine._new_state(event, self.key)
            state.update(
                stage="awaiting_confirmation", flow="delegated_task", batch_id="current-modern-draft",
                fields={"TAREFA": "CURRENT MODERN DRAFT", "CONCLUÍDO": "ATIVIDADE CRIADA"},
                answers={"task": "CURRENT MODERN DRAFT"},
                options=[{"id": "confirm_yes", "title": "SIM"}],
                processed_message_ids=["active-draft"],
                attachments=[{"object_name": "media/current/draft.pdf", "original_name": "draft.pdf"}],
            )
            self.store.save(self.key, state, None)
            self.bridge.portal_owners.authorize(
                self.key, IDENTITY, state_exists=True, bind=True, allowed_emails=ALLOWED_EMAILS,
            )

        def endpoint(self, operation, identity=IDENTITY, allowed_emails=None):
            allowed = ALLOWED_EMAILS if allowed_emails is None else allowed_emails
            if operation == "snapshot":
                return self.bridge.portal_delegated_tasks_snapshot(identity, allowed_emails=allowed)
            return self.bridge.portal_delegated_task_complete(identity, "81", allowed_emails=allowed)

        def before(self):
            return copy.deepcopy((self.store.values, self.store.counter, self.task_rows))

        def assert_no_side_effects(self, before):
            self.assertEqual((self.store.values, self.store.counter, self.task_rows), before)
            self.assertEqual(self.task_calls, [])
            self.assertEqual(self.sharepoint.items, {})

        def assert_retired(self, result):
            self.assertEqual(result["delegatedTasks"], {"rows": [], "count": 0})
            self.assertEqual(result["status"], "retired")
            self.assertTrue(str(result.get("notice") or "").strip(), result)
            self.assertEqual(result["messages"], [])
            self.assertNotIn("completedTaskId", result)

        def test_snapshot_is_empty_retired_without_task_reads_or_draft_changes(self):
            before = self.before()
            result = self.endpoint("snapshot")
            self.assert_no_side_effects(before)
            self.assert_retired(result)

        def test_completion_never_writes_tasks_or_claims_completion(self):
            before = self.before()
            result = self.endpoint("complete")
            self.assert_no_side_effects(before)
            self.assert_retired(result)

        def test_replaying_both_endpoints_stays_harmless_and_keeps_owner(self):
            before = self.before()
            owner_before = self.bridge.portal_owners.path.read_bytes()
            for operation in ("snapshot", "complete", "complete", "snapshot"):
                with self.subTest(operation=operation):
                    result = self.endpoint(operation)
                    self.assert_no_side_effects(before)
                    self.assert_retired(result)
                    self.assertEqual(self.bridge.portal_owners.path.read_bytes(), owner_before)

        def test_completion_preserves_numeric_id_validation(self):
            before = self.before()
            owner_before = self.bridge.portal_owners.path.read_bytes()
            for task_id in (None, "", " ", 0, -1, True, "0", "01", "-1", "81,82", "81.0", "81x", [], {}):
                with self.subTest(task_id=task_id):
                    with self.assertRaisesRegex(ValueError, "Identificador de tarefa delegada inválido"):
                        self.bridge.portal_delegated_task_complete(IDENTITY, task_id, allowed_emails=ALLOWED_EMAILS)
                    self.assert_no_side_effects(before)
                    self.assertEqual(self.bridge.portal_owners.path.read_bytes(), owner_before)

        def test_missing_microsoft_oid_is_rejected_before_task_access(self):
            before = self.before()
            for operation in ("snapshot", "complete"):
                with self.subTest(operation=operation):
                    with self.assertRaises(PermissionError):
                        self.endpoint(operation, {"email": "owner@example.test", "oid": " "})
                    self.assert_no_side_effects(before)

        def test_owner_uses_full_oid_even_for_colliding_legacy_keys(self):
            before = self.before()
            owner_before = self.bridge.portal_owners.path.read_bytes()
            other_identity = {"oid": "other-user-1", "email": "owner@example.test", "name": "Other"}
            other_key, _ = self.bridge._portal_state(other_identity)
            self.assertEqual(other_key, self.key)
            for operation in ("snapshot", "complete"):
                with self.subTest(operation=operation):
                    with self.assertRaisesRegex(PermissionError, "Conversa não autorizada"):
                        self.endpoint(operation, other_identity)
                    self.assert_no_side_effects(before)
                    self.assertEqual(self.bridge.portal_owners.path.read_bytes(), owner_before)

        def test_mismatched_saved_conversation_identity_still_fails_closed(self):
            state, etag = self.store.load(self.key)
            state["sender"] = "someone-else"
            self.store.save(self.key, state, etag)
            before = self.before()
            for operation in ("snapshot", "complete"):
                with self.subTest(operation=operation):
                    with self.assertRaisesRegex(PermissionError, "Conversa não autorizada"):
                        self.endpoint(operation)
                    self.assert_no_side_effects(before)

        def test_unbound_legacy_state_cannot_be_claimed_with_ambiguous_allowed_users(self):
            self.bridge.portal_owners = bridge_module.PortalConversationOwnerStore(self.owner_root / "unbound")
            before = self.before()
            for operation in ("snapshot", "complete"):
                with self.subTest(operation=operation):
                    with self.assertRaisesRegex(PermissionError, "sem vínculo Microsoft inequívoco"):
                        self.endpoint(operation, allowed_emails={"owner@example.test", "other@example.test"})
                    self.assert_no_side_effects(before)
                    self.assertFalse(self.bridge.portal_owners.path.exists())

        def test_fresh_snapshot_binds_owner_without_creating_a_form(self):
            self.engine.state_store = fixtures.MemoryStateStore()
            self.store = self.engine.state_store
            self.bridge.portal_owners = bridge_module.PortalConversationOwnerStore(self.owner_root / "fresh")
            before = self.before()
            result = self.endpoint("snapshot")
            self.assert_no_side_effects(before)
            self.assert_retired(result)
            self.assertEqual(self.bridge.portal_owners._load()["owners"], {self.key: "entra-user-1"})

    return RetiredChannelBridgeTests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bridge", type=Path, default=ARTIFACT / "channel_bridge.py")
    args = parser.parse_args()
    sys.path.insert(0, str(MIRROR))
    sys.path.insert(0, str(MIRROR / "worker"))
    # The QA venv and bundled runtime are both Python 3.12.14. Use the existing
    # real crypto dependency for unrelated signature imports, without installing
    # anything or replacing bridge/engine/signature production methods.
    if importlib.util.find_spec("cryptography") is None:
        sys.path.append(str(BUNDLED_SITE_PACKAGES))
    with ExitStack() as boundaries:
        for target in ("requests.sessions.Session.request", "urllib.request.urlopen", "socket.create_connection", "socket.socket.connect", "socket.socket.connect_ex"):
            boundaries.enter_context(patch(target, side_effect=AssertionError("Network forbidden in offline QA")))
        load("workflow", ARTIFACT / "worker/workflow.py")
        fixtures = load("retired_bridge_workflow_fixtures", MIRROR / "tests/test_workflow.py")
        bridge_module = load("channel_bridge", args.bridge.resolve())
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(cases(bridge_module, fixtures))
        print("ChannelBridge under test: " + str(args.bridge.resolve()), flush=True)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
    return not result.wasSuccessful()


if __name__ == "__main__":
    raise SystemExit(main())
