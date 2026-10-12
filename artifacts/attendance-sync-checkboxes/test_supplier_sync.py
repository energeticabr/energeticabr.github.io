"""Offline supplier checkbox/status regressions using the real engine/fixtures.

Use QA Python -B and --workflow <baseline/candidate>; --prior adds the existing
pending/date/return regression files. No HTTP or real HR write is allowed.
"""
import argparse
import copy
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

WORKSPACE = Path("C:/Users/Bernardonotini/Documents/Codex/2026-09-17/abr")
MIRROR = WORKSPACE / "artifacts/pending-attendance-checkboxes-20261012/candidate"
BASELINE = WORKSPACE / "artifacts/attendance-return-date-checklist-20261012/worker/workflow.py"
CANDIDATE = WORKSPACE / "artifacts/attendance-sync-checkboxes-20261012/worker/workflow.py"
ARTIFACTS = Path(__file__).resolve().parents[1]
SYNC_KEY = "sincronizar_atividade_fornecedor_presenca"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def cases(fixtures):
    class SupplierSyncTests(unittest.TestCase):
        setUp = fixtures.WorkflowTests.setUp
        reply = fixtures.WorkflowTests.reply
        start_attendance_validation = fixtures.WorkflowTests.start_attendance_validation

        def current(self):
            return next(iter(self.state.values.values()))[0]

        def open_sync(self):
            template = self.sharepoint.options_by_key["registro_presenca_pendente"][0]
            targets = []
            suppliers = []
            for item_id, name, supplier_id, day, presence in (
                (1814, "FORNECEDOR TESTE", 777, "2026-07-31T03:00:00Z", "PENDENTE"),
                (1816, "ALFA", 778, "2026-07-31T00:30:00Z", "PENDENTE"),
                (1817, "BETA", 779, "2026-07-31", "PENDENTE"),
                (1818, "NAO MARCADO", 780, "2026-07-31", "PENDENTE"),
                (1819, "OUTRO DIA", 781, "2026-08-03", "PENDENTE"),
                (1820, "VALIDADO", 782, "2026-07-31", "PRESENTE"),
            ):
                option = copy.deepcopy(template)
                option.update(id=item_id, value=str(item_id), title=f"{item_id} - {name}")
                option["source_values"].update(Id=item_id, FORNECEDOR=name, DATA=day, PRESENCA=presence)
                self.sharepoint.items[item_id] = {"fields": copy.deepcopy(option["source_values"]), "attachments": {}, "target_list": "DESCRITIVOPRESENCA"}
                targets.append(option)
                supplier = {"Id": supplier_id, "CADASTRO": name, "FILIAL": "001 - OURO PRETO", "ATIVIDADE EXERCIDA": "MONTAGEM DE FORMAS", "DESCRITIVOETAPA ATUAL": "119", "IMOVEL": "TODOS"}
                suppliers.append({"id": supplier_id, "value": str(supplier_id), "title": name, "source_values": supplier})
                self.sharepoint.items[supplier_id] = {"fields": copy.deepcopy(supplier), "attachments": {}, "target_list": "FORNECEDORES"}
            self.sharepoint.options_by_key["attendance_supplier_sync_presence"] = targets
            self.sharepoint.options_by_key["registro_presenca_pendente"] = copy.deepcopy(targets)
            self.sharepoint.options_by_key["fornecedor_sincronizacao_atividade_presenca"] = suppliers
            self.sharepoint.options_by_key["presenca_pendente_continuacao"] = copy.deepcopy(targets)
            self.sharepoint.options_by_key["editar_iddescritivoetapa_presenca"][1]["source_values"]["FILIAL"] = "001 - OURO PRETO"
            self.start_attendance_validation()
            self.reply("1")
            self.reply("9")
            self.assertEqual(self.reply("405")["field"], "editar_atividade_presenca")
            self.assertEqual(self.reply("409")["field"], SYNC_KEY)

        def submit(self, csv="1816,1817"):
            return self.reply(reply_id="supplier_sync_batch:" + csv)

        def status_writes(self):
            return [call for call in self.sharepoint.update_calls if call["target_list"] == "DESCRITIVOPRESENCA" and "PRESENCA" in call["fields"]]

        def final_summary(self, *, legacy=False):
            if legacy:
                self.reply(reply_id="supplier_sync_target:1816")
                result = self.reply(reply_id="finish_supplier_sync")
            else:
                result = self.submit()
            self.assertEqual(result.get("field"), "revisar_dados_presenca", result)
            result = self.reply("2")
            self.assertEqual(result["status"], "awaiting_confirmation", result)
            return next(message for message in reversed(self.messenger.sent) if message["type"] == "actions")

        def test_selector_announces_supplier_checkbox_presentation(self):
            self.open_sync()
            self.assertEqual(self.messenger.sent[-1].get("presentation"), "attendance_supplier_sync")
            self.assertEqual(self.sharepoint.update_calls, [])

        def test_csv_replaces_legacy_selection_and_replicates_only_checked_ids(self):
            self.open_sync()
            self.reply(reply_id="supplier_sync_target:1818")
            self.assertEqual(self.sharepoint.update_calls, [])
            result = self.submit()
            self.assertEqual(result.get("field"), "revisar_dados_presenca", result)
            self.assertEqual([item["value"] for item in self.current()["selections"][SYNC_KEY]], ["ID:1814", "ID:1816", "ID:1817"])
            data = [call for call in self.sharepoint.update_calls if call["target_list"] == "DESCRITIVOPRESENCA"]
            self.assertEqual([call["item_id"] for call in data], [1814, 1816, 1817])
            self.assertTrue(all(call["fields"] == {"IDDESCRITIVOETAPA": "405", "ATIVIDADEEXECUTADA": "CONCRETAGEM DE VIGAS", "ETAPA": "ESTRUTURA"} for call in data))
            self.assertEqual(self.status_writes(), [])
            self.assertEqual(self.sharepoint.items[1818]["fields"]["IDDESCRITIVOETAPA"], "119")

        def test_malformed_payloads_reject_the_whole_batch_without_writes(self):
            for csv in ("", "1816,", ",1816", "1816,,1817", "1816,x", "0", "-1816", "1816,1816", "1816;1817", "1816, 1817"):
                with self.subTest(csv=csv):
                    self.setUp()
                    self.open_sync()
                    result = self.submit(csv)
                    self.assertEqual(result["status"], "invalid_supplier_sync_batch")
                    self.assertEqual(self.sharepoint.update_calls, [])

        def test_unlisted_crossday_and_validated_ids_reject_all_requested_rows(self):
            for csv in ("1816,9999", "1816,1819", "1816,1820"):
                with self.subTest(csv=csv):
                    self.setUp()
                    self.open_sync()
                    self.assertEqual(self.submit(csv)["status"], "invalid_supplier_sync_batch")
                    self.assertEqual(self.sharepoint.update_calls, [])

        def test_removed_fresh_option_does_not_trust_the_opened_selector(self):
            self.open_sync()
            self.sharepoint.options_by_key["attendance_supplier_sync_presence"] = [option for option in self.sharepoint.options_by_key["attendance_supplier_sync_presence"] if option["id"] != 1817]
            self.assertEqual(self.submit()["status"], "invalid_supplier_sync_batch")
            self.assertEqual(self.sharepoint.update_calls, [])

        def test_fresh_row_day_and_status_are_rechecked_before_any_replication(self):
            for update in ({"DATA": "2026-08-03"}, {"PRESENCA": "AUSENTE"}):
                with self.subTest(update=update):
                    self.setUp()
                    self.open_sync()
                    self.sharepoint.items[1817]["fields"].update(update)
                    self.assertEqual(self.submit()["status"], "invalid_supplier_sync_batch")
                    self.assertEqual(self.sharepoint.update_calls, [])

        def test_unavailable_fresh_row_rejects_without_partial_replication(self):
            self.open_sync()
            read = self.sharepoint.get_item_fields_with_etag
            def fail(item_id, fields, target_list=None):
                if item_id == 1817:
                    raise FileNotFoundError("missing selected row")
                return read(item_id, fields, target_list=target_list)
            with patch.object(self.sharepoint, "get_item_fields_with_etag", side_effect=fail):
                self.assertEqual(self.submit()["status"], "invalid_supplier_sync_batch")
            self.assertEqual(self.sharepoint.update_calls, [])

        def test_none_retains_the_original_single_record_flow_without_replication(self):
            self.open_sync()
            self.reply(reply_id="supplier_sync_target:1818")
            self.assertEqual(self.reply(reply_id="supplier_sync_none").get("field"), "revisar_dados_presenca")
            self.assertEqual(self.sharepoint.update_calls, [])
            self.reply("2")
            self.reply("SIM")
            self.assertEqual([call["item_id"] for call in self.status_writes()], [1814])

        def test_final_summary_contains_every_full_edited_participant(self):
            self.open_sync()
            self.sharepoint.items[1816]["fields"]["PROFISSAO"] = "PEDREIRO ATUAL"
            message = self.final_summary()
            rows = [{cell["label"]: cell["value"] for cell in row} for row in message["detail_table"]["rows"]]
            self.assertEqual([row.get("ID") for row in rows], ["1814", "1816", "1817"])
            for row, supplier in zip(rows, ["FORNECEDOR TESTE", "ALFA", "BETA"]):
                self.assertEqual(row["DATA"], "31/07/2026")
                self.assertEqual(row["FORNECEDOR"], supplier)
                self.assertEqual(row["IDDESCRITIVOETAPA"], "405")
                self.assertEqual(row["ATIVIDADEEXECUTADA"], "CONCRETAGEM DE VIGAS")
                self.assertEqual(row["ETAPA"], "ESTRUTURA")
                self.assertEqual(row["PRESENCA"], "PRESENTE")
                self.assertIn("IDMEDICAOPARCIAL", row)
                self.assertIn("VLORDIARIO", row)
                self.assertIn("MOTIVACAO", row)
            self.assertEqual(rows[1]["PROFISSAO"], "PEDREIRO ATUAL")
            summary = "\n".join(row["value"] for row in self.summary_builder.calls[-1]["rows"])
            for text in ("1814", "1816", "1817", "ALFA", "BETA", "PEDREIRO ATUAL", "CONCRETAGEM DE VIGAS"):
                self.assertIn(text, summary)
            self.assertNotIn("NAO MARCADO", summary)
            self.assertEqual(self.status_writes(), [])

        def test_final_sim_updates_presence_on_exact_original_and_checked_ids(self):
            self.open_sync()
            self.final_summary()
            result = self.reply("SIM")
            self.assertNotIn(result["status"], {"submission_failed", "attendance_batch_recovery_pending"})
            self.assertEqual([call["item_id"] for call in self.status_writes()], [1814, 1816, 1817])
            self.assertTrue(all(self.sharepoint.items[item_id]["fields"]["PRESENCA"] == "PRESENTE" for item_id in (1814, 1816, 1817)))
            self.assertEqual(self.sharepoint.items[1818]["fields"]["PRESENCA"], "PENDENTE")
            self.assertEqual(self.sharepoint.items[1819]["fields"]["PRESENCA"], "PENDENTE")
            self.assertEqual([option["value"] for option in self.current()["options"] if not option.get("terminal_option")], ["1818"])
            self.assertEqual(self.current()["pending_attendance_date_value"][:10], "2026-07-31")

        def test_legacy_one_at_a_time_finish_also_confirms_every_applied_row(self):
            self.open_sync()
            self.final_summary(legacy=True)
            self.reply("SIM")
            self.assertEqual([call["item_id"] for call in self.status_writes()], [1814, 1816])
            self.assertEqual(self.sharepoint.items[1817]["fields"]["PRESENCA"], "PENDENTE")

        def test_absence_motivation_and_existing_zero_payment_rules_apply_to_all(self):
            self.open_sync()
            self.final_summary()
            state = self.current()
            state["fields"].update(PRESENCA="AUSENTE", MOTIVACAO="ATESTADO")
            state["display_values"].update(PRESENCA="AUSENTE", MOTIVACAO="ATESTADO")
            _, etag = next(iter(self.state.values.values()))
            self.engine._summarize_and_confirm(state, etag)
            message = next(message for message in reversed(self.messenger.sent) if message["type"] == "actions")
            rows = [{cell["label"]: cell["value"] for cell in row} for row in message["detail_table"]["rows"]]
            self.assertEqual([row.get("PRESENCA") for row in rows], ["AUSENTE"] * 3)
            self.reply("SIM")
            self.assertEqual([call["item_id"] for call in self.status_writes()], [1814, 1816, 1817])
            for item_id in (1814, 1816, 1817):
                fields = self.sharepoint.items[item_id]["fields"]
                self.assertEqual((fields["PRESENCA"], fields["MOTIVACAO"], fields["VLORDIARIO"], fields["IDPGTO"]), ("AUSENTE", "ATESTADO", "0", "AUSENTE"))

        def test_edit_and_cancel_do_not_write_any_participant_status(self):
            for command in ("confirm_edit", "confirm_cancel"):
                with self.subTest(command=command):
                    self.setUp()
                    self.open_sync()
                    self.final_summary()
                    count = len(self.sharepoint.update_calls)
                    self.reply(reply_id=command)
                    self.assertEqual(len(self.sharepoint.update_calls), count)
                    self.assertEqual(self.status_writes(), [])

        def test_data_replication_failure_resumes_without_duplicate_writes(self):
            self.open_sync()
            update = self.sharepoint.update_item
            failed = []
            def fail(item_id, fields, target_list=None):
                if item_id == 779 and not failed:
                    failed.append(True)
                    raise RuntimeError("temporary supplier update failure")
                return update(item_id, fields, target_list=target_list)
            with patch.object(self.sharepoint, "update_item", side_effect=fail):
                self.assertEqual(self.submit()["status"], "attendance_supplier_sync_failed")
                before = copy.deepcopy(self.sharepoint.update_calls)
                self.assertEqual(self.submit("1816,1818")["status"], "invalid_supplier_sync_batch")
                self.assertEqual(self.sharepoint.update_calls, before)
                self.assertEqual(self.submit().get("field"), "revisar_dados_presenca")
            self.assertEqual([call["item_id"] for call in self.sharepoint.update_calls if call["target_list"] == "DESCRITIVOPRESENCA"], [1814, 1816, 1817])
            self.assertEqual([call["item_id"] for call in self.sharepoint.update_calls if call["target_list"] == "FORNECEDORES"], [777, 778, 779])
            self.assertEqual(self.status_writes(), [])

        def test_status_failure_retains_batch_journal_and_resumes_exact_participants(self):
            self.open_sync()
            self.final_summary()
            update = self.sharepoint.update_item
            failed = []
            def fail(item_id, fields, target_list=None):
                if item_id == 1816 and "PRESENCA" in fields and not failed:
                    failed.append(True)
                    raise RuntimeError("temporary status update failure")
                return update(item_id, fields, target_list=target_list)
            with patch.object(self.sharepoint, "update_item", side_effect=fail):
                self.assertEqual(self.reply("SIM")["status"], "attendance_batch_recovery_pending")
                self.assertEqual([entry["item_id"] for entry in self.current()["attendance_batch_commit"]["entries"]], [1814, 1816, 1817])
                self.reply("OPA")
            self.assertEqual([call["item_id"] for call in self.status_writes()], [1814, 1816, 1817])
            self.assertNotIn("attendance_batch_commit", self.current())
            self.assertEqual(self.sharepoint.items[1818]["fields"]["PRESENCA"], "PENDENTE")

        def test_changed_participant_after_preview_blocks_all_status_writes(self):
            self.open_sync()
            self.final_summary()
            self.sharepoint.items[1817]["fields"]["ATIVIDADEEXECUTADA"] = "ALTERACAO EXTERNA"
            result = self.reply("SIM")
            self.assertEqual(result["status"], "awaiting_confirmation")
            self.assertEqual(self.status_writes(), [])

        def test_status_etag_race_preserves_journal_and_never_overwrites_external_edit(self):
            self.open_sync()
            self.final_summary()
            update = self.sharepoint.update_item_with_etag
            def race(item_id, fields, etag, target_list=None):
                if item_id == 1816:
                    self.sharepoint.items[item_id]["fields"]["ATIVIDADEEXECUTADA"] = "ALTERACAO EXTERNA"
                    self.sharepoint.items[item_id]["_version"] = self.sharepoint.items[item_id].get("_version", 1) + 1
                return update(item_id, fields, etag, target_list=target_list)
            with patch.object(self.sharepoint, "update_item_with_etag", side_effect=race):
                self.assertEqual(self.reply("SIM")["status"], "attendance_batch_recovery_pending")
            self.assertEqual(self.reply("OPA")["status"], "awaiting_attendance_batch_conflict")
            self.assertEqual(self.sharepoint.items[1816]["fields"]["ATIVIDADEEXECUTADA"], "ALTERACAO EXTERNA")
            self.assertEqual(self.sharepoint.items[1817]["fields"]["PRESENCA"], "PENDENTE")

        def test_repeated_successful_sync_keeps_every_previously_edited_participant(self):
            self.open_sync()
            self.final_summary()
            self.reply(reply_id="confirm_edit")
            self.reply("9")
            self.reply("405")
            self.assertEqual(self.reply("409").get("field"), SYNC_KEY)
            result = self.submit("1818")
            self.assertEqual(result["status"], "awaiting_confirmation")
            emitted = next(message for message in reversed(self.messenger.sent) if message["type"] == "actions")
            rows = [{cell["label"]: cell["value"] for cell in row} for row in emitted["detail_table"]["rows"]]
            self.assertEqual([row["ID"] for row in rows], ["1814", "1816", "1817", "1818"])
            self.assertEqual([row["FORNECEDOR"] for row in rows], ["FORNECEDOR TESTE", "ALFA", "BETA", "NAO MARCADO"])
            self.reply("SIM")
            self.assertEqual([call["item_id"] for call in self.status_writes()], [1814, 1816, 1817, 1818])
            self.assertEqual(self.sharepoint.items[1819]["fields"]["PRESENCA"], "PENDENTE")

        def test_checkpoint_conflict_preserves_latest_full_state_and_exact_progress(self):
            class ConflictStore(fixtures.MemoryStateStore):
                injected = False

                def save(store, key, state, etag):
                    if (not store.injected and state.get("attendance_supplier_sync_plan")
                            and state.get("attendance_supplier_sync_applied_target_ids") == ["1814"]):
                        store.injected = True
                        latest, latest_etag = store.load(key)
                        latest.setdefault("processed_message_ids", []).append("concurrent-alert-event")
                        latest["pending_stale_stage_alert"] = {"count": 7}
                        latest["pending_attendance_alert"] = {"count": 3}
                        latest["concurrent_metadata"] = {"value": "latest"}
                        super().save(key, latest, latest_etag)
                        raise RuntimeError("etag conflict")
                    return super().save(key, state, etag)

            self.state = ConflictStore()
            self.engine.state_store = self.state
            self.open_sync()
            self.assertEqual(self.submit()["status"], "attendance_supplier_sync_failed")
            current = self.current()
            self.assertIn("concurrent-alert-event", current["processed_message_ids"])
            self.assertEqual(current["pending_stale_stage_alert"], {"count": 7})
            self.assertEqual(current["pending_attendance_alert"], {"count": 3})
            self.assertEqual(current["concurrent_metadata"], {"value": "latest"})
            self.assertEqual(current["attendance_supplier_sync_applied_target_ids"], ["1814"])
            self.assertEqual(self.submit().get("field"), "revisar_dados_presenca")
            self.assertEqual([call["item_id"] for call in self.sharepoint.update_calls if call["target_list"] == "DESCRITIVOPRESENCA"], [1814, 1816, 1817])

        def test_reordered_equivalent_retry_resumes_persisted_order_without_duplicates(self):
            for retry_kind in ("csv", "legacy_finish"):
                with self.subTest(retry_kind=retry_kind):
                    self.setUp()
                    self.open_sync()
                    update = self.sharepoint.update_item
                    failed = []
                    def fail(item_id, fields, target_list=None):
                        if item_id == 779 and not failed:
                            failed.append(True)
                            raise RuntimeError("temporary supplier update failure")
                        return update(item_id, fields, target_list=target_list)
                    with patch.object(self.sharepoint, "update_item", side_effect=fail):
                        self.assertEqual(self.submit()["status"], "attendance_supplier_sync_failed")
                        if retry_kind == "csv":
                            result = self.submit("1817,1816")
                        else:
                            state = self.current()
                            state["multi_selections"][SYNC_KEY].reverse()
                            result = self.reply(reply_id="finish_supplier_sync")
                        self.assertEqual(result.get("field"), "revisar_dados_presenca", result)
                    self.assertEqual([record["item_id"] for record in self.current()["attendance_supplier_sync_records"]], [1814, 1816, 1817])
                    self.assertEqual([call["item_id"] for call in self.sharepoint.update_calls if call["target_list"] == "DESCRITIVOPRESENCA"], [1814, 1816, 1817])
                    self.assertEqual([call["item_id"] for call in self.sharepoint.update_calls if call["target_list"] == "FORNECEDORES"], [777, 778, 779])

        def test_checkpoint_conflict_never_replays_old_operation_into_replacement_batch(self):
            class ReplacementStore(fixtures.MemoryStateStore):
                replacement = None
                replacement_etag = None

                def save(store, key, state, etag):
                    if (store.replacement is None and state.get("attendance_supplier_sync_plan")
                            and state.get("attendance_supplier_sync_applied_target_ids") == ["1814"]):
                        latest, latest_etag = store.load(key)
                        latest["batch_id"] = "new-concurrent-conversation"
                        latest["answers"] = {}
                        latest["selections"] = {}
                        latest["multi_selections"] = {}
                        latest["options"] = []
                        for name in list(latest):
                            if name.startswith("attendance_supplier_sync_"):
                                latest.pop(name)
                        latest["processed_message_ids"] = ["replacement-event"]
                        latest["replacement_metadata"] = {"keep": "entire state"}
                        store.replacement_etag = super().save(key, latest, latest_etag)
                        store.replacement = copy.deepcopy(latest)
                        raise RuntimeError("etag conflict")
                    return super().save(key, state, etag)

            self.state = ReplacementStore()
            self.engine.state_store = self.state
            self.open_sync()
            message_count = len(self.messenger.sent)
            result = self.submit()
            self.assertEqual(result["status"], "attendance_supplier_sync_superseded")
            self.assertEqual(self.current(), self.state.replacement)
            self.assertEqual(next(iter(self.state.values.values()))[1], self.state.replacement_etag)
            self.assertEqual(len(self.messenger.sent), message_count)
            writes = copy.deepcopy(self.sharepoint.update_calls)
            self.assertEqual([call["item_id"] for call in writes], [1814])
            self.reply(reply_id="finish_supplier_sync")
            self.assertEqual(self.sharepoint.update_calls, writes)
            self.assertEqual(self.current(), self.state.replacement)
            self.assertNotIn("attendance_supplier_sync_plan", self.current())

    return SupplierSyncTests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workflow", type=Path, default=CANDIDATE)
    parser.add_argument("--prior", action="store_true")
    parser.add_argument("--existing", action="store_true")
    parser.add_argument("--full-existing", action="store_true")
    parser.add_argument("--existing-only", action="store_true")
    parser.add_argument("--emit-poll", action="store_true", help="Print the real in-memory final confirmation for local visual QA")
    args = parser.parse_args()
    sys.path.insert(0, str(MIRROR / "worker"))
    with patch("requests.sessions.Session.request", side_effect=AssertionError("Network forbidden in offline QA")):
        load("workflow", args.workflow.resolve())
        fixtures = load("test_workflow", MIRROR / "tests/test_workflow.py")
        if args.emit_poll:
            case = cases(fixtures)()
            case.setUp()
            case.open_sync()
            emitted = case.final_summary()
            print(json.dumps({"question": emitted["body"], "options": emitted["actions"],
                              "detail_table": emitted["detail_table"]}, ensure_ascii=False, indent=2))
            return False
        suite = unittest.TestSuite() if args.existing_only else unittest.defaultTestLoader.loadTestsFromTestCase(cases(fixtures))
        if args.prior:
            for name, path in (
                ("test_pending_attendance_selection", ARTIFACTS / "pending-attendance-checkboxes/test_pending_attendance_selection.py"),
                ("attendance_summary_date_fixtures", ARTIFACTS / "attendance-summary-groups/test_attendance_summary_dates.py"),
                ("attendance_return_fixtures", ARTIFACTS / "attendance-return-date-checklist/test_attendance_return.py"),
            ):
                module = load(name, path)
                suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
        if args.full_existing:
            suite.addTests(unittest.defaultTestLoader.discover(str(MIRROR / "tests")))
        elif args.existing:
            suite.addTests(fixtures.WorkflowTests(name) for name in unittest.defaultTestLoader.getTestCaseNames(fixtures.WorkflowTests) if name.startswith("test_attendance_") and ("supplier_sync" in name or "sync_changed" in name or "syncs_contract" in name))
        print(f"Workflow under test: {sys.modules['workflow'].__file__}", flush=True)
        if args.full_existing:
            result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=1).run(suite)
            print(f"Ran {result.testsRun} tests; failures={len(result.failures)}, errors={len(result.errors)}, skipped={len(result.skipped)}")
            for kind, entries in (("ERROR", result.errors), ("FAIL", result.failures)):
                for test, trace in entries:
                    print(f"{kind}: {test.id()} | {trace.strip().splitlines()[-1]}".encode("ascii", "backslashreplace").decode("ascii"))
        else:
            result = unittest.TextTestRunner(verbosity=2).run(suite)
    return not result.wasSuccessful()


if __name__ == "__main__":
    raise SystemExit(main())
