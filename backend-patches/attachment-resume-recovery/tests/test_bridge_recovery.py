"""Behavior tests: aggregate only selected rejects before any engine action."""
import copy
import os
import unittest

from bridge_fixture import ALICE, BOB, BridgeFixture, MISSING_FILE, ORIGIN, UNAVAILABLE, load_bridge


class AttachmentRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.namespace = load_bridge(baseline=os.getenv("ATTACHMENT_RECOVERY_BASELINE") == "1")

    def setUp(self):
        self.fixture = BridgeFixture(self.namespace)
        self.addCleanup(self.fixture.close)

    def assert_rejected_without_changes(self, body, expected, *, status=422, **request_options):
        fixture = self.fixture
        before = fixture.snapshot()
        original_body = copy.deepcopy(body)
        actual_status, actual = fixture.request(body, **request_options)
        # Check safety even on the RED baseline, before the metadata assertion.
        self.assertEqual(fixture.snapshot(), before)
        self.assertEqual(fixture.store.writes, 0)
        self.assertEqual(fixture.engine.actions, [])
        self.assertEqual(fixture.bridge.messenger.resets, 0)
        self.assertEqual(fixture.bridge.messenger.messages, [{"type": "text", "text": "draft prompt"}])
        self.assertEqual(body, original_body)
        self.assertEqual(actual_status, status)
        self.assertEqual(actual, expected)
        self.assertEqual(fixture.last_headers.get("Access-Control-Allow-Origin"), request_options.get("origin", ORIGIN))
        return actual

    def unavailable(self, ids, *, message=UNAVAILABLE):
        return {"error": message, "code": "ATTACHMENT_UNAVAILABLE", "unavailableAttachmentIds": ids}

    def test_unknown_selected_reference_has_http_metadata(self):
        good, _ = self.fixture.attachment("keep.pdf")
        wrong = "f" * 64
        self.assert_rejected_without_changes(self.fixture.body([good, wrong]), self.unavailable([wrong]))

    def test_all_unknown_selected_ids_are_returned_in_selection_order(self):
        good, _ = self.fixture.attachment("keep.pdf")
        first, second = "c" * 64, "a" * 64
        self.assert_rejected_without_changes(self.fixture.body([first, good, second]), self.unavailable([first, second]))

    def test_all_missing_physical_files_are_aggregated(self):
        first, _ = self.fixture.attachment("missing-first.pdf", exists=False)
        good, _ = self.fixture.attachment("keep.pdf")
        second, _ = self.fixture.attachment("missing-second.pdf", exists=False)
        self.assert_rejected_without_changes(self.fixture.body([second, good, first]),
                                             self.unavailable([second, first], message=MISSING_FILE))

    def test_submitted_and_readonly_references_remain_ineligible(self):
        submitted, _ = self.fixture.attachment("submitted.pdf", existing_attachment=True)
        readonly, _ = self.fixture.attachment("readonly.pdf", read_only=True)
        good, _ = self.fixture.attachment("keep.pdf")
        self.assert_rejected_without_changes(self.fixture.body([readonly, good, submitted]),
                                             self.unavailable([readonly, submitted]))

    def test_all_four_generated_signature_roles_remain_hidden(self):
        selected = []
        for field in ("document_signing_signature_attachment", "document_signing_epi_signed_attachment",
                      "document_signing_payment_signed_attachment", "document_signing_pending_signed_attachment"):
            attachment_id, item = self.fixture.attachment(field + ".pdf")
            self.fixture.state[field] = item
            selected.append(attachment_id)
        self.fixture.save_fixture()
        self.assert_rejected_without_changes(self.fixture.body(selected[::-1]), self.unavailable(selected[::-1]))

    def test_mixed_rejections_include_missing_ids_and_paths_in_request_order(self):
        first_good, _ = self.fixture.attachment("keep-first.pdf")
        missing, _ = self.fixture.attachment("missing.pdf", exists=False)
        readonly, _ = self.fixture.attachment("readonly.pdf", read_only=True)
        outside, _ = self.fixture.attachment("another-owner.pdf", object_name="other-owner/another-owner.pdf")
        second_good, _ = self.fixture.attachment("keep-second.pdf")
        wrong = "d" * 64
        selected = [first_good, missing, wrong, readonly, outside, second_good]
        self.assert_rejected_without_changes(self.fixture.body(selected), self.unavailable([missing, wrong, readonly, outside]))

    def test_metadata_does_not_add_unselected_ids_names_paths_or_other_owner_ids(self):
        wrong = "a" * 64
        _, other = self.fixture.attachment("private-other-owner-name.pdf", read_only=True)
        self.fixture.attachment("unselected-missing.pdf", exists=False)
        other_id = self.fixture.bridge._portal_attachment_id(BOB, self.fixture.state, other)
        response = self.assert_rejected_without_changes(self.fixture.body([wrong]), self.unavailable([wrong]))
        self.assertNotIn(other_id, response["unavailableAttachmentIds"])

    def test_traversal_other_owner_and_directory_paths_stay_rejected(self):
        traversal, _ = self.fixture.attachment("outside.pdf", object_name="../outside.pdf")
        foreign, _ = self.fixture.attachment("foreign.pdf", object_name="foreign-folder/foreign.pdf")
        directory, item = self.fixture.attachment("directory.pdf", exists=False)
        (self.fixture.engine.media_repository.directory / item["object_name"]).mkdir(parents=True)
        self.assert_rejected_without_changes(self.fixture.body([directory, foreign, traversal]),
                                             self.unavailable([directory, foreign, traversal], message=MISSING_FILE))

    def test_invalid_identifier_validation_is_unchanged_without_metadata(self):
        for ids in (["../private.pdf"], ["A" * 64], [None], [123], ["a" * 63]):
            with self.subTest(ids=ids):
                self.assert_rejected_without_changes(self.fixture.body(ids), {"error": "Identificador de anexo inválido"})

    def test_empty_nonlist_duplicate_and_oversized_selection_keep_original_errors(self):
        cases = [(None, "Seleção de anexos inválida"), ([], "Seleção de anexos inválida"),
                 ("a" * 64, "Seleção de anexos inválida"), (["a" * 64] * 1001, "Seleção de anexos inválida"),
                 (["a" * 64, "a" * 64], "Seleção de anexos duplicada")]
        for ids, message in cases:
            with self.subTest(message=message, count=len(ids) if ids is not None else None):
                self.assert_rejected_without_changes(self.fixture.body(ids), {"error": message})

    def test_missing_and_oversized_request_id_keep_original_error(self):
        for value in ("", "a" * 129):
            with self.subTest(value_length=len(value)):
                self.assert_rejected_without_changes(self.fixture.body(["a" * 64], messageId=value),
                                                     {"error": "Seleção de anexos inválida"})

    def test_busy_stage_precedes_attachment_validation(self):
        self.fixture.state["stage"] = "committing"
        self.fixture.save_fixture()
        self.assert_rejected_without_changes(self.fixture.body(["a" * 64]),
                                             {"error": "Aguarde a conclusão da etapa antes de sair."})
        self.assertEqual(self.fixture.engine.attachment_reads, 0)

    def test_changed_state_precedes_attachment_validation(self):
        self.fixture.store.second_read = lambda state: {**state, "step_index": 99}
        self.assert_rejected_without_changes(self.fixture.body(["a" * 64]),
                                             {"error": "O fluxo mudou. Retome a conversa antes de sair."})
        self.assertEqual(self.fixture.engine.attachment_reads, 0)

    def test_stale_context_precedes_attachment_validation(self):
        self.assert_rejected_without_changes(self.fixture.body(["a" * 64], expectedContextId="stale"),
                                             {"error": "O fluxo mudou. Retome a conversa antes de sair."})
        self.assertEqual(self.fixture.engine.attachment_reads, 0)

    def test_unrelated_valueerror_even_with_same_message_has_no_metadata(self):
        self.fixture.engine.attachment_error = ValueError(UNAVAILABLE)
        self.assert_rejected_without_changes(self.fixture.body(["a" * 64]), {"error": UNAVAILABLE})

    def test_unrelated_oserror_and_runtimeerror_keep_original_http_response(self):
        for exception in (OSError("fixture storage failed"), RuntimeError("fixture engine failed")):
            with self.subTest(exception=type(exception).__name__):
                self.fixture.engine.attachment_error = exception
                self.assert_rejected_without_changes(self.fixture.body(["a" * 64]), {"error": str(exception)})

    def test_unexpected_exception_keeps_http500_without_metadata(self):
        self.fixture.engine.attachment_error = TypeError("fixture unexpected failure")
        self.assert_rejected_without_changes(self.fixture.body(["a" * 64]), {"error": "processing failed"}, status=500)

    def test_invalid_token_keeps_http401_before_state_read(self):
        self.assert_rejected_without_changes(self.fixture.body(["a" * 64]),
                                             {"error": "Invalid Microsoft session"}, status=401, token="invalid")
        self.assertEqual(self.fixture.store.reads, 0)
        self.assertEqual(self.fixture.engine.attachment_reads, 0)

    def test_other_microsoft_owner_cannot_inspect_attachment_availability(self):
        self.assert_rejected_without_changes(self.fixture.body(["a" * 64]),
                                             {"error": "Conversa não autorizada para esta conta Microsoft"}, status=401, token="bob")
        self.assertEqual(self.fixture.engine.attachment_reads, 0)

    def test_corrupt_conversation_ownership_fails_before_metadata(self):
        self.fixture.state["sender"] = "another-owner"
        self.fixture.save_fixture()
        self.assert_rejected_without_changes(self.fixture.body(["a" * 64]),
                                             {"error": "Conversa não autorizada para esta conta Microsoft"}, status=401)
        self.assertEqual(self.fixture.engine.attachment_reads, 0)

    def test_success_forwards_only_selected_files_in_order_and_original_receipt(self):
        first, first_item = self.fixture.attachment("first.pdf")
        self.fixture.attachment("unselected-missing.pdf", exists=False)
        second, second_item = self.fixture.attachment("second.pdf")
        body = self.fixture.body([second, first])
        before = self.fixture.snapshot()
        status, response = self.fixture.request(body)
        self.assertEqual(status, 200)
        self.assertEqual(response, {"status": "processed", "results": [{"status": "awaiting_portal_transfer"}],
                                    "messages": [], "resetConversation": False, "attachments": [],
                                    "activeFlow": {"stage": "collecting"}})
        self.assertEqual(len(self.fixture.engine.actions), 1)
        action = self.fixture.engine.actions[0]
        self.assertEqual(action["selected_attachments"], [second_item, first_item])
        self.assertEqual(action["home_receipt"], {"home_message_id": "transfer-attempt",
                                                  "home_attachment_ids": [second, first],
                                                  "home_context_id": body["expectedContextId"]})
        self.assertEqual(action["event"]["reply_id"], "portal_transfer_attachments")
        self.assertEqual(action["event"]["message_id"], "transfer-attempt")
        self.assertEqual(self.fixture.snapshot(), before)
        self.assertEqual(self.fixture.store.writes, 0)

    def test_matching_pending_attempt_remains_idempotent_before_new_validation(self):
        selected = ["a" * 64]
        body = self.fixture.body(selected)
        self.fixture.state["pending_portal_transfer"] = {"home_message_id": body["messageId"],
            "home_attachment_ids": selected, "home_context_id": body["expectedContextId"]}
        self.fixture.save_fixture()
        before = self.fixture.snapshot()
        status, response = self.fixture.request(body)
        self.assertEqual(status, 200)
        self.assertNotIn("code", response)
        self.assertEqual(self.fixture.engine.actions, [{"operation": "replay"}])
        self.assertEqual(self.fixture.engine.attachment_reads, 0)
        self.assertEqual(self.fixture.snapshot(), before)

    def test_changed_pending_attempt_and_unrelated_pending_transfer_keep_original_errors(self):
        body = self.fixture.body(["a" * 64])
        for request_id, message in ((body["messageId"], "A tentativa de transferência mudou"),
                                   ("other-attempt", "Retome a transferência em andamento antes de sair.")):
            with self.subTest(request_id=request_id):
                self.fixture.state["pending_portal_transfer"] = {"home_message_id": request_id,
                    "home_attachment_ids": ["b" * 64], "home_context_id": body["expectedContextId"]}
                self.fixture.save_fixture()
                self.assert_rejected_without_changes(body, {"error": message})

    def test_invalid_confirmation_remains_unmodified(self):
        self.assert_rejected_without_changes(self.fixture.body(["a" * 64], operation="confirm"),
                                             {"error": "A transferência mudou. Retome a conversa antes de confirmar."})


if __name__ == "__main__":
    unittest.main()
