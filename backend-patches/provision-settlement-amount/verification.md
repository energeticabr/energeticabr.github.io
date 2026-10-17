# Verification record

2026-10-17. Protected signature gesture guard: 14 blocks intact. No mobile source changes.

Focused command, using the staged candidate and production dependency runtime:

```text
pytest -q tests/test_amount_entry.py tests/test_provision_description_query.py
  tests/test_provision_description_settlement.py::DescriptionSettlementTests
  tests/test_provision_description_settlement.py::DescriptionSnapshotCompatibilityTests
  -k 'not test_invalid_group_is_visible_but_not_selectable_or_prepared'
110 passed, 1 deselected in 2.82s
```

The excluded historical test requires unknown amounts to be unselectable. New tests exercise the replacement behavior and preserve paid-child blocking. Default complete-group reads remain strict; only the explicit settlement reader tolerates unknown totals for draft completion.

Full `pytest -q --tb=short tests` was interrupted in `test_image_attachment_processing.py:128` after 216.89 seconds: 228 passed, 15 failed, 5 warnings. A separate run of precisely those 15 failures against unchanged four-file baseline reproduced **15 failed in 14.69s**. No full-suite success is claimed. Existing failures:

```text
test_audit_log.py::AuditLogTests::test_log_uses_all_configured_databases_and_shows_item_detail
test_backend_pending_integration.py::AttendancePendingIntegrationTests::test_initial_status_prompt_has_no_summary_but_completed_edit_does
test_backend_pending_integration.py::AttendancePendingIntegrationTests::test_other_suppliers_query_uses_real_columns_same_day_and_preserves_source
test_channel_bridge.py::ChannelBridgeTests::test_deploy_and_example_include_only_the_exact_native_origin
test_channel_bridge.py::ChannelBridgeTests::test_filtered_options_are_only_a_selectable_poll
test_channel_bridge.py::ChannelBridgeTests::test_options_are_structured_as_poll
test_channel_bridge.py::ChannelBridgeTests::test_portal_deploy_checks_public_upload_preflight_and_authentication
test_channel_bridge.py::ChannelBridgeTests::test_single_filtered_result_remains_a_selectable_poll
test_edit_input_prefill.py::EditInputPrefillTests::test_edit_task_description_prefills_and_waits_for_new_text
test_filtered_options_unlimited.py::FilteredOptionsUnlimitedTests::test_no_match_keeps_filtered_catalogue_visible_for_retry
test_filtered_options_unlimited.py::FilteredOptionsUnlimitedTests::test_old_filtered_page_restarts_at_first_match
test_filtered_options_unlimited.py::FilteredOptionsUnlimitedTests::test_terminal_actions_are_preserved_in_addition_to_all_matches
test_filtered_options_unlimited.py::FilteredOptionsUnlimitedTests::test_typed_filter_delivers_all_matches_through_real_channel
test_flow_progress_summary.py::FlowProgressSummaryTests::test_no_active_flow_never_starts_or_reopens_a_completed_registration
test_generated_document_sign_later.py::GeneratedDocumentSignLaterTest::test_pending_document_submission_replaces_pdf_and_marks_submitted
```

Unmodified archived `DescriptionWorkflowIntegrationTests` also expect typed numeric option selection, superseded by explicit selection/filter behavior in current config. The new real-conversation test uses explicit choice IDs and verifies the actual missing-price path through confirmation without financial writes.

Deployment precheck: status checked, health status ok; all four candidate hashes and both current-root baseline hashes verified. Financial checks use synthetic records only, never settle a real provision for testing.
