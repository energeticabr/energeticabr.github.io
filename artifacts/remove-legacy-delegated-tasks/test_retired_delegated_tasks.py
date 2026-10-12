"""Offline retirement regressions: real WorkflowEngine, external memory fixtures.

Run QA Python -X utf8 -B; --workflow selects an immutable baseline/candidate.
--attendance adds the previous 21 supplier-sync regressions without editing them.
"""
import argparse
import copy
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


WORKSPACE = Path("C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr")
MIRROR = WORKSPACE / "artifacts/pending-attendance-checkboxes-20261012/candidate"
CANDIDATE = Path(__file__).resolve().parent / "worker/workflow.py"
LEGACY_STAGE = "choosing_pending_delegated_tasks"
LEGACY_ID = "pending_delegated_tasks"
SYNC_TEST = WORKSPACE / "work/energeticabr.github.io/.worktrees/orders-gallery-layout/artifacts/attendance-sync-checkboxes/test_supplier_sync.py"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def cases(fixtures):
    class RetiredDelegatedTasksTests(unittest.TestCase):
        reply = fixtures.WorkflowTests.reply
        start_delegated_task = fixtures.WorkflowTests.start_delegated_task
        summary_text = fixtures.WorkflowTests.summary_text

        def setUp(self):
            fixtures.WorkflowTests.setUp(self)
            # Retired tasks deliberately remain present in the external source.
            self.task_rows = [
                {"Id": 81, "TAREFA": "LEGACY TASK ONE", "STATUS": "ATIVIDADE CRIADA", "CONCLUÍDO": "ATIVIDADE CRIADA", "RESPONSÁVEL": "BERNARDO", "FILIAL": "CENTRO", "PRIORITÁRIA": "SIM", "DATA FATAL": "2026-10-13", "ASSOCIACAO": "COMPLIANCE"},
                {"Id": 82, "TAREFA": "LEGACY TASK TWO", "STATUS": "ATIVIDADE CRIADA", "CONCLUÍDO": "ATIVIDADE CRIADA", "RESPONSÁVEL": "BERNARDO", "FILIAL": "CENTRO", "PRIORITÁRIA": "NÃO", "DATA FATAL": "2026-10-14", "ASSOCIACAO": "COMPLIANCE"},
            ]
            self.task_reads = []
            self.task_completions = []

            def get_tasks():
                self.task_reads.append("get_delegated_tasks")
                return copy.deepcopy(self.task_rows)

            def complete_task(item_id):
                self.task_completions.append(str(item_id))
                for row in self.task_rows:
                    if str(row["Id"]) == str(item_id):
                        row.update(STATUS="CONCLUÍDO", **{"CONCLUÍDO": "CONCLUÍDO"})

            self.sharepoint.get_delegated_tasks = get_tasks
            self.sharepoint.complete_delegated_task = complete_task
            # Keep timers out of the retirement scenario, not out of product code.
            self.config["limits"]["inactivity_expiration_enabled"] = False
            self.config["limits"]["attachment_restart_on_inactivity_enabled"] = False

        def current(self):
            return next(iter(self.state.values.values()))[0]

        def pending_sources(self):
            self.sharepoint.options_by_key.clear()
            self.sharepoint.pending_provision_rows = [
                {"Id": 9001, "STATUS": "PAGAMENTO PREVISTO", "DATA PREVISTO PGTO": "2026-01-01", "PGTOAGENDADO": None, "DATA PGTO EFETUADO": None},
                {"Id": 9002, "STATUS": "PAGAMENTO PREVISTO", "DATA PREVISTO PGTO": "2026-01-02", "PGTOAGENDADO": None, "DATA PGTO EFETUADO": None},
            ]

        def save_stage(self, stage=LEGACY_STAGE, processed=()):
            incoming = fixtures.event("seed", "text", text="OPA")
            state = self.engine._new_state(incoming, fixtures.conversation_key(incoming))
            state.update(stage=stage, flow=None, processed_message_ids=list(processed))
            state["options"] = [{"id": "delegated_task:81", "reply": "delegated_task:81", "value": "81", "title": "LEGACY TASK ONE", "task": copy.deepcopy(self.task_rows[0])}]
            etag = self.state.save(state["key"], state, None)
            return state, etag

        def assert_no_legacy_output(self, start=0):
            for message in self.messenger.sent[start:]:
                self.assertNotEqual(message.get("presentation"), "delegated_tasks")
                self.assertNotIn("LEGACY TASK ONE", message.get("body", ""))
                self.assertNotIn("LEGACY TASK TWO", message.get("body", ""))
                self.assertFalse(any(option.get("id") == LEGACY_ID or str(option.get("id", "")).startswith("delegated_task:")
                                     for option in message.get("actions", []) + message.get("options", [])))

        def assert_retired(self, result, start=0):
            self.assertEqual(result["status"], "awaiting_pending", result)
            self.assertEqual(self.current()["stage"], "choosing_pending")
            self.assertIsNone(self.current()["flow"])
            self.assertEqual(self.current()["options"], [])
            self.assertEqual(self.task_reads, [])
            self.assertEqual(self.task_completions, [])
            self.assertEqual(self.sharepoint.update_calls, [])
            self.assertIn("PENDÊNCIAS", self.messenger.sent[-1]["body"])
            self.assert_no_legacy_output(start)

        def test_pending_menu_excludes_legacy_tasks_without_reading_their_source(self):
            self.pending_sources()
            self.reply("OPA")
            self.assertEqual(self.reply("PENDÊNCIAS")["status"], "awaiting_pending")
            menu = self.messenger.sent[-1]
            self.assertIn("PENDÊNCIAS (2)", menu["body"])
            self.assertEqual(self.task_reads, [])
            self.assert_no_legacy_output()
            self.assertTrue({"pending_payment_provisions", "pending_pathologies", "pending_notes_review", "pending_documents"}.issubset({item["id"] for item in menu["actions"]}))

        def test_root_pending_total_excludes_retired_tasks_and_keeps_other_counts(self):
            self.pending_sources()
            self.reply("OPA")
            pending = next(item for item in self.messenger.sent[-1]["actions"] if "PENDÊNCIAS" in item["title"])
            self.assertIn("PENDÊNCIAS (2)", pending["title"])
            self.assertEqual(pending["tone"], "danger")
            self.assertEqual(self.task_reads, [])

        def test_compatibility_snapshot_and_counter_are_empty_without_old_reads(self):
            self.assertEqual(self.engine._pending_delegated_tasks(), [])
            self.assertEqual(self.engine._pending_delegated_tasks_count(), 0)
            self.assertEqual(self.task_reads, [])
            self.assertEqual([row["STATUS"] for row in self.task_rows], ["ATIVIDADE CRIADA", "ATIVIDADE CRIADA"])

        def test_retired_menu_id_and_aliases_return_to_pending(self):
            for raw in (LEGACY_ID, "📋 TAREFAS DELEGADAS PENDENTES", "TAREFAS DELEGADAS", "TAREFAS DELEGADAS PENDENTES", "TAREFAS PENDENTES"):
                with self.subTest(raw=raw):
                    self.setUp()
                    self.pending_sources()
                    self.save_stage("choosing_pending")
                    self.assert_retired(self.reply(reply_id=raw))

        def test_saved_legacy_stage_all_replies_including_confirmation_are_harmless(self):
            for raw in ("delegated_task:81", "delegated_task:complete:81", "delegated_task_complete:81", "confirm_yes", "SIM", "confirm_edit", "confirm_cancel", "navigation_back", "CONTINUAR", "RESUMO", "OPA", "81", "inválido"):
                with self.subTest(raw=raw):
                    self.setUp()
                    self.pending_sources()
                    before = copy.deepcopy(self.task_rows)
                    self.save_stage()
                    self.assert_retired(self.reply(reply_id=raw))
                    self.assertEqual(self.task_rows, before)

        def test_saved_legacy_attachment_cannot_open_a_task_or_attachment_write(self):
            self.pending_sources()
            self.save_stage()
            result = self.engine.handle(fixtures.event("old-attachment", "attachment", media_id="old-media"))
            self.assert_retired(result)
            self.assertEqual(self.current()["attachments"], [])

        def test_stale_task_replies_without_session_return_to_pending_without_writes(self):
            for raw in (LEGACY_ID, "delegated_task:81", "delegated_task:complete:81", "delegated_task_complete:81", "choice:pending_delegated_task:delegated_task:81", "choice:pending_delegated_task:delegated_task:complete:81", "choice:pending_delegated_task:delegated_task_complete:81", "choice:pending_delegated_task:81"):
                with self.subTest(raw=raw):
                    self.setUp()
                    self.pending_sources()
                    self.assert_retired(self.reply(reply_id=raw))

        def test_stale_completion_is_not_reinterpreted_as_another_form_answer(self):
            for raw in (LEGACY_ID, "delegated_task:81", "delegated_task:complete:81", "delegated_task_complete:81", "choice:pending_delegated_task:delegated_task:81", "choice:pending_delegated_task:delegated_task:complete:81", "choice:pending_delegated_task:delegated_task_complete:81", "choice:pending_delegated_task:81"):
                with self.subTest(raw=raw):
                    self.setUp()
                    self.start_delegated_task()
                    self.reply("NÃO")
                    self.assertEqual(self.current()["stage"], "awaiting_confirmation")
                    state, etag = next(iter(self.state.values.values()))
                    attachment = self.media.stage(fixtures.event("draft-attachment", "attachment", original_filename="draft.pdf", content=b"saved-draft"), state["batch_id"], state["key"])
                    state["attachments"].append(attachment)
                    self.state.save(state["key"], state, etag)
                    before = copy.deepcopy(self.current())
                    task_rows = copy.deepcopy(self.task_rows)
                    start = len(self.messenger.sent)
                    self.task_reads.clear()
                    incoming = fixtures.event("obsolete-task", "text", reply_id=raw, text="")
                    result = self.engine.handle(incoming)
                    self.assertEqual(result["status"], "retired_delegated_task", result)
                    expected = copy.deepcopy(before)
                    expected["processed_message_ids"].append("obsolete-task")
                    self.assertEqual(self.current(), expected)
                    self.assertEqual(self.sharepoint.items, {})
                    self.assertEqual(self.task_rows, task_rows)
                    self.assertEqual(self.task_reads, [])
                    self.assertEqual(self.task_completions, [])
                    self.assert_no_legacy_output(start)
                    self.assertEqual(len(self.messenger.sent[start:]), 1)
                    self.assertIn("PRESERVADO", self.messenger.sent[-1]["body"])
                    saved_counter = self.state.counter
                    self.assertEqual(self.engine.handle(incoming)["status"], "duplicate")
                    self.assertEqual(self.state.counter, saved_counter)
                    self.assertEqual(self.current(), expected)
                    resumed = self.reply(reply_id="input_continue")
                    self.assertEqual(resumed["status"], "current_question_resent")
                    self.assertEqual(resumed["stage"], "awaiting_confirmation")
                    self.assertEqual(self.current()["flow"], "delegated_task")
                    completed = self.reply("SIM")
                    self.assertEqual(completed["status"], "completed")
                    item = self.sharepoint.items[completed["sharepoint_item_id"]]
                    self.assertEqual(item["target_list"], "TAREFASDELEGADAS")
                    self.assertEqual(item["fields"], before["fields"])
                    self.assertTrue(item["attachments"])
                    self.assertEqual(len(self.sharepoint.items), 1)
                    self.assertEqual(self.task_rows, task_rows)
                    self.assertEqual(self.task_reads, [])
                    self.assertEqual(self.task_completions, [])

        def test_scoped_retired_selector_keeps_a_current_area_choice_intact(self):
            self.reply("OPA")
            self.reply("SUPRIMENTOS")
            self.assertEqual(self.current()["stage"], "choosing_action")
            before = copy.deepcopy(self.current())
            result = self.engine.handle(fixtures.event("obsolete-area-task", "text", reply_id="choice:pending_delegated_task:delegated_task_complete:81"))
            self.assertEqual(result["status"], "retired_delegated_task", result)
            before["processed_message_ids"].append("obsolete-area-task")
            self.assertEqual(self.current(), before)
            self.assertEqual(self.sharepoint.items, {})
            self.assertEqual(self.task_reads, [])
            self.assertEqual(self.task_completions, [])

        def test_legacy_stage_prompt_resume_persists_pending_instead_of_sending_rows(self):
            self.pending_sources()
            state, etag = self.save_stage()
            self.assert_retired(self.engine._resend_current_prompt(state, etag))

        def test_legacy_renderer_stub_never_sends_supplied_rows(self):
            self.pending_sources()
            state, _ = self.save_stage()
            self.engine._send_pending_delegated_tasks(state, copy.deepcopy(self.task_rows))
            self.assertEqual(state["stage"], "choosing_pending")
            self.assertEqual(state["options"], [])
            self.assertEqual(self.task_reads, [])
            self.assertIn("PENDÊNCIAS", self.messenger.sent[-1]["body"])
            self.assert_no_legacy_output()

        def test_retired_completion_replay_cannot_complete_a_task(self):
            self.pending_sources()
            self.save_stage()
            incoming = fixtures.event("old-completion", "text", reply_id="delegated_task:complete:81")
            self.assert_retired(self.engine.handle(incoming))
            before = copy.deepcopy(self.task_rows)
            self.assertEqual(self.engine.handle(incoming)["status"], "duplicate")
            self.assertEqual(self.task_rows, before)
            self.assertEqual(self.task_reads, [])
            self.assertEqual(self.task_completions, [])

        def test_existing_pending_provision_choice_still_opens_its_menu(self):
            self.pending_sources()
            self.reply("OPA")
            self.reply("PENDÊNCIAS")
            result = self.reply(reply_id="pending_payment_provisions")
            self.assertEqual(result["status"], "awaiting_pending_provisions")
            self.assertEqual(self.current()["stage"], "choosing_pending_provisions")
            self.assertEqual(self.messenger.sent[-1]["actions"][0]["id"], "pending_payment_settlement")
            self.assertEqual(self.task_reads, [])

        def test_existing_pending_pathology_choice_still_opens_its_flow(self):
            self.reply("OPA")
            self.reply("PENDÊNCIAS")
            result = self.reply(reply_id="pending_pathologies")
            self.assertEqual(result["status"], "awaiting_field")
            self.assertEqual(result["field"], "registro_patologia_ativa")
            self.assertEqual(self.task_reads, [])

        def test_delegated_task_creation_still_commits_to_its_own_list(self):
            fixtures.WorkflowTests.test_delegated_task_writes_expected_fields_and_completion(self)
            self.assertEqual(self.task_completions, [])

        def test_delegated_creation_confirmation_restores_required_status(self):
            fixtures.WorkflowTests.test_delegated_task_restores_required_status_before_summary_and_commit(self)
            self.assertEqual(self.task_completions, [])

    return RetiredDelegatedTasksTests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workflow", type=Path, default=CANDIDATE)
    parser.add_argument("--attendance", action="store_true")
    args = parser.parse_args()
    sys.path.insert(0, str(MIRROR / "worker"))
    with patch("requests.sessions.Session.request", side_effect=AssertionError("Network forbidden in offline QA")):
        load("workflow", args.workflow.resolve())
        fixtures = load("test_workflow", MIRROR / "tests/test_workflow.py")
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(cases(fixtures))
        if args.attendance:
            sync = load("retirement_supplier_sync_fixtures", SYNC_TEST)
            suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(sync.cases(fixtures)))
        print("Workflow under test: " + str(args.workflow.resolve()), flush=True)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
    return not result.wasSuccessful()


if __name__ == "__main__":
    raise SystemExit(main())
